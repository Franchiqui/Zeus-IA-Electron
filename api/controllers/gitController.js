const { exec, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { getSessionCwd } = require('../middleware/sessionCwd');

const getDataDir = (req) => getSessionCwd(req);

function requireCwd(req, res) {
  const cwd = getDataDir(req);
  if (!cwd) {
    res.status(400).json({ error: 'No hay sesión activa. Selecciona una carpeta de proyecto.' });
    return null;
  }
  return cwd;
}

// Helper genérico para ejecutar comandos git
function runGit(cwd, args, timeoutMs = 15000) {
  console.log(`[runGit v2 shell:false] cwd=${cwd} args=${JSON.stringify(args)}`);
  return new Promise((resolve, reject) => {
    // Usamos shell:false para que los args se pasen a git como argumentos literales,
    // no interpretados por cmd.exe. Esto evita que caracteres como /, ,, :, espacios
    // en mensajes de commit se rompan en pathspecs.
    const child = spawn('git', args, {
      cwd,
      env: process.env,
      shell: false,
      windowsHide: true
    });

    let stdout = '';
    let stderr = '';
    let finished = false;

    const timer = setTimeout(() => {
      if (!finished) {
        finished = true;
        try { child.kill('SIGTERM'); } catch {}
        reject(new Error(`Git command timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs);

    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });

    child.on('close', (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (code !== 0) {
        return reject(new Error(stderr.trim() || `Git exit code ${code}`));
      }
      resolve(stdout.trim());
    });

    child.on('error', (err) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      reject(err);
    });
  });
}

function resolveProjectDir(cwd, subPath) {
  if (!subPath) return cwd;
  return path.join(cwd, subPath);
}

// Busca la raíz del repositorio Git subiendo por los directorios padre (dentro del cwd de sesión)
function resolveGitDir(cwd, subPath) {
  const dataDir = path.normalize(cwd);
  const start = subPath ? path.join(dataDir, subPath) : dataDir;
  let dir = path.normalize(start);
  while (dir.startsWith(dataDir)) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return start; // fallback al directorio original
}

const gitController = {
  // GET /api/git/is-repo
  isRepo: async (req, res) => {
    try {
      const cwd = requireCwd(req, res); if (!cwd) return;
      const startDir = resolveProjectDir(cwd, req.query.path);
      const gitRoot = resolveGitDir(cwd, req.query.path);
      const isRepo = fs.existsSync(path.join(gitRoot, '.git'));
      // Devolver la ruta raíz del repo relativa al cwd de sesión para que el frontend pueda sincronizarse
      const relativeGitRoot = path.relative(cwd, gitRoot).replace(/\\/g, '/');
      res.json({ isRepo, gitRoot: isRepo ? relativeGitRoot : null });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  // GET /api/git/status
  status: async (req, res) => {
    try {
      const cwd = requireCwd(req, res); if (!cwd) return;
      const projectDir = resolveGitDir(cwd, req.query.path);

      // Verificar que es repo git
      if (!fs.existsSync(path.join(projectDir, '.git'))) {
        return res.json({ isRepo: false, branch: null, files: [] });
      }

      // Obtener branch
      const branchOutput = await runGit(projectDir, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => 'unknown');
      const branch = branchOutput || 'unknown';

      // Obtener upstream info
      const upstreamOutput = await runGit(projectDir, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']).catch(() => null);

      // Obtener ahead/behind
      let ahead = 0, behind = 0;
      if (upstreamOutput) {
        const revList = await runGit(projectDir, ['rev-list', '--left-right', '--count', `${branch}...${upstreamOutput}`]).catch(() => '');
        const parts = revList.split(/\s+/).map(Number);
        if (parts.length === 2) {
          ahead = parts[0] || 0;
          behind = parts[1] || 0;
        }
      }

      // git status --porcelain
      const porcelain = await runGit(projectDir, ['status', '--porcelain', '-uall']).catch(() => '');
      const files = [];
      const lines = porcelain.split('\n').filter(Boolean);
      for (const line of lines) {
        const indexStatus = line[0];
        const worktreeStatus = line[1];
        const rawPath = line.substring(3).trim();
        // Manejar renombrados: "R  old -> new"
        let filePath = rawPath;
        let originalPath = null;
        if (indexStatus === 'R' || worktreeStatus === 'R') {
          const arrowIdx = rawPath.indexOf(' -> ');
          if (arrowIdx !== -1) {
            originalPath = rawPath.substring(0, arrowIdx);
            filePath = rawPath.substring(arrowIdx + 4);
          }
        }

        let status = 'modified';
        if (indexStatus === 'A' || worktreeStatus === 'A') status = 'added';
        if (indexStatus === 'D' || worktreeStatus === 'D') status = 'deleted';
        if (indexStatus === 'R' || worktreeStatus === 'R') status = 'renamed';
        if (indexStatus === '?' && worktreeStatus === '?') status = 'untracked';
        if (indexStatus === ' ' && worktreeStatus === '?') status = 'untracked';

        const isStaged = indexStatus !== ' ' && indexStatus !== '?';

        files.push({
          path: filePath,
          originalPath,
          status,
          staged: isStaged,
          indexStatus,
          worktreeStatus
        });
      }

      // Obtener user.name y user.email
      const userName = await runGit(projectDir, ['config', 'user.name']).catch(() => '');
      const userEmail = await runGit(projectDir, ['config', 'user.email']).catch(() => '');

      res.json({
        isRepo: true,
        branch,
        upstream: upstreamOutput,
        ahead,
        behind,
        files,
        user: { name: userName, email: userEmail }
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  // GET /api/git/log
  log: async (req, res) => {
    try {
      const cwd = requireCwd(req, res); if (!cwd) return;
      const projectDir = resolveGitDir(cwd, req.query.path);
      const limit = Math.min(parseInt(req.query.limit || '20', 10), 100);
      const format = '%H|%s|%an|%ad|%ae';
      const output = await runGit(projectDir, ['log', `-${limit}`, '--format=' + format, '--date=short']);
      const commits = output.split('\n').filter(Boolean).map(line => {
        const parts = line.split('|');
        return {
          hash: parts[0],
          shortHash: parts[0].substring(0, 7),
          message: parts[1],
          author: parts[2],
          date: parts[3],
          email: parts[4]
        };
      });
      res.json({ commits });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  // GET /api/git/branches
  branches: async (req, res) => {
    try {
      const cwd = requireCwd(req, res); if (!cwd) return;
      const projectDir = resolveGitDir(cwd, req.query.path);
      const output = await runGit(projectDir, ['branch', '-a', '--format=%(refname:short)%(if)%(HEAD)%(then)*%(end)']);
      const lines = output.split('\n').filter(Boolean);
      const current = lines.find(l => l.endsWith('*'))?.replace('*', '') || '';
      const all = lines.map(l => l.replace('*', '').trim()).filter(Boolean);
      res.json({ current, branches: all });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  // GET /api/git/diff
  diff: async (req, res) => {
    try {
      const cwd = requireCwd(req, res); if (!cwd) return;
      const projectDir = resolveGitDir(cwd, req.query.path);
      const file = req.query.file;
      const staged = req.query.staged === 'true';
      const args = staged ? ['diff', '--cached', '--', file] : ['diff', '--', file];
      const output = await runGit(projectDir, args);
      res.json({ diff: output });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  // POST /api/git/add
  add: async (req, res) => {
    try {
      const cwd = requireCwd(req, res); if (!cwd) return;
      const projectDir = resolveGitDir(cwd, req.body.path);
      const files = Array.isArray(req.body.files) ? req.body.files : [req.body.files];
      await runGit(projectDir, ['add', ...files]);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  // POST /api/git/unstage
  unstage: async (req, res) => {
    try {
      const cwd = requireCwd(req, res); if (!cwd) return;
      const projectDir = resolveGitDir(cwd, req.body.path);
      const files = Array.isArray(req.body.files) ? req.body.files : [req.body.files];
      await runGit(projectDir, ['restore', '--staged', ...files]);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  // POST /api/git/commit
  commit: async (req, res) => {
    try {
      const cwd = requireCwd(req, res); if (!cwd) return;
      const projectDir = resolveGitDir(cwd, req.body.path);
      const { message } = req.body;
      if (!message || !message.trim()) {
        return res.status(400).json({ error: 'El mensaje de commit es obligatorio' });
      }
      await runGit(projectDir, ['commit', '-m', message.trim()]);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  // POST /api/git/push
  push: async (req, res) => {
    try {
      const cwd = requireCwd(req, res); if (!cwd) return;
      const projectDir = resolveGitDir(cwd, req.body.path);
      const branch = req.body.branch || 'HEAD';
      const output = await runGit(projectDir, ['push', 'origin', branch]);
      res.json({ success: true, output });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  // POST /api/git/pull
  pull: async (req, res) => {
    try {
      const cwd = requireCwd(req, res); if (!cwd) return;
      const projectDir = resolveGitDir(cwd, req.body.path);
      const output = await runGit(projectDir, ['pull']);
      res.json({ success: true, output });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  // POST /api/git/checkout
  checkout: async (req, res) => {
    try {
      const cwd = requireCwd(req, res); if (!cwd) return;
      const projectDir = resolveGitDir(cwd, req.body.path);
      const { branch } = req.body;
      await runGit(projectDir, ['checkout', branch]);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  // POST /api/git/branch
  createBranch: async (req, res) => {
    try {
      const cwd = requireCwd(req, res); if (!cwd) return;
      const projectDir = resolveGitDir(cwd, req.body.path);
      const { name } = req.body;
      await runGit(projectDir, ['checkout', '-b', name]);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  // POST /api/git/init
  init: async (req, res) => {
    try {
      const cwd = requireCwd(req, res); if (!cwd) return;
      const projectDir = resolveProjectDir(cwd, req.body.path);
      await runGit(projectDir, ['init']);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  // GET /api/git/remote-url
  remoteUrl: async (req, res) => {
    try {
      const cwd = requireCwd(req, res); if (!cwd) return;
      const projectDir = resolveGitDir(cwd, req.query.path);
      const url = await runGit(projectDir, ['remote', 'get-url', 'origin']).catch(() => null);
      res.json({ url });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  // POST /api/git/config
  setConfig: async (req, res) => {
    try {
      const cwd = requireCwd(req, res); if (!cwd) return;
      const projectDir = resolveGitDir(cwd, req.body.path);
      const { name, email } = req.body;
      if (name) await runGit(projectDir, ['config', 'user.name', name]);
      if (email) await runGit(projectDir, ['config', 'user.email', email]);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
};

module.exports = gitController;
