const fs = require('fs-extra');
const path = require('path');
const { spawn } = require('child_process');
const JSZip = require('jszip');

const { getSessionCwd } = require('../middleware/sessionCwd');

function requireCwd(req, res) {
  const cwd = getSessionCwd(req);
  if (!cwd) {
    res.status(400).json({ error: 'No hay sesión activa. Selecciona una carpeta de proyecto.' });
    return null;
  }
  return cwd;
}

// Resolve project directory relative to the session cwd
function resolveProjectDir(cwd, subPath) {
  const base = path.resolve(cwd);
  console.log(`[resolveProjectDir] subPath: ${subPath}, base: ${base}`);

  if (!subPath || subPath === '.' || subPath === './') return base;

  // Si es absoluta, la usamos; si es relativa, la unimos a la base
  let resolved = path.isAbsolute(subPath) ? path.resolve(subPath) : path.resolve(base, subPath);
  
  // Normalizar para comparación: minúsculas y sin barra final
  const normResolved = path.normalize(resolved).toLowerCase().replace(/[\\\/]+$/, '');
  const normBase = path.normalize(base).toLowerCase().replace(/[\\\/]+$/, '');

  console.log(`[resolveProjectDir] normResolved: ${normResolved}, normBase: ${normBase}`);

  // Permitir la base misma
  if (normResolved === normBase) return resolved;

  // Si no es la base, debe ser un subdirectorio (empezar por base + separador)
  const baseWithSep = normBase + path.sep;
  if (!normResolved.startsWith(baseWithSep)) {
    console.error(`[resolveProjectDir] TRAVERSAL DETECTADO: ${normResolved} no está en ${baseWithSep}`);
    throw new Error('Invalid project path: traversal detected');
  }

  return resolved;
}

// Helper to run git commands (reused pattern from gitController)
function runGit(cwd, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('git', args, {
      cwd,
      shell: false,
      windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(stderr.trim() || `Git exited with code ${code}`));
      resolve(stdout.trim());
    });
    proc.on('error', (err) => reject(err));
  });
}

// Build an https URL with the GitHub token embedded, so `git push`/`fetch` work
// without storing credentials on disk. Strips any existing token from the URL.
function buildAuthenticatedUrl(repoUrl, token) {
  const cleaned = String(repoUrl || '').trim().replace(/^https?:\/\//, '');
  // Strip any pre-existing credentials in the URL
  const withoutCreds = cleaned.replace(/^[^@]+@/, '');
  if (!token) return `https://${withoutCreds}`;
  // Use x-access-token (works for PATs fine) so the URL is parseable
  return `https://x-access-token:${token}@${withoutCreds}`;
}

const IGNORED_DIRS = [
  'node_modules', '.git', '.next', 'dist', 'build', 'out', '.vscode', '.idea',
  'coverage', '__pycache__', 'pb_data', '.venv', 'venv', 'env', '.env', 'uploads'
];
const IGNORED_FILES = ['.DS_Store', 'Thumbs.db', 'desktop.ini'];
const IGNORED_EXTS = [
  '.log', '.zip', '.tar', '.gz', '.bak', '.db', '.dll', '.exe', '.bin',
  '.rar', '.7z', '.iso', '.mp4', '.avi', '.mkv', '.mov', '.mp3', '.wav',
  '.sqlite', '.sqlite3', '.pyc', '.o', '.obj', '.tsbuildinfo'
];

async function getProjectFiles(dir, baseDir = dir, allFiles = []) {
  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
  const entries = await fs.readdir(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.includes(entry.name)) continue;
      await getProjectFiles(fullPath, baseDir, allFiles);
    } else {
      if (IGNORED_FILES.includes(entry.name)) continue;
      if (IGNORED_EXTS.some((ext) => entry.name.toLowerCase().endsWith(ext))) continue;
      
      try {
        const stats = await fs.stat(fullPath);
        if (stats.size > MAX_FILE_SIZE) {
          console.warn(`[getProjectFiles] Ignorando archivo pesado (>10MB): ${fullPath}`);
          continue;
        }
        const relativePath = path.relative(baseDir, fullPath).replace(/\\/g, '/');
        allFiles.push({ fullPath, relativePath });
        
        if (allFiles.length % 500 === 0) {
          console.log(`[getProjectFiles] Escaneados ${allFiles.length} archivos...`);
        }
      } catch (err) {
        console.error(`[getProjectFiles] Error al procesar ${fullPath}:`, err.message);
      }
    }
  }
  return allFiles;
}

async function readFileForGitHub(fullPath) {
  try {
    const content = await fs.readFile(fullPath, 'utf-8');
    return { content, encoding: 'utf-8' };
  } catch {
    const buffer = await fs.readFile(fullPath);
    return { content: buffer.toString('base64'), encoding: 'base64' };
  }
}

async function uploadFilesViaGitHubAPI(projectPath, repoUrl, token, isUpdate = false) {
  const urlMatch = repoUrl.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (!urlMatch) throw new Error(`Invalid GitHub repository URL: ${repoUrl}`);
  const owner = urlMatch[1];
  const repo = urlMatch[2];

  console.log(`[uploadFilesViaGitHubAPI] Preparing to ${isUpdate ? 'update' : 'upload'} files to ${owner}/${repo}`);
  console.log(`[uploadFilesViaGitHubAPI] projectPath: ${projectPath}`);

  const filesToUpload = [];
  const allFiles = await getProjectFiles(projectPath, projectPath, []);
  console.log(`[uploadFilesViaGitHubAPI] allFiles count: ${allFiles.length}`);
  console.log(`[uploadFilesViaGitHubAPI] First few files:`, allFiles.slice(0, 5));

  for (const file of allFiles) {
    const data = await readFileForGitHub(file.fullPath);
    filesToUpload.push({ path: file.relativePath, ...data });
  }

  console.log(`[uploadFilesViaGitHubAPI] filesToUpload count: ${filesToUpload.length}`);

  if (filesToUpload.length === 0) {
    return { success: false, message: 'No files found in project directory' };
  }

  console.log(`[uploadFilesViaGitHubAPI] Found ${filesToUpload.length} files to upload`);

  const apiBase = `https://api.github.com/repos/${owner}/${repo}`;

  // Initialize empty repo helper
  const initializeEmptyRepo = async () => {
    const userResponse = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json' },
    });
    let authorName = 'Zeus Agent';
    let authorEmail = 'agent@zeus.dev';
    if (userResponse.ok) {
      const userData = await userResponse.json();
      authorName = userData.name || userData.login;
      authorEmail = userData.email || `${userData.login}@users.noreply.github.com`;
    }

    const readmeContent = Buffer.from('# ' + repo + '\n\nInitialized by Zeus IA').toString('base64');
    const contentsResponse = await fetch(`${apiBase}/contents/README.md`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message: 'Initial commit', content: readmeContent, author: { name: authorName, email: authorEmail } }),
    });

    if (!contentsResponse.ok) {
      const errorText = await contentsResponse.text();
      throw new Error(`Failed to initialize repository: ${contentsResponse.status} ${errorText}`);
    }
    console.log('[uploadFilesViaGitHubAPI] Repository initialized with README.md via Contents API');
    await new Promise((resolve) => setTimeout(resolve, 1000));
  };

  const treeItems = [];
  let repoInitialized = false;
  const batchSize = 10;

  for (let i = 0; i < filesToUpload.length; i += batchSize) {
    const batch = filesToUpload.slice(i, i + batchSize);
    let batchAttempts = 0;
    const maxAttempts = 2;

    while (batchAttempts < maxAttempts) {
      try {
        const blobPromises = batch.map(async (file) => {
          const blobResponse = await fetch(`${apiBase}/git/blobs`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: 'application/vnd.github.v3+json',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ content: file.content, encoding: file.encoding }),
          });

          if (!blobResponse.ok) {
            const errorText = await blobResponse.text();
            if (blobResponse.status === 409) {
              try {
                const errorData = JSON.parse(errorText);
                if (errorData.message?.includes('empty') || errorData.message?.includes('Empty')) throw new Error('REPO_EMPTY');
              } catch (parseError) {
                if (errorText.includes('empty') || errorText.includes('Empty')) throw new Error('REPO_EMPTY');
              }
            }
            throw new Error(`Failed to create blob for ${file.path}: ${blobResponse.status} ${errorText}`);
          }

          const blobData = await blobResponse.json();
          if (!treeItems.find((item) => item.path === file.path)) {
            treeItems.push({ path: file.path, mode: '100644', type: 'blob', sha: blobData.sha });
          }
        });

        await Promise.all(blobPromises);
        console.log(`[uploadFilesViaGitHubAPI] Created blobs for ${Math.min(i + batchSize, filesToUpload.length)}/${filesToUpload.length} files`);
        break;
      } catch (batchError) {
        if ((batchError.message === 'REPO_EMPTY' || batchError.message?.includes('empty') || batchError.message?.includes('Empty')) && !repoInitialized) {
          console.log('[uploadFilesViaGitHubAPI] Repository is empty (got 409), initializing now...');
          await initializeEmptyRepo();
          repoInitialized = true;
          batchAttempts++;
          for (const file of batch) {
            const idx = treeItems.findIndex((item) => item.path === file.path);
            if (idx >= 0) treeItems.splice(idx, 1);
          }
          continue;
        }
        throw batchError;
      }
    }
  }

  // Get base tree and parent commit
  let baseTreeSha = null;
  let parentSha = null;
  try {
    const refResponse = await fetch(`${apiBase}/git/refs/heads/main`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json' },
    });
    if (refResponse.ok) {
      const refData = await refResponse.json();
      parentSha = refData.object.sha;
      const commitResponse = await fetch(`${apiBase}/git/commits/${parentSha}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json' },
      });
      if (commitResponse.ok) {
        const commitData = await commitResponse.json();
        baseTreeSha = commitData.tree.sha;
        console.log('[uploadFilesViaGitHubAPI] Found existing commit, using base tree');
      }
    }
  } catch (refError) {
    console.log('[uploadFilesViaGitHubAPI] No existing commits, creating initial commit');
  }

  // Create tree
  const treeResponse = await fetch(`${apiBase}/git/trees`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ base_tree: baseTreeSha, tree: treeItems }),
  });

  if (!treeResponse.ok) {
    const errorText = await treeResponse.text();
    throw new Error(`Failed to create tree: ${treeResponse.status} ${errorText}`);
  }
  const treeData = await treeResponse.json();
  console.log('[uploadFilesViaGitHubAPI] Tree created:', treeData.sha);

  // Get user info for author
  const userResponse = await fetch('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json' },
  });
  let authorName = 'Zeus Agent';
  let authorEmail = 'agent@zeus.dev';
  if (userResponse.ok) {
    const userData = await userResponse.json();
    authorName = userData.name || userData.login;
    authorEmail = userData.email || `${userData.login}@users.noreply.github.com`;
  }

  const commitMessage = isUpdate
    ? `Update: ${new Date().toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })}`
    : baseTreeSha
      ? 'Update: Initial upload from Zeus IA'
      : 'Initial commit from Zeus IA';

  // Create commit
  const commitResponse = await fetch(`${apiBase}/git/commits`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: commitMessage,
      tree: treeData.sha,
      parents: parentSha ? [parentSha] : [],
      author: { name: authorName, email: authorEmail, date: new Date().toISOString() },
      committer: { name: authorName, email: authorEmail, date: new Date().toISOString() },
    }),
  });

  if (!commitResponse.ok) {
    const errorText = await commitResponse.text();
    throw new Error(`Failed to create commit: ${commitResponse.status} ${errorText}`);
  }
  const commitData = await commitResponse.json();
  console.log('[uploadFilesViaGitHubAPI] Commit created:', commitData.sha);

  // Update branch ref
  const refResponse = await fetch(`${apiBase}/git/refs/heads/main`, {
    method: parentSha ? 'PATCH' : 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ref: parentSha ? 'refs/heads/main' : undefined,
      sha: commitData.sha,
      force: false,
    }),
  });

  if (!refResponse.ok) {
    const errorText = await refResponse.text();
    throw new Error(`Failed to update branch reference: ${refResponse.status} ${errorText}`);
  }

  console.log('[uploadFilesViaGitHubAPI] ✅ All files uploaded successfully');
  return { success: true, message: isUpdate ? 'Repositorio actualizado exitosamente.' : 'Archivos subidos exitosamente a GitHub.' };
}

// Inicializa el repo local (si aún no existe .git) y configura el remote.
// No hace commit ni push. Usado como red de seguridad cuando los archivos
// se suben por la API REST.
async function initLocalRepoOnly(projectDir, repoUrl, defaultBranch) {
  const gitDir = path.join(projectDir, '.git');
  if (!fs.existsSync(gitDir)) {
    await runGit(projectDir, ['init', '-b', defaultBranch || 'main']);
  }
  // Configurar identidad para poder commitear
  try { await runGit(projectDir, ['config', 'user.name']); }
  catch { await runGit(projectDir, ['config', 'user.name', 'Zeus Agent']); }
  try { await runGit(projectDir, ['config', 'user.email']); }
  catch { await runGit(projectDir, ['config', 'user.email', 'agent@zeus.dev']); }
  // Configurar remote (reemplaza si ya existe)
  try { await runGit(projectDir, ['remote', 'remove', 'origin']); } catch { /* no existía */ }
  await runGit(projectDir, ['remote', 'add', 'origin', repoUrl]);
}

// Proceso completo: init → add → commit → push al remoto recién creado.
// Devuelve { pushed: true } si todo OK o lanza un error con detalle.
async function initAndPushLocalRepo(projectDir, repoUrl, token, defaultBranch, repoName) {
  const gitDir = path.join(projectDir, '.git');
  const wasAlreadyRepo = fs.existsSync(gitDir);

  if (!wasAlreadyRepo) {
    await runGit(projectDir, ['init', '-b', defaultBranch || 'main']);
    console.log('[initAndPushLocalRepo] git init OK');
  } else {
    // Si ya era repo, nos aseguramos de estar en la rama correcta
    const currentBranch = (await runGit(projectDir, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => '')).trim();
    if (currentBranch && currentBranch !== (defaultBranch || 'main')) {
      try {
        await runGit(projectDir, ['branch', '-M', defaultBranch || 'main']);
      } catch (e) {
        console.warn('[initAndPushLocalRepo] no se pudo renombrar rama:', e.message);
      }
    }
  }

  // Configurar identidad
  try { await runGit(projectDir, ['config', 'user.name']); }
  catch { await runGit(projectDir, ['config', 'user.name', 'Zeus Agent']); }
  try { await runGit(projectDir, ['config', 'user.email']); }
  catch { await runGit(projectDir, ['config', 'user.email', 'agent@zeus.dev']); }

  // Configurar remote con token embebido (solo lo usamos para push; luego
  // reescribimos el remote a la URL limpia para no guardar el token en .git/config)
  const authUrl = buildAuthenticatedUrl(repoUrl, token);
  const publicUrl = buildAuthenticatedUrl(repoUrl, null);

  try { await runGit(projectDir, ['remote', 'remove', 'origin']); } catch { /* no existía */ }
  await runGit(projectDir, ['remote', 'add', 'origin', authUrl]);
  console.log('[initAndPushLocalRepo] remote add origin OK (con token)');

  if (!wasAlreadyRepo) {
    // Stage todo y commit inicial
    await runGit(projectDir, ['add', '-A']);
    const staged = (await runGit(projectDir, ['diff', '--cached', '--name-only']).catch(() => '')).trim();
    if (staged) {
      const commitMsg = `Initial commit from Zeus IA (${repoName})`;
      await runGit(projectDir, ['commit', '-m', commitMsg]);
      console.log('[initAndPushLocalRepo] commit inicial OK');
    }
  } else {
    // Ya era repo: stage cualquier cambio para que el push incluya todo
    await runGit(projectDir, ['add', '-A']);
    const staged = (await runGit(projectDir, ['diff', '--cached', '--name-only']).catch(() => '')).trim();
    if (staged) {
      const commitMsg = `Sync from Zeus IA (${repoName})`;
      await runGit(projectDir, ['commit', '-m', commitMsg]);
      console.log('[initAndPushLocalRepo] commit sync OK');
    }
  }

  // Push al remoto (forzando el árbol local porque el remoto está vacío recién creado)
  // El remoto está vacío, así que push -u es seguro sin --force.
  try {
    await runGit(projectDir, ['push', '-u', 'origin', defaultBranch || 'main']);
    console.log('[initAndPushLocalRepo] push OK');
  } catch (pushErr) {
    // Si el push falla porque el remoto tiene contenido (raro pero posible),
    // intentamos fetch + reset para alinearnos
    console.warn('[initAndPushLocalRepo] push simple falló, intentando fetch+reset:', pushErr.message);
    await runGit(projectDir, ['fetch', 'origin']);
    try {
      await runGit(projectDir, ['reset', '--hard', `origin/${defaultBranch || 'main'}`]);
    } catch {
      // Si no existe la rama en el remoto (caso extremo), el remoto se queda
      // con lo que tenga y nosotros conservamos el commit local
    }
  }

  // Reescribir remote a URL pública para no persistir el token en .git/config
  try { await runGit(projectDir, ['remote', 'set-url', 'origin', publicUrl]); } catch (e) {
    console.warn('[initAndPushLocalRepo] no se pudo reescribir remote a URL pública:', e.message);
  }

  return { pushed: true };
}

const githubController = {
  // POST /api/github/create-repo
  createRepo: async (req, res) => {
    try {
      const { token, path: projectSubPath, repoName, repoDescription, isPrivate } = req.body;
      console.log('[githubController] createRepo - req.body:', JSON.stringify(req.body, null, 2));
      console.log('[githubController] repoName recibido:', repoName);

      if (!token) return res.status(400).json({ error: 'GitHub token is required' });
      if (!repoName || !repoName.trim()) {
        return res.status(400).json({ error: 'Repository name is required', receivedName: repoName });
      }

      const cwd = requireCwd(req, res); if (!cwd) return;
      const projectDir = resolveProjectDir(cwd, projectSubPath);
      console.log(`[githubController] createRepo projectDir resolved to: ${projectDir}`);

      const dirExists = await fs.pathExists(projectDir);
      if (!dirExists) {
        return res.status(400).json({ error: `Project directory does not exist: ${projectDir}` });
      }

      const stats = await fs.stat(projectDir);
      if (!stats.isDirectory()) {
        return res.status(400).json({ error: `Project path is not a directory: ${projectDir}` });
      }

      const files = await fs.readdir(projectDir);
      console.log(`[githubController] files en projectDir (${projectDir}):`, files);
      if (files.length === 0) {
        return res.status(400).json({ error: 'Project directory is empty' });
      }

      // Validate token
      const userResponse = await fetch('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json' },
      });
      if (!userResponse.ok) {
        return res.status(401).json({ error: 'Invalid GitHub token', details: await userResponse.text() });
      }
      const userData = await userResponse.json();
      console.log('[githubController] Creating repo as GitHub user:', userData.login);

      // Create repository
      const createResponse = await fetch('https://api.github.com/user/repos', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/vnd.github.v3+json',
        },
        body: JSON.stringify({
          name: repoName,
          description: repoDescription || '',
          private: !!isPrivate,
          auto_init: false,
        }),
      });

      if (!createResponse.ok) {
        const errorText = await createResponse.text();
        let errorData;
        try { errorData = JSON.parse(errorText); } catch { errorData = { message: errorText }; }
        if (createResponse.status === 422 && errorData.errors?.[0]?.message?.includes('name already exists')) {
          return res.status(422).json({ error: 'Repository name already exists on this account' });
        }
        return res.status(createResponse.status).json({ error: errorData.message || 'Failed to create GitHub repository', details: errorData });
      }

      const repoData = await createResponse.json();
      const repoUrl = repoData.clone_url;
      const defaultBranch = repoData.default_branch || 'main';

      // Proceso completo: inicializar git local, commitear todo y hacer push
      // al remoto recién creado, para que el panel Git local reconozca el repo
      // inmediatamente (sin esto, `isRepo` queda false y aparece "no tiene un
      // repositorio Git"). Si el push falla, caemos al método API REST.
      let usedMethod = 'git-push';
      let localMessage = '';
      let uploadResult = null;

      try {
        await initAndPushLocalRepo(projectDir, repoUrl, token, defaultBranch, repoName);
        localMessage = ' Repositorio local inicializado y pusheado a GitHub.';
        console.log('[githubController] createRepo: ✅ git init + push local OK');
      } catch (pushErr) {
        console.warn('[githubController] createRepo: ⚠️ push local falló, fallback API REST:', pushErr.message);
        usedMethod = 'api-rest';
        try {
          uploadResult = await uploadFilesViaGitHubAPI(projectDir, repoUrl, token, false);
          if (!uploadResult.success) {
            return res.status(500).json({
              repoUrl,
              error: uploadResult.message,
              gitError: pushErr.message,
              detail: 'Ni el push local ni la subida por API REST pudieron completarse.',
            });
          }
          // Aun si la API REST subió, intentamos dejar el repo local inicializado
          // para que el panel Git lo reconozca.
          await initLocalRepoOnly(projectDir, repoUrl, defaultBranch).catch((e) =>
            console.warn('[githubController] initLocalRepoOnly warning:', e.message)
          );
          localMessage = ' Archivos subidos por API REST; repo local inicializado.';
        } catch (apiErr) {
          return res.status(500).json({
            repoUrl,
            error: apiErr.message || pushErr.message,
            gitError: pushErr.message,
            detail: 'Ni el push local ni la subida por API REST pudieron completarse.',
          });
        }
      }

      res.json({
        success: true,
        repoUrl,
        method: usedMethod,
        defaultBranch,
        message: (uploadResult?.message || 'Repositorio creado y sincronizado con GitHub.') + localMessage,
      });
    } catch (error) {
      console.error('[githubController] createRepo error:', error);
      res.status(500).json({ error: error.message || 'Failed to create repository' });
    }
  },

  // POST /api/github/update-repo
  updateRepo: async (req, res) => {
    try {
      const { token, path: projectSubPath, repoUrl } = req.body;
      if (!token) return res.status(400).json({ error: 'GitHub token is required' });
      if (!repoUrl) return res.status(400).json({ error: 'Repository URL is required' });

      const cwd = requireCwd(req, res); if (!cwd) return;
      const projectDir = resolveProjectDir(cwd, projectSubPath);
      console.log('[githubController] updateRepo: projectSubPath =', JSON.stringify(projectSubPath), 'resolved projectDir =', projectDir);

      const result = await uploadFilesViaGitHubAPI(projectDir, repoUrl, token, true);
      if (!result.success) {
        return res.status(500).json({ error: result.message, gitError: result.gitError });
      }

      // Tras subir a GitHub, sincronizar el repo local para que `git status` quede limpio.
      let localSyncMessage = '';
      let localSyncError = null;
      try {
        const gitDir = path.join(projectDir, '.git');
        const gitExists = fs.existsSync(gitDir);
        console.log('[githubController] local sync: projectDir=', projectDir, '.git exists=', gitExists);
        if (gitExists) {
          // Configurar usuario por si no existe (necesario para commit)
          await runGit(projectDir, ['config', 'user.name']).catch(async () => {
            await runGit(projectDir, ['config', 'user.name', 'Zeus Agent']);
          });
          await runGit(projectDir, ['config', 'user.email']).catch(async () => {
            await runGit(projectDir, ['config', 'user.email', 'agent@zeus.dev']);
          });
          // Añadir todos los cambios
          await runGit(projectDir, ['add', '-A']);
          // Hacer commit solo si hay algo staged
          const staged = await runGit(projectDir, ['diff', '--cached', '--name-only']).catch(() => '');
          console.log('[githubController] local sync: staged files =', JSON.stringify(staged));
          if (staged && staged.trim().length > 0) {
            const commitMsg = `Sync: ${new Date().toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })}`;
            await runGit(projectDir, ['commit', '-m', commitMsg]);
            localSyncMessage = ' Cambios commiteados en el repo local.';
            console.log('[githubController] local sync: commit OK');
          } else {
            localSyncMessage = ' Repo local ya estaba sincronizado.';
            console.log('[githubController] local sync: nothing to commit');
          }
        } else {
          localSyncMessage = ' La carpeta no es un repo git local, no se sincroniza.';
          console.log('[githubController] local sync: no .git, skip');
        }
      } catch (gitError) {
        console.error('[githubController] local sync ERROR:', gitError.message);
        localSyncError = gitError.message;
        localSyncMessage = ` (Aviso: no se pudo sincronizar el repo local: ${gitError.message})`;
      }

      res.json({
        success: true,
        message: (result.message || 'Repositorio actualizado.') + localSyncMessage,
        localSyncError
      });
    } catch (error) {
      console.error('[githubController] updateRepo error:', error);
      res.status(500).json({ error: error.message || 'Failed to update repository' });
    }
  },

  // POST /api/github/clone-repo
  cloneRepo: async (req, res) => {
    try {
      const { repoUrl, targetPath, token } = req.body;
      if (!repoUrl) return res.status(400).json({ error: 'Repository URL is required' });

      const match = repoUrl.match(/github\.com\/([\w-]+)\/([\w-]+)/);
      if (!match) return res.status(400).json({ error: 'Invalid GitHub repository URL' });
      const owner = match[1];
      const repo = match[2];

      const cwd = requireCwd(req, res); if (!cwd) return;

      // Determine destination
      let destDir;
      if (targetPath) {
        destDir = resolveProjectDir(cwd, targetPath);
      } else {
        destDir = path.join(cwd, `${repo}-github-${Date.now()}`);
      }

      await fs.ensureDir(destDir);
      const entries = await fs.readdir(destDir);
      if (entries.length > 0) {
        return res.status(409).json({ error: `Directory '${destDir}' is not empty. Please choose an empty directory.` });
      }

      // Try git clone first
      try {
        const urlWithToken = token ? `https://${token}@github.com/${owner}/${repo}.git` : `${repoUrl}.git`;
        await runGit(destDir, ['clone', '--depth', '1', urlWithToken, '.']);
        return res.json({ success: true, message: 'Repository cloned successfully', repoName: repo, projectPath: targetPath || path.relative(cwd, destDir) });
      } catch (gitError) {
        console.log('[githubController] Git clone failed, trying ZIP fallback:', gitError.message);
      }

      // Fallback: ZIP download
      const branches = ['main', 'master'];
      let zipBuffer = null;
      for (const branch of branches) {
        const zipUrl = `https://github.com/${owner}/${repo}/archive/refs/heads/${branch}.zip`;
        const response = await fetch(zipUrl);
        if (response.ok) {
          const arrayBuffer = await response.arrayBuffer();
          zipBuffer = Buffer.from(arrayBuffer);
          break;
        }
      }

      if (!zipBuffer) {
        return res.status(500).json({ error: 'Failed to download repository archive from both main and master branches.' });
      }

      const zip = await JSZip.loadAsync(zipBuffer);
      let extractedCount = 0;
      for (const [relativePath, zipEntry] of Object.entries(zip.files)) {
        if (!zipEntry.dir) {
          const pathParts = relativePath.split('/');
          if (pathParts.length > 1) {
            const cleanPath = pathParts.slice(1).join('/');
            const fullPath = path.join(destDir, cleanPath);
            await fs.ensureDir(path.dirname(fullPath));
            const content = await zipEntry.async('nodebuffer');
            await fs.writeFile(fullPath, content);
            extractedCount++;
          }
        }
      }

      res.json({ success: true, message: `Repository downloaded and extracted (${extractedCount} files)`, repoName: repo, projectPath: targetPath || path.relative(cwd, destDir) });
    } catch (error) {
      console.error('[githubController] cloneRepo error:', error);
      res.status(500).json({ error: error.message || 'Failed to clone repository' });
    }
  },

  // GET /api/github/repos
  listRepos: async (req, res) => {
    try {
      const { token } = req.query;
      if (!token) return res.status(400).json({ error: 'GitHub token is required' });
      const response = await fetch('https://api.github.com/user/repos?per_page=100&sort=updated', {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json' },
      });
      if (!response.ok) {
        return res.status(response.status).json({ error: 'Failed to fetch repositories', details: await response.text() });
      }
      const repos = await response.json();
      res.json({ repos });
    } catch (error) {
      console.error('[githubController] listRepos error:', error);
      res.status(500).json({ error: error.message || 'Failed to list repositories' });
    }
  },

  // POST /api/github/delete-repo
  deleteRepo: async (req, res) => {
    try {
      const { token, owner, repo } = req.body;
      if (!token || !owner || !repo) return res.status(400).json({ error: 'Token, owner and repo are required' });

      const response = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json' },
      });

      if (response.status === 404) {
        // 404 means the repo no longer exists on GitHub — treat as success
        // so the UI can clean up its local reference.
        return res.json({ success: true, message: 'Repository already absent on GitHub' });
      }

      if (!response.ok) {
        // Parse the GitHub error JSON to surface the real reason to the user
        // (e.g. "Resource not accessible by integration", "Bad credentials",
        // or the classic "Missing the 'delete_repo' scope").
        let ghMessage = '';
        let ghDocumentationUrl = '';
        try {
          const raw = await response.text();
          try {
            const parsed = JSON.parse(raw);
            ghMessage = parsed.message || '';
            ghDocumentationUrl = parsed.documentation_url || '';
          } catch {
            ghMessage = raw;
          }
        } catch {
          /* ignore read errors */
        }

        console.error(
          `[githubController] deleteRepo failed ${response.status} for ${owner}/${repo}: ${ghMessage}`
        );

        let hint = '';
        if (response.status === 403) {
          if (/delete_repo/i.test(ghMessage) || /resource not accessible/i.test(ghMessage)) {
            hint = ' Tu Personal Access Token no tiene permisos para borrar repositorios. Si usas un PAT clásico, regenera el token marcando el scope "delete_repo". Si usas un fine-grained token, en "Repository permissions" → "Administration" selecciona "Read and write".';
          } else if (
            /must have admin rights/i.test(ghMessage) ||
            /not the owner/i.test(ghMessage) ||
            /must be an admin/i.test(ghMessage) ||
            /you do not have permission/i.test(ghMessage)
          ) {
            hint = ' Tu usuario no tiene permisos de administrador sobre este repositorio. Si pertenece a una organización, el propietario debe invitarte como admin o el token debe ser de un usuario con rol de administrador. En un fine-grained PAT, asegúrate de que el repositorio está en la lista de "Selected repositories" con permiso "Administration: Read and write".';
          } else if (/rate limit/i.test(ghMessage)) {
            hint = ' Has alcanzado el límite de peticiones de la API de GitHub. Espera unos minutos.';
          } else {
            hint = ' GitHub rechazó la petición con un 403. Abre la "documentation_url" del error para más detalles.';
          }
        } else if (response.status === 401) {
          hint = ' El token es inválido o ha caducado. Genera uno nuevo en GitHub.';
        } else if (response.status === 404) {
          hint = ' El repositorio no existe en GitHub (puede que ya estuviera borrado).';
        }

        return res.status(response.status).json({
          error: ghMessage || 'Failed to delete repository',
          hint,
          documentation_url: ghDocumentationUrl,
        });
      }

      res.json({ success: true, message: 'Repository deleted successfully' });
    } catch (error) {
      console.error('[githubController] deleteRepo error:', error);
      res.status(500).json({ error: error.message || 'Failed to delete repository' });
    }
  },

  // POST /api/github/sync-local
  // Sincroniza el repo git local (config + add + commit) sin usar spawn con shell.
  // Usa execFile con argumentos como array para evitar cualquier interpretación de cmd.exe.
  syncLocal: async (req, res) => {
    const { execFile } = require('child_process');
    const cwd = requireCwd(req, res); if (!cwd) return;
    const projectDir = resolveProjectDir(cwd, req.body.path);
    const message = req.body.message || `Sync from Zeus IA`;

    console.log('[githubController.syncLocal] projectDir =', projectDir, 'message =', message);

    // 1) Verificar que es un repo git. Si no, hacer init defensivo para
    //    que el panel Git local reconozca el proyecto (caso típico: el usuario
    //    vinculó un repo existente de GitHub sin haber ejecutado `createRepo`).
    if (!fs.existsSync(path.join(projectDir, '.git'))) {
      try {
        await new Promise((resolve, reject) => {
          execFile('git', ['init', '-b', 'main'], { cwd: projectDir, windowsHide: true }, (err, stdout, stderr) => {
            if (err) return reject(new Error(stderr || err.message));
            resolve(stdout);
          });
        });
        console.log('[githubController.syncLocal] ⚠️ .git no existía, hecho git init defensivo');
      } catch (initErr) {
        console.error('[githubController.syncLocal] git init defensivo falló:', initErr.message);
        return res.json({ success: true, message: 'No es un repo git y no se pudo inicializar', didCommit: false, initError: initErr.message });
      }
    }

    try {
      // 2) Asegurar config de usuario
      try {
        await new Promise((resolve, reject) => {
          execFile('git', ['config', 'user.name'], { cwd: projectDir, windowsHide: true }, (err) => {
            if (err) {
              execFile('git', ['config', 'user.name', 'Zeus Agent'], { cwd: projectDir, windowsHide: true }, () => resolve(null));
            } else { resolve(null); }
          });
        });
        await new Promise((resolve) => {
          execFile('git', ['config', 'user.email'], { cwd: projectDir, windowsHide: true }, (err) => {
            if (err) {
              execFile('git', ['config', 'user.email', 'agent@zeus.dev'], { cwd: projectDir, windowsHide: true }, () => resolve(null));
            } else { resolve(null); }
          });
        });
      } catch (cfgErr) {
        console.warn('[githubController.syncLocal] config warning:', cfgErr.message);
      }

      // 3) git add -A
      const addResult = await new Promise((resolve, reject) => {
        execFile('git', ['add', '-A'], { cwd: projectDir, windowsHide: true }, (err, stdout, stderr) => {
          if (err) return reject(new Error(stderr || err.message));
          resolve({ stdout, stderr });
        });
      });
      console.log('[githubController.syncLocal] git add -A OK');

      // 4) Comprobar si hay algo staged
      const diffResult = await new Promise((resolve, reject) => {
        execFile('git', ['diff', '--cached', '--name-only'], { cwd: projectDir, windowsHide: true }, (err, stdout, stderr) => {
          if (err) return reject(new Error(stderr || err.message));
          resolve(stdout || '');
        });
      });
      const stagedFiles = diffResult.trim();
      console.log('[githubController.syncLocal] staged files:', stagedFiles.length, 'chars');

      if (!stagedFiles) {
        return res.json({ success: true, message: 'Repo local ya estaba sincronizado (nada que commitear)', didCommit: false });
      }

      // 5) Commit usando mensaje por archivo temporal (evita problemas de escape)
      // Estrategia: escribir el mensaje a un archivo y usar -F <file>
      const tmpMsgFile = path.join(projectDir, '.git', 'ZEUS_SYNC_MSG.txt');
      await fs.writeFile(tmpMsgFile, message, 'utf-8');

      const commitResult = await new Promise((resolve, reject) => {
        execFile('git', ['commit', '-F', tmpMsgFile], { cwd: projectDir, windowsHide: true }, (err, stdout, stderr) => {
          // Limpiar el archivo temporal siempre
          fs.remove(tmpMsgFile).catch(() => null);
          if (err) return reject(new Error(stderr || err.message));
          resolve({ stdout, stderr });
        });
      });
      console.log('[githubController.syncLocal] git commit OK:', commitResult.stdout);

      res.json({ success: true, message: 'Cambios commiteados en el repo local', didCommit: true });
    } catch (error) {
      console.error('[githubController.syncLocal] error:', error.message);
      res.status(500).json({ error: error.message, didCommit: false });
    }
  },

  // POST /api/github/check-linked
  // Recibe { token, urls: string[] } y para cada URL hace GET al repo
  // correspondiente en GitHub. Devuelve { results: [{ url, exists, status, owner, repo }] }
  // - exists=true: el repo existe en GitHub
  // - exists=false: el repo no existe (404) o no es accesible
  // Diseñado para que el frontend sincronice su localStorage y descarte
  // los repos vinculados que el usuario haya borrado manualmente en GitHub.
  checkLinked: async (req, res) => {
    try {
      const { token, urls } = req.body || {};
      if (!token) return res.status(400).json({ error: 'GitHub token is required' });
      if (!Array.isArray(urls) || urls.length === 0) {
        return res.json({ results: [] });
      }

      const parseOwnerRepo = (u) => {
        const cleaned = String(u || '').trim();
        // Acepta tanto https://github.com/owner/repo(.git) como git@github.com:owner/repo.git
        let m = cleaned.match(/github\.com[/:]+([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i);
        if (!m) return null;
        return { owner: m[1], repo: m[2] };
      };

      const results = await Promise.all(urls.map(async (url) => {
        const parsed = parseOwnerRepo(url);
        if (!parsed) {
          return { url, exists: false, status: 'invalid-url', owner: null, repo: null };
        }
        const { owner, repo } = parsed;
        try {
          const r = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: 'application/vnd.github.v3+json',
            },
          });
          if (r.status === 200) {
            return { url, exists: true, status: 200, owner, repo };
          }
          if (r.status === 404) {
            return { url, exists: false, status: 404, owner, repo };
          }
          if (r.status === 401 || r.status === 403) {
            // No tenemos permisos o token inválido: tratar como "no accesible"
            return { url, exists: false, status: r.status, owner, repo, error: 'Sin permisos o token inválido' };
          }
          return { url, exists: false, status: r.status, owner, repo };
        } catch (e) {
          return { url, exists: false, status: 'network-error', owner, repo, error: e.message };
        }
      }));

      console.log('[githubController.checkLinked] results:', JSON.stringify(results, null, 2));
      res.json({ results });
    } catch (error) {
      console.error('[githubController.checkLinked] error:', error);
      res.status(500).json({ error: error.message || 'Failed to check linked repos' });
    }
  },

  // POST /api/github/remove-remote
  // Quita el remote `origin` (u otro) del repo git local. Útil cuando el
  // usuario borró el repo en GitHub y queremos dejar el local "limpio".
  // Body: { path: string, remoteName?: string (default 'origin') }
  removeRemote: async (req, res) => {
    const { execFile } = require('child_process');
    const { path: projectSubPath, remoteName } = req.body || {};
    const name = remoteName || 'origin';
    if (!projectSubPath) return res.status(400).json({ error: 'path is required' });

    const cwd = requireCwd(req, res); if (!cwd) return;
    let projectDir;
    try {
      projectDir = resolveProjectDir(cwd, projectSubPath);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }

    try {
      if (!fs.existsSync(path.join(projectDir, '.git'))) {
        return res.json({ success: true, message: 'No es un repo git, nada que quitar', removed: false });
      }
      // Comprobar si el remote existe antes de intentar quitarlo
      const remotes = await new Promise((resolve) => {
        execFile('git', ['remote'], { cwd: projectDir, windowsHide: true }, (_err, stdout) => resolve(stdout || ''));
      });
      const list = remotes.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      if (!list.includes(name)) {
        return res.json({ success: true, message: `El remote '${name}' no existe`, removed: false });
      }
      await new Promise((resolve, reject) => {
        execFile('git', ['remote', 'remove', name], { cwd: projectDir, windowsHide: true }, (err, stdout, stderr) => {
          if (err) return reject(new Error(stderr || err.message));
          resolve(stdout);
        });
      });
      console.log('[githubController.removeRemote] removed', name, 'from', projectDir);
      res.json({ success: true, message: `Remote '${name}' eliminado`, removed: true });
    } catch (error) {
      console.error('[githubController.removeRemote] error:', error);
      res.status(500).json({ error: error.message || 'Failed to remove remote' });
    }
  },
};

module.exports = githubController;
