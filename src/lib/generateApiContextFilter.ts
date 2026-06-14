/**
 * Filtra archivos de proyecto para el contexto de generación de API:
 * prioriza pages, app router, carpetas api/routes/controllers, entradas de servidor y package.json.
 * El resto (componentes UI, tests, node_modules, etc.) no se incluye salvo fallback acotado.
 */

export function normalizeContextPath(raw: string): string {
  let p = String(raw || '')
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .trim();
  while (p.startsWith('./')) p = p.slice(2);
  return p.toLowerCase();
}

const EXCLUDE_REGEX =
  /(?:^|\/)node_modules\/|(?:^|\/)\.git\/|(?:^|\/)(?:dist|build|\.next|out|coverage|\.nuxt|\.output|vendor|__pycache__)\/|(?:^|\/)target\//;

const CODE_EXT = /\.(tsx?|jsx?|mjs|cjs)$/i;

export function isExcludedContextPath(norm: string): boolean {
  if (!norm || norm.length > 600) return true;
  if (EXCLUDE_REGEX.test(norm)) return true;
  if (/\.(map|lock)$/i.test(norm)) return true;
  if (/package-lock\.json$/i.test(norm) || /yarn\.lock$/i.test(norm) || /pnpm-lock\.yaml$/i.test(norm)) {
    return true;
  }
  if (/\.(png|jpe?g|gif|webp|ico|svg|woff2?|ttf|eot|pdf|zip|mp4|webm)$/i.test(norm)) return true;
  if (/\.(test|spec)\.(tsx?|jsx?)$/i.test(norm)) return true;
  if (/\/__(tests|mocks)__\//i.test(norm)) return true;
  return false;
}

/** Rutas de alto valor para inferir una API REST. */
export function isPrimaryApiContextPath(norm: string): boolean {
  if (isExcludedContextPath(norm)) return false;
  if (norm === 'package.json' || /\/package\.json$/i.test(norm)) return true;
  if (!CODE_EXT.test(norm)) return false;

  if (/\/app\/.*\/(page|layout|route|loading|error|default|not-found|template)\.(tsx?|jsx?)$/i.test(norm)) {
    return true;
  }
  if (/\/app\/api\/.+\.(tsx?|jsx?)$/i.test(norm)) return true;

  if (/\/pages\/.+\.(tsx?|jsx?)$/i.test(norm)) return true;

  if (/\/(api|routes|router|routers|controllers|handlers)\/.+\.(tsx?|jsx?|mjs|cjs)$/i.test(norm)) {
    return true;
  }
  if (/\/src\/api\/.+\.(tsx?|jsx?)$/i.test(norm)) return true;

  if (/\/(server|backend)\/api\/.+\.(tsx?|jsx?)$/i.test(norm)) return true;

  if (/(^|\/)server\.(ts|js)$/i.test(norm)) return true;
  if (/(^|\/)main\.(ts|tsx|js|jsx)$/i.test(norm) && !/\/(components|ui)\//i.test(norm)) return true;
  if (
    /(^|\/)index\.(ts|tsx|js|jsx)$/i.test(norm) &&
    /\/(src|server|backend|lib\/server)\//i.test(norm)
  ) {
    return true;
  }
  if (/^src\/index\.(ts|tsx|js|jsx)$/i.test(norm)) return true;
  if (/^index\.(ts|tsx|js|jsx)$/i.test(norm)) return true;

  if (/(^|\/)middleware\.(ts|js)$/i.test(norm)) return true;

  if (/\/(src\/)?routes\/.+\.(tsx?|jsx?)$/i.test(norm)) return true;

  // Archivos sueltos (sin carpeta) con nombre típico de entrada
  if (/^(app|main|server|index|route|middleware)\.(tsx?|jsx?|mjs|cjs)$/i.test(norm)) return true;

  return false;
}

/** Si no hay coincidencias primarias: algo de código bajo src/ fuera de carpetas muy ruidosas. */
export function isFallbackContextPath(norm: string): boolean {
  if (isExcludedContextPath(norm)) return false;
  if (!CODE_EXT.test(norm)) return false;
  if (/\/(components|ui|views|widgets|stories|storybook)\//i.test(norm)) return false;
  if (/\/src\/.+\.(tsx?|jsx?|mjs|cjs)$/i.test(norm)) return true;
  if (/^src\/.+\.(tsx?|jsx?|mjs|cjs)$/i.test(norm)) return true;
  // Sueltos en raíz solo si el nombre sugiere API o entrada
  if (
    !norm.includes('/') &&
    CODE_EXT.test(norm) &&
    /^(api|route|router|server|app|main|index|middleware|handler|service)/i.test(norm.split('.')[0] || '')
  ) {
    return true;
  }
  return false;
}

export type ContextFilterResult<T> = {
  kept: T[];
  dropped: number;
  usedFallback: boolean;
};

export function filterGenerateFileParts<T extends { originalname: string }>(
  files: T[],
  fallbackMax: number
): ContextFilterResult<T> {
  const norm = (f: T) => normalizeContextPath(f.originalname);

  const primary = files.filter((f) => isPrimaryApiContextPath(norm(f)));

  if (primary.length > 0) {
    return { kept: primary, dropped: files.length - primary.length, usedFallback: false };
  }

  const fb = files
    .filter((f) => isFallbackContextPath(norm(f)))
    .sort((a, b) => norm(a).split('/').length - norm(b).split('/').length)
    .slice(0, fallbackMax);

  return {
    kept: fb,
    dropped: files.length - fb.length,
    usedFallback: true
  };
}

type FileWithPath = File & { webkitRelativePath?: string };

export function getBrowserFileContextPath(file: File): string {
  const w = file as FileWithPath;
  return (w.webkitRelativePath && w.webkitRelativePath.trim()) || file.name;
}

export function filterBrowserFilesForContext(files: File[], fallbackMax = 25): File[] {
  const wrapped = files.map((file) => ({
    originalname: getBrowserFileContextPath(file),
    file
  }));
  const { kept } = filterGenerateFileParts(wrapped, fallbackMax);
  return kept.map((w) => w.file);
}
