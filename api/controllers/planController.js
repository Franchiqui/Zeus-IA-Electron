const fs = require('fs-extra');
const path = require('path');
const PocketBase = require('pocketbase/cjs');

// Configuración de PocketBase local
const pb = new PocketBase(process.env.NEXT_PUBLIC_POCKETBASE_LOCAL_URL || 'http://localhost:8091');
let pbAuthenticated = false;

// Función para autenticar en PocketBase local como admin
const authenticatePB = async () => {
  if (pbAuthenticated) return;
  try {
    const adminEmail = process.env.POCKETBASE_LOCAL_ADMIN_EMAIL || 'zeus@ia.com';
    const adminPassword = process.env.POCKETBASE_LOCAL_ADMIN_PASSWORD || '1234567890';
    console.log(`Intentando autenticar en PocketBase: ${pb.baseUrl} con ${adminEmail}`);
    await pb.admins.authWithPassword(adminEmail, adminPassword);
    pbAuthenticated = true;
    console.log('✓ Autenticado en PocketBase local como admin');
  } catch (error) {
    console.error('✗ Error de autenticación en PocketBase local:', error.message);
  }
};

// Obtener el directorio de planes (usando DATA_DIR dinámico)
const getPlansDir = () => {
  return path.join(require('../config').DATA_DIR, 'plans');
};

// Asegurar que el directorio de planes existe
const ensurePlansDir = async () => {
  await fs.ensureDir(getPlansDir());
};

// Función para generar IDs compatibles con PocketBase (15 caracteres alfanuméricos)
const generatePbId = () => {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 15; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
};

const planController = {
  // Crear un nuevo plan
  createPlan: async (req, res) => {
    const { name, description, model_id } = req.body;
    if (!name) return res.status(400).json({ error: 'name es requerido' });
    await ensurePlansDir();
    await authenticatePB();
    try {
      const fileName = name.toLowerCase().replace(/[^a-z0-9\s_-]/g, '').replace(/\s+/g, '-').trim() + '.json';
      const planPath = path.join(getPlansDir(), fileName);
      if (await fs.pathExists(planPath)) return res.status(400).json({ error: 'Ya existe un plan con ese nombre' });
      const newPlan = { id: fileName.replace('.json', ''), name, description: description || '', tasks: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      await fs.writeJson(planPath, newPlan, { spaces: 2 });
      try {
        console.log(`Intentando crear registro en PB para el plan: ${name}`);
        const pbRecord = await pb.collection('structure_plans').create({ 
          id: generatePbId(), // Proporcionar ID manualmente
          title: name, 
          description: description || '', 
          model_id: model_id || 'default', 
          total_stages: 0, 
          stages_completed: 0, 
          stages_pending: 0, 
          created_files_count: 0, 
          pending_files_count: 0, 
          stages_json: [] 
        });
        console.log('✓ Registro creado en PB:', pbRecord.id);
      } catch (pbError) { 
        console.error('✗ Error en PocketBase (createPlan):', pbError.message);
        if (pbError.data) console.error('Detalles del error PB:', JSON.stringify(pbError.data));
      }
      res.status(201).json({ success: true, plan: newPlan, fileName });
    } catch (error) { res.status(500).json({ error: error.message }); }
  },

  listPlans: async (req, res) => {
    await ensurePlansDir();
    try {
      const files = (await fs.readdir(getPlansDir())).filter(f => f.endsWith('.json'));
      const plans = [];
      for (const f of files) { try { plans.push(await fs.readJson(path.join(getPlansDir(), f))); } catch (e) {} }
      res.json({ success: true, plans: plans.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)) });
    } catch (error) { res.status(500).json({ error: error.message }); }
  },

  getPlan: async (req, res) => {
    const { name } = req.params;
    try {
      const fileName = name.endsWith('.json') ? name : name.toLowerCase().replace(/\s+/g, '-') + '.json';
      const p = path.join(getPlansDir(), fileName);
      if (!await fs.pathExists(p)) return res.status(404).json({ error: 'Plan no encontrado' });
      res.json({ success: true, plan: await fs.readJson(p) });
    } catch (error) { res.status(500).json({ error: error.message }); }
  },

  updatePlan: async (req, res) => {
    const { name } = req.params;
    const { newName, description } = req.body;
    try {
      const fileName = name.endsWith('.json') ? name : name.toLowerCase().replace(/\s+/g, '-') + '.json';
      const p = path.join(getPlansDir(), fileName);
      if (!await fs.pathExists(p)) return res.status(404).json({ error: 'Plan no encontrado' });
      const plan = await fs.readJson(p);
      if (newName) plan.name = newName;
      if (description) plan.description = description;
      plan.updatedAt = new Date().toISOString();
      await fs.writeJson(p, plan, { spaces: 2 });
      res.json({ success: true, plan });
    } catch (error) { res.status(500).json({ error: error.message }); }
  },

  deletePlan: async (req, res) => {
    const { name } = req.params;
    try {
      const fileName = name.endsWith('.json') ? name : name.toLowerCase().replace(/\s+/g, '-') + '.json';
      const p = path.join(getPlansDir(), fileName);
      if (!await fs.pathExists(p)) return res.status(404).json({ error: 'Plan no encontrado' });
      const plan = await fs.readJson(p);
      await fs.remove(p);
      try { await authenticatePB(); const rec = await pb.collection('structure_plans').getList(1, 1, { filter: `title = "${plan.name}"` }); if (rec.items.length > 0) await pb.collection('structure_plans').delete(rec.items[0].id); } catch (e) {}
      res.json({ success: true, message: 'Eliminado' });
    } catch (error) { res.status(500).json({ error: error.message }); }
  },

  savePlan: async (req, res) => {
    const { name, description, model_id, tasks } = req.body;
    if (!name) return res.status(400).json({ error: 'name es requerido' });
    await ensurePlansDir();
    await authenticatePB();
    try {
      const fileName = name.toLowerCase().replace(/\s+/g, '-') + '.json';
      const p = path.join(getPlansDir(), fileName);
      let plan = (await fs.pathExists(p)) ? await fs.readJson(p) : { id: fileName.replace('.json', ''), name, description: description || '', tasks: [], createdAt: new Date().toISOString() };
      if (name) plan.name = name;
      if (description !== undefined) plan.description = description;
      if (tasks) plan.tasks = tasks;
      plan.updatedAt = new Date().toISOString();
      await fs.writeJson(p, plan, { spaces: 2 });
      try {
        const rec = await pb.collection('structure_plans').getList(1, 1, { filter: `title = "${name}"` });
        const data = { title: name, description: description || plan.description, model_id: model_id || 'default', total_stages: plan.tasks.length, stages_completed: plan.tasks.filter(t => t.status === 'completed').length, stages_pending: plan.tasks.length - plan.tasks.filter(t => t.status === 'completed').length, created_files_count: plan.tasks.filter(t => t.status === 'completed').length, pending_files_count: plan.tasks.length - plan.tasks.filter(t => t.status === 'completed').length, stages_json: plan.tasks };
        if (rec.items.length > 0) await pb.collection('structure_plans').update(rec.items[0].id, data);
        else {
          data.id = generatePbId();
          await pb.collection('structure_plans').create(data);
        }
      } catch (e) {}
      res.json({ success: true, plan });
    } catch (error) { res.status(500).json({ error: error.message }); }
  },

  saveTask: async (req, res) => {
    const { planName, name, type, operation, extension, path: tPath, content } = req.body;
    if (!planName || !name) return res.status(400).json({ error: 'planName y name son requeridos' });
    await ensurePlansDir();
    await authenticatePB();
    try {
      const fileName = planName.toLowerCase().replace(/\s+/g, '-') + '.json';
      const p = path.join(getPlansDir(), fileName);
      if (!await fs.pathExists(p)) return res.status(404).json({ error: 'Plan no encontrado' });
      const plan = await fs.readJson(p);
      const newTask = { id: name.toLowerCase().replace(/\s+/g, '-') + '-' + Date.now(), name, type: type || 'file', operation: operation || 'create', extension: extension || '', path: tPath || '', content: content || '', status: 'pending', createdAt: new Date().toISOString() };
      plan.tasks.push(newTask);
      plan.updatedAt = new Date().toISOString();
      await fs.writeJson(p, plan, { spaces: 2 });
      try {
        const rec = await pb.collection('structure_plans').getList(1, 1, { filter: `title = "${plan.name}"` });
        if (rec.items.length > 0) {
          const comp = plan.tasks.filter(t => t.status === 'completed').length;
          await pb.collection('structure_plans').update(rec.items[0].id, { 
            total_stages: plan.tasks.length, 
            stages_completed: comp, 
            stages_pending: plan.tasks.length - comp, 
            pending_files_count: plan.tasks.length - comp, 
            stages_json: plan.tasks 
          });
          console.log(`✓ PB actualizado para el plan: ${plan.name}`);
        } else {
          console.warn(`! No se encontró el plan "${plan.name}" en PB para actualizar la tarea`);
        }
      } catch (e) { 
        console.error('✗ Error en PocketBase (saveTask):', e.message);
      }
      res.status(201).json({ success: true, task: newTask });
    } catch (error) { res.status(500).json({ error: error.message }); }
  },

  createTask: async (req, res) => {
    const { planName, name, type, operation, extension, path: tPath, content } = req.body;
    if (!name) return res.status(400).json({ error: 'name es requerido' });
    
    try {
      const DATA_DIR = require('../config').DATA_DIR;
      const fullPath = path.join(DATA_DIR, tPath || '', extension ? `${name}.${extension}` : name);
      
      if (type === 'folder') {
        await fs.ensureDir(fullPath);
        return res.status(201).json({ 
          success: true, 
          message: 'Carpeta creada', 
          path: fullPath,
          name: name 
        });
      } else if (type === 'file') {
        await fs.ensureDir(path.dirname(fullPath));
        await fs.writeFile(fullPath, content || '', 'utf8');
        return res.status(201).json({ 
          success: true, 
          message: 'Archivo creado', 
          path: fullPath,
          name: name 
        });
      }
      
      throw new Error('Tipo no soportado');
    } catch (error) { 
      res.status(500).json({ error: error.message }); 
    }
  },

  executePlan: async (req, res) => {
    const { planName, force } = req.body;
    if (!planName) return res.status(400).json({ error: 'Falta planName' });
    await ensurePlansDir();
    await authenticatePB();
    try {
      const fileName = planName.toLowerCase().replace(/\s+/g, '-') + '.json';
      const p = path.join(getPlansDir(), fileName);
      if (!await fs.pathExists(p)) return res.status(404).json({ error: 'Plan no encontrado' });
      const plan = await fs.readJson(p);
      const tasksToExec = force ? plan.tasks : plan.tasks.filter(t => t.status === 'pending');
      const results = [];
      for (const task of tasksToExec) {
        try {
          const result = await executeTask(task);
          const idx = plan.tasks.findIndex(t => t.id === task.id);
          plan.tasks[idx].status = result.success ? 'completed' : 'failed';
          plan.tasks[idx].result = result;
          results.push(result);
        } catch (e) { results.push({ success: false, error: e.message }); }
      }
      await fs.writeJson(p, plan, { spaces: 2 });
      try {
        const records = await pb.collection('structure_plans').getList(1, 1, { filter: `title = "${plan.name}"` });
        if (records.items.length > 0) {
          const completed = plan.tasks.filter(t => t.status === 'completed').length;
          await pb.collection('structure_plans').update(records.items[0].id, { stages_completed: completed, stages_pending: plan.tasks.length - completed, created_files_count: completed, stages_json: plan.tasks });
        }
      } catch (e) {}
      res.json({ success: true, results });
    } catch (error) { res.status(500).json({ error: error.message }); }
  },

  // MÉTODOS ADICIONALES PARA EVITAR CRASH
  getTask: async (req, res) => { res.status(501).json({ error: 'Not implemented' }); },
  updateTask: async (req, res) => { res.status(501).json({ error: 'Not implemented' }); },
  deleteTask: async (req, res) => { res.status(501).json({ error: 'Not implemented' }); },
  createTaskFolder: async (req, res) => { res.status(501).json({ error: 'Not implemented' }); },
  listTaskFolders: async (req, res) => { res.status(501).json({ error: 'Not implemented' }); },
  createTaskFile: async (req, res) => { res.status(501).json({ error: 'Not implemented' }); },
  listTaskFiles: async (req, res) => { res.status(501).json({ error: 'Not implemented' }); },
  executePlanTask: async (req, res) => { res.status(501).json({ error: 'Not implemented' }); },

  listTasks: async (req, res) => {
    const { fileName } = req.query;
    try {
      await ensurePlansDir();
      if (fileName) {
        const p = path.join(getPlansDir(), fileName);
        if (!await fs.pathExists(p)) return res.status(404).json({ error: 'Not found' });
        const plan = await fs.readJson(p);
        return res.json({ success: true, tasks: plan.tasks });
      }
      const files = await fs.readdir(getPlansDir());
      res.json({ success: true, availableFiles: files.filter(f => f.endsWith('.json')) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  },

  explorerData: async (req, res) => {
    try {
      const dataPath = path.normalize(require('../config').DATA_DIR);
      if (!await fs.pathExists(dataPath)) return res.status(404).json({ error: 'Data path not found' });

      const IGNORE_DIRS = ['node_modules', '.next', '.git', 'dist', 'build'];

      const getStructure = async (dir, rel = '') => {
        const items = [];
        const entries = await fs.readdir(dir);
        for (const e of entries) {
          if (IGNORE_DIRS.includes(e)) continue;

          const full = path.join(dir, e);
          try {
            const stat = await fs.stat(full);
            const itemRel = path.join(rel, e);
            if (stat.isDirectory()) {
              items.push({ 
                name: e, 
                path: itemRel, 
                type: 'folder', 
                children: await getStructure(full, itemRel) 
              });
            } else {
              items.push({ 
                name: e, 
                path: itemRel, 
                type: 'file', 
                extension: path.extname(e).slice(1) 
              });
            }
          } catch (err) {
            console.error(`[explorerData] Error stating ${full}:`, err.message);
            // Ignorar archivos que desaparecen durante el escaneo
          }
        }
        return items;
      };
      res.json({ success: true, items: await getStructure(dataPath) });
    } catch (error) { res.status(500).json({ error: error.message }); }
  },

  getPlansList: async (req, res) => {
    try {
      await ensurePlansDir();
      const files = (await fs.readdir(getPlansDir())).filter(f => f.endsWith('.json'));
      const plans = [];
      for (const f of files) { const p = await fs.readJson(path.join(getPlansDir(), f)); plans.push({ id: p.id, name: p.name, taskCount: p.tasks.length }); }
      res.json({ success: true, plans });
    } catch (e) { res.status(500).json({ error: e.message }); }
  }
};

async function executeTask(task) {
  const { type, operation, name, path: tPath, extension, content } = task;
  const DATA_DIR = require('../config').DATA_DIR;
  const fullPath = path.join(DATA_DIR, tPath || '', extension ? `${name}.${extension}` : name);
  if (type === 'file') {
    if (operation === 'delete') { if (await fs.pathExists(fullPath)) await fs.remove(fullPath); return { success: true, operation: 'delete', path: fullPath }; }
    await fs.ensureDir(path.dirname(fullPath));
    await fs.writeFile(fullPath, content || '', 'utf8');
    return { success: true, operation, path: fullPath };
  } else if (type === 'folder') {
    if (operation === 'delete') { if (await fs.pathExists(fullPath)) await fs.remove(fullPath); return { success: true, operation: 'delete', path: fullPath }; }
    await fs.ensureDir(fullPath);
    return { success: true, operation: 'create', path: fullPath };
  }
  throw new Error('Unsupported type');
}

module.exports = planController;