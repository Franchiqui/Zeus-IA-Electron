import JSZip from 'jszip';
import { mergeOptionalDependenciesFromApiCode, sanitizeGeneratedApiTsCode } from '../../src/lib/sanitizeGeneratedApiCode';
import { isZeusCentralPanelInVsCode, requestSaveZipFromExtension } from './zeusApi';

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      const i = dataUrl.indexOf(',');
      resolve(i >= 0 ? dataUrl.slice(i + 1) : dataUrl);
    };
    reader.onerror = () => reject(reader.error ?? new Error('FileReader'));
    reader.readAsDataURL(blob);
  });
}

export type ZeusProjectExportInput = {
  title: string;
  description: string;
  code: string;
  documentation: string;
  schemas: string;
  endpoints: unknown;
};

function safeEndpointsJson(endpoints: unknown): string {
  if (endpoints === undefined || endpoints === null) return '[]';
  if (typeof endpoints === 'string') {
    try {
      return JSON.stringify(JSON.parse(endpoints || '[]'), null, 2);
    } catch {
      return JSON.stringify(endpoints, null, 2);
    }
  }
  return JSON.stringify(endpoints, null, 2);
}

/**
 * ZIP con código, docs, esquemas, endpoints y proyecto Node listo para `npm install` + `npm start`.
 */
export async function downloadZeusProjectZip(input: ZeusProjectExportInput): Promise<void> {
  const title = input.title.trim() || 'zeus-api';
  const slug = title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') || 'zeus-api';

  const packageJson = {
    name: slug,
    version: '1.0.0',
    description: input.description || 'API generada con Zeus',
    main: 'api.ts',
    scripts: {
      start: 'ts-node api.ts',
      dev: 'ts-node-dev --respawn api.ts',
      build: 'tsc'
    },
    dependencies: {
      express: '^4.18.2',
      zod: '^3.22.4',
      pocketbase: '^0.21.1',
      'swagger-ui-express': '^5.0.0',
      'swagger-jsdoc': '^6.2.8',
      cors: '^2.8.5',
      dotenv: '^16.3.1'
    },
    devDependencies: {
      '@types/express': '^4.17.21',
      '@types/swagger-ui-express': '^4.1.6',
      '@types/swagger-jsdoc': '^6.0.4',
      '@types/cors': '^2.8.17',
      '@types/node': '^20.10.5',
      'ts-node': '^10.9.2',
      'ts-node-dev': '^2.0.0',
      typescript: '^5.3.3'
    }
  } as {
    name: string;
    version: string;
    description: string;
    main: string;
    scripts: Record<string, string>;
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  };

  const tsConfig = {
    compilerOptions: {
      target: 'ES2020',
      module: 'CommonJS',
      lib: ['ES2020'],
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      forceConsistentCasingInFileNames: true,
      outDir: './dist'
    },
    include: ['*.ts'],
    exclude: ['node_modules', 'dist']
  };

  const rawCode = input.code.trim();
  const codeBody = rawCode
    ? sanitizeGeneratedApiTsCode(rawCode, title, input.description || '', input.endpoints, input.documentation)
    : '// Añade aquí el código de la API generada.\n';

  mergeOptionalDependenciesFromApiCode(codeBody, packageJson.dependencies, packageJson.devDependencies);
  const schemasBody = input.schemas.trim() || '// Esquemas Zod (exporta desde api.ts o impórtalos aquí).\n';
  const docsBody =
    input.documentation.trim() ||
    `# ${title}\n\n${input.description || 'Sin descripción.'}\n`;

  const readme = [
    `# ${title}`,
    '',
    input.description || 'API generada con Zeus.',
    '',
    '## Requisitos',
    '',
    '- Node.js 18+',
    '',
    '## Instalación',
    '',
    '```bash',
    'npm install',
    '```',
    '',
    '## Ejecución',
    '',
    '```bash',
    'npm run dev',
    '```',
    '',
    'o',
    '',
    '```bash',
    'npm start',
    '```',
    '',
    'Por defecto el servidor usa el puerto definido en tu código (suele ser 3000). Si incluye Swagger, prueba http://localhost:8741/api-docs según tu api.ts.',
    '',
    '## Archivos',
    '',
    '| Archivo | Contenido |',
    '|--------|------------|',
    '| api.ts | Código principal de la API |',
    '| schemas.ts | Esquemas Zod exportados |',
    '| documentation.md | Documentación OpenAPI / notas |',
    '| endpoints.json | Metadatos de endpoints (JSON) |',
    ''
  ].join('\n');

  const zip = new JSZip();
  zip.file('package.json', JSON.stringify(packageJson, null, 2));
  zip.file('tsconfig.json', JSON.stringify(tsConfig, null, 2));
  zip.file('README.md', readme);
  zip.file('api.ts', codeBody);
  zip.file('schemas.ts', schemasBody);
  zip.file('documentation.md', docsBody);
  zip.file('endpoints.json', safeEndpointsJson(input.endpoints));
  zip.file(
    '.env.example',
    'PORT=3000\n# POCKETBASE_URL=http://localhost:8090\n'
  );

  const filename = `${slug}-api-project.zip`;
  const blob = await zip.generateAsync({ type: 'blob' });

  if (isZeusCentralPanelInVsCode()) {
    const base64 = await blobToBase64(blob);
    const result = await requestSaveZipFromExtension(filename, base64);
    if (result.cancelled) return;
    if (result.error) throw new Error(result.error);
    return;
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
