import path from 'path';
import fs from 'fs/promises';

export type RouteKind = 'page' | 'route' | 'layout' | 'api' | 'component' | 'file';

type DetectedStructure = {
  hasSrcDir: boolean;
  hasAppDir: boolean;
  hasPagesDir: boolean;
  appDirPath?: string;
  pagesDirPath?: string;
};

export async function detectNextStructure(root: string): Promise<DetectedStructure> {
  const result: DetectedStructure = {
    hasSrcDir: false,
    hasAppDir: false,
    hasPagesDir: false,
  };

  try {
    const srcApp = path.join(root, 'src', 'app');
    const srcPages = path.join(root, 'src', 'pages');
    const app = path.join(root, 'app');
    const pages = path.join(root, 'pages');

    const [srcAppStat, srcPagesStat, appStat, pagesStat] = await Promise.all([
      fs.stat(srcApp).catch(() => null),
      fs.stat(srcPages).catch(() => null),
      fs.stat(app).catch(() => null),
      fs.stat(pages).catch(() => null),
    ]);

    if (srcAppStat?.isDirectory()) {
      result.hasSrcDir = true;
      result.hasAppDir = true;
      result.appDirPath = 'src/app';
    } else if (appStat?.isDirectory()) {
      result.hasAppDir = true;
      result.appDirPath = 'app';
    }

    if (srcPagesStat?.isDirectory()) {
      result.hasSrcDir = true;
      result.hasPagesDir = true;
      result.pagesDirPath = 'src/pages';
    } else if (pagesStat?.isDirectory()) {
      result.hasPagesDir = true;
      result.pagesDirPath = 'pages';
    }
  } catch {
    // ignore
  }

  return result;
}

export function normalizeTargetPath(raw: string, _root?: string): string {
  return raw.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/$/, '');
}

export function ensureRouteConventions(
  kind: RouteKind,
  relPath: string,
  structure: Awaited<ReturnType<typeof detectNextStructure>>,
  language: 'tsx' | 'ts' | 'js' = 'tsx'
): string {
  const ext = language === 'ts' ? '.ts' : language === 'js' ? '.js' : '.tsx';
  const base = relPath.replace(/\.[^/.]+$/, ''); // quitar extensión si ya la tiene

  switch (kind) {
    case 'page':
      return `${base}/page${ext}`;
    case 'layout':
      return `${base}/layout${ext}`;
    case 'route':
      return `${base}/route${ext}`;
    case 'api':
      return `${base}/route${ext === '.tsx' ? '.ts' : ext}`;
    case 'component':
    case 'file':
    default:
      return base + ext;
  }
}
