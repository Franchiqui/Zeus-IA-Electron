import { NextRequest, NextResponse } from "next/server";
import { scanFolder, compareFolders } from "@/lib/validations";

// Función para filtrar rutas que contienen node_modules o .next
function filterPath(path: string): boolean {
  const normalizedPath = path.replace(/\\/g, '/');
  // Filtrar si está dentro de node_modules o .next (pero no si es la carpeta raíz con ese nombre)
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

    // Convertir ruta absoluta a relativa desde basePath
    let relativePath = file.path.replace(/\\/g, '/');
    const normalizedBasePath = basePath.replace(/\\/g, '/');
    if (relativePath.startsWith(normalizedBasePath)) {
      relativePath = relativePath.slice(normalizedBasePath.length);
      if (relativePath.startsWith('/')) {
        relativePath = relativePath.slice(1);
      }
    }

    if (!relativePath) return; // Ignorar el archivo raíz

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

  console.log(`buildTree: processed ${processedCount} files, filtered ${filteredCount} files`);
  return tree;
}

// Función para convertir árbol plano a array anidado
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
    return NextResponse.json({
      error: "Debe proporcionar ambas rutas de carpetas"
    }, { status: 400 });
  }

  try {
    const filesA = await scanFolder(folderA);
    const filesB = await scanFolder(folderB);
    const comparisonResult = compareFolders(filesA, filesB);

    // Construir árboles para ambas carpetas
    const treeA = buildTree(filesA, folderA);
    const treeB = buildTree(filesB, folderB);
    
    const structureA = treeToArray(treeA);
    const structureB = treeToArray(treeB);

    // Crear sets de paths relativos para comparación
    const pathsARelative = new Set(structureA.map(item => item.path));
    const pathsBRelative = new Set(structureB.map(item => item.path));

    // Marcar elementos que no existen en la otra carpeta
    structureA.forEach(item => {
      item.missingInB = !pathsBRelative.has(item.path);
    });
    structureB.forEach(item => {
      item.missingInA = !pathsARelative.has(item.path);
    });

    console.log('structureA length:', structureA.length);
    console.log('structureB length:', structureB.length);
    console.log('structureA sample:', structureA.slice(0, 3));
    console.log('structureB sample:', structureB.slice(0, 3));

    // Transformar al formato que espera page.tsx
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

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error scanning folders:', error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Error al escanear carpetas'
    }, { status: 500 });
  }
}
