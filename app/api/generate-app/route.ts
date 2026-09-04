import { NextResponse } from 'next/server';
import { Readable } from 'stream';
import { getModelsForUser } from '@/api/utils';
import { type ModeloRecord } from '@/lib/collections';
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
    { pattern: /(tecnolog|ti|software|código|program|startup|tech|code|developer)/i, query: 'technology workspace' },
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
    'son', 'app', 'aplicacion', 'aplicación', 'web', 'página', 'sitio'
  ]);

  const words = desc.split(/[^a-záéíóúñü0-9]+/i)
    .filter(word => word.length > 3 && !stopWords.has(word))
    .slice(0, 3);

  return words.length > 0 ? words.join(' ') : 'business professional';
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
      : 'business professional';

    const url = `https://api.unsplash.com/photos/random?query=${encodeURIComponent(searchQuery)}&count=${count}&orientation=landscape`;

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
      // Usar URL con parámetros de tamaño optimizado
      const url = img?.urls?.regular || img?.urls?.small;
      return url ? `${url}&w=450&h=300&fit=crop` : null;
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
    'https://images.unsplash.com/photo-1557804506-669a67965ba0?w=450&h=300&fit=crop',
    'https://images.unsplash.com/photo-1542744173-8e7e53415bb0?w=450&h=300&fit=crop',
    'https://images.unsplash.com/photo-1556740749-887f6717d7e4?w=450&h=300&fit=crop',
    'https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=450&h=300&fit=crop',
    'https://images.unsplash.com/photo-1519389950473-47ba0277781c?w=450&h=300&fit=crop',
    'https://images.unsplash.com/photo-1552664730-d307ca884978?w=450&h=300&fit=crop',
    'https://images.unsplash.com/photo-1573164713714-d95e436ab8d6?w=450&h=300&fit=crop',
    'https://images.unsplash.com/photo-1560250097-0b93528c311a?w=450&h=300&fit=crop'
  ];

  return fallbackImages.slice(0, count);
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


async function createProjectStructure(basePath: string, files: Record<string, { content: string | object }>) {
  await fs.mkdir(basePath, { recursive: true });
  console.log('DEBUG: createProjectStructure called with basePath:', basePath);
  console.log('DEBUG: createProjectStructure files count:', Object.keys(files).length);

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

      // Remove metadata/generateMetadata from app/page.tsx (metadata lives in app/metadata.ts only)
      if (relativePath === 'app/page.tsx') {
        contentToWrite = contentToWrite.replace(/(^|\n)\s*export\s+const\s+metadata\s*=\s*\{[\s\S]*?\};\s*/m, '$1');
        contentToWrite = contentToWrite.replace(/(^|\n)\s*export\s+(?:async\s+)?function\s+generateMetadata\s*\([^)]*\)\s*\{[\s\S]*?\n\}\s*/m, '$1');
      }

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
        "@headlessui/react": "^1.7.17",
        "@heroicons/react": "^2.0.18",
        "@hookform/resolvers": "^3.3.2",
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
        "@radix-ui/react-slider": "^1.3.6",
        "@radix-ui/react-switch": "^1.2.6",
        "@radix-ui/react-tabs": "^1.1.13",
        "@radix-ui/react-toast": "^1.1.5",
        "@radix-ui/react-toggle-group": "^1.1.11",
        "@radix-ui/react-tooltip": "^1.0.7",
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

      const scriptsBlock = hasPostinstall
        ? `"scripts": {
          ${devScript}
          ${postinstallScript}
          "build": "next build",
          "start": "next start",
          "lint": "next lint",
          "format": "prettier --write '**/*.{js,jsx,ts,tsx,json,md}'",
          "test": "jest",
          "analyze": "ANALYZE=true next build"
        }`
        : `"scripts": {
          ${devScript}
          "build": "next build",
          "start": "next start",
          "lint": "next lint",
          "format": "prettier --write '**/*.{js,jsx,ts,tsx,json,md}'",
          "test": "jest",
          "analyze": "ANALYZE=true next build"
        }`;

      return `{
       "name": "${appName}",
       "version": "0.1.0",
       "private": true,
       ${scriptsBlock},
  "dependencies": ${JSON.stringify(baseDependencies, null, 4).replace(/^/gm, '    ').trim()},
  "devDependencies": {
    "@next/bundle-analyzer": "^16.1.6",
    "@testing-library/jest-dom": "^6.1.4",
    "@testing-library/react": "^14.0.0",
    "@types/node": "^20",
    "@types/react": "^18",
    "@types/react-dom": "^18",
    "autoprefixer": "^10.0.1",
    ${(usePB || usePBDatos) ? '"concurrently": "^8.2.2",' : ''}
    "cssnano": "^6.0.1",
    "eslint": "^9.39.2",
    "eslint-config-next": "^16.1.6",
    "jest": "^29.7.0",
    "jest-environment-jsdom": "^30.3.0",
    "postcss": "^8.5.10",
    "postcss-flexbugs-fixes": "^5.0.2",
    "postcss-preset-env": "^9.3.0",
    "prettier": "^3.0.3",
    "prettier-plugin-tailwindcss": "^0.5.6",
    "tailwindcss": "^3.3.0",
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
    "date-fns": "^2.30.0"
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
    "tailwindcss-animate": "^1.0.7",
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
    "cssnano": "^6.0.1"
    "tailwindcss-animate": "^1.0.7",
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
    "tailwindcss-animate": "^1.0.7",
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
    "tailwindcss-animate": "^1.0.7",
    "tailwindcss": "^3.3.5"
  }
}`;
  }
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

    if (needsUpdate) {
      return JSON.stringify(packageJson, null, 2);
    }
  } catch (error) {
    console.error('❌ Error verifying/updating package.json:', error);
  }
  return packageJsonContent;
}

// Helper function to get model configuration
async function getModelConfig(modelId: string, userId: string): Promise<ModeloRecord | undefined> {
  const models = await getModelsForUser(userId);
  return models.find((m: ModeloRecord) => m.id === modelId);
}

// New helper for Auth details
function getAuthDetailsPrompt(authMethod: string): string {
  switch (authMethod) {
    case 'pocketbase':
      return `Implement authentication using PocketBase. Includes:
        - PocketBase SDK initialization.
        - User registration functionality with an example form and state management.
        - Login and logout functionality with an example form and state management.
        - Basic route/component protection with an example of middleware or higher-order component.
        - Note that the PocketBase server will run locally (e.g., https://zeus-basedatos.fly.dev).
      `;
    case 'firebase':
      return `Implement authentication using Firebase Authentication. Includes:
        - Firebase SDK initialization.
        - User registration functionality (email/password) with an example form and state management.
        - Login and logout functionality with an example form and state management.
        - Basic route/component protection with an example of middleware or higher-order component.
        - Configuration for Firebase credentials.
      `;
    case 'supabase':
      return `Implement authentication using Supabase Auth. Includes:
        - Supabase client initialization.
        - User registration functionality (email/password) with an example form and state management.
        - Login and logout functionality with an example form and state management.
        - Basic route/component protection with an example of middleware or higher-order component.
        - Configuration for Supabase URL and anonymous key.
      `;
    case 'custom':
      return `Implement a custom authentication system. Includes:
        - Placeholder for registration, login, and logout logic with example function structures.
        - An example of how to integrate with an external authentication API.
        - Clear comments indicating where the user should add their custom logic.
      `;
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
      return `Set up a basic client to interact with PocketBase as a database. Includes:
        - PocketBase SDK initialization.
        - Examples of CRUD (Create, Read, Update, Delete) operations on a sample collection with functional code.
        - Note that the PocketBase server will run locally (e.g., https://zeus-basedatos.fly.dev).
      `;
    case 'firebase_firestore':
      return `Set up a basic client to interact with Firebase Firestore. Includes:\n        - Firebase SDK initialization.\n        - Examples of CRUD operations on a sample Firestore collection with functional code.\n      `;
    case 'supabase':
      return `Set up a basic client to interact with Supabase (PostgreSQL). Includes:
        - Supabase client initialization.
        - Examples of CRUD operations on a sample Supabase table with functional code.
        - Configuration for the Supabase URL and anonymous key.
      `;
    case 'postgresql':
      return `Set up the connection to a PostgreSQL database. Includes:
        - Configuration file for database credentials.
        - An example of how to perform a basic query with functional code.
        - ${ormDetails}
        - Note: For production, a dedicated backend is recommended to handle database interaction.
      `;
    case 'mongodb':
      return `Set up the connection to a MongoDB database. Includes:
        - Configuration file for the connection string.
        - An example of how to perform a basic operation (e.g., insert/find a document) with functional code.
        - ${ormDetails}
        - Note: For production, a dedicated backend is recommended to handle database interaction.
      `;
    case 'sqlite':
      return `Set up the connection to an SQLite database. Includes:
        - An example of how to create a table and perform basic operations with functional code.
        - ${ormDetails}
        - Note: SQLite is ideal for local development or desktop/mobile applications, but not for scalable backends.
      `;
    case 'custom':
      return `Set up the connection to a custom database. Includes:
        - An example of how to configure the database connection.
        - An example of a basic query with functional code.
        - ${ormDetails}
        - Note: Make sure the user understands they need to replace the example values with their own configuration.
      `;
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
      templateDetails = `
        Framework: Next.js 13+ (React) with App Router
        Language: ${language}
        Folder Structure: YOU MUST use the Next.js 13+ App Router with the following mandatory structure:
        - app/layout.tsx (root layout with html, head, body)
        - app/page.tsx (main page)
        - app/globals.css (global styles with Tailwind)
        - package.json (with Next.js, React, Tailwind dependencies)
        - next.config.js (basic Next.js configuration)
        - tsconfig.json (if TypeScript)
        - tailwind.config.js (Tailwind configuration)
        - postcss.config.js (PostCSS configuration)
        
        Styles: Tailwind CSS (properly configured)
        Authentication: ${authPrompt}
        Database: ${databasePrompt}
        
        ${isSimpleApp ? `
        🎯 FEATURES FOR SIMPLE (BUT PROFESSIONAL) APPLICATION:
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
      templateDetails = `
        Framework: Nuxt.js (Vue)
        Lenguaje: ${language}
        Estructura de carpetas: Sigue las convenciones de Nuxt 3.
        Estilos: Tailwind CSS.
        Autenticación: ${authPrompt}
        Base de Datos: ${databasePrompt}
        
        ${isSimpleApp ? `
        CARACTERÍSTICAS PARA APLICACIÓN SIMPLE:
        1. Una página principal que implemente la funcionalidad solicitada
        2. Componentes básicos necesarios
        3. Estilos simples con Tailwind CSS
        4. Funcionalidad principal funcionando correctamente
        ` : isComplexApp ? `
        CARACTERÍSTICAS PARA APLICACIÓN COMPLEJA:
        1. Múltiples páginas con navegación
        2. Componentes Vue reutilizables
        3. Composables para lógica de negocio
        4. Manejo de estado con Pinia o Vuex
        5. Formularios con validación
        6. Diseño responsive
        7. Integración con APIs
        8. Sistema de autenticación
        9. Dashboard con funcionalidades
        10. Perfil de usuario
        ` : `
        CARACTERÍSTICAS ESTÁNDAR:
        1. Página principal con la funcionalidad solicitada
        2. 1-2 páginas adicionales si es necesario
        3. Componentes reutilizables básicos
        4. Manejo de estado básico
        5. Formularios con validación básica
        6. Diseño responsive
        `}
      `;
      break;
    case 'react-native':
      templateDetails = `
        Framework: React Native
        Lenguaje: ${language}
        Estructura: Un componente principal App.${language === 'TypeScript' ? 'tsx' : 'js'} y múltiples pantallas.
        Navegación: React Navigation con stack y tab navigator.
        Autenticación: ${authPrompt}
        Base de Datos: ${databasePrompt}
        
        ${isSimpleApp ? `
        CARACTERÍSTICAS PARA APLICACIÓN SIMPLE:
        1. Una pantalla principal que implemente la funcionalidad solicitada
        2. Componentes básicos necesarios
        3. Navegación simple
        4. Funcionalidad principal funcionando correctamente
        ` : isComplexApp ? `
        CARACTERÍSTICAS PARA APLICACIÓN COMPLEJA:
        1. Múltiples pantallas con navegación
        2. Componentes nativos personalizados
        3. Manejo de estado con Redux o Context
        4. Formularios con validación
        5. Integración con APIs
        6. Almacenamiento local
        7. Notificaciones push
        8. Cámara y galería
        9. Geolocalización
        10. Temas claro/oscuro
        ` : `
        CARACTERÍSTICAS ESTÁNDAR:
        1. Pantalla principal con la funcionalidad solicitada
        2. 1-2 pantallas adicionales si es necesario
        3. Componentes reutilizables básicos
        4. Manejo de estado básico
        5. Navegación entre pantallas
        6. Integración con APIs si es necesario
        `}
      `;
      break;
    case 'fastapi-py':
      templateDetails = `
        Framework: FastAPI
        Lenguaje: Python
        Estructura: Un archivo main.py, un requirements.txt, y carpetas organizadas.
        Autenticación: ${authPrompt}
        Base de Datos: ${databasePrompt}
        
        ${isSimpleApp ? `
        CARACTERÍSTICAS PARA APLICACIÓN SIMPLE:
        1. Endpoints básicos para la funcionalidad solicitada
        2. Validación de datos con Pydantic
        3. Manejo de errores básico
        4. Documentación automática (Swagger/OpenAPI)
        ` : isComplexApp ? `
        CARACTERÍSTICAS PARA APLICACIÓN COMPLEJA:
        1. Múltiples endpoints RESTful
        2. Validación de datos con Pydantic
        3. Autenticación JWT
        4. Documentación automática (Swagger/OpenAPI)
        5. Manejo de errores personalizado
        6. Middleware personalizado
        7. Tests unitarios
        8. Configuración de CORS
        9. Logging estructurado
        10. Rate limiting
        11. Upload de archivos
        12. Websockets para tiempo real
        ` : `
        CARACTERÍSTICAS ESTÁNDAR:
        1. Endpoints para la funcionalidad solicitada
        2. Validación de datos con Pydantic
        3. Autenticación básica si es necesario
        4. Documentación automática
        5. Manejo de errores
        6. Configuración de CORS
        `}
      `;
      break;
    // ... add more detailed prompts for other templates
    default:
      templateDetails = `
        Tecnología: ${selectedTemplate}
        Lenguaje: ${language}
        Descripción general: Crea una estructura de proyecto completa y funcional.
        Autenticación: ${authPrompt}
        Base de Datos: ${databasePrompt}
        
        ${isSimpleApp ? `
        CARACTERÍSTICAS PARA APLICACIÓN SIMPLE:
        1. Funcionalidad principal solicitada
        2. Componentes básicos necesarios
        3. Estilos simples
        4. Funcionalidad funcionando correctamente
        ` : isComplexApp ? `
        CARACTERÍSTICAS PARA APLICACIÓN COMPLEJA:
        1. Múltiples páginas/componentes
        2. Manejo de estado avanzado
        3. Formularios interactivos
        4. Diseño responsive
        5. Integración con APIs
        6. Funcionalidades avanzadas
        ` : `
        CARACTERÍSTICAS ESTÁNDAR:
        1. Funcionalidad principal solicitada
        2. 1-2 páginas/componentes adicionales si es necesario
        3. Manejo de estado básico
        4. Formularios con validación básica
        5. Diseño responsive
        6. Integración con APIs si es necesario
        `}
      `;
  }

  return `${basePrompt}

--- Especificaciones del Proyecto ---
${templateDetails}

IMPORTANTE: Analiza la descripción del usuario: "${description}"

REGLAS CRÍTICAS PARA EVITAR ARCHIVOS VACÍOS:
⚠️ NUNCA GENERES ARCHIVOS VACÍOS O CON CONTENIDO MÍNIMO
⚠️ TODOS LOS ARCHIVOS DEBEN TENER CONTENIDO COMPLETO Y FUNCIONAL
⚠️ VALIDACIÓN OBLIGATORIA: Antes de finalizar, verifica que NINGÚN archivo esté vacío

ARCHIVOS CRÍTICOS QUE NUNCA PUEDEN ESTAR VACÍOS:
- app/page.tsx o src/App.jsx: DEBE contener un componente React completo y funcional
- app/globals.css o src/index.css: DEBE contener estilos base, variables CSS y estilos de Tailwind
- components/: TODOS los componentes deben estar completamente implementados
- package.json: DEBE contener todas las dependencias y scripts necesarios
- README.md: DEBE contener documentación completa del proyecto

REGLAS PARA GENERAR ARCHIVOS Y ESTRUCTURA:
1. ESTRUCTURA DE CARPETAS COMPLETA Y PROFESIONAL:
   - Organiza el código en una estructura de carpetas clara, coherente y completa
   - Separa claramente los componentes, páginas, utilidades, hooks, tipos, contextos, servicios, etc.
   - Incluye TODOS los archivos de configuración necesarios sin excepción
   - Sigue las mejores prácticas de organización de código para el framework seleccionado
   - Crea una estructura escalable que permita el crecimiento futuro de la aplicación
   - Organiza los componentes por funcionalidad o características cuando sea apropiado

2. PARA CUALQUIER TIPO DE APLICACIÓN (SIMPLE O COMPLEJA):
   - Genera una estructura completa y profesional con TODOS los archivos necesarios
   - Incluye componentes reutilizables bien diseñados y completamente funcionales
   - Implementa un sistema de navegación intuitivo, profesional y responsive
   - Asegúrate de que la aplicación tenga un aspecto visual atractivo, moderno y profesional
   - Incluye manejo de estados robusto, validación de formularios completa, y feedback visual para todas las interacciones
   - Implementa correctamente la autenticación y base de datos según las opciones seleccionadas
   - Asegúrate de que la aplicación sea completamente funcional y lista para usar
   - Incluye manejo de errores completo y mensajes de usuario amigables

3. ARCHIVOS OBLIGATORIOS PARA NEXT.JS (EJEMPLO):
   - app/layout.tsx (layout raíz con diseño profesional y metadatos completos)
   - app/page.tsx (página principal atractiva y completamente funcional - NUNCA VACÍA)
   - app/globals.css (estilos globales completos con variables CSS personalizadas - NUNCA VACÍO)
   - components/ (carpeta con componentes reutilizables bien organizados y documentados)
   - lib/ (utilidades y funciones helper bien estructuradas)
   - hooks/ (custom hooks para lógica reutilizable)
   - contexts/ (contextos de React para estado global)
   - services/ (servicios para API y lógica de negocio)
   - types/ (definiciones de tipos completas si es TypeScript)
   - public/ (assets estáticos organizados por categoría)
   - styles/ (estilos adicionales o componentes de estilo)
   - package.json (con todas las dependencias necesarias y scripts útiles)
   - next.config.js (configuración completa y optimizada)
   - tailwind.config.js (configuración personalizada con extensiones útiles)
   - postcss.config.js (configuración optimizada)
   - tsconfig.json (configuración completa si es TypeScript)
   - README.md (documentación completa con instrucciones de instalación y uso)
   - .env.example (variables de entorno de ejemplo con comentarios explicativos)
   - .gitignore (configurado correctamente para el tipo de proyecto)
   - .eslintrc.js (configuración de linting)
   - .prettierrc (configuración de formato de código)

4. CARACTERÍSTICAS ADICIONALES PARA MEJORAR LA CALIDAD:
   - Implementa un sistema de temas completo (claro/oscuro) con persistencia de preferencias
   - Añade animaciones y transiciones sutiles para mejorar la experiencia de usuario
   - Incluye componentes de UI modernos, atractivos y accesibles
   - Implementa manejo de errores robusto y estados de carga con feedback visual
   - Añade comentarios explicativos en el código para facilitar el mantenimiento
   - Asegúrate de que el código sea limpio, bien estructurado y siga las mejores prácticas
   - Implementa correctamente la autenticación y base de datos según las opciones seleccionadas
   - Añade validación de formularios completa con mensajes de error claros
   - Incluye optimización de rendimiento (lazy loading, memoización, etc.)
   - Implementa características de accesibilidad (ARIA, contraste, navegación por teclado)
   - Añade efectos visuales sutiles que mejoren la experiencia sin distraer

5. VALIDACIÓN FINAL OBLIGATORIA:
   - Antes de entregar el resultado, VERIFICA que ningún archivo esté vacío
   - Asegúrate de que todos los archivos principales (App.jsx, index.css, etc.) tengan contenido sustancial
   - Si detectas un archivo vacío, REGENERA su contenido inmediatamente
   - La aplicación debe ser completamente funcional desde el primer momento

Crea una aplicación completa, profesional y lista para usar que cumpla con todos los requisitos del usuario, ofrezca una excelente experiencia de usuario, y siga las mejores prácticas de desarrollo moderno.`;
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
  modelConfig: ModeloRecord,
  projectRoot: string,
  appName: string,
  description: string,
  stream: ReadableStreamDefaultController,
  selectedTemplate: string,
  complexity: string,
  projectId?: string,
  authMethod?: string,
  requestUrl?: string,
  userToken?: string,
  features?: string[], // authentication, database, chat - para scripts condicionales
  userId?: string,
) {
  // Validate model configuration
  if (!modelConfig.base_url || !modelConfig.api_key || !modelConfig.model_name) {
    throw new Error(`Model configuration is incomplete. Missing base_url, api_key, or model_name.`);
  }

  // DATA_PATH es la raíz directa del proyecto actual (sin subcarpeta appName)
  const targetPath = projectRoot;

  // ... rest of the code remains the same ...
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

Returns a JSON object where the keys are the file paths (e.g., "app/page.tsx") and the values are the FULL, FUNCTIONAL content of those files.
Make sure to include ALL essential configuration files with their complete and optimized contents.
Do NOT include any other text in your response, just the JSON object.

 --- User Request ---
 App Name: ${appName}
 Description: ${description}
 ---

 RULES FOR GENERATING FILES AND CONTENT:
 1. REQUIRED FILES (always include with complete and optimized content):
 - "package.json": Complete content with all necessary dependencies and useful scripts.
 - "next.config.js": Complete and optimized configuration.
- "app/layout.tsx": Professionally designed root layout (can import and re-export metadata from './metadata').
- "app/metadata.ts": Already exists with app metadata; do NOT duplicate metadata in app/page.tsx.
- "app/page.tsx": Beautiful and fully functional home page. Do NOT export metadata or generateMetadata here.
 - "app/globals.css": Complete global styles with custom CSS variables.
 - "tsconfig.json": Complete configuration for TypeScript.
 - "tailwind.config.js": Custom configuration with useful extensions.
 - "postcss.config.js": Optimized configuration.
- "next-env.d.ts": Type configuration for Next.js.
- "README.md": Complete documentation with installation and usage instructions.
- ".env.example": Example environment variables with explanatory comments.
- ".gitignore": Correctly configured for the project type.
- ".eslintrc.js": Linting configuration.
- ".prettierrc": Code formatting configuration.

 2. COMPLETE AND PROFESSIONAL FOLDER STRUCTURE:
- "components/": Folder with well-organized and documented reusable components.
- "lib/": Well-structured utilities and helper functions.
- "hooks/": Custom hooks for reusable logic.
- "contexts/": React contexts for global state.
- "services/": Services for APIs and logic business.
- "types/": Complete type definitions.
- "public/": Static assets organized by category.
- "styles/": Additional styles or style components.

 3. CAREFULLY ANALYZE THE DESCRIPTION:
- Generate COMPLETE and FUNCTIONAL content for ALL files required for the application.
- Create a professional, attractive, and fully functional application that meets all requirements.
- If it's a simple application (album, gallery, calculator, counter, etc.): Generate all necessary files for a professional and complete implementation.
- If it's a complex application (dashboard, management system, etc.): Generate a complete structure with all necessary files.

 4. 🎯 PREMIUM QUALITY GUIDELINES:

🎨 EXCEPTIONAL VISUAL DESIGN:
- Modern and attractive color palette with subtle gradients
- Professional typography with clear hierarchy and perfect readability
- Perfect spacing and a consistent grid system
- Modern, consistent, and meaningful iconography (use icon components directly from 'lucide-react' library)
- Subtle microinteractions and animations that enhance the UX
- Complete theming system (light/dark) with smooth transitions
- Components with complete visual states (hover, active, disabled, loading)

📦 ICONOS DISPONIBLES (usar SOLO estos nombres):
Navegación: home, menu, search, compass, navigation, mapPin, arrowLeft, arrowRight, arrowUp, arrowDown
Usuario: user, users, logIn, logOut, settings, smile, laugh, frown
Comercio: shoppingBag, shoppingCart, store, warehouse, dollarSign, euro, coins, tag, gift, creditCard
Comunicación: mail, phone, messageCircle, send, bell, mic, headphones
Social: heart, star, share, thumbsUp, thumbsDown, facebook, instagram, twitter, linkedin, youtube, github
Multimedia: camera, image, video, music, play, pause, tv, monitor, smartphone, tablet, laptop
Archivos: file, folder, download, upload, save, fileText, folderOpen, archive, clipboard
Edición: edit, trash, plus, minus, x, check, pencil, eraser, scissors, paintbrush
Información: info, helpCircle, alertCircle, flag, bookmark, award, trophy, medal, crown
Negocios: briefcase, building, factory, hotel, school, library, graduationCap, book
Moda: shirt, glasses, gem, diamond, sparkles, watch, wallet
Comida: pizza, utensils, coffee, wine, beer, cake, cookie, apple, banana, sandwich, beef, fish
Transporte: car, bus, train, plane, ship, rocket, truck, bike
Clima: sun, moon, cloud, cloudRain, snowflake, sunrise, sunset, wind, flame
Salud: stethoscope, pill, thermometer, bandage, dumbbell
Hogar: lightbulb, lamp, fan, refrigerator, microwave, wrench, hammer
Gráficos: barChart, lineChart, pieChart, trendingUp, trendingDown, activity
Tecnología: wifi, bluetooth, server, cpu, database, hardDrive, terminal, code
Otros: calendar, clock, map, globe, shield, key, lock, power, battery, zap, target
IMPORTANTE: NO inventar nombres de iconos. Usar SOLO los de esta lista. Todos son monocromáticos.

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

📦 COMPONENTES UI DISPONIBLES (importar desde '@/components/ui/[nombre]'):
Layout & Containers: Card, Sheet, Dialog, Drawer, Tabs, Accordion, Collapsible, ScrollArea, Resizable
Forms: Input, Textarea, Select, Checkbox, RadioGroup, Switch, Slider, Calendar, Form, Label
Buttons & Actions: Button, DropdownMenu, ContextMenu, Menubar, NavigationMenu, Popover, HoverCard
Feedback: Alert, AlertDialog, Toast, Toaster, Sonner, Progress, Spinner, Skeleton, LoadingOverlay
Data Display: Table, Badge, Avatar, Separator, AspectRatio, Tooltip, EmptyState
Cards Especiales: StatCard, FeatureCard, TestimonialCard, PricingCard
Navigation: Breadcrumb, Pagination
Charts: Chart (con recharts)
Otros: Command, InputOtp, ToggleGroup, Toggle
IMPORTANTE: Usar estos componentes en lugar de crear HTML básico. Todos tienen estilos consistentes y son accesibles.

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

5. OUTPUT JSON STRUCTURE:
 - The root key MUST be the name of the app (e.g. "my-awesome-app").
 - Within the root key, there MUST be a "files" key.
 - The "files" key MUST contain an object where the keys are the file paths and the values are the full file content.
       - Ejemplo:
         {
           "my-awesome-app": {
             "files": {
               "package.json": "{
                 \\"name\\":\\"my-awesome-app\\",...",
               "app/page.tsx": "import React from \'react\'; ..."
             }
           }
         }
  `;

  stream.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'status', message: 'Obteniendo estructura de archivos...' })}`));

  let fileListResponse;
  let retryCount = 0;
  const maxRetries = 3;

  while (retryCount < maxRetries) {
    try {
      fileListResponse = await fetch(modelConfig.base_url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${modelConfig.api_key}`
        },
        body: JSON.stringify({
          model: modelConfig.model_name,
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
        apiKey: modelConfig.model_name as string, // ✅ USAR NOMBRE DEL MODELO
        name: modelConfig.name as string,
        type: modelConfig.type as string
      }, {
        promptTokens: fileListResult.usage.prompt_tokens || 0,
        completionTokens: fileListResult.usage.completion_tokens || 0,
        cacheHitTokens: fileListResult.usage.prompt_cache_hit_tokens || 0,
        requestId: fileListResult.id
      });
    } catch (usageError) {
      console.error('[Usage Recording] Error registrando consumo en Lista de Archivos:', usageError);
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

    fileMap['app/layout.tsx'] = `
'use client';

import './globals.css';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { Providers } from '@/components/Providers';
import Navbar from '@/components/Navbar';

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
        <Navbar />
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
      const fileContentPrompt = `You are an expert software development wizard specializing in creating professional, feature-rich applications. Your task is to generate COMPLETE AND FUNCTIONAL content for the specified file, ensuring that it is high-quality, well-structured, and follows best practices. ⚠️ CRITICAL RULE: PURE CODE ONLY, NO EXPLANATIONS, ADDITIONAL COMMENTS, OR MARKDOWN BLOCKS. Provide ONLY the pure code. Imports must be at the beginning of the file and correct.

⚠️ CRITICAL RULE: NEVER GENERATE EMPTY OR MINIMAL CONTENT
⚠️ The file MUST have substantial, fully functional content
⚠️ If a React component, it must include full JSX and styles
⚠️ If a CSS file, it must include base styles and variables
⚠️ If a config file, it must be fully configured

⚠️ CRITICAL NAVIGATION RULE:
- ONLY create links, buttons, or navigation items pointing to pages that ACTUALLY EXIST in the project.
- If the current file list does NOT include app/about/page.tsx, app/contact/page.tsx, or similar pages, do NOT create links to /about, /contact, etc.
- Navigation (Navbar, Footer, buttons) should ONLY link to existing pages. If unsure, link to "/" or use scroll-to-section anchors instead.
- NEVER invent page routes that don't exist in the file structure.

--- Project Specifics ---
App Name: ${appName}
Overview: ${description}
Framework: Next.js 13+ with App Router
Styles: Tailwind CSS
---

--- File to Generate ---
File Path: ${filePath}
---

--- File Type Specific Validations ---
If the file is app/page.tsx or src/App.jsx:
- MUST contain a complete React component with substantial JSX
- MUST include attractive and functional visual elements
- MUST use Tailwind CSS for styling
- MUST be fully functional out of the box
- ⚠️ CRITICAL: NEVER use the 'next/head' Head component in App Router
- ⚠️ CRITICAL: DO NOT use JSX fragments (<>) with Head components
- ⚠️ CRITICAL: Metadata is handled in app/layout.tsx, NOT page.tsx
- ⚠️ CRITICAL: If you need dynamic metadata, use the generateMetadata() function
- ⚠️ MANDATORY IMPORT: MUST include this import at the top of the file: import Footer from '@/components/layout/footer';
- ⚠️ MANDATORY USAGE: MUST use the Footer component in the JSX. Include <Footer /> at the end of the component's return statement, before closing the main container.
- ⚠️ CRITICAL FOOTER COPYRIGHT: The Footer component will handle the copyright text automatically. DO NOT create inline footer elements. Always use the imported Footer component.
- ⚠️ The Footer component MUST be included in the JSX structure of the page component.
- ⚠️ CRITICAL PADDING: The Footer is fixed at the bottom (fixed bottom-0). The main container MUST have padding-bottom (pb-20 or pb-24) to prevent content from being hidden behind the footer. Example: <div className="min-h-screen pb-20 bg-white"> or <main className="pb-20">.

If the file is app/globals.css or src/index.css: - MUST include @tailwind directives (base, components, utilities). MUST contain custom CSS variables. MUST include base styles for the body, HTML, etc.. MUST be at least 50 lines of useful content. If the file is a component:
- MUST be fully implemented.
- MUST include props, state, and logic as needed.
- MUST have styles applied.
- MUST be reusable and well documented.
- ⚠️ CRITICAL: NEVER import or use Head from 'next/head'.
- ⚠️ CRITICAL: DO NOT use JSX fragments (<>) with head/meta elements.
- ⚠️ CRITICAL: Components should NOT handle metadata directly.

If the file is app/layout.tsx:
- MUST import Providers from '@/components/Providers' (NOT from './providers').
- MUST use the absolute path aliased @ for all imports.
- MUST include full metadata in the object. metadata
- MUST wrap children with the Providers component. Quality Guidelines ---
1. Clean, well-structured code that follows best practices.
2. Include explanatory comments for complex sections.
3. Implement robust error handling where applicable.
4. Ensure code is accessible and follows modern design principles.
5. Optimize for performance where possible (lazy loading, memoization, etc.).
6. For UI components, implement clear visual states (hover, active, focus, disabled).
7. For configuration files, include optimized and well-documented options.
8. For style files, use CSS variables and a consistent design system.
9. ⚠️ CRITICAL: Use ONLY Next.js 13+ App Router features - DO NOT mix with Pages Router.
10. FINAL VALIDATION: Verify that generated content is non-empty and substantial.\n---`;

      if (filePath === 'package.json') {
        fileContent = getPackageJsonContent(selectedTemplate, appName, authMethod, features);
        // Apply verification immediately after generating package.json content
        fileContent = verifyPackageJsonDependencies(fileContent);
        console.log('Forcing package.json content based on template and verified dependencies.');
      } else if (filePath === 'next.config.js' && selectedTemplate === 'next-js') {
        fileContent = `/** @type {import('next').NextConfig} */
const nextConfig = {
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
      } else {
        let fileContentResponse;
        let fileRetryCount = 0;
        const fileMaxRetries = complexity === 'simple' ? 1 : 2; // Menos reintentos para proyectos simples
        let shouldSkipFile = false;

        while (fileRetryCount < fileMaxRetries && !shouldSkipFile) {
          try {
            fileContentResponse = await fetch(modelConfig.base_url, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${modelConfig.api_key}`
              },
              body: JSON.stringify({
                model: modelConfig.model_name,
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
              apiKey: modelConfig.model_name as string, // ✅ USAR NOMBRE DEL MODELO
              name: modelConfig.name as string,
              type: modelConfig.type as string
            }, {
              promptTokens: fileContentResult.usage.prompt_tokens || 0,
              completionTokens: fileContentResult.usage.completion_tokens || 0,
              cacheHitTokens: fileContentResult.usage.prompt_cache_hit_tokens || 0,
              requestId: fileContentResult.id
            });
          } catch (usageError) {
            console.error(`[Usage Recording] Error registrando consumo en archivo ${filePath}:`, usageError);
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

    // Post-processing for app/page.tsx: remove metadata and ensure Footer import
    if (filePath === 'app/page.tsx') {
      // Remove metadata/generateMetadata from page (metadata lives in app/metadata.ts only)
      const beforeMeta = fileContent;
      fileContent = fileContent.replace(/(^|\n)\s*export\s+const\s+metadata\s*=\s*\{[\s\S]*?\};\s*/m, '$1');
      fileContent = fileContent.replace(/(^|\n)\s*export\s+(?:async\s+)?function\s+generateMetadata\s*\([^)]*\)\s*\{[\s\S]*?\n\}\s*/m, '$1');
      if (fileContent !== beforeMeta) {
        console.log('✅ Removed metadata/generateMetadata from app/page.tsx (use app/metadata.ts)');
      }
      const footerImport = "import Footer from '@/components/layout/footer';";
      if (!fileContent.includes(footerImport)) {
        // Find the first import line or 'use client' directive
        const lines = fileContent.split('\n');
        let insertIndex = 0;

        // Skip 'use client' if present
        if (lines[0]?.trim() === "'use client';" || lines[0]?.trim() === '"use client";') {
          insertIndex = 1;
        }

        // Find where imports end (first non-import, non-empty line after 'use client')
        for (let i = insertIndex; i < lines.length; i++) {
          const line = lines[i].trim();
          if (line && !line.startsWith('import ') && !line.startsWith('//') && !line.startsWith('/*')) {
            insertIndex = i;
            break;
          }
        }

        // Insert the Footer import
        lines.splice(insertIndex, 0, footerImport);
        fileContent = lines.join('\n');
        console.log('✅ Added Footer import to app/page.tsx');
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
    })}`))
  }

  // ✅ ZIP saving to PocketBase has been disabled per user request
  console.log('[generate-app] 💾 Guardado de ZIP en PocketBase deshabilitado. Archivos disponibles en disco local.');

  // ✅ AHORA SÍ enviar el evento 'complete' después de que el ZIP esté guardado
  stream.enqueue(encoder.encode(`data: ${JSON.stringify({
    type: 'complete',
    message: `Aplicación '${appName}' generada exitosamente con ${createdFiles.length} archivos`,
    createdFiles
  })}`))

  // Verify and fix package.json content if it exists
  const packageJsonIndex = createdFiles.findIndex(file => file.filePath === 'package.json');
  if (packageJsonIndex !== -1) {
    let content = createdFiles[packageJsonIndex].content;
    try {
      const parsed = JSON.parse(content);
      if (parsed.name === 'pocketbase-installer') {
        console.warn('⚠️ package.json raíz tenía contenido pocketbase-installer; reemplazando con getPackageJsonContent.');
        content = getPackageJsonContent('next-js', appName, undefined, features || []);
      }
    } catch (_) { }
    const fixedContent = verifyPackageJsonDependencies(content);
    if (fixedContent !== createdFiles[packageJsonIndex].content) {
      createdFiles[packageJsonIndex].content = fixedContent;
      console.log('✅ Fixed package.json dependencies');
    }
  }
  // Evitar duplicados de pocket-base/package.json (mantener solo el primero)
  const pbPkgIndices = createdFiles
    .map((f, i) => (f.filePath === 'pocket-base/package.json' ? i : -1))
    .filter(i => i >= 0);
  for (let k = pbPkgIndices.length - 1; k >= 1; k--) {
    createdFiles.splice(pbPkgIndices[k], 1);
    console.log('✅ Eliminado duplicado de pocket-base/package.json');
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
              authMethod, // Pass authMethod parameter
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

    if (appType === 'web-app') {
      await ensureNextJsStructure(targetPath);
      const systemPrompt = getSystemPrompt(selectedTemplate, language, databaseType || 'none', authMethod || 'none', description);
      const modelConfig = await getModelConfig(modelId, userId);
      if (!modelConfig) {
        throw new Error(`Model configuration not found for modelId: ${modelId}`);
      }
      if (!modelConfig.base_url || !modelConfig.api_key || !modelConfig.model_name) {
        throw new Error(`Model configuration is incomplete. Missing base_url, api_key, or model_name.`);
      }

      let aiResponse;
      let postRetryCount = 0;
      const postMaxRetries = 3;

      while (postRetryCount < postMaxRetries) {
        try {
          aiResponse = await fetch(modelConfig.base_url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${modelConfig.api_key}`
            },
            body: JSON.stringify({
              model: modelConfig.model_name,
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

        // Extract content within the first ```json ... ``` block
        const jsonBlockMatch = content.match(/(.*?)```json\n([\s\S]*?)\n```/s);
        console.log('DEBUG: JSON block match found:', !!jsonBlockMatch);

        if (jsonBlockMatch && jsonBlockMatch[2]) {
          explanatoryText = jsonBlockMatch[1] ? jsonBlockMatch[1].trim() : '';
          content = jsonBlockMatch[2]; // Use the content inside the json block for parsing
          console.log('DEBUG: Extracted JSON from block, length:', content.length);
        } else {
          // Fallback if no markdown block is found, try to find the first { and last }
          const jsonStartIndex = content.indexOf('{');
          const jsonEndIndex = content.lastIndexOf('}');
          console.log('DEBUG: JSON delimiters - start:', jsonStartIndex, 'end:', jsonEndIndex);
          if (jsonStartIndex === -1 || jsonEndIndex === -1) {
            throw new Error('Could not find JSON object in the AI response');
          }
          content = content.substring(jsonStartIndex, jsonEndIndex + 1);
          console.log('DEBUG: Extracted JSON from delimiters, length:', content.length);
        }

        console.log('DEBUG: JSON content to parse (first 500 chars):', content.substring(0, 500));

        // Improved JSON parsing with better error handling
        let parsedJson;
        try {
          parsedJson = JSON.parse(content);
        } catch (initialParseError: any) {
          console.warn('Initial JSON parse failed, attempting to clean and retry:', initialParseError.message);

          // Try to fix common JSON issues
          let cleanedContent = content;

          // Remove trailing commas before closing braces/brackets
          cleanedContent = cleanedContent.replace(/,\s*([}\]])/g, '$1');

          // Fix unescaped quotes in strings - more robust approach
          cleanedContent = cleanedContent.replace(/"([^"\\]*(\\.[^"\\]*)*)"([^":,}\]\s])/g, '"$1\\"$3');

          // Fix unterminated strings by finding unmatched quotes
          const lines = cleanedContent.split('\n');
          const fixedLines = lines.map((line: string) => {
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

          try {
            parsedJson = JSON.parse(cleanedContent);
            console.log('✅ Successfully parsed JSON after cleaning');
          } catch (secondParseError: any) {
            console.error('JSON parsing failed even after cleaning. Original error:', initialParseError.message);
            console.error('Cleaned content (first 1000 chars):', cleanedContent.substring(0, 1000));
            console.error('Cleaned content (last 500 chars):', cleanedContent.substring(Math.max(0, cleanedContent.length - 500)));
            throw new Error(`Failed to parse AI response as valid JSON. Error at position ${initialParseError.message.match(/position (\d+)/)?.[1] || 'unknown'}: ${initialParseError.message}`);
          }
        }

        console.log('DEBUG: Parsed JSON keys:', Object.keys(parsedJson));

        const appNameKey = Object.keys(parsedJson)[0];
        if (!appNameKey || !parsedJson[appNameKey]) {
          throw new Error('AI response did not contain expected project file structure.');
        }
        projectFiles = parsedJson[appNameKey];

      } catch (parseError: any) {
        console.error('Failed to parse AI model response as JSON:', parseError);
        const content = aiResult.choices[0]?.message?.content;
        console.error('AI Model Response Content that failed to parse:', content);
        throw new Error(`Failed to parse AI model response as JSON: ${parseError.message}`);
      }

      const flattenedProjectFiles = flattenProjectFiles(projectFiles);
      console.log('DEBUG: flattenedProjectFiles keys:', Object.keys(flattenedProjectFiles));
      console.log('DEBUG: flattenedProjectFiles content:', JSON.stringify(flattenedProjectFiles, null, 2));
      await createProjectStructure(targetPath, flattenedProjectFiles);

      // Write environment files for generated app if envUpdate provided
      try {
        const envUpdate = (requestBody as any)?.envUpdate as { pbUrl?: string; adminEmail?: string; adminPassword?: string } | undefined;
        if (envUpdate?.pbUrl) {
          const pbDir = path.join(targetPath, 'PB_Datos');
          await fs.mkdir(pbDir, { recursive: true });
          const pbEnvPath = path.join(pbDir, '.env');
          const pbEnvContent = [
            `NEXT_PUBLIC_POCKETBASE_URL=${envUpdate.pbUrl}`,
            envUpdate.adminEmail ? `NEXT_PUBLIC_ADMIN_EMAIL=${envUpdate.adminEmail}` : '',
            envUpdate.adminPassword ? `NEXT_PUBLIC_ADMIN_PASSWORD=${envUpdate.adminPassword}` : '',
            ''
          ].filter(Boolean).join('\n');
          await fs.writeFile(pbEnvPath, pbEnvContent, 'utf8');

          const rootEnvLocalPath = path.join(targetPath, '.env.local');
          const rootEnvLocalContent = `NEXT_PUBLIC_POCKETBASE_URL=${envUpdate.pbUrl}\n`;
          await fs.writeFile(rootEnvLocalPath, rootEnvLocalContent, 'utf8');
          console.log('Environment files written:', { pbEnvPath, rootEnvLocalPath });
        }
      } catch (e) {
        console.warn('Could not write env files for generated app:', (e as any)?.message);
      }

      // Clean up files that don't belong to this application type
      // await cleanupIncompatibleFiles(targetPath, selectedTemplate); // Comentado para depuraci n

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
          console.log('✅ Added scripts/start-pocketbase.js to generated files (non-streaming)');
        } else {
          createdFilesArray[startPocketbaseIndex].content = startPocketbaseContent;
          console.log('✅ Updated scripts/start-pocketbase.js in generated files (non-streaming)');
        }
      }

      // Save the project archive to PocketBase

    }

    return NextResponse.json({ message: 'App generation completed (non-web-app type or no generation needed)' });

  } catch (error: any) {
    console.error('Error in POST generate-app:', error);
    return NextResponse.json({ message: 'Error generating app', error: error.message }, { status: 500 });
  }
}