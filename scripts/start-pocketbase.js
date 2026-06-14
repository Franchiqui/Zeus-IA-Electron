#!/usr/bin/env node
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const pocketBaseDir = path.join(process.cwd(), 'pocket-base');
const executableName = process.platform === 'win32' ? 'pocketbase.exe' : 'pocketbase';
const executablePath = path.join(pocketBaseDir, executableName);

if (!fs.existsSync(executablePath)) {
  console.error('❌ No se encontró PocketBase en:', executablePath);
  console.error('Ejecuta primero: node scripts/install-pocketbase.js');
  process.exit(1);
}

const child = spawn(executablePath, ['serve', '--http=0.0.0.0:8090'], {
  cwd: pocketBaseDir,
  stdio: 'inherit',
});
child.on('exit', (code) => process.exit(code ?? 0));
