#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🚀 Ejecutando postbuild script...');

const ROOT_DIR = process.cwd();
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const APP_DIR = path.join(DIST_DIR, 'win-unpacked', 'resources', 'app');

// Colores para consola
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  yellow: '\x1b[33m'
};

function logSuccess(msg) {
  console.log(`${colors.green}✅ ${msg}${colors.reset}`);
}

function logError(msg) {
  console.log(`${colors.red}❌ ${msg}${colors.reset}`);
}

function logInfo(msg) {
  console.log(`${colors.blue}ℹ️  ${msg}${colors.reset}`);
}

function logWarning(msg) {
  console.log(`${colors.yellow}⚠️  ${msg}${colors.reset}`);
}

async function main() {
  try {
    console.log('\
📦 POSTBUILD SCRIPT - API GENERATOR DESKTOP');
    console.log('============================================');

    // 1. Verificar que la carpeta de la aplicación existe
    if (!fs.existsSync(APP_DIR)) {
      logWarning(`No se encontró la carpeta de la aplicación en: ${APP_DIR}`);
      logInfo('Creando estructura de directorios...');

      // Crear estructura de directorios
      fs.mkdirSync(APP_DIR, { recursive: true });

      // Copiar archivos esenciales
      const essentialFiles = [
        'index.html',
        'package.json',
        'next.config.js',
        'tailwind.config.js',
        'postcss.config.js',
        'tsconfig.json',
        'next-env.d.ts'
      ];

      for (const file of essentialFiles) {
        const src = path.join(ROOT_DIR, file);
        const dest = path.join(APP_DIR, file);

        if (fs.existsSync(src)) {
          fs.copyFileSync(src, dest);
          logInfo(`Copiado: ${file}`);
        }
      }

      // Copiar directorios
      const essentialDirs = ['public', 'prisma', 'electron', '.next'];

      for (const dir of essentialDirs) {
        const src = path.join(ROOT_DIR, dir);
        const dest = path.join(APP_DIR, dir);

        if (fs.existsSync(src)) {
          copyDir(src, dest);
          logInfo(`Copiado directorio: ${dir}`);
        } else {
          logWarning(`No encontrado: ${dir}`);
        }
      }
    } else {
      logSuccess(`Carpeta de aplicación encontrada en: ${APP_DIR}`);

      // Listar contenido
      const files = fs.readdirSync(APP_DIR);
      logInfo(`Contenido de la aplicación: ${files.length} elementos`);

      // Verificar archivos críticos
      const criticalFiles = ['index.html', 'package.json', 'electron/main.js'];
      for (const file of criticalFiles) {
        const filePath = path.join(APP_DIR, file);
        if (fs.existsSync(filePath)) {
          const stats = fs.statSync(filePath);
          logSuccess(`${file} - ${stats.size} bytes`);
        } else {
          logError(`FALTANTE: ${file}`);
        }
      }
    }

    // 2. Verificar y corregir package.json
    const packageJsonPath = path.join(APP_DIR, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      logInfo('Verificando package.json...');

      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

      // Asegurar que main apunta correctamente
      if (!packageJson.main || !packageJson.main.includes('electron/main.js')) {
        packageJson.main = 'electron/main.js';
        logInfo('Corrigiendo entrada principal en package.json');
      }

      // Simplificar scripts but keep essential ones
      packageJson.scripts = {
        "start": "electron .",
        "postbuild": "node scripts/postbuild.js"
      };

      // Keep all dependencies for production
      // Only remove development-specific dependencies
      const devDepsToRemove = ['@types/electron', 'electron-builder', 'eslint', 'eslint-config-next'];
      if (packageJson.devDependencies) {
        devDepsToRemove.forEach(dep => {
          delete packageJson.devDependencies[dep];
        });
      }

fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
logSuccess('package.json optimizado para producción');
}

// 3. Verificar index.html
const indexPath = path.join(APP_DIR, 'index.html');
if (fs.existsSync(indexPath)) {
  const indexContent = fs.readFileSync(indexPath, 'utf8');

  // Verificar que index.html tenga contenido
  if (indexContent.trim().length < 100) {
    logError('index.html parece estar vacío o casi vacío');

    // Crear un index.html básico si está vacío
    const basicHtml = `
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Api Generator Desktop</title>
    <style>
      body {
        margin: 0;
        padding: 0;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        background: #0f172a;
        color: white;
        height: 100vh;
        display: flex;
        justify-content: center;
        align-items: center;
        text-align: center;
      }
    </style>
</head>
<body>
    <div>
        <h1>Api Generator Desktop</h1>
        <p>La aplicación se está cargando...</p>
    </div>
</body>
</html>`;

    fs.writeFileSync(indexPath, basicHtml);
    logSuccess('index.html básico creado');
  }
}

    logSuccess('¡Postbuild completado exitosamente!');

  } catch (error) {
    logError(`Error en postbuild: ${error.message}`);
    console.error(error);
    process.exit(1);
  }
}

main();
