import { NextResponse } from 'next/server';
import { Readable } from 'stream';
import { StorageModelConfig, getModelsForUser } from '@/api/utils';
import { promises as fs } from 'fs';
import * as fsSync from 'fs';
import path from 'path';
import { mkdir } from 'fs/promises';
import os from 'os';
import archiver from 'archiver';
import { getPocketBase } from '@/lib/pocketbase';
import { UsageService } from '@/api/utils';
import { initPocketBase, isPocketBaseInitialized } from '@/api/lib/pocketbaseForGenerateApi';

function escapeJsonString(str: string): string {
  return str
    .replace(/\\/g, '\\\\')  // Escape backslashes
    .replace(/"/g, '\\"')    // Escape double quotes
    .replace(/\n/g, '\\n')    // Escape newlines
    .replace(/\r/g, '\\r')    // Escape carriage returns
    .replace(/\t/g, '\\t');    // Escape tabs
}

// Function to derive search query from project description
function deriveImageQueryFromDescription(description: string): string {
  const desc = description.toLowerCase();
  
  // Map keywords to specific image categories
  const categoryMap: Array<{ pattern: RegExp; query: string }> = [
    { pattern: /(naturaleza|bosque|montañ|playa|mar|paisaje|nature|forest|mountain|beach|sea)/i, query: 'nature landscape' },
    { pattern: /(tecnolog|ti|software|código|program|startup|tech|code|developer|móvil|mobile|app)/i, query: 'technology mobile' },
    { pattern: /(negocio|empresa|finanzas|oficina|business|finance|office)/i, query: 'business professional' },
    { pattern: /(comida|restaurante|food|cooking|dish|meal|chef)/i, query: 'food restaurant' },
    { pattern: /(viaje|travel|turismo|city|ciudad|destino)/i, query: 'travel city' },
    { pattern: /(deporte|sport|fitness|gym|ejercicio)/i, query: 'sports fitness' },
    { pattern: /(salud|health|medical|wellness|hospital)/i, query: 'health wellness' },
    { pattern: /(educación|education|school|learning|estudiante)/i, query: 'education learning' },
    { pattern: /(moda|fashion|ropa|clothing|style)/i, query: 'fashion style' },
    { pattern: /(arte|art|diseño|design|creativ)/i, query: 'art design' },
    { pattern: /(música|music|concierto|concert|instrument)/i, query: 'music concert' },
  ];
  
  // Find matching category
  for (const { pattern, query } of categoryMap) {
    if (pattern.test(desc)) {
      return query;
    }
  }
  
  // Extract meaningful keywords from description
  const stopWords = new Set([
    'de', 'la', 'el', 'los', 'las', 'un', 'una', 'unos', 'unas', 'y', 'o', 'u', 
    'en', 'para', 'por', 'con', 'sin', 'del', 'al', 'a', 'que', 'como', 'es', 
    'son', 'app', 'aplicacion', 'aplicación', 'móvil', 'mobile'
  ]);
  
  const words = desc.split(/[^a-záéíóúñü0-9]+/i)
    .filter(word => word.length > 3 && !stopWords.has(word))
    .slice(0, 3);
  
  return words.length > 0 ? words.join(' ') : 'mobile app';
}

// Function to fetch images from Unsplash API dynamically
async function fetchUnsplashImages(count: number = 6, description?: string): Promise<string[]> {
  try {
    const accessKey = process.env.UNSPLASH_ACCESS_KEY;
    if (!accessKey) {
      console.warn('⚠️ UNSPLASH_ACCESS_KEY no configurada, usando imágenes de fallback');
      return getFallbackImages(count);
    }

    // Derive search query from description or use default
    const searchQuery = description 
      ? deriveImageQueryFromDescription(description)
      : 'mobile app';
    
    const url = `https://api.unsplash.com/photos/random?query=${encodeURIComponent(searchQuery)}&count=${count}&orientation=portrait`;
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `Client-ID ${accessKey}`,
        'Accept-Version': 'v1'
      },
      next: { revalidate: 3600 } // Cache por 1 hora
    });

    if (!response.ok) {
      console.warn(`⚠️ Error en Unsplash API (${response.status}), usando fallback`);
      return getFallbackImages(count);
    }

    const data = await response.json();
    const images = Array.isArray(data) ? data : [data];
    
    const imageUrls = images.map((img: any) => {
      // Usar URL con parámetros de tamaño optimizado para móvil
      const url = img?.urls?.regular || img?.urls?.small;
      return url ? `${url}&w=300&h=400&fit=crop` : null;
    }).filter((url): url is string => url !== null);

    console.log(`✅ ${imageUrls.length} imágenes obtenidas de Unsplash (query: "${searchQuery}")`);
    
    return imageUrls.length > 0 ? imageUrls : getFallbackImages(count);
  } catch (error) {
    console.error('❌ Error fetching Unsplash images:', error);
    return getFallbackImages(count);
  }
}

// Function to get fallback images when Unsplash is not available
function getFallbackImages(count: number = 6): string[] {
  const fallbackImages = [
    'https://images.unsplash.com/photo-1512941937669-90a1b58e7e9c?w=300&h=400&fit=crop',
    'https://images.unsplash.com/photo-1551650975-87deedd944c3?w=300&h=400&fit=crop',
    'https://images.unsplash.com/photo-1556656793-08538906a9f8?w=300&h=400&fit=crop',
    'https://images.unsplash.com/photo-1526498460520-4c246339dccb?w=300&h=400&fit=crop',
    'https://images.unsplash.com/photo-1563986768609-322da13575f3?w=300&h=400&fit=crop',
    'https://images.unsplash.com/photo-1551650975-87deedd944c3?w=300&h=400&fit=crop',
    'https://images.unsplash.com/photo-1607252650355-f7fd0460ccdb?w=300&h=400&fit=crop',
    'https://images.unsplash.com/photo-1611162617474-5b21e879e113?w=300&h=400&fit=crop'
  ];
  
  return fallbackImages.slice(0, count);
}

// Normaliza los archivos Gradle a plantilla moderna tras cap sync
async function ensureModernAndroidTemplate(basePath: string, appName: string) {
  const sanitized = appName.toLowerCase().replace(/[^a-z0-9]/g, '');
  const appId = `com.zeus.${sanitized}`;
  const androidDir = path.join(basePath, 'android');
  const appDir = path.join(androidDir, 'app');

  try {
    await fs.mkdir(appDir, { recursive: true });

    // settings.gradle con repos y pluginManagement
    const settingsGradle = `pluginManagement {\n    repositories {\n        google()\n        mavenCentral()\n        gradlePluginPortal()\n    }\n    plugins {\n        id 'com.android.application' version '8.5.2' apply false\n        // id 'com.google.gms.google-services' version '4.4.2' apply false // solo si se usa Firebase\n    }\n}\n\ndependencyResolutionManagement {\n    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)\n    repositories {\n        google()\n        mavenCentral()\n    }\n}\n\nrootProject.name = '${appName}'\ninclude ':app'\n`;
    await fs.writeFile(path.join(androidDir, 'settings.gradle'), settingsGradle, 'utf8');

    // build.gradle raíz minimalista
    const rootBuildGradle = `// Top-level build file (AGP 8+). Repos en settings.gradle\n\ntasks.register('clean', Delete) {\n    delete rootProject.buildDir\n}\n`;
    await fs.writeFile(path.join(androidDir, 'build.gradle'), rootBuildGradle, 'utf8');

    // app/build.gradle usando plugins DSL sin classpath
    const appBuildGradle = `plugins {\n    id 'com.android.application'\n}\n\nandroid {\n    namespace '${appId}'\n    compileSdk 34\n\n    defaultConfig {\n        applicationId '${appId}'\n        minSdkVersion 22\n        targetSdkVersion 34\n        versionCode 1\n        versionName '1.0'\n    }\n\n    compileOptions {\n        sourceCompatibility JavaVersion.VERSION_17\n        targetCompatibility JavaVersion.VERSION_17\n    }\n\n    packagingOptions {\n        resources {\n            excludes += ['/META-INF/{AL2.0,LGPL2.1}']\n        }\n    }\n}\n\ndependencies {\n    implementation 'com.capacitorjs:core:5.+'\n}\n\napply from: 'capacitor.build.gradle'\n\n// Apply Google Services plugin only if google-services.json is present\nif (file('google-services.json').exists() || file('src/debug/google-services.json').exists() || file('src/release/google-services.json').exists()) {\n    apply plugin: 'com.google.gms.google-services'\n}\n`;
    const appBuildPath = path.join(appDir, 'build.gradle');
    await fs.writeFile(appBuildPath, appBuildGradle, 'utf8');

    // Sanitización adicional defensiva por si algún proceso externo alteró el archivo
    try {
      await sanitizeAppBuildGradle(appBuildPath);
    } catch (sanErr) {
      console.warn('ensureModernAndroidTemplate: sanitizeAppBuildGradle failed:', (sanErr as any)?.message);
    }
  } catch (e) {
    console.warn('ensureModernAndroidTemplate: no se pudo normalizar Gradle:', (e as any)?.message);
  }
}

// Limpia patrones problemáticos en android/app/build.gradle (defensivo)
async function sanitizeAppBuildGradle(gradlePath: string) {
  try {
    let content = await fs.readFile(gradlePath, 'utf8');

    // 1) Eliminar llaves de cierre sueltas justo antes de dependencies { ... }
    //    Caso típico: android { ... }\n}\n\n\n}  -> la segunda llave sobra
    content = content.replace(/\n\s*}\s*\n(?=\s*dependencies\s*\{)/m, '\n');

    // 2) Eliminar cualquier bloque try/catch completo (no debe existir en build.gradle de app)
    content = content.replace(/try\s*\{[\s\S]*?\}\s*catch\s*\([^)]*\)\s*\{[\s\S]*?\}/g, '');

    // 3) Asegurar único bloque condicional de Google Services
    //    - Remover duplicados del mismo bloque condicional si existieran
    const googleBlock = `// Apply Google Services plugin only if google-services.json is present\nif (file('google-services.json').exists() || file('src/debug/google-services.json').exists() || file('src/release/google-services.json').exists()) {\n    apply plugin: 'com.google.gms.google-services'\n}`;
    // Quitar todas las variantes del bloque condicional existente para luego reinsertar una sola
    content = content.replace(/\/\/ Apply Google Services plugin only if[\s\S]*?\n\}/g, '');
    // Quitar aplicaciones directas del plugin fuera de condicional
    content = content.replace(/\n\s*apply\s+plugin:\s*'com\.google\.gms\.google-services'\s*\n/g, '\n');

    // 4) Asegurar que "apply from: 'capacitor.build.gradle'" exista una sola vez
    const applyCapLine = "apply from: 'capacitor.build.gradle'";
    // Eliminar duplicados
    const capApplyRegex = new RegExp(`\\n\\s*${applyCapLine.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\s*\\n`, 'g');
    // Extraer una instancia si existe
    const hadApplyCap = content.includes(applyCapLine);
    content = content.replace(capApplyRegex, '\n');
    if (hadApplyCap) {
      // Volver a insertar una instancia única al final del bloque dependencies
      content = content.replace(/(dependencies\s*\{[\s\S]*?\})/, `$1\n\n${applyCapLine}\n`);
    } else {
      // Si no estaba, insertarlo igualmente tras dependencies
      content = content.replace(/(dependencies\s*\{[\s\S]*?\})/, `$1\n\n${applyCapLine}\n`);
    }

    // 5) Reinsertar un único bloque condicional de Google Services al final del archivo
    content = content.trimEnd() + `\n\n${googleBlock}\n`;

    // 6) Asegurar dependencia correcta com.capacitorjs:core:5.+ en dependencies
    //    Eliminar dependencias equivocadas y garantizar la correcta
    content = content.replace(/implementation\s+"?com\.capacitorjs:[^"]+"?'?/g, '');
    // Insertar la correcta si no existe
    if (!/implementation\s+['"]com\.capacitorjs:core:5\.\+['"]/m.test(content)) {
      content = content.replace(/(dependencies\s*\{)/m, `$1\n    implementation 'com.capacitorjs:core:5.+'`);
    }

    // Guardar cambios si el contenido cambió
    await fs.writeFile(gradlePath, content, 'utf8');
  } catch (e) {
    console.warn('sanitizeAppBuildGradle: no se pudo sanitizar:', (e as any)?.message);
  }
}

function flattenProjectFiles(nestedFiles: any, prefix: string = ''): Record<string, { content: string | object }> {
  let flattened: Record<string, { content: string | object }> = {};
  console.log('DEBUG: flattenProjectFiles called with prefix:', prefix);
  console.log('DEBUG: flattenProjectFiles nestedFiles keys:', Object.keys(nestedFiles));

  for (const key in nestedFiles) {
    if (nestedFiles.hasOwnProperty(key)) {
      const currentPath = prefix ? `${prefix}/${key}` : key;
      const value = nestedFiles[key];
      console.log(`DEBUG: Processing key: ${key}, currentPath: ${currentPath}, value type: ${typeof value}`);
      console.log(`DEBUG: Value preview:`, typeof value === 'string' ? value.substring(0, 100) : value);

      if (typeof value === 'string') {
        // It's a file with string content (direct content)
        console.log(`DEBUG: Adding file with string content: ${currentPath}`);
        flattened[currentPath] = { content: value };
      } else if (typeof value === 'object' && value !== null && value.content !== undefined) {
        // It's a file with content property
        console.log(`DEBUG: Adding file with content property: ${currentPath}`);
        flattened[currentPath] = value;
      } else if (typeof value === 'object' && value !== null && !value.content) {
        // It's a directory, recurse
        console.log(`DEBUG: Recursing into directory: ${currentPath}`);
        flattened = { ...flattened, ...flattenProjectFiles(value, currentPath) };
      } else {
        console.log(`DEBUG: Skipping unknown value type for ${currentPath}:`, typeof value);
      }
    }
  }
  console.log('DEBUG: flattenProjectFiles returning keys:', Object.keys(flattened));
  return flattened;
}


async function createProjectStructure(basePath: string, files: Record<string, { content: string | object }>, appName?: string) {
  await fs.mkdir(basePath, { recursive: true });
  console.log('DEBUG: createProjectStructure called with basePath:', basePath);
  console.log('DEBUG: createProjectStructure files count:', Object.keys(files).length);

  // Add Capacitor configuration files if appName is provided
  if (appName) {
    const capacitorFiles = generateCapacitorConfig(appName);
    for (const [relativePath, content] of Object.entries(capacitorFiles)) {
      files[relativePath] = { content };
    }
  }

  for (const [relativePath, fileData] of Object.entries(files)) {
    console.log(`DEBUG: Processing file: ${relativePath}`, fileData);
    if (fileData && fileData.content) {
      const fullPath = path.join(basePath, relativePath);
      const dirName = path.dirname(fullPath);

      let contentToWrite: string;
      if (typeof fileData.content === 'string') {
        contentToWrite = fileData.content;
      } else if (typeof fileData.content === 'object') {
        contentToWrite = JSON.stringify(fileData.content, null, 2);
      } else {
        console.warn(`Skipping invalid content type for: ${relativePath}`);
        continue;
      }

      // Post-proceso para normalizar directivas y evitar duplicados de "use client"
      contentToWrite = postProcessFile(relativePath, contentToWrite);

      // Evitar crear archivos vacíos con el mismo nombre que carpetas (ej. "components", "lib")
      const basename = path.basename(relativePath);
      const hasExtension = basename.includes('.') && !basename.startsWith('.');
      const isEmptyContent = !contentToWrite || !contentToWrite.trim();
      if (isEmptyContent && !hasExtension) {
        console.log(`DEBUG: Skipping empty file with folder-like name (directory placeholder): ${relativePath}`);
        continue;
      }

      console.log(`DEBUG: Creating directory: ${dirName}`);
      await fs.mkdir(dirName, { recursive: true });

      console.log(`DEBUG: Writing file: ${fullPath}`);
      await fs.writeFile(fullPath, contentToWrite, 'utf8');
      console.log(`DEBUG: File written successfully: ${fullPath}`);
    } else {
      console.warn(`Skipping invalid file data for: ${relativePath}`);
    }
  }

  // Refuerzo post-generación: asegurar plantilla Gradle moderna de Capacitor 5
  // Esto blinda 'android/settings.gradle', 'android/build.gradle' y 'android/app/build.gradle'
  // ante cualquier alteración durante la generación, sin tocar otros archivos del proyecto.
  if (appName) {
    try {
      await ensureModernAndroidTemplate(basePath, appName);
      console.log('DEBUG: ensureModernAndroidTemplate applied after project structure creation');
    } catch (e) {
      console.warn('DEBUG: ensureModernAndroidTemplate failed post-generation:', (e as any)?.message);
    }
  }
}


// Normaliza la directiva "use client": elimina duplicados y asegura como máximo una al inicio
function normalizeUseClient(content: string): string {
  // Manejar BOM al inicio si existe
  const BOM = '\uFEFF';
  let hasBOM = false;
  if (content.startsWith(BOM)) {
    hasBOM = true;
    content = content.slice(1);
  }

  // Detectar la directiva en las primeras ~5000 chars (suficiente para encabezados)
  const headerSlice = content.slice(0, 5000);
  const directiveAnyRegex = /["'` ]use client["'`];?/i; // coincide aunque esté pegada o con distintos quotes
  const hadDirective = directiveAnyRegex.test(headerSlice) || /(^|\n)\s*["'`]use client["'`];?\s*(\n|$)/i.test(content);

  // Eliminar TODAS las apariciones de la directiva (con comillas simples/dobles/backtick y opcional ';')
  // Limitamos el reemplazo global al contenido completo dado que su uso en strings es muy raro
  let cleaned = content.replace(/["'`]use client["'`];?/gi, '');

  // Limpieza de espacios sobrantes generados por el reemplazo y líneas en blanco iniciales
  cleaned = cleaned.replace(/^[\s;]+/, '');

  // Reinsertar una sola vez al tope si existía
  if (hadDirective) {
    const result = `"use client";\n\n${cleaned}`;
    return hasBOM ? BOM + result : result;
  }
  return hasBOM ? BOM + cleaned : cleaned;
}

// Post-proceso por archivo
function postProcessFile(relativePath: string, content: string): string {
  // Solo procesar archivos de código donde podría existir la directiva
  const lower = relativePath.toLowerCase();
  const isCode = lower.endsWith('.tsx') || lower.endsWith('.jsx') || lower.endsWith('.ts') || lower.endsWith('.js');
  if (!isCode) return content;

  let result = content;

  // Remove metadata/generateMetadata from app/page.tsx (metadata lives in app/metadata.ts only)
  if (relativePath === 'app/page.tsx' || relativePath.endsWith('/app/page.tsx')) {
    result = result.replace(/(^|\n)\s*export\s+const\s+metadata\s*=\s*\{[\s\S]*?\};\s*/m, '$1');
    result = result.replace(/(^|\n)\s*export\s+(?:async\s+)?function\s+generateMetadata\s*\([^)]*\)\s*\{[\s\S]*?\n\}\s*/m, '$1');
  }

  // Normalizar directiva 'use client' si existe
  const normalized = normalizeUseClient(result);
  return normalized;
}

// Deriva el envUpdate efectivo tomando la URL de PB del body o del process.env si no viene
function getEffectiveEnvUpdate(requestBody: any): { pbUrl?: string; adminEmail?: string; adminPassword?: string } | undefined {
  const bodyEnv = (requestBody as any)?.envUpdate as { pbUrl?: string; adminEmail?: string; adminPassword?: string } | undefined;
  const fallbackPbUrl = process.env.NEXT_PUBLIC_POCKETBASE_URL;
  const pbUrl = bodyEnv?.pbUrl || fallbackPbUrl || undefined;
  if (!pbUrl && !bodyEnv?.adminEmail && !bodyEnv?.adminPassword) return bodyEnv; // nada que hacer
  return {
    pbUrl,
    adminEmail: bodyEnv?.adminEmail,
    adminPassword: bodyEnv?.adminPassword,
  };
}

// Mezcla contenido env existente con nuevos pares clave/valor (preserva comentarios y otras claves)
function mergeEnvContent(existing: string, updates: Record<string, string | undefined>): { content: string; changed: boolean } {
  const lines = existing.split(/\r?\n/);
  const map: Record<string, string> = {};
  const order: string[] = [];

  // parse existente
  for (const line of lines) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m) {
      const key = m[1];
      let val = m[2];
      // no quitar comillas si ya están; tratamos literal
      if (!(key in map)) order.push(key);
      map[key] = val;
    }
  }

  // aplicar updates definidos
  let changed = false;
  for (const [k, v] of Object.entries(updates)) {
    if (typeof v === 'undefined') continue;
    const next = String(v);
    if (!(k in map)) {
      order.push(k);
      map[k] = next;
      changed = true;
    } else if (map[k] !== next) {
      map[k] = next;
      changed = true;
    }
  }

  // reconstruir: preservamos comentarios y líneas vacías originales al inicio, luego re-escribimos claves conocidas al final
  const header: string[] = [];
  for (const line of lines) {
    if (!/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.test(line)) header.push(line);
  }
  const kvLines = order.map(k => `${k}=${map[k]}`);
  const content = [...header.filter(l => l.trim() !== ''), ...kvLines].join('\n') + '\n';
  return { content, changed };
}

// Garantiza/actualiza archivos de entorno de la app generada
async function ensureEnvFiles(targetPath: string, envUpdate?: { pbUrl?: string; adminEmail?: string; adminPassword?: string }) {
  if (!envUpdate?.pbUrl && !envUpdate?.adminEmail && !envUpdate?.adminPassword) return { changed: false };

  const pbDir = path.join(targetPath, 'PB_Datos');
  await fs.mkdir(pbDir, { recursive: true });

  // PB_Datos/.env
  const pbEnvPath = path.join(pbDir, '.env');
  const pbUpdates: Record<string, string | undefined> = {
    NEXT_PUBLIC_POCKETBASE_URL: envUpdate.pbUrl,
    NEXT_PUBLIC_ADMIN_EMAIL: envUpdate.adminEmail,
    NEXT_PUBLIC_ADMIN_PASSWORD: envUpdate.adminPassword,
  };
  let pbChanged = false;
  try {
    const existing = await fs.readFile(pbEnvPath, 'utf8');
    const { content, changed } = mergeEnvContent(existing, pbUpdates);
    pbChanged = changed;
    if (changed) await fs.writeFile(pbEnvPath, content, 'utf8');
  } catch {
    // no existe: crear con lo disponible
    const lines = Object.entries(pbUpdates)
      .filter(([, v]) => typeof v !== 'undefined')
      .map(([k, v]) => `${k}=${v}`);
    await fs.writeFile(pbEnvPath, lines.join('\n') + '\n', 'utf8');
    pbChanged = lines.length > 0;
  }

  // .env.local en raíz
  const rootEnvLocalPath = path.join(targetPath, '.env.local');
  const rootUpdates: Record<string, string | undefined> = {
    NEXT_PUBLIC_POCKETBASE_URL: envUpdate.pbUrl,
  };
  let rootChanged = false;
  try {
    const existing = await fs.readFile(rootEnvLocalPath, 'utf8');
    const { content, changed } = mergeEnvContent(existing, rootUpdates);
    rootChanged = changed;
    if (changed) await fs.writeFile(rootEnvLocalPath, content, 'utf8');
  } catch {
    const lines = Object.entries(rootUpdates)
      .filter(([, v]) => typeof v !== 'undefined')
      .map(([k, v]) => `${k}=${v}`);
    await fs.writeFile(rootEnvLocalPath, lines.join('\n') + '\n', 'utf8');
    rootChanged = lines.length > 0;
  }

  return { changed: pbChanged || rootChanged, paths: { pbEnvPath, rootEnvLocalPath } };
}

// Helper function to ensure Next.js directory structure exists
async function deleteEmptyDirectories(directory: string) {
  let files = await fs.readdir(directory);
  for (const file of files) {
    const fullPath = path.join(directory, file);
    const stat = await fs.stat(fullPath);
    if (stat.isDirectory()) {
      await deleteEmptyDirectories(fullPath);
      // After recursively deleting from subdirectories, check if the current directory is empty
      const newFiles = await fs.readdir(fullPath);
      if (newFiles.length === 0) {
        await fs.rmdir(fullPath);
        console.log(`Deleted empty directory: ${fullPath}`);
      }
    }
  }
}

// Helper function to clean up files that don't belong to the specific application type
async function cleanupIncompatibleFiles(directory: string, selectedTemplate: string) {
  const filesToDelete: string[] = [];

  // Define incompatible files for each template type
  const incompatibleFiles: Record<string, string[]> = {
    'next-js': [
      'vite.config.js',
      'vite.config.ts',
      'vue.config.js',
      'nuxt.config.js',
      'nuxt.config.ts',
      'svelte.config.js',
      'angular.json',
      '.angular-cli.json',
      'webpack.config.js',
      'rollup.config.js',
      'main.py',
      'requirements.txt',
      'Cargo.toml',
      'go.mod',
      'composer.json',
      'Gemfile'
    ],
    'vite-react': [
      'next.config.js',
      'next.config.ts',
      'vue.config.js',
      'nuxt.config.js',
      'nuxt.config.ts',
      'svelte.config.js',
      'angular.json',
      '.angular-cli.json',
      'main.py',
      'requirements.txt',
      'Cargo.toml',
      'go.mod',
      'composer.json',
      'Gemfile'
    ],
    'vue-nuxt': [
      'next.config.js',
      'next.config.ts',
      'vite.config.js',
      'vite.config.ts',
      'svelte.config.js',
      'angular.json',
      '.angular-cli.json',
      'webpack.config.js',
      'main.py',
      'requirements.txt',
      'Cargo.toml',
      'go.mod',
      'composer.json',
      'Gemfile'
    ],
    'svelte-kit': [
      'next.config.js',
      'next.config.ts',
      'vite.config.js',
      'vite.config.ts',
      'vue.config.js',
      'nuxt.config.js',
      'nuxt.config.ts',
      'angular.json',
      '.angular-cli.json',
      'main.py',
      'requirements.txt',
      'Cargo.toml',
      'go.mod',
      'composer.json',
      'Gemfile'
    ],
    'angular': [
      'next.config.js',
      'next.config.ts',
      'vite.config.js',
      'vite.config.ts',
      'vue.config.js',
      'nuxt.config.js',
      'nuxt.config.ts',
      'svelte.config.js',
      'main.py',
      'requirements.txt',
      'Cargo.toml',
      'go.mod',
      'composer.json',
      'Gemfile'
    ],
    'fastapi-py': [
      'next.config.js',
      'next.config.ts',
      'vite.config.js',
      'vite.config.ts',
      'vue.config.js',
      'nuxt.config.js',
      'nuxt.config.ts',
      'svelte.config.js',
      'angular.json',
      '.angular-cli.json',
      'package.json',
      'package-lock.json',
      'yarn.lock',
      'Cargo.toml',
      'go.mod',
      'composer.json',
      'Gemfile'
    ],
    'react-native': [
      'next.config.js',
      'next.config.ts',
      'vite.config.js',
      'vite.config.ts',
      'vue.config.js',
      'nuxt.config.js',
      'nuxt.config.ts',
      'svelte.config.js',
      'angular.json',
      '.angular-cli.json',
      'main.py',
      'requirements.txt',
      'Cargo.toml',
      'go.mod',
      'composer.json',
      'Gemfile'
    ]
  };

  // Get the list of files to delete for this template
  const filesToCheck = incompatibleFiles[selectedTemplate] || [];

  // Recursively scan directory for incompatible files
  async function scanDirectory(currentDir: string) {
    try {
      const files = await fs.readdir(currentDir);

      for (const file of files) {
        const fullPath = path.join(currentDir, file);
        const stat = await fs.stat(fullPath);

        if (stat.isDirectory()) {
          // Recursively scan subdirectories
          await scanDirectory(fullPath);
        } else {
          // Check if this file should be deleted
          if (filesToCheck.includes(file)) {
            filesToDelete.push(fullPath);
          }
        }
      }
    } catch (error) {
      console.warn(`Error scanning directory ${currentDir}:`, error);
    }
  }

  await scanDirectory(directory);

  // Delete incompatible files
  for (const filePath of filesToDelete) {
    try {
      await fs.unlink(filePath);
      console.log(`Deleted incompatible file: ${filePath}`);
    } catch (error) {
      console.warn(`Error deleting file ${filePath}:`, error);
    }
  }

  if (filesToDelete.length > 0) {
    console.log(`Cleaned up ${filesToDelete.length} incompatible files for template: ${selectedTemplate}`);
  }
}

async function ensureNextJsStructure(basePath: string) {
  const directories = [
    'app',
    'app/api',
    'app/(auth)',
    'app/(dashboard)',
    'components',
    'components/ui',
    'lib',
    'public',
    'styles',
    'types',
    'hooks',
    'contexts',
    'prisma'
  ];

  // Create all directories
  for (const dir of directories) {
    const fullPath = path.join(basePath, dir);
    try {
      await fs.mkdir(fullPath, { recursive: true });
    } catch (error: any) {
      // Ignore error if directory already exists
      if (error.code && error.code !== 'EEXIST') {
        console.error(`Error creating directory ${fullPath}:`, error);
        throw error;
      }
    }
  }
}

/** Si features incluye authentication, database o chat, se necesitan pocket-base y scripts */
export function needsPocketBase(features?: string[]): boolean {
  return !!(features && Array.isArray(features) && (
    features.includes('authentication') || features.includes('database') || features.includes('chat') || features.includes('api')
  ));
}

export function getPackageJsonContent(selectedTemplate: string, appName: string, authMethod?: string, features: string[] = []): string {
  switch (selectedTemplate) {
    case 'next-js': {
      const usePB = needsPocketBase(features);
      const usePBDatos = features.includes('database');
      const pbPart = usePB ? ' \\"pocket-base\\\\pocketbase.exe serve --dir=pocket-base\\\\pb_data\\"' : '';
      const pbDatosPart = usePBDatos ? ' \\"npm run dev --prefix ./PB_Datos -p 3002\\"' : '';
      const devScript = (usePB || usePBDatos)
        ? `"dev": "concurrently \\"next dev -p 3000\\"${pbPart}${pbDatosPart}",`
        : '"dev": "next dev -p 3000",';
      const hasPostinstall = usePB || features.includes('api');
      const postinstallScript = hasPostinstall ? '"postinstall": "node scripts/postinstall.js",' : '';
      const baseDependencies: Record<string, string> = {
        "@capacitor/android": "^5.0.0",
        "@capacitor/cli": "^5.0.0",
        "@capacitor/core": "^5.0.0",
        "@capacitor/ios": "^5.0.0",
        "@headlessui/react": "^1.7.17",
        "@heroicons/react": "^2.0.18",
        "@hookform/resolvers": "^3.3.2",
        "@radix-ui/react-slider": "^1.3.6",
        "@radix-ui/react-tabs": "^1.1.13",
        "@radix-ui/react-toast": "^1.1.5",
        "@radix-ui/react-toggle": "^1.1.10",
        "@radix-ui/react-tooltip": "^1.0.7",
        "@radix-ui/react-accordion": "^1.2.12",
        "@radix-ui/react-alert-dialog": "^1.1.15",
        "@radix-ui/react-aspect-ratio": "^1.1.7",
        "@radix-ui/react-avatar": "^1.1.10",
        "@radix-ui/react-checkbox": "^1.3.3",
        "@radix-ui/react-context-menu": "^2.2.16",
        "@radix-ui/react-dropdown-menu": "^2.1.16",
        "@radix-ui/react-hover-card": "^1.1.15",
        "@radix-ui/react-label": "^2.1.7",
        "@radix-ui/react-menubar": "^1.1.16",
        "@radix-ui/react-navigation-menu": "^1.2.14",
        "@radix-ui/react-popover": "^1.1.15",
        "@radix-ui/react-progress": "^1.1.7",
        "@radix-ui/react-radio-group": "^1.3.8",
        "@radix-ui/react-scroll-area": "^1.2.10",
        "@radix-ui/react-select": "^2.2.6",
        "@radix-ui/react-separator": "^1.1.7",
        "@radix-ui/react-switch": "^1.2.6",
        "@radix-ui/react-toggle-group": "^1.1.11",
        "class-variance-authority": "^0.7.0",
        "clsx": "^2.0.0",
        "cmdk": "^1.1.1",
        "date-fns": "^2.30.0",
        "embla-carousel-react": "^8.6.0",
        "framer-motion": "^10.16.4",
        "input-otp": "^1.4.2",
        "lucide-react": "^0.294.0",
        "next": "^16.1.6",
        "next-themes": "^0.4.6",
        "node-fetch": "^3.3.2",
        "pocketbase": "^0.26.2",
        "react": "^18.2.0",
        "react-day-picker": "^9.9.0",
        "react-dom": "^18.2.0",
        "react-error-boundary": "^4.0.11",
        "react-hook-form": "^7.47.0",
        "react-hot-toast": "^2.4.1",
        "react-resizable-panels": "^3.0.6",
        "recharts": "^3.2.0",
        "sonner": "^2.0.7",
        "swr": "^2.2.4",
        "tailwind-merge": "^1.14.0",
        "tailwindcss-animate": "^1.0.7",
        "uuid": "^14.0.0",
        "vaul": "^1.1.2",
        "zod": "^3.22.4",
        "zustand": "^4.4.3"
      };

      const capScripts = `"cap": "npx cap",
    "cap-add-android": "npx cap add android",
    "cap-add-ios": "npx cap add ios",
    "cap-copy": "npx cap copy",
    "cap-sync-android": "npx cap sync android",
    "cap-open-android": "npx cap open android",
    "cap-open-ios": "npx cap open ios",
    "cap-run-android": "npx cap run android",
    "cap-run-ios": "npx cap run ios",
    "cap-build-android": "npx cap build android",
    "cap-build-ios": "npx cap build ios",
    "build-apk": "npm run build && npx cap copy android && cd android && gradlew.bat assembleDebug",
    "build-apk:release:win": "npm run build && npx cap copy android && cd android && gradlew.bat assembleRelease",
    "build-apk:release:unix": "npm run build && npx cap copy android && cd android && ./gradlew assembleRelease"`;

      const scriptsBlock = hasPostinstall
        ? `"scripts": {
    ${devScript}
    ${postinstallScript}
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "format": "prettier --write '**/*.{js,jsx,ts,tsx,json,md}'",
    "test": "jest",
    "analyze": "ANALYZE=true next build",
    ${capScripts}
  }`
        : `"scripts": {
    ${devScript}
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "format": "prettier --write '**/*.{js,jsx,ts,tsx,json,md}'",
    "test": "jest",
    "analyze": "ANALYZE=true next build",
    ${capScripts}
  }`;

      return `{
  "name": "${appName}",
  "version": "0.1.0",
  "private": true,
  ${scriptsBlock},
  "dependencies": ${JSON.stringify(baseDependencies, null, 4).replace(/^/gm, '    ').trim()},
  "devDependencies": {
    "@next/bundle-analyzer": "^14.0.0",
    "@testing-library/jest-dom": "^6.1.4",
    "@testing-library/react": "^14.0.0",
    "@types/node": "^20",
    "@types/react": "^18",
    "@types/react-dom": "^18",
    "@typescript-eslint/eslint-plugin": "^8.0.0",
    "@typescript-eslint/parser": "^8.0.0",
    "autoprefixer": "^10.0.1",
    ${(usePB || usePBDatos) ? '"concurrently": "^8.2.2",' : ''}
    "cssnano": "^6.0.1",
    "eslint": "^9.39.2",
    "eslint-config-next": "^16.1.6",
    "eslint-config-prettier": "^9.0.0",
    "jest": "^29.7.0",
    "jest-environment-jsdom": "^30.3.0",
    "postcss": "^8.5.10",
    "postcss-flexbugs-fixes": "^5.0.2",
    "postcss-preset-env": "^9.3.0",
    "prettier": "^3.0.3",
    "prettier-plugin-tailwindcss": "^0.5.6",
    "tailwindcss": "^3.3.0",
    "tailwindcss-animate": "^1.0.7",
    "typescript": "^5"
  },
  "overrides": {
    "postcss": "^8.5.10",
    "uuid": "^14.0.0"
  }
}`;
    }

    case 'vite-react': // Assuming a template name for Vite React
      return `{
  "name": "${appName}",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite --port 5173",
    "build": "tsc && vite build",
    "lint": "eslint . --ext ts,tsx --report-unused-directives --max-warnings 0",
    "preview": "vite preview",
    "format": "prettier --write '**/*.{js,jsx,ts,tsx,json,md}'",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "cap": "npx cap",
    "cap-add-android": "npx cap add android",
    "cap-add-ios": "npx cap add ios",
    "cap-copy": "npx cap copy",
    "cap-open-android": "npx cap open android",
    "cap-open-ios": "npx cap open ios",
    "cap-run-android": "npx cap run android",
    "cap-run-ios": "npx cap run ios",
    "cap-build-android": "npx cap build android",
    "cap-build-ios": "npx cap build ios",
    "build-apk": "npm run build && npx cap copy android && cd android && gradlew.bat assembleDebug",
    "postinstall": "node -e \"const fs=require('fs');const cp=require('child_process');if(fs.existsSync('API/package.json')){console.log('[postinstall] Installing API dependencies...');cp.execSync('npm install --prefix ./API',{stdio:'inherit'})}\""
  },
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-router-dom": "^6.22.0",
    "@headlessui/react": "^1.7.17",
    "@heroicons/react": "^2.0.18",
    "clsx": "^2.0.0",
    "tailwind-merge": "^1.14.0",
    "framer-motion": "^10.16.4",
    "react-hook-form": "^7.47.0",
    "zod": "^3.22.4",
    "@hookform/resolvers": "^3.3.2",
    "zustand": "^4.4.3",
    "axios": "^1.6.2",
    "date-fns": "^2.30.0",
    "@capacitor/core": "^5.0.0",
    "@capacitor/cli": "^5.0.0",
    "@capacitor/android": "^5.0.0",
    "@capacitor/ios": "^5.0.0"
  },
  "devDependencies": {
    "@types/react": "^18.2.66",
    "@types/react-dom": "^18.2.22",
    "@typescript-eslint/eslint-plugin": "^7.2.0",
    "@typescript-eslint/parser": "^7.2.0",
    "@vitejs/plugin-react": "^4.2.1",
    "eslint": "^8.57.0",
    "eslint-config-prettier": "^9.0.0",
    "eslint-plugin-react-hooks": "^4.6.0",
    "eslint-plugin-react-refresh": "^0.4.6",
    "typescript": "^5.2.2",
    "vite": "^5.2.0",
    "vitest": "^1.3.1",
    "@vitest/coverage-v8": "^1.3.1",
    "@testing-library/react": "^14.0.0",
    "@testing-library/jest-dom": "^6.1.4",
    "jsdom": "^24.0.0",
    "prettier": "^3.0.3",
    "prettier-plugin-tailwindcss": "^0.5.6",
    "autoprefixer": "^10.4.16",
    "postcss": "^8.4.31",
    "postcss-flexbugs-fixes": "^5.0.2",
    "postcss-preset-env": "^9.3.0",
    "cssnano": "^6.0.1",
    "tailwindcss": "^3.3.5",
    "vite-plugin-svgr": "^4.2.0",
    "rollup-plugin-visualizer": "^5.9.2"
  }
}`;
    case 'vue-nuxt':
      return `{
  "name": "${appName}",
  "private": true,
  "version": "0.1.0",
  "scripts": {
    "build": "nuxt build",
    "dev": "nuxt dev",
    "generate": "nuxt generate",
    "preview": "nuxt preview",
    "postinstall": "nuxt prepare && node -e \"const fs=require('fs');const cp=require('child_process');if(fs.existsSync('API/package.json')){console.log('[postinstall] Installing API dependencies...');cp.execSync('npm install --prefix ./API',{stdio:'inherit'})}\"",
    "lint": "eslint .",
    "format": "prettier --write '**/*.{js,jsx,ts,tsx,vue,json,md}'"
  },
  "devDependencies": {
    "@nuxt/devtools": "latest",
    "@nuxt/eslint-config": "^0.2.0",
    "@nuxt/ui": "^2.11.1",
    "eslint": "^8.57.0",
    "nuxt": "^3.8.0",
    "prettier": "^3.0.3",
    "typescript": "^5.2.2"
  }
}`;
    case 'svelte-kit':
      return `{
  "name": "${appName}",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "vite dev",
    "build": "vite build",
    "preview": "vite preview",
    "check": "svelte-kit sync && svelte-check --tsconfig ./tsconfig.json",
    "check:watch": "svelte-kit sync && svelte-check --tsconfig ./tsconfig.json --watch",
    "lint": "prettier --plugin-search-dir . --check . && eslint .",
    "format": "prettier --plugin-search-dir . --write .",
    "postinstall": "node -e \"const fs=require('fs');const cp=require('child_process');if(fs.existsSync('API/package.json')){console.log('[postinstall] Installing API dependencies...');cp.execSync('npm install --prefix ./API',{stdio:'inherit'})}\""
  },
  "devDependencies": {
    "@sveltejs/adapter-auto": "^2.0.0",
    "@sveltejs/kit": "^1.20.4",
    "@typescript-eslint/eslint-plugin": "^6.0.0",
    "@typescript-eslint/parser": "^6.0.0",
    "eslint": "^8.28.0",
    "eslint-config-prettier": "^8.5.0",
    "eslint-plugin-svelte": "^2.30.0",
    "prettier": "^2.8.0",
    "prettier-plugin-svelte": "^2.10.1",
    "svelte": "^4.0.5",
    "svelte-check": "^3.4.3",
    "tslib": "^2.4.1",
    "typescript": "^5.0.0",
    "vite": "^4.4.2",
    "autoprefixer": "^10.4.16",
    "postcss": "^8.4.31",
    "postcss-flexbugs-fixes": "^5.0.2",
    "cssnano": "^6.0.1",
    "tailwindcss": "^3.3.5"
  },
  "type": "module"
}`;
    case 'angular':
      return `{
  "name": "${appName}",
  "version": "0.1.0",
  "scripts": {
    "ng": "ng",
    "start": "ng serve",
    "build": "ng build",
    "watch": "ng build --watch --configuration development",
    "test": "ng test",
    "lint": "ng lint",
    "format": "prettier --write '**/*.{js,ts,html,scss,json,md}'",
    "postinstall": "node -e \"const fs=require('fs');const cp=require('child_process');if(fs.existsSync('API/package.json')){console.log('[postinstall] Installing API dependencies...');cp.execSync('npm install --prefix ./API',{stdio:'inherit'})}\""
  },
  "private": true,
  "dependencies": {
    "@angular/animations": "^17.0.0",
    "@angular/common": "^17.0.0",
    "@angular/compiler": "^17.0.0",
    "@angular/core": "^17.0.0",
    "@angular/forms": "^17.0.0",
    "@angular/platform-browser": "^17.0.0",
    "@angular/platform-browser-dynamic": "^17.0.0",
    "@angular/router": "^17.0.0",
    "rxjs": "~7.8.0",
    "tslib": "^2.3.0",
    "zone.js": "~0.14.0"
  },
  "devDependencies": {
    "@angular-devkit/build-angular": "^17.0.0",
    "@angular/cli": "^17.0.0",
    "@angular/compiler-cli": "^17.0.0",
    "@types/jasmine": "~5.1.0",
    "jasmine-core": "~5.1.0",
    "karma": "~6.4.0",
    "karma-chrome-launcher": "~3.2.0",
    "karma-coverage": "~2.2.0",
    "karma-jasmine": "~5.1.0",
    "karma-jasmine-html-reporter": "~2.1.0",
    "typescript": "~5.2.0",
    "prettier": "^3.0.3",
    "autoprefixer": "^10.4.16",
    "postcss": "^8.4.31",
    "postcss-flexbugs-fixes": "^5.0.2",
    "cssnano": "^6.0.1",
    "tailwindcss": "^3.3.5"
  }
}`;
    case 'fastapi-py':
      return `{
  "name": "${appName}",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000",
    "build": "python -m pip install -r requirements.txt",
    "start": "python -m uvicorn main:app --host 0.0.0.0 --port 8000",
    "test": "python -m pytest",
    "lint": "python -m flake8 .",
    "format": "python -m black . && python -m isort ."
  },
  "dependencies": {},
  "devDependencies": {
    "prettier": "^3.0.3"
  }
}`;
    case 'react-native':
      return `{
  "name": "${appName}",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "android": "react-native run-android",
    "ios": "react-native run-ios",
    "lint": "eslint .",
    "start": "react-native start",
    "test": "jest",
    "build": "react-native bundle --platform android --dev false --entry-file index.js --bundle-output android/app/src/main/assets/index.android.bundle",
    "format": "prettier --write '**/*.{js,jsx,ts,tsx,json,md}'",
    "postinstall": "node -e \"const fs=require('fs');const cp=require('child_process');if(fs.existsSync('API/package.json')){console.log('[postinstall] Installing API dependencies...');cp.execSync('npm install --prefix ./API',{stdio:'inherit'})}\""
  },
  "dependencies": {
    "react": "18.2.0",
    "react-native": "0.72.6"
  },
  "devDependencies": {
    "@babel/core": "^7.20.0",
    "@babel/preset-env": "^7.20.0",
    "@babel/runtime": "^7.20.0",
    "@react-native/eslint-config": "^0.72.2",
    "@react-native/metro-config": "^0.72.11",
    "@tsconfig/react-native": "^3.0.0",
    "@types/react": "^18.0.24",
    "@types/react-test-renderer": "^18.0.0",
    "babel-jest": "^29.2.1",
    "eslint": "^8.19.0",
    "jest": "^29.2.1",
    "metro-react-native-babel-preset": "0.76.8",
    "prettier": "^2.4.1",
    "react-test-renderer": "18.2.0",
    "typescript": "4.8.4"
  },
  "jest": {
    "preset": "react-native"
  }
}`;
    case 'html-css-js':
      return `{
  "name": "${appName}",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "live-server --port=3000 --host=localhost --open=/index.html",
    "build": "echo \"Static HTML project - no build step required\"",
    "start": "live-server --port=3000 --host=localhost --open=/index.html",
    "lint": "eslint *.js",
    "format": "prettier --write '**/*.{html,css,js,json,md}'",
    "postinstall": "node -e \"const fs=require('fs');const cp=require('child_process');if(fs.existsSync('API/package.json')){console.log('[postinstall] Installing API dependencies...');cp.execSync('npm install --prefix ./API',{stdio:'inherit'})}\""
  },
  "dependencies": {},
  "devDependencies": {
    "live-server": "^1.2.2",
    "eslint": "^8.57.0",
    "prettier": "^3.0.3"
  }
}`;
    default:
      // Fallback for other templates - default to Vite React setup
      console.warn(`Unknown template: ${selectedTemplate}, defaulting to vite-react setup`);
      return `{
  "name": "${appName}",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite --port 5173",
    "build": "tsc && vite build",
    "lint": "eslint . --ext ts,tsx --report-unused-directives --max-warnings 0",
    "preview": "vite preview",
    "format": "prettier --write '**/*.{js,jsx,ts,tsx,json,md}'",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "postinstall": "node -e \"const fs=require('fs');const cp=require('child_process');if(fs.existsSync('API/package.json')){console.log('[postinstall] Installing API dependencies...');cp.execSync('npm install --prefix ./API',{stdio:'inherit'})}\""
  },
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-router-dom": "^6.22.0"
  },
  "devDependencies": {
    "@types/react": "^18.2.66",
    "@types/react-dom": "^18.2.22",
    "@typescript-eslint/eslint-plugin": "^7.2.0",
    "@typescript-eslint/parser": "^7.2.0",
    "@vitejs/plugin-react": "^4.2.1",
    "eslint": "^8.57.0",
    "eslint-plugin-react-hooks": "^4.6.0",
    "eslint-plugin-react-refresh": "^0.4.6",
    "typescript": "^5.2.2",
    "vite": "^5.2.0",
    "vitest": "^1.3.1",
    "prettier": "^3.0.3",
    "autoprefixer": "^10.4.16",
    "postcss": "^8.4.31",
    "postcss-flexbugs-fixes": "^5.0.2",
    "cssnano": "^6.0.1",
    "tailwindcss": "^3.3.5"
  }
}`;
  }
}

// Function to generate Capacitor configuration files
function generateCapacitorConfig(appName: string): Record<string, string> {
  const sanitized = appName.toLowerCase().replace(/[^a-z0-9]/g, '');
  const appId = `com.zeus.${sanitized}`;
  return {
    'capacitor.config.ts': `import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: '${appId}',
  appName: '${appName}',
  webDir: 'out',
  server: {
    androidScheme: 'https'
  }
};

export default config;
`,
    // Android modern templates (Capacitor 5)
    'android/settings.gradle': `pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = '${appName}'
include ':app'
`,
    'android/build.gradle': `// Top-level build file for the project (Android Gradle Plugin 8+)
// Repos are defined in settings.gradle via dependencyResolutionManagement

tasks.register('clean', Delete) {
    delete rootProject.buildDir
}
`,
    'android/app/build.gradle': `plugins {
    id 'com.android.application'
}

android {
    namespace '${appId}'
    compileSdk 34

    defaultConfig {
        applicationId '${appId}'
        minSdkVersion 22
        targetSdkVersion 34
        versionCode 1
        versionName '1.0'
    }

    compileOptions {
        sourceCompatibility JavaVersion.VERSION_17
        targetCompatibility JavaVersion.VERSION_17
    }

    packagingOptions {
        resources {
            excludes += ['/META-INF/{AL2.0,LGPL2.1}']
        }
    }
}

dependencies {
    implementation 'com.capacitorjs:core:5.+'
}

apply from: 'capacitor.build.gradle'

// Apply Google Services plugin only if google-services.json is present
if (file('google-services.json').exists() || file('src/debug/google-services.json').exists() || file('src/release/google-services.json').exists()) {
    apply plugin: 'com.google.gms.google-services'
}
`,
    'android/app/src/main/res/values/strings.xml': `<?xml version='1.0' encoding='utf-8'?>
<resources>
    <string name="app_name">${appName}</string>
    <string name="title_activity_main">MainActivity</string>
    <string name="package_name">${appId}</string>
    <string name="custom_url_scheme">${appId}</string>
</resources>
`,
    // iOS basic Info.plist (kept minimal, real files are created by "cap add ios")
    'ios/App/App/Info.plist': `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleDevelopmentRegion</key>
    <string>en</string>
    <key>CFBundleDisplayName</key>
    <string>${appName}</string>
    <key>CFBundleExecutable</key>
    <string>$(EXECUTABLE_NAME)</string>
    <key>CFBundleIdentifier</key>
    <string>${appId}</string>
    <key>CFBundleInfoDictionaryVersion</key>
    <string>6.0</string>
    <key>CFBundleName</key>
    <string>$(PRODUCT_NAME)</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0</string>
    <key>CFBundleVersion</key>
    <string>1</string>
    <key>LSRequiresIPhoneOS</key>
    <true/>
    <key>UILaunchStoryboardName</key>
    <string>LaunchScreen</string>
    <key>UIMainStoryboardFile</key>
    <string>Main</string>
    <key>UIRequiredDeviceCapabilities</key>
    <array>
        <string>armv7</string>
    </array>
    <key>UISupportedInterfaceOrientations</key>
    <array>
        <string>UIInterfaceOrientationPortrait</string>
        <string>UIInterfaceOrientationLandscapeLeft</string>
        <string>UIInterfaceOrientationLandscapeRight</string>
    </array>
    <key>UISupportedInterfaceOrientations~ipad</key>
    <array>
        <string>UIInterfaceOrientationPortrait</string>
        <string>UIInterfaceOrientationPortraitUpsideDown</string>
        <string>UIInterfaceOrientationLandscapeLeft</string>
        <string>UIInterfaceOrientationLandscapeRight</string>
    </array>
    <key>UIViewControllerBasedStatusBarAppearance</key>
    <true/>
</dict>
</plist>
`
  };
}

// Helper function to verify and fix package.json dependencies
function verifyPackageJsonDependencies(packageJsonContent: string): string {
  try {
    const packageJson = JSON.parse(packageJsonContent);
    let needsUpdate = false;

    // Ensure dependencies object exists
    packageJson.dependencies = packageJson.dependencies || {};
    packageJson.devDependencies = packageJson.devDependencies || {};
    packageJson.scripts = packageJson.scripts || {};

    // Check and fix React version
    if (!packageJson.dependencies.react || !packageJson.dependencies.react.includes('18.2')) {
      packageJson.dependencies.react = "^18.2.0";
      needsUpdate = true;
    }

    // Check and fix React DOM version
    if (!packageJson.dependencies['react-dom'] || !packageJson.dependencies['react-dom'].includes('18.2')) {
      packageJson.dependencies['react-dom'] = "^18.2.0";
      needsUpdate = true;
    }

    // Check and fix Next.js version if it's a Next.js project
    if (packageJson.dependencies.next && !packageJson.dependencies.next.includes('14')) {
      packageJson.dependencies.next = "14.0.0";
      needsUpdate = true;
    }

    // Check and fix Vite dev script for port 5173
    if (packageJson.devDependencies.vite || packageJson.dependencies.vite) {
      if (packageJson.scripts.dev && !packageJson.scripts.dev.includes('--port 5173')) {
        packageJson.scripts.dev = packageJson.scripts.dev.replace('vite', 'vite --port 5173');
        needsUpdate = true;
      }

      // Ensure build script includes TypeScript compilation for Vite projects
      if (packageJson.scripts.build && !packageJson.scripts.build.includes('tsc') && packageJson.devDependencies.typescript) {
        packageJson.scripts.build = "tsc && vite build";
        needsUpdate = true;
      }
    }

    // Ensure essential development scripts
    if (!packageJson.scripts.format) {
      packageJson.scripts.format = "prettier --write '**/*.{js,jsx,ts,tsx,json,md}'"
      // Add prettier if not present
      if (!packageJson.devDependencies.prettier) {
        packageJson.devDependencies.prettier = "^3.0.3";
      }
      needsUpdate = true;
    }

    // Ensure build script exists and is functional
    if (!packageJson.scripts.build || packageJson.scripts.build.includes('echo') || packageJson.scripts.build.includes('exit 1')) {
      // Determine appropriate build script based on dependencies
      if (packageJson.dependencies.next || packageJson.devDependencies.next) {
        packageJson.scripts.build = "next build";
      } else if (packageJson.devDependencies.vite || packageJson.dependencies.vite) {
        packageJson.scripts.build = packageJson.devDependencies.typescript ? "tsc && vite build" : "vite build";
      } else if (packageJson.devDependencies['@angular/cli']) {
        packageJson.scripts.build = "ng build";
      } else if (packageJson.devDependencies.nuxt) {
        packageJson.scripts.build = "nuxt build";
      } else if (packageJson.devDependencies['@sveltejs/kit']) {
        packageJson.scripts.build = "vite build";
      } else {
        // Default fallback for unknown setups
        packageJson.scripts.build = "echo \"Build completed - static files ready\"";
      }
      needsUpdate = true;
    }

    // Ensure dev script exists and is functional
    if (!packageJson.scripts.dev || packageJson.scripts.dev.includes('echo') || packageJson.scripts.dev.includes('exit 1')) {
      if (packageJson.dependencies.next || packageJson.devDependencies.next) {
        packageJson.scripts.dev = "next dev";
      } else if (packageJson.devDependencies.vite || packageJson.dependencies.vite) {
        packageJson.scripts.dev = "vite --port 5173";
      } else if (packageJson.devDependencies['@angular/cli']) {
        packageJson.scripts.dev = "ng serve";
      } else if (packageJson.devDependencies.nuxt) {
        packageJson.scripts.dev = "nuxt dev";
      } else if (packageJson.devDependencies['@sveltejs/kit']) {
        packageJson.scripts.dev = "vite dev";
      } else if (packageJson.devDependencies['live-server']) {
        packageJson.scripts.dev = "live-server --port=3000 --host=localhost --open=/index.html";
      } else {
        packageJson.scripts.dev = "echo \"Development server not configured\"";
      }
      needsUpdate = true;
    }

    // Ensure TypeScript for typed projects
    if ((packageJson.dependencies.next || packageJson.devDependencies.vite) && !packageJson.devDependencies.typescript) {
      packageJson.devDependencies.typescript = "^5.2.2";
      needsUpdate = true;
    }

    // Ensure Tailwind CSS for UI projects
    if (!packageJson.devDependencies.tailwindcss) {
      packageJson.devDependencies.tailwindcss = "^3.3.5";
      packageJson.devDependencies.autoprefixer = "^10.4.16";
      packageJson.devDependencies.postcss = "^8.4.31";
      packageJson.devDependencies['postcss-flexbugs-fixes'] = "^5.0.2";
      packageJson.devDependencies['postcss-preset-env'] = "^9.3.0";
      needsUpdate = true;
    }

    // Ensure postcss-flexbugs-fixes for projects that use postcss
    if (packageJson.devDependencies.postcss && !packageJson.devDependencies['postcss-flexbugs-fixes']) {
      packageJson.devDependencies['postcss-flexbugs-fixes'] = "^5.0.2";
      needsUpdate = true;
    }

    // Ensure postcss-preset-env for projects that use postcss
    if (packageJson.devDependencies.postcss && !packageJson.devDependencies['postcss-preset-env']) {
      packageJson.devDependencies['postcss-preset-env'] = "^9.3.0";
      needsUpdate = true;
    }

    // Ensure Capacitor dependencies for mobile apps
    if (!packageJson.dependencies['@capacitor/core']) {
      packageJson.dependencies['@capacitor/core'] = "^5.0.0";
      needsUpdate = true;
    }

    if (!packageJson.dependencies['@capacitor/cli']) {
      packageJson.dependencies['@capacitor/cli'] = "^5.0.0";
      needsUpdate = true;
    }

    if (!packageJson.dependencies['@capacitor/android']) {
      packageJson.dependencies['@capacitor/android'] = "^5.0.0";
      needsUpdate = true;
    }

    if (!packageJson.dependencies['@capacitor/ios']) {
      packageJson.dependencies['@capacitor/ios'] = "^5.0.0";
      needsUpdate = true;
    }

    // Ensure Capacitor scripts
    if (!packageJson.scripts['cap']) {
      packageJson.scripts['cap'] = "npx cap";
      needsUpdate = true;
    }

    if (!packageJson.scripts['cap-add-android']) {
      packageJson.scripts['cap-add-android'] = "npx cap add android";
      needsUpdate = true;
    }

    if (!packageJson.scripts['cap-add-ios']) {
      packageJson.scripts['cap-add-ios'] = "npx cap add ios";
      needsUpdate = true;
    }

    if (!packageJson.scripts['cap-copy']) {
      packageJson.scripts['cap-copy'] = "npx cap copy";
      needsUpdate = true;
    }

    if (!packageJson.scripts['cap-open-android']) {
      packageJson.scripts['cap-open-android'] = "npx cap open android";
      needsUpdate = true;
    }

    if (!packageJson.scripts['cap-open-ios']) {
      packageJson.scripts['cap-open-ios'] = "npx cap open ios";
      needsUpdate = true;
    }

    if (!packageJson.scripts['cap-run-android']) {
      packageJson.scripts['cap-run-android'] = "npx cap run android";
      needsUpdate = true;
    }

    if (!packageJson.scripts['cap-run-ios']) {
      packageJson.scripts['cap-run-ios'] = "npx cap run ios";
      needsUpdate = true;
    }

    if (!packageJson.scripts['cap-build-android']) {
      packageJson.scripts['cap-build-android'] = "npx cap build android";
      needsUpdate = true;
    }

    if (!packageJson.scripts['cap-build-ios']) {
      packageJson.scripts['cap-build-ios'] = "npx cap build ios";
      needsUpdate = true;
    }

    if (!packageJson.scripts['build-apk'] || packageJson.scripts['build-apk'].includes('npx cap build android')) {
      packageJson.scripts['build-apk'] = "npm run build && npx cap copy android && cd android && gradlew.bat assembleDebug";
      needsUpdate = true;
    }

    // Ensure TypeScript ESLint dependencies for projects using TypeScript ESLint rules
    if (!packageJson.devDependencies['@typescript-eslint/eslint-plugin']) {
      packageJson.devDependencies['@typescript-eslint/eslint-plugin'] = "^6.0.0";
      needsUpdate = true;
    }

    if (!packageJson.devDependencies['@typescript-eslint/parser']) {
      packageJson.devDependencies['@typescript-eslint/parser'] = "^6.0.0";
      needsUpdate = true;
    }

    if (needsUpdate) {
      return JSON.stringify(packageJson, null, 2);
    }
  } catch (error) {
    console.error('❌ Error verifying/updating package.json:', error);
  }
  return packageJsonContent;
}

// Helper function to get model configuration
async function getModelConfig(modelId: string, userId: string): Promise<StorageModelConfig | undefined> {
  const models = await getModelsForUser(userId);
  return models.find((m: StorageModelConfig) => m.id === modelId);
}

// New helper for Auth details
function getAuthDetailsPrompt(authMethod: string): string {
  switch (authMethod) {
    case 'pocketbase':
      return `Implement authentication using PocketBase. Includes:\n        - PocketBase SDK initialization.\n        - User registration functionality with an example form and state management.\n        - Login and logout functionality with an example form and state management.\n        - Basic route/component protection with an example of middleware or higher-order component.\n        - Note that the PocketBase server will run locally (e.g., https://zeus-basedatos.fly.dev).\n      `;
    case 'firebase':
      return `Implement authentication using Firebase Authentication. Includes:\n        - Firebase SDK initialization.\n        - User registration functionality (email/password) with an example form and state management.\n        - Login and logout functionality with an example form and state management.\n        - Basic route/component protection with an example of middleware or higher-order component.\n        - Configuration for Firebase credentials.\n      `;
    case 'supabase':
      return `Implement authentication using Supabase Auth. Includes:\n        - Supabase client initialization.\n        - User registration functionality (email/password) with an example form and state management.\n        - Login and logout functionality with an example form and state management.\n        - Basic route/component protection with an example of middleware or higher-order component.\n        - Configuration for Supabase URL and anonymous key.\n      `;
    case 'custom':
      return `Implement a custom authentication system. Includes:\n        - Placeholder for registration, login, and logout logic with example function structures.\n        - An example of how to integrate with an external authentication API.\n        - Clear comments indicating where the user should add their custom logic.\n      `;
    case 'none':
    default:
      return 'No authentication required.';
  }
}

// New helper for Database details
function getDatabaseDetailsPrompt(dbType: string, language: string): string {
  let ormDetails = '';
  if (language === 'Python') {
    ormDetails = 'Consider using SQLAlchemy or a similar ORM.';
  } else if (language === 'TypeScript' || language === 'JavaScript') {
    ormDetails = 'Consider using Prisma, Sequelize, or a similar ORM/ODM.';
  } else if (language === 'Java') {
    ormDetails = 'Consider using Spring Data JPA or a similar ORM.';
  } else if (language === 'C#') {
    ormDetails = 'Consider using Entity Framework Core or a similar ORM.';
  }

  switch (dbType) {
    case 'pocketbase':
      return `Set up a basic client to interact with PocketBase as a database. Includes:\n        - PocketBase SDK initialization.\n        - Examples of CRUD (Create, Read, Update, Delete) operations on a sample collection with functional code.\n        - Note that the PocketBase server will run locally (e.g., https://zeus-basedatos.fly.dev).\n      `;
    case 'firebase_firestore':
      return `Set up a basic client to interact with Firebase Firestore. Includes:\n        - Firebase SDK initialization.\n        - Examples of CRUD operations on a sample Firestore collection with functional code.\n      `;
    case 'supabase':
      return `Set up a basic client to interact with Supabase (PostgreSQL). Includes:\n        - Supabase client initialization.\n        - Examples of CRUD operations on a sample Supabase table with functional code.\n        - Configuration for the Supabase URL and anonymous key.\n      `;
    case 'postgresql':
      return `Set up the connection to a PostgreSQL database. Includes:\n        - Configuration file for database credentials.\n        - An example of how to perform a basic query with functional code.\n        - ${ormDetails}\n        - Note: For production, a dedicated backend is recommended to handle database interaction.\n      `;
    case 'mongodb':
      return `Set up the connection to a MongoDB database. Includes:\n        - Configuration file for the connection string.\n        - An example of how to perform a basic operation (e.g., insert/find a document) with functional code.\n        - ${ormDetails}\n        - Note: For production, a dedicated backend is recommended to handle database interaction.\n      `;
    case 'sqlite':
      return `Set up the connection to an SQLite database. Includes:\n        - An example of how to create a table and perform basic operations with functional code.\n        - ${ormDetails}\n        - Note: SQLite is ideal for local development or desktop/mobile applications, but not for scalable backends.\n      `;
    case 'custom':
      return `Set up the connection to a custom database. Includes:\n        - An example of how to configure the database connection.\n        - An example of a basic query with functional code.\n        - ${ormDetails}\n        - Note: Make sure the user understands they need to replace the example values with their own configuration.\n      `;
    case 'none':
    default:
      return 'No database configuration required.';
  }
}

// --- Template-specific prompt generation ---
function getSystemPrompt(selectedTemplate: string, language: string, dbType: string, authMethod: string, description: string): string {
  const basePrompt = `You are an expert software development assistant specializing in creating professional, modern, and visually stunning applications. Your mission is to generate high-quality applications that stand out for their exceptional design, robust functionality, and flawless code. Each application must be a masterpiece that combines the best technology with extraordinary design.

🎯 MAIN OBJECTIVE: Create applications that are:
- PROFESSIONAL: Clean, well-structured code following industry best practices
- MODERN: Using the latest technologies, design patterns, and current trends
- VISUALLY STUNNING: Interfaces that captivate and delight users
- FULLY FUNCTIONAL: No empty files, with all dependencies and functionalities implemented

🎨 ELITE UI/UX DESIGN GUIDELINES:
- **Exceptional Visual Design:** Create truly impressive interfaces with modern, elegant, and sophisticated design that rivals the best applications on the market
- **Premium Color Palette:** Use professional and attractive color schemes. Implement subtle gradients, vibrant yet balanced colors, and a cohesive and memorable visual identity
- **Professional Typography:** Select and configure modern, readable, and aesthetically pleasing fonts. Establish a clear typographic hierarchy with perfectly balanced sizes, weights, and spacing
- **Perfect Spacing and Layout:** Implement consistent spacing, precise alignment, and breathable layouts. Use professional grids and design systems
- **Next-Gen UI Components:** Design buttons, cards, forms, navigation, modals, and other elements with modern styles, elegant shadows, appropriate rounded corners, and sophisticated visual effects
- **Animations and Microinteractions:** Implement smooth transitions, elegant animations, sophisticated hover effects, and microinteractions that significantly enhance user experience
- **Advanced Theme System:** Implement a complete light/dark theme system with smooth transitions, preference persistence, and automatic adaptation based on system preferences
- **Exceptional Responsive Design:** Ensure the design looks and works perfectly on all devices (mobile, tablet, desktop) with well-defined breakpoints
- **Complete Visual States:** Implement loading states with attractive spinners, error handling with clear and visually integrated messages, informative empty states, and immediate visual feedback
- **Premium Accessibility:** Implement complete accessibility features (ARIA, proper contrast, keyboard navigation, screen readers)

💻 ELITE CODE AND ARCHITECTURE GUIDELINES:
- **Professional Architecture:** Organize code in a clear, scalable folder structure that follows industry best practices
- **Clean and Documented Code:** Write clean, well-commented, and maintainable code. Include explanatory comments where necessary
- **Reusable Components:** Create modular, reusable, and well-designed components that can be easily extended
- **Robust State Management:** Implement efficient and scalable state management using the framework's best practices
- **Complete Validation:** Implement robust form validation with clear error messages and immediate visual feedback
- **Performance Optimization:** Include optimizations such as lazy loading, memoization, code splitting, and other performance techniques
- **Professional Error Handling:** Implement complete error handling with logging, graceful recovery, and user-friendly messages
- **Testing and Quality:** Structure the code to be easily testable and maintainable

🔧 STRICT TECHNICAL GUIDELINES:
- **Standard Folder Structure:** Organize code into folders like \`components/\`, \`lib/\`, \`hooks/\`, \`types/\`, \`utils/\`, \`services/\`, \`contexts/\`, \`styles/\`, etc.
- **Absolute Import Paths:** ALWAYS use absolute import paths with the \`@/\` alias for internal modules
- **Complete Dependencies:** ALL used dependencies MUST be declared in \`package.json\` with compatible and updated versions
- **Complete Files:** NEVER generate empty or minimal content files. Each file must be complete, functional, and well-implemented
- **Optimized Configuration:** Include complete and optimized configuration files (ESLint, Prettier, TypeScript, etc.)

🚀 QUALITY DEVELOPMENT PROCESS:
1. **In-Depth Analysis:** Carefully analyze the user's description to fully understand the requirements
2. **Architectural Planning:** Design a solid and scalable architecture before starting to code
3. **Complete Implementation:** Develop ALL necessary functionalities without leaving anything half-done
4. **Quality Review:** Review the code to ensure it meets all quality standards
5. **Final Validation:** Verify that the application is fully functional and ready to use

⚠️ MANDATORY CRITICAL RULES:
- NEVER generate empty files or placeholder content
- ALWAYS include all necessary dependencies in package.json
- ALWAYS implement complete functionalities, not partial ones
- ALWAYS verify that the code is functional before delivery
- ALWAYS prioritize quality over development speed`;

  const authConfigPrompt = `
⚠️ AUTH CONFIGURATION RULES (MANDATORY):
- Do NOT generate lib/auth-config.ts or lib/auth-config.tsx. These files are already provided.
- The authPaths.home value is already set to '/' (root page). NEVER change it to '/dashboard' or any other path.
- After login or registration, ALWAYS redirect to authPaths.home (which is '/').
- Import auth paths from '@/lib/auth-config' and use authPaths.home for all post-auth redirects.

⚠️ UI COMPONENT EXPORT RULES (MANDATORY):
- ALL components inside components/ui/ MUST use named exports: export { ComponentName } (NEVER export default).
- When importing UI components, ALWAYS use named imports with curly braces: import { Input, Button, Label } from '@/components/ui/[name]'.
- NEVER use default imports for UI components (e.g., import Input from '@/components/ui/input' is FORBIDDEN).
`;

  const authPrompt = getAuthDetailsPrompt(authMethod);
  const databasePrompt = getDatabaseDetailsPrompt(dbType, language);

  // Analizar la descripción para determinar el nivel de complejidad
  const isSimpleApp = description.toLowerCase().includes('simple') ||
    description.toLowerCase().includes('básico') ||
    description.toLowerCase().includes('sencillo') ||
    description.toLowerCase().includes('minimal') ||
    description.toLowerCase().includes('álbum') ||
    description.toLowerCase().includes('galería') ||
    description.toLowerCase().includes('fotos') ||
    description.toLowerCase().includes('imágenes') ||
    description.toLowerCase().includes('calculadora') ||
    description.toLowerCase().includes('contador') ||
    description.toLowerCase().includes('lista') ||
    description.toLowerCase().includes('notas') ||
    description.toLowerCase().includes('todo') ||
    description.toLowerCase().includes('timer') ||
    description.toLowerCase().includes('reloj') ||
    description.toLowerCase().includes('conversor') ||
    description.toLowerCase().includes('generador') ||
    description.toLowerCase().includes('visor') ||
    description.toLowerCase().includes('mostrar') ||
    description.toLowerCase().includes('display');

  const isComplexApp = description.toLowerCase().includes('completo') ||
    description.toLowerCase().includes('avanzado') ||
    description.toLowerCase().includes('enterprise') ||
    description.toLowerCase().includes('dashboard') ||
    description.toLowerCase().includes('admin') ||
    description.toLowerCase().includes('sistema') ||
    description.toLowerCase().includes('gestión') ||
    description.toLowerCase().includes('management') ||
    description.toLowerCase().includes('crm') ||
    description.toLowerCase().includes('ecommerce') ||
    description.toLowerCase().includes('tienda') ||
    description.toLowerCase().includes('marketplace') ||
    description.toLowerCase().includes('red social') ||
    description.toLowerCase().includes('social network') ||
    description.toLowerCase().includes('plataforma') ||
    description.toLowerCase().includes('platform') ||
    description.toLowerCase().includes('aplicación completa') ||
    description.toLowerCase().includes('full application');

  let templateDetails = '';

  switch (selectedTemplate) {
    case 'next-js':
      templateDetails = `\n        Framework: Next.js 13+ (React) with App Router\n        Language: ${language}\n        Folder Structure: YOU MUST use the Next.js 13+ App Router with the following mandatory structure:\n        - app/layout.tsx (root layout with html, head, body)\n        - app/page.tsx (main page)\n        - app/globals.css (global styles with Tailwind)\n        - package.json (with Next.js, React, Tailwind dependencies)\n        - next.config.js (basic Next.js configuration)\n        - tsconfig.json (if TypeScript)\n        - tailwind.config.js (Tailwind configuration)\n        - postcss.config.js (PostCSS configuration)\n        \n        Styles: Tailwind CSS (properly configured)\n        Authentication: ${authPrompt}\n        Database: ${databasePrompt}\n        \n        ${isSimpleApp ? `\n        🎯 FEATURES FOR SIMPLE (BUT PROFESSIONAL) APPLICATION:
        1. **Impressive Homepage:** A visually appealing homepage that implements the requested functionality with modern and professional design
        2. **Elegant UI Components:** Basic but well-designed components with modern styles, subtle animations, and complete visual states
        3. **Premium Visual Design:** Sophisticated styles with Tailwind CSS, attractive color palette, professional typography, and perfect spacing
        4. **Robust Functionality:** Complete and functional implementation of all requested features with error handling
        5. **Exceptional Responsive Design:** Design that adapts perfectly to all devices with well-defined breakpoints
        6. **Optimization and Performance:** Optimized code with lazy loading, memoization, and performance best practices
        7. **Complete Accessibility:** Implementation of accessibility features (ARIA, contrast, keyboard navigation)
        8. **Theme System:** Light/dark mode implementation with smooth transitions
        9. **Microinteractions:** Hover effects, transitions, and animations that enhance user experience
        10. **Clean Code:** Professional code structure with explanatory comments and best practices
        
        📁 MINIMUM PROFESSIONAL STRUCTURE:
        - app/layout.tsx (with complete metadata and professional design)
        - app/page.tsx (fully functional and attractive main page)
        - app/globals.css (complete global styles with custom CSS variables)
        - components/ui/ (modern, well-designed reusable components)
        - lib/ (utilities and helper functions)
        - hooks/ (custom hooks for reusable logic)
        - package.json (with all necessary dependencies)
        - next.config.js (optimized configuration)
        - tailwind.config.js (custom configuration with extensions)
        - postcss.config.js (optimized configuration)
        - tsconfig.json (complete configuration if TypeScript)
        - README.md (complete documentation)\n        ` : isComplexApp ? `\n        🚀 FEATURES FOR COMPLEX APPLICATION (ENTERPRISE LEVEL):
        1. **Sophisticated Multi-Page Architecture:** At least 5-7 different pages with smooth navigation and cohesive design
        2. **Advanced Component System:** Complete library of reusable components with variants, states, and documentation
        3. **Professional Custom Hooks:** Custom hooks for state management, API calls, authentication, and business logic
        4. **Complete Utilities and Helpers:** Helper functions, validators, formatters, and development utilities
        5. **Robust Type System:** Complete TypeScript types with interfaces, enums, and utility types
        6. **Advanced State Management:** Implementation with Zustand/Redux with persistence and middleware
        7. **Professional Forms:** react-hook-form with complete validation, Zod schemas, and exceptional UX
        8. **Premium Responsive Design:** Custom breakpoints, grid systems, and perfect adaptation to all devices
        9. **Complete API Integration:** Configured HTTP client, error handling, caching, and optimistic updates
        10. **Enterprise Authentication System:** JWT, refresh tokens, roles, permissions, and route protection
        11. **Advanced Analytics Dashboard:** Data visualization with interactive charts and real-time metrics
        12. **Complete User Profile:** Full profile management, settings, preferences, and customization
        13. **Notification System:** Toast notifications, alerts, and messaging system
        14. **Performance Optimization:** Code splitting, lazy loading, memoization, and advanced optimizations
        15. **Complete Testing:** Unit tests, integration tests, and E2E tests configuration
        16. **Professional Documentation:** Detailed README, component documentation, and development guides
        17. **CI/CD Pipeline:** Configuration for automatic deployment and quality gates
        18. **Monitoring and Analytics:** Integration with monitoring and analytics tools
        19. **Internationalization:** Multi-language support if required
        20. **Complete Accessibility:** WCAG 2.1 compliance and accessibility testing\n        ` : `\n        ⭐ STANDARD FEATURES (PROFESSIONAL QUALITY):
        1. **Attractive Homepage:** Fully functional main page with modern and professional design
        2. **Elegant Additional Pages:** 2-3 well-designed additional pages (about, contact, services, etc.)
        3. **Modern UI Components:** Library of reusable components (Header, Footer, Button, Card, Modal, etc.) with consistent styles
        4. **Efficient State Management:** Implementation with React Context or Zustand for global state management
        5. **Advanced Forms:** Forms with robust validation, enhanced UX, and error handling
        6. **Professional Responsive Design:** Perfect adaptation to mobile, tablet, and desktop with optimized breakpoints
        7. **Robust API Integration:** Configured HTTP client with error handling and loading states
        8. **Navigation System:** Intuitive navigation with breadcrumbs and active states
        9. **Performance Optimization:** Component lazy loading and basic optimizations
        10. **Basic Accessibility:** Implementation of essential accessibility features
        11. **Theme System:** Light/dark mode with preference persistence
        12. **Error Handling:** Error boundaries and custom error pages
        13. **Loading States:** Skeletons and spinners for better UX during loading
        14. **SEO Optimized:** Meta tags, structured data, and search engine optimization
        15. **Basic Documentation:** README with installation and usage instructions\n        `}\n      `;
      break;
    case 'vue-nuxt':
      templateDetails = `\n        Framework: Nuxt.js (Vue)\n        Lenguaje: ${language}\n        Estructura de carpetas: Sigue las convenciones de Nuxt 3.\n        Estilos: Tailwind CSS.\n        Autenticación: ${authPrompt}\n        Base de Datos: ${databasePrompt}\n        \n        ${isSimpleApp ? `\n        CARACTERÍSTICAS PARA APLICACIÓN SIMPLE:\n        1. Una página principal que implemente la funcionalidad solicitada\n        2. Componentes básicos necesarios\n        3. Estilos simples con Tailwind CSS\n        4. Funcionalidad principal funcionando correctamente\n        ` : isComplexApp ? `\n        CARACTERÍSTICAS PARA APLICACIÓN COMPLEJA:\n        1. Múltiples páginas con navegación\n        2. Componentes Vue reutilizables\n        3. Composables para lógica de negocio\n        4. Manejo de estado con Pinia o Vuex\n        5. Formularios con validación\n        6. Diseño responsive\n        7. Integración con APIs\n        8. Sistema de autenticación\n        9. Dashboard con funcionalidades\n        10. Perfil de usuario\n        ` : `\n        CARACTERÍSTICAS ESTÁNDAR:\n        1. Página principal con la funcionalidad solicitada\n        2. 1-2 páginas adicionales si es necesario\n        3. Componentes reutilizables básicos\n        4. Manejo de estado básico\n        5. Formularios con validación básica\n        6. Diseño responsive\n        `}\n      `;
      break;
    case 'react-native':
      templateDetails = `\n        Framework: React Native\n        Lenguaje: ${language}\n        Estructura: Un componente principal App.${language === 'TypeScript' ? 'tsx' : 'js'} y múltiples pantallas.\n        Navegación: React Navigation con stack y tab navigator.\n        Autenticación: ${authPrompt}\n        Base de Datos: ${databasePrompt}\n        \n        ${isSimpleApp ? `\n        CARACTERÍSTICAS PARA APLICACIÓN SIMPLE:\n        1. Una pantalla principal que implemente la funcionalidad solicitada\n        2. Componentes básicos necesarios\n        3. Navegación simple\n        4. Funcionalidad principal funcionando correctamente\n        ` : isComplexApp ? `\n        CARACTERÍSTICAS PARA APLICACIÓN COMPLEJA:\n        1. Múltiples pantallas con navegación\n        2. Componentes nativos personalizados\n        3. Manejo de estado con Redux o Context\n        4. Formularios con validación\n        5. Integración con APIs\n        6. Almacenamiento local\n        7. Notificaciones push\n        8. Cámara y galería\n        9. Geolocalización\n        10. Temas claro/oscuro\n        ` : `\n        CARACTERÍSTICAS ESTÁNDAR:\n        1. Pantalla principal con la funcionalidad solicitada\n        2. 1-2 pantallas adicionales si es necesario\n        3. Componentes reutilizables básicos\n        4. Manejo de estado básico\n        5. Navegación entre pantallas\n        6. Integración con APIs si es necesario\n        `}\n      `;
      break;
    case 'fastapi-py':
      templateDetails = `\n        Framework: FastAPI\n        Lenguaje: Python\n        Estructura: Un archivo main.py, un requirements.txt, y carpetas organizadas.\n        Autenticación: ${authPrompt}\n        Base de Datos: ${databasePrompt}\n        \n        ${isSimpleApp ? `\n        CARACTERÍSTICAS PARA APLICACIÓN SIMPLE:\n        1. Endpoints básicos para la funcionalidad solicitada\n        2. Validación de datos con Pydantic\n        3. Manejo de errores básico\n        4. Documentación automática (Swagger/OpenAPI)\n        ` : isComplexApp ? `\n        CARACTERÍSTICAS PARA APLICACIÓN COMPLEJA:\n        1. Múltiples endpoints RESTful\n        2. Validación de datos con Pydantic\n        3. Autenticación JWT\n        4. Documentación automática (Swagger/OpenAPI)\n        5. Manejo de errores personalizado\n        6. Middleware personalizado\n        7. Tests unitarios\n        8. Configuración de CORS\n        9. Logging estructurado\n        10. Rate limiting\n        11. Upload de archivos\n        12. Websockets para tiempo real\n        ` : `\n        CARACTERÍSTICAS ESTÁNDAR:\n        1. Endpoints para la funcionalidad solicitada\n        2. Validación de datos con Pydantic\n        3. Autenticación básica si es necesario\n        4. Documentación automática\n        5. Manejo de errores\n        6. Configuración de CORS\n        `}\n      `;
      break;
    // ... add more detailed prompts for other templates
    default:
      templateDetails = `\n        Tecnología: ${selectedTemplate}\n        Lenguaje: ${language}\n        Descripción general: Crea una estructura de proyecto completa y funcional.\n        Autenticación: ${authPrompt}\n        Base de Datos: ${databasePrompt}\n        \n        ${isSimpleApp ? `\n        CARACTERÍSTICAS PARA APLICACIÓN SIMPLE:\n        1. Funcionalidad principal solicitada\n        2. Componentes básicos necesarios\n        3. Estilos simples\n        4. Funcionalidad funcionando correctamente\n        ` : isComplexApp ? `\n        CARACTERÍSTICAS PARA APLICACIÓN COMPLEJA:\n        1. Múltiples páginas/componentes\n        2. Manejo de estado avanzado\n        3. Formularios interactivos\n        4. Diseño responsive\n        5. Integración con APIs\n        6. Funcionalidades avanzadas\n        ` : `\n        CARACTERÍSTICAS ESTÁNDAR:\n        1. Funcionalidad principal solicitada\n        2. 1-2 páginas/componentes adicionales si es necesario\n        3. Manejo de estado básico\n        4. Formularios con validación básica\n        5. Diseño responsive\n        6. Integración con APIs si es necesario\n        `}\n      `;
  }

  return `${basePrompt}\n${authConfigPrompt}\n\n--- Especificaciones del Proyecto ---\n${templateDetails}\n\nIMPORTANTE: Analiza la descripción del usuario: "${description}"\n\nREGLAS CRÍTICAS PARA EVITAR ARCHIVOS VACÍOS:\n⚠️ NUNCA GENERES ARCHIVOS VACÍOS O CON CONTENIDO MÍNIMO\n⚠️ TODOS LOS ARCHIVOS DEBEN TENER CONTENIDO COMPLETO Y FUNCIONAL\n⚠️ VALIDACIÓN OBLIGATORIA: Antes de finalizar, verifica que NINGÚN archivo esté vacío\n\nARCHIVOS CRÍTICOS QUE NUNCA PUEDEN ESTAR VACÍOS:\n- app/page.tsx o src/App.jsx: DEBE contener un componente React completo y funcional\n- app/globals.css o src/index.css: DEBE contener estilos base, variables CSS y estilos de Tailwind\n- components/: TODOS los componentes deben estar completamente implementados\n- package.json: DEBE contener todas las dependencias y scripts necesarios\n- README.md: DEBE contener documentación completa del proyecto\n\nREGLAS PARA GENERAR ARCHIVOS Y ESTRUCTURA:\n1. ESTRUCTURA DE CARPETAS COMPLETA Y PROFESIONAL:\n   - Organiza el código en una estructura de carpetas clara, coherente y completa\n   - Separa claramente los componentes, páginas, utilidades, hooks, tipos, contextos, servicios, etc.\n   - Incluye TODOS los archivos de configuración necesarios sin excepción\n   - Sigue las mejores prácticas de organización de código para el framework seleccionado\n   - Crea una estructura escalable que permita el crecimiento futuro de la aplicación\n   - Organiza los componentes por funcionalidad o características cuando sea apropiado\n\n2. PARA CUALQUIER TIPO DE APLICACIÓN (SIMPLE O COMPLEJA):\n   - Genera una estructura completa y profesional con TODOS los archivos necesarios\n   - Incluye componentes reutilizables bien diseñados y completamente funcionales\n   - Implementa un sistema de navegación intuitivo, profesional y responsive\n   - Asegúrate de que la aplicación tenga un aspecto visual atractivo, moderno y profesional\n   - Incluye manejo de estados robusto, validación de formularios completa, y feedback visual para todas las interacciones\n   - Implementa correctamente la autenticación y base de datos según las opciones seleccionadas\n   - Asegúrate de que la aplicación sea completamente funcional y lista para usar\n   - Incluye manejo de errores completo y mensajes de usuario amigables\n\n3. ARCHIVOS OBLIGATORIOS PARA NEXT.JS (EJEMPLO):\n   - app/layout.tsx (layout raíz con diseño profesional y metadatos completos)\n   - app/page.tsx (página principal atractiva y completamente funcional - NUNCA VACÍA)\n   - app/globals.css (estilos globales completos con variables CSS personalizadas - NUNCA VACÍO)\n   - components/ (carpeta con componentes reutilizables bien organizados y documentados)\n   - lib/ (utilidades y funciones helper bien estructuradas)\n   - hooks/ (custom hooks para lógica reutilizable)\n   - contexts/ (contextos de React para estado global)\n   - services/ (servicios para API y lógica de negocio)\n   - types/ (definiciones de tipos completas si es TypeScript)\n   - public/ (assets estáticos organizados por categoría)\n   - styles/ (estilos adicionales o componentes de estilo)\n   - package.json (con todas las dependencias necesarias y scripts útiles)\n   - next.config.js (configuración completa y optimizada)\n   - tailwind.config.js (configuración personalizada con extensiones útiles)\n   - postcss.config.js (configuración optimizada)\n   - tsconfig.json (configuración completa si es TypeScript)\n   - README.md (documentación completa con instrucciones de instalación y uso)\n   - .env.example (variables de entorno de ejemplo con comentarios explicativos)\n   - .gitignore (configurado correctamente para el tipo de proyecto)\n   - .eslintrc.js (configuración de linting)\n   - .prettierrc (configuración de formato de código)\n\n4. CARACTERÍSTICAS ADICIONALES PARA MEJORAR LA CALIDAD:\n   - Implementa un sistema de temas completo (claro/oscuro) con persistencia de preferencias\n   - Añade animaciones y transiciones sutiles para mejorar la experiencia de usuario\n   - Incluye componentes de UI modernos, atractivos y accesibles\n   - Implementa manejo de errores robusto y estados de carga con feedback visual\n   - Añade comentarios explicativos en el código para facilitar el mantenimiento\n   - Asegúrate de que el código sea limpio, bien estructurado y siga las mejores prácticas\n   - Implementa correctamente la autenticación y base de datos según las opciones seleccionadas\n   - Añade validación de formularios completa con mensajes de error claros\n   - Incluye optimización de rendimiento (lazy loading, memoización, etc.)\n   - Implementa características de accesibilidad (ARIA, contraste, navegación por teclado)\n   - Añade efectos visuales sutiles que mejoren la experiencia sin distraer\n\n5. VALIDACIÓN FINAL OBLIGATORIA:\n   - Antes de entregar el resultado, VERIFICA que ningún archivo esté vacío\n   - Asegúrate de que todos los archivos principales (App.jsx, index.css, etc.) tengan contenido sustancial\n   - Si detectas un archivo vacío, REGENERA su contenido inmediatamente\n   - La aplicación debe ser completamente funcional desde el primer momento\n\nCrea una aplicación completa, profesional y lista para usar que cumpla con todos los requisitos del usuario, ofrezca una excelente experiencia de usuario, y siga las mejores prácticas de desarrollo moderno.`;
}

// Function to normalize import paths in file content
function normalizeImports(content: string, filePath: string): string {
  // Convert absolute imports to relative
  const normalizedContent = content.replace(
    /from\s+['"]@\/([^'"]+)['"]/g,
    (match, importPath) => {
      const currentDir = path.dirname(filePath);
      const relativePath = path.relative(currentDir, `/${importPath}`);
      return `from '${relativePath.startsWith('.') ? relativePath : './' + relativePath}'`;
    }
  );

  return normalizedContent;
}

function normalizeFileMapShape(parsed: any, appName: string): Record<string, string | null> {
  if (!parsed || typeof parsed !== 'object') return {};

  // Common format: { "appName": { "files": { ... } } }
  const byAppName = (parsed as any)?.[appName];
  if (byAppName && typeof byAppName === 'object' && (byAppName as any).files && typeof (byAppName as any).files === 'object') {
    return (byAppName as any).files as Record<string, string | null>;
  }

  // Common format: { "files": { ... } }
  if ((parsed as any).files && typeof (parsed as any).files === 'object') {
    return (parsed as any).files as Record<string, string | null>;
  }

  // If it's wrapped with a single unknown root key, unwrap it
  const keys = Object.keys(parsed);
  if (keys.length === 1) {
    const only = (parsed as any)[keys[0]];
    if (only && typeof only === 'object' && (only as any).files && typeof (only as any).files === 'object') {
      return (only as any).files as Record<string, string | null>;
    }
  }

  // Already flat: { "app/page.tsx": "...", ... }
  return parsed as Record<string, string | null>;
}

// Parse file list content from AI response
function parseFileListContent(fileListContent: string): Record<string, string | null> {
  try {
    // Clean up markdown fences and trim whitespace
    let cleanedContent = fileListContent.trim();
    cleanedContent = cleanedContent
      .replace(/^```[a-zA-Z]*\n/, '')
      .replace(/\n```\s*$/, '')
      .trim();

    // Extract JSON object if there's extra text around it
    const firstBrace = cleanedContent.indexOf('{');
    const lastBrace = cleanedContent.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      cleanedContent = cleanedContent.slice(firstBrace, lastBrace + 1);
    }

    return JSON.parse(cleanedContent);
  } catch (initialParseError: any) {
    console.warn('Initial file list JSON parse failed, attempting to clean and retry:', initialParseError.message);

    try {
      // Try to fix common JSON issues
      let cleanedContent = fileListContent.trim();
      cleanedContent = cleanedContent
        .replace(/^```[a-zA-Z]*\n/, '')
        .replace(/\n```\s*$/, '')
        .trim();

      const firstBrace = cleanedContent.indexOf('{');
      const lastBrace = cleanedContent.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        cleanedContent = cleanedContent.slice(firstBrace, lastBrace + 1);
      }

      // Remove trailing commas before closing braces/brackets
      cleanedContent = cleanedContent.replace(/,\s*([}\]])/g, '$1');

      // Fix unescaped quotes in strings - more robust approach
      cleanedContent = cleanedContent.replace(/"([^"\\]*(\\.[^"\\]*)*)"([^":,}\]\s])/g, '"$1\\"$3');

      // Fix unterminated strings by finding unmatched quotes
      const lines = cleanedContent.split('\n');
      const fixedLines = lines.map(line => {
        // Count quotes in the line
        const quoteCount = (line.match(/"/g) || []).length;
        // If odd number of quotes, likely unterminated string
        if (quoteCount % 2 !== 0) {
          // Find the last quote and add closing quote before line end
          const lastQuoteIndex = line.lastIndexOf('"');
          if (lastQuoteIndex !== -1) {
            // Check if it's at the end or followed by comma/brace
            const afterQuote = line.substring(lastQuoteIndex + 1).trim();
            if (afterQuote === '' || afterQuote.startsWith(',') || afterQuote.startsWith('}') || afterQuote.startsWith(']')) {
              return line.substring(0, lastQuoteIndex + 1) + '"' + line.substring(lastQuoteIndex + 1);
            }
          }
        }
        return line;
      });
      cleanedContent = fixedLines.join('\n');

      // Additional fix for unterminated strings at specific positions
      // Find all quote positions and ensure they are properly paired
      const chars = cleanedContent.split('');
      let inString = false;
      let lastQuoteIndex = -1;

      for (let i = 0; i < chars.length; i++) {
        if (chars[i] === '"' && (i === 0 || chars[i - 1] !== '\\')) {
          if (!inString) {
            inString = true;
            lastQuoteIndex = i;
          } else {
            inString = false;
            lastQuoteIndex = -1;
          }
        }
      }

      // If we end with an unterminated string, close it
      if (inString && lastQuoteIndex !== -1) {
        // Find a good place to close the string (before next structural character)
        let closePosition = chars.length;
        for (let i = lastQuoteIndex + 1; i < chars.length; i++) {
          if (chars[i] === ',' || chars[i] === '}' || chars[i] === ']' || chars[i] === '\n') {
            closePosition = i;
            break;
          }
        }
        chars.splice(closePosition, 0, '"');
        cleanedContent = chars.join('');
      }

      // Remove any incomplete JSON at the end
      const lastCompleteObject = cleanedContent.lastIndexOf('}');
      if (lastCompleteObject > 0) {
        cleanedContent = cleanedContent.substring(0, lastCompleteObject + 1);
      }

      // Try to balance braces if needed
      const openBraces = (cleanedContent.match(/{/g) || []).length;
      const closeBraces = (cleanedContent.match(/}/g) || []).length;
      if (openBraces > closeBraces) {
        cleanedContent += '}'.repeat(openBraces - closeBraces);
      }

      const parsedResult = JSON.parse(cleanedContent);
      console.log('✅ Successfully parsed file list JSON after cleaning');
      return parsedResult;
    } catch (secondParseError: any) {
      console.error('File list JSON parsing failed even after cleaning:', secondParseError.message);
      console.error('Raw content from AI (first 2000 chars):', fileListContent.substring(0, 2000));
      console.error('Raw content from AI (last 1000 chars):', fileListContent.substring(Math.max(0, fileListContent.length - 1000)));

      // Fallback to essential Next.js files with null content (will be generated individually)
      console.log('🔄 Using fallback file structure due to JSON parsing failure');
      return {
        'package.json': null,
        'next.config.js': null,
        'app/layout.tsx': null,
        'app/page.tsx': null,
        'app/globals.css': null,
        'tsconfig.json': null,
        'tailwind.config.js': null,
        'postcss.config.js': null,
        'next-env.d.ts': null,
        'README.md': null,
      };
    }
  }
}

async function saveProjectArchive(projectRoot: string, projectId: string) {
  console.log('saveProjectArchive: Received request to save archive.', { projectRoot, projectId });

  if (!projectRoot || !projectId) {
    console.error('saveProjectArchive: projectRoot and projectId are required');
    return;
  }

  if (!isPocketBaseInitialized()) {
    await initPocketBase({ url: process.env.NEXT_PUBLIC_POCKETBASE_URL! });
  }
  const pb = getPocketBase();

  const archiveName = `project_${projectId}_${Date.now()}.zip`;
  const archivePath = path.join(os.tmpdir(), archiveName);
  const output = fsSync.createWriteStream(archivePath);
  const archive = archiver('zip', {
    zlib: { level: 9 }
  });

  const outputClosed = new Promise<void>((resolve, reject) => {
    output.on('close', () => {
      console.log('saveProjectArchive: Archiver output stream closed.');
      resolve();
    });
    output.on('error', (err) => {
      console.error('saveProjectArchive: Archiver output stream error:', err);
      reject(err);
    });
  });

  archive.on('warning', function (err) {
    if (err.code === 'ENOENT') {
      console.warn('saveProjectArchive: Archiver warning (ENOENT):', err);
    } else {
      console.error('saveProjectArchive: Archiver warning:', err);
    }
  });

  archive.on('error', function (err) {
    console.error('saveProjectArchive: Archiver error:', err);
    throw err;
  });

  archive.pipe(output);
  const zipPrefix = path.basename(projectRoot);
  archive.glob('**/*', {
    cwd: projectRoot,
    dot: true,
    follow: true,
    ignore: ['node_modules/**', '.git/**', '.next/**', 'dist/**', 'build/**']
  }, { prefix: zipPrefix });
  await archive.finalize();
  await outputClosed;
  console.log('saveProjectArchive: Zip archive created at:', archivePath);

  try {
    console.log('saveProjectArchive: Fetching project record for update...');
    const projectRecord = await (await pb).collection('projects').getOne(projectId);
    console.log('saveProjectArchive: Project record fetched.');

    // Read the ZIP file content
    const zipBuffer = await fs.readFile(archivePath);
    const zipBlob = new Blob([new Uint8Array(zipBuffer)], { type: 'application/zip' });
    
    // Create backup with same content but prefixed name
    const backupName = `backup_${archiveName}`;
    const backupBlob = new Blob([new Uint8Array(zipBuffer)], { type: 'application/zip' });

    const filesToUpload = new FormData();
    filesToUpload.append('project_archive', zipBlob, archiveName);
    filesToUpload.append('project_archive_backup', backupBlob, backupName);
    filesToUpload.append('createBackup', 'true'); // ✅ Indicar que es creación inicial, crear backup

    console.log('saveProjectArchive: Attempting to update project record with new archive and backup...');
    console.log('   - project_archive:', archiveName, `(${(zipBuffer.length / 1024).toFixed(2)} KB)`);
    console.log('   - project_archive_backup:', backupName, `(${(zipBuffer.length / 1024).toFixed(2)} KB)`);
    
    await (await pb).collection('projects').update(projectId, filesToUpload);
    console.log('saveProjectArchive: ✅ Project record updated successfully with archive and backup.');
  } catch (error) {
    console.error('saveProjectArchive: Error updating project record:', error);
    throw error;
  } finally {
    console.log('saveProjectArchive: Cleaning up temporary archive file...');
    await fs.unlink(archivePath);
    console.log('saveProjectArchive: Temporary archive file cleaned up.');
  }
}

async function handleStreamingAppGeneration(
  message: string,
  modelConfig: StorageModelConfig,
  projectRoot: string,
  appName: string,
  description: string,
  stream: ReadableStreamDefaultController,
  selectedTemplate: string,
  complexity: string,
  projectId: string, // Add projectId here
  authMethod?: string,
  requestUrl?: string,
  userToken?: string,
  features?: string[], // authentication, database, chat - para scripts condicionales
  userId?: string,
) {
  // DATA_PATH es la raíz directa del proyecto actual (sin subcarpeta appName)
  const targetPath = projectRoot;

  // Send initial status
  const encoder = new TextEncoder();
  stream.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'status', message: 'Iniciando generación de aplicación...' })}`));

  // 1. First call: Get the file structure
  const fileListPrompt = `\n    🚀 You are a senior software architect and expert UI/UX designer specializing in creating production-quality, enterprise-grade web applications.

🎯 Mission: Create a visually stunning, technically robust, and fully functional Next.js application that exceeds user expectations.

⚠️ CRITICAL RULES FOR NEXT.JS APP ROUTER:
- NEVER use import Head from 'next/head' - this is for Pages Router only
- NEVER use the <Head> component in any file
- NEVER combine JSX fragments (<>) with Head components
- NEVER export metadata or generateMetadata in app/page.tsx. Metadata is ONLY in app/metadata.ts (import it where needed).
- In app/layout.tsx you can re-export metadata from app/metadata.ts if needed: import { metadata } from './metadata'; export { metadata };
- In app/layout.tsx, ALWAYS import Providers from '@/components/Providers' (NOT from './providers')
- ALWAYS USE absolute paths with aliases @ for imports instead of relative paths

🚨 MANDATORY FOOTER COPYRIGHT TEXT (APPLIES TO ALL FOOTERS - INLINE OR COMPONENT):
- If you include ANY footer (component <Footer /> OR inline <footer> tag in app/page.tsx or any page):
- The copyright text MUST be EXACTLY this in SPANISH: "© ${new Date().getFullYear()} ${appName}. Todos los derechos reservados. Aplicación creada con www.zeus-ia.com"
- ⚠️ NEVER use "All rights reserved" or any English text
- ⚠️ This is MANDATORY and applies to ALL footers in the application
  🔒 SPECIAL RULES FOR LAYOUT COMPONENTS (components/layout/header.tsx and components/layout/footer.tsx):
  - DO NOT index hook returns like useSomething[0] or useAudioPlayer[0]. Always destructure properly (e.g., const [state, setState] = useState(...)).
  - DO NOT call setState as a free function or from props; use the setter from useState only.
  - Avoid non-deterministic or undefined hooks; do not create custom hooks that return arrays unless you document and destructure them safely.
  - If the component requires client-side interactivity, include exactly one "use client" directive at the very top; never duplicate it.
  - Do not use server-only APIs in client components.
  - Keep header/footer simple and type-safe; no direct DOM manipulations.
  - ⚠️ CRITICAL FOOTER COPYRIGHT: The footer copyright text MUST be EXACTLY: "© ${new Date().getFullYear()} ${appName}. Todos los derechos reservados. Aplicación creada con www.zeus-ia.com" (in SPANISH, NOT English).
  - ⚠️ DO NOT use "All rights reserved" or any English copyright text. Use ONLY the exact Spanish text specified above.

Returns a JSON object where the keys are the file paths (e.g., "app/page.tsx") and the values are the FULL, FUNCTIONAL content of those files.
Make sure to include ALL essential configuration files with their complete and optimized contents.
Do NOT include any other text in your response, just the JSON object.\n\n --- User Request ---\n App Name: ${appName}\n Description: ${description}\n ---\n\n RULES FOR GENERATING FILES AND CONTENT:\n 1. REQUIRED FILES (always include with complete and optimized content):\n - "package.json": Complete content with all necessary dependencies and useful scripts.\n - "next.config.js": Complete and optimized configuration.\n - "app/layout.tsx": Professionally designed root layout (can import and re-export metadata from './metadata').\n - "app/metadata.ts": Already exists with app metadata; do NOT duplicate metadata in app/page.tsx.\n - "app/page.tsx": Beautiful and fully functional home page. Do NOT export metadata or generateMetadata here.\n - "app/globals.css": Complete global styles with custom CSS variables.\n - "tsconfig.json": Complete configuration for TypeScript.\n - "tailwind.config.js": Custom configuration with useful extensions.\n - "postcss.config.js": Optimized configuration.\n- "next-env.d.ts": Type configuration for Next.js.\n- "README.md": Complete documentation with installation and usage instructions.\n- ".env.example": Example environment variables with explanatory comments.\n- ".gitignore": Correctly configured for the project type.\n- ".eslintrc.js": Linting configuration.\n- ".prettierrc": Code formatting configuration.\n\n 2. COMPLETE AND PROFESSIONAL FOLDER STRUCTURE:\n- "components/": Folder with well-organized and documented reusable components.\n- "lib/": Well-structured utilities and helper functions.\n- "hooks/": Custom hooks for reusable logic.\n- "contexts/": React contexts for global state.\n- "services/": Services for APIs and logic business.\n- "types/": Complete type definitions.\n- "public/": Static assets organized by category.\n- "styles/": Additional styles or style components.\n\n 3. CAREFULLY ANALYZE THE DESCRIPTION:\n- Generate COMPLETE and FUNCTIONAL content for ALL files required for the application.\n- Create a professional, attractive, and fully functional application that meets all requirements.\n- If it's a simple application (album, gallery, calculator, counter, etc.): Generate all necessary files for a professional and complete implementation.\n- If it's a complex application (dashboard, management system, etc.): Generate a complete structure with all necessary files.\n\n 4. 🎯 PREMIUM QUALITY GUIDELINES:

🎨 EXCEPTIONAL VISUAL DESIGN:
- Modern and attractive color palette with subtle gradients
- Professional typography with clear hierarchy and perfect readability
- Perfect spacing and a consistent grid system
- Modern, consistent, and meaningful iconography (use Ionicons for mobile)
- Subtle microinteractions and animations that enhance the UX
- Complete theming system (light/dark) with smooth transitions
- Components with complete visual states (hover, active, disabled, loading)

📦 ICONOS DISPONIBLES PARA MÓVIL (Ionicons - usar SOLO estos nombres):
Navegación: home, menu, search, compass, navigate, map, arrowBack, arrowForward, arrowUp, arrowDown
Usuario: person, people, logIn, logOut, settings, happy, sad, person-circle
Comercio: bag, cart, storefront, pricetag, gift, card, wallet, cash
Comunicación: mail, call, chatbubble, send, notifications, mic, headset
Social: heart, star, share, thumbsUp, thumbsDown, logo-facebook, logo-instagram, logo-twitter
Multimedia: camera, image, videocam, musical-notes, play, pause, tv, phone-portrait, tablet-portrait, laptop
Archivos: document, folder, download, cloud-download, cloud-upload, save, archive, clipboard
Edición: create, trash, add, remove, close, checkmark, pencil, cut, brush, color-palette
Información: information-circle, help-circle, alert-circle, flag, bookmark, trophy, ribbon, medal
Negocios: briefcase, business, school, library, book, newspaper, calculator
Moda: shirt, glasses, diamond, sparkles, watch, wallet
Comida: pizza, restaurant, cafe, wine, beer, ice-cream, fast-food, nutrition
Transporte: car, bus, train, airplane, boat, rocket, bicycle
Clima: sunny, moon, cloud, rainy, snow, thunderstorm, partly-sunny
Salud: fitness, medkit, pulse, thermometer, bandage
Hogar: bulb, home, flash, hammer, build
Gráficos: bar-chart, stats-chart, trending-up, trending-down, analytics
Tecnología: wifi, bluetooth, server, hardware-chip, code-slash, terminal
Otros: calendar, time, location, globe, shield, key, lock-closed, battery-full, flash
IMPORTANTE: NO inventar nombres de iconos. Usar SOLO los de esta lista. Todos son monocromáticos y optimizados para móvil.

💻 SUPERIOR USER EXPERIENCE:
- Intuitive and fluid navigation with breadcrumbs
- Elegant loading states (skeletons, spinners, progress bars)
- Immediate visual feedback for all user actions
- Forms with real-time validation and exceptional UX
- Clear, helpful error messages with solution suggestions
- Perfectly responsive design across all devices and orientations
- Full accessibility (ARIA, contrast, keyboard navigation, screen readers)

🔧 ENTERPRISE-QUALITY CODE:
- Clean, scalable, and maintainable architecture
- Reliable componentsUsable and well-documented with TypeScript
- Robust error handling with error boundaries
- Performance optimization (lazy loading, memoization, code splitting)
- SEO optimized with complete metadata and structured data
- Basic testing setup with examples
- Explanatory comments and inline documentation

📦 COMPONENTES IONIC/CAPACITOR DISPONIBLES:
Layout: IonPage, IonHeader, IonToolbar, IonContent, IonFooter, IonCard, IonCardHeader, IonCardContent, IonGrid, IonRow, IonCol
Navigation: IonTabs, IonTabBar, IonTabButton, IonBackButton, IonMenu, IonMenuButton, IonRouterOutlet
Forms: IonInput, IonTextarea, IonSelect, IonCheckbox, IonRadio, IonToggle, IonRange, IonSearchbar, IonDatetime
Buttons: IonButton, IonFab, IonFabButton, IonSegment, IonSegmentButton
Lists: IonList, IonItem, IonItemSliding, IonItemOption, IonItemDivider, IonListHeader
Feedback: IonAlert, IonLoading, IonToast, IonModal, IonPopover, IonActionSheet, IonProgressBar, IonSpinner, IonSkeletonText
Display: IonBadge, IonChip, IonAvatar, IonThumbnail, IonLabel, IonNote, IonText
Media: IonImg, IonIcon
Otros: IonRefresher, IonInfiniteScroll, IonSlides, IonAccordion
IMPORTANTE: Usar componentes de Ionic en lugar de HTML básico para mejor experiencia móvil.

🚀 ADVANCED TECHNICAL FEATURES:
- Efficient global state system (Context API or Zustand)
- Robust API integration with error handling and retry logic
- Authentication and authorization if necessary
- Basic internationalization if required
- Basic performance monitoring and analytics
- Optimized development configuration

📄 FOOTER COPYRIGHT REQUIREMENT (MANDATORY - APPLIES TO ALL FOOTERS):
- **CRÍTICO Y OBLIGATORIO**: CUALQUIER footer que generes (ya sea como componente <Footer />, componente separado, o inline <footer> dentro de app/page.tsx o cualquier página):
- El texto del copyright DEBE incluir EXACTAMENTE este texto en ESPAÑOL: "© ${new Date().getFullYear()} ${appName}. Todos los derechos reservados. Aplicación creada con www.zeus-ia.com"
- ⚠️ NUNCA uses "All rights reserved" ni ningún texto en inglés
- ⚠️ Este texto completo DEBE aparecer en TODOS los footers de la aplicación
- ⚠️ Si generas app/page.tsx con un footer inline, el copyright DEBE usar el texto especificado arriba en español

5. NAVIGATION AND PAGES RULES (CRITICAL):\n - ONLY create navigation links (in Navbar, Footer, buttons, links, etc.) to pages that ACTUALLY EXIST in the generated file structure.\n - If you include links to pages like /about, /contact, /services, /features, etc., you MUST include the corresponding page files (e.g., app/about/page.tsx, app/contact/page.tsx) in the JSON output with COMPLETE content.\n - NEVER create navigation links, buttons, or <Link> components pointing to pages that don't exist in the file list.\n - If the app only has app/page.tsx, the navigation should ONLY link to "/" or "#" — do NOT invent additional page routes.\n - Every page referenced in navigation MUST have a real file with substantial content, not empty or placeholder content.\n - When creating multi-page apps, ALWAYS include ALL pages in the file structure before adding navigation to them.\n\n6. OUTPUT JSON STRUCTURE:\n - The root key MUST be the name of the app (e.g. "my-awesome-app").\n - Within the root key, there MUST be a "files" key.\n - The "files" key MUST contain an object where the keys are the file paths and the values are the full file content.\n       - Ejemplo:\n         {\n           "my-awesome-app": {\n             "files": {\n               "package.json": "{\n                 \\"name\\":\\"my-awesome-app\\",...",\n               "app/page.tsx": "import React from \'react\'; ..."\n             }\n           }\n         }\n  `;

  stream.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'status', message: 'Obteniendo estructura de archivos...' })}`));

  let fileListResponse;
  let retryCount = 0;
  const maxRetries = 3;

  while (retryCount < maxRetries) {
    try {
      fileListResponse = await fetch(modelConfig.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${modelConfig.api_key}`
        },
        body: JSON.stringify({
          model: modelConfig.model,
          messages: [{ role: 'system', content: fileListPrompt }],
          temperature: 0.2,
        }),
        signal: AbortSignal.timeout(300000) // 5 minutos timeout
      });

      if (!fileListResponse.ok) {
        throw new Error(`AI model API error while getting file list: ${fileListResponse.status}`);
      }
      break; // Salir del bucle si la llamada fue exitosa
    } catch (error: any) {
      retryCount++;
      console.error(`Error en llamada a API del modelo (intento ${retryCount}/${maxRetries}):`, error.message);

      if (retryCount >= maxRetries) {
        stream.enqueue(encoder.encode(`data: ${JSON.stringify({
          type: 'error',
          message: `Error de conexión con el modelo de IA después de ${maxRetries} intentos: ${error.message}`
        })}\n\n`));
        throw new Error(`Error de conexión con el modelo de IA después de ${maxRetries} intentos: ${error.message}`);
      }

      // Esperar antes del siguiente intento (backoff exponencial)
      const waitTime = Math.pow(2, retryCount) * 1000; // 2s, 4s, 8s
      stream.enqueue(encoder.encode(`data: ${JSON.stringify({
        type: 'status',
        message: `Error de conexión, reintentando en ${waitTime / 1000} segundos... (${retryCount}/${maxRetries})`
      })}\n\n`));
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }

  if (!fileListResponse) {
    throw new Error('File list response is undefined');
  }
  const fileListResult = await fileListResponse.json();

  // >>> REGISTRO DE CONSUMO (File List) <<<
  if (fileListResult.usage && userId) {
    try {
      await UsageService.recordUsage(userId, {
        dbId: modelConfig.id as string,
        apiKey: modelConfig.model as string, // ✅ USAR NOMBRE DEL MODELO (chat o razonamiento)
        name: modelConfig.name as string,
        type: modelConfig.type as string
      }, {
        promptTokens: fileListResult.usage.prompt_tokens || 0,
        completionTokens: fileListResult.usage.completion_tokens || 0,
        cacheHitTokens: fileListResult.usage.prompt_cache_hit_tokens || 0,
        requestId: fileListResult.id
      });
    } catch (usageError) {
      console.error('[Usage Recording] Error registrando consumo en Lista de Archivos (Móvil):', usageError);
    }
  }

  const fileListContent = fileListResult.choices[0]?.message?.content;
  console.log('Raw AI Model File List Response (full):', fileListContent);

  let fileMap: Record<string, string | null> = normalizeFileMapShape(parseFileListContent(fileListContent), appName);
  console.log('DEBUG: fileMap after parsing:', Object.keys(fileMap));

  // Force content for critical UI and config files to prevent AI from generating incorrect versions
  fileMap['components/ui/toaster.tsx'] = `
'use client';

import { 
  Toast, 
  ToastClose, 
  ToastDescription, 
  ToastProvider, 
  ToastTitle, 
  ToastViewport 
} from './toast';  
import { useToast } from '../../hooks/use-toast';  

export function Toaster() {
  const { toasts } = useToast();

  return (
    <ToastProvider>
      {toasts.map(({ id, title, description, action, ...props }) => (
        <Toast key={id} {...props}>
          <div className="grid gap-1">
            {title && <ToastTitle>{title}</ToastTitle>}
            {description && <ToastDescription>{description}</ToastDescription>}
          </div>
          {action}
          <ToastClose />
        </Toast>
      ))}
      <ToastViewport />
    </ToastProvider>
  );
}
`;
  `;

  fileMap['components/ui/toast.tsx'] = `
  fileMap['components/ui/toast.tsx'] = `
'use client';

import * as React from 'react';
import * as ToastPrimitives from '@radix-ui/react-toast';
import { cva, type VariantProps } from 'class-variance-authority';
import { X } from 'lucide-react';

import { cn } from '../../lib/utils';

const ToastProvider = ToastPrimitives.Provider;

const ToastViewport = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Viewport>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Viewport>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Viewport
    ref={ref}
    className={cn(
      "fixed top-0 z-[100] flex max-h-screen w-full flex-col-reverse p-4 sm:bottom-0 sm:right-0 sm:flex-col md:max-w-[420px]",
      className
    )}
    {...props}
  />
));
ToastViewport.displayName = ToastPrimitives.Viewport.displayName;

const toastVariants = cva(
  "group pointer-events-auto relative flex w-full items-center justify-between space-x-4 overflow-hidden rounded-md border p-6 pr-8 shadow-lg transition-all data-[state=open]:animate-in data-[state=closed]:animate-out data-[swipe=end]:animate-out data-[state=closed]:fade-out-80 data-[state=open]:slide-in-from-top-full data-[state=open]:sm:slide-in-from-bottom-full data-[state=closed]:slide-out-to-right-full data-[swipe=end]:slide-out-to-right-full data-[swipe=start]:slide-in-from-right-full",
  {
    variants: {
      variant: {
        default:
          "border-slate-200 bg-white text-slate-950 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-50",
        destructive:
          "destructive group border-red-500 bg-red-500 text-slate-50 dark:border-red-900 dark:bg-red-900 dark:text-slate-50",
        success:
          "group border-green-500 bg-green-500 text-slate-50 dark:border-green-900 dark:bg-green-900 dark:text-slate-50",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

const Toast = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Root>
>(({ className, variant, ...props }, ref) => (
  <ToastPrimitives.Root
    ref={ref}
    className={cn(toastVariants({ variant }), className)}
    {...props}
  />
));
Toast.displayName = ToastPrimitives.Root.displayName;

const ToastAction = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Action>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Action>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Action
    ref={ref}
    className={cn(
      "inline-flex h-8 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-transparent px-3 text-sm font-medium ring-offset-white transition-colors hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-950 focus:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 group-[.destructive]:border-red-100 group-[.destructive]:hover:border-red-500 group-[.destructive]:hover:bg-red-100 group-[.destructive]:hover:text-red-900 group-[.destructive]:focus:ring-red-500 dark:border-slate-800 dark:ring-offset-slate-950 dark:hover:bg-slate-800 dark:focus:ring-slate-300 group-[.destructive]:dark:border-red-900 group-[.destructive]:dark:hover:border-red-700 group-[.destructive]:dark:hover:bg-red-900 group-[.destructive]:dark:hover:text-red-50",
      className
    )}
    {...props}
  />
));
ToastAction.displayName = ToastPrimitives.Action.displayName;

const ToastClose = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Close>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Close>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Close
    ref={ref}
    className={cn(
      "absolute right-2 top-2 rounded-md p-1 text-slate-950 opacity-0 transition-opacity hover:text-slate-950 focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-slate-950 focus:ring-offset-2 group-hover:opacity-100 dark:text-slate-50 dark:hover:text-slate-50 dark:focus:ring-slate-300",
      className
    )}
    toast-close=""
    {...props}
  >
    <X className="h-4 w-4" />
  </ToastPrimitives.Close>
));
ToastClose.displayName = ToastPrimitives.Close.displayName;

const ToastTitle = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Title>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Title>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Title
    ref={ref}
    className={cn("text-sm font-semibold", className)}
    {...props}
  />
));
ToastTitle.displayName = ToastPrimitives.Title.displayName;

const ToastDescription = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Description>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Description>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Description
    ref={ref}
    className={cn("text-sm opacity-90", className)}
    {...props}
  />
));
ToastDescription.displayName = ToastPrimitives.Description.displayName;

type ToastProps = React.ComponentPropsWithoutRef<typeof Toast>;

type ToastActionElement = React.ReactElement<typeof ToastAction>;

export {
  Toast,
  ToastAction,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
  type ToastProps,
  type ToastActionElement,
};
`

  fileMap['lib/utils.ts'] = `
import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
`;

  fileMap['lib/auth-config.ts'] = `
/**
 * Rutas de autenticación. Cambia estos valores para reutilizar en otra app.
 * También puedes usar variables de entorno: NEXT_PUBLIC_AUTH_LOGIN_PATH, etc.
 */
export const authPaths = {
  login: process.env.NEXT_PUBLIC_AUTH_LOGIN_PATH ?? '/auth/login',
  register: process.env.NEXT_PUBLIC_AUTH_REGISTER_PATH ?? '/auth/register',
  home: process.env.NEXT_PUBLIC_AUTH_HOME_PATH ?? '/',
  profile: process.env.NEXT_PUBLIC_AUTH_PROFILE_PATH ?? '/profile',
  settings: process.env.NEXT_PUBLIC_AUTH_SETTINGS_PATH ?? '/settings',
};
`;

  fileMap['lib/auth-config.tsx'] = `
/**
 * Rutas de autenticación. Cambia estos valores para reutilizar en otra app.
 * También puedes usar variables de entorno: NEXT_PUBLIC_AUTH_LOGIN_PATH, etc.
 */
export const authPaths = {
  login: process.env.NEXT_PUBLIC_AUTH_LOGIN_PATH ?? '/auth/login',
  register: process.env.NEXT_PUBLIC_AUTH_REGISTER_PATH ?? '/auth/register',
  home: process.env.NEXT_PUBLIC_AUTH_HOME_PATH ?? '/',
  profile: process.env.NEXT_PUBLIC_AUTH_PROFILE_PATH ?? '/profile',
  settings: process.env.NEXT_PUBLIC_AUTH_SETTINGS_PATH ?? '/settings',
};
`;

  fileMap['components/ui/input.tsx'] = `
'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          'flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = 'Input';

export { Input };
export default Input;
`;

  fileMap['hooks/use-toast.ts'] = `
import * as React from "react"
import { v4 as uuidv4 } from 'uuid';

import type { ToastProps } from "../components/ui/toast"

const TOAST_LIMIT = 1
const TOAST_REMOVE_DELAY = 1000000 // Keep toasts visible for a long time

type ToasterToast = ToastProps & {
  id: string
  title?: React.ReactNode
  description?: React.ReactNode
  action?: React.ReactNode
}

type State = {
  toasts: ToasterToast[]
}

enum ActionType {
  ADD_TOAST,
  UPDATE_TOAST,
  DISMISS_TOAST,
  REMOVE_TOAST,
}

type Action = 
  | { type: ActionType.ADD_TOAST; toast: ToasterToast }
  | { type: ActionType.UPDATE_TOAST; toast: ToasterToast }
  | { type: ActionType.DISMISS_TOAST; toastId?: ToasterToast["id"] }
  | { type: ActionType.REMOVE_TOAST; toastId?: ToasterToast["id"] }

const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    case ActionType.ADD_TOAST:
      return {
        ...state,
        toasts: [action.toast, ...state.toasts].slice(0, TOAST_LIMIT),
      }

    case ActionType.UPDATE_TOAST:
      return {
        ...state,
        toasts: state.toasts.map((t) =>
          t.id === action.toast.id ? { ...t, ...action.toast } : t
        ),
      }

    case ActionType.DISMISS_TOAST:
      const { toastId } = action

      // ! This is a hack to get around the fact that we can\'t use \`toastId\` directly in the reducer
      if (toastId) {
        return {
          ...state,
          toasts: state.toasts.map((t) =>
            t.id === toastId ? { ...t, open: false } : t
          ),
        }
      } else {
        return {
          ...state,
          toasts: state.toasts.map((t) =>
            t.open === false ? { ...t, open: false } : t
          ),
        }
      }

    case ActionType.REMOVE_TOAST:
      return {
        ...state,
        toasts: state.toasts.filter((t) => t.id !== action.toastId),
      }
  }
}

function genId() {
  return uuidv4();
}

function useToast() {
  const [state, dispatch] = React.useReducer(reducer, { toasts: [] })

  const dismiss = React.useCallback((toastId?: string) => {
    dispatch({ type: ActionType.DISMISS_TOAST, toastId })
  }, [])

  const addToast = React.useCallback((toast: ToasterToast) => {
    dispatch({ type: ActionType.ADD_TOAST, toast })
  }, [])

  const removeToast = React.useCallback((toastId?: string) => {
    dispatch({ type: ActionType.REMOVE_TOAST, toastId })
  }, [])

  return {
    toasts: state.toasts,
    addToast,
    dismiss,
    removeToast,
  }
}

export { useToast }
`;

  fileMap['components/Providers.tsx'] = `
'use client';

import { ThemeProvider } from 'next-themes';
import { Toaster } from './ui/toaster';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      {children}
      <Toaster />
    </ThemeProvider>
  );
}
`;

  if (selectedTemplate === 'next-js') {
    fileMap['tsconfig.json'] = `
{
  "compilerOptions": {
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [
      {
        "name": "next"
      }
    ],
    "paths": {
      "@/*": ["./components/*", "./lib/*", "./hooks/*", "./*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
`;

    const feats = features || [];
    const hasNavbar = feats.includes('authentication') || feats.includes('database') || feats.includes('chat');
    fileMap['app/layout.tsx'] = `
'use client';

import './globals.css';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { Providers } from '@/components/Providers';
${hasNavbar ? "import Navbar from '@/components/Navbar';\n" : ""}

const inter = Inter({ subsets: ['latin'] });

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  

  // Check if we're in the main application context and prevent rendering
  // if we're not supposed to show the floating chat
  const isMainApp = typeof window !== 'undefined' && (
    new URLSearchParams(window.location.search).get('mainApp') === 'true' ||
    window.location.pathname === '/editor'
  );

  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <Providers>
        ${hasNavbar ? '<Navbar />\n          ' : ''}
          {children}
          
          
        </Providers>
      </body>
    </html>
  );
}
`;

  }

  // OPTIMIZACIÓN: Limitar número de archivos según complejidad
  const maxFiles = 400; // Increased to reduce missing files in initial ZIP
  const fileMapEntries = Object.entries(fileMap);
  if (fileMapEntries.length > maxFiles) {
    console.log(`🚀 Limitando archivos de ${fileMapEntries.length} a ${maxFiles} para complejidad '${complexity}'`);
    fileMap = Object.fromEntries(fileMapEntries.slice(0, maxFiles));
  }

  // Ensure essential files are included based on complexity
  let essentialFiles = [
    'package.json',
    'app/layout.tsx',
    'app/metadata.ts',
    'app/page.tsx',
    'app/globals.css',
  ];

  // Add more files for standard and complex projects
  if (complexity !== 'simple') {
    essentialFiles.push(
      'next.config.js',
      'tsconfig.json',
      'tailwind.config.js',
      'postcss.config.js',
      'next-env.d.ts',
      'README.md'
    );
  }

  console.log(`📁 Archivos esenciales para complejidad '${complexity}':`, essentialFiles.length);

  for (const essentialFile of essentialFiles) {
    if (!(essentialFile in fileMap)) {
      fileMap[essentialFile] = null; // Add if missing, content will be generated individually
    }
  }

  const filePaths = Object.keys(fileMap); // Get all file paths to iterate over

  stream.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'status', message: `Generando ${filePaths.length} archivos...` })}`));

  const createdFiles: { filePath: string; content: string }[] = [];

  // 2. Generate each file one by one
  for (let i = 0; i < filePaths.length; i++) {
    const filePath = filePaths[i];
    let fileContent = fileMap[filePath]; // Get content from the initial map

    stream.enqueue(encoder.encode(`data: ${JSON.stringify({
      type: 'file_start',
      filePath,
      index: i + 1,
      total: filePaths.length,
      message: `Generando archivo ${i + 1}/${filePaths.length}: ${filePath}`
    })}`));

    // If content is null, generate it individually
    if (fileContent === null) {
      const fileContentPrompt = `You are an expert software development wizard specializing in creating professional, feature-rich applications. Your task is to generate COMPLETE AND FUNCTIONAL content for the specified file, ensuring that it is high-quality, well-structured, and follows best practices. ⚠️ CRITICAL RULE: PURE CODE ONLY, NO EXPLANATIONS, ADDITIONAL COMMENTS, OR MARKDOWN BLOCKS. Provide ONLY the pure code. Imports must be at the beginning of the file and correct.\n\n⚠️ CRITICAL RULE: NEVER GENERATE EMPTY OR MINIMAL CONTENT\n⚠️ The file MUST have substantial, fully functional content\n⚠️ If a React component, it must include full JSX and styles\n⚠️ If a CSS file, it must include base styles and variables\n⚠️ If a config file, it must be fully configured\n\n⚠️ CRITICAL NAVIGATION RULE:\n- ONLY create links, buttons, or navigation items pointing to pages that ACTUALLY EXIST in the project.\n- If the current file list does NOT include app/about/page.tsx, app/contact/page.tsx, or similar pages, do NOT create links to /about, /contact, etc.\n- Navigation (Navbar, Footer, buttons) should ONLY link to existing pages. If unsure, link to "/" or use scroll-to-section anchors instead.\n- NEVER invent page routes that don't exist in the file structure.\n\n--- Project Specifics ---\nApp Name: ${appName}\nOverview: ${description}\nFramework: Next.js 13+ with App Router\nStyles: Tailwind CSS\n---\n\n--- File to Generate ---\nFile Path: ${filePath}\n---\n\n--- File Type Specific Validations ---
If the file is app/page.tsx or src/App.jsx:
- MUST contain a complete React component with substantial JSX
- MUST include attractive and functional visual elements
- MUST use Tailwind CSS for styling
- MUST be fully functional out of the box
- ⚠️ CRITICAL: NEVER use the 'next/head' Head component in App Router
- ⚠️ CRITICAL: DO NOT use JSX fragments (<>) with Head components
- ⚠️ CRITICAL: Metadata is ONLY in app/metadata.ts. Do NOT export metadata or generateMetadata in app/page.tsx.
- ⚠️ CRITICAL: If you need dynamic metadata, define it in app/metadata.ts or re-export from layout.
- ⚠️ CRITICAL FOOTER COPYRIGHT: If the page includes a footer (either as a separate component or inline JSX), the copyright text MUST be EXACTLY this in SPANISH: "© ${new Date().getFullYear()} ${appName}. Todos los derechos reservados. Aplicación creada con www.zeus-ia.com"
- ⚠️ DO NOT use "All rights reserved" or any English text. The footer copyright MUST use the exact Spanish text specified above.

If the file is app/globals.css or src/index.css: - MUST include @tailwind directives (base, components, utilities). MUST contain custom CSS variables. MUST include base styles for the body, HTML, etc.. MUST be at least 50 lines of useful content. If the file is a component:
- MUST be fully implemented.
- MUST include props, state, and logic as needed.
- MUST have styles applied.
- MUST be reusable and well documented.
- ⚠️ CRITICAL: NEVER import or use Head from 'next/head'.
- ⚠️ CRITICAL: DO NOT use JSX fragments (<>) with head/meta elements.
- ⚠️ CRITICAL: Components should NOT handle metadata directly.
  SPECIAL RULES FOR layout header/footer (components/layout/header.tsx and components/layout/footer.tsx):
  - Prohibit patterns like useAudioPlayer[0] or indexing hook results; always destructure hook tuples or return objects.
  - Do not use setState incorrectly; only use the setter returned by useState.
  - If interactive, add exactly one "use client" directive at the very top; never more than once.
  - Avoid server-only modules and ensure imports are compatible with client components.
  - Keep typings strict and avoid any implicit any.
  - ⚠️ CRITICAL FOOTER COPYRIGHT: The footer copyright text MUST be EXACTLY: "© ${new Date().getFullYear()} ${appName}. Todos los derechos reservados. Aplicación creada con www.zeus-ia.com" (in SPANISH, NOT English).
  - ⚠️ DO NOT use "All rights reserved" or any English copyright text. Use ONLY the exact Spanish text specified above.
5. Optimize for performance where possible (lazy loading, memoization, etc.).
6. For UI components, implement clear visual states (hover, active, focus, disabled).
7. For configuration files, include optimized and well-documented options.
8. For style files, use CSS variables and a consistent design system.
9. ⚠️ CRITICAL: Use ONLY Next.js 13+ App Router features - DO NOT mix with Pages Router.
10. FINAL VALIDATION: Verify that generated content is non-empty and substantial.\n---`;

      if (filePath === 'package.json') {
        fileContent = getPackageJsonContent(selectedTemplate, appName, authMethod, features);        // Apply verification immediately after generating package.json content
        fileContent = verifyPackageJsonDependencies(fileContent);
        console.log('Forcing package.json content based on template and verified dependencies.');
      } else if (filePath === 'next.config.js' && selectedTemplate === 'next-js') {
        fileContent = `/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  turbopack: {},
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'zeus-basedatos-2.fly.dev',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
        port: '',
        pathname: '/**',
      },
    ],
  },
  
  // Configuración de webpack personalizada si es necesario
  webpack: (config, { isServer }) => {
    // Personalizaciones aquí si son necesarias
    // Add alias for '@/'. This is crucial for resolving absolute imports.
    config.resolve.alias['@'] = require('path').join(__dirname, './');
    return config
  },
  
  // Configuración de headers de seguridad
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
        ],
      },
    ]
  },
}

module.exports = nextConfig`;
        console.log('Forcing next.config.js content for Next.js template.');
      } else if (filePath === 'vite.config.js') {
        fileContent = `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './', // Para rutas relativas
  
  // Configuración del servidor de desarrollo
  server: {
    port: 5173,
    open: true, // Abre automáticamente el navegador
    cors: true, // Habilita CORS
    hmr: {
      overlay: true, // Overlay de errores en desarrollo
    },
  },
  
  // Resolución de alias para importaciones más limpias
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@components': path.resolve(__dirname, './src/components'),
      '@assets': path.resolve(__dirname, './src/assets'),
      '@styles': path.resolve(__dirname, './src/styles'),
    },
  },
  
  // Optimizaciones de build
  build: {
    outDir: 'dist',
    minify: 'terser',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          // Añade más chunks según sea necesario
        },
      },
    },
  },
  
  // Configuración de CSS
  css: {
    preprocessorOptions: {
      scss: {
        additionalData: '@import "@/styles/variables.scss";'
      },
    },
  },
})`;
        console.log('Forcing vite.config.js content for any Vite project to use port 5173.');
      } else if (filePath === 'components/ui/toaster.tsx') { // Add this new condition
        fileContent = `
'use client';

import { Toast, ToastClose, ToastDescription, ToastProvider, ToastTitle, ToastViewport } from '@/components/ui/toast';
import { useToast } from '@/hooks/use-toast';

export function Toaster() {
  const { toasts } = useToast();

  return (
    <ToastProvider>
      {toasts.map(function ({ id, title, description, action, ...props }) {
        return (
          <Toast key={id} {...props}>
            <div className="grid gap-1">
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && (
                <ToastDescription>{description}</ToastDescription>
              )}
            </div>
            {action}
            <ToastClose />
          </Toast>
        );
      })}
      <ToastViewport />
    </ToastProvider>
  );
}
`;
        console.log('Forcing components/ui/toaster.tsx content for correct Radix UI import.');
      } else if (filePath === 'tsconfig.json' && selectedTemplate === 'next-js') {
        fileContent = `
{
  "compilerOptions": {
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [
      {
        "name": "next"
      }
    ],
    "paths": {
      "@/*": ["./components/*", "./lib/*", "./hooks/*", "./*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
`;
        console.log('Forcing tsconfig.json content for Next.js template.');
      } else if (filePath === 'components/ui/toast.tsx') { // Add this new condition
        fileContent = `
'use client';

import * as React from 'react';
import * as ToastPrimitives from '@radix-ui/react-toast';
import { cva, type VariantProps } from 'class-variance-authority';
import { X } from 'lucide-react';

import { cn } from '@/lib/utils';

const ToastProvider = ToastPrimitives.Provider;

const ToastViewport = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Viewport>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Viewport>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Viewport
    ref={ref}
    className={cn(
      "fixed top-0 z-[100] flex max-h-screen w-full flex-col-reverse p-4 sm:bottom-0 sm:right-0 sm:flex-col md:max-w-[420px]",
      className
    )}
    {...props}
  />
));
ToastViewport.displayName = ToastPrimitives.Viewport.displayName;

const toastVariants = cva(
  "group pointer-events-auto relative flex w-full items-center justify-between space-x-4 overflow-hidden rounded-md border p-6 pr-8 shadow-lg transition-all data-[state=open]:animate-in data-[state=closed]:animate-out data-[swipe=end]:animate-out data-[state=closed]:fade-out-80 data-[state=open]:slide-in-from-top-full data-[state=open]:sm:slide-in-from-bottom-full data-[state=closed]:slide-out-to-right-full data-[swipe=end]:slide-out-to-right-full data-[swipe=start]:slide-in-from-right-full",
  {
    variants: {
      variant: {
        default:
          "border-slate-200 bg-white text-slate-950 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-50",
        destructive:
          "destructive group border-red-500 bg-red-500 text-slate-50 dark:border-red-900 dark:bg-red-900 dark:text-slate-50",
        success:
          "group border-green-500 bg-green-500 text-slate-50 dark:border-green-900 dark:bg-green-900 dark:text-slate-50",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

const Toast = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Root> & VariantProps<typeof toastVariants>
>(({ className, variant, ...props }, ref) => {
  return (
    <ToastPrimitives.Root
      ref={ref}
      className={cn(toastVariants({ variant }), className)}
      {...props}
    />
  );
});
Toast.displayName = ToastPrimitives.Root.displayName;

const ToastAction = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Action>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Action>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Action
    ref={ref}
    className={cn(
      "inline-flex h-8 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-transparent px-3 text-sm font-medium ring-offset-white transition-colors hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-950 focus:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 group-[.destructive]:border-red-100 group-[.destructive]:hover:border-red-50 group-[.destructive]:hover:bg-red-50 group-[.destructive]:hover:text-red-900 group-[.destructive]:focus:ring-red-500 dark:border-slate-800 dark:ring-offset-slate-950 dark:hover:bg-slate-800 dark:focus:ring-slate-300 dark:group-[.destructive]:border-red-900 dark:group-[.destructive]:hover:border-red-900 dark:group-[.destructive]:hover:bg-red-900 dark:group-[.destructive]:hover:text-red-50",
      className
    )}
    {...props}
  />
));
ToastAction.displayName = ToastPrimitives.Action.displayName;

const ToastClose = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Close>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Close>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Close
    ref={ref}
    className={cn(
      "absolute right-2 top-2 rounded-md p-1 text-slate-950 opacity-0 transition-opacity hover:bg-slate-100 focus:opacity-100 focus:outline-none focus:ring-2 group-hover:opacity-100 group-[.destructive]:text-red-300 group-[.destructive]:hover:bg-red-900 group-[.destructive]:hover:text-red-50 dark:text-slate-50 dark:hover:bg-slate-800 dark:group-[.destructive]:text-red-300 dark:group-[.destructive]:hover:bg-red-900 dark:group-[.destructive]:hover:text-red-50",
      className
    )}
    toast-close=""
    {...props}
  >
    <X className="h-4 w-4" />
  </ToastPrimitives.Close>
));
ToastClose.displayName = ToastPrimitives.Close.displayName;

const ToastTitle = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Title>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Title>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Title
    ref={ref}
    className={cn("text-sm font-semibold", className)}
    {...props}
  />
));
ToastTitle.displayName = ToastPrimitives.Title.displayName;

const ToastDescription = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Description>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Description>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Description
    ref={ref}
    className={cn("text-sm opacity-90", className)}
    {...props}
  />
));
ToastDescription.displayName = ToastPrimitives.Description.displayName;

type ToastProps = React.ComponentPropsWithoutRef<typeof Toast>;

type ToastActionElement = React.ReactElement<typeof ToastAction>;

export {
  ToastProvider,
  ToastViewport,
  Toast,
  ToastTitle,
  ToastDescription,
  ToastClose,
  ToastAction,
};
`;
        console.log('Forcing components/ui/toast.tsx content.');
      } else if (filePath === 'hooks/use-toast.ts') { // Add this new condition
        fileContent = `
import * as React from "react"
import { v4 as uuidv4 } from 'uuid';

import type { ToastProps } from "@/components/ui/toast"

const TOAST_LIMIT = 1
const TOAST_REMOVE_DELAY = 1000000 // Keep toasts visible for a long time

type ToasterToast = ToastProps & {
  id: string
  title?: React.ReactNode
  description?: React.ReactNode
  action?: React.ReactNode
}

type State = {
  toasts: ToasterToast[]
}

enum ActionType {
  ADD_TOAST,
  UPDATE_TOAST,
  DISMISS_TOAST,
  REMOVE_TOAST,
}

type Action = 
  | { type: ActionType.ADD_TOAST; toast: ToasterToast }
  | { type: ActionType.UPDATE_TOAST; toast: ToasterToast }
  | { type: ActionType.DISMISS_TOAST; toastId?: ToasterToast["id"] }
  | { type: ActionType.REMOVE_TOAST; toastId?: ToasterToast["id"] }

const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    case ActionType.ADD_TOAST:
      return {
        ...state,
        toasts: [action.toast, ...state.toasts].slice(0, TOAST_LIMIT),
      }

    case ActionType.UPDATE_TOAST:
      return {
        ...state,
        toasts: state.toasts.map((t) =>
          t.id === action.toast.id ? { ...t, ...action.toast } : t
        ),
      }

    case ActionType.DISMISS_TOAST:
      const { toastId } = action

      // ! This is a hack to get around the fact that we can\\'t use \`toastId\` directly in the reducer
      if (toastId) {
        return {
          ...state,
          toasts: state.toasts.map((t) =>
            t.id === toastId ? { ...t, open: false } : t
          ),
        }
      } else {
        return {
          ...state,
          toasts: state.toasts.map((t) =>
            t.open === false ? { ...t, open: false } : t
          ),
        }
      }

    case ActionType.REMOVE_TOAST:
      return {
        ...state,
        toasts: state.toasts.filter((t) => t.id !== action.toastId),
      }
  }
}

function genId() {
  return uuidv4();
}

function useToast() {
  const [state, dispatch] = React.useReducer(reducer, { toasts: [] })

  const dismiss = React.useCallback((toastId?: string) => {
    dispatch({ type: ActionType.DISMISS_TOAST, toastId })
  }, [])

  const addToast = React.useCallback((toast: ToasterToast) => {
    dispatch({ type: ActionType.ADD_TOAST, toast })
  }, [])

  const removeToast = React.useCallback((toastId?: string) => {
    dispatch({ type: ActionType.REMOVE_TOAST, toastId })
  }, [])

  return {
    toasts: state.toasts,
    addToast,
    dismiss,
    removeToast,
  }
}

export { useToast }
`;
        console.log('Forcing hooks/use-toast.ts content.');
      } else if (filePath === 'components/ui/use-toast.ts') { // Add this new condition
        fileContent = `
import * as React from "react"
import { v4 as uuidv4 } from 'uuid';

import type { ToastProps } from "@/components/ui/toast"

const TOAST_LIMIT = 1
const TOAST_REMOVE_DELAY = 1000000 // Keep toasts visible for a long time

type ToasterToast = ToastProps & {
  id: string
  title?: React.ReactNode
  description?: React.ReactNode
  action?: React.ReactNode
}

type State = {
  toasts: ToasterToast[]
}

enum ActionType {
  ADD_TOAST,
  UPDATE_TOAST,
  DISMISS_TOAST,
  REMOVE_TOAST,
}

type Action = 
  | { type: ActionType.ADD_TOAST; toast: ToasterToast }
  | { type: ActionType.UPDATE_TOAST; toast: ToasterToast }
  | { type: ActionType.DISMISS_TOAST; toastId?: ToasterToast["id"] }
  | { type: ActionType.REMOVE_TOAST; toastId?: ToasterToast["id"] }

const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    case ActionType.ADD_TOAST:
      return {
        ...state,
        toasts: [action.toast, ...state.toasts].slice(0, TOAST_LIMIT),
      }

    case ActionType.UPDATE_TOAST:
      return {
        ...state,
        toasts: state.toasts.map((t) =>
          t.id === action.toast.id ? { ...t, ...action.toast } : t
        ),
      }

    case ActionType.DISMISS_TOAST:
      const { toastId } = action

      // ! This is a hack to get around the fact that we can\\'t use \`toastId\` directly in the reducer
      if (toastId) {
        return {
          ...state,
          toasts: state.toasts.map((t) =>
            t.id === toastId ? { ...t, open: false } : t
          ),
        }
      } else {
        return {
          ...state,
          toasts: state.toasts.map((t) =>
            t.open === false ? { ...t, open: false } : t
          ),
        }
      }

    case ActionType.REMOVE_TOAST:
      return {
        ...state,
        toasts: state.toasts.filter((t) => t.id !== action.toastId),
      }
  }
}

function genId() {
  return uuidv4();
}

function useToast() {
  const [state, dispatch] = React.useReducer(reducer, { toasts: [] })

  const dismiss = React.useCallback((toastId?: string) => {
    dispatch({ type: ActionType.DISMISS_TOAST, toastId })
  }, [])

  const addToast = React.useCallback((toast: ToasterToast) => {
    dispatch({ type: ActionType.ADD_TOAST, toast })
  }, [])

  const removeToast = React.useCallback((toastId?: string) => {
    dispatch({ type: ActionType.REMOVE_TOAST, toastId })
  }, [])

  return {
    toasts: state.toasts,
    addToast,
    dismiss,
    removeToast,
  }
}

export { useToast }
`;
        console.log('Forcing hooks/use-toast.ts content.');
      } else if (filePath === 'app/layout.tsx' && selectedTemplate === 'next-js') { // Add Capacitor initialization to Next.js layout
        // First, get the AI-generated content
        let fileContentResponse;
        let fileRetryCount = 0;
        const fileMaxRetries = 2;
        let shouldSkipFile = false;

        while (fileRetryCount < fileMaxRetries && !shouldSkipFile) {
          try {
            fileContentResponse = await fetch(modelConfig.url, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${modelConfig.api_key}`
              },
              body: JSON.stringify({
                model: modelConfig.model,
                messages: [{ role: 'system', content: fileContentPrompt }],
                temperature: 0.4,
                max_tokens: 8192,
              }),
              signal: AbortSignal.timeout(120000) // 2 minutos para archivos individuales
            });

            if (!fileContentResponse.ok) {
              throw new Error(`AI model API error: ${fileContentResponse.status}`);
            }
            break; // Salir del bucle si la llamada fue exitosa
          } catch (error: any) {
            fileRetryCount++;
            console.warn(`Error al generar contenido para ${filePath} (intento ${fileRetryCount}/${fileMaxRetries}):`, error.message);

            if (fileRetryCount >= fileMaxRetries) {
              console.warn(`Saltando archivo ${filePath} después de ${fileMaxRetries} intentos fallidos.`);
              stream.enqueue(encoder.encode(`data: ${JSON.stringify({
                type: 'file_error',
                filePath,
                message: `Error al generar ${filePath} después de ${fileMaxRetries} intentos`
              })}`));
              shouldSkipFile = true;
              console.log(`DEBUG: Archivo ${filePath} omitido debido a errores de generación.`);
              break;
            }

            // Esperar antes del siguiente intento
            const fileWaitTime = 2000; // 2 segundos para archivos individuales
            await new Promise(resolve => setTimeout(resolve, fileWaitTime));
          }
        }

        if (shouldSkipFile) {
          continue;
        }

        const fileContentResult = await fileContentResponse?.json() ?? { choices: [] };

        // >>> REGISTRO DE CONSUMO (File Content) <<<
        if (fileContentResult.usage && userId) {
          try {
            await UsageService.recordUsage(userId, {
              dbId: modelConfig.id as string,
              apiKey: modelConfig.model as string, // ✅ USAR NOMBRE DEL MODELO
              name: modelConfig.name as string,
              type: modelConfig.type as string
            }, {
              promptTokens: fileContentResult.usage.prompt_tokens || 0,
              completionTokens: fileContentResult.usage.completion_tokens || 0,
              cacheHitTokens: fileContentResult.usage.prompt_cache_hit_tokens || 0,
              requestId: fileContentResult.id
            });
          } catch (usageError) {
            console.error(`[Usage Recording] Error registrando consumo en archivo ${filePath} (Móvil):`, usageError);
          }
        }

        fileContent = fileContentResult.choices[0]?.message?.content.trim();
        console.log('Raw AI Model File Content Response for ' + filePath + ':', fileContent);

        // Clean up potential markdown code blocks that might still appear
        fileContent = (fileContent ?? '').replace(/^```[a-zA-Z]*\n/, '').replace(/\n```$/, '');

        // Add Capacitor initialization to the layout
        if (fileContent && fileContent.includes('export default function RootLayout')) {
          // Insert Capacitor initialization after the imports
          const capacitorInit = `
import { Capacitor } from '@capacitor/core';

// Initialize Capacitor if running in a native environment
if (typeof window !== 'undefined' && Capacitor.isNativePlatform()) {
  console.log('Running in Capacitor native environment');
  // Additional native-specific initialization can go here
}
`;

          // Insert after the last import statement
          const importEndIndex = fileContent.lastIndexOf('import ') + fileContent.substring(fileContent.lastIndexOf('import ')).indexOf(';') + 1;
          if (importEndIndex > 0) {
            fileContent = fileContent.substring(0, importEndIndex) + capacitorInit + fileContent.substring(importEndIndex);
          }
        }

        console.log('Forcing app/layout.tsx content with Capacitor initialization.');
      } else {
        let fileContentResponse;
        let fileRetryCount = 0;
        const fileMaxRetries = complexity === 'simple' ? 1 : 2; // Menos reintentos para proyectos simples
        let shouldSkipFile = false;

        while (fileRetryCount < fileMaxRetries && !shouldSkipFile) {
          try {
            fileContentResponse = await fetch(modelConfig.url, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${modelConfig.api_key}`
              },
              body: JSON.stringify({
                model: modelConfig.model,
                messages: [{ role: 'system', content: fileContentPrompt }],
                temperature: 0.4,
                max_tokens: 8192,
              }),
              signal: AbortSignal.timeout(120000) // 2 minutos para archivos individuales
            });

            if (!fileContentResponse.ok) {
              throw new Error(`AI model API error: ${fileContentResponse.status}`);
            }
            break; // Salir del bucle si la llamada fue exitosa
          } catch (error: any) {
            fileRetryCount++;
            console.warn(`Error al generar contenido para ${filePath} (intento ${fileRetryCount}/${fileMaxRetries}):`, error.message);

            if (fileRetryCount >= fileMaxRetries) {
              console.warn(`Saltando archivo ${filePath} después de ${fileMaxRetries} intentos fallidos.`);
              stream.enqueue(encoder.encode(`data: ${JSON.stringify({
                type: 'file_error',
                filePath,
                message: `Error al generar ${filePath} después de ${fileMaxRetries} intentos`
              })}`));
              shouldSkipFile = true;
              console.log(`DEBUG: Archivo ${filePath} omitido debido a errores de generación.`);
              break;
            }

            // Esperar antes del siguiente intento
            const fileWaitTime = 2000; // 2 segundos para archivos individuales
            await new Promise(resolve => setTimeout(resolve, fileWaitTime));
          }
        }

        if (shouldSkipFile) {
          continue;
        }

        const fileContentResult = await fileContentResponse?.json() ?? { choices: [] };

        // >>> REGISTRO DE CONSUMO (File Content) <<<
        if (fileContentResult.usage && userId) {
          try {
            await UsageService.recordUsage(userId, {
              dbId: modelConfig.id as string,
              apiKey: modelConfig.model as string, // ✅ USAR NOMBRE DEL MODELO
              name: modelConfig.name as string,
              type: modelConfig.type as string
            }, {
              promptTokens: fileContentResult.usage.prompt_tokens || 0,
              completionTokens: fileContentResult.usage.completion_tokens || 0,
              cacheHitTokens: fileContentResult.usage.prompt_cache_hit_tokens || 0,
              requestId: fileContentResult.id
            });
          } catch (usageError) {
            console.error(`[Usage Recording] Error registrando consumo en archivo ${filePath} (Móvil):`, usageError);
          }
        }

        fileContent = fileContentResult.choices[0]?.message?.content.trim();
        console.log('Raw AI Model File Content Response for ' + filePath + ':', fileContent);

        // Clean up potential markdown code blocks that might still appear
        fileContent = (fileContent ?? '').replace(/^```[a-zA-Z]*\n/, '').replace(/\n```$/, '');
        // Eliminar cualquier '//' inicial que pueda añadir el modelo
        if (fileContent.startsWith('//')) {
          fileContent = fileContent.substring(2).trimStart();
        }
      }
    }

    // Remove metadata/generateMetadata from app/page.tsx (metadata lives in app/metadata.ts only)
    if (filePath === 'app/page.tsx') {
      const beforeMeta = fileContent;
      fileContent = fileContent.replace(/(^|\n)\s*export\s+const\s+metadata\s*=\s*\{[\s\S]*?\};\s*/m, '$1');
      fileContent = fileContent.replace(/(^|\n)\s*export\s+(?:async\s+)?function\s+generateMetadata\s*\([^)]*\)\s*\{[\s\S]*?\n\}\s*/m, '$1');
      if (fileContent !== beforeMeta) {
        console.log('✅ Removed metadata/generateMetadata from app/page.tsx (use app/metadata.ts)');
      }
    }

    // Send file content in chunks for real-time display
    const lines = fileContent.split('\n');
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex];
      stream.enqueue(encoder.encode(`data: ${JSON.stringify({
        type: 'file_line',
        line: escapeJsonString(line),
        lineIndex: lineIndex + 1,
        totalLines: lines.length
      })}`));

      // Small delay to make the effect visible
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    // Sanitize auth-config to prevent AI from overriding home path
    if (filePath.endsWith('auth-config.ts') || filePath.endsWith('auth-config.tsx')) {
      fileContent = fileContent.replace(/home\s*:\s*(?:process\.env\.[A-Z0-9_]+\s*\?\?\s*)?['"]\/dashboard['"]/g, "home: '/'");
    }

    // Add file to createdFiles array with relative path
    createdFiles.push({
      filePath: filePath, // Store relative path for ZIP structure
      content: fileContent
    });

    stream.enqueue(encoder.encode(`data: ${JSON.stringify({
      type: 'file_complete',
      filePath,
      content: escapeJsonString(fileContent),
      message: `Archivo ${filePath} generado`
    })}`));

    console.log(`Successfully generated file: ${filePath}`);
  }

  // Clean up files that don't belong to this application type
  stream.enqueue(encoder.encode(`data: ${JSON.stringify({
    type: 'status',
    message: 'Limpiando archivos incompatibles...'
  })}`));

  try {
    // await cleanupIncompatibleFiles(targetPath, selectedTemplate); // Comentado para depuración
    stream.enqueue(encoder.encode(`data: ${JSON.stringify({
      type: 'status',
      message: 'Limpieza completada'
    })}`));
  } catch (error: any) {
    console.warn('Error during cleanup:', error);
    stream.enqueue(encoder.encode(`data: ${JSON.stringify({
      type: 'warning',
      message: 'Advertencia: No se pudieron limpiar algunos archivos incompatibles'
    })}`));
  }

  // Add Capacitor configuration files to the created files
  const capacitorFiles = generateCapacitorConfig(appName);
  for (const [relativePath, content] of Object.entries(capacitorFiles)) {
    createdFiles.push({
      filePath: relativePath,
      content: content
    });
  }

  // Persistir físicamente los archivos de Capacitor (incluye android/*)
  try {
    for (const [relativePath, content] of Object.entries(capacitorFiles)) {
      const fullPath = path.join(targetPath, relativePath);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content, 'utf8');
    }
    console.log('✅ Archivos de Capacitor escritos en disco');
  } catch (e: any) {
    console.warn('No se pudieron escribir archivos de Capacitor en disco:', e?.message);
  }

  // ✅ ZIP saving to PocketBase has been disabled per user request
  console.log('[generate-app-movil] 💾 Guardado de ZIP en PocketBase deshabilitado. Archivos disponibles en disco local.');

  // ✅ AHORA SÍ enviar el evento 'complete'
  stream.enqueue(encoder.encode(`data: ${JSON.stringify({
    type: 'complete',
    message: `Aplicación '${appName}' generada exitosamente con ${createdFiles.length} archivos`,
    createdFiles
  })}`))

  // Verify and fix package.json content if it exists
  const packageJsonIndex = createdFiles.findIndex(file => file.filePath === 'package.json');
  if (packageJsonIndex !== -1) {
    const fixedContent = verifyPackageJsonDependencies(createdFiles[packageJsonIndex].content);
    if (fixedContent !== createdFiles[packageJsonIndex].content) {
      createdFiles[packageJsonIndex].content = fixedContent;
      console.log('✅ Fixed package.json dependencies');
    }
  }

  // ✅ Add start-pocketbase.js script
  const startPocketbaseContent = `#!/usr/bin/env node

/**
 * start-pocketbase.js
 * 
 * Script de ayuda para iniciar PocketBase dentro de los proyectos generados.
 * - Busca el ejecutable dentro de la carpeta "pocket-base"
 * - Lanza "pocketbase serve" heredando stdin/stdout
 * - No modifica datos ni estructura, solo arranca el servidor
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const pocketBaseDir = path.join(process.cwd(), 'pocket-base');
const executableName = process.platform === 'win32' ? 'pocketbase.exe' : 'pocketbase';
const executablePath = path.join(pocketBaseDir, executableName);

if (!fs.existsSync(executablePath)) {
  console.error('❌ No se encontró el ejecutable de PocketBase en:', executablePath);
  console.error('Asegúrate de haber ejecutado primero el script de instalación de PocketBase.');
  process.exit(1);
}

console.log('🚀 Iniciando PocketBase desde:', executablePath);

const child = spawn(executablePath, ['serve', '--http=0.0.0.0:8090'], {
  cwd: pocketBaseDir,
  stdio: 'inherit',
});

child.on('exit', (code) => {
  console.log('PocketBase finalizó con código:', code);
  process.exit(code ?? 0);
});
`;

  // Solo añadir start-pocketbase.js si se seleccionó authentication, database o chat
  if (needsPocketBase(features)) {
    const startPocketbaseIndex = createdFiles.findIndex(file => file.filePath === 'scripts/start-pocketbase.js');
    if (startPocketbaseIndex === -1) {
      createdFiles.push({
        filePath: 'scripts/start-pocketbase.js',
        content: startPocketbaseContent
      });
      console.log('✅ Added scripts/start-pocketbase.js to generated files');

      stream.enqueue(encoder.encode(`data: ${JSON.stringify({
        type: 'file_complete',
        filePath: 'scripts/start-pocketbase.js',
        content: escapeJsonString(startPocketbaseContent),
        message: 'Archivo scripts/start-pocketbase.js generado'
      })}`));
    } else {
      createdFiles[startPocketbaseIndex].content = startPocketbaseContent;
      console.log('✅ Updated scripts/start-pocketbase.js in generated files');
    }
  }

  // Automatically install dependencies for mobile apps
  if (appName) {
    try {
      console.log('📦 Installing dependencies for mobile app...');
      stream.enqueue(encoder.encode(`data: ${JSON.stringify({
        type: 'status',
        message: 'Installing dependencies for mobile app...'
      })}`));

      const { execSync } = require('child_process');
      execSync('npm install', { cwd: targetPath, stdio: 'pipe' });
      console.log('✅ Dependencies installed successfully');

      // Add Android platform for Capacitor solo si no existe
      const androidPath = path.join(targetPath, 'android');
      if (!fsSync.existsSync(androidPath)) {
        console.log('📱 Adding Android platform for Capacitor...');
        stream.enqueue(encoder.encode(`data: ${JSON.stringify({
          type: 'status',
          message: 'Adding Android platform for Capacitor...'
        })}`));
        execSync('npx cap add android', { cwd: targetPath, stdio: 'pipe' });
        console.log('✅ Android platform added successfully');
      } else {
        console.log('ℹ️ Android platform already exists, skipping add');
      }

      // cap sync android
      stream.enqueue(encoder.encode(`data: ${JSON.stringify({
        type: 'status',
        message: 'Syncing Capacitor Android...'
      })}`));
      execSync('npx cap sync android', { cwd: targetPath, stdio: 'pipe' });

      // Normalizar Gradle moderno y re-sync
      await ensureModernAndroidTemplate(targetPath, appName);
      execSync('npx cap sync android', { cwd: targetPath, stdio: 'pipe' });

      stream.enqueue(encoder.encode(`data: ${JSON.stringify({
        type: 'status',
        message: 'Mobile app setup completed successfully (Android normalized)!'
      })}`));
    } catch (installError: any) {
      console.error('❌ Error installing dependencies:', installError.message);
      stream.enqueue(encoder.encode(`data: ${JSON.stringify({
        type: 'warning',
        message: 'Warning: Could not install dependencies automatically. Please run "npm install" manually.'
      })}`));
      // Don't throw the error, just log it as the app generation was successful
    }
  }

  // ✅ ZIP saving to PocketBase has been disabled per user request
  console.log('[generate-app-movil] 💾 Guardado de ZIP en PocketBase deshabilitado. Archivos disponibles en disco local.');
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const stream = searchParams.get('stream');
    const projectId = searchParams.get('projectId');

    if (stream !== 'true' || !projectId) {
      return NextResponse.json({
        error: 'Streaming requires stream=true and projectId parameters'
      }, { status: 400 });
    }

    const encoder = new TextEncoder();
    const streamResponse = new ReadableStream({
      async start(controller) {
        try {
          // Send initial connection message
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            type: 'connected',
            message: 'Streaming connection established'
          })}`));

          // Keep connection alive
          // The stream will be closed by the POST request when generation is complete or errors.

        } catch (error: any) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            type: 'error',
            message: error.message
          })}`));
          controller.close();
        }
      }
    });

    return new Response(streamResponse, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error: any) {
    console.error('Error in GET generate-app:', error);
    return NextResponse.json({
      message: 'Error interno del servidor.',
      error: error.message
    }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const requestBody = await request.json();

    const {
      appType,
      language,
      description,
      template: selectedTemplate, // Renamed to selectedTemplate
      modelId,
      requiresAuth,
      authMethod,
      requiresDatabase,
      databaseType,
      title,
      stream = false,
      userId, // Añadir userId aquí
      userToken,
      projectRoot, // Añadir projectRoot aquí
      complexity = 'standard', // Añadir complexity con valor por defecto
      features = [], // authentication, database, chat - para scripts condicionales
      // Configuración de streaming
    } = requestBody;

    const appName = (title && title.trim() !== '')
      ? title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-*|-*$/g, '')
      : description.toLowerCase().substring(0, 30).replace(/[^a-z0-9]+/g, '-').replace(/^-*|-*$/g, '') || 'mi-app';

    if (stream) {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          try {
            const modelConfig = await getModelConfig(modelId, userId);
            if (!modelConfig) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', message: 'Modelo no encontrado' })}`));
              controller.close();
              return;
            }
            await handleStreamingAppGeneration(
              description,
              modelConfig,
              projectRoot, // Pass projectRoot to handleStreamingAppGeneration for client-side saving
              appName,
              description,
              controller,
              selectedTemplate,
              complexity, // Pasar complexity a la función
              requestBody.projectId, // Pass projectId
              authMethod,
              request.url,
              userToken,
              features, // Para scripts condicionales (pocket-base)
              userId,
            );
          } catch (error: any) {
            console.error('Error in ReadableStream start:', error);
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', message: error.message })}`));
            controller.close();
          }
        }
      });

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      });
    }

    // Usar directamente el projectRoot para guardar los archivos
    const targetPath = projectRoot;

    await fs.mkdir(targetPath, { recursive: true });

    // Modo de operación desde el formulario: 'update' | 'create'
    const mode: 'update' | 'create' | undefined = (requestBody as any)?.mode;

    // Salvaguarda: si es update, validar marcador y ruta
    if (mode === 'update') {
      const markerPath = path.join(targetPath, '.zeus-app.json');
      if (!fsSync.existsSync(markerPath)) {
        return NextResponse.json({
          message: 'Proyecto no gestionado por Zeus (falta marcador .zeus-app.json). Operación cancelada.'
        }, { status: 400 });
      }

      // Actualizar archivos de entorno de forma segura
      try {
        const envEff = getEffectiveEnvUpdate(requestBody);
        const envRes = await ensureEnvFiles(targetPath, envEff);
        console.log('Env files ensured (update mode):', envRes);
      } catch (e: any) {
        console.warn('Could not update env files in update mode:', e?.message);
      }

      // Verificar y corregir package.json desde disco si existe
      try {
        const pkgPath = path.join(targetPath, 'package.json');
        if (fsSync.existsSync(pkgPath)) {
          const pkgRaw = await fs.readFile(pkgPath, 'utf8');
          const fixed = verifyPackageJsonDependencies(pkgRaw);
          if (fixed !== pkgRaw) {
            await fs.writeFile(pkgPath, fixed, 'utf8');
            console.log('✅ Fixed package.json dependencies (update mode)');
          }
        }
      } catch (e: any) {
        console.warn('Could not verify/update package.json in update mode:', e?.message);
      }

      // Intentar sincronizar Capacitor Android si existe
      try {
        const androidPath = path.join(targetPath, 'android');
        const { execSync } = require('child_process');
        if (fsSync.existsSync(androidPath)) {
          console.log('🔄 Syncing Capacitor Android (update mode)...');
          execSync('npx cap sync android', { cwd: targetPath, stdio: 'inherit' });
          console.log('✅ Capacitor Android synced (update mode)');
        }
      } catch (e: any) {
        console.warn('Capacitor sync failed in update mode:', e?.message);
      }

      return NextResponse.json({ message: 'App updated (env and sync applied). No generation performed.' });
    }

    if (appType === 'web-app') {
      await ensureNextJsStructure(targetPath);
      const systemPrompt = getSystemPrompt(selectedTemplate, language, databaseType || 'none', authMethod || 'none', description);
      const modelConfig = await getModelConfig(modelId, userId);
      if (!modelConfig) {
        throw new Error(`Model configuration not found for modelId: ${modelId}`);
      }

      let aiResponse;
      let postRetryCount = 0;
      const postMaxRetries = 3;

      while (postRetryCount < postMaxRetries) {
        try {
          aiResponse = await fetch(modelConfig.url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${modelConfig.api_key}`
            },
            body: JSON.stringify({
              model: modelConfig.model,
              messages: [{ role: 'system', content: systemPrompt }],
              temperature: 0.4,
              max_tokens: 8192,
            }),
            signal: AbortSignal.timeout(600000) // 10 minutos timeout
          });

          if (!aiResponse.ok) {
            const errorData = await aiResponse.json();
            throw new Error(`AI model API error: ${aiResponse.status} - ${errorData.message || JSON.stringify(errorData)}`);
          }
          break; // Salir del bucle si la llamada fue exitosa
        } catch (error: any) {
          postRetryCount++;
          console.error(`Error en llamada a API del modelo en POST (intento ${postRetryCount}/${postMaxRetries}):`, error.message);

          if (postRetryCount >= postMaxRetries) {
            throw new Error(`Error de conexión con el modelo de IA después de ${postMaxRetries} intentos: ${error.message}`);
          }

          // Esperar antes del siguiente intento (backoff exponencial)
          const postWaitTime = Math.pow(2, postRetryCount) * 1000; // 2s, 4s, 8s
          await new Promise(resolve => setTimeout(resolve, postWaitTime));
        }
      }

      if (!aiResponse) {
        throw new Error('No AI response received');
      }
      const aiResult = await aiResponse.json();
      let projectFiles: Record<string, { content: string }>;
      let explanatoryText = '';

      try {
        let content = aiResult.choices[0]?.message?.content;
        console.log('DEBUG: AI response raw content length:', content ? content.length : 'null');
        console.log('DEBUG: AI response preview (first 1000 chars):', content ? content.substring(0, 1000) : 'null');

        if (!content) {
          throw new Error('No content in AI response');
        }

        // Clean up potential markdown code blocks that might still appear
        content = content.replace(/^```[a-zA-Z]*\n/, '').replace(/\n```$/, '');

        // Try to parse as JSON first
        try {
          const parsed = JSON.parse(content);
          projectFiles = parsed.files || parsed[appName]?.files;
          if (parsed.explanatoryText) {
            explanatoryText = parsed.explanatoryText;
          }
        } catch (jsonError) {
          // If JSON parsing fails, try alternative parsing methods
          console.log('JSON parsing failed, trying alternative parsing methods');
          throw new Error('Failed to parse AI response as JSON');
        }

        if (!projectFiles) {
          throw new Error('Could not extract project files from AI response');
        }

        console.log('DEBUG: projectFiles keys:', Object.keys(projectFiles));
      } catch (parseError: any) {
        console.error('❌ Error parsing AI response:', parseError);
        console.error('Raw AI response content:', aiResult.choices[0]?.message?.content);
        throw new Error(`Error parsing AI response: ${parseError.message}`);
      }

      const flattenedProjectFiles = flattenProjectFiles(projectFiles);
      console.log('DEBUG: flattenedProjectFiles keys:', Object.keys(flattenedProjectFiles));
      console.log('DEBUG: flattenedProjectFiles content:', JSON.stringify(flattenedProjectFiles, null, 2));
      await createProjectStructure(targetPath, flattenedProjectFiles, appName);

      // Crear marcador de proyecto para futuras operaciones seguras
      try {
        const marker = {
          type: 'mobile',
          appName,
          createdAt: new Date().toISOString(),
          generator: 'zeus'
        };
        await fs.writeFile(path.join(targetPath, '.zeus-app.json'), JSON.stringify(marker, null, 2), 'utf8');
      } catch (e: any) {
        console.warn('Could not write project marker file:', e?.message);
      }

      // Escribir/actualizar archivos de entorno de forma segura con fallback a process.env
      try {
        const eff = getEffectiveEnvUpdate(requestBody);
        const envRes = await ensureEnvFiles(targetPath, eff);
        console.log('✅ Environment files ensured:', envRes);
      } catch (e) {
        console.warn('⚠️ Could not write env files for generated app:', (e as any)?.message);
      }

      // Clean up files that don't belong to this application type
      // await cleanupIncompatibleFiles(targetPath, selectedTemplate); // Comentado para depuración

      // Verify and fix package.json content if it exists
      if (flattenedProjectFiles['package.json']) {
        const originalContent = flattenedProjectFiles['package.json'].content;
        const contentAsString = typeof originalContent === 'string' ? originalContent : JSON.stringify(originalContent, null, 2);
        const fixedContent = verifyPackageJsonDependencies(contentAsString);
        if (fixedContent !== contentAsString) {
          flattenedProjectFiles['package.json'].content = fixedContent;
          // Write the fixed package.json to disk
          await fs.writeFile(path.join(targetPath, 'package.json'), fixedContent, 'utf8');
          console.log('✅ Fixed package.json dependencies in non-streaming mode');
        }
      }

      // Add Capacitor initialization to the layout file if it exists
      if (flattenedProjectFiles['app/layout.tsx'] && selectedTemplate === 'next-js') {
        let layoutContent = flattenedProjectFiles['app/layout.tsx'].content;
        if (typeof layoutContent !== 'string') {
          layoutContent = JSON.stringify(layoutContent, null, 2);
        }

        // Add Capacitor initialization to the layout
        if (layoutContent && layoutContent.includes('export default function RootLayout')) {
          // Insert Capacitor initialization after the imports
          const capacitorInit = `
import { Capacitor } from '@capacitor/core';

// Initialize Capacitor if running in a native environment
if (typeof window !== 'undefined' && Capacitor.isNativePlatform()) {
  console.log('Running in Capacitor native environment');
  // Additional native-specific initialization can go here
}
`;

          // Insert after the last import statement
          const importEndIndex = layoutContent.lastIndexOf('import ') + layoutContent.substring(layoutContent.lastIndexOf('import ')).indexOf(';') + 1;
          if (importEndIndex > 0) {
            layoutContent = layoutContent.substring(0, importEndIndex) + capacitorInit + layoutContent.substring(importEndIndex);
            flattenedProjectFiles['app/layout.tsx'].content = layoutContent;
          }
        }
      }

      // await deleteEmptyDirectories(targetPath); // Comentado para evitar eliminar carpetas que deberían contener archivos
      const createdFilesArray = Object.entries(flattenedProjectFiles).map(([filePath, fileData]) => ({
        filePath: filePath,
        content: typeof fileData.content === 'string' ? fileData.content : JSON.stringify(fileData.content, null, 2)
      }));

      // ✅ Add start-pocketbase.js script for non-streaming mode
      const startPocketbaseContent = `#!/usr/bin/env node

/**
 * start-pocketbase.js
 *
 * Script de ayuda para iniciar PocketBase dentro de los proyectos generados.
 * - Busca el ejecutable dentro de la carpeta "pocket-base"
 * - Lanza "pocketbase serve" heredando stdin/stdout
 * - No modifica datos ni estructura, solo arranca el servidor
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const pocketBaseDir = path.join(process.cwd(), 'pocket-base');
const executableName = process.platform === 'win32' ? 'pocketbase.exe' : 'pocketbase';
const executablePath = path.join(pocketBaseDir, executableName);

if (!fs.existsSync(executablePath)) {
  console.error('❌ No se encontró el ejecutable de PocketBase en:', executablePath);
  console.error('Asegúrate de haber ejecutado primero el script de instalación de PocketBase.');
  process.exit(1);
}

console.log('🚀 Iniciando PocketBase desde:', executablePath);

const child = spawn(executablePath, ['serve', '--http=0.0.0.0:8090'], {
  cwd: pocketBaseDir,
  stdio: 'inherit',
});

child.on('exit', (code) => {
  console.log('PocketBase finalizó con código:', code);
  process.exit(code ?? 0);
});
`;

      // Solo añadir start-pocketbase.js si se seleccionó authentication, database o chat
      if (needsPocketBase(features)) {
        const startPocketbaseIndex = createdFilesArray.findIndex(file => file.filePath === 'scripts/start-pocketbase.js');
        if (startPocketbaseIndex === -1) {
          createdFilesArray.push({
            filePath: 'scripts/start-pocketbase.js',
            content: startPocketbaseContent
          });
          console.log('✅ Added scripts/start-pocketbase.js to generated mobile files (non-streaming)');
        } else {
          createdFilesArray[startPocketbaseIndex].content = startPocketbaseContent;
          console.log('✅ Updated scripts/start-pocketbase.js in generated mobile files (non-streaming)');
        }
      }

      // Automatically install dependencies for mobile apps
      if (appName) {
        try {
          console.log('📦 Installing dependencies for mobile app...');
          const { execSync } = require('child_process');
          execSync('npm install', { cwd: targetPath, stdio: 'inherit' });
          console.log('✅ Dependencies installed successfully');

          // Add Android platform for Capacitor only if it doesn't exist
          const androidPath = path.join(targetPath, 'android');
          if (!fsSync.existsSync(androidPath)) {
            console.log('📱 Adding Android platform for Capacitor...');
            execSync('npx cap add android', { cwd: targetPath, stdio: 'inherit' });
            console.log('✅ Android platform added successfully');
          } else {
            console.log('ℹ️ Android platform already exists, skipping add');
          }

          // Always sync Android to normalize Gradle + Capacitor config
          console.log('🔄 Syncing Capacitor Android platform...');
          execSync('npx cap sync android', { cwd: targetPath, stdio: 'inherit' });
          console.log('✅ Capacitor Android synced successfully');

          // Ensure modern Gradle template (repositories + AGP8 layout)
          await ensureModernAndroidTemplate(targetPath, appName);

          // Sync again to ensure Capacitor picks up Gradle changes
          console.log('🔄 Re-Syncing Capacitor Android after Gradle normalization...');
          execSync('npx cap sync android', { cwd: targetPath, stdio: 'inherit' });
          console.log('✅ Capacitor Android re-synced successfully');
        } catch (installError: any) {
          console.error('❌ Error installing/syncing Capacitor Android:', installError.message);
          // Don't throw the error, just log it as the app generation was successful
        }
      }

      // Save the project archive to PocketBase

      // Save the project archive to PocketBase



    }

    return NextResponse.json({ message: 'App generation completed (non-web-app type or no generation needed)' });

  } catch (error: any) {
    console.error('Error in POST generate-app:', error);
    return NextResponse.json({ message: 'Error generating app', error: error.message }, { status: 500 });
  }
}
