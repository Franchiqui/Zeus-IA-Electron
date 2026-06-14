import {
  buildOpenApiPreviewPayload,
  sanitizeGeneratedApiTsCode
} from '../../../src/lib/sanitizeGeneratedApiCode';

export { sanitizeGeneratedApiTsCode, buildOpenApiPreviewPayload };

/** Express: prepara especificación OpenAPI y lista de dependencias npm (vista previa Swagger). */
export async function POST_EXPRESS(req: any, res: any): Promise<void> {
  try {
    const body = req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body) ? req.body : {};
    const code = String(body.code ?? '');
    const title = String(body.title ?? 'API').trim() || 'API';
    const description = String(body.description ?? '');
    const endpoints = body.endpoints;
    const documentation = body.documentation;

    if (!code.trim()) {
      res.status(400).json({ error: 'Falta el código (campo code).' });
      return;
    }

    const payload = buildOpenApiPreviewPayload(code, title, description, endpoints, documentation);
    res.json(payload);
  } catch (e) {
    console.error('[API Server] preview-openapi:', e);
    res.status(500).json({
      error: e instanceof Error ? e.message : 'Error al generar la vista previa OpenAPI'
    });
  }
}
