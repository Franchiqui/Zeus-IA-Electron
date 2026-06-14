const fs = require('fs-extra');
const path = require('path');
const { saveTaskToPlan } = require('./planController');

const getDataDir = () => require('../config').DATA_DIR;

// Store for prepared structure (in production, use Redis or DB)
let preparedStructure = [];
let createdStructure = [];

// Create structure (prepare only)
const createStructure = async (req, res) => {
  try {
    const { structure, planName, saveToPlan } = req.body;
    
    if (!structure || !Array.isArray(structure)) {
      return res.status(400).json({ 
        error: 'Structure is required and must be an array' 
      });
    }

    // Validate structure
    for (const item of structure) {
      if (!item.type || !item.name || !item.path) {
        return res.status(400).json({ 
          error: 'Each item must have type, name, and path' 
        });
      }
      
      if (!['folder', 'file'].includes(item.type)) {
        return res.status(400).json({ 
          error: 'Type must be folder or file' 
        });
      }
      
      if (item.type === 'file' && !item.content && !item.sourcePath) {
        return res.status(400).json({ 
          error: 'Files must have content or sourcePath' 
        });
      }
    }

    // Si se solicita guardar en plan en lugar de ejecutar
    if (saveToPlan && planName) {
      try {
        const savedTasks = [];
        for (const item of structure) {
          const result = await saveTaskToPlan({
            planName,
            name: item.name,
            extension: item.extension || (item.type === 'file' && item.name.includes('.') ? item.name.split('.').pop() : ''),
            type: item.type,
            operation: 'create',
            path: item.path,
            content: item.content || ''
          });
          savedTasks.push(result.task);
        }
        
        return res.status(201).json({
          success: true,
          message: `Structure saved to plan with ${savedTasks.length} tasks`,
          tasks: savedTasks,
          itemCount: savedTasks.length
        });
      } catch (error) {
        return res.status(500).json({ 
          error: 'Failed to save structure to plan: ' + error.message 
        });
      }
    }

    // Store the prepared structure
    preparedStructure = structure;
    
    res.status(201).json({
      success: true,
      message: 'Structure prepared successfully',
      structure: preparedStructure,
      itemCount: preparedStructure.length
    });
  } catch (error) {
    res.status(500).json({ 
      error: 'Failed to prepare structure: ' + error.message 
    });
  }
};

// Execute structure creation
const executeStructure = async (req, res) => {
  try {
    const { planName, saveToPlan } = req.body;
    
    if (preparedStructure.length === 0) {
      return res.status(400).json({ 
        error: 'No structure prepared. Create structure first.' 
      });
    }

    // Si se solicita guardar en plan en lugar de ejecutar
    if (saveToPlan && planName) {
      try {
        const savedTasks = [];
        for (const item of preparedStructure) {
          const result = await saveTaskToPlan({
            planName,
            name: item.name,
            extension: item.extension || (item.type === 'file' && item.name.includes('.') ? item.name.split('.').pop() : ''),
            type: item.type,
            operation: 'create',
            path: item.path,
            content: item.content || ''
          });
          savedTasks.push(result.task);
        }
        
        return res.status(201).json({
          success: true,
          message: `Structure saved to plan with ${savedTasks.length} tasks`,
          tasks: savedTasks,
          itemCount: savedTasks.length
        });
      } catch (error) {
        return res.status(500).json({ 
          error: 'Failed to save structure to plan: ' + error.message 
        });
      }
    }

    const results = [];
    
    // Create each item in the structure
    for (const item of preparedStructure) {
      console.log(`[EXEC] Creando item: ${item.type} - ${item.name} en ${item.path}`);
      try {
        const fullPath = path.join(getDataDir(), item.path, item.name);
        
        if (item.type === 'folder') {
          await fs.ensureDir(fullPath);
          results.push({
            ...item,
            status: 'created',
            fullPath: fullPath,
            type: 'folder'
          });
        } else if (item.type === 'file') {
          const fileName = item.extension ? `${item.name}.${item.extension}` : item.name;
          const filePath = path.join(getDataDir(), item.path, fileName);
          
          // Ensure directory exists
          await fs.ensureDir(path.dirname(filePath));
          
          let fileContent = '';
          let copied = false;
          let sourceResolved = null;
          
          // Handle content or copy from sourcePath
          if (item.sourcePath) {
            console.log(`[FILE] Buscando sourcePath: ${item.sourcePath}`);
            try {
              // 1. Try as absolute path or relative to API root
              sourceResolved = path.resolve(item.sourcePath);
              let sourceExists = await fs.pathExists(sourceResolved);
              
              // 2. If not found, try relative to getDataDir()
              if (!sourceExists) {
                const dataPathTry = path.join(getDataDir(), item.sourcePath);
                console.log(`[FILE] No encontrado en raíz, probando en data: ${dataPathTry}`);
                if (await fs.pathExists(dataPathTry)) {
                  sourceResolved = dataPathTry;
                  sourceExists = true;
                }
              }
              
              if (!sourceExists) {
                console.error(`[FILE] Error: no se encontró archivo de origen en ninguna ruta`);
                throw new Error(`Source file not found in ${item.sourcePath} or ${path.join(getDataDir(), item.sourcePath)}`);
              }
              
              console.log(`[FILE] Archivo de origen encontrado en: ${sourceResolved}`);
              
              // Check if it's a file, not a directory
              const stats = await fs.stat(sourceResolved);
              if (!stats.isFile()) {
                throw new Error(`Source path is a directory, but a file was expected: ${sourceResolved}`);
              }
              
              // Copy file content
              fileContent = await fs.readFile(sourceResolved, 'utf8');
              copied = true;
            } catch (copyError) {
              console.error(`[FILE] Error al copiar: ${copyError.message}`);
              results.push({
                ...item,
                status: 'error',
                error: `Failed to copy from source: ${copyError.message}`,
                type: 'file',
                sourcePath: item.sourcePath
              });
              continue;
            }
          } else {
            // Use provided content
            fileContent = item.content || '';
          }
          
          // Create file with content
          await fs.writeFile(filePath, fileContent);
          
          results.push({
            ...item,
            status: 'created',
            fullPath: filePath,
            fileName: fileName,
            type: 'file',
            sourcePath: item.sourcePath,
            sourceResolved: sourceResolved,
            copied: copied,
            content: fileContent.substring(0, 100) + (fileContent.length > 100 ? '...' : '') // Include snippet for tree
          });
        }
      } catch (itemError) {
        results.push({
          ...item,
          status: 'error',
          error: itemError.message,
          type: item.type
        });
      }
    }

    // Store created structure for tree view
    const successfulResults = results.filter(r => r.status === 'created');
    const failedResults = results.filter(r => r.status === 'error');
    
    createdStructure = successfulResults;
    
    // Si no se creó nada y hubo intentos fallidos, devolvemos success: false
    const totalAttempted = preparedStructure.length;
    const allFailed = failedResults.length === totalAttempted && totalAttempted > 0;

    res.json({
      success: !allFailed,
      message: allFailed ? 'Failed to create any items' : 'Structure execution completed',
      results: results,
      created: successfulResults.length,
      failed: failedResults.length
    });
  } catch (error) {
    res.status(500).json({ 
      error: 'Failed to execute structure: ' + error.message 
    });
  }
};

// Get structure tree
const getStructureTree = async (req, res) => {
  try {
    if (createdStructure.length === 0) {
      return res.json({
        success: true,
        message: 'No structure created yet',
        tree: []
      });
    }

    // Build tree structure
    const tree = buildTree(createdStructure);
    
    res.json({
      success: true,
      tree: tree,
      itemCount: createdStructure.length
    });
  } catch (error) {
    res.status(500).json({ 
      error: 'Failed to get structure tree: ' + error.message 
    });
  }
};

// Save structure to file
const saveStructureToFile = async (req, res) => {
  try {
    const { structure, name } = req.body;
    
    // Si no hay nombre, usamos una marca de tiempo para no sobrescribir
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const fileName = name ? `structure_${name}.json` : `structure_save_${timestamp}.json`;
    const filePath = path.join(getDataDir(), fileName);
    
    await fs.writeJson(filePath, structure, { spaces: 2 });
    
    res.json({
      success: true,
      message: `Structure saved to ${fileName}`,
      fileName: fileName,
      path: filePath
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to save structure: ' + error.message });
  }
};

// List saved structures
const listSavedStructures = async (req, res) => {
  try {
    const items = await fs.readdir(getDataDir());
    const saves = items
      .filter(item => item.startsWith('structure_') && item.endsWith('.json'))
      .map(item => ({
        name: item.replace('structure_', '').replace('.json', ''),
        fileName: item
      }))
      .sort((a, b) => b.fileName.localeCompare(a.fileName)); // Más recientes primero
      
    res.json({
      success: true,
      saves: saves
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to list saves: ' + error.message });
  }
};

// Load structure from file
const loadStructureFromFile = async (req, res) => {
  try {
    const { fileName } = req.query;
    // Si no pasan fileName, intentamos cargar el más reciente
    let targetFile = fileName;
    
    if (!targetFile) {
      const items = await fs.readdir(getDataDir());
      const saves = items
        .filter(item => item.startsWith('structure_') && item.endsWith('.json'))
        .sort((a, b) => b.localeCompare(a));
      
      if (saves.length === 0) {
        return res.status(404).json({ error: 'No save files found' });
      }
      targetFile = saves[0];
    }

    const filePath = path.join(getDataDir(), targetFile);
    
    if (!await fs.pathExists(filePath)) {
      return res.status(404).json({ error: 'Save file not found: ' + targetFile });
    }
    
    const structure = await fs.readJson(filePath);
    preparedStructure = structure;
    
    // Preparar el árbol para la estructura que acabamos de cargar
    createdStructure = structure.map(item => {
      const fileName = (item.type === 'file' && item.extension) 
        ? `${item.name}.${item.extension}` 
        : item.name;
      return {
        ...item,
        fileName: fileName,
        fullPath: path.join(getDataDir(), item.path, fileName),
        status: 'loaded'
      };
    });
    
    res.json({
      success: true,
      structure: structure,
      message: `Structure loaded from ${targetFile}`,
      fileName: targetFile
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load structure: ' + error.message });
  }
};

// Helper function to build tree structure
const buildTree = (items) => {
  const tree = [];
  const map = {};
  
  // Create map of all items
  items.forEach(item => {
    const key = item.path || '/';
    if (!map[key]) {
      map[key] = { path: key, folders: [], files: [] };
    }
    
    if (item.type === 'folder') {
      map[key].folders.push({
        name: item.name,
        path: item.path,
        fullPath: item.fullPath
      });
    } else {
      map[key].files.push({
        name: item.fileName || item.name,
        path: item.path,
        fullPath: item.fullPath,
        content: item.content
      });
    }
  });
  
  // Convert map to tree structure (showing all paths)
  Object.keys(map).forEach(path => {
    tree.push(map[path]);
  });
  
  return tree;
};

module.exports = {
  createStructure,
  executeStructure,
  getStructureTree,
  saveStructureToFile,
  loadStructureFromFile,
  listSavedStructures
};