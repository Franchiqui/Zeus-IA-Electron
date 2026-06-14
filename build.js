#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { rimraf } = require('rimraf');

console.log('Iniciando proceso de construcción de Zeus IA...');
console.log('============================================');

// Configuración
const ROOT_DIR = process.cwd();
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const BUILD_DIR = path.join(ROOT_DIR, '.next');
const ELECTRON_DIR = path.join(ROOT_DIR, 'electron');

// Colores para la consola
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

function logSuccess(message) {
  console.log(`${colors.green}✅ ${message}${colors.reset}`);
}

function logError(message) {
  console.log(`${colors.red}❌ ${message}${colors.reset}`);
}

function logInfo(message) {
  console.log(`${colors.blue}ℹ️  ${message}${colors.reset}`);
}

function logStep(message) {
  console.log(`\
${colors.cyan}📦 ${message}${colors.reset}`);
}

async function cleanDist() {
  logStep('Limpiando directorio dist...');
  try {
    if (fs.existsSync(DIST_DIR)) {
      await rimraf(DIST_DIR);
      logSuccess('Directorio dist limpiado');
    } else {
      logInfo('Directorio dist no existe, creando...');
      fs.mkdirSync(DIST_DIR, { recursive: true });
    }
  } catch (error) {
    logError(`Error al limpiar dist: ${error.message}`);
    throw error;
  }
}

async function buildNextJS() {
  logStep('Construyendo aplicación Next.js...');
  try {
    execSync('npm run build', { stdio: 'inherit', cwd: ROOT_DIR });
    logSuccess('Next.js construido correctamente');

    // Verificar que .next existe
    if (!fs.existsSync(BUILD_DIR)) {
      throw new Error('No se encontró la carpeta .next después de la construcción');
    }

    // Listar archivos en .next para verificación
    const nextFiles = fs.readdirSync(BUILD_DIR);
    logInfo(`Archivos en .next: ${nextFiles.length} archivos/directorios`);

  } catch (error) {
    logError(`Error al construir Next.js: ${error.message}`);
    throw error;
  }
}

async function buildRaeApi() {
  logStep('Compilando API RAE (api/api-rae)...');
  const raeApiDir = path.join(ROOT_DIR, 'api', 'api-rae');

  if (!fs.existsSync(raeApiDir)) {
    logInfo('Directorio api/api-rae no encontrado, saltando compilación RAE.');
    return;
  }

  // Asegurarse de que las dependencias estén instaladas
  const nodeModulesDir = path.join(raeApiDir, 'node_modules');
  if (!fs.existsSync(nodeModulesDir)) {
    logInfo('Instalando dependencias de api-rae...');
    execSync('npm install', { stdio: 'inherit', cwd: raeApiDir });
  }

  try {
    // Compilar TypeScript → dist/  (usa el script "build" del package.json de api-rae)
    execSync('npm run build', { stdio: 'inherit', cwd: raeApiDir });
    logSuccess('API RAE compilada correctamente');

    // Verificar que se generó dist/api.js
    const distApiJs = path.join(raeApiDir, 'dist', 'api.js');
    if (!fs.existsSync(distApiJs)) {
      throw new Error(`No se generó ${distApiJs} tras la compilación TypeScript`);
    }
    logInfo(`Archivo de salida verificado: api/api-rae/dist/api.js`);
  } catch (error) {
    logError(`Error al compilar API RAE: ${error.message}`);
    throw error;
  }
}

async function copyFilesForElectron() {
  logStep('Copiando archivos para Electron...');

  const filesToCopy = [
    // Archivos principales
    'index.html',
    'package.json',
    'package-lock.json',
    'next.config.js',
    'tailwind.config.js',
    'postcss.config.js',
    'tsconfig.json',
    'next-env.d.ts',

    // Configuraciones
    '.env.example',
    '.eslintrc.json',
    '.prettierrc',

    // Directorios
    'public',
    'prisma',
    'electron',
    '.next'
  ];

  try {
    // Crear estructura en dist
    const appDir = path.join(DIST_DIR, 'app');
    fs.mkdirSync(appDir, { recursive: true });

    // Copiar cada archivo/directorio
    for (const file of filesToCopy) {
      const source = path.join(ROOT_DIR, file);
      const target = path.join(appDir, file);

      if (fs.existsSync(source)) {
        const stats = fs.statSync(source);

        if (stats.isDirectory()) {
          // Copiar directorio recursivamente
          copyDir(source, target);
          logInfo(`Copiado directorio: ${file}`);
        } else {
          // Copiar archivo
          fs.copyFileSync(source, target);
          logInfo(`Copiado archivo: ${file}`);
        }
      } else {
        logInfo(`No encontrado: ${file}`);
      }
    }

    // Crear package.json simplificado para la app empaquetada
    const packageJsonPath = path.join(appDir, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

      // Simplificar package.json para producción
      const simplifiedPackage = {
        name: packageJson.name,
        version: packageJson.version,
        main: packageJson.main,
        dependencies: {
          'electron': packageJson.dependencies.electron,
          'electron-is-dev': packageJson.dependencies['electron-is-dev']
        },
        scripts: {
          'start': 'electron .'
        }
      };

      fs.writeFileSync(packageJsonPath, JSON.stringify(simplifiedPackage, null, 2));
      logInfo('Package.json simplificado para producción');
    }

    logSuccess('Archivos copiados correctamente');

  } catch (error) {
    logError(`Error al copiar archivos: ${error.message}`);
    throw error;
  }
}

function copyDir(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

async function buildElectron() {
  logStep('Construyendo aplicación Electron...');
  try {
    // Usar electron-builder
    execSync('npx electron-builder --win --x64 --ia32', { 
      stdio: 'inherit', 
      cwd: ROOT_DIR 
    });

    logSuccess('Electron construido correctamente');

    // Verificar que se creó el ejecutable
    const winDir = path.join(DIST_DIR, 'win-unpacked');
    if (fs.existsSync(winDir)) {
      const exePath = path.join(winDir, `${require('./package.json').name}.exe`);
      if (fs.existsSync(exePath)) {
        logSuccess(`Ejecutable creado: ${exePath}`);

        // Listar contenido del directorio
        const files = fs.readdirSync(winDir);
        logInfo(`Contenido de win-unpacked: ${files.length} elementos`);

        // Verificar recursos
        const resourcesDir = path.join(winDir, 'resources');
        if (fs.existsSync(resourcesDir)) {
          const resources = fs.readdirSync(resourcesDir);
          logInfo(`Recursos en resources/: ${resources.join(', ')}`);
        }
      }
    }

  } catch (error) {
    logError(`Error al construir Electron: ${error.message}`);
    throw error;
  }
}

async function main() {
  try {
    console.log(`${colors.magenta}============================================${colors.reset}`);
    console.log(`${colors.magenta}   Zeus IA - BUILD PROCESS   ${colors.reset}`);
    console.log(`${colors.magenta}============================================${colors.reset}`);

    // 1. Limpiar dist
    await cleanDist();

    // 2. Construir Next.js
    await buildNextJS();

    // 3. Copiar archivos
    await copyFilesForElectron();

    // 4. Construir Electron
    await buildElectron();
  } catch (error) {
    logError(`Proceso de construcción fallido: ${error.message}`);
    process.exit(1);
  }
}

main();
