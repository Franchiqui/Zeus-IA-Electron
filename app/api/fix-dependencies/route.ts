import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { execSync } from 'child_process';
import semver from 'semver';
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

interface AuditCounts {
  info?: number;
  low?: number;
  moderate?: number;
  high?: number;
  critical?: number;
  total?: number;
}

interface AuditResult {
  /** Total de vulnerabilidades (-1 si no se pudo medir). */
  total: number;
  counts: AuditCounts;
  /** Texto humano de advisories para inyectar en el prompt. */
  advisoriesText: string;
  /** ¿Hay algún advisory con fix disponible? */
  hasFixable: boolean;
}

async function fetchPackageInfo(name: string): Promise<Partial<DepInfo> | null> {
  const pack = await getPackument(name);
  if (!pack) return null;
  const latestVersionData = pack.latest ? (pack.versionData?.[pack.latest] ?? null) : null;
  return {
    latest: pack.latest,
    deprecated: latestVersionData?.deprecated ? true : false,
    description: latestVersionData?.description || '',
  };
}

// --- Cache de packuments para validar que las versiones propuestas existen ---
interface Packument {
  latest?: string;
  versions: string[]; // todas las versiones publicadas (para semver.maxSatisfying)
  versionData: Record<string, any>; // metadata por versión (deprecated, description...)
}
const packumentCache = new Map<string, Packument | null>();

async function getPackument(name: string): Promise<Packument | null> {
  if (packumentCache.has(name)) return packumentCache.get(name) ?? null;
  try {
    const res = await fetch(`${NPM_REGISTRY_URL}/${encodeURIComponent(name)}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      packumentCache.set(name, null);
      return null;
    }
    const data = await res.json();
    const versionData = (data.versions && typeof data.versions === 'object') ? data.versions : {};
    const versionList = Object.keys(versionData);
    const latest = data['dist-tags']?.latest as string | undefined;
    const pack: Packument = { latest, versions: versionList, versionData };
    packumentCache.set(name, pack);
    return pack;
  } catch {
    packumentCache.set(name, null);
    return null;
  }
}

/**
 * Comprueba si un rango declarado (dependencies, devDependencies, peerDependencies
 * u overrides) es satisfactible por alguna versión publicada en el registry.
 * Devuelve null si OK, o un mensaje describiendo el problema (incluye latest real).
 * Usa `semver.maxSatisfying` contra la lista real de versiones publicadas, así
 * detecta rangos como ^16.2.10 cuando el latest real es 16.2.9 (ninguna versión
 * satisfactoria existe).
 */
async function validateRange(
  name: string,
  range: string
): Promise<string | null> {
  const raw = String(range || '').trim();
  if (!raw || raw === '*' || raw === 'latest' || raw.startsWith('file:') || raw.startsWith('link:') || raw.startsWith('workspace:') || raw.startsWith('npm:')) {
    return null; // no validable → no bloquear
  }
  // Si no es un rango semver válido (p.ej. tag de dist-tag personalizado), no bloquear.
  if (semver.validRange(raw) === null) return null;

  const pack = await getPackument(name);
  if (!pack) return null; // no se pudo consultar registry → no bloquear (deja que npm decida)

  const match = semver.maxSatisfying(pack.versions, raw);
  if (match) return null; // existe al menos una versión que satisface el rango

  const suggestion = pack.latest ? `Usa una versión real existente, p.ej. ^${pack.latest}.` : 'Revisa el registry para una versión existente.';
  return `${name}@${raw}: NINGUNA versión publicada satisface ese rango (latest real: ${pack.latest ?? 'N/A'}). ${suggestion}`;
}

/** Recoge todos los (name, range) de dependencies, devDependencies, peerDependencies y overrides. */
function collectAllRanges(pkg: any): Array<{ name: string; range: string }> {
  const out: Array<{ name: string; range: string }> = [];
  for (const type of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const) {
    if (pkg && pkg[type] && typeof pkg[type] === 'object') {
      for (const [name, range] of Object.entries(pkg[type])) {
        out.push({ name, range: String(range) });
      }
    }
  }
  // overrides: plano {nombre: rango} o anidado {dep: {transitivo: rango}}
  const walkOverrides = (obj: any) => {
    if (!obj || typeof obj !== 'object') return;
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string') out.push({ name: k, range: v });
      else if (v && typeof v === 'object') walkOverrides(v);
    }
  };
  walkOverrides(pkg?.overrides);
  walkOverrides(pkg?.resolutions);
  return out;
}

/**
 * Valida que todas las versiones propuestas existan en el registry.
 * Devuelve { valid, problems }. Si valid=false, problems contiene mensajes
 * accionables (con la versión real latest) para inyectar como feedback.
 */
async function validateProposedVersions(pkg: any): Promise<{ valid: boolean; problems: string[] }> {
  const ranges = collectAllRanges(pkg);
  const problems: string[] = [];
  // Deduplicar por nombre+range para no repetir fetches.
  const seen = new Set<string>();
  const unique = ranges.filter((r) => {
    const key = `${r.name}@${r.range}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  // Lotes de 10 en paralelo.
  for (let i = 0; i < unique.length; i += 10) {
    const batch = unique.slice(i, i + 10);
    const results = await Promise.all(batch.map((r) => validateRange(r.name, r.range)));
    for (const msg of results) {
      if (msg) problems.push(msg);
    }
  }
  return { valid: problems.length === 0, problems };
}

/**
 * Auto-corrección: clona el package.json propuesto y, por cada rango no
 * satisfactible que tenga un `latest` conocido en el registry, lo reemplaza por
 * `^<latest>`. Devuelve { pkg, changes } con la propuesta corregida y la lista
 * de cambios aplicados. Esto permite progresar aunque el modelo insista en
 * inventar versiones (p.ej. next@^16.2.10 → ^16.2.9 cuando latest es 16.2.9).
 */
async function clampProposal(pkg: any): Promise<{ pkg: any; changes: string[] }> {
  const clone = JSON.parse(JSON.stringify(pkg));
  const changes: string[] = [];

  const ranges = collectAllRanges(clone);
  const seen = new Set<string>();
  const unique = ranges.filter((r) => {
    const key = `${r.name}@${r.range}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Construir un mapa name -> latest real (solo para los que fallan).
  const latestByName = new Map<string, string | undefined>();
  for (let i = 0; i < unique.length; i += 10) {
    const batch = unique.slice(i, i + 10);
    await Promise.all(
      batch.map(async (r) => {
        const msg = await validateRange(r.name, r.range);
        if (msg) {
          const pack = await getPackument(r.name);
          latestByName.set(r.name, pack?.latest);
        }
      })
    );
  }

  // Reemplazar en todas las secciones (incluido overrides anidado).
  const replaceIn = (container: any) => {
    if (!container || typeof container !== 'object') return;
    for (const [name, range] of Object.entries(container)) {
      if (typeof range === 'string' && latestByName.has(name)) {
        const latest = latestByName.get(name);
        if (latest) {
          container[name] = `^${latest}`;
          changes.push(`${name}: ${range} → ^${latest} (clampeado a latest real)`);
        }
      } else if (range && typeof range === 'object') {
        replaceIn(range); // overrides anidado
      }
    }
  };
  for (const type of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies', 'overrides', 'resolutions'] as const) {
    replaceIn(clone[type]);
  }

  return { pkg: clone, changes };
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

/**
 * Detecta conflictos de resolución de peerDeps/versiones generando el lockfile.
 * Devuelve null si la instalación resuelve sin conflictos, o el mensaje de error
 * (típicamente ERESOLVE) si no.
 *
 * Cuando `force` es true (la propuesta incluye `overrides`), se añade `--force`
 * para que npm escriba un lockfile aunque un override choque con un peerDep.
 * Sin `--force`, un ERESOLVE por override aborta sin generar lockfile y nos
 * impide medir el audit sobre el árbol forzado.
 */
function checkNpmConflicts(projectRoot: string, force: boolean = false): string | null {
  try {
    execSync(`npm install --package-lock-only${force ? ' --force' : ''}`, {
      cwd: projectRoot,
      stdio: 'pipe',
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      timeout: 60000,
      env: { ...process.env, NODE_ENV: 'development' },
    });
    return null;
  } catch (error: any) {
    const stderr = error.stderr?.toString() || '';
    const stdout = error.stdout?.toString() || '';
    return stderr || stdout || error.message;
  }
}

/** ¿El package.json propuesto incluye campo `overrides` (npm) o `resolutions` (yarn)? */
function hasOverrides(pkg: any): boolean {
  return !!(pkg && (pkg.overrides || pkg.resolutions));
}

/** Versión "x.y.z" simple (sin prerelease/build). */
function parseSemver(v: string): [number, number, number] | null {
  const m = String(v || '').match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/**
 * Comprueba si un rango semver (^, ~, exacto) declarado en package.json ya
 * satisface la versión `latest` del registry. Implementación mínima sin el
 * paquete `semver`. Cubre el caso especial major-0.
 */
function rangeSatisfiesLatest(version: string, latest: string): boolean {
  const lv = parseSemver(latest);
  if (!lv) return false; // latest con prerelease o raro → no marcar.
  const [lMaj, lMin, lPat] = lv;
  const raw = String(version || '').trim();

  if (raw.startsWith('^')) {
    const cv = parseSemver(raw.slice(1));
    if (!cv) return false;
    const [cMaj, cMin, cPat] = cv;
    if (lMaj !== cMaj) return false;
    if (cMaj === 0) {
      // ^0.2.0 → solo 0.2.x ; ^0.0.3 → solo 0.0.3 exacto
      if (lMin !== cMin) return false;
      if (cMin === 0 && lPat !== cPat) return false;
      if (lPat < cPat) return false;
      return true;
    }
    // ^x.y.z → >=x.y.z <(x+1).0.0
    if (lMin < cMin || (lMin === cMin && lPat < cPat)) return false;
    return true;
  }

  if (raw.startsWith('~')) {
    const cv = parseSemver(raw.slice(1));
    if (!cv) return false;
    const [cMaj, cMin] = cv;
    if (lMaj !== cMaj || lMin !== cMin) return false;
    return true;
  }

  // Exacto (incluye x, x.y, x.y.z sin operador)
  const cv = parseSemver(raw.replace(/[>=<]/g, ''));
  if (!cv) return false;
  return cv[0] === lMaj && cv[1] === lMin && cv[2] === lPat;
}

function formatFixAvailable(fa: any): string {
  if (fa === true) return 'fix disponible (sin salto major)';
  if (fa === false) return 'sin fix conocido';
  if (fa && typeof fa === 'object') {
    const major = fa.isSemVerMajor ? ' [SALTO MAJOR/breaking]' : '';
    return `fix bumpando ${fa.name}@${fa.version}${major}`;
  }
  return 'desconocido';
}

/**
 * Ejecuta `npm audit --json` y devuelve un resumen parseado.
 * npm audit (v7+) sale con código !=0 cuando hay vulnerabilidades pero
 * SIGUE emitiendo JSON válido por stdout; se captura en el catch.
 */
function runNpmAudit(projectRoot: string): AuditResult {
  let stdout = '';
  try {
    stdout = execSync('npm audit --json', {
      cwd: projectRoot,
      stdio: 'pipe',
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      timeout: 60000,
      env: { ...process.env, NODE_ENV: 'development' },
    });
  } catch (error: any) {
    // npm audit devuelve non-zero cuando hay vulns, pero el JSON va en stdout.
    stdout = error.stdout?.toString() || '';
    if (!stdout) {
      return { total: -1, counts: {}, advisoriesText: 'No se pudo ejecutar npm audit.', hasFixable: false };
    }
  }

  let data: any;
  try {
    data = JSON.parse(stdout.replace(/^﻿/, ''));
  } catch {
    return { total: -1, counts: {}, advisoriesText: 'Salida de npm audit no parseable.', hasFixable: false };
  }

  const counts: AuditCounts = data.metadata?.vulnerabilities || {};
  const total = Number(counts.total ?? -1);

  const lines: string[] = [];
  let hasFixable = false;

  // v7+: data.vulnerabilities (objeto keyed por nombre de paquete)
  if (data.vulnerabilities && typeof data.vulnerabilities === 'object') {
    for (const [pkgName, entry] of Object.entries<any>(data.vulnerabilities)) {
      const sev = entry.severity || '?';
      const range = entry.range || 'N/A';
      const fa = entry.fixAvailable;
      if (fa) hasFixable = true;
      const direct = entry.isDirect ? '[directa]' : '[transitiva]';
      lines.push(
        `- ${pkgName} ${direct}: severidad=${sev}, rango vulnerable=${range}, fixAvailable=${formatFixAvailable(fa)}`
      );
    }
  }
  // Fallback v6: data.advisories (objeto keyed por id)
  if (lines.length === 0 && data.advisories && typeof data.advisories === 'object') {
    for (const entry of Object.values<any>(data.advisories)) {
      const sev = entry.severity || '?';
      const pkgName = entry.module_name || '?';
      const range = entry.vulnerable_versions || entry.range || 'N/A';
      const fa = entry.patched_versions ? `fix=${entry.patched_versions}` : 'sin fix';
      if (entry.patched_versions) hasFixable = true;
      lines.push(`- ${pkgName}: severidad=${sev}, rango vulnerable=${range}, ${fa}`);
    }
  }

  const advisoriesText = lines.length
    ? lines.join('\n')
    : 'No se detectaron advisories detallados.';

  return { total, counts, advisoriesText, hasFixable };
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  let projectRoot = '';
  let pkgPath = '';
  let originalPkgRaw: string | undefined;
  let originalLockRaw: string | null = null;
  let lockPath = '';

  try {
    const body = await request.json();
    const { projectRoot: pr, modelConfig, packageJsonContent } = body as {
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

    if (!pr) {
      return NextResponse.json({ error: 'projectRoot es requerido' }, { status: 400 });
    }
    projectRoot = pr;
    pkgPath = path.join(projectRoot, 'package.json');
    lockPath = path.join(projectRoot, 'package-lock.json');

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

    // --- Backup del estado original (byte-exacto) ---
    originalPkgRaw = pkgRaw;
    if (await fileExists(lockPath)) {
      originalLockRaw = await fs.readFile(lockPath, 'utf8');
    }

    // Estado "aceptado" inicial = el original.
    let acceptedPkg = JSON.parse(pkgRaw);
    let acceptedLockRaw = originalLockRaw;
    let acceptedTotal = -1;

    let iteration = 0;
    const maxIterations = 5;
    let lastReport = '';
    let roundsWithoutImprovement = 0;
    let anyAccepted = false;

    // --- Baseline: escribir original, generar lock, medir audit ---
    await fs.writeFile(pkgPath, JSON.stringify(acceptedPkg, null, 2), 'utf8');
    checkNpmConflicts(projectRoot); // sincroniza el lock con el package.json original
    const baselineAudit = runNpmAudit(projectRoot);
    const baselineTotal = baselineAudit.total;
    acceptedTotal = baselineTotal;

    if (baselineTotal === 0) {
      return NextResponse.json({
        report: 'No se detectaron vulnerabilidades (npm audit: 0). Nada que corregir.',
        correctedPackageJson: acceptedPkg,
        iterationCount: 0,
        resolved: true,
        vulnerabilitiesBefore: 0,
        vulnerabilitiesAfter: 0,
        auditImproved: false,
        reverted: false,
      });
    }

    if (baselineTotal < 0) {
      // npm audit no se pudo ejecutar/parsear: no iteramos para no cambiar a ciegas.
      return NextResponse.json({
        report: `No se pudo medir npm audit en el proyecto (${baselineAudit.advisoriesText}). Verifica que package-lock.json existe y que npm está disponible. No se realizaron cambios.`,
        correctedPackageJson: acceptedPkg,
        iterationCount: 0,
        resolved: !checkNpmConflicts(projectRoot),
        vulnerabilitiesBefore: -1,
        vulnerabilitiesAfter: -1,
        auditImproved: false,
        reverted: false,
      });
    }

    // --- Bucle de corrección ---
    // Arrancamos con el audit del estado aceptado (= original) y sin feedback.
    let lastAudit: AuditResult = baselineAudit;
    let feedback = '';

    while (iteration < maxIterations && acceptedTotal > 0) {
      iteration++;

      // (1) Pedir al modelo una propuesta basada en el estado aceptado + audit real + feedback.
      const prompt = await buildPrompt(acceptedPkg, lastAudit, '', feedback);
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
            { role: 'system', content: 'Eres un experto en dependencias Node.js. Responde ÚNICAMENTE con JSON válido.' },
            { role: 'user', content: prompt },
          ],
          { temperature: 0.2, maxTokens: 4096 }
        );
      } catch (err: any) {
        console.error('[fix-dependencies] callModelGeneric falló:', err?.message);
        break;
      }
      console.log(`[fix-dependencies] Iter ${iteration}: respuesta modelo, longitud=${(aiContent || '').length}`);
      const parsed = parseModelJson(aiContent);
      if (!parsed || !parsed.correctedPackageJson) {
        console.warn(`[fix-dependencies] Iter ${iteration}: sin correctedPackageJson válido; abortando bucle.`);
        break;
      }
      let proposedPkg = parsed.correctedPackageJson;
      let proposedHasOverrides = hasOverrides(proposedPkg);

      // (1.5) Validar versiones contra el registry ANTES de instalar.
      // El modelo a veces inventa versiones que no existen (p.ej. next@^16.2.10
      // cuando el latest real es 16.2.9). Si detectamos versiones insatisfactibles,
      // intentamos auto-corregirlas clampeando a `^<latest real>` para no desperdiciar
      // la iteración; si no podemos clampear (sin latest conocido), damos feedback
      // accionable con la versión real y reintentamos.
      const versionCheck = await validateProposedVersions(proposedPkg);
      if (!versionCheck.valid) {
        const clamped = await clampProposal(proposedPkg);
        if (clamped.changes.length > 0) {
          const recheck = await validateProposedVersions(clamped.pkg);
          if (recheck.valid) {
            // Usar la propuesta auto-corregida y seguir con ella.
            proposedPkg = clamped.pkg;
            proposedHasOverrides = hasOverrides(proposedPkg);
            lastReport += `\n--- Iteración ${iteration} (versiones auto-corregidas a latest real) ---\n${clamped.changes.join('\n')}\n`;
          } else {
            feedback = `Tu propuesta anterior contiene versiones que NO EXISTEN en el registry npm:\n${versionCheck.problems.join('\n')}\nVuelve a proponer el package.json usando SOLO versiones reales existentes (usa la columna "latest" del listado o la que se indica arriba). NO inventes versiones.`;
            lastReport += `\n--- Iteración ${iteration} (RECHAZADA: versiones inexistentes) ---\n${feedback}\n`;
            roundsWithoutImprovement++;
            if (roundsWithoutImprovement >= 3) break;
            continue;
          }
        } else {
          feedback = `Tu propuesta anterior contiene versiones que NO EXISTEN en el registry npm:\n${versionCheck.problems.join('\n')}\nVuelve a proponer el package.json usando SOLO versiones reales existentes (usa la columna "latest" del listado o la que se indica arriba). NO inventes versiones.`;
          lastReport += `\n--- Iteración ${iteration} (RECHAZADA: versiones inexistentes) ---\n${feedback}\n`;
          roundsWithoutImprovement++;
          if (roundsWithoutImprovement >= 3) break;
          continue;
        }
      }

      // (2) Escribir la propuesta y comprobar conflictos de instalación (hard-gate).
      // Si la propuesta incluye `overrides`, usamos --force para que npm genere el
      // lockfile aunque un override choque con un peerDep (si no, ERESOLVE aborta y
      // no podríamos medir el audit sobre el árbol forzado).
      await fs.writeFile(pkgPath, JSON.stringify(proposedPkg, null, 2), 'utf8');
      const conflictError = checkNpmConflicts(projectRoot, proposedHasOverrides);
      if (conflictError) {
        const errText = conflictError.slice(0, 800);
        const etargetMatch = conflictError.match(/No matching version found for\s+(?:@?[^@\s]+@)?([^\s.]+)/i);
        const isEtarget = /ETARGET|notarget|No matching version/i.test(conflictError);
        const hint = isEtarget
          ? `Una de las versiones que propones no existe en el registry (ETARGET)${etargetMatch ? `: ${etargetMatch[0].split('found for ')[1]}` : ''}. NO inventes versiones; usa exactamente la de fixAvailable o la del latest del listado.`
          : proposedHasOverrides
            ? 'Tu `overrides` choca con peerDeps (ERESOLVE). Ajusta las versiones del override o usa la forma anidada para acotarlo a la dependencia directa que lo requiere.'
            : 'Reintenta sin introducir peerDeps incompatibles.';
        feedback = `Tu propuesta anterior rompe la resolución de dependencias:\n${errText}\n${hint}`;
        lastReport += `\n--- Iteración ${iteration} (RECHAZADA: conflicto de instalación) ---\n${feedback}\n`;
        await fs.writeFile(pkgPath, JSON.stringify(acceptedPkg, null, 2), 'utf8');
        if (acceptedLockRaw !== null) await fs.writeFile(lockPath, acceptedLockRaw, 'utf8');
        checkNpmConflicts(projectRoot, hasOverrides(acceptedPkg)); // re-sincronizar lock con el aceptado
        roundsWithoutImprovement++;
        if (roundsWithoutImprovement >= 3) break;
        continue;
      }

      // (3) Sin conflictos: medir audit sobre el árbol resuelto por la propuesta.
      const newAudit = runNpmAudit(projectRoot);
      const newTotal = newAudit.total;
      const improved = newTotal >= 0 && (acceptedTotal < 0 || newTotal < acceptedTotal);

      if (!improved) {
        // No mejora estrictamente: revertir y dar feedback para reintentar.
        feedback = `Tu propuesta anterior NO redujo el total de vulnerabilidades (${acceptedTotal}→${newTotal}). Advisories actuales del audit:\n${newAudit.advisoriesText.slice(0, 1200)}\nAplica los fixAvailable indicados y, para transitivas sin fix en la dependencia directa, añade un \`overrides\` con la versión parcheada. No subas a latest a ciegas.`;
        lastReport += `\n--- Iteración ${iteration} (RECHAZADA: no mejora el audit ${acceptedTotal}→${newTotal}) ---\n${feedback}\n`;
        await fs.writeFile(pkgPath, JSON.stringify(acceptedPkg, null, 2), 'utf8');
        if (acceptedLockRaw !== null) await fs.writeFile(lockPath, acceptedLockRaw, 'utf8');
        checkNpmConflicts(projectRoot, hasOverrides(acceptedPkg));
        roundsWithoutImprovement++;
        if (roundsWithoutImprovement >= 3) break;
        continue;
      }

      // (4) Aceptado: guardar estado aceptado y su lock.
      acceptedPkg = proposedPkg;
      acceptedLockRaw = (await fileExists(lockPath)) ? await fs.readFile(lockPath, 'utf8') : acceptedLockRaw;
      acceptedTotal = newTotal;
      roundsWithoutImprovement = 0;
      lastAudit = newAudit;
      feedback = '';
      anyAccepted = true;
      lastReport += `\n--- Iteración ${iteration} (aceptada, audit ${baselineTotal}→${acceptedTotal}) ---\n${parsed.report || 'Sin informe'}\n`;
      if (acceptedTotal === 0) break;
    }

    // --- Safety final: nunca dejar el proyecto peor que al inicio ---
    let finalAudit = runNpmAudit(projectRoot);
    let finalTotal = finalAudit.total;
    let reverted = false;

    if (finalTotal < 0) {
      finalTotal = acceptedTotal; // no medible: conservar el último aceptado.
    }

    if (finalTotal > baselineTotal) {
      // Empeoró: restaurar original.
      await fs.writeFile(pkgPath, originalPkgRaw!, 'utf8');
      if (originalLockRaw !== null) await fs.writeFile(lockPath, originalLockRaw, 'utf8');
      else if (await fileExists(lockPath)) await fs.rm(lockPath);
      checkNpmConflicts(projectRoot);
      finalAudit = runNpmAudit(projectRoot);
      finalTotal = finalAudit.total >= 0 ? finalAudit.total : baselineTotal;
      reverted = true;
      lastReport += `\n--- REVERTIDO ---\nLa corrección empeoraba el audit (${baselineTotal}→${finalTotal}). Se ha restaurado el package.json y el package-lock.json originales.\n`;
      acceptedPkg = JSON.parse(originalPkgRaw!);
    } else if (!anyAccepted) {
      // No se aceptó ninguna propuesta (sin mejora): dejar el archivo original intacto.
      await fs.writeFile(pkgPath, originalPkgRaw!, 'utf8');
      if (originalLockRaw !== null) await fs.writeFile(lockPath, originalLockRaw, 'utf8');
      else if (await fileExists(lockPath)) await fs.rm(lockPath);
      checkNpmConflicts(projectRoot);
    }

    // Si el estado final en disco es el aceptado (con overrides), re-chequear con --force
    // para no falsar un ERESOLVE que ya se resolvió durante el bucle.
    const finalForce = !reverted && anyAccepted && hasOverrides(acceptedPkg);
    const finalConflicts = checkNpmConflicts(projectRoot, finalForce);
    const resolved = !finalConflicts && finalTotal <= baselineTotal;

    return NextResponse.json({
      report: lastReport || 'No se realizaron cambios o no se pudieron reducir las vulnerabilidades.',
      correctedPackageJson: acceptedPkg,
      iterationCount: iteration,
      resolved,
      vulnerabilitiesBefore: baselineTotal,
      vulnerabilitiesAfter: finalTotal,
      auditImproved: finalTotal < baselineTotal,
      reverted,
    });
  } catch (error: any) {
    console.error('[fix-dependencies] Error:', error);
    // Restaurar el original ante cualquier fallo inesperado.
    try {
      if (originalPkgRaw && projectRoot) {
        await fs.writeFile(pkgPath, originalPkgRaw, 'utf8');
        if (originalLockRaw !== null) await fs.writeFile(lockPath, originalLockRaw, 'utf8');
        else if (lockPath && (await fileExists(lockPath))) await fs.rm(lockPath);
        checkNpmConflicts(projectRoot);
      }
    } catch (restoreErr) {
      console.error('[fix-dependencies] Fallo al restaurar el original:', restoreErr);
    }
    return NextResponse.json(
      {
        error: (error?.message || 'Error desconocido') + ' — package.json restaurado al estado original.',
        reverted: true,
      },
      { status: 500 }
    );
  }
}

/** Construye el prompt para el modelo a partir del audit real y el package.json. */
async function buildPrompt(
  pkg: any,
  audit: AuditResult,
  _conflicts: string,
  feedback: string
): Promise<string> {
  // depsList informativo (secundario); el audit es la señal principal.
  const deps = getDeps(pkg);
  // Paralelizar fetch del registry en lotes de 10 (solo para info de latest/deprecated).
  const batches: DepInfo[][] = [];
  for (let i = 0; i < deps.length; i += 10) batches.push(deps.slice(i, i + 10) as DepInfo[]);
  const depInfos: DepInfo[] = [];
  for (const batch of batches) {
    const infos = await Promise.all(
      batch.map(async (d) => {
        const info = await fetchPackageInfo(d.name);
        return { ...d, latest: info?.latest, deprecated: info?.deprecated, description: info?.description };
      })
    );
    depInfos.push(...infos);
  }

  const depsList = depInfos
    .map((d) => {
      const satisfied = d.latest ? rangeSatisfiesLatest(d.version, d.latest) : true;
      const flags = [
        !satisfied ? '[DESACTUALIZADO]' : '',
        d.deprecated ? '[DESCATALOGADO]' : '',
      ]
        .filter(Boolean)
        .join(' ');
      return `- ${d.name}: ${d.version} (latest: ${d.latest || 'N/A'}) ${flags}`.trim();
    })
    .join('\n');

  return `Eres un experto en seguridad y gestión de dependencias Node.js.
Tu tarea es reducir las vulnerabilidades del siguiente package.json usando EXCLUSIVAMENTE la información real de \`npm audit\`.

ADVISORIES REALES DE npm audit (severidad, rango vulnerable, fixAvailable):
${audit.advisoriesText}

${feedback ? `FEEDBACK DE ITERACIONES ANTERIORES:\n${feedback}\n\n` : ''}INFORMACIÓN DE VERSIONES (informativa, solo marca [DESACTUALIZADO] si el rango declarado NO satisface latest):
${depsList}

PACKAGE.JSON ACTUAL:
\`\`\`json
${JSON.stringify(pkg, null, 2)}
\`\`\`

OBJETIVOS:
1. Reducir el número total de vulnerabilidades usando los fixAvailable del audit.
2. Mantener el package.json instalable sin conflictos de peerDeps.

REGLAS OBLIGATORIAS:
- CRÍTICO: NO INVENTES VERSIONES. Toda versión que escribas (en dependencies, devDependencies, peerDependencies u overrides) DEBE existir en el registry npm. Usa EXACTAMENTE la versión indicada en \`fixAvailable\` del audit, o la versión real mostrada en la columna \`latest\` del listado de versiones. Nunca propongas una versión mayor que el \`latest\` real mostrado.
- NO subas dependencias a \`latest\` a ciegas. Aplica cambios SOLO si el audit los justifica.
- Si fixAvailable es \`true\` o un objeto con \`isSemVerMajor: false\`, aplica esa versión (es segura).
- Si fixAvailable es un objeto con \`isSemVerMajor: true\`, propón el bump SOLO si la severidad es high o critical, y explica el impacto. En caso contrario, deja la dependencia como está.
- Recuerda: fixAvailable puede indicar bumpear un paquete DISTINTO del vulnerable (ej. una vuln de una transitiva se arregla actualizando una dependencia directa). Respeta el campo \`name\` y \`version\` de fixAvailable; usa esa versión exacta.
- Prioriza parches/minor dentro del rango existente antes que saltos de major.
- Puedes ajustar rangos de dependencies, devDependencies y peerDependencies. No añadas ni elimines paquetes de esas secciones.
- USO DE \`overrides\` (CLAVE PARA LLEGAR A 0): para vulnerabilidades TRANSITIVAS que no se resuelven bumpando la dependencia directa (sin fixAvailable viable, o el bump es salto major), AÑADE un campo \`overrides\` a la raíz del package.json forzando la versión parcheada de la transitiva. Ejemplo:
    "overrides": { "paquete-vulnerable-transitivo": "^1.2.4" }
  Esto NO cuenta como "añadir un paquete" a dependencies; es el mecanismo estándar de npm para fijar transitivas y es la forma habitual de llevar el audit a 0. Úsalo siempre que el audit justifique fijar una transitiva.
  - Si la transitiva vulnerable se alcanza solo bajo una dependencia concreta, usa la forma anidada: "overrides": { "dep-directa": { "paquete-transitivo": "^1.2.4" } }.
  - Prefiere la versión parcheada más baja que cierre el advisory (mira el rango vulnerable y fixAvailable del audit). Usa la versión exacta de fixAvailable cuando exista.
  - Puedes añadir \`overrides\` aunque no existiera antes en el package.json.
  - Si no conoces la versión parcheada real de una transitiva, deja ese override fuera en lugar de inventar una versión.
- \`overrides\` puede chocar con peerDeps y provocar ERESOLVE; el sistema lo resolverá con \`--force\` para poder medir el audit. Aun así, si un override es incompatible, se te notificará como feedback para ajustarlo.
- Responde ÚNICAMENTE con un objeto JSON válido.

FORMATO DE RESPUESTA:
{
  "report": "Informe de cambios realizados y por qué reducen las vulnerabilidades.",
  "correctedPackageJson": { ...package.json corregido completo, incluyendo \"overrides\" si aplica... }
}`;
}

/**
 * Extrae y parsea el JSON devuelto por el modelo. Tolera:
 *  - bloques ```json ... ```
 *  - texto/prosa alrededor del objeto
 *  - JSON truncado (devuelve null, pero registra un log para diagnosticar)
 * Devuelve null si no encuentra un objeto JSON válido con correctedPackageJson.
 */
function parseModelJson(aiContent: string): { report?: string; correctedPackageJson?: any } | null {
  const raw = (aiContent || '').trim();
  if (!raw) {
    console.warn('[fix-dependencies] El modelo devolvió contenido vacío.');
    return null;
  }

  // 1) Bloque ```json ... ``` (o ``` a secas).
  const fenceMatch = raw.match(/```(?:json)?\n?([\s\S]*?)\n?```/);
  const candidates: string[] = [];
  if (fenceMatch) candidates.push(fenceMatch[1].trim());
  candidates.push(raw);

  for (const candidate of candidates) {
    // 2) Parseo directo.
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && parsed.correctedPackageJson) return parsed;
    } catch {
      // seguir intentando
    }
    // 3) Parseo lenient: recortar entre la primera '{' y la última '}' balanceando
    //    llaves (ignorando strings) para no caer en la primera llave de un bloque.
    const obj = extractLargestJsonObject(candidate);
    if (obj) {
      try {
        const parsed = JSON.parse(obj);
        if (parsed && parsed.correctedPackageJson) return parsed;
      } catch (e: any) {
        console.warn(
          '[fix-dependencies] JSON lenient no parseó. Longitud recorte:',
          obj.length,
          'Error:',
          e?.message
        );
      }
    }
  }

  // Diagnóstico: nada parseó. Mostrar principio y fin de la respuesta.
  console.warn(
    '[fix-dependencies] No se pudo extraer JSON válido de la respuesta del modelo. ' +
      `Longitud total: ${raw.length}. Inicio: ${raw.slice(0, 300)} ... Fin: ${raw.slice(-300)}`
  );
  return null;
}

/**
 * Recorta el mayor objeto JSON top-level balanceando llaves y respetando
 * strings/escapes. Devuelve el substring o null si no encuentra un objeto que
 * empiece y termine balanceado.
 */
function extractLargestJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  // Desbalanceado (probable truncación): devolver lo que haya desde '{' al final.
  return text.slice(start);
}