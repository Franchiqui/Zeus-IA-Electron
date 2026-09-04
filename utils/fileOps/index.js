'use strict';
//
// index.js — public surface of the Zeus fileOps port of the Hermes/Agent
// file-correction logic.

const { fuzzyFindAndReplace, isAlreadyApplied, formatNoMatchHint } = require('./fuzzyMatch');
const { safeWriteFile, patchReplace } = require('./fileOperations');
const { checkLint, checkLintDelta } = require('./lint');

module.exports = {
  fuzzyFindAndReplace,
  isAlreadyApplied,
  formatNoMatchHint,
  safeWriteFile,
  patchReplace,
  checkLint,
  checkLintDelta,
};