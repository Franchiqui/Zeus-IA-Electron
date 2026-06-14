import fs from 'fs/promises';
import path from 'path';

export type PlanAction = {
  type: 'create_file' | 'update_file' | 'create_folder';
  path: string;
  purpose?: string;
  content?: string;
  replacements?: Array<{ old: string; new: string }>;
  markers?: Array<{
    start: string;
    end: string;
    newContent: string;
    includeMarkers?: boolean;
  }>;
};

export type ApplyPlanResult = {
  applied: Array<{ action: PlanAction }>;
  errors: Array<{ action: PlanAction; error: string }>;
};

function normalizeRel(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\/+/, '');
}

/** Todas las escrituras quedan bajo projectRoot resuelto (ya validado contra DATA_PATH en la ruta API). */
function resolveUnderRoot(projectRoot: string, relPath: string): string {
  const rel = normalizeRel(relPath);
  const full = path.resolve(path.join(projectRoot, rel));
  const rootResolved = path.resolve(projectRoot);
  if (!full.startsWith(rootResolved)) {
    throw new Error('Ruta no permitida (path traversal)');
  }
  return full;
}

export async function applyPlanActions(
  actions: PlanAction[],
  options: { projectRoot: string; onlyCreate?: boolean; projectId?: string }
): Promise<ApplyPlanResult> {
  const { projectRoot, onlyCreate = false } = options;
  const applied: ApplyPlanResult['applied'] = [];
  const errors: ApplyPlanResult['errors'] = [];

  for (const action of actions) {
    if (!action?.type || !action.path) {
      errors.push({ action: action as PlanAction, error: 'Acción inválida (falta type o path)' });
      continue;
    }

    try {
      if (onlyCreate && action.type === 'update_file') {
        continue;
      }

      const fullPath = resolveUnderRoot(projectRoot, action.path);

      if (action.type === 'create_folder') {
        await fs.mkdir(fullPath, { recursive: true });
        applied.push({ action });
        continue;
      }

      if (action.type === 'create_file') {
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        const content = typeof action.content === 'string' ? action.content : '';
        await fs.writeFile(fullPath, content, 'utf8');
        applied.push({ action });
        continue;
      }

      if (action.type === 'update_file') {
        let current = '';
        try {
          current = await fs.readFile(fullPath, 'utf8');
        } catch {
          current = '';
        }

        if (Array.isArray(action.replacements) && action.replacements.length > 0) {
          let next = current;
          for (const r of action.replacements) {
            if (typeof r.old === 'string' && typeof r.new === 'string' && r.old.length > 0) {
              if (!next.includes(r.old)) {
                throw new Error(`replacement: texto "old" no encontrado en ${action.path}`);
              }
              next = next.split(r.old).join(r.new);
            }
          }
          await fs.mkdir(path.dirname(fullPath), { recursive: true });
          await fs.writeFile(fullPath, next, 'utf8');
          applied.push({ action });
          continue;
        }

        if (typeof action.content === 'string' && action.content.length > 0) {
          await fs.mkdir(path.dirname(fullPath), { recursive: true });
          await fs.writeFile(fullPath, action.content, 'utf8');
          applied.push({ action });
          continue;
        }

        errors.push({
          action,
          error: 'update_file sin replacements ni content',
        });
      }
    } catch (e) {
      errors.push({
        action,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return { applied, errors };
}
