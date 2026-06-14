export function formatCode(code: string, language: string): string {
  if (!code.trim()) return code;

  switch (language) {
    case 'javascript':
    case 'typescript':
      return formatJavaScript(code);
    case 'json':
      return formatJSON(code);
    case 'html':
      return formatHTML(code);
    case 'css':
      return formatCSS(code);
    case 'python':
      return formatPython(code);
    default:
      return code;
  }
}

function formatJavaScript(code: string): string {
  try {
    let formatted = code;
    let indentLevel = 0;
    const indentSize = 2;
    const lines = formatted.split('\n');
    const result: string[] = [];

    for (let line of lines) {
      const trimmed = line.trim();

      if (trimmed.match(/^\}/)) {
        indentLevel = Math.max(0, indentLevel - 1);
      }

      if (trimmed) {
        result.push(' '.repeat(indentLevel * indentSize) + trimmed);
      } else {
        result.push('');
      }

      if (trimmed.match(/\{$/)) {
        indentLevel++;
      }
    }

    return result.join('\n');
  } catch {
    return code;
  }
}

function formatJSON(code: string): string {
  try {
    const parsed = JSON.parse(code);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return code;
  }
}

function formatHTML(code: string): string {
  try {
    let formatted = code;
    let indentLevel = 0;
    const indentSize = 2;
    const lines = formatted.split('\n');
    const result: string[] = [];

    for (let line of lines) {
      const trimmed = line.trim();

      if (trimmed.match(/^<\//)) {
        indentLevel = Math.max(0, indentLevel - 1);
      }

      if (trimmed) {
        result.push(' '.repeat(indentLevel * indentSize) + trimmed);
      } else {
        result.push('');
      }

      if (trimmed.match(/^<[^/][^>]*[^/]>$/)) {
        indentLevel++;
      }
    }

    return result.join('\n');
  } catch {
    return code;
  }
}

function formatCSS(code: string): string {
  try {
    let formatted = code;
    let indentLevel = 0;
    const indentSize = 2;
    const lines = formatted.split('\n');
    const result: string[] = [];

    for (let line of lines) {
      const trimmed = line.trim();

      if (trimmed.match(/^\}/)) {
        indentLevel = Math.max(0, indentLevel - 1);
      }

      if (trimmed) {
        result.push(' '.repeat(indentLevel * indentSize) + trimmed);
      } else {
        result.push('');
      }

      if (trimmed.match(/\{$/)) {
        indentLevel++;
      }
    }

    return result.join('\n');
  } catch {
    return code;
  }
}

function formatPython(code: string): string {
  try {
    const lines = code.split('\n');
    const result: string[] = [];
    let indentLevel = 0;
    const indentSize = 4;

    for (let line of lines) {
      const trimmed = line.trim();

      if (trimmed && !trimmed.startsWith('#')) {
        const dedentKeywords = /^(return|break|continue|pass|elif|else|except|finally)/;
        if (dedentKeywords.test(trimmed)) {
          indentLevel = Math.max(0, indentLevel - 1);
        }
      }

      if (trimmed) {
        result.push(' '.repeat(indentLevel * indentSize) + trimmed);
      } else {
        result.push('');
      }

      if (trimmed.endsWith(':') && !trimmed.startsWith('#')) {
        indentLevel++;
      }
    }

    return result.join('\n');
  } catch {
    return code;
  }
}
