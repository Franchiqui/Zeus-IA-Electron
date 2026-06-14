import { NextResponse } from 'next/server';
import { applyPlanActions, type PlanAction } from '@/services/planApplier';
import { resolveAllowedWorkspaceRoot } from '@/lib/env';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      actions,
      projectRoot: clientProjectRoot,
      projectId: _projectId,
      onlyCreate = true,
    } = body as {
      actions: PlanAction[];
      projectRoot?: string;
      projectId?: string;
      onlyCreate?: boolean;
    };

    if (!Array.isArray(actions)) {
      return NextResponse.json({ error: 'actions debe ser un array' }, { status: 400 });
    }

    const resolved = resolveAllowedWorkspaceRoot(clientProjectRoot || '');
    if (!resolved.ok) {
      return NextResponse.json({ error: resolved.message }, { status: resolved.status });
    }

    const definitiveProjectRoot = resolved.root;
    console.log('[apply-plan] workspaceRoot:', definitiveProjectRoot);

    const filtered = (
      onlyCreate
        ? actions.filter((a) => a && (a.type === 'create_file' || a.type === 'create_folder'))
        : actions.filter((a) => a && ['create_file', 'create_folder', 'update_file'].includes(a.type))
    ) as PlanAction[];

    const result = await applyPlanActions(filtered, {
      projectRoot: definitiveProjectRoot,
      onlyCreate,
    });

    return NextResponse.json({
      ok: true,
      result,
      projectRoot: definitiveProjectRoot,
      isLocalProject: false,
    });
  } catch (error: unknown) {
    console.error('[apply-plan] Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}