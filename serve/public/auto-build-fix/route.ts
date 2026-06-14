import { NextRequest, NextResponse } from 'next/server';
import { getPocketBase } from '@/lib/pocketbase';
import { UsageService, getModelsForUser } from '@/api/utils';
import * as fs from 'fs-extra';
import * as path from 'path';
import { spawn } from 'child_process';
import archiver from 'archiver';
import os from 'os';
import { initPocketBase, isPocketBaseInitialized } from '@/api/lib/pocketbaseForGenerateApi';



// Function to find project root (looks for package.json)
async function findProjectRoot(dirPath: string): Promise<string> {
  const items = await fs.readdir(dirPath);

  // Check if current directory has package.json
  if (items.includes('package.json')) {
    return dirPath;
  }

  // Look for subdirectories
  for (const item of items) {
    const itemPath = path.join(dirPath, item);
    const stat = await fs.stat(itemPath);
    if (stat.isDirectory()) {
      try {
        const subItems = await fs.readdir(itemPath);
        if (subItems.includes('package.json')) {
          return itemPath;
        }
      } catch (e) {
        // Continue searching
      }
    }
  }

  return dirPath; // Fallback to original directory
}

// Function to run npm command
function runNpmCommand(projectPath: string, command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let actualCommand = command;
    // Create modifiable environment object
    let env = Object.assign({}, process.env, 
      actualCommand.startsWith('NODE_ENV=production ') ? { NODE_ENV: 'production' } : {}
    );
    
    // Remove prefix from command if present
    if (actualCommand.startsWith('NODE_ENV=production ')) {
      actualCommand = actualCommand.substring('NODE_ENV=production '.length);
    }

    const [cmd, ...args] = actualCommand.split(' ');

    let spawnCommand = cmd;
    let spawnArgs = args;

    if (cmd === 'npm') {
      const npmExecPath = env.npm_execpath || process.env.npm_execpath; // Use the npm_execpath from inherited env first
      if (npmExecPath && fs.existsSync(npmExecPath)) {
        spawnCommand = process.execPath;
        spawnArgs = [npmExecPath, ...args];
      } else if (process.platform === 'win32') {
        spawnCommand = 'npm.cmd';
      }
    }

    const child = spawn(spawnCommand, spawnArgs, {
      cwd: projectPath,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: env // Pass the modified environment variables
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(stderr || stdout));
      }
    });

    child.on('error', (error) => {
      if ((error as any)?.code === 'ENOENT' && cmd === 'npm') {
        reject(new Error('npm command not found. Ensure Node.js and npm are installed and available in the system PATH.'));
      } else {
        reject(error);
      }
    });
  });
}

// Function to parse build errors
function parseBuildErrors(errorOutput: string): any[] {
  const lines = errorOutput.split('\n').filter(line => line.trim());
  const errors: any[] = [];

  // Common error patterns
  const errorPatterns = [
    // TypeScript errors
    /^\s*(.+?\.tsx?)\((\d+),(\d+)\):\s*(error|Error)\s*(.+)$/i,
    // ESLint errors
    /^\s*(.+?\.tsx?):\s*line\s+(\d+),\s*col\s+(\d+),\s*(.+?)\s*\((.+)\)$/i,
    // General file errors
    /^\s*(.+?\.(js|jsx|ts|tsx|json|css|scss|md))\s*:\s*(.+)$/i,
  ];

  for (const line of lines) {
    let parsedError = null;

    // Try to match against known error patterns
    for (const pattern of errorPatterns) {
      const match = line.match(pattern);
      if (match) {
        if (pattern === errorPatterns[0] || pattern === errorPatterns[1]) { // TS/ESLint errors
          const file = match[1];
          const lineNum = match[2];
          const colNum = match[3] || '0';
          const errorType = match[4] || match[5] || 'error';
          const message = match[5] || match[4] || 'Error desconocido';

          parsedError = {
            message: `${errorType}: ${message}`,
            context: [`${file}(${lineNum},${colNum})`],
            file: file,
            line: parseInt(lineNum),
            column: parseInt(colNum),
            type: 'syntax_error'
          };
        } else if (pattern === errorPatterns[2]) { // General file errors
          parsedError = {
            message: match[3],
            context: [line],
            file: match[1],
            type: 'file_error'
          };
        }
        break;
      }
    }

    // If no pattern matched, create a generic error
    if (!parsedError) {
      const fileMatch = line.match(/([./\\][\w./\\-]+\.(js|jsx|ts|tsx|json|css|scss|md))/i);
      if (fileMatch) {
        parsedError = {
          message: line.trim(),
          context: [line],
          file: fileMatch[1],
          type: 'unknown_error'
        };
      } else {
        parsedError = {
          message: line.trim() || 'Error de compilación detectado',
          context: [line],
          type: 'generic_error'
        };
      }
    }

    errors.push(parsedError);
  }

  // Remove duplicates
  const uniqueErrors = errors.filter((error, index, self) =>
    index === self.findIndex(e => e.message === error.message && e.file === error.file)
  );

  return uniqueErrors.slice(0, 10); // Limit to 10 errors max
}

// Function to send errors to AI model for fixing
async function sendErrorsToModel(errors: any[], attemptNumber: number, modelConfig: any, tempProjectDir: string, projectId?: string, userId?: string) {
  try {
    console.log(`[API] Sending ${errors.length} errors to model for fixing (attempt ${attemptNumber})`);

    const errorContext = errors.map((error: any, index: number) => `
Error ${index + 1}:
Type: ${error.message}
${error.context && error.context.length > 0 ? `Context:\n${error.context.join('\n')}` : ''}
    `).join('\n---\n');

    // Load project files for context
    let loadedProjectFiles: any = {};
    try {
      const readProjectFiles = async (dirPath: string, basePath: string = dirPath): Promise<any> => {
        const files: any = {};
        const items = await fs.readdir(dirPath, { withFileTypes: true });

        for (const item of items) {
          const fullPath = path.join(dirPath, item.name);
          const relativePath = path.relative(basePath, fullPath);

          // Skip node_modules, .git, build outputs, etc.
          if (item.name.startsWith('.') ||
              item.name === 'node_modules' ||
              item.name === 'dist' ||
              item.name === 'build' ||
              item.name === '.next' ||
              item.name === 'coverage' ||
              relativePath.includes('node_modules')) {
            continue;
          }

          if (item.isDirectory()) {
            const subFiles = await readProjectFiles(fullPath, basePath);
            Object.assign(files, subFiles);
          } else if (item.isFile()) {
            const ext = path.extname(item.name).toLowerCase();
            if (['.js', '.jsx', '.ts', '.tsx', '.json', '.css', '.scss', '.md'].includes(ext)) {
              try {
                const content = await fs.readFile(fullPath, 'utf-8');
                if (content.length < 50000) { // 50KB limit per file
                  files[relativePath] = content;
                }
              } catch (err) {
                console.warn(`[API] Could not read file ${relativePath}:`, err);
              }
            }
          }
        }
        return files;
      };

      loadedProjectFiles = await readProjectFiles(tempProjectDir);
      console.log(`[API] Loaded ${Object.keys(loadedProjectFiles).length} project files for context`);
    } catch (err) {
      console.warn('[API] Could not load project files:', err);
    }

    const systemPrompt = `Eres un experto desarrollador de software. Tu tarea es analizar errores de compilación/build y proporcionar correcciones precisas.

**ERRORES A CORREGIR:**
${errorContext}

**INSTRUCCIONES CRÍTICAS:**
1. **LEE LOS ARCHIVOS PROPORCIONADOS** arriba para encontrar el código exacto que contiene los errores
2. Analiza CADA error individualmente y localiza el archivo correcto
3. Proporciona correcciones específicas y precisas usando el código EXACTO del archivo
4. Usa el formato JSON exacto especificado
5. Incluye suficiente contexto (3-5 líneas antes y después) para matches exactos
6. Si hay múltiples errores, crea múltiples correcciones en el mismo JSON

**FORMATO DE RESPUESTA:**
Responde ÚNICAMENTE con un objeto JSON válido:
{
  "corrections": [
    {
      "file": "ruta/al/archivo.tsx",
      "oldCode": "código exacto a reemplazar (con contexto)",
      "newCode": "código corregido",
      "explanation": "Explicación de la corrección"
    }
  ]
}

**CONTEXTO DE ARCHIVOS:**
${Object.keys(loadedProjectFiles).length > 0 ?
  Object.entries(loadedProjectFiles).map(([filePath, content]) =>
    `=== ${filePath} ===
${content}`).join('\n\n') :
  'No se pudieron cargar archivos del proyecto'}`;

    const userMessage = `Por favor analiza estos errores de compilación y proporciona correcciones específicas usando el formato JSON requerido.

Errores encontrados:
${errorContext}

**IMPORTANTE:** Los archivos del proyecto están incluidos arriba en el system prompt. Debes usar el código EXACTO de esos archivos para crear las correcciones.`;

    const aiResponse = await fetch(modelConfig.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${modelConfig.apiKey}`
      },
      body: JSON.stringify({
        model: modelConfig.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ],
        temperature: 0.1,
        max_tokens: 8192
      })
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('[API] AI model error:', errorText);
      return { success: false, error: `AI model error: ${aiResponse.status}` };
    }

    const aiData = await aiResponse.json();

    // >>> REGISTRO DE CONSUMO <<<
    if (aiData.usage && userId) {
      try {
        await UsageService.recordUsage(userId, {
          dbId: modelConfig.id || modelConfig.dbId || 'unknown',
          apiKey: modelConfig.model || 'unknown', // ✅ USAR NOMBRE DEL MODELO, NO API KEY
          name: modelConfig.name || modelConfig.model || 'Auto Build Fix',
          type: modelConfig.type || 'fix'
        }, {
          promptTokens: aiData.usage.prompt_tokens || 0,
          completionTokens: aiData.usage.completion_tokens || 0,
          cacheHitTokens: aiData.usage.prompt_cache_hit_tokens || 0,
          requestId: aiData.id
        });
      } catch (usageError) {
        console.error('[Usage Recording] Error registrando consumo en Auto Build Fix:', usageError);
      }
    }

    const aiContent = aiData.choices[0]?.message?.content?.trim();

    if (!aiContent) {
      return { success: false, error: 'Empty response from AI model' };
    }

    console.log('[API] AI model response received');

    let corrections = [];
    try {
      let jsonString = aiContent;
      const jsonMatch = jsonString.match(/```json\s*([\s\S]*?)\s*```/i) ||
                       jsonString.match(/```\s*([\s\S]*?)\s*```/i);

      if (jsonMatch && jsonMatch[1]) {
        jsonString = jsonMatch[1].trim();
      }

      const jsonStart = jsonString.indexOf('{');
      const jsonEnd = jsonString.lastIndexOf('}');

      if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
        jsonString = jsonString.substring(jsonStart, jsonEnd + 1);
      }

      const parsedResponse = JSON.parse(jsonString);

      if (parsedResponse.corrections && Array.isArray(parsedResponse.corrections)) {
        corrections = parsedResponse.corrections;
        console.log(`[API] AI provided ${corrections.length} corrections`);
      } else {
        console.warn('[API] AI response does not contain corrections array');
        return { success: false, error: 'AI did not provide corrections in expected format' };
      }
    } catch (parseError) {
      console.error('[API] Failed to parse AI response:', parseError);
      console.error('[API] Raw AI response:', aiContent);
      return { success: false, error: 'Failed to parse AI corrections' };
    }

    if (corrections.length === 0) {
      console.log('[API] No corrections provided by AI');
      return { success: false, error: 'No automatic fixes available for these errors' };
    }

    // Apply the corrections to files
    console.log(`[API] Applying ${corrections.length} AI-generated corrections...`);
    
    for (const correction of corrections) {
      try {
        const filePath = path.join(tempProjectDir, correction.file);
        const fileContent = await fs.readFile(filePath, 'utf-8');
        
        // Replace the old code with new code
        const updatedContent = fileContent.replace(correction.oldCode, correction.newCode);
        
        if (updatedContent !== fileContent) {
          await fs.writeFile(filePath, updatedContent, 'utf-8');
          console.log(`[API] Applied correction to ${correction.file}`);
        } else {
          console.warn(`[API] No changes applied to ${correction.file} - pattern not found`);
        }
      } catch (fileError) {
        console.warn(`[API] Failed to apply correction to ${correction.file}:`, fileError);
      }
    }

    console.log('[API] AI corrections applied successfully');
    return { success: true, corrections };

  } catch (apiError: any) {
    console.warn('[API] Failed to send errors to model:', apiError.message);
    return { success: false, error: apiError.message };
  }
}

export async function POST(request: NextRequest) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, User-Agent, Authorization'
  };

  // Handle preflight requests
  if (request.method === 'OPTIONS') {
    return new NextResponse(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { projectId, selectedModel, buildStrategy = 'remote', files } = await request.json();

    console.log(`[API] Auto Build & Fix - Project: ${projectId}`);

    if (!projectId) {
      return NextResponse.json({
        success: false,
        error: 'Project ID es requerido'
      }, { status: 400, headers: corsHeaders });
    }

    if (!selectedModel) {
      return NextResponse.json({
        success: false,
        error: 'Modelo no proporcionado'
      }, { status: 400, headers: corsHeaders });
    }

    if (buildStrategy === 'local-files') {
      if (!Array.isArray(files) || files.length === 0) {
        return NextResponse.json({
          success: false,
          error: 'No se proporcionaron archivos para el build local'
        }, { status: 400, headers: corsHeaders });
      }

      const tempBase = process.env.TEMP || process.env.TMPDIR || os.tmpdir();
      const tempDir = path.join(tempBase, `autofix_local_${projectId || 'local'}_${Date.now()}`);
      await fs.ensureDir(tempDir);

      try {
        for (const file of files) {
          if (!file || typeof file.path !== 'string') continue;
          const safePath = file.path.replace(/^[/\\]+/, '');
          const targetPath = path.join(tempDir, safePath);
          await fs.ensureDir(path.dirname(targetPath));
          await fs.writeFile(targetPath, typeof file.content === 'string' ? file.content : '', 'utf-8');
        }

        const workingProjectRoot = await findProjectRoot(tempDir);
        const packageJsonPath = path.join(workingProjectRoot, 'package.json');
        if (!fs.existsSync(packageJsonPath)) {
          throw new Error('No se encontró package.json en el proyecto local');
        }

        const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
        if (!packageJson.scripts || !packageJson.scripts.build) {
          throw new Error('El proyecto no tiene script de build definido');
        }

        const maxAttempts = 3;
        let attempt = 0;
        let lastErrors: any[] = [];
        const buildLog: string[] = [];

        while (attempt < maxAttempts) {
          attempt++;
          buildLog.push(`=== Intento ${attempt}/${maxAttempts} ===`);
          try {
            buildLog.push('Ejecutando: npm run build');
            await runNpmCommand(workingProjectRoot, 'npm run build');
            buildLog.push('✅ Build completado exitosamente');
            await fs.remove(tempDir);
            return NextResponse.json({
              success: true,
              message: `Build completado exitosamente en ${attempt} ${(attempt === 1) ? 'intento' : 'intentos'}.`,
              attempts: attempt,
              buildLog
            }, { headers: corsHeaders });
          } catch (buildError: any) {
            buildLog.push('❌ Build falló, extrayendo errores...');
            const errorMessage = buildError.message || '';
            const currentErrors = parseBuildErrors(errorMessage);

            if (currentErrors.length === 0) {
              await fs.remove(tempDir);
              return NextResponse.json({
                success: false,
                error: 'Build falló pero no se pudieron identificar errores específicos para corregir automáticamente.',
                output: errorMessage,
                buildLog
              }, { status: 400, headers: corsHeaders });
            }

            const errorsChanged = JSON.stringify(currentErrors) !== JSON.stringify(lastErrors);
            lastErrors = currentErrors;
            if (attempt > 1 && !errorsChanged) {
              await fs.remove(tempDir);
              return NextResponse.json({
                success: false,
                error: `Los errores persisten después de ${attempt} intentos de corrección.`,
                errors: currentErrors,
                attempts: attempt,
                buildLog
              }, { status: 400, headers: corsHeaders });
            }

            const fixResult = await sendErrorsToModel(currentErrors, attempt, selectedModel, workingProjectRoot, projectId, undefined);
            if (!fixResult.success) {
              buildLog.push(`⚠️ Corrección de IA falló: ${fixResult.error}`);
            } else {
              buildLog.push(`✅ Correcciones de IA aplicadas (${fixResult.corrections?.length || 0} cambios)`);
            }
          }
        }

        await fs.remove(tempDir);
        return NextResponse.json({
          success: false,
          error: `Build falló después de ${maxAttempts} intentos de corrección automática.`,
          errors: lastErrors,
          attempts: maxAttempts,
          buildLog
        }, { status: 400, headers: corsHeaders });
      } catch (localError: any) {
        await fs.remove(tempDir).catch(() => {});
        return NextResponse.json({
          success: false,
          error: 'Error interno durante el proceso de build automático',
          details: localError?.message || String(localError)
        }, { status: 500, headers: corsHeaders });
      }
    }

    // Initialize PocketBase
    if (!isPocketBaseInitialized()) {
      const pocketbaseUrl = process.env.NEXT_PUBLIC_POCKETBASE_URL || 'https://zeus-basedatos.fly.dev';
      await initPocketBase({ url: pocketbaseUrl });
    }
    const pb = getPocketBase();

    // Get project record
    const projectRecord = await (await pb).collection('projects').getOne(projectId);

    if (!projectRecord) {
      return NextResponse.json({
        success: false,
        error: 'Proyecto no encontrado'
      }, { status: 404, headers: corsHeaders });
    }

    const userId = projectRecord.user;

    if (!projectRecord.project_archive) {
      return NextResponse.json({
        success: false,
        error: 'El proyecto no tiene un archivo ZIP asociado'
      }, { status: 400, headers: corsHeaders });
    }

    // Create temporary directory for the project
    // Determine base temporary directory based on build strategy
    let tempBase;
    if (buildStrategy === 'local') {
      // Use a local temporary directory for local builds
      tempBase = process.env.TEMP || process.env.TMPDIR || os.tmpdir();
    } else {
      // For remote builds (on Vercel), use /tmp if in production, otherwise local temp
      const isProductionEnv = process.env.NODE_ENV === 'production';
      tempBase = isProductionEnv ? '/tmp' : process.env.TEMP || process.env.TMPDIR || '/tmp';
    }
    const tempDir = path.join(tempBase, `autofix_${projectId}_${Date.now()}`);
    await fs.ensureDir(tempDir);

          try {
            if (buildStrategy === 'remote') {
              // Download the ZIP file from PocketBase
              console.log('[API] Downloading project ZIP from PocketBase para construcción REMOTA...');
              const zipResponse = await fetch(`${process.env.NEXT_PUBLIC_POCKETBASE_URL}/api/files/projects/${projectId}/${projectRecord.project_archive}`);
              if (!zipResponse.ok) {
                throw new Error(`Failed to download ZIP: ${zipResponse.status}`);
              }
    
              const zipBuffer = await zipResponse.arrayBuffer();
              const zipPath = path.join(tempDir, 'project.zip');
              await fs.writeFile(zipPath, Buffer.from(zipBuffer));
    
            
    
              // Find the actual project directory
              const workingProjectRoot = await findProjectRoot(tempDir);
              console.log(`[API] Project root found: ${workingProjectRoot}`);
    
              // Check if it's a valid project with build script
              const packageJsonPath = path.join(workingProjectRoot, 'package.json');
              if (!fs.existsSync(packageJsonPath)) {
                throw new Error('No se encontró package.json en el proyecto');
              }
    
              const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
              if (!packageJson.scripts || !packageJson.scripts.build) {
                throw new Error('El proyecto no tiene script de build definido');
              }
    
              // Main build and fix loop
              const maxAttempts = 3;
              let attempt = 0;
              let lastErrors: any[] = [];
              let buildLog: string[] = [];
              
              while (attempt < maxAttempts) {
                attempt++;
                console.log(`[API] === Build attempt ${attempt}/${maxAttempts} ===`);
                buildLog.push(`=== Intento ${attempt}/${maxAttempts} ===`);
    
                // Run npm run build
                console.log('[API] Executing: npm run build');
                buildLog.push('Ejecutando: npm run build');
                
                try {
                  const buildOutput = await runNpmCommand(workingProjectRoot, 'npm run build');
                  console.log('[API] Build completed successfully');
                  buildLog.push('✅ Build completado exitosamente');
    
                  // Build successful - update ZIP in PocketBase
                  console.log('[API] Build successful, updating ZIP in PocketBase...');
                  buildLog.push('Actualizando ZIP en PocketBase...');
                  
                  // Create new ZIP with corrected files
                  const updatedArchiveName = `project_${projectId}_corrected_${Date.now()}.zip`;
                  const updatedArchivePath = path.join('/tmp', updatedArchiveName);
                  const updatedOutput = fs.createWriteStream(updatedArchivePath);
                  const updatedArchive = archiver('zip', {
                    zlib: { level: 9 }
                  });
    
                  const updatedOutputClosed = new Promise<void>((resolve, reject) => {
                    updatedOutput.on('close', () => {
                      console.log('[API] Updated ZIP archive created.');
                      resolve();
                    });
                    updatedOutput.on('error', (err: Error) => {
                      console.error('[API] Updated ZIP output stream error:', err);
                      reject(err);
                    });
                  });
    
                  updatedArchive.on('warning', function(err: archiver.ArchiverError) {
                    if (err.code === 'ENOENT') {
                      console.warn('[API] Updated ZIP archiver warning (ENOENT):', err);
                    } else {
                      console.error('[API] Updated ZIP archiver warning:', err);
                    }
                  });
    
                  updatedArchive.on('error', function(err: archiver.ArchiverError) {
                    console.error('[API] Updated ZIP archiver error:', err);
                    throw err;
                  });
    
                  updatedArchive.pipe(updatedOutput);
                  updatedArchive.directory(workingProjectRoot, '');
                  await updatedArchive.finalize();
                  await updatedOutputClosed;
    
                  // Upload updated ZIP to PocketBase
                  console.log('[API] Uploading updated ZIP to PocketBase...');
                  const updatedArchiveBuffer = await fs.readFile(updatedArchivePath);
                  const updatedArchiveBlob = new Blob([new Uint8Array(updatedArchiveBuffer)], { type: 'application/zip' });
    
                  const updatedFormData = new FormData();
                  updatedFormData.append('project_archive', updatedArchiveBlob, updatedArchiveName);
    
                  // Try with user token first
                  let pbUpdated = false;
                  const userToken = (await pb).authStore.token;
                  if (userToken) {
                    try {
                      (await pb).authStore.save(userToken, null as any);
                      console.log('[API] Using user token to update corrected ZIP...');
                      await (await pb).collection('projects').update(projectId, updatedFormData);
                      console.log('[API] Corrected ZIP uploaded successfully with user token.');
                      pbUpdated = true;
                    } catch (userErr: any) {
                      console.warn('[API] User token update failed:', userErr?.message || userErr);
                      (await pb).authStore.clear();
                    }
                  }
    
                  // Fallback to admin credentials
                  if (!pbUpdated) {
                    const adminEmail = process.env.POCKETBASE_EMAIL || process.env.NEXT_PUBLIC_POCKETBASE_EMAIL;
                    const adminPass = process.env.POCKETBASE_PASSWORD || process.env.NEXT_PUBLIC_POCKETBASE_PASSWORD;
                    if (adminEmail && adminPass) {
                      console.log('[API] Authenticating with admin credentials for ZIP update...');
                      try {
                        await (await pb).admins.authWithPassword(adminEmail, adminPass);
                        console.log('[API] Admin authenticated for ZIP update.');
                      } catch (adminErr) {
                        console.log('[API] Admin auth failed, trying user auth...');
                        await (await pb).collection('users').authWithPassword(adminEmail, adminPass);
                        console.log('[API] User authenticated for ZIP update.');
                      }
    
                      await (await pb).collection('projects').update(projectId, updatedFormData);
                      console.log('[API] Corrected ZIP uploaded successfully with admin credentials.');
                      pbUpdated = true;
                    }
                  }
    
                  if (pbUpdated) {
                    console.log('[API] ZIP file updated in PocketBase with corrected files');
                    buildLog.push('✅ ZIP actualizado en PocketBase');
                  } else {
                    console.warn('[API] Could not update ZIP in PocketBase, but corrections were applied locally');
                    buildLog.push('⚠️ No se pudo actualizar el ZIP en PocketBase');
                  }
    
                  // Clean up updated archive file
                  await fs.unlink(updatedArchivePath);
                  console.log('[API] Cleaned up temporary updated archive file.');
    
                  return NextResponse.json({
                    success: true,
                    message: `Build completado exitosamente en ${attempt} ${(attempt === 1) ? 'intento' : 'intentos'}. Los archivos corregidos han sido guardados en PocketBase.`,
                    attempts: attempt,
                    zipUpdated: pbUpdated,
                    buildLog: buildLog
                  }, { headers: corsHeaders });
    
                } catch (buildError: any) {
                  console.log('[API] Build failed, extracting errors');
                  buildLog.push('❌ Build falló, extrayendo errores...');
                  
                  const errorMessage = buildError.message || '';
                  const currentErrors = parseBuildErrors(errorMessage);
    
                  if (currentErrors.length === 0) {
                    console.log('[API] Build failed but no specific errors found');
                    buildLog.push('No se encontraron errores específicos para corregir');
                    // Clean up
                    await fs.remove(tempDir);
                    return NextResponse.json({
                      success: false,
                      error: 'Build falló pero no se pudieron identificar errores específicos para corregir automáticamente.',
                      output: errorMessage,
                      buildLog: buildLog
                    }, { status: 400, headers: corsHeaders });
                  }
    
                  console.log(`[API] Found ${currentErrors.length} errors`);
                  buildLog.push(`Encontrados ${currentErrors.length} errores:`);
                  currentErrors.forEach((err, idx) => {
                    buildLog.push(`  ${idx + 1}. ${err.message}`);
                  });
    
                  // Check if errors are the same as last attempt (prevent infinite loop)
                  const errorsChanged = JSON.stringify(currentErrors) !== JSON.stringify(lastErrors);
                  lastErrors = currentErrors;
    
                  if (attempt > 1 && !errorsChanged) {
                    console.log('[API] Same errors as previous attempt, stopping to prevent infinite loop');
                    buildLog.push('Los mismos errores persisten, deteniendo para evitar bucle infinito');
                    // Clean up
                    await fs.remove(tempDir);
                    return NextResponse.json({
                      success: false,
                      error: `Los errores persisten después de ${attempt} intentos de corrección.`,
                      errors: currentErrors,
                      attempts: attempt,
                      buildLog: buildLog
                    }, { status: 400, headers: corsHeaders });
                  }
    
                  // Send errors to AI model for fixing
                  console.log(`[API] Sending ${currentErrors.length} errors to AI model for fixing...`);
                  buildLog.push(`Enviando ${currentErrors.length} errores al modelo de IA...`);
                  
                  const fixResult = await sendErrorsToModel(currentErrors, attempt, selectedModel, workingProjectRoot, projectId, userId);
    
                  if (!fixResult.success) {
                    console.warn('[API] AI fix failed, continuing with next attempt anyway');
                    buildLog.push(`⚠️ Corrección de IA falló: ${fixResult.error}`);
                  } else {
                    console.log('[API] AI corrections applied');
                    buildLog.push(`✅ Correcciones de IA aplicadas (${fixResult.corrections?.length || 0} cambios)`);
                  }
    
                  // Wait a moment before next attempt
                  await new Promise(resolve => setTimeout(resolve, 1000));
                }
              }
    
              // Max attempts reached
              console.log('[API] Max attempts reached, process failed');
              // Clean up
              await fs.remove(tempDir);
              return NextResponse.json({
                success: false,
                error: `Build falló después de ${maxAttempts} intentos de corrección automática.`,
                errors: lastErrors,
                attempts: maxAttempts
              }, { status: 400, headers: corsHeaders });
            } else if (buildStrategy === 'local') {
              console.log('[API] Iniciando construcción LOCAL y empaquetado de la salida...');
    
              // 1. Download the ZIP file from PocketBase
              console.log('[API] Descargando ZIP del proyecto desde PocketBase para construcción LOCAL...');
              const zipResponse = await fetch(`${process.env.NEXT_PUBLIC_POCKETBASE_URL}/api/files/projects/${projectId}/${projectRecord.project_archive}`);
              if (!zipResponse.ok) {
                throw new Error(`Failed to download ZIP: ${zipResponse.status}`);
              }
    
              const zipBuffer = await zipResponse.arrayBuffer();
              const zipPath = path.join(tempDir, 'project.zip');
              await fs.writeFile(zipPath, Buffer.from(zipBuffer));
              console.log('[API] ZIP del proyecto descargado.');
    
    
              // 3. Find the actual project directory
              console.log('[API] Buscando la raíz del proyecto...');
              const workingProjectRoot = await findProjectRoot(tempDir);
              console.log(`[API] Raíz del proyecto encontrada: ${workingProjectRoot}`);
    
              // 4. Check if it's a valid project with build script
              console.log('[API] Verificando package.json...');
              const packageJsonPath = path.join(workingProjectRoot, 'package.json');
              if (!fs.existsSync(packageJsonPath)) {
                throw new Error('No se encontró package.json en el proyecto');
              }
    
              const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
              if (!packageJson.scripts || !packageJson.scripts.build) {
                throw new Error('El proyecto no tiene script de build definido');
              }
    
              // 5. Execute npm install locally
              console.log('[API] Ejecutando: npm install en el directorio temporal LOCAL');
              try {
                await runNpmCommand(workingProjectRoot, 'npm install --no-optional --prefer-offline --legacy-peer-deps');
                console.log('[API] Dependencias instaladas exitosamente en local.');
              } catch (installError: any) {
                console.error(`[API] Fallo al instalar dependencias en local: ${installError.message}`);
                return NextResponse.json({
                    success: false,
                    error: `Fallo al instalar dependencias en local: ${installError.message}`,
                  }, { status: 400, headers: corsHeaders });
              }
    
              // 6. Execute npm run build locally
              console.log('[API] Ejecutando: npm run build en el directorio temporal LOCAL');
              try {
                const buildOutput = await runNpmCommand(workingProjectRoot, 'npm run build');
                console.log('[API] Build completado exitosamente en local. No se encontraron errores.');
    
                // 7. Identify build output directory (e.g., .next/, dist/)
                let buildOutputDir = '';
                if (packageJson.dependencies && (packageJson.dependencies.next || packageJson.devDependencies.next)) {
                  buildOutputDir = path.join(workingProjectRoot, '.next');
                  console.log(`[API] Proyecto Next.js detectado. Buscando salida de construcción en: ${buildOutputDir}`);
                } else if (packageJson.dependencies && (packageJson.dependencies.vite || packageJson.devDependencies.vite)) {
                  buildOutputDir = path.join(workingProjectRoot, 'dist');
                  console.log(`[API] Proyecto Vite detectado. Buscando salida de construcción en: ${buildOutputDir}`);
                } else {
                  // Default or ask user for confirmation if needed
                  buildOutputDir = path.join(workingProjectRoot, 'build'); // Common default
                  console.warn(`[API] No se pudo determinar el directorio de salida de construcción automáticamente. Asumiendo: ${buildOutputDir}`);
                }
    
                if (!fs.existsSync(buildOutputDir)) {
                  return NextResponse.json({
                    success: false,
                    error: `Directorio de salida de construcción no encontrado: ${buildOutputDir}`,
                  }, { status: 400, headers: corsHeaders });
                }
                console.log(`[API] Directorio de salida de construcción identificado: ${buildOutputDir}`);
    
                // 8. Zip only the identified build output
                console.log('[API] Comprimiendo la salida de la construcción...');
                const outputArchiveName = `project_${projectId}_build_${Date.now()}.zip`;
                const outputArchivePath = path.join(tempDir, outputArchiveName);
                const output = fs.createWriteStream(outputArchivePath);
                const archive = archiver('zip', {
                  zlib: { level: 9 } // Maximum compression
                });
    
                const outputClosed = new Promise<void>((resolve, reject) => {
                  output.on('close', () => {
                    console.log('[API] Archivo ZIP de salida de construcción creado.');
                    resolve();
                  });
                  output.on('error', (err: Error) => {
                    console.error('[API] Error creando archivo ZIP:', err);
                    reject(err);
                  });
                });
    
                archive.on('warning', function(err: archiver.ArchiverError) {
                  if (err.code === 'ENOENT') {
                    console.warn('[API] Advertencia al archivar (ENOENT):', err);
                  } else {
                    console.error('[API] Advertencia al archivar:', err);
                  }
                });
    
                archive.on('error', function(err: archiver.ArchiverError) {
                  console.error('[API] Error al archivar:', err);
                  return NextResponse.json({
                    success: false,
                    error: `Error al archivar la salida de construcción: ${err.message}`,
                  }, { status: 500, headers: corsHeaders });
                });
    
                archive.pipe(output);
                archive.directory(buildOutputDir, false); // Append the build output directory
                await archive.finalize();
                await outputClosed;
                console.log(`[API] Salida de construcción empaquetada en: ${outputArchivePath}`);
    
                // 9. Upload the zipped build output to PocketBase
                console.log('[API] Subiendo el ZIP de la salida de construcción a PocketBase...');
                const updatedArchiveBuffer = await fs.readFile(outputArchivePath);
                const updatedArchiveBlob = new Blob([new Uint8Array(updatedArchiveBuffer)], { type: 'application/zip' });
    
                const updatedFormData = new FormData();
                updatedFormData.append('project_archive', updatedArchiveBlob, outputArchiveName);
    
                // Authentication logic (same as remote build)
                let pbUpdated = false;
                const userToken = (await pb).authStore.token;
                if (userToken) {
                  try {
                    (await pb).authStore.save(userToken, null as any); // Temporarily use user token
                    await (await pb).collection('projects').update(projectId, updatedFormData);
                    console.log('[API] Salida de construcción subida con token de usuario.');
                    pbUpdated = true;
                  } catch (userErr: any) {
                    console.warn('[API] Actualización con token de usuario falló:', userErr?.message || userErr);
                    (await pb).authStore.clear();
                  }
                }
    
                if (!pbUpdated) {
                  const adminEmail = process.env.POCKETBASE_EMAIL || process.env.NEXT_PUBLIC_POCKETBASE_EMAIL;
                  const adminPass = process.env.POCKETBASE_PASSWORD || process.env.NEXT_PUBLIC_POCKETBASE_PASSWORD;
                  if (adminEmail && adminPass) {
                    console.log('[API] Autenticando con credenciales de administrador para la subida de la salida...');
                    try {
                      await (await pb).admins.authWithPassword(adminEmail, adminPass);
                      await (await pb).collection('projects').update(projectId, updatedFormData);
                      console.log('[API] Salida de construcción subida con credenciales de administrador.');
                      pbUpdated = true;
                    } catch (adminErr: any) {
                      console.error(`[API] Autenticación de administrador falló: ${adminErr?.message || adminErr}. Fallo al subir la salida de construcción.`);
                    }
                  }
                }
    
                if (pbUpdated) {
                  return NextResponse.json({
                    success: true,
                    message: 'Construcción local completada y salida subida a PocketBase.',
                    zipUpdated: true,
                  }, { headers: corsHeaders });
                } else {
                  return NextResponse.json({
                    success: false,
                    error: 'Fallo al subir la salida de construcción a PocketBase.',
                  }, { status: 500, headers: corsHeaders });
                }
    
              } catch (buildError: any) {
                console.error(`[API] Build falló en local: ${buildError.message}`);
                return NextResponse.json({
                  success: false,
                  error: `Build falló en local: ${buildError.message}`,
                }, { status: 500, headers: corsHeaders });
              }
            } else {
              return NextResponse.json({
                success: false,
                error: `Estrategia de construcción desconocida: ${buildStrategy}`,
              }, { status: 400, headers: corsHeaders });
            }
    } catch (error) {
      // Clean up on error
      if (tempDir) { // Check if tempDir was initialized
        await fs.remove(tempDir);
      }
      throw error;
    }

  } catch (error: any) {
    console.error('[API] Error in auto-build-fix endpoint:', error);

    // Check for specific ZIP corruption error
    if (error?.message && error.message.includes('end of central directory record signature not found')) {
      return NextResponse.json({
        success: false,
        error: 'El archivo ZIP del proyecto parece estar corrupto o incompleto. Por favor, intenta subir la carpeta del proyecto de nuevo para asegurar que el archivo se genere correctamente.',
        details: error.message
      }, { status: 400, headers: corsHeaders });
    }

    // Generic internal error for all other cases
    return NextResponse.json({
      success: false,
      error: 'Error interno durante el proceso de build automático',
      details: error?.message || String(error)
    }, { status: 500, headers: corsHeaders });
  }
}