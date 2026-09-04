'use strict';
//
// fuzzyMatch.js — faithful JS port of F:\Agent\tools\fuzzy_match.py.
//
// Implements the 9-strategy fuzzy find-and-replace chain used by the Hermes/
// Agent file-operations layer, accommodating the whitespace, indentation,
// escape, and unicode drift common in LLM-generated edits.
//
// Public API:
//   fuzzyFindAndReplace(content, oldString, newString, replaceAll=false)
//     -> { newContent, matchCount, strategy, error }
//   isAlreadyApplied(content, oldString, newString) -> boolean
//   formatNoMatchHint(error, matchCount, oldString, content) -> string
//
// Strategy order (verbatim from the reference):
//   exact, line_trimmed, whitespace_normalized, indentation_flexible,
//   escape_normalized, trimmed_boundary, unicode_normalized, block_anchor,
//   context_aware.

const { sequenceMatcherRatio, getOpcodes } = require('./similarity');

// ---------------------------------------------------------------------------
// Unicode normalization map (smart quotes, dashes, ellipsis, spaces, minus)
// ---------------------------------------------------------------------------
const UNICODE_MAP = {
  '\u201c': '"', '\u201d': '"',  // smart double quotes
  '\u2018': "'", '\u2019': "'",  // smart single quotes
  '\u2014': '--', '\u2013': '-',  // em/en dashes
  '\u2026': '...', '\u00a0': ' ',  // ellipsis and non-breaking space
  '\u2212': '-',                  // unicode minus
  '\u2000': ' ', '\u2001': ' ',   // en/em quad
  '\u2002': ' ', '\u2003': ' ',   // en/em space
  '\u2004': ' ', '\u2005': ' ', '\u2006': ' ',  // three/four/six-per-em
  '\u2007': ' ', '\u2008': ' ',   // figure/punctuation space
  '\u2009': ' ', '\u200a': ' ',   // thin/hair space
  '\u202f': ' ',                  // narrow no-break space
  '\u205f': ' ',                  // medium mathematical space
  '\u3000': ' ',                  // ideographic (CJK full-width) space
};

const IDENTICAL_STRINGS_ERROR =
  'No edit was applied because old_string and new_string are identical. ' +
  'Provide the existing text to replace in old_string and the changed ' +
  'replacement text in new_string.';

/** @param {string} text */
function unicodeNormalize(text) {
  let out = text;
  for (const [ch, repl] of Object.entries(UNICODE_MAP)) {
    if (out.includes(ch)) out = out.split(ch).join(repl);
  }
  return out;
}

/**
 * Return true when the requested edit is already present in the file.
 * Conservative (see reference): new_string must be >=8 chars stripped, appear
 * EXACTLY in content, and (if old!=new) old_string must be GONE.
 */
function isAlreadyApplied(content, oldString, newString) {
  if (!newString || newString.trim().length < 8) return false;
  if (!content.includes(newString)) return false;
  if (oldString === newString) return true;
  return !content.includes(oldString);
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Leading whitespace (spaces/tabs) prefix of a line. */
function leadingWhitespace(line) {
  let i = 0;
  while (i < line.length && (line[i] === ' ' || line[i] === '\t')) i++;
  return line.slice(0, i);
}

/** First line of `text` with non-whitespace content, or null. */
function firstMeaningfulLine(text) {
  for (const line of text.split('\n')) {
    if (line.trim()) return line;
  }
  return null;
}

/** Lengths of maximal backslash runs in `s`, in order. */
function backslashRuns(s) {
  const runs = [];
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\') {
      n++;
    } else if (n) {
      runs.push(n);
      n = 0;
    }
  }
  if (n) runs.push(n);
  return runs;
}

/**
 * Calculate start/end character positions from 0-based line indices.
 * end_line is exclusive. Mirrors _calculate_line_positions.
 */
function calculateLinePositions(contentLines, startLine, endLine, contentLength) {
  let start = 0;
  for (let i = 0; i < startLine; i++) start += contentLines[i].length + 1;
  let end = 0;
  for (let i = 0; i < endLine; i++) end += contentLines[i].length + 1;
  end -= 1;
  if (end > contentLength) end = contentLength;
  return { start, end };
}

/**
 * Render up to `cap` match positions as 'L<line>: <snippet>' rows.
 */
function formatMatchLocations(content, matches, cap = 5) {
  const rows = [];
  for (let k = 0; k < Math.min(matches.length, cap); k++) {
    const [start] = matches[k];
    let lineNo = 0;
    let lineStart = 0;
    for (let i = 0; i < start; i++) {
      if (content[i] === '\n') {
        lineNo++;
        lineStart = i + 1;
      }
    }
    // lineNo is 0-based here; convert to 1-based as the reference does
    // (content.count("\n", 0, start) + 1)
    lineNo = (lineNo === 0 ? 0 : lineNo) + 1;
    let nl = content.indexOf('\n', lineStart);
    if (nl === -1) nl = content.length;
    let snippet = content.slice(lineStart, nl).trim();
    if (snippet.length > 80) snippet = snippet.slice(0, 77) + '...';
    rows.push(`  L${lineNo}: ${snippet}`);
  }
  let extra = matches.length - cap;
  if (extra > 0) rows.push(`  ...and ${extra} more`);
  return rows.join('\n');
}

// ---------------------------------------------------------------------------
// Position-mapping helpers
// ---------------------------------------------------------------------------

/**
 * Find matches in normalized line space and map back to original positions.
 * Used by line_trimmed and indentation_flexible.
 */
function findNormalizedMatches(content, contentLines, contentNormalizedLines, pattern, patternNormalized) {
  const patternNormLines = patternNormalized.split('\n');
  const numPatternLines = patternNormLines.length;
  const matches = [];

  const limit = contentNormalizedLines.length - numPatternLines;
  for (let i = 0; i <= limit; i++) {
    const block = contentNormalizedLines.slice(i, i + numPatternLines).join('\n');
    if (block === patternNormalized) {
      const { start, end } = calculateLinePositions(contentLines, i, i + numPatternLines, content.length);
      matches.push([start, end]);
    }
  }
  return matches;
}

/**
 * Map positions from a whitespace-normalized string back to the original.
 * Best-effort, mirrors _map_normalized_positions.
 */
function mapNormalizedPositions(original, normalized, normalizedMatches) {
  if (!normalizedMatches.length) return [];

  const origToNorm = [];
  let origIdx = 0;
  let normIdx = 0;

  while (origIdx < original.length && normIdx < normalized.length) {
    if (original[origIdx] === normalized[normIdx]) {
      origToNorm.push(normIdx);
      origIdx++;
      normIdx++;
    } else if ((original[origIdx] === ' ' || original[origIdx] === '\t') && normalized[normIdx] === ' ') {
      origToNorm.push(normIdx);
      origIdx++;
      if (origIdx < original.length && original[origIdx] !== ' ' && original[origIdx] !== '\t') {
        normIdx++;
      }
    } else if (original[origIdx] === ' ' || original[origIdx] === '\t') {
      origToNorm.push(normIdx);
      origIdx++;
    } else {
      origToNorm.push(normIdx);
      origIdx++;
    }
  }
  while (origIdx < original.length) {
    origToNorm.push(normalized.length);
    origIdx++;
  }

  const normToOrigStart = new Map();
  const normToOrigEnd = new Map();
  for (let origPos = 0; origPos < origToNorm.length; origPos++) {
    const np = origToNorm[origPos];
    if (!normToOrigStart.has(np)) normToOrigStart.set(np, origPos);
    normToOrigEnd.set(np, origPos);
  }

  const result = [];
  for (const [normStart, normEnd] of normalizedMatches) {
    let origStart;
    if (normToOrigStart.has(normStart)) {
      origStart = normToOrigStart.get(normStart);
    } else {
      origStart = 0;
      for (let i = 0; i < origToNorm.length; i++) {
        if (origToNorm[i] >= normStart) { origStart = i; break; }
      }
    }
    let origEnd;
    if (normToOrigEnd.has(normEnd - 1)) {
      origEnd = normToOrigEnd.get(normEnd - 1) + 1;
    } else {
      origEnd = origStart + (normEnd - normStart);
    }
    // Expand trailing whitespace that was normalized, only when the normalized
    // match ended with a space (word boundary discipline — see reference).
    if (normEnd < normalized.length && normalized[normEnd - 1] === ' ') {
      while (origEnd < original.length && (original[origEnd] === ' ' || original[origEnd] === '\t')) {
        origEnd++;
      }
    }
    if (origEnd > original.length) origEnd = original.length;
    result.push([origStart, origEnd]);
  }
  return result;
}

/**
 * Build a list mapping each original char index to its normalized index.
 * UNICODE_MAP replacements can expand one char into several, so the normalized
 * string can be longer than the original.
 */
function buildOrigToNormMap(original) {
  const result = [];
  let normPos = 0;
  for (let i = 0; i < original.length; i++) {
    result.push(normPos);
    const repl = UNICODE_MAP[original[i]];
    normPos += repl !== undefined ? repl.length : 1;
  }
  result.push(normPos); // sentinel: one past the last char
  return result;
}

/** Convert normalized (start,end) positions back to original positions. */
function mapPositionsNormToOrig(origToNorm, normMatches) {
  const normToOrigStart = new Map();
  for (let origPos = 0; origPos < origToNorm.length - 1; origPos++) {
    const np = origToNorm[origPos];
    if (!normToOrigStart.has(np)) normToOrigStart.set(np, origPos);
  }
  const results = [];
  const origLen = origToNorm.length - 1;
  for (const [normStart, normEnd] of normMatches) {
    if (!normToOrigStart.has(normStart)) continue;
    const origStart = normToOrigStart.get(normStart);
    let origEnd = origStart;
    while (origEnd < origLen && origToNorm[origEnd] < normEnd) origEnd++;
    results.push([origStart, origEnd]);
  }
  return results;
}

// ---------------------------------------------------------------------------
// Escape-drift guards
// ---------------------------------------------------------------------------

/**
 * Detect tool-call escape-drift artifacts in new_string (\' or \" present in
 * both old and new but absent from the matched file region), plus JSON
 * double-escaped backslash runs. Returns an error string or null.
 */
function detectEscapeDrift(content, matches, oldString, newString) {
  const hasQuoteSuspects = newString.includes("\\'") || newString.includes('\\"');
  if (!hasQuoteSuspects && !oldString.includes('\\')) return null;

  let matchedRegions = '';
  for (const [start, end] of matches) matchedRegions += content.slice(start, end);

  if (hasQuoteSuspects) {
    for (const suspect of ["\\'", '\\"']) {
      if (newString.includes(suspect) && oldString.includes(suspect) && !matchedRegions.includes(suspect)) {
        const plain = suspect[1]; // "'" or '"'
        return (
          `Escape-drift detected: old_string and new_string contain the literal sequence ` +
          `${JSON.stringify(suspect)} but the matched region of the file does not. This is almost always ` +
          `a tool-call serialization artifact where an apostrophe or quote got prefixed with a spurious ` +
          `backslash. Re-read the file with read_file and pass old_string/new_string without backslash-escaping ` +
          `${JSON.stringify(plain)} characters.`
        );
      }
    }
  }

  const drift = detectBackslashDoubling(matchedRegions, oldString, newString);
  return drift;
}

function detectBackslashDoubling(matchedRegions, oldString, newString) {
  const oldRuns = backslashRuns(oldString);
  const fileRuns = backslashRuns(matchedRegions);
  if (!oldRuns.length || !fileRuns.length || oldRuns.length !== fileRuns.length) return null;
  if (arraysEqual(oldRuns, fileRuns)) return null;
  for (let k = 0; k < oldRuns.length; k++) {
    if (oldRuns[k] !== fileRuns[k] * 2) return null;
  }
  if (!(fileRuns.some((f) => f >= 2) || fileRuns.length >= 2)) return null;
  const newRuns = backslashRuns(newString);
  if (arraysEqual(newRuns, fileRuns)) return null;
  return (
    'Escape-drift detected: every backslash run in old_string is exactly twice as long as in the matched ' +
    'region of the file (e.g. the file has `\\\\` where old_string has `\\\\\\\\`). The tool-call arguments ' +
    'were JSON-escaped one extra time; applying new_string verbatim would double every backslash in the file. ' +
    'Re-read the file with read_file and resend old_string/new_string with the backslash counts exactly as ' +
    'they appear in the file.'
  );
}

function arraysEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Replacement adjustment
// ---------------------------------------------------------------------------

/**
 * Conditionally unescape \t / \r in new_string — only when the matched file
 * region actually contains a real tab/CR. \n is excluded.
 */
function maybeUnescapeNewString(newString, content, matches) {
  if (!newString.includes('\\t') && !newString.includes('\\r')) return newString;
  let matchedRegions = '';
  for (const [start, end] of matches) matchedRegions += content.slice(start, end);
  let out = newString;
  if (out.includes('\\t') && matchedRegions.includes('\t')) out = out.split('\\t').join('\t');
  if (out.includes('\\r') && matchedRegions.includes('\r')) out = out.split('\\r').join('\r');
  return out;
}

/**
 * Adjust new_string's indentation to match the file's actual base indent
 * (Roo Code pattern). Used after a non-exact fuzzy match.
 */
function reindentReplacement(fileRegion, oldString, newString) {
  if (!newString) return newString;
  const oldFirst = firstMeaningfulLine(oldString);
  const fileFirst = firstMeaningfulLine(fileRegion);
  if (oldFirst === null || fileFirst === null) return newString;

  const oldIndent = leadingWhitespace(oldFirst);
  const fileIndent = leadingWhitespace(fileFirst);
  if (oldIndent === fileIndent) return newString;

  const outLines = [];
  for (const line of newString.split('\n')) {
    if (!line.trim()) {
      outLines.push(line);
      continue;
    }
    const lineIndent = leadingWhitespace(line);
    if (lineIndent.startsWith(oldIndent)) {
      const remainder = line.slice(oldIndent.length);
      outLines.push(fileIndent + remainder);
    } else {
      outLines.push(fileIndent + line.replace(/^[ \t]+/, ''));
    }
  }
  return outLines.join('\n');
}

/**
 * Preserve the file's Unicode characters in the replacement for the
 * unicode_normalized strategy. Diffs norm_old -> new_string and keeps the
 * file's original Unicode for unchanged spans.
 */
function preserveUnicodeInReplacement(content, matches, oldString, newString) {
  let fileRegion = '';
  for (const [start, end] of matches) fileRegion += content.slice(start, end);

  const normOld = unicodeNormalize(oldString);
  const normFile = unicodeNormalize(fileRegion);
  if (normOld !== normFile) return newString;

  const fileOrigToNorm = buildOrigToNormMap(fileRegion);
  const fileNormToOrig = new Map();
  for (let origPos = 0; origPos < fileOrigToNorm.length - 1; origPos++) {
    const np = fileOrigToNorm[origPos];
    if (!fileNormToOrig.has(np)) fileNormToOrig.set(np, origPos);
  }

  const opcodes = getOpcodes(normOld, newString);
  const resultParts = [];
  for (const [tag, i1, i2, j1, j2] of opcodes) {
    if (tag === 'equal') {
      const origStart = fileNormToOrig.get(i1) !== undefined ? fileNormToOrig.get(i1) : 0;
      let origEnd = origStart;
      while (origEnd < fileRegion.length && fileOrigToNorm[origEnd] < i2) origEnd++;
      resultParts.push(fileRegion.slice(origStart, origEnd));
    } else if (tag === 'replace') {
      resultParts.push(newString.slice(j1, j2));
    } else if (tag === 'delete') {
      // skip
    } else if (tag === 'insert') {
      resultParts.push(newString.slice(j1, j2));
    }
  }
  return resultParts.join('');
}

/**
 * Apply replacements at the given (start,end) positions. When oldString is
 * non-null the match came from a non-exact strategy and new_string is
 * re-indented to the file's actual indentation first.
 */
function applyReplacements(content, matches, newString, oldString = null) {
  const sorted = matches.slice().sort((a, b) => b[0] - a[0]);
  let result = content;
  for (const [start, end] of sorted) {
    const adjusted = oldString !== null
      ? reindentReplacement(result.slice(start, end), oldString, newString)
      : newString;
    result = result.slice(0, start) + adjusted + result.slice(end);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Matching strategies — each returns a list of [start, end] positions.
// ---------------------------------------------------------------------------

/** Strategy 1: exact string match. */
function strategyExact(content, pattern) {
  const matches = [];
  let start = 0;
  while (true) {
    const pos = content.indexOf(pattern, start);
    if (pos === -1) break;
    matches.push([pos, pos + pattern.length]);
    start = pos + pattern.length; // non-overlapping, matches str.replace semantics
  }
  return matches;
}

/** Strategy 2: line-by-line whitespace trimming. */
function strategyLineTrimmed(content, pattern) {
  const patternNormalized = pattern.split('\n').map((l) => l.trim()).join('\n');
  const contentLines = content.split('\n');
  const contentNormalizedLines = contentLines.map((l) => l.trim());
  return findNormalizedMatches(content, contentLines, contentNormalizedLines, pattern, patternNormalized);
}

/** Strategy 3: collapse multiple spaces/tabs to a single space. */
function strategyWhitespaceNormalized(content, pattern) {
  const normalize = (s) => s.replace(/[ \t]+/g, ' ');
  const patternNormalized = normalize(pattern);
  const contentNormalized = normalize(content);
  const matchesInNorm = strategyExact(contentNormalized, patternNormalized);
  if (!matchesInNorm.length) return [];
  return mapNormalizedPositions(content, contentNormalized, matchesInNorm);
}

/** Strategy 4: ignore indentation differences (lstrip each line). */
function strategyIndentationFlexible(content, pattern) {
  const contentLines = content.split('\n');
  const contentStrippedLines = contentLines.map((l) => l.replace(/^\s+/, ''));
  const patternLines = pattern.split('\n').map((l) => l.replace(/^\s+/, ''));
  return findNormalizedMatches(content, contentLines, contentStrippedLines, pattern, patternLines.join('\n'));
}

/** Strategy 5: convert \n/\t/\r escape sequences to real characters. */
function strategyEscapeNormalized(content, pattern) {
  const unescape = (s) => s.split('\\n').join('\n').split('\\t').join('\t').split('\\r').join('\r');
  const patternUnescaped = unescape(pattern);
  if (patternUnescaped === pattern) return []; // nothing to convert
  return strategyExact(content, patternUnescaped);
}

/** Strategy 6: trim whitespace from first and last lines only. */
function strategyTrimmedBoundary(content, pattern) {
  const patternLines = pattern.split('\n');
  if (!patternLines.length) return [];
  patternLines[0] = patternLines[0].trim();
  if (patternLines.length > 1) patternLines[patternLines.length - 1] = patternLines[patternLines.length - 1].trim();
  const modifiedPattern = patternLines.join('\n');

  const contentLines = content.split('\n');
  const matches = [];
  const patternLineCount = patternLines.length;
  const limit = contentLines.length - patternLineCount;
  for (let i = 0; i <= limit; i++) {
    const blockLines = contentLines.slice(i, i + patternLineCount).slice();
    blockLines[0] = blockLines[0].trim();
    if (blockLines.length > 1) blockLines[blockLines.length - 1] = blockLines[blockLines.length - 1].trim();
    if (blockLines.join('\n') === modifiedPattern) {
      const { start, end } = calculateLinePositions(contentLines, i, i + patternLineCount, content.length);
      matches.push([start, end]);
    }
  }
  return matches;
}

/** Strategy 7: unicode normalization (smart quotes, dashes, spaces). */
function strategyUnicodeNormalized(content, pattern) {
  const normPattern = unicodeNormalize(pattern);
  const normContent = unicodeNormalize(content);
  if (normContent === content && normPattern === pattern) return [];

  let normMatches = strategyExact(normContent, normPattern);
  if (!normMatches.length) normMatches = strategyLineTrimmed(normContent, normPattern);
  if (!normMatches.length) return [];

  const origToNorm = buildOrigToNormMap(content);
  return mapPositionsNormToOrig(origToNorm, normMatches);
}

/** Strategy 8: anchor on first+last lines, similarity-score the middle. */
function strategyBlockAnchor(content, pattern) {
  const normPattern = unicodeNormalize(pattern);
  const normContent = unicodeNormalize(content);

  const patternLines = normPattern.split('\n');
  if (patternLines.length < 2) return [];

  const firstLine = patternLines[0].trim();
  const lastLine = patternLines[patternLines.length - 1].trim();

  const normContentLines = normContent.split('\n');
  const origContentLines = content.split('\n');
  const patternLineCount = patternLines.length;

  const potentialMatches = [];
  const limit = normContentLines.length - patternLineCount;
  for (let i = 0; i <= limit; i++) {
    if (normContentLines[i].trim() === firstLine &&
        normContentLines[i + patternLineCount - 1].trim() === lastLine) {
      potentialMatches.push(i);
    }
  }

  const candidateCount = potentialMatches.length;
  // 0.50 for a unique candidate, 0.70 when several compete.
  const threshold = candidateCount === 1 ? 0.5 : 0.7;
  const matches = [];

  for (const i of potentialMatches) {
    let similarity;
    if (patternLineCount <= 2) {
      similarity = 1.0;
    } else {
      const contentMiddle = normContentLines.slice(i + 1, i + patternLineCount - 1).join('\n');
      const patternMiddle = patternLines.slice(1, -1).join('\n');
      similarity = sequenceMatcherRatio(contentMiddle, patternMiddle);
    }
    if (similarity >= threshold) {
      const { start, end } = calculateLinePositions(origContentLines, i, i + patternLineCount, content.length);
      matches.push([start, end]);
    }
  }
  return matches;
}

/** Strategy 9 (last resort): anchored line-by-line similarity. */
function strategyContextAware(content, pattern) {
  const patternLines = pattern.split('\n');
  const contentLines = content.split('\n');
  if (!patternLines.length) return [];
  const patternLineCount = patternLines.length;
  if (patternLineCount > contentLines.length) return [];

  const firstPat = patternLines[0].trim();
  const lastPat = patternLines[patternLines.length - 1].trim();
  const ANCHOR_THRESHOLD = 0.8;

  const sim = (a, b) => (a === b ? 1.0 : sequenceMatcherRatio(a, b));

  const matches = [];
  const limit = contentLines.length - patternLineCount;
  for (let i = 0; i <= limit; i++) {
    const blockLines = contentLines.slice(i, i + patternLineCount);
    if (sim(firstPat, blockLines[0].trim()) < ANCHOR_THRESHOLD) continue;
    if (sim(lastPat, blockLines[blockLines.length - 1].trim()) < ANCHOR_THRESHOLD) continue;

    let allMatch = true;
    for (let k = 0; k < patternLines.length; k++) {
      const pStripped = patternLines[k].trim();
      if (!pStripped) continue; // blank pattern lines don't constrain
      if (sim(pStripped, blockLines[k].trim()) < 0.8) {
        allMatch = false;
        break;
      }
    }
    if (allMatch) {
      const { start, end } = calculateLinePositions(contentLines, i, i + patternLineCount, content.length);
      matches.push([start, end]);
    }
  }
  return matches;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

const STRATEGIES = [
  ['exact', strategyExact],
  ['line_trimmed', strategyLineTrimmed],
  ['whitespace_normalized', strategyWhitespaceNormalized],
  ['indentation_flexible', strategyIndentationFlexible],
  ['escape_normalized', strategyEscapeNormalized],
  ['trimmed_boundary', strategyTrimmedBoundary],
  ['unicode_normalized', strategyUnicodeNormalized],
  ['block_anchor', strategyBlockAnchor],
  ['context_aware', strategyContextAware],
];

const SIMILARITY_STRATEGIES = new Set(['block_anchor', 'context_aware']);

/**
 * Find and replace text using a chain of increasingly fuzzy strategies.
 * @returns {{ newContent: string, matchCount: number, strategy: ?string, error: ?string }}
 */
function fuzzyFindAndReplace(content, oldString, newString, replaceAll = false) {
  if (!oldString) {
    return { newContent: content, matchCount: 0, strategy: null, error: 'old_string cannot be empty' };
  }
  if (!oldString.trim()) {
    return {
      newContent: content, matchCount: 0, strategy: null,
      error: 'old_string is only whitespace — provide non-blank text to match',
    };
  }
  if (oldString === newString) {
    return { newContent: content, matchCount: 0, strategy: null, error: IDENTICAL_STRINGS_ERROR };
  }

  for (const [strategyName, strategyFn] of STRATEGIES) {
    const matches = strategyFn(content, oldString);

    if (matches && matches.length) {
      if (matches.length > 1 && !replaceAll) {
        const locations = formatMatchLocations(content, matches);
        return {
          newContent: content, matchCount: 0, strategy: null,
          error: `Found ${matches.length} matches for old_string. Provide more context to make it unique, or use replace_all=True. Matches:\n${locations}`,
        };
      }

      if (replaceAll && matches.length > 1 && SIMILARITY_STRATEGIES.has(strategyName)) {
        return {
          newContent: content, matchCount: 0, strategy: null,
          error: `Found ${matches.length} approximate matches via the '${strategyName}' strategy; replace_all only applies to exact matches. Provide the precise text (whitespace included) so an exact/line-trimmed match can be made.`,
        };
      }

      if (strategyName !== 'exact') {
        const driftErr = detectEscapeDrift(content, matches, oldString, newString);
        if (driftErr) return { newContent: content, matchCount: 0, strategy: null, error: driftErr };
      }

      let effectiveNew = maybeUnescapeNewString(newString, content, matches);
      if (strategyName === 'unicode_normalized') {
        effectiveNew = preserveUnicodeInReplacement(content, matches, oldString, effectiveNew);
      }

      const newContent = applyReplacements(
        content, matches, effectiveNew,
        strategyName !== 'exact' ? oldString : null,
      );
      return { newContent, matchCount: matches.length, strategy: strategyName, error: null };
    }
  }

  return { newContent: content, matchCount: 0, strategy: null, error: 'Could not find a match for old_string in the file' };
}

// ---------------------------------------------------------------------------
// "Did you mean..." feedback
// ---------------------------------------------------------------------------

function visualizeWhitespace(line) {
  let i = 0;
  const prefix = [];
  while (i < line.length && (line[i] === ' ' || line[i] === '\t')) {
    prefix.push(line[i] === '\t' ? '→' : '·');
    i++;
  }
  return prefix.join('') + line.slice(i);
}

function findClosestLines(oldString, content, contextLines = 2, maxResults = 3) {
  if (!oldString || !content) return '';
  const oldLines = oldString.split(/\r?\n/);
  const contentLines = content.split(/\r?\n/);
  if (!oldLines.length || !contentLines.length) return '';

  let anchor = oldLines[0].trim();
  if (!anchor) {
    const candidates = oldLines.map((l) => l.trim()).filter(Boolean);
    if (!candidates.length) return '';
    anchor = candidates[0];
  }

  const scored = [];
  for (let i = 0; i < contentLines.length; i++) {
    const stripped = contentLines[i].trim();
    if (!stripped) continue;
    const ratio = sequenceMatcherRatio(anchor, stripped);
    if (ratio > 0.3) scored.push([ratio, i]);
  }
  if (!scored.length) return '';

  scored.sort((a, b) => b[0] - a[0]);
  const top = scored.slice(0, maxResults);

  const parts = [];
  const seenRanges = new Set();
  for (const [, lineIdx] of top) {
    const start = Math.max(0, lineIdx - contextLines);
    const end = Math.min(contentLines.length, lineIdx + oldLines.length + contextLines);
    const key = `${start}:${end}`;
    if (seenRanges.has(key)) continue;
    seenRanges.add(key);
    const snippet = [];
    for (let j = start; j < end; j++) {
      const n = (start + (j - start) + 1);
      snippet.push(`${String(n).padStart(4)}| ${contentLines[j]}`);
    }
    parts.push(snippet.join('\n'));
  }
  if (!parts.length) return '';

  let result = parts.join('\n---\n');

  const bestLine = contentLines[top[0][1]];
  if (bestLine.trim() === anchor && bestLine !== oldLines[0]) {
    result +=
      '\n\nWhitespace difference detected (→ = tab, · = space):\n' +
      `  file has: ${visualizeWhitespace(bestLine)}\n` +
      `  you sent: ${visualizeWhitespace(oldLines[0])}\n` +
      "Use the exact whitespace shown in 'file has'.";
  }
  return result;
}

function formatNoMatchHint(error, matchCount, oldString, content) {
  if (matchCount !== 0) return '';
  if (!error || !error.startsWith('Could not find')) return '';
  const hint = findClosestLines(oldString, content);
  if (!hint) return '';
  return '\n\nDid you mean one of these sections?\n' + hint;
}

module.exports = {
  fuzzyFindAndReplace,
  isAlreadyApplied,
  formatNoMatchHint,
  // exported for testing / reuse
  unicodeNormalize,
  UNICODE_MAP,
  IDENTICAL_STRINGS_ERROR,
  sequenceMatcherRatio,
};