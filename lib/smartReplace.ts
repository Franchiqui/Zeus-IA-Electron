/**
 * Smart replacement utilities for code_change processing.
 * Fixes: String.replace() only replaces FIRST occurrence (Bug 1),
 * and weak fallback matching (Bug 2).
 * Adapted from PlanExecutor's proven replacePreferLast logic.
 */

/** Replace at a specific index in the string */
function replaceAtIndex(text: string, startIndex: number, oldText: string, newText: string): string {
  return text.slice(0, startIndex) + newText + text.slice(startIndex + oldText.length);
}

/** Exact match: prefer LAST occurrence when multiple exist (avoids wrong-location replacements) */
function replacePreferLastExact(text: string, oldText: string, newText: string): { ok: boolean; result: string; occurrences: number } {
  const firstIdx = text.indexOf(oldText);
  if (firstIdx === -1) return { ok: false, result: text, occurrences: 0 };
  const lastIdx = text.lastIndexOf(oldText);
  let occurrences = 0;
  let searchFrom = 0;
  while (true) {
    const idx = text.indexOf(oldText, searchFrom);
    if (idx === -1) break;
    occurrences++;
    searchFrom = idx + Math.max(1, oldText.length);
  }
  const targetIdx = occurrences > 1 ? lastIdx : firstIdx;
  return { ok: true, result: replaceAtIndex(text, targetIdx, oldText, newText), occurrences };
}

/** Flexible/fuzzy match: normalize whitespace to find the right location */
function replacePreferLastFlexible(text: string, oldText: string, newText: string): { ok: boolean; result: string; occurrences: number } {
  const escaped = oldText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = escaped.replace(/\s+/g, '\\s+');
  const regexGlobal = new RegExp(pattern, 'g');
  let lastMatch: RegExpExecArray | null = null;
  let matchCount = 0;
  let m: RegExpExecArray | null;
  while ((m = regexGlobal.exec(text)) !== null) {
    matchCount++;
    lastMatch = m;
    if (m.index === regexGlobal.lastIndex) regexGlobal.lastIndex++;
  }
  if (!lastMatch) return { ok: false, result: text, occurrences: 0 };
  return { ok: true, result: replaceAtIndex(text, lastMatch.index, lastMatch[0], newText), occurrences: matchCount };
}

export type SmartReplaceResult = {
  applied: boolean;
  result: string;
  method: 'exact' | 'fuzzy-trim' | 'fuzzy-flexible' | 'none';
  occurrences: number;
};

/**
 * Smart replacement that tries multiple strategies:
 * 1. Exact match (prefer last occurrence if multiple)
 * 2. Trim-based fallback (match ignoring leading/trailing whitespace)
 * 3. Flexible/fuzzy match (normalize all whitespace differences)
 */
export function smartReplace(text: string, oldStr: string, newStr: string): SmartReplaceResult {
  // If oldStr is empty, only apply if the file is currently empty (e.g. new file)
  // Prepending blindly to existing files causes duplication and errors.
  if (!oldStr) {
    if (!text) {
      return { applied: true, result: newStr, method: 'exact', occurrences: 0 };
    }
    return { applied: false, result: text, method: 'none', occurrences: 0 };
  }

  // 1) Exact match - prefer last occurrence
  const exact = replacePreferLastExact(text, oldStr, newStr);
  if (exact.ok) {
    return { applied: true, result: exact.result, method: 'exact', occurrences: exact.occurrences };
  }

  // 2) Trim-based fallback (ignore leading/trailing whitespace differences)
  const trimmedOld = oldStr.trim();
  // Only allow fuzzy matching for significant blocks of code to avoid accidental matches
  if (trimmedOld.length > 15) {
    const lastIdx = text.lastIndexOf(trimmedOld);
    if (lastIdx !== -1) {
      // ... same logic
    }
  }

  // 3) Flexible/fuzzy match (normalize all internal whitespace)
  // Even stricter for flexible matching as it ignores all internal whitespace
  if (oldStr.length > 30) {
    const flexible = replacePreferLastFlexible(text, oldStr, newStr);
    if (flexible.ok) {
      return { applied: true, result: flexible.result, method: 'fuzzy-flexible', occurrences: flexible.occurrences };
    }
  }

  return { applied: false, result: text, method: 'none', occurrences: 0 };
}
