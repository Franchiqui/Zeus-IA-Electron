/** Página autónoma con Swagger UI (CDN) y spec incrustado (vista previa Zeus). */
export function buildSwaggerStandaloneHtml(spec: Record<string, unknown>): string {
  const json = JSON.stringify(spec)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Vista previa Swagger — Zeus</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui.css" crossorigin="anonymous"/>
  <style>
    html,body{height:100%;margin:0;display:flex;flex-direction:column;font-family:system-ui,-apple-system,sans-serif;}
    #zeus-preview-banner{flex-shrink:0;background:linear-gradient(90deg,#0f172a,#1e3a5f);color:#e2e8f0;padding:12px 18px;border-bottom:3px solid #38bdf8;font-size:14px;line-height:1.45;}
    #zeus-preview-banner strong{color:#fff;font-size:15px;display:block;margin-bottom:6px;}
    #zeus-preview-banner p{margin:0;opacity:.95;}
    #swagger-ui{flex:1;min-height:0;overflow:auto;}
  </style>
</head>
<body>
  <aside id="zeus-preview-banner" role="status">
    <strong>Vista previa de documentación (Zeus)</strong>
    <p>Esto es solo una vista previa de la especificación OpenAPI. Para usar la API de verdad: descarga el proyecto desde Zeus, ejecuta <code style="background:rgba(255,255,255,.12);padding:2px 6px;border-radius:4px;">npm install</code> y <code style="background:rgba(255,255,255,.12);padding:2px 6px;border-radius:4px;">npm start</code> en tu máquina. Las pruebas «Try it out» solo funcionarán contra un servidor que tengas en marcha (por ejemplo el puerto que indica el spec).</p>
    <p style="margin-top:10px">En cada operación POST/PUT, en «Request body» elige la pestaña <strong>application/x-www-form-urlencoded</strong> para ver <strong>un campo por cada parámetro</strong>; la pestaña <strong>application/json</strong> muestra un único editor de objeto. Las APIs generadas por Zeus incluyen <code style="background:rgba(255,255,255,.12);padding:2px 6px;border-radius:4px;">express.urlencoded</code> para aceptar ambos formatos.</p>
  </aside>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui-bundle.js" crossorigin="anonymous"></script>
  <script>
    (function(){
      var spec = ${json};
      window.onload = function(){
        SwaggerUIBundle({
          dom_id: '#swagger-ui',
          spec: spec,
          deepLinking: true,
          presets: [SwaggerUIBundle.presets.apis],
          layout: 'BaseLayout'
        });
      };
    })();
  </script>
</body>
</html>`;
}
