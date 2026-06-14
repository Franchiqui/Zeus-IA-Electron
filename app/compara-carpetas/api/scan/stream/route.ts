import { NextRequest } from "next/server";
import { scanFolder, compareFolders } from "@/lib/validations";

// Función para filtrar rutas que contienen node_modules o .next
function filterPath(path: string): boolean {
  const normalizedPath = path.replace(/\\/g, '/');
  const isInsideNodeModules = normalizedPath.includes('/node_modules/') || normalizedPath.startsWith('node_modules/');
  const isInsideNext = normalizedPath.includes('/.next/') || normalizedPath.startsWith('.next/');
  return !isInsideNodeModules && !isInsideNext;
}

// Función para construir estructura de árbol desde lista de archivos
function buildTree(files: any[], basePath: string): any {
  const tree: any = {};
  let processedCount = 0;
  let filteredCount = 0;

  files.forEach(file => {
    if (!filterPath(file.path)) {
      filteredCount++;
      return;
    }

    let relativePath = file.path.replace(/\\/g, '/');
    const normalizedBasePath = basePath.replace(/\\/g, '/');
    if (relativePath.startsWith(normalizedBasePath)) {
      relativePath = relativePath.slice(normalizedBasePath.length);
      if (relativePath.startsWith('/')) {
        relativePath = relativePath.slice(1);
      }
    }

    if (!relativePath) return;

    processedCount++;

    const parts = relativePath.split('/');
    let current = tree;

    parts.forEach((part: string, index: number) => {
      if (!current[part]) {
        current[part] = {
          name: part,
          isDirectory: index < parts.length - 1 ? file.isDirectory : false,
          children: {},
          path: parts.slice(0, index + 1).join('/'),
          existsInA: false,
          existsInB: false
        };
      }
      if (index === parts.length - 1) {
        current[part].isDirectory = file.isDirectory;
      }
      current = current[part].children;
    });
  });

  return tree;
}

function treeToArray(tree: any, parentPath = ''): any[] {
  const result: any[] = [];
  Object.keys(tree).forEach(key => {
    const node = tree[key];
    const fullPath = parentPath ? `${parentPath}/${key}` : key;
    result.push({
      name: key,
      path: fullPath,
      isDirectory: node.isDirectory,
      children: node.children ? Object.keys(node.children).length > 0 : false
    });
    if (node.children && Object.keys(node.children).length > 0) {
      result.push(...treeToArray(node.children, fullPath));
    }
  });
  return result;
}

export async function POST(request: NextRequest) {
  const { folderA, folderB } = await request.json();

  if (!folderA || !folderB) {
    return new Response(JSON.stringify({ error: "Debe proporcionar ambas rutas de carpetas" }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Enviar progreso 10%
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ progress: 10, status: 'Escaneando carpeta A...' })}\n\n`));

        const filesA = await scanFolder(folderA);
        
        // Enviar progreso 40%
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ progress: 40, status: 'Escaneando carpeta B...' })}\n\n`));

        const filesB = await scanFolder(folderB);
        
        // Enviar progreso 60%
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ progress: 60, status: 'Comparando carpetas...' })}\n\n`));

        const comparisonResult = compareFolders(filesA, filesB);

        // Enviar progreso 70%
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ progress: 70, status: 'Construyendo estructuras...' })}\n\n`));

        const treeA = buildTree(filesA, folderA);
        const treeB = buildTree(filesB, folderB);
        
        const structureA = treeToArray(treeA);
        const structureB = treeToArray(treeB);

        const pathsARelative = new Set(structureA.map(item => item.path));
        const pathsBRelative = new Set(structureB.map(item => item.path));

        structureA.forEach(item => {
          item.missingInB = !pathsBRelative.has(item.path);
        });
        structureB.forEach(item => {
          item.missingInA = !pathsARelative.has(item.path);
        });

        // Enviar progreso 90%
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ progress: 90, status: 'Finalizando...' })}\n\n`));

        const result = {
          folderA: comparisonResult.folderA,
          folderB: comparisonResult.folderB,
          structureA,
          structureB,
          differences: {
            missingFoldersB: comparisonResult.onlyInB
              .filter(f => f.isDirectory)
              .filter(f => filterPath(f.path))
              .map(f => f.path),
            missingFilesA: comparisonResult.onlyInA
              .filter(f => !f.isDirectory)
              .filter(f => filterPath(f.path))
              .map(f => f.path),
            missingFilesB: comparisonResult.onlyInB
              .filter(f => !f.isDirectory)
              .filter(f => filterPath(f.path))
              .map(f => f.path),
            differentSizeFiles: comparisonResult.differentSize
              .filter(d => filterPath(d.file))
              .map(d => ({
                path: d.file,
                sizeA: d.sizeA,
                sizeB: d.sizeB
              }))
          }
        };

        // Enviar resultado final
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ progress: 100, status: 'Completado', result })}\n\n`));
        controller.close();
      } catch (error) {
        console.error('Error scanning folders:', error);
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: error instanceof Error ? error.message : 'Error al escanear carpetas' })}\n\n`));
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
