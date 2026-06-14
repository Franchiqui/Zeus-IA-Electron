/// <reference types="vite/client" />
import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

type GlobalMonaco = typeof globalThis & {
  MonacoEnvironment?: {
    getWorker: (_workerId: string, label: string) => Worker;
  };
};

const g = globalThis as GlobalMonaco;
g.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    if (label === 'json') {
      return new JsonWorker();
    }
    if (label === 'typescript' || label === 'javascript') {
      return new TsWorker();
    }
    return new EditorWorker();
  },
};

loader.config({ monaco });

// Mapa para trackear los modelos de archivos del proyecto
const projectFilesMap = new Map<string, monaco.editor.ITextModel>();

// Configurar TypeScript para mostrar errores
export function configureTypeScript() {
  monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
    target: monaco.languages.typescript.ScriptTarget.ES2020,
    module: monaco.languages.typescript.ModuleKind.ESNext,
    lib: ['lib.es2020.d.ts', 'lib.dom.d.ts'],
    allowJs: true,
    checkJs: false,
    strict: false,
    noImplicitAny: false,
    strictNullChecks: false,
    noUnusedLocals: false,
    noUnusedParameters: false,
    noFallthroughCasesInSwitch: true,
    esModuleInterop: true,
    skipLibCheck: true,
    moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
    resolveJsonModule: true,
    jsx: monaco.languages.typescript.JsxEmit.ReactJSX,
    baseUrl: '.',
    paths: {
      '@/*': ['./*']
    },
  });

  // Habilitar diagnósticos en línea (errores en rojo)
  monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: false,
    noSyntaxValidation: false,
    onlyVisible: false,
    diagnosticCodesToIgnore: [
      2792,  // Cannot find module (jsx-runtime)
      2307,  // Cannot find module (general)
      2304,  // Cannot find name
      2503,  // Cannot find namespace
      7005,  // Implicit 'any' type
      7006   // Implicit parameter 'any'
    ],
  });

  // Configurar JavaScript también
  monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
    target: monaco.languages.typescript.ScriptTarget.ES2020,
    module: monaco.languages.typescript.ModuleKind.ESNext,
    lib: ['lib.es2020.d.ts', 'lib.dom.d.ts'],
    allowJs: true,
    checkJs: true,
    strict: true,
    esModuleInterop: true,
    skipLibCheck: true,
    moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
    resolveJsonModule: true,
  });

  monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: false,
    noSyntaxValidation: false,
    onlyVisible: false,
    diagnosticCodesToIgnore: [
      2792,  // Cannot find module (jsx-runtime)
      2307,  // Cannot find module (general)
      2304,  // Cannot find name
      2503,  // Cannot find namespace
      7005,  // Implicit 'any' type
      7006   // Implicit parameter 'any'
    ],
  });
}

/**
 * Sincroniza los archivos del proyecto con Monaco para que detecte errores entre archivos
 * @param files - Objeto con los archivos del proyecto { path: content }
 */
export function syncProjectFilesToMonaco(files: Record<string, string>) {
  // Limpiar modelos anteriores que ya no existen
  for (const [path, model] of projectFilesMap.entries()) {
    if (!(path in files)) {
      model.dispose();
      projectFilesMap.delete(path);
    }
  }

  // Agregar/actualizar archivos
  for (const [path, content] of Object.entries(files)) {
    // Solo archivos TypeScript y JavaScript
    if (!path.endsWith('.ts') && !path.endsWith('.tsx') && !path.endsWith('.js') && !path.endsWith('.jsx')) {
      continue;
    }

    const existingModel = projectFilesMap.get(path);

    if (existingModel) {
      // Actualizar contenido si cambió
      if (existingModel.getValue() !== content) {
        existingModel.setValue(content);
      }
    } else {
      // Crear nuevo modelo
      const language = path.endsWith('.ts') || path.endsWith('.tsx') ? 'typescript' : 'javascript';
      const uri = monaco.Uri.parse(`file:///project/${path}`);

      // Verificar si ya existe un modelo con esta URI
      const existing = monaco.editor.getModel(uri);
      if (existing) {
        existing.dispose();
      }

      const model = monaco.editor.createModel(content, language, uri);
      projectFilesMap.set(path, model);
    }
  }
}

/**
 * Limpia todos los modelos de archivos del proyecto
 */
export function clearProjectFilesFromMonaco() {
  for (const model of projectFilesMap.values()) {
    model.dispose();
  }
  projectFilesMap.clear();
}

/**
 * Obtiene el mapa de archivos del proyecto (para referencia)
 */
export function getProjectFilesMap(): Map<string, monaco.editor.ITextModel> {
  return projectFilesMap;
}
