'use strict';
//
// Similarity module — a faithful TypeScript/JS port of the pieces of Python's
// `difflib.SequenceMatcher` that the Hermes/Agent fuzzy matcher relies on:
//   * `sequenceMatcherRatio(a, b)`  ->  SequenceMatcher(None, a, b).ratio()
//   * `getOpcodes(a, b)`            ->  SequenceMatcher(None, a, b).get_opcodes()
//
// `ratio()` uses the Ratcliff-Obershelp algorithm (recursive longest common
// substring): find the longest contiguous block shared by `a` and `b`, then
// recurse on the regions to its left and right, summing matched characters.
// ratio = 2 * M / (len(a) + len(b)). difflib adds an "autojunk" heuristic for
// huge inputs; the strings we score (source lines, anchor lines) are small, so
// the plain recursive form is exact for our purposes.
//
// No external dependencies.

/**
 * Find the longest block such that a[aStart:aStart+size] === b[bStart:bStart+size],
 * with aLow <= aStart, aStart+size <= aHigh, bLow <= bStart, bStart+size <= bHigh.
 *
 * Mirrors difflib.SequenceMatcher.find_longest_match: a dynamic-programming
 * sweep that, for each i, tracks the longest match ending at each j (via the
 * previous i's j-1 value), so the whole scan is O((aHigh-aLow)*(bHigh-bLow)).
 *
 * @param {string} a
 * @param {number} aLow
 * @param {number} aHigh
 * @param {string} b
 * @param {number} bLow
 * @param {number} bHigh
 * @returns {{aStart: number, bStart: number, size: number}}
 */
function longestMatch(a, aLow, aHigh, b, bLow, bHigh) {
  let besti = aLow;
  let bestj = bLow;
  let bestsize = 0;

  // Map each char in b[bLow:bHigh] to the list of indices where it occurs,
  // so the inner loop only visits j's that can possibly extend a match.
  const bIndex = new Map();
  for (let j = bLow; j < bHigh; j++) {
    const ch = b[j];
    let arr = bIndex.get(ch);
    if (arr === undefined) {
      arr = [];
      bIndex.set(ch, arr);
    }
    arr.push(j);
  }

  // j2len maps j -> length of the longest match ending at a[i-1] / b[j] for the
  // previous i. Rebuilt per i as newj2len.
  let j2len = new Map();

  for (let i = aLow; i < aHigh; i++) {
    const newj2len = new Map();
    const ch = a[i];
    const indices = bIndex.get(ch);
    if (indices !== undefined) {
      for (let k = 0; k < indices.length; k++) {
        const j = indices[k];
        if (j < bLow) continue;
        if (j >= bHigh) break; // indices are sorted ascending; nothing past bHigh
        const prev = j2len.get(j - 1);
        const len = (prev === undefined ? 0 : prev) + 1;
        newj2len.set(j, len);
        if (len > bestsize) {
          bestsize = len;
          besti = i - len + 1;
          bestj = j - len + 1;
        }
      }
    }
    j2len = newj2len;
  }

  return { aStart: besti, bStart: bestj, size: bestsize };
}

/**
 * Recursively compute the matching blocks of `a` and `b`.
 *
 * Returns a list of {aStart, bStart, size} blocks (in order) plus the difflib
 * sentinel {aStart: a.length, bStart: b.length, size: 0} at the end.
 *
 * @param {string} a
 * @param {string} b
 * @returns {Array<{aStart: number, bStart: number, size: number}>}
 */
function getMatchingBlocks(a, b) {
  const blocks = [];

  const recurse = (aLow, aHigh, bLow, bHigh) => {
    const m = longestMatch(a, aLow, aHigh, b, bLow, bHigh);
    if (m.size > 0) {
      if (aLow < m.aStart && bLow < m.bStart) {
        recurse(aLow, m.aStart, bLow, m.bStart);
      }
      blocks.push(m);
      if (m.aStart + m.size < aHigh && m.bStart + m.size < bHigh) {
        recurse(m.aStart + m.size, aHigh, m.bStart + m.size, bHigh);
      }
    }
  };

  recurse(0, a.length, 0, b.length);
  blocks.push({ aStart: a.length, bStart: b.length, size: 0 });
  return blocks;
}

/**
 * Ratcliff-Obershelp similarity ratio, identical in form to
 * `difflib.SequenceMatcher(None, a, b).ratio()`.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number} 1.0 if equal, 0.0 if either is empty, else 2*M/(la+lb).
 */
function sequenceMatcherRatio(a, b) {
  const la = a.length;
  const lb = b.length;
  if (la === 0 && lb === 0) return 1.0;
  if (la === 0 || lb === 0) return 0.0;
  const blocks = getMatchingBlocks(a, b);
  let matches = 0;
  for (let k = 0; k < blocks.length; k++) {
    matches += blocks[k].size;
  }
  return (2.0 * matches) / (la + lb);
}

/**
 * difflib-style opcodes describing how to turn `a` into `b`.
 *
 * Each opcode is [tag, i1, i2, j1, j2] where tag is one of
 * 'equal' | 'replace' | 'delete' | 'insert', and the i-range indexes `a`
 * while the j-range indexes `b`.
 *
 * @param {string} a
 * @param {string} b
 * @returns {Array<[string, number, number, number, number]>}
 */
function getOpcodes(a, b) {
  const blocks = getMatchingBlocks(a, b);
  const ops = [];
  let i = 0;
  let j = 0;
  for (let k = 0; k < blocks.length; k++) {
    const block = blocks[k];
    const ai = block.aStart;
    const bj = block.bStart;
    const size = block.size;

    if (i < ai && j < bj) {
      ops.push(['replace', i, ai, j, bj]);
    } else if (i < ai) {
      ops.push(['delete', i, ai, j, bj]);
    } else if (j < bj) {
      ops.push(['insert', i, ai, j, bj]);
    }

    if (size > 0) {
      ops.push(['equal', ai, ai + size, bj, bj + size]);
    }

    i = ai + size;
    j = bj + size;
  }
  return ops;
}

module.exports = {
  sequenceMatcherRatio,
  getOpcodes,
  getMatchingBlocks,
  longestMatch,
};