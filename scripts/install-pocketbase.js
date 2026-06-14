// Ejecutado por postinstall cuando el proyecto usa PocketBase
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const rootPath = process.cwd();
const pocketBasePath = path.join(rootPath, 'pocket-base');
const installScriptPath = path.join(pocketBasePath, 'install.js');

if (fs.existsSync(installScriptPath)) {
  try {
    process.chdir(pocketBasePath);
    execSync('node install.js', { stdio: 'inherit' });
    console.log('✅ Instalación de PocketBase completada');
  } catch (err) {
    console.error('❌ Error instalando PocketBase:', err?.message);
  } finally {
    process.chdir(rootPath);
  }
} else {
  console.log('ℹ️ Sin pocket-base: omitiendo (si se añade después, ejecuta: node scripts/install-pocketbase.js)');
}