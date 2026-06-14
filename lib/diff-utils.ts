export interface DiffLine {
  lineNumber: number;
  content: string;
  type: 'added' | 'removed' | 'modified' | 'unchanged';
}

export interface CharDiff {
  start: number;
  end: number;
  type: 'added' | 'removed' | 'modified';
}

export interface DetailedDiffLine extends DiffLine {
  charDiffs?: CharDiff[]; // Diferencias a nivel de carácter
}

export function computeDiff(
  leftLines: string[],
  rightLines: string[]
): { leftDiff: DiffLine[]; rightDiff: DiffLine[] } {
  const leftDiff: DiffLine[] = [];
  const rightDiff: DiffLine[] = [];

  const maxLength = Math.max(leftLines.length, rightLines.length);

  for (let i = 0; i < maxLength; i++) {
    const leftLine = leftLines[i] !== undefined ? leftLines[i] : null;
    const rightLine = rightLines[i] !== undefined ? rightLines[i] : null;

    if (leftLine === null && rightLine !== null) {
      rightDiff.push({
        lineNumber: i + 1,
        content: rightLine,
        type: 'added',
      });
    } else if (leftLine !== null && rightLine === null) {
      leftDiff.push({
        lineNumber: i + 1,
        content: leftLine,
        type: 'removed',
      });
    } else if (leftLine !== null && rightLine !== null) {
      if (leftLine === rightLine) {
        leftDiff.push({
          lineNumber: i + 1,
          content: leftLine,
          type: 'unchanged',
        });
        rightDiff.push({
          lineNumber: i + 1,
          content: rightLine,
          type: 'unchanged',
        });
      } else {
        leftDiff.push({
          lineNumber: i + 1,
          content: leftLine,
          type: 'modified',
        });
        rightDiff.push({
          lineNumber: i + 1,
          content: rightLine,
          type: 'modified',
        });
      }
    }
  }

  return { leftDiff, rightDiff };
}

export function computeDetailedDiff(
  leftLines: string[],
  rightLines: string[]
): { leftDiff: DetailedDiffLine[]; rightDiff: DetailedDiffLine[] } {
  const leftDiff: DetailedDiffLine[] = [];
  const rightDiff: DetailedDiffLine[] = [];

  const maxLength = Math.max(leftLines.length, rightLines.length);

  for (let i = 0; i < maxLength; i++) {
    const leftLine = leftLines[i] !== undefined ? leftLines[i] : null;
    const rightLine = rightLines[i] !== undefined ? rightLines[i] : null;

    if (leftLine === null && rightLine !== null) {
      rightDiff.push({
        lineNumber: i + 1,
        content: rightLine,
        type: 'added',
        charDiffs: [{ start: 0, end: rightLine.length, type: 'added' }]
      });
    } else if (leftLine !== null && rightLine === null) {
      leftDiff.push({
        lineNumber: i + 1,
        content: leftLine,
        type: 'removed',
        charDiffs: [{ start: 0, end: leftLine.length, type: 'removed' }]
      });
    } else if (leftLine !== null && rightLine !== null) {
      if (leftLine === rightLine) {
        leftDiff.push({
          lineNumber: i + 1,
          content: leftLine,
          type: 'unchanged',
        });
        rightDiff.push({
          lineNumber: i + 1,
          content: rightLine,
          type: 'unchanged',
        });
      } else {
        // Calcular diferencias a nivel de carácter
        const leftCharDiffs = computeCharDiffs(leftLine, rightLine);
        const rightCharDiffs = computeCharDiffs(rightLine, leftLine);

        leftDiff.push({
          lineNumber: i + 1,
          content: leftLine,
          type: 'modified',
          charDiffs: leftCharDiffs
        });
        rightDiff.push({
          lineNumber: i + 1,
          content: rightLine,
          type: 'modified',
          charDiffs: rightCharDiffs
        });
      }
    }
  }

  return { leftDiff, rightDiff };
}

function computeCharDiffs(line1: string, line2: string): CharDiff[] {
  const diffs: CharDiff[] = [];
  const lcs = longestCommonSubsequenceChars(line1, line2);
  
  let i = 0, j = 0, k = 0;
  
  while (i < line1.length || j < line2.length) {
    if (k < lcs.length) {
      const [lcsI, lcsJ] = lcs[k];
      
      // Marcar caracteres eliminados en line1
      while (i < lcsI) {
        diffs.push({ start: i, end: i + 1, type: 'removed' });
        i++;
      }
      
      // Marcar caracteres añadidos en line1 (comparando con line2)
      while (j < lcsJ) {
        diffs.push({ start: i, end: i, type: 'added' });
        j++;
      }
      
      // Caracteres coincidentes
      if (i < line1.length && j < line2.length) {
        i++;
        j++;
      }
      k++;
    } else {
      // Resto de caracteres
      while (i < line1.length) {
        diffs.push({ start: i, end: i + 1, type: 'removed' });
        i++;
      }
      while (j < line2.length) {
        diffs.push({ start: i, end: i, type: 'added' });
        j++;
      }
    }
  }
  
  return diffs;
}

function longestCommonSubsequenceChars(str1: string, str2: string): [number, number][] {
  const m = str1.length;
  const n = str2.length;
  const dp: number[][] = Array(m + 1)
    .fill(0)
    .map(() => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (str1[i - 1] === str2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const lcs: [number, number][] = [];
  let i = m, j = n;

  while (i > 0 && j > 0) {
    if (str1[i - 1] === str2[j - 1]) {
      lcs.unshift([i - 1, j - 1]);
      i--;
      j--;
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  return lcs;
}

export function computeAdvancedDiff(
  leftLines: string[],
  rightLines: string[]
): { leftDiff: DiffLine[]; rightDiff: DiffLine[] } {
  const leftDiff: DiffLine[] = [];
  const rightDiff: DiffLine[] = [];

  const lcs = longestCommonSubsequence(leftLines, rightLines);

  let leftIndex = 0;
  let rightIndex = 0;
  let lcsIndex = 0;

  while (leftIndex < leftLines.length || rightIndex < rightLines.length) {
    if (lcsIndex < lcs.length) {
      const [lcsLeft, lcsRight] = lcs[lcsIndex];

      while (leftIndex < lcsLeft) {
        leftDiff.push({
          lineNumber: leftIndex + 1,
          content: leftLines[leftIndex],
          type: 'removed',
        });
        leftIndex++;
      }

      while (rightIndex < lcsRight) {
        rightDiff.push({
          lineNumber: rightIndex + 1,
          content: rightLines[rightIndex],
          type: 'added',
        });
        rightIndex++;
      }

      leftDiff.push({
        lineNumber: leftIndex + 1,
        content: leftLines[leftIndex],
        type: 'unchanged',
      });
      rightDiff.push({
        lineNumber: rightIndex + 1,
        content: rightLines[rightIndex],
        type: 'unchanged',
      });

      leftIndex++;
      rightIndex++;
      lcsIndex++;
    } else {
      if (leftIndex < leftLines.length) {
        leftDiff.push({
          lineNumber: leftIndex + 1,
          content: leftLines[leftIndex],
          type: 'removed',
        });
        leftIndex++;
      }
      if (rightIndex < rightLines.length) {
        rightDiff.push({
          lineNumber: rightIndex + 1,
          content: rightLines[rightIndex],
          type: 'added',
        });
        rightIndex++;
      }
    }
  }

  return { leftDiff, rightDiff };
}

function longestCommonSubsequence(
  left: string[],
  right: string[]
): [number, number][] {
  const m = left.length;
  const n = right.length;
  const dp: number[][] = Array(m + 1)
    .fill(0)
    .map(() => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (left[i - 1] === right[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const lcs: [number, number][] = [];
  let i = m;
  let j = n;

  while (i > 0 && j > 0) {
    if (left[i - 1] === right[j - 1]) {
      lcs.unshift([i - 1, j - 1]);
      i--;
      j--;
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  return lcs;
}
