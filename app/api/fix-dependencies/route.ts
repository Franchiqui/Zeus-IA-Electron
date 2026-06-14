import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { execSync } from 'child_process';
import { callModelGeneric } from '@/api/zeus-model-api/generic-model-call';

const NPM_REGISTRY_URL = 'https://registry.npmjs.org';

interface DepInfo {
  name: string;
  version: string;
  type: 'dependencies' | 'devDependencies' | 'peerDependencies';
  latest?: string;
  deprecated?: boolean;
  description?: string;
}

async function fetchPackageInfo(name: string): Promise<Partial<DepInfo> | null> {
  try {
    const res = await fetch(`${NPM_REGISTRY_URL}/${encodeURIComponent(name)}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const latest = data['dist-tags']?.latest as string | undefined;
    const versionData = latest ? data.versions?.[latest] : null;
    return {
      latest,
      deprecated: versionData?.deprecated ? true : false,
      description: versionData?.description || '',
    };
  } catch {
    return null;
  }
}

function getDeps(pkg: any): Omit<DepInfo, 'latest' | 'deprecated' | 'description'>[] {
  const deps: Omit<DepInfo, 'latest' | 'deprecated' | 'description'>[] = [];
  for (const type of ['dependencies', 'devDependencies', 'peerDependencies'] as const) {
    if (pkg[type] && typeof pkg[type] === 'object') {
      for (const [name, version] of Object.entries(pkg[type])) {
        deps.push({ name, version: String(version), type });
      }
    }
  }
  return deps;
}

function checkNpmConflicts(projectRoot: string): string | null {
  try {
    // Intentamos generar el lockfile para ver si hay conflictos de resolución
    execSync('npm install --package-lock-only', {
      cwd: projectRoot,
      stdio: 'pipe',
      env: { ...process.env, NODE_ENV: 'development' }
    });
    return null;
  } catch (error: any) {
    const stderr = error.stderr?.toString() || '';
    const stdout = error.stdout?.toString() || '';
    return stderr || stdout || error.message;
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { projectRoot, modelConfig, packageJsonContent } = body as {
      projectRoot?: string;
      modelConfig?: { 
        url?: string; 
        baseURL?: string; 
        apiKey?: string; 
        model?: string; 
        id?: string; 
        name?: string;
        provider?: string;
      };
      packageJsonContent?: string;
    };

    if (!projectRoot) {
      return NextResponse.json({ error: 'projectRoot es requerido' }, { status: 400 });
    }

    const pkgPath = path.join(projectRoot, 'package.json');
    let pkgRaw = packageJsonContent;

    if (!pkgRaw) {
      try {
        pkgRaw = await fs.readFile(pkgPath, 'utf8');
      } catch {
        return NextResponse.json(
          { error: 'No se encontró package.json en el proyecto' },
          { status: 404 }
        );
      }
    }

    let currentPkg = JSON.parse(pkgRaw!);
    let iteration = 0;
    const maxIterations = 3;
    let lastReport = '';
    let conflicts = '';

    while (iteration < maxIterations) {
      iteration++;
      
      // Escribir el package.json actual temporalmente para que npm lo analice
      await fs.writeFile(pkgPath, JSON.stringify(currentPkg, null, 2));
      
      const conflictError = checkNpmConflicts(projectRoot);
      if (!conflictError) {
        if (iteration === 1) {
          // Si no hay conflictos en la primera iteración, seguimos con el análisis normal de actualizaciones
          conflicts = 'No se detectaron conflictos inmediatos de resolución.';
        } else {
          // Si logramos resolver los conflictos, terminamos
          break;
        }
      } else {
        conflicts = conflictError;
      }

      const deps = getDeps(currentPkg);
      const depInfos: DepInfo[] = [];
      for (const dep of deps) {
        const info = await fetchPackageInfo(dep.name);
        depInfos.push({
          ...dep,
          latest: info?.latest,
          deprecated: info?.deprecated,
          description: info?.description,
        });
      }

      const outdated = depInfos.filter((d) => {
        if (!d.latest) return false;
        const cleanCurrent = d.version.replace(/^[\^~]/, '');
        return cleanCurrent !== d.latest;
      });

      const depsList = depInfos
        .map((d) => {
          const isOutdated = outdated.some((o) => o.name === d.name);
          const isDeprecated = d.deprecated;
          const flags = [
            isOutdated ? '[DESACTUALIZADO]' : '',
            isDeprecated ? '[DESCATALOGADO]' : '',
          ]
            .filter(Boolean)
            .join(' ');
          return `- ${d.name}: ${d.version} (latest: ${d.latest || 'N/A'}) ${flags}`.trim();
        })
        .join('\n');

      const prompt = `Eres un experto en seguridad y gestión de dependencias Node.js.

Tu tarea es analizar el siguiente package.json y resolver los conflictos de dependencias detectados.

ERRORES DE CONFLICTO (npm install):
${conflicts}

INFORMACIÓN DE VERSIONES ACTUALES:
${depsList}

PACKAGE.JSON ACTUAL:
\`\`\`json
${JSON.stringify(currentPkg, null, 2)}
\`\`\`

OBJETIVOS:
1. Resolver los conflictos de peerDependencies o versiones incompatibles mostrados en los errores.
2. Actualizar dependencias vulnerables o descatalogadas.
3. Generar un package.json corregido que sea instalable sin errores.

REGLAS OBLIGATORIAS:
- Solo ajusta los rangos de versión de dependencies, devDependencies y peerDependencies.
- Prioriza versiones estables.
- Si un conflicto requiere bajar la versión de un paquete para que sea compatible con otro, hazlo.
- Responde ÚNICAMENTE con un objeto JSON válido.

FORMATO DE RESPUESTA:
{
  "report": "Informe de cambios realizados en esta iteración y por qué resuelven los conflictos.",
  "correctedPackageJson": { ...objeto package.json corregido completo... }
}`;

      let aiContent: string;
      try {
        aiContent = await callModelGeneric(
          {
            provider: modelConfig?.provider || 'openai',
            model: modelConfig?.model || 'gpt-4o',
            url: modelConfig?.url || modelConfig?.baseURL || 'http://localhost:1234/v1/chat/completions',
            apiKey: modelConfig?.apiKey,
          },
          [
            {
              role: 'system',
              content: 'Eres un experto en dependencias Node.js. Responde ÚNICAMENTE con JSON válido.',
            },
            { role: 'user', content: prompt },
          ],
          { temperature: 0.2 }
        );
      } catch {
        break;
      }
      let jsonContent = aiContent.trim();
      const jsonMatch = jsonContent.match(/```(?:json)?\n?([\s\S]*?)\n?```/);
      if (jsonMatch) jsonContent = jsonMatch[1];

      try {
        const parsed = JSON.parse(jsonContent);
        currentPkg = parsed.correctedPackageJson || currentPkg;
        lastReport += `\n--- Iteración ${iteration} ---\n${parsed.report || 'Sin informe'}\n`;
        
        // Si no había conflictos reales y solo era análisis de actualizaciones, terminamos tras la primera vuelta
        if (!conflictError && iteration === 1) break;
      } catch {
        break;
      }
    }

    // Devolver el resultado final
    return NextResponse.json({
      report: lastReport || 'No se realizaron cambios o no se pudieron resolver los conflictos.',
      correctedPackageJson: currentPkg,
      iterationCount: iteration,
      resolved: !checkNpmConflicts(projectRoot)
    });
  } catch (error: any) {
    console.error('[fix-dependencies] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Error desconocido' },
      { status: 500 }
    );
  }
}

