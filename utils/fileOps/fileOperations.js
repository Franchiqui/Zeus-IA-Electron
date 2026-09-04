'use strict';
//
// fileOperations.js — JS port of the local-Node equivalents of
// `write_file` and `patch_replace` from F:\Agent\tools\file_operations.py.
//
// The reference shells out (cat/mktemp/mv/sha256sum) because it runs across
// local/docker/ssh/modal/daytona backends. Zeus is a single local Node
// process, so this port uses the `fs`/`crypto` stdlib directly while keeping
// the exact safety ordering of the reference:
//
//   safeWriteFile:
//     deny-list -> lone-surrogate reject -> fail-closed JSON/YAML/TOML gate ->
//     capture pre_content -> detect+preserve line endings -> preserve BOM ->
//     atomic temp+rename -> sha256 verify -> lint-delta.
//
//   patchReplace:
//     read -> strip BOM -> fuzzy_find_and_replace -> already-applied detection ->
//     normalize line endings -> safeWriteFile -> post-write re-read verify ->
//     unified diff -> lint-delta.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const { fuzzyFindAndReplace, isAlreadyApplied, formatNoMatchHint } = require('./fuzzyMatch');
const { checkLint, checkLintDelta, FAIL_CLOSED_INPROC_EXTS, LINTERS_INPROC } = require('./lint');

// ---------------------------------------------------------------------------
// BOM / line-ending helpers (verbatim ports)
// ---------------------------------------------------------------------------

const UTF8_BOM = '\uFEFF';

/** @returns {[string, boolean]} */
function stripBom(text) {
  if (text && text.startsWith(UTF8_BOM)) return [text.slice(UTF8_BOM.length), true];
  return [text || '', false];
}

function hasBom(text) {
  return !!text && text.startsWith(UTF8_BOM);
}

/**
 * Dominant line ending of a sample, from its first 4KB.
 * @returns {string|null} '\r\n' | '\n' | null
 */
function detectLineEnding(sample) {
  if (!sample) return null;
  const head = sample.slice(0, 4096);
  if (head.includes('\r\n')) return '\r\n';
  if (head.includes('\n')) return '\n';
  return null;
}

/** Convert all line endings in `text` to `target` ('\n' or '\r\n'). Idempotent. */
function normalizeLineEndings(text, target) {
  const lf = text.split('\r\n').join('\n').split('\r').join('\n');
  if (target === '\n') return lf;
  if (target === '\r\n') return lf.split('\n').join('\r\n');
  return text;
}

/** Dominant line ending of the file on disk, or from preContent if available. */
function detectFileLineEnding(absPath, preContent = null) {
  if (preContent) return detectLineEnding(preContent);
  let fd;
  try {
    fd = fs.openSync(absPath, 'r');
    const buf = Buffer.alloc(4096);
    const n = fs.readSync(fd, buf, 0, 4096, 0);
    return detectLineEnding(buf.slice(0, n).toString('utf8'));
  } catch {
    return null;
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* ignore */ } }
  }
}

/** Whether the file on disk starts with a UTF-8 BOM (probes first 3 bytes). */
function fileHasBom(absPath) {
  let fd;
  try {
    fd = fs.openSync(absPath, 'r');
    const buf = Buffer.alloc(3);
    const n = fs.readSync(fd, buf, 0, 3, 0);
    return n === 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF;
  } catch {
    return false;
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* ignore */ } }
  }
}

// ---------------------------------------------------------------------------
// Minimal write-deny guard
// ---------------------------------------------------------------------------

const _BLOCKED_DEVICE_BASENAMES = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
]);

/** Minimal sensitive-path guard. Callers (fileController/routes) confine to DATA_DIR. */
function getWriteDeniedError(p) {
  const base = path.basename(p).toLowerCase().split('.')[0];
  if (_BLOCKED_DEVICE_BASENAMES.has(base)) {
    return `Refusing to write to device path: ${p}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Lone-surrogate detection
// ---------------------------------------------------------------------------

/** True if `content` contains a lone (unpaired) UTF-16 surrogate. */
function hasLoneSurrogate(content) {
  for (let i = 0; i < content.length; i++) {
    const code = content.charCodeAt(i);
    if (code >= 0xD800 && code <= 0xDBFF) {
      // high surrogate must be followed by a low surrogate
      const next = i + 1 < content.length ? content.charCodeAt(i + 1) : 0;
      if (!(next >= 0xDC00 && next <= 0xDFFF)) return true;
      i++; // consume the pair
    } else if (code >= 0xDC00 && code <= 0xDFFF) {
      // low surrogate without preceding high
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Atomic write (temp file in same dir + rename)
// ---------------------------------------------------------------------------

/**
 * Write `content` to `absPath` atomically: temp file in the SAME directory,
 * mode preserved from the existing target (best-effort), then `fs.rename`
 * (atomic same-FS swap). Parent dirs are created. Temp is cleaned up on any
 * failure. Returns { ok, error }.
 *
 * @param {string} absPath
 * @param {string} content
 * @returns {Promise<{ok: boolean, error: ?string}>}
 */
async function atomicWrite(absPath, content) {
  const parent = path.dirname(absPath) || '.';
  try {
    await fs.promises.mkdir(parent, { recursive: true });
  } catch (e) {
    return { ok: false, error: `Failed to create directory ${parent}: ${e.message || e}` };
  }

  let tmpPath;
  let cleanedUp = false;
  try {
    // Collision-safe name in the target's own dir (same FS -> real rename).
    const prefix = '.zeus-tmp-';
    const suffix = `-${process.pid}-${Date.now()}-${Math.floor(performance.now() * 1000) % 100000}`;
    tmpPath = path.join(parent, prefix + path.basename(absPath).replace(/[^A-Za-z0-9._-]/g, '_') + suffix);

    // Preserve the existing file's mode (best-effort, never fatal).
    let mode = null;
    try {
      const st = await fs.promises.stat(absPath);
      mode = st.mode & 0o777;
    } catch { /* file may not exist yet */ }

    await fs.promises.writeFile(tmpPath, content, 'utf8');

    if (mode !== null) {
      try { await fs.promises.chmod(tmpPath, mode); } catch { /* best-effort */ }
    } else {
      // New file: default rw minus umask instead of 0600.
      try { await fs.promises.chmod(tmpPath, 0o666); } catch { /* best-effort */ }
    }

    await fs.promises.rename(tmpPath, absPath);
    cleanedUp = true;
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: `atomic write failed: ${e.message || e}` };
  } finally {
    if (!cleanedUp && tmpPath) {
      try { await fs.promises.unlink(tmpPath); } catch { /* ignore */ }
    }
  }
}

// ---------------------------------------------------------------------------
// Unified diff (line-level LCS, difflib-shaped)
// ---------------------------------------------------------------------------

function splitKeepEnds(s) {
  const out = [];
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\n') {
      out.push(s.slice(start, i + 1));
      start = i + 1;
    }
  }
  if (start < s.length) out.push(s.slice(start));
  return out;
}

/**
 * Line-level opcodes (equal/replace/delete/insert) via LCS DP.
 * Falls back to a single 'replace' when the DP table would be too large.
 */
function lineOpcodes(a, b) {
  const n = a.length;
  const m = b.length;
  if (n === 0 && m === 0) return [];
  if (n * m > 4_000_000) {
    // Too large for an O(n*m) table — emit a whole-file replace.
    return n === 0 ? [['insert', 0, 0, 0, m]]
         : m === 0 ? [['delete', 0, n, 0, 0]]
         : [['replace', 0, n, 0, m]];
  }
  // dp[i][j] = LCS length of a[i:] and b[j:]
  const dp = new Array(n + 1);
  for (let i = 0; i <= n; i++) dp[i] = new Int32Array(m + 1);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const raw = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      raw.push(['equal', i, i + 1, j, j + 1]);
      i++; j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      raw.push(['delete', i, i + 1, j, j]);
      i++;
    } else {
      raw.push(['insert', i, i, j, j + 1]);
      j++;
    }
  }
  if (i < n) raw.push(['delete', i, n, j, j]);
  if (j < m) raw.push(['insert', i, i, j, m]);

  // Merge consecutive delete+insert -> replace, and same-tag runs.
  const merged = [];
  for (const op of raw) {
    const last = merged[merged.length - 1];
    if (last && last[0] === 'delete' && op[0] === 'insert') {
      last[0] = 'replace';
      last[2] = op[1]; // i2 unchanged from delete; j2 from insert
      last[4] = op[4];
      continue;
    }
    if (last && last[0] === 'insert' && op[0] === 'delete') {
      last[0] = 'replace';
      last[2] = op[2];
      last[4] = op[4];
      // reorder i-range
      last[1] = op[1]; last[2] = op[2];
      continue;
    }
    if (last && last[0] === op[0]) {
      last[2] = op[2];
      last[4] = op[4];
      continue;
    }
    merged.push(op.slice());
  }
  return merged;
}

/** difflib-style grouped opcodes for unified_diff with `n` lines of context. */
function getGroupedOpcodes(opcodes, n = 3) {
  if (!opcodes.length) return [];
  const ops = opcodes.map((o) => o.slice());

  if (ops[0][0] === 'equal') {
    const [, i1, i2, j1, j2] = ops[0];
    ops[0] = ['equal', Math.max(i1, i2 - n), i2, Math.max(j1, j2 - n), j2];
  }
  if (ops[ops.length - 1][0] === 'equal') {
    const [, i1, i2, j1, j2] = ops[ops.length - 1];
    ops[ops.length - 1] = ['equal', i1, Math.min(i2, i1 + n), j1, Math.min(j2, j1 + n)];
  }

  const nn = n + n;
  const groups = [];
  let group = [];
  for (const [tag, i1, i2, j1, j2] of ops) {
    if (tag === 'equal') {
      group.push([tag, i1, i2, j1, j2]);
      if (i2 - i1 > nn) {
        group[group.length - 1] = ['equal', i1, Math.min(i2, i1 + n), j1, Math.min(j2, j1 + n)];
        groups.push(group);
        group = [['equal', Math.max(i1, i2 - n), i2, Math.max(j1, j2 - n), j2]];
      }
    } else {
      group.push([tag, i1, i2, j1, j2]);
    }
  }
  if (group.length && !(group.length === 1 && group[0][0] === 'equal')) {
    groups.push(group);
  }
  return groups;
}

function formatRange(start, length) {
  const begin = start + 1; // 1-based
  if (length === 1) return String(begin);
  if (length === 0) return String(begin - 1);
  return `${begin},${length}`;
}

/** Minimal unified diff (line-level) between old and new content. */
function unifiedDiff(oldContent, newContent, filename, n = 3) {
  const a = splitKeepEnds(oldContent);
  const b = splitKeepEnds(newContent);
  const ops = lineOpcodes(a, b);
  const groups = getGroupedOpcodes(ops, n);

  const lines = [];
  lines.push(`--- a/${filename}\n`);
  lines.push(`+++ b/${filename}\n`);
  for (const group of groups) {
    const first = group[0];
    const last = group[group.length - 1];
    const i1 = first[1];
    const i2 = last[2];
    const j1 = first[3];
    const j2 = last[4];
    lines.push(`@@ -${formatRange(i1, i2 - i1)} +${formatRange(j1, j2 - j1)} @@\n`);
    for (const [tag, oi1, oi2, oj1, oj2] of group) {
      if (tag === 'equal') {
        for (let k = oi1; k < oi2; k++) lines.push(' ' + a[k]);
      } else {
        if (tag === 'replace' || tag === 'delete') {
          for (let k = oi1; k < oi2; k++) lines.push('-' + a[k]);
        }
        if (tag === 'replace' || tag === 'insert') {
          for (let k = oj1; k < oj2; k++) lines.push('+' + b[k]);
        }
      }
    }
  }
  return lines.join('');
}

// ---------------------------------------------------------------------------
// safeWriteFile (port of write_file)
// ---------------------------------------------------------------------------

/**
 * Write `content` to `absPath` safely. See module header for the ordering.
 *
 * @param {string} absPath
 * @param {string} content
 * @param {string|null} [preContent]
 * @returns {Promise<{success: boolean, error: ?string, bytesWritten: number, verified: ?boolean, lint: ?object}>}
 */
async function safeWriteFile(absPath, content, preContent = null) {
  absPath = path.resolve(absPath);

  const denied = getWriteDeniedError(absPath);
  if (denied) return { success: false, error: denied, bytesWritten: 0, verified: null, lint: null };

  // Reject lone surrogates up front (they cannot be UTF-8 encoded).
  if (hasLoneSurrogate(content)) {
    return {
      success: false,
      error: `Refusing to write '${absPath}': content contains a lone surrogate character that cannot be encoded as UTF-8. The file was NOT created or modified.`,
      bytesWritten: 0, verified: null, lint: null,
    };
  }

  const ext = path.extname(absPath).toLowerCase();

  // Fail-closed pre-write syntax gate (JSON/YAML/TOML), against the RAW content
  // before BOM/CRLF shims run.
  if (FAIL_CLOSED_INPROC_EXTS.has(ext)) {
    const linter = LINTERS_INPROC[ext];
    if (linter) {
      const [ok, err] = linter(content);
      if (!ok && err !== '__SKIP__') {
        return {
          success: false,
          error: `Refusing to write '${absPath}': candidate content fails ${ext} syntax validation (${err}). The file was NOT created or modified. Fix the content and retry.`,
          bytesWritten: 0, verified: null, lint: null,
        };
      }
    }
  }

  // Capture pre-write content for lint-delta when a linter covers this ext.
  let pre = preContent;
  if (pre === null || pre === undefined) {
    if (ext in LINTERS_INPROC) {
      try {
        pre = await fs.promises.readFile(absPath, 'utf8');
      } catch { pre = null; }
    }
  }

  // Line-ending preservation.
  const originalEnding = detectFileLineEnding(absPath, pre);
  if (originalEnding === '\r\n') {
    content = normalizeLineEndings(content, '\r\n');
  }

  // BOM preservation: probe disk (NOT preContent — read layer may strip BOM).
  if (fileHasBom(absPath) && !hasBom(content)) {
    content = UTF8_BOM + content;
  }

  // Encode once for byte count + sha256.
  const contentBytes = Buffer.from(content, 'utf8');

  const writeRes = await atomicWrite(absPath, content);
  if (!writeRes.ok) {
    return { success: false, error: `Failed to write file: ${writeRes.error}`, bytesWritten: 0, verified: null, lint: null };
  }

  const bytesWritten = contentBytes.length;

  // Post-write sha256 verification.
  let verified = null;
  try {
    const diskBuf = await fs.promises.readFile(absPath);
    const diskSha = crypto.createHash('sha256').update(diskBuf).digest('hex');
    const expectedSha = crypto.createHash('sha256').update(contentBytes).digest('hex');
    verified = diskSha === expectedSha;
    if (!verified) {
      return {
        success: false,
        error: `Post-write verification failed for ${absPath}: on-disk content hash differs from the intended write. The write did not persist correctly — re-read the file and retry.`,
        bytesWritten, verified, lint: null,
      };
    }
  } catch {
    verified = null;
  }

  // Post-write lint with delta refinement.
  const lintResult = checkLintDelta(absPath, pre, content);

  return {
    success: true,
    error: null,
    bytesWritten,
    verified,
    lint: lintResult,
  };
}

// ---------------------------------------------------------------------------
// patchReplace (port of patch_replace)
// ---------------------------------------------------------------------------

/**
 * Replace `oldString` with `newString` in `absPath` using fuzzy matching.
 *
 * @param {string} absPath
 * @param {string} oldString
 * @param {string} newString
 * @param {boolean} [replaceAll]
 * @returns {Promise<{success: boolean, noChange: boolean, error: ?string, diff: ?string, lint: ?object, filesModified: ?string[], note: ?string, strategy: ?string}>}
 */
async function patchReplace(absPath, oldString, newString, replaceAll = false) {
  absPath = path.resolve(absPath);

  const denied = getWriteDeniedError(absPath);
  if (denied) return { success: false, noChange: false, error: denied, diff: null, lint: null, filesModified: null, note: null, strategy: null };

  let rawContent;
  try {
    rawContent = await fs.promises.readFile(absPath, 'utf8');
  } catch (e) {
    return { success: false, noChange: false, error: `Failed to read file: ${absPath} (${e.message || e})`, diff: null, lint: null, filesModified: null, note: null, strategy: null };
  }

  // Strip a leading BOM before matching (a phantom U+FEFF before line 1
  // defeats an exact first-line match). safeWriteFile restores it from disk.
  const [content] = stripBom(rawContent);

  const { newContent, matchCount, strategy, error } = fuzzyFindAndReplace(content, oldString, newString, replaceAll);

  if (error || matchCount === 0) {
    if (isAlreadyApplied(content, oldString, newString)) {
      return {
        success: true,
        noChange: true,
        error: null,
        diff: null,
        lint: null,
        filesModified: null,
        note: `File already contains the target text — the edit appears to be already applied to ${absPath}. No write performed; do not re-send this patch.`,
        strategy: null,
      };
    }
    let errMsg = error || `Could not find match for old_string in ${absPath}`;
    try {
      errMsg += formatNoMatchHint(error, matchCount, oldString, content);
    } catch { /* ignore */ }
    return { success: false, noChange: false, error: errMsg, diff: null, lint: null, filesModified: null, note: null, strategy: null };
  }

  // Normalize the whole new_content to the file's detected line ending so the
  // on-disk file is consistent (the substituted region is LF; surroundings may
  // be CRLF).
  const fileEnding = detectLineEnding(content);
  let finalContent = newContent;
  if (fileEnding) {
    finalContent = normalizeLineEndings(newContent, fileEnding);
  }

  // Write back with preContent = raw (BOM-bearing) so safeWriteFile can
  // detect/restore BOM without a redundant read.
  const writeResult = await safeWriteFile(absPath, finalContent, rawContent);
  if (!writeResult.success) {
    return { success: false, noChange: false, error: `Failed to write changes: ${writeResult.error}`, diff: null, lint: null, filesModified: null, note: null, strategy };
  }

  // Post-write verification — re-read and confirm the bytes landed.
  let verify;
  try {
    const verifyRaw = await fs.promises.readFile(absPath, 'utf8');
    const [verifyBomless] = stripBom(verifyRaw);
    const verifyNorm = verifyBomless.split('\r\n').join('\n').split('\r').join('\n');
    const newNorm = finalContent.split('\r\n').join('\n').split('\r').join('\n');
    if (verifyNorm !== newNorm) {
      return {
        success: false, noChange: false,
        error: `Post-write verification failed for ${absPath}: on-disk content differs from intended write (wrote ${newNorm.length} chars, read back ${verifyNorm.length} chars after normalizing line endings). The patch did not persist. Re-read the file and try again.`,
        diff: null, lint: null, filesModified: null, note: null, strategy,
      };
    }
    verify = true;
  } catch (e) {
    return { success: false, noChange: false, error: `Post-write verification failed: could not re-read ${absPath} (${e.message || e})`, diff: null, lint: null, filesModified: null, note: null, strategy };
  }

  // Diff + lint-delta. `content` (BOM-less) vs `finalContent` for the diff.
  const diff = unifiedDiff(content, finalContent, absPath);
  const lintResult = checkLintDelta(absPath, content, finalContent);

  return {
    success: true,
    noChange: false,
    error: null,
    diff,
    lint: lintResult,
    filesModified: verify ? [absPath] : null,
    note: null,
    strategy,
  };
}

module.exports = {
  safeWriteFile,
  patchReplace,
  // helpers exported for reuse / testing
  detectLineEnding,
  detectFileLineEnding,
  normalizeLineEndings,
  stripBom,
  hasBom,
  fileHasBom,
  atomicWrite,
  unifiedDiff,
  hasLoneSurrogate,
  getWriteDeniedError,
  UTF8_BOM,
};