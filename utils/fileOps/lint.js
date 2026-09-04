'use strict';
//
// lint.js — JS port of the in-process linters and lint-delta layer from
// F:\Agent\tools\file_operations.py.
//
// Two tiers, identical in shape to the reference:
//   * `checkLint(path, content?)`        — run the in-process syntax linter
//     for the file's extension (JSON/YAML/TOML/Python). Returns a LintResult.
//   * `checkLintDelta(path, pre, post?)` — run post-write lint, then filter
//     out errors that already existed pre-write so only *new* errors surface.
//
// Linters return [ok, errorString]. An errorString of '__SKIP__' means the
// linter isn't available (missing optional dep / no JS parser) and should be
// treated as "no linter" — the gate degrades gracefully, never crashes.

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// In-process linters
// ---------------------------------------------------------------------------

/** @returns {[boolean, string]} */
function lintJson(content) {
  try {
    JSON.parse(content);
    return [true, ''];
  } catch (/** @type {any} */ e) {
    const where = typeof e.lineNumber === 'number'
      ? ` (line ${e.lineNumber}, column ${e.columnNumber || e.column})`
      : '';
    return [false, `JSONDecodeError: ${e.message}${where}`];
  }
}

/**
 * YAML syntax check via js-yaml. Uses `loadAll` so multi-document streams
 * (`---`-separated) don't false-positive the way a single `load` would.
 * Returns '__SKIP__' if js-yaml isn't installed.
 * @returns {[boolean, string]}
 */
function lintYaml(content) {
  let yaml;
  try {
    yaml = require('js-yaml');
  } catch {
    return [true, '__SKIP__'];
  }
  try {
    yaml.loadAll(content, () => {});
    return [true, ''];
  } catch (e) {
    const msg = (e && (e.message || String(e))) || String(e);
    return [false, `YAMLError: ${msg}`];
  }
}

/**
 * TOML syntax check via @iarna/toml. Returns '__SKIP__' if not installed.
 * @returns {[boolean, string]}
 */
function lintToml(content) {
  let toml;
  try {
    toml = require('@iarna/toml');
  } catch {
    return [true, '__SKIP__'];
  }
  try {
    toml.parse(content);
    return [true, ''];
  } catch (/** @type {any} */ e) {
    return [false, `${e.name || 'TOMLError'}: ${e.message || e}`];
  }
}

/**
 * Python syntax check — no JS Python parser is available, so we skip.
 * `.py` is never in the fail-closed set (only the lint-*report* would use it),
 * so skipping just means no Python report, matching the reference's graceful
 * degradation when ast.parse can't run.
 * @returns {[boolean, string]}
 */
function lintPython(_content) {
  return [true, '__SKIP__'];
}

const LINTERS_INPROC = {
  '.py': lintPython,
  '.json': lintJson,
  '.yaml': lintYaml,
  '.yml': lintYaml,
  '.toml': lintToml,
};

// Subset that the pre-write fail-closed gate refuses on (corrupt-structured-
// data writes), rather than merely reporting. `.py` is deliberately excluded.
const FAIL_CLOSED_INPROC_EXTS = new Set(['.json', '.yaml', '.yml', '.toml']);

// ---------------------------------------------------------------------------
// LintResult + check functions
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} LintResult
 * @property {boolean} success
 * @property {boolean} skipped
 * @property {string} output
 * @property {string} [message]
 */

/** @returns {LintResult} */
function okLint() {
  return { success: true, skipped: false, output: '' };
}
/** @returns {LintResult} */
function skippedLint() {
  return { success: true, skipped: true, output: '' };
}

/**
 * Run the in-process syntax linter for `path`'s extension.
 * @param {string} absPath
 * @param {string|null} [content]
 * @returns {LintResult}
 */
function checkLint(absPath, content = null) {
  const ext = path.extname(absPath).toLowerCase();
  const linter = LINTERS_INPROC[ext];
  if (!linter) return skippedLint();

  let text = content;
  if (text === null || text === undefined) {
    try {
      text = fs.readFileSync(absPath, 'utf8');
    } catch {
      return skippedLint();
    }
  }

  const [ok, err] = linter(text);
  if (err === '__SKIP__') return skippedLint();
  if (ok) return okLint();
  return { success: false, skipped: false, output: err };
}

/**
 * Run post-write lint with a pre-write baseline comparison. Only errors
 * introduced by this edit are surfaced; pre-existing errors are filtered.
 *
 * @param {string} absPath
 * @param {string|null} preContent
 * @param {string|null} [postContent]
 * @returns {LintResult}
 */
function checkLintDelta(absPath, preContent, postContent = null) {
  const post = checkLint(absPath, postContent);

  // Hot path: clean (or skipped) post-write.
  if (post.success || post.skipped) return post;

  if (preContent === null || preContent === undefined) return post;

  const pre = checkLint(absPath, preContent);
  if (pre.success || pre.skipped || !pre.output) return post;

  const preLines = new Set();
  for (const ln of pre.output.split(/\r?\n/)) {
    const s = ln.trim();
    if (s) preLines.add(s);
  }
  const postLines = [];
  for (const ln of post.output.split(/\r?\n/)) {
    const s = ln.trim();
    if (s && !preLines.has(s)) postLines.push(s);
  }

  if (!postLines.length) {
    return {
      success: false,
      skipped: false,
      output: post.output,
      message: 'Pre-existing lint errors — this edit didn\'t introduce new ones but the file is still broken.',
    };
  }

  return {
    success: false,
    skipped: false,
    output: 'New lint errors introduced by this edit (pre-existing errors filtered out):\n' + postLines.join('\n'),
  };
}

module.exports = {
  lintJson,
  lintYaml,
  lintToml,
  lintPython,
  LINTERS_INPROC,
  FAIL_CLOSED_INPROC_EXTS,
  checkLint,
  checkLintDelta,
};