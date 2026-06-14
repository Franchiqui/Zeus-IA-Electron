import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { getPackageJsonContent } from '../route';
import { generateImageEditorStoreContent } from './image-editor-store';
import { getProjectRoot, readApiConfig } from '@/api/utils';
import { callModelGeneric } from '@/api/zeus-model-api/generic-model-call';

interface StructureRequest {
  appName: string;
  template: string;
  complexity: 'simple' | 'standard' | 'complex';
  features: string[];
  description: string;
  projectId?: string;
  projectRoot?: string;
  modelConfig?: {
    url: string;
    apiKey: string;
    model: string;
    provider?: string;
  };
  optimizeForSpeed?: boolean;
  uploadedFiles?: {
    name: string;
    type: string;
    size: number;
    content: string;
  }[];
  uploadedImages?: {
    name: string;
    type: string;
    size: number;
    dataUrl: string;
  }[];
  customPages?: { name: string; description: string }[];
  // Parámetros de configuración
}

interface FileStructure {
  name: string;
  type: 'file' | 'directory';
  path: string;
  content?: string;
  children?: FileStructure[];
}

// Función para validar estructura mínima requerida
function validateMinimalStructure(structure: FileStructure[], template: string, appName: string = 'my-app', features?: string[]): FileStructure[] {
  const essentialFiles = {
    'next-js': [
      'package.json',
      'app/layout.tsx',
      'app/metadata.ts',
      'app/page.tsx',
      'app/globals.css',
      'tsconfig.json',
      'next.config.js',
      'tailwind.config.js',
      'postcss.config.js',
      '.gitignore',
      'README.md'
    ],
    'vite-react': [
      'package.json',
      'src/App.tsx',
      'src/main.tsx',
      'index.html',
      'tsconfig.json',
      'vite.config.ts',
      'tailwind.config.js',
      'postcss.config.js',
      '.gitignore',
      'README.md'
    ],
    'vue-nuxt': [
      'package.json',
      'app.vue',
      'nuxt.config.ts',
      'tsconfig.json',
      '.gitignore',
      'README.md'
    ]
  };

  const required = essentialFiles[template as keyof typeof essentialFiles] || [];
  console.log(`🔍 Validando archivos esenciales para ${template}:`, required);

  // Función recursiva para encontrar archivos en la estructura
  function findFileInStructure(structure: FileStructure[], filePath: string): boolean {
    const normalizedTarget = filePath.replace(/\\/g, '/').replace(/^\/+/, '');
    for (const item of structure) {
      const normalizedItem = item.path.replace(/\\/g, '/').replace(/^\/+/, '');
      if (normalizedItem === normalizedTarget) {
        return true;
      }
      if (item.children) {
        if (findFileInStructure(item.children, filePath)) {
          return true;
        }
      }
    }
    return false;
  }

  // Verificar que todos los archivos esenciales estén presentes
  const missingFiles: string[] = [];
  for (const requiredFile of required) {
    if (!findFileInStructure(structure, requiredFile)) {
      missingFiles.push(requiredFile);
    }
  }

  if (missingFiles.length > 0) {
    console.warn(`⚠️ Archivos esenciales faltantes para ${template}:`, missingFiles);
    // Agregar archivos faltantes a la estructura
    for (const missingFile of missingFiles) {
      addMissingFileToStructure(structure, missingFile, template, appName, features);
    }
  }

  console.log(`✅ Estructura validada para ${template}. Total de archivos: ${countFiles(structure)}`);
  return structure;
}

// Función auxiliar para contar archivos en la estructura
function countFiles(structure: FileStructure[]): number {
  let count = 0;
  for (const item of structure) {
    if (item.type === 'file') {
      count++;
    }
    if (item.children) {
      count += countFiles(item.children);
    }
  }
  return count;
}

// Función para agregar archivos faltantes a la estructura
function addMissingFileToStructure(structure: FileStructure[], filePath: string, template: string, appName: string = 'my-app', features?: string[]): void {
  const normalizedPath = filePath.replace(/\\/g, '/').replace(/^\/+/, '');
  const pathParts = normalizedPath.split('/');
  const fileName = pathParts[pathParts.length - 1];

  if (pathParts.length === 1) {
    // Archivo en la raíz
    structure.push({
      name: fileName,
      type: 'file',
      path: normalizedPath,
      content: getDefaultFileContent(normalizedPath, template, appName, features)
    });
  } else {
    // Archivo en subdirectorio
    let currentLevel = structure;

    // Navegar/crear la estructura de directorios
    for (let i = 0; i < pathParts.length - 1; i++) {
      const dirName = pathParts[i];
      const currentPath = pathParts.slice(0, i + 1).join('/');

      let dir = currentLevel.find(item => {
        const itemNorm = item.path.replace(/\\/g, '/').replace(/^\/+/, '');
        return item.name === dirName && item.type === 'directory' && (itemNorm === currentPath || itemNorm === dirName);
      });

      if (!dir) {
        dir = {
          name: dirName,
          type: 'directory',
          path: currentPath,
          children: []
        };
        currentLevel.push(dir);
      }
      currentLevel = dir.children!;
    }

    // Agregar el archivo
    currentLevel.push({
      name: fileName,
      type: 'file',
      path: normalizedPath,
      content: getDefaultFileContent(normalizedPath, template, appName, features)
    });
  }
}

// Función para obtener contenido por defecto de archivos faltantes
function getDefaultFileContent(filePath: string, template: string, appName: string = 'my-app', features?: string[]): string | undefined {
  // Solo proporcionar contenido para archivos críticos
  if (filePath === 'package.json') {
    return getPackageJsonContent(template, appName, undefined, features);
  }
  if (filePath === '.gitignore') {
    return generateGitignoreContent(template);
  }
  if (filePath === 'README.md') {
    return generateReadmeContent(appName, template);
  }
  // Para otros archivos, dejar que se genere el contenido dinámicamente
  return undefined;
}

// Función para generar la estructura básica de archivos según la plantilla
function generateProjectStructure(template: string, appName: string, complexity: string, features?: string[], additionalPages?: { route: string; purpose: string }[]): FileStructure[] {
  // OPTIMIZACIÓN: Estructura base común
  const baseStructure: FileStructure[] = [
    {
      name: 'package.json',
      type: 'file',
      path: 'package.json',
      content: getPackageJsonContent(template, appName, undefined, features)
    }
  ];

  // Agregar archivos básicos para todos los niveles
  baseStructure.push(
    {
      name: '.gitignore',
      type: 'file',
      path: '.gitignore',
      content: generateGitignoreContent(template)
    },
    {
      name: 'README.md',
      type: 'file',
      path: 'README.md',
      content: generateReadmeContent(appName, template)
    },
    {
      name: '.env.example',
      type: 'file',
      path: '.env.example',
      content: generateEnvExampleContent(template)
    },
    {
      name: '.eslintrc.json',
      type: 'file',
      path: '.eslintrc.json',
      content: generateEslintConfigContent(template)
    },
    {
      name: '.prettierrc',
      type: 'file',
      path: '.prettierrc',
      content: generatePrettierConfigContent()
    },
    {
      name: '.editorconfig',
      type: 'file',
      path: '.editorconfig',
      content: generateEditorConfigContent()
    }
  );

  // Agregar archivos específicos según la plantilla
  switch (template) {
    case 'next-js':
      // Archivos esenciales para Next.js (todos los niveles)
      baseStructure.push(
        {
          name: 'tsconfig.json',
          type: 'file',
          path: 'tsconfig.json',
          content: generateTsconfigContent('next')
        },
        {
          name: 'app',
          type: 'directory',
          path: 'app',
          children: [
            {
              name: 'layout.tsx',
              type: 'file',
              path: 'app/layout.tsx'
            },
            {
              name: 'metadata.ts',
              type: 'file',
              path: 'app/metadata.ts',
              content: `import type { Metadata } from 'next';

/** Metadata de la aplicación. Único lugar donde se define; NO exportar metadata en app/page.tsx. */
export const metadata: Metadata = {
  title: '${String(appName || 'App').replace(/'/g, "\\'")} | Zeus IA',
  description: 'Aplicación creada con Zeus IA - www.zeus-ia.com',
  openGraph: {
    title: '${String(appName || 'App').replace(/'/g, "\\'")} | Zeus IA',
    description: 'Aplicación creada con Zeus IA - www.zeus-ia.com',
  },
};
`
            },
            {
              name: 'page.tsx',
              type: 'file',
              path: 'app/page.tsx'
            },
            ...(additionalPages && additionalPages.length > 0
              ? additionalPages.map(p => ({
                  name: p.route,
                  type: 'directory' as const,
                  path: `app/${p.route}`,
                  children: [
                    {
                      name: 'page.tsx',
                      type: 'file' as const,
                      path: `app/${p.route}/page.tsx`
                    }
                  ]
                }))
              : []),
            {
              name: 'globals.css',
              type: 'file',
              path: 'app/globals.css',
              content: `@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 222.2 47.4% 11.2%;

    --muted: 210 40% 96.1%;
    --muted-foreground: 215.4 16.3% 46.9%;

    --popover: 0 0% 100%;
    --popover-foreground: 222.2 47.4% 11.2%;

    --border: 214.3 31.8% 91.4%;
    --input: 214.3 31.8% 91.4%;

    --card: 0 0% 100%;
    --card-foreground: 222.2 47.4% 11.2%;

    --primary: 222.2 47.4% 11.2%;
    --primary-foreground: 210 40% 98%;

    --secondary: 210 40% 96.1%;
    --secondary-foreground: 222.2 47.4% 11.2%;

    --accent: 210 40% 96.1%;
    --accent-foreground: 222.2 47.4% 11.2%;

    --destructive: 0 100% 50%;
    --destructive-foreground: 210 40% 98%;

    --ring: 215 20.2% 65.1%;

    --radius: 0.5rem;
  }

  .dark {
    --background: 224 71% 4%;
    --foreground: 213 31% 91%;

    --muted: 223 47% 11%;
    --muted-foreground: 215.4 16.3% 56.9%;

    --accent: 216 34% 17%;
    --accent-foreground: 210 40% 98%;

    --popover: 224 71% 4%;
    --popover-foreground: 215 20.2% 65.1%;

    --border: 216 34% 17%;
    --input: 216 34% 17%;

    --card: 224 71% 4%;
    --card-foreground: 213 31% 91%;

    --primary: 210 40% 98%;
    --primary-foreground: 222.2 47.4% 1.2%;

    --secondary: 222.2 47.4% 11.2%;
    --secondary-foreground: 210 40% 98%;

    --destructive: 0 63% 31%;
    --destructive-foreground: 210 40% 98%;

    --ring: 216 34% 17%;

    --radius: 0.5rem;
  }
}

@layer base {
  * {
    @apply border-border;
  }

  body {
    @apply bg-background text-foreground;
    font-feature-settings: "rlig" 1, "calt" 1;
  }
}

@layer utilities {
  .text-balance {
    text-wrap: balance;
  }
}`
            }
          ]
        }
      );

      // Nivel SIMPLE: ~8 archivos (package.json, .gitignore, README.md, tsconfig.json, layout.tsx, page.tsx, globals.css, next.config.js)
      if (complexity === 'simple') {
        baseStructure.push({
          name: 'next.config.js',
          type: 'file',
          path: 'next.config.js',
          content: generateNextConfigContent()
        });
      }

      // Nivel STANDARD: ~12-15 archivos (simple + tailwind, postcss, components básicos)
      else if (complexity === 'standard') {
        baseStructure.push(
          {
            name: 'next.config.js',
            type: 'file',
            path: 'next.config.js',
            content: generateNextConfigContent()
          },
          {
            name: 'tailwind.config.js',
            type: 'file',
            path: 'tailwind.config.js',
            content: generateTailwindConfigContent()
          },
          {
            name: 'postcss.config.js',
            type: 'file',
            path: 'postcss.config.js',
            content: generatePostcssConfigContent()
          },
          {
            name: 'components',
            type: 'directory',
            path: 'components',
            children: [
              {
                name: 'ui',
                type: 'directory',
                path: 'components/ui',
                children: [
                  {
                    name: 'button.tsx',
                    type: 'file',
                    path: 'components/ui/button.tsx',
                    content: generateButtonContent()
                  },
                  {
                    name: 'card.tsx',
                    type: 'file',
                    path: 'components/ui/card.tsx'
                  },
                  {
                    name: 'tooltip.tsx',
                    type: 'file',
                    path: 'components/ui/tooltip.tsx',
                    content: generateTooltipContent()
                  },
                  {
                    name: 'toaster.tsx',
                    type: 'file',
                    path: 'components/ui/toaster.tsx',
                    content: generateToasterContent()
                  },
                  {
                    name: 'toast.tsx',
                    type: 'file',
                    path: 'components/ui/toast.tsx',
                    content: generateToastContent()
                  },
                  {
                    name: 'slider.tsx',
                    type: 'file',
                    path: 'components/ui/slider.tsx',
                    content: generateSliderContent()
                  },
                  {
                    name: 'tabs.tsx',
                    type: 'file',
                    path: 'components/ui/tabs.tsx',
                    content: generateTabsContent()
                  },
                  {
                    name: 'toggle.tsx',
                    type: 'file',
                    path: 'components/ui/toggle.tsx',
                    content: generateToggleContent()
                  }
                ]
              },
              { name: 'theme-provider.tsx', type: 'file', path: 'components/theme-provider.tsx', content: generateThemeProviderContent() }, { name: 'Providers.tsx', type: 'file', path: 'components/Providers.tsx', content: generateProvidersContent() },
              {
                name: 'error-boundary.tsx',
                type: 'file',
                path: 'components/error-boundary.tsx',
                content: generateErrorBoundaryContent()
              },
              {
                name: 'Navbar.tsx',
                type: 'file',
                path: 'components/Navbar.tsx',
                content: generateNavbarContent(additionalPages)
              },


            ]
          },
          {
            name: 'context',
            type: 'directory',
            path: 'context',
            children: [
              {
                name: 'editor-context.tsx',
                type: 'file',
                path: 'context/editor-context.tsx',
                content: `import React, { createContext, useContext, useState } from 'react';

interface EditorContextType {
  // Add your editor context state and methods
  selectedTool: string;
  setSelectedTool: (tool: string) => void;
  // Add more context properties as needed
}

const EditorContext = createContext<EditorContextType | undefined>(undefined);

export function EditorProvider({ children }: { children: React.ReactNode }) {
  const [selectedTool, setSelectedTool] = useState('select');

  const value = {
    selectedTool,
    setSelectedTool,
  };

  return (
    <EditorContext.Provider value={value}>
      {children}
    </EditorContext.Provider>
  );
}

export function useEditor() {
  const context = useContext(EditorContext);
  if (context === undefined) {
    throw new Error('useEditor must be used within an EditorProvider');
  }
  return context;
}`
              },
              {
                name: 'file-context.tsx',
                type: 'file',
                path: 'context/file-context.tsx',
                content: `import React, { createContext, useContext, useState } from 'react';

interface FileContextType {
  files: File[];
  addFile: (file: File) => void;
  removeFile: (fileName: string) => void;
  // Add more file management methods as needed
}

const FileContext = createContext<FileContextType | undefined>(undefined);

export function FileProvider({ children }: { children: React.ReactNode }) {
  const [files, setFiles] = useState<File[]>([]);

  const addFile = (file: File) => {
    setFiles(prev => [...prev, file]);
  };

  const removeFile = (fileName: string) => {
    setFiles(prev => prev.filter(file => file.name !== fileName));
  };

  const value = {
    files,
    addFile,
    removeFile,
  };

  return (
    <FileContext.Provider value={value}>
      {children}
    </FileContext.Provider>
  );
}

export function useFile() {
  const context = useContext(FileContext);
  if (context === undefined) {
    throw new Error('useFile must be used within a FileProvider');
  }
  return context;
}`
              }
            ]
          },
          {
            name: 'hooks',
            type: 'directory',
            path: 'hooks',
            children: [
              {
                name: 'use-toast.ts',
                type: 'file',
                path: 'hooks/use-toast.ts',
                content: generateUseToastContent()
              }
            ]
          }
        );
      }

      // Nivel COMPLEX: ~20+ archivos (standard + lib, hooks, types, más componentes)
      else if (complexity === 'complex') {
        baseStructure.push(
          {
            name: 'next.config.js',
            type: 'file',
            path: 'next.config.js',
            content: generateNextConfigContent()
          },
          {
            name: 'tailwind.config.js',
            type: 'file',
            path: 'tailwind.config.js',
            content: generateTailwindConfigContent()
          },
          {
            name: 'postcss.config.js',
            type: 'file',
            path: 'postcss.config.js',
            content: generatePostcssConfigContent()
          },
          {
            name: 'components',
            type: 'directory',
            path: 'components',
            children: [
              {
                name: 'ui',
                type: 'directory',
                path: 'components/ui',
                children: [
                  {
                    name: 'button.tsx',
                    type: 'file',
                    path: 'components/ui/button.tsx',
                    content: generateButtonContent()
                  },
                  {
                    name: 'avatar.tsx',
                    type: 'file',
                    path: 'components/ui/avatar.tsx',
                    content: generateAvatarContent()
                  },
                  {
                    name: 'skeleton.tsx',
                    type: 'file',
                    path: 'components/ui/skeleton.tsx',
                    content: generateSkeletonContent()
                  },
                  {
                    name: 'label.tsx',
                    type: 'file',
                    path: 'components/ui/label.tsx',
                    content: generateLabelContent()
                  },
                  {
                    name: 'dropdown-menu.tsx',
                    type: 'file',
                    path: 'components/ui/dropdown-menu.tsx',
                    content: generateDropdownMenuContent()
                  },
                  {
                    name: 'input.tsx',
                    type: 'file',
                    path: 'components/ui/input.tsx',
                    content: `'use client';\n\nimport * as React from 'react';\nimport { cn } from '@/lib/utils';\n\nexport interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}\n\nconst Input = React.forwardRef<HTMLInputElement, InputProps>(\n  ({ className, type, ...props }, ref) => {\n    return (\n      <input\n        type={type}\n        className={cn(\n          'flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',\n          className\n        )}\n        ref={ref}\n        {...props}\n      />\n    );\n  }\n);\nInput.displayName = 'Input';\n\nexport { Input };\nexport default Input;\n`
                  },
                  {
                    name: 'modal.tsx',
                    type: 'file',
                    path: 'components/ui/modal.tsx'
                  },
                  {
                    name: 'tooltip.tsx',
                    type: 'file',
                    path: 'components/ui/tooltip.tsx',
                    content: generateTooltipContent()
                  },
                  {
                    name: 'toaster.tsx',
                    type: 'file',
                    path: 'components/ui/toaster.tsx',
                    content: generateToasterContent()
                  },
                  {
                    name: 'toast.tsx',
                    type: 'file',
                    path: 'components/ui/toast.tsx',
                    content: generateToastContent()
                  },
                  {
                    name: 'slider.tsx',
                    type: 'file',
                    path: 'components/ui/slider.tsx',
                    content: generateSliderContent()
                  },
                  {
                    name: 'tabs.tsx',
                    type: 'file',
                    path: 'components/ui/tabs.tsx',
                    content: generateTabsContent()
                  },
                  {
                    name: 'toggle.tsx',
                    type: 'file',
                    path: 'components/ui/toggle.tsx',
                    content: generateToggleContent()
                  }
                ]
              },
              {
                name: 'layout',
                type: 'directory',
                path: 'components/layout',
                children: [
                  {
                    name: 'header.tsx',
                    type: 'file',
                    path: 'components/layout/header.tsx'
                  },
                  {
                    name: 'footer.tsx',
                    type: 'file',
                    path: 'components/layout/footer.tsx',
                    content: generateFooterContent()
                  },
                  {
                    name: 'sidebar.tsx',
                    type: 'file',
                    path: 'components/layout/sidebar.tsx'
                  }
                ]
              },
              {
                name: 'theme-provider.tsx',
                type: 'file',
                path: 'components/theme-provider.tsx',
                content: generateThemeProviderContent()
              },
              {
                name: 'error-boundary.tsx',
                type: 'file',
                path: 'components/error-boundary.tsx',
                content: generateErrorBoundaryContent()
              },
              {
                name: 'Navbar.tsx',
                type: 'file',
                path: 'components/Navbar.tsx',
                content: generateNavbarContent(additionalPages)
              },
              {
                name: 'Providers.tsx',
                type: 'file',
                path: 'components/Providers.tsx',
                content: generateProvidersContent()
              }
            ]
          },
          {
            name: 'context',
            type: 'directory',
            path: 'context',
            children: [
              {
                name: 'drawing-context.tsx',
                type: 'file',
                path: 'context/drawing-context.tsx',
                content: generateDrawingContextContent()
              },
              {
                name: 'editor-context.tsx',
                type: 'file',
                path: 'context/editor-context.tsx',
                content: `import React, { createContext, useContext, useState } from 'react';

interface EditorContextType {
  // Editor state
  selectedTool: string;
  zoomLevel: number;
  isDragging: boolean;
  
  // Editor actions
  setSelectedTool: (tool: string) => void;
  setZoomLevel: (level: number) => void;
  setIsDragging: (dragging: boolean) => void;
}

const EditorContext = createContext<EditorContextType | undefined>(undefined);

export function EditorProvider({ children }: { children: React.ReactNode }) {
  const [selectedTool, setSelectedTool] = useState('select');
  const [zoomLevel, setZoomLevel] = useState(1);
  const [isDragging, setIsDragging] = useState(false);

  const value = {
    selectedTool,
    zoomLevel,
    isDragging,
    setSelectedTool,
    setZoomLevel,
    setIsDragging
  };

  return (
    <EditorContext.Provider value={value}>
      {children}
    </EditorContext.Provider>
  );
}

export function useEditor() {
  const context = useContext(EditorContext);
  if (context === undefined) {
    throw new Error('useEditor must be used within an EditorProvider');
  }
  return context;
}`
              },
              {
                name: 'file-context.tsx',
                type: 'file',
                path: 'context/file-context.tsx',
                content: `import React, { createContext, useContext, useState } from 'react';

interface FileContextType {
  files: File[];
  addFile: (file: File) => void;
  removeFile: (fileName: string) => void;
  // Add more file management methods as needed
}

const FileContext = createContext<FileContextType | undefined>(undefined);

export function FileProvider({ children }: { children: React.ReactNode }) {
  const [files, setFiles] = useState<File[]>([]);

  const addFile = (file: File) => {
    setFiles(prev => [...prev, file]);
  };

  const removeFile = (fileName: string) => {
    setFiles(prev => prev.filter(file => file.name !== fileName));
  };

  const value = {
    files,
    addFile,
    removeFile,
  };

  return (
    <FileContext.Provider value={value}>
      {children}
    </FileContext.Provider>
  );
}

export function useFile() {
  const context = useContext(FileContext);
  if (context === undefined) {
    throw new Error('useFile must be used within a FileProvider');
  }
  return context;
}`
              }
            ]
          },
          {
            name: 'lib',
            type: 'directory',
            path: 'lib',
            children: [
              {
                name: 'utils.ts',
                type: 'file',
                path: 'lib/utils.ts',
                content: `import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}`
              },
              {
                name: 'pocketbase.ts',
                type: 'file',
                path: 'lib/pocketbase.ts',
                content: `import PocketBase from 'pocketbase';

/** URL de PocketBase. En otra app: .env con NEXT_PUBLIC_POCKETBASE_URL */
export function getPocketBaseUrl(): string {
  return process.env.NEXT_PUBLIC_POCKETBASE_URL ?? 'http://127.0.0.1:8090';
}

const pb = new PocketBase(getPocketBaseUrl());

/** Opciones por defecto para la cookie de sesión (reutilizable) */
export const authCookieOptions = {
  httpOnly: false,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'Lax' as const,
  path: '/',
  maxAge: 30 * 24 * 60 * 60, // 30 días
};

export default pb;`
              },
              {
                name: 'store.ts',
                type: 'file',
                path: 'lib/store.ts',
                content: `import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import pb from '@/lib/pocketbase';

// Define the auth state interface
interface AuthState {
  user: any | null;
  isLoading: boolean;
  init: () => void;
  setUser: (user: any | null) => void;
  setIsLoading: (isLoading: boolean) => void;
  logout: () => void;
}

// Create the main store
export const useStore = create<AuthState>()(
  devtools(
    persist(
      (set) => ({
        user: null,
        isLoading: true,
        init: () => {
          if (pb.authStore.isValid) {
            set({ user: pb.authStore.model, isLoading: false });
          } else {
            set({ user: null, isLoading: false });
          }
        },
        setUser: (user) => set({ user, isLoading: false }),
        setIsLoading: (isLoading) => set({ isLoading }),
        logout: () => {
          pb.authStore.clear();
          set({ user: null });
        },
      }),
      {
        name: 'main-store',
      }
    )
  )
);`

              },
              {
                name: 'constants.ts',
                type: 'file',
                path: 'lib/constants.ts'
              },
              {
                name: 'validations.ts',
                type: 'file',
                path: 'lib/validations.ts'
              },
              {
                name: 'store',
                type: 'directory',
                path: 'lib/store',
                children: [
                  {
                    name: 'image-editor-store.ts',
                    type: 'file',
                    path: 'lib/store/image-editor-store.ts',
                    content: generateImageEditorStoreContent()
                  }
                ]
              }
            ]
          },
          {
            name: 'hooks',
            type: 'directory',
            path: 'hooks',
            children: [
              {
                name: 'use-local-storage.ts',
                type: 'file',
                path: 'hooks/use-local-storage.ts'
              },
              {
                name: 'use-debounce.ts',
                type: 'file',
                path: 'hooks/use-debounce.ts'
              },
              {
                name: 'use-toast.ts',
                type: 'file',
                path: 'hooks/use-toast.ts',
                content: generateUseToastContent()
              }
            ]
          },
          {
            name: 'types',
            type: 'directory',
            path: 'types',
            children: [
              {
                name: 'index.ts',
                type: 'file',
                path: 'types/index.ts'
              }
            ]
          }
        );
      }
      break;

    case 'vite-react':
      // Archivos esenciales para Vite-React (todos los niveles)
      baseStructure.push(
        {
          name: 'index.html',
          type: 'file',
          path: 'index.html',
          content: generateIndexHtmlContent(appName)
        },
        {
          name: 'src',
          type: 'directory',
          path: 'src',
          children: [
            {
              name: 'App.tsx',
              type: 'file',
              path: 'src/App.tsx'
            },
            {
              name: 'main.tsx',
              type: 'file',
              path: 'src/main.tsx'
            },
            {
              name: 'App.css',
              type: 'file',
              path: 'src/App.css'
            }
          ]
        }
      );

      // Archivos de configuración esenciales para todos los niveles
      baseStructure.push(
        {
          name: 'vite.config.ts',
          type: 'file',
          path: 'vite.config.ts',
          content: generateViteConfigContent()
        },
        {
          name: 'tsconfig.json',
          type: 'file',
          path: 'tsconfig.json',
          content: generateTsconfigContent('vite')
        },
        {
          name: 'public',
          type: 'directory',
          path: 'public',
          children: [
            {
              name: 'vite.svg',
              type: 'file',
              path: 'public/vite.svg',
              content: generateViteSvgContent()
            }
          ]
        }
      );

      // Nivel SIMPLE: ~8 archivos (package.json, .gitignore, README.md, index.html, App.tsx, main.tsx, App.css, vite.config.ts, tsconfig.json)
      if (complexity === 'simple') {
        // Agregar index.css básico
        const srcDir = baseStructure.find(item => item.path === 'src');
        if (srcDir && srcDir.children) {
          srcDir.children.push({
            name: 'index.css',
            type: 'file',
            path: 'src/index.css',
            content: generateIndexCssContent()
          });
        }
      }

      // Nivel STANDARD: ~12-15 archivos (simple + tailwind, postcss, componentes básicos)
      else if (complexity === 'standard') {
        baseStructure.push(
          {
            name: 'tailwind.config.js',
            type: 'file',
            path: 'tailwind.config.js',
            content: generateViteTailwindConfigContent()
          },
          {
            name: 'postcss.config.js',
            type: 'file',
            path: 'postcss.config.js',
            content: generatePostcssConfigContent()
          },
          {
            name: 'tsconfig.node.json',
            type: 'file',
            path: 'tsconfig.node.json',
            content: generateTsconfigNodeContent()
          }
        );

        // Agregar archivos CSS adicionales
        const srcDir = baseStructure.find(item => item.path === 'src');
        if (srcDir && srcDir.children) {
          srcDir.children.push(
            {
              name: 'index.css',
              type: 'file',
              path: 'src/index.css'
            },
            {
              name: 'components',
              type: 'directory',
              path: 'src/components',
              children: [
                {
                  name: 'Button.tsx',
                  type: 'file',
                  path: 'src/components/Button.tsx',
                  content: generateButtonContent()
                }
              ]
            }
          );
        }
      }

      // Nivel COMPLEX: ~18+ archivos (standard + hooks, utils, types, más componentes)
      else if (complexity === 'complex') {
        baseStructure.push(
          {
            name: 'vite.config.ts',
            type: 'file',
            path: 'vite.config.ts',
            content: generateViteConfigContent()
          },
          {
            name: 'tsconfig.json',
            type: 'file',
            path: 'tsconfig.json',
            content: generateTsconfigContent('vite')
          },
          {
            name: 'public',
            type: 'directory',
            path: 'public',
            children: [
              {
                name: 'vite.svg',
                type: 'file',
                path: 'public/vite.svg'
              },
              {
                name: 'favicon.ico',
                type: 'file',
                path: 'public/favicon.ico'
              }
            ]
          }
        );

        // Agregar estructura completa al src
        const srcDir = baseStructure.find(item => item.path === 'src');
        if (srcDir && srcDir.children) {
          srcDir.children.push(
            {
              name: 'index.css',
              type: 'file',
              path: 'src/index.css'
            },
            {
              name: 'components',
              type: 'directory',
              path: 'src/components',
              children: [
                {
                  name: 'ui',
                  type: 'directory',
                  path: 'src/components/ui',
                  children: [
                    {
                      name: 'floating-chat-button.tsx',
                      type: 'file',
                      path: 'src/components/ui/floating-chat-button.tsx',
                      content: generateFloatingChatButtonContent()
                    },
                    {
                      name: 'Button.tsx',
                      type: 'file',
                      path: 'src/components/ui/Button.tsx',
                      content: generateButtonContent()
                    },
                    {
                      name: 'Card.tsx',
                      type: 'file',
                      path: 'src/components/ui/Card.tsx'
                    },
                    {
                      name: 'Input.tsx',
                      type: 'file',
                      path: 'src/components/ui/Input.tsx'
                    }
                  ]
                },
                {
                  name: 'layout',
                  type: 'directory',
                  path: 'src/components/layout',
                  children: [
                    {
                      name: 'Header.tsx',
                      type: 'file',
                      path: 'src/components/layout/Header.tsx'
                    },
                    {
                      name: 'Footer.tsx',
                      type: 'file',
                      path: 'src/components/layout/Footer.tsx'
                    }
                  ]
                }
              ]
            },
            {
              name: 'hooks',
              type: 'directory',
              path: 'src/hooks',
              children: [
                {
                  name: 'useLocalStorage.ts',
                  type: 'file',
                  path: 'src/hooks/useLocalStorage.ts'
                },
                {
                  name: 'useDebounce.ts',
                  type: 'file',
                  path: 'src/hooks/useDebounce.ts'
                }
              ]
            },
            {
              name: 'utils',
              type: 'directory',
              path: 'src/utils',
              children: [
                {
                  name: 'helpers.ts',
                  type: 'file',
                  path: 'src/utils/helpers.ts'
                },
                {
                  name: 'constants.ts',
                  type: 'file',
                  path: 'src/utils/constants.ts'
                }
              ]
            },
            {
              name: 'types',
              type: 'directory',
              path: 'src/types',
              children: [
                {
                  name: 'index.ts',
                  type: 'file',
                  path: 'src/types/index.ts'
                }
              ]
            }
          );
        }
      }
      break;

    case 'vue-nuxt':
      // Archivos esenciales para Vue-Nuxt (todos los niveles)
      baseStructure.push(
        {
          name: 'app.vue',
          type: 'file',
          path: 'app.vue'
        },
        {
          name: 'pages',
          type: 'directory',
          path: 'pages',
          children: [
            {
              name: 'index.vue',
              type: 'file',
              path: 'pages/index.vue'
            }
          ]
        }
      );

      // Nivel SIMPLE: ~8 archivos (package.json, .gitignore, README.md, app.vue, index.vue, nuxt.config.ts, tsconfig.json, default.vue)
      if (complexity === 'simple') {
        baseStructure.push(
          {
            name: 'nuxt.config.ts',
            type: 'file',
            path: 'nuxt.config.ts',
            content: generateNuxtConfigContent()
          },
          {
            name: 'tsconfig.json',
            type: 'file',
            path: 'tsconfig.json',
            content: generateTsconfigContent('nuxt')
          },
          {
            name: 'layouts',
            type: 'directory',
            path: 'layouts',
            children: [
              {
                name: 'default.vue',
                type: 'file',
                path: 'layouts/default.vue'
              }
            ]
          }
        );
      }

      // Nivel STANDARD: ~12-15 archivos (simple + componentes básicos, assets)
      else if (complexity === 'standard') {
        baseStructure.push(
          {
            name: 'nuxt.config.ts',
            type: 'file',
            path: 'nuxt.config.ts',
            content: generateNuxtConfigContent()
          },
          {
            name: 'tsconfig.json',
            type: 'file',
            path: 'tsconfig.json',
            content: generateTsconfigContent('nuxt')
          },
          {
            name: 'layouts',
            type: 'directory',
            path: 'layouts',
            children: [
              {
                name: 'default.vue',
                type: 'file',
                path: 'layouts/default.vue'
              }
            ]
          },
          {
            name: 'components',
            type: 'directory',
            path: 'components',
            children: [
              {
                name: 'AppButton.vue',
                type: 'file',
                path: 'components/AppButton.vue'
              },
              {
                name: 'AppCard.vue',
                type: 'file',
                path: 'components/AppCard.vue'
              }
            ]
          },
          {
            name: 'assets',
            type: 'directory',
            path: 'assets',
            children: [
              {
                name: 'css',
                type: 'directory',
                path: 'assets/css',
                children: [
                  {
                    name: 'main.css',
                    type: 'file',
                    path: 'assets/css/main.css'
                  }
                ]
              }
            ]
          }
        );
      }

      // Nivel COMPLEX: ~20+ archivos (standard + plugins, middleware, composables, utils)
      else if (complexity === 'complex') {
        baseStructure.push(
          {
            name: 'nuxt.config.ts',
            type: 'file',
            path: 'nuxt.config.ts',
            content: generateNuxtConfigContent()
          },
          {
            name: 'tsconfig.json',
            type: 'file',
            path: 'tsconfig.json',
            content: generateTsconfigContent('nuxt')
          },
          {
            name: 'layouts',
            type: 'directory',
            path: 'layouts',
            children: [
              {
                name: 'default.vue',
                type: 'file',
                path: 'layouts/default.vue'
              },
              {
                name: 'admin.vue',
                type: 'file',
                path: 'layouts/admin.vue'
              }
            ]
          },
          {
            name: 'components',
            type: 'directory',
            path: 'components',
            children: [
              {
                name: 'ui',
                type: 'directory',
                path: 'components/ui',
                children: [
                  {
                    name: 'AppButton.vue',
                    type: 'file',
                    path: 'components/ui/AppButton.vue'
                  },
                  {
                    name: 'AppCard.vue',
                    type: 'file',
                    path: 'components/ui/AppCard.vue'
                  },
                  {
                    name: 'AppInput.vue',
                    type: 'file',
                    path: 'components/ui/AppInput.vue'
                  },
                  {
                    name: 'AppModal.vue',
                    type: 'file',
                    path: 'components/ui/AppModal.vue'
                  }
                ]
              },
              {
                name: 'layout',
                type: 'directory',
                path: 'components/layout',
                children: [
                  {
                    name: 'AppHeader.vue',
                    type: 'file',
                    path: 'components/layout/AppHeader.vue'
                  },
                  {
                    name: 'AppFooter.vue',
                    type: 'file',
                    path: 'components/layout/AppFooter.vue'
                  },
                  {
                    name: 'AppSidebar.vue',
                    type: 'file',
                    path: 'components/layout/AppSidebar.vue'
                  }
                ]
              }
            ]
          },
          {
            name: 'composables',
            type: 'directory',
            path: 'composables',
            children: [
              {
                name: 'useAuth.ts',
                type: 'file',
                path: 'composables/useAuth.ts'
              },
              {
                name: 'useApi.ts',
                type: 'file',
                path: 'composables/useApi.ts'
              }
            ]
          },
          {
            name: 'plugins',
            type: 'directory',
            path: 'plugins',
            children: [
              {
                name: 'api.client.ts',
                type: 'file',
                path: 'plugins/api.client.ts'
              }
            ]
          },
          {
            name: 'middleware',
            type: 'directory',
            path: 'middleware',
            children: [
              {
                name: 'auth.ts',
                type: 'file',
                path: 'middleware/auth.ts'
              }
            ]
          },
          {
            name: 'utils',
            type: 'directory',
            path: 'utils',
            children: [
              {
                name: 'helpers.ts',
                type: 'file',
                path: 'utils/helpers.ts'
              },
              {
                name: 'constants.ts',
                type: 'file',
                path: 'utils/constants.ts'
              }
            ]
          },
          {
            name: 'assets',
            type: 'directory',
            path: 'assets',
            children: [
              {
                name: 'css',
                type: 'directory',
                path: 'assets/css',
                children: [
                  {
                    name: 'main.css',
                    type: 'file',
                    path: 'assets/css/main.css'
                  },
                  {
                    name: 'components.css',
                    type: 'file',
                    path: 'assets/css/components.css'
                  }
                ]
              },
              {
                name: 'images',
                type: 'directory',
                path: 'assets/images',
                children: []
              }
            ]
          },
          {
            name: 'types',
            type: 'directory',
            path: 'types',
            children: [
              {
                name: 'index.ts',
                type: 'file',
                path: 'types/index.ts'
              }
            ]
          }
        );
      }
      break;

    case 'svelte-kit':
      baseStructure.push(
        {
          name: 'svelte.config.js',
          type: 'file',
          path: 'svelte.config.js',
          content: generateSvelteConfigContent()
        },
        {
          name: 'vite.config.js',
          type: 'file',
          path: 'vite.config.js',
          content: generateSvelteViteConfigContent()
        },
        {
          name: 'tsconfig.json',
          type: 'file',
          path: 'tsconfig.json',
          content: generateTsconfigContent('svelte')
        },
        {
          name: 'src',
          type: 'directory',
          path: 'src',
          children: [
            {
              name: 'app.html',
              type: 'file',
              path: 'src/app.html'
            },
            {
              name: 'routes',
              type: 'directory',
              path: 'src/routes',
              children: [
                {
                  name: '+layout.svelte',
                  type: 'file',
                  path: 'src/routes/+layout.svelte'
                },
                {
                  name: '+page.svelte',
                  type: 'file',
                  path: 'src/routes/+page.svelte'
                }
              ]
            },
            {
              name: 'lib',
              type: 'directory',
              path: 'src/lib',
              children: []
            }
          ]
        },
        {
          name: 'static',
          type: 'directory',
          path: 'static',
          children: []
        }
      );
      break;

    case 'angular':
      baseStructure.push(
        {
          name: 'angular.json',
          type: 'file',
          path: 'angular.json',
          content: generateAngularJsonContent(appName)
        },
        {
          name: 'tsconfig.json',
          type: 'file',
          path: 'tsconfig.json',
          content: generateTsconfigContent('angular')
        },
        {
          name: 'tsconfig.app.json',
          type: 'file',
          path: 'tsconfig.app.json',
          content: generateAngularAppTsconfigContent()
        },
        {
          name: 'src',
          type: 'directory',
          path: 'src',
          children: [
            {
              name: 'main.ts',
              type: 'file',
              path: 'src/main.ts'
            },
            {
              name: 'index.html',
              type: 'file',
              path: 'src/index.html'
            },
            {
              name: 'styles.css',
              type: 'file',
              path: 'src/styles.css'
            },
            {
              name: 'app',
              type: 'directory',
              path: 'src/app',
              children: [
                {
                  name: 'app.component.ts',
                  type: 'file',
                  path: 'src/app/app.component.ts'
                },
                {
                  name: 'app.component.html',
                  type: 'file',
                  path: 'src/app/app.component.html'
                },
                {
                  name: 'app.component.css',
                  type: 'file',
                  path: 'src/app/app.component.css'
                },
                {
                  name: 'app.module.ts',
                  type: 'file',
                  path: 'src/app/app.module.ts'
                }
              ]
            }
          ]
        }
      );
      break;

    case 'fastapi-py':
      baseStructure.push(
        {
          name: 'requirements.txt',
          type: 'file',
          path: 'requirements.txt',
          content: generateRequirementsContent()
        },
        {
          name: 'main.py',
          type: 'file',
          path: 'main.py'
        },
        {
          name: 'app',
          type: 'directory',
          path: 'app',
          children: [
            {
              name: '__init__.py',
              type: 'file',
              path: 'app/__init__.py'
            },
            {
              name: 'api',
              type: 'directory',
              path: 'app/api',
              children: [
                {
                  name: '__init__.py',
                  type: 'file',
                  path: 'app/api/__init__.py'
                },
                {
                  name: 'routes.py',
                  type: 'file',
                  path: 'app/api/routes.py'
                }
              ]
            },
            {
              name: 'models',
              type: 'directory',
              path: 'app/models',
              children: [
                {
                  name: '__init__.py',
                  type: 'file',
                  path: 'app/models/__init__.py'
                }
              ]
            }
          ]
        }
      );
      break;
  }

  // Función auxiliar para contar archivos recursivamente
  function countFiles(structure: FileStructure[]): { files: number, directories: number } {
    let files = 0;
    let directories = 0;

    structure.forEach(item => {
      if (item.type === 'file') {
        files++;
      } else if (item.type === 'directory') {
        directories++;
        if (item.children) {
          const childCounts = countFiles(item.children);
          files += childCounts.files;
          directories += childCounts.directories;
        }
      }
    });

    return { files, directories };
  }

  const counts = countFiles(baseStructure);

  // Log detallado de archivos generados según complejidad
  console.log(`📦 Estructura generada para ${template}:`);
  console.log(`   🎯 Complejidad: ${complexity.toUpperCase()}`);
  console.log(`   📄 Archivos: ${counts.files}`);
  console.log(`   📁 Directorios: ${counts.directories}`);
  console.log(`   📊 Total elementos: ${baseStructure.length}`);

  // Validación de complejidad
  const expectedFiles = {
    'simple': { min: 6, max: 10 },
    'standard': { min: 10, max: 16 },
    'complex': { min: 16, max: 30 }
  };

  const expected = expectedFiles[complexity as keyof typeof expectedFiles];
  if (expected && (counts.files < expected.min || counts.files > expected.max)) {
    console.warn(`⚠️  Advertencia: Archivos generados (${counts.files}) fuera del rango esperado para ${complexity} (${expected.min}-${expected.max})`);
  } else {
    console.log(`✅ Estructura optimizada correctamente`);
  }

  return baseStructure;
}

// Funciones para generar contenido de archivos de configuración
function generateGitignoreContent(template: string): string {
  const common = `
# Dependencies
node_modules/
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Runtime data
pids
*.pid
*.seed
*.pid.lock

# Coverage directory used by tools like istanbul
coverage/

# nyc test coverage
.nyc_output

# Grunt intermediate storage
.grunt

# Bower dependency directory
bower_components

# node-waf configuration
.lock-wscript

# Compiled binary addons
build/Release

# Dependency directories
node_modules/
jspm_packages/

# Optional npm cache directory
.npm

# Optional REPL history
.node_repl_history

# Output of 'npm pack'
*.tgz

# Yarn Integrity file
.yarn-integrity

# dotenv environment variables file
.env
.env.local
.env.development.local
.env.test.local
.env.production.local

# IDE
.vscode/
.idea/
*.swp
*.swo
*~

# OS
.DS_Store
.DS_Store?
._*
.Spotlight-V100
.Trashes
ehthumbs.db
Thumbs.db
`;

  switch (template) {
    case 'next-js':
      return common + `
# Next.js
.next/
out/

# Production
build/
dist/

# Vercel
.vercel
`;
    case 'vite-react':
      return common + `
# Vite
dist/
dist-ssr/
*.local

# Editor directories and files
.vscode/*
!.vscode/extensions.json
.idea
*.suo
*.ntvs*
*.njsproj
*.sln
*.sw?
`;
    case 'vue-nuxt':
      return common + `
# Nuxt.js
.nuxt
dist

# Nuxt generate
dist

# Vite
.vite
`;
    case 'svelte-kit':
      return common + `
# SvelteKit
.svelte-kit
build

# Vite
vite.config.js.timestamp-*
vite.config.ts.timestamp-*
`;
    case 'angular':
      return common + `
# Angular
dist/
tmp/
out-tsc/
bazel-out

# Angular CLI
.angular/
`;
    case 'fastapi-py':
      return `
# Python
__pycache__/
*.py[cod]
*$py.class
*.so
.Python
build/
develop-eggs/
dist/
downloads/
eggs/
.eggs/
lib/
lib64/
parts/
sdist/
var/
wheels/
*.egg-info/
.installed.cfg
*.egg
PIPFILE.lock

# PyEnv
.python-version

# Environments
.env
.venv
env/
venv/
ENV/
env.bak/
venv.bak/

# IDE
.vscode/
.idea/
*.swp
*.swo
*~

# OS
.DS_Store
.DS_Store?
._*
.Spotlight-V100
.Trashes
ehthumbs.db
Thumbs.db
`;
    default:
      return common;
  }
}

function generateReadmeContent(appName: string, template: string): string {
  return `# ${appName}

A ${template} application generated with ZEUS.

## Getting Started

### Prerequisites

- Node.js (version 18 or higher)
- npm or yarn

### Installation

1. Install dependencies:
\`\`\`bash
npm install
\`\`\`

2. Start the development server:
\`\`\`bash
npm run dev
\`\`\`

3. Open your browser and navigate to the local development URL.

## Available Scripts

- \`npm run dev\` - Start the development server
- \`npm run build\` - Build the application for production
- \`npm run start\` - Start the production server (if applicable)
- \`npm run lint\` - Run the linter

## Project Structure

This project follows the standard ${template} structure and conventions.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License.
`;
}

function generateNextConfigContent(): string {
  return `const pkg = require('./package.json');

/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {},
  env: {
    NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME || pkg.name,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'zeus-basedatos.fly.dev',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
        port: '',
        pathname: '/**',
      },
    ],
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.optimization.splitChunks = {
        ...config.optimization.splitChunks,
        chunks: 'all',
        maxInitialRequests: Infinity,
        minSize: 0,
        cacheGroups: {
          default: false,
          vendors: false,
          framework: {
            name: 'framework',
            chunks: 'all',
            test: /next|react|react-dom/,
            priority: 40,
            enforce: true,
          },
          lib: {
            test: /[/]node_modules[/]/,
            name: 'lib',
            priority: 30,
            minChunks: 1,
            reuseExistingChunk: true,
          },
          commons: {
            name: 'commons',
            chunks: 'all',
            priority: 20,
          },
          shared: {
            name(module, chunks) {
              return chunks.map((chunk) => chunk.name).join('-');
            },
            priority: 10,
            minChunks: 2,
            reuseExistingChunk: true,
          },
        },
      };
    }
    return config;
  },
};

module.exports = nextConfig;
`;
}

function generateTailwindConfigContent(): string {
  return `/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './FloatingChat/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'gradient-conic':
          'conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))',
      },
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      keyframes: {
        'accordion-down': {
          from: { height: 0 },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: 0 },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
    },
  },
  plugins: [],
}
`;
}

function generatePostcssConfigContent(): string {
  return `module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
    cssnano: {
      preset: 'default',
    },
  },
}
`;
}

function generateViteConfigContent(): string {
  return `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    open: true
  },
  build: {
    outDir: 'dist',
    sourcemap: true
  }
})
`;
}

function generateFloatingChatButtonContent(): string {
  return `'use client';

import { Button } from '@/components/ui/button';
import { useState, useEffect, useRef, ReactNode } from 'react';

interface FloatingChatButtonProps {
  onClick?: () => void;
  children: ReactNode;
}

export function FloatingChatButton({ onClick, children }: FloatingChatButtonProps) {
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const buttonRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const updatePosition = () => {
      if (buttonRef.current) {
        const buttonWidth = buttonRef.current.offsetWidth;
        const buttonHeight = buttonRef.current.offsetHeight;
        // Position above the original FloatingButton (database button)
        const initialX = window.innerWidth - buttonWidth - 20;
        const initialY = window.innerHeight - buttonHeight - 90; // 20 (bottom margin) + 56 (button height) + 14 (some spacing)
        setPosition({ x: initialX, y: initialY });
      }
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);

    return () => {
      window.removeEventListener('resize', updatePosition);
    };
  }, []);

  const buttonClass = 'h-14 w-14 rounded-full shadow-lg transition-all hover:shadow-xl bg-transparent border-2 border-white text-white flex items-center justify-center';

  return (
    <div
      ref={buttonRef}
      className="fixed z-50" // z-index 50 to be above other content, but below iframe overlays
      style={{ left: position.x, top: position.y }}
    >
      <Button
        className={buttonClass}
        size="icon"
        variant="default"
        onClick={onClick}
      >
        {children}
      </Button>
    </div>
  );
}
`;
}



function generateNuxtConfigContent(): string {
  return `// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  devtools: { enabled: true },
  css: ['~/assets/css/main.css'],
  modules: [
    '@nuxtjs/tailwindcss'
  ]
})
`;
}

function generateSvelteConfigContent(): string {
  return `import adapter from '@sveltejs/adapter-auto';
import { vitePreprocess } from '@sveltejs/kit/vite';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: adapter()
	},
	preprocess: vitePreprocess()
};

export default config;
`;
}

function generateSvelteViteConfigContent(): string {
  return `import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()]
});
`;
}

function generateAngularJsonContent(appName: string): string {
  return `{
  "$schema": "./node_modules/@angular/cli/lib/config/schema.json",
  "version": 1,
  "newProjectRoot": "projects",
  "projects": {
    "${appName}": {
      "projectType": "application",
      "schematics": {},
      "root": "",
      "sourceRoot": "src",
      "prefix": "app",
      "architect": {
        "build": {
          "builder": "@angular-devkit/build-angular:browser",
          "options": {
            "outputPath": "dist/${appName}",
            "index": "src/index.html",
            "main": "src/main.ts",
            "polyfills": [],
            "tsConfig": "tsconfig.app.json",
            "assets": [
              "src/favicon.ico",
              "src/assets"
            ],
            "styles": [
              "src/styles.css"
            ],
            "scripts": []
          }
        },
        "serve": {
          "builder": "@angular-devkit/build-angular:dev-server",
          "options": {}
        }
      }
    }
  }
}
`;
}

function generateAvatarContent(): string {
  return `'use client';

import * as React from "react"
import * as AvatarPrimitive from "@radix-ui/react-avatar"

import { cn } from "@/lib/utils"

const Avatar = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Root
    ref={ref}
    className={cn(
      "relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full",
      className
    )}
    {...props}
  />
))
Avatar.displayName = AvatarPrimitive.Root.displayName

const AvatarImage = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Image>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Image>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Image
    ref={ref}
    className={cn("aspect-square h-full w-full", className)}
    {...props}
  />
))
AvatarImage.displayName = AvatarPrimitive.Image.displayName

const AvatarFallback = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Fallback>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Fallback>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Fallback
    ref={ref}
    className={cn(
      "flex h-full w-full items-center justify-center rounded-full bg-gray-800",
      className
    )}
    {...props}
  />
))
AvatarFallback.displayName = AvatarPrimitive.Fallback.displayName

export { Avatar, AvatarImage, AvatarFallback }
`;
}

function generateSkeletonContent(): string {
  return `'use client';

import { cn } from "@/lib/utils"

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-gray-700", className)}
      {...props}
    />
  )
}

export { Skeleton }
`;
}

function generateTsconfigContent(framework: string): string {
  switch (framework) {
    case 'next':
      return `{
  "compilerOptions": {
    "target": "es2015",
    "lib": ["dom", "dom.iterable", "es6"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [
      {
        "name": "next"
      }
    ],
    "paths": {
      "@/*": ["./*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
`;
    case 'vite':
      return `{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
`;
    case 'angular':
      return `{
  "compileOnSave": false,
  "compilerOptions": {
    "baseUrl": "./",
    "outDir": "./dist/out-tsc",
    "forceConsistentCasingInFileNames": true,
    "strict": true,
    "noImplicitOverride": true,
    "noPropertyAccessFromIndexSignature": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "sourceMap": true,
    "declaration": false,
    "downlevelIteration": true,
    "experimentalDecorators": true,
    "moduleResolution": "node",
    "importHelpers": true,
    "target": "ES2022",
    "module": "ES2022",
    "useDefineForClassFields": false,
    "lib": [
      "ES2022",
      "dom"
    ]
  },
  "angularCompilerOptions": {
    "enableI18nLegacyMessageIdFormat": false,
    "strictInjectionParameters": true,
    "strictInputAccessModifiers": true,
    "strictTemplates": true
  }
}
`;
    default:
      return `{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "module": "ESNext",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  }
}
`;
  }
}

function generateAngularAppTsconfigContent(): string {
  return `{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "./out-tsc/app",
    "types": []
  },
  "files": [
    "src/main.ts"
  ],
  "include": [
    "src/**/*.d.ts"
  ]
}
`;
}

function generateIndexHtmlContent(appName: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/vite.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${appName}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`;
}

function generateRequirementsContent(): string {
  return `fastapi==0.104.1
uvicorn[standard]==0.24.0
pydantic==2.5.0
python-multipart==0.0.6
`;
}

// Funciones para generar contenido de componentes UI
function generateTooltipContent(): string {
  return `'use client';

import * as React from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';

import { cn } from '@/lib/utils';

const TooltipProvider = TooltipPrimitive.Provider;

const Tooltip = TooltipPrimitive.Root;

const TooltipTrigger = TooltipPrimitive.Trigger;

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <TooltipPrimitive.Content
    ref={ref}
    sideOffset={sideOffset}
    className={cn(
      'z-50 overflow-hidden rounded-md border bg-popover px-3 py-1.5 text-sm text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
      className
    )}
    {...props}
  />
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
`;
}

function generateToasterContent(): string {
  return `'use client';

import { useToast } from '@/hooks/use-toast';
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from '@/components/ui/toast';

interface ToasterProps {}

export function Toaster({}: ToasterProps) {
  const { toasts } = useToast();

  return (
    <ToastProvider>
      {toasts.map((toast) => {
        const { id, title, description, action, ...props } = toast;
        return (
          <Toast key={id} {...props}>
            <div className={"grid gap-1"}>
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && (
                <ToastDescription>{description}</ToastDescription>
              )}
            </div>
            {action}
            <ToastClose />
          </Toast>
        );
      })}
      <ToastViewport />
    </ToastProvider>
  );
}
`;
}

function generateUseToastContent(): string {
  return `'use client'

import * as React from "react"
import type { ToastActionElement, ToastProps } from "@/components/ui/toast"

const TOAST_LIMIT = 1
const TOAST_REMOVE_DELAY = 1000000

type ToasterToast = ToastProps & {
  id: string
  title?: React.ReactNode
  description?: React.ReactNode
  action?: ToastActionElement
}

const actionTypes = {
  ADD_TOAST: "ADD_TOAST",
  UPDATE_TOAST: "UPDATE_TOAST",
  DISMISS_TOAST: "DISMISS_TOAST",
  REMOVE_TOAST: "REMOVE_TOAST",
} as const

let count = 0

function genId() {
  count = (count + 1) % 100
  return count.toString()
}

type ActionType = typeof actionTypes

type Action =
  | {
      type: ActionType["ADD_TOAST"]
      toast: ToasterToast
    }
  | {
      type: ActionType["UPDATE_TOAST"]
      toast: Partial<ToasterToast>
    }
  | {
      type: ActionType["DISMISS_TOAST"]
      toastId?: ToasterToast["id"]
    }
  | {
      type: ActionType["REMOVE_TOAST"]
      toastId?: ToasterToast["id"]
    }

interface State {
  toasts: ToasterToast[]
}

const toastTimeouts = new Map<string, ReturnType<typeof setTimeout>>()

const addToRemoveQueue = (toastId: string) => {
  if (toastTimeouts.has(toastId)) {
    return
  }

  const timeout = setTimeout(() => {
    toastTimeouts.delete(toastId)
    dispatch({
      type: "REMOVE_TOAST",
      toastId: toastId,
    })
  }, TOAST_REMOVE_DELAY)

  toastTimeouts.set(toastId, timeout)
}

export const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    case "ADD_TOAST":
      return {
        ...state,
        toasts: [action.toast, ...state.toasts].slice(0, TOAST_LIMIT),
      }

    case "UPDATE_TOAST":
      return {
        ...state,
        toasts: state.toasts.map((t) =>
          t.id === action.toast.id ? { ...t, ...action.toast } : t
        ),
      }

    case "DISMISS_TOAST": {
      const { toastId } = action

      // ! Side effects ! - This could be extracted into a dismissToast() action,
      // but I'll keep it here for simplicity
      if (toastId) {
        addToRemoveQueue(toastId)
      } else {
        state.toasts.forEach((toast) => {
          addToRemoveQueue(toast.id)
        })
      }

      return {
        ...state,
        toasts: state.toasts.map((t) =>
          t.id === toastId || toastId === undefined
            ? {
                ...t,
                open: false,
              }
            : t
        ),
      }
    }
    case "REMOVE_TOAST":
      if (action.toastId === undefined) {
        return {
          ...state,
          toasts: [],
        }
      }
      return {
        ...state,
        toasts: state.toasts.filter((t) => t.id !== action.toastId),
      }
  }
}

const listeners: Array<(state: State) => void> = []

let memoryState: State = { toasts: [] }

function dispatch(action: Action) {
  memoryState = reducer(memoryState, action)
  listeners.forEach((listener) => {
    listener(memoryState)
  })
}

type Toast = Omit<ToasterToast, "id">

function toast(props: Toast) {
  const id = genId()

  const update = (props: ToasterToast) =>
    dispatch({
      type: "UPDATE_TOAST",
      toast: { ...props, id },
    })
  const dismiss = () => dispatch({ type: "DISMISS_TOAST", toastId: id })

  dispatch({
    type: "ADD_TOAST",
    toast: {
      ...props,
      id,
      open: true,
      onOpenChange: (open) => {
        if (!open) dismiss()
      },
    },
  })

  return {
    id: id,
    dismiss,
    update,
  }
}

function useToast() {
  const [state, setState] = React.useState<State>(memoryState)

  React.useEffect(() => {
    listeners.push(setState)
    return () => {
      const index = listeners.indexOf(setState)
      if (index > -1) {
        listeners.splice(index, 1)
      }
    }
  }, [state])

  return {
    ...state,
    toast,
    dismiss: (toastId?: string) => dispatch({ type: "DISMISS_TOAST", toastId }),
  }
}

export { useToast, toast }
`;
}

function generateToastContent(): string {
  return `'use client';

import * as React from 'react';
import * as ToastPrimitives from '@radix-ui/react-toast';
import { cva, type VariantProps } from 'class-variance-authority';
import { X } from 'lucide-react';

import { cn } from '../../lib/utils';

const ToastProvider = ToastPrimitives.Provider;

const ToastViewport = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Viewport>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Viewport>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Viewport
    ref={ref}
    className={cn(
      "fixed top-0 z-[100] flex max-h-screen w-full flex-col-reverse p-4 sm:bottom-0 sm:right-0 sm:top-auto sm:flex-col md:max-w-[420px]",
      className
    )}
    {...props}
  />
));
ToastViewport.displayName = ToastPrimitives.Viewport.displayName;

const toastVariants = cva(
  'group pointer-events-auto relative flex w-full items-center justify-between space-x-4 overflow-hidden rounded-md border p-6 pr-8 shadow-lg transition-all data-[swipe=cancel]:translate-x-0 data-[swipe=end]:translate-x-[var(--radix-toast-swipe-end-x)] data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] data-[swipe=cancel]:transition-transform data-[state=open]:animate-in data-[state=closed]:animate-out data-[swipe=end]:animate-out data-[state=closed]:fade-out-80 data-[state=closed]:slide-out-to-right-full data-[state=open]:slide-in-from-top-full data-[state=open]:sm:slide-in-from-bottom-full',
  {
    variants: {
      variant: {
        default: 'border bg-background text-foreground',
        destructive:
          'destructive group border-destructive bg-destructive text-destructive-foreground',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

const Toast = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Root> &
    VariantProps<typeof toastVariants>
>(({ className, variant, ...props }, ref) => {
  return (
    <ToastPrimitives.Root
      ref={ref}
      className={cn(toastVariants({ variant }), className)}
      {...props}
    />
  );
});
Toast.displayName = ToastPrimitives.Root.displayName;

const ToastAction = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Action>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Action>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Action
    ref={ref}
    className={cn(
      'inline-flex h-8 shrink-0 items-center justify-center rounded-md border bg-transparent px-3 text-sm font-medium ring-offset-background transition-colors hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 group-[.destructive]:border-muted/40 group-[.destructive]:hover:border-destructive/30 group-[.destructive]:hover:bg-destructive group-[.destructive]:hover:text-destructive-foreground group-[.destructive]:focus:ring-destructive',
      className
    )}
    {...props}
  />
));
ToastAction.displayName = ToastPrimitives.Action.displayName;

const ToastClose = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Close>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Close>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Close
    ref={ref}
    className={cn(
      'absolute right-2 top-2 rounded-md p-1 text-foreground/50 opacity-0 transition-opacity hover:text-foreground focus:opacity-100 focus:outline-none focus:ring-2 group-hover:opacity-100 group-[.destructive]:text-red-300 group-[.destructive]:hover:text-red-50 group-[.destructive]:focus:ring-red-400 group-[.destructive]:focus:ring-offset-red-600',
      className
    )}
    toast-close=""
    {...props}
  >
    <X className="h-4 w-4" />
  </ToastPrimitives.Close>
));
ToastClose.displayName = ToastPrimitives.Close.displayName;

const ToastTitle = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Title>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Title>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Title
    ref={ref}
    className={cn('text-sm font-semibold', className)}
    {...props}
  />
));
ToastTitle.displayName = ToastPrimitives.Title.displayName;

const ToastDescription = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Description>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Description>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Description
    ref={ref}
    className={cn('text-sm opacity-90', className)}
    {...props}
  />
));
ToastDescription.displayName = ToastPrimitives.Description.displayName;

type ToastProps = React.ComponentPropsWithoutRef<typeof Toast>;

type ToastActionElement = React.ReactElement<typeof ToastAction>;

export {
  type ToastProps,
  type ToastActionElement,
  ToastProvider,
  ToastViewport,
  Toast,
  ToastTitle,
  ToastDescription,
  ToastClose,
  ToastAction,
};
`;
}

function generateFooterContent(): string {
  return `'use client';

import React from 'react';
import Link from 'next/link';
import Image from 'next/image';

interface FooterProps {
  className?: string;
}

const Footer = React.memo<FooterProps>(({ className = '' }) => {
  const currentYear = new Date().getFullYear();

  return (
    <footer className={'bg-black/50 backdrop-blur-sm text-white fixed bottom-0 left-0 right-0 ' + className} aria-label="Pie de página">
      <div className="container mx-auto px-4 py-2">
        <div className="flex items-center justify-between h-8">
          <div className="flex-1 flex justify-start">
            <Link href="/" className="inline-block">
              <div className="relative w-28 h-10">
                <Image
                  src="https://zeus-basedatos.fly.dev/api/files/pbc_1998862360/4ou6mzfabp7anmr/nuevo_logo_ql55z232q1.png"
                  alt="Logo"
                  fill
                  className="object-contain rounded-lg"
                  sizes="(max-width: 768px) 100vw, 128px"
                />
              </div>
            </Link>
          </div>
          
          <div className="flex-1 text-center flex items-end justify-center">
            <p className="text-xs text-white/70 whitespace-nowrap">
              © {currentYear}. Todos los derechos reservados. Aplicación creada con www.zeus-ia.com
            </p>
          </div>
          
          <div className="flex-1"></div>
        </div>
      </div>
    </footer>
  );
});

Footer.displayName = 'Footer';

export default Footer;
  
  `;
}

function generateThemeProviderContent(): string {
  return `'use client';

import * as React from 'react';
import { ThemeProvider as NextThemesProvider } from 'next-themes';
import { type ThemeProviderProps } from 'next-themes';

export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
`;
}



function generateErrorBoundaryContent(): string {
  return `'use client';

import React from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ComponentType<{ error?: Error; resetError: () => void }>;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  resetError = () => {
    this.setState({ hasError: false, error: undefined });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        const FallbackComponent = this.props.fallback;
        return <FallbackComponent error={this.state.error} resetError={this.resetError} />;
      }

      return (
        <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
          <div className="text-center">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
              Algo salió mal
            </h2>
            <p className="text-gray-600 dark:text-gray-400 mb-6">
              Ha ocurrido un error inesperado. Por favor, intenta recargar la página.
            </p>
            <button
              onClick={this.resetError}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
            >
              Intentar de nuevo
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
`;
}

function generateProvidersContent(): string {
  return `'use client';

import * as React from 'react';
import { ThemeProvider } from '@/components/theme-provider';
import { Toaster } from '@/components/ui/toaster';
import { useStore } from '@/lib/store';

export function Providers({ children }: { children: React.ReactNode }) {
  React.useEffect(() => {
    useStore.getState().init();
  }, []);

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
      <Toaster />
    </ThemeProvider>
  );
};
`;
}

function generateDropdownMenuContent(): string {
  return `'use client';

import * as React from "react"
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu"
import { Check, ChevronRight, Circle } from "lucide-react"

import { cn } from "@/lib/utils"

const DropdownMenu = DropdownMenuPrimitive.Root

const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger

const DropdownMenuGroup = DropdownMenuPrimitive.Group

const DropdownMenuPortal = DropdownMenuPrimitive.Portal

const DropdownMenuSub = DropdownMenuPrimitive.Sub

const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup

// Radix types sometimes omit className/children; widen locally so we can style them safely.
type DropdownMenuItemProps =
  DropdownMenuPrimitive.DropdownMenuItemProps & {
    onClick?: React.MouseEventHandler<HTMLDivElement>
    inset?: boolean
    className?: string
    children?: React.ReactNode
  }

type DropdownMenuPrimitiveCheckboxItemProps =
  DropdownMenuPrimitive.DropdownMenuCheckboxItemProps & {
    className?: string
    children?: React.ReactNode
    checked?: boolean | "indeterminate"
  }

type DropdownMenuPrimitiveRadioItemProps =
  DropdownMenuPrimitive.DropdownMenuRadioItemProps & {
    className?: string
    children?: React.ReactNode
  }

type DropdownMenuPrimitiveLabelProps =
  DropdownMenuPrimitive.DropdownMenuLabelProps & {
    className?: string
    children?: React.ReactNode
  }

type DropdownMenuPrimitiveSeparatorProps =
  DropdownMenuPrimitive.DropdownMenuSeparatorProps & {
    className?: string
  }

type DropdownMenuPrimitiveSubContentProps =
  DropdownMenuPrimitive.DropdownMenuSubContentProps & {
    className?: string
    children?: React.ReactNode
  }

type DropdownMenuPrimitiveSubTriggerProps =
  DropdownMenuPrimitive.DropdownMenuSubTriggerProps & {
    className?: string
    children?: React.ReactNode
    inset?: boolean
  }

const DropdownMenuPrimitiveSubTrigger =
  DropdownMenuPrimitive.SubTrigger as React.ForwardRefExoticComponent<
    DropdownMenuPrimitiveSubTriggerProps &
      React.RefAttributes<HTMLDivElement>
  >

const DropdownMenuPrimitiveSubContent =
  DropdownMenuPrimitive.SubContent as React.ForwardRefExoticComponent<
    DropdownMenuPrimitiveSubContentProps & React.RefAttributes<HTMLDivElement>
  >

const DropdownMenuPrimitiveItem =
  DropdownMenuPrimitive.Item as React.ForwardRefExoticComponent<
    DropdownMenuItemProps & React.RefAttributes<HTMLDivElement>
  >

const DropdownMenuPrimitiveLabel =
  DropdownMenuPrimitive.Label as React.ForwardRefExoticComponent<
    DropdownMenuPrimitiveLabelProps & React.RefAttributes<HTMLDivElement>
  >

const DropdownMenuPrimitiveSeparator =
  DropdownMenuPrimitive.Separator as React.ForwardRefExoticComponent<
    DropdownMenuPrimitiveSeparatorProps & React.RefAttributes<HTMLDivElement>
  >

const DropdownMenuPrimitiveCheckboxItem =
  DropdownMenuPrimitive.CheckboxItem as React.ForwardRefExoticComponent<
    DropdownMenuPrimitiveCheckboxItemProps &
      React.RefAttributes<HTMLDivElement>
  >

const DropdownMenuPrimitiveRadioItem =
  DropdownMenuPrimitive.RadioItem as React.ForwardRefExoticComponent<
    DropdownMenuPrimitiveRadioItemProps &
      React.RefAttributes<HTMLDivElement>
  >

const DropdownMenuSubTrigger = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.SubTrigger>,
  DropdownMenuPrimitiveSubTriggerProps
>(({ className, inset, children, ...props }, ref) => (
  <DropdownMenuPrimitiveSubTrigger
    ref={ref}
    className={cn(
      "flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none focus:bg-gray-100 data-[state=open]:bg-gray-100 dark:focus:bg-gray-800 dark:data-[state=open]:bg-gray-800",
      inset && "pl-8",
      className
    )}
    {...props}
  >
    {children}
    <ChevronRight className="ml-auto h-4 w-4" />
  </DropdownMenuPrimitiveSubTrigger>
))
DropdownMenuSubTrigger.displayName =
  DropdownMenuPrimitive.SubTrigger.displayName

const DropdownMenuSubContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.SubContent>,
  DropdownMenuPrimitiveSubContentProps
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitiveSubContent
    ref={ref}
    className={cn(
      "z-50 min-w-[8rem] overflow-hidden rounded-md border border-gray-200 bg-white p-1 text-gray-950 shadow-lg data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-50",
      className
    )}
    {...props}
  />
))
DropdownMenuSubContent.displayName =
  DropdownMenuPrimitive.SubContent.displayName

const DropdownMenuContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        "z-50 min-w-[8rem] overflow-hidden rounded-md border border-gray-200 bg-white p-1 text-gray-950 shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-50",
        className
      )}
      {...props}
    />
  </DropdownMenuPrimitive.Portal>
))
DropdownMenuContent.displayName = DropdownMenuPrimitive.Content.displayName

const DropdownMenuItem = React.forwardRef<HTMLDivElement, DropdownMenuItemProps>(
  ({ className, ...props }, ref) => (
    <DropdownMenuPrimitiveItem
      ref={ref}
      className={cn(
        "relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors focus:bg-gray-100 focus:text-gray-900 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 dark:focus:bg-gray-800 dark:focus:text-gray-50",
        className
      )}
      {...props}
    />
  )
)
DropdownMenuItem.displayName = DropdownMenuPrimitive.Item.displayName

type DropdownMenuCheckboxItemProps = DropdownMenuPrimitiveCheckboxItemProps

const DropdownMenuCheckboxItem = React.forwardRef<
  HTMLDivElement,
  DropdownMenuCheckboxItemProps
>(({ className, children, checked, ...props }, ref) => (
  <DropdownMenuPrimitiveCheckboxItem
    ref={ref}
    className={cn(
      "relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none transition-colors focus:bg-gray-100 focus:text-gray-900 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 dark:focus:bg-gray-800 dark:focus:text-gray-50",
      className
    )}
    checked={checked}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <DropdownMenuPrimitive.ItemIndicator>
        <Check className="h-4 w-4" />
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </DropdownMenuPrimitiveCheckboxItem>
))
DropdownMenuCheckboxItem.displayName =
  DropdownMenuPrimitive.CheckboxItem.displayName

type DropdownMenuRadioItemProps = DropdownMenuPrimitiveRadioItemProps

const DropdownMenuRadioItem = React.forwardRef<
  HTMLDivElement,
  DropdownMenuRadioItemProps
>(({ className, children, ...props }, ref) => (
  <DropdownMenuPrimitiveRadioItem
    ref={ref}
    className={cn(
      "relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none transition-colors focus:bg-gray-100 focus:text-gray-900 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 dark:focus:bg-gray-800 dark:focus:text-gray-50",
      className
    )}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <DropdownMenuPrimitive.ItemIndicator>
        <Circle className="h-2 w-2 fill-current" />
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </DropdownMenuPrimitiveRadioItem>
))
DropdownMenuRadioItem.displayName = DropdownMenuPrimitive.RadioItem.displayName

const DropdownMenuLabel = React.forwardRef<
  HTMLDivElement,
  DropdownMenuPrimitiveLabelProps & {
    inset?: boolean
  }
>(({ className, inset, ...props }, ref) => (
  <DropdownMenuPrimitiveLabel
    ref={ref}
    className={cn(
      "px-2 py-1.5 text-sm font-semibold",
      inset && "pl-8",
      className
    )}
    {...props}
  />
))
DropdownMenuLabel.displayName = DropdownMenuPrimitive.Label.displayName

const DropdownMenuSeparator = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Separator>,
  DropdownMenuPrimitiveSeparatorProps
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitiveSeparator
    ref={ref}
    className={cn("-mx-1 my-1 h-px bg-gray-100 dark:bg-gray-800", className)}
    {...props}
  />
))
DropdownMenuSeparator.displayName = DropdownMenuPrimitive.Separator.displayName

const DropdownMenuShortcut = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) => {
  return (
    <span
      className={cn("ml-auto text-xs tracking-widest opacity-60", className)}
      {...props}
    />
  )
}
DropdownMenuShortcut.displayName = "DropdownMenuShortcut"

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuGroup,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuRadioGroup,
}
`;
}

function generateNavbarContent(additionalPages?: { route: string; purpose: string }[]): string {
  const navLinks = additionalPages && additionalPages.length > 0
    ? additionalPages.map(p => `        <Link href="/${p.route}" className="text-sm font-medium hover:opacity-80 transition-opacity">{p.purpose}</Link>`).join('\n')
    : '';
  const extraNavBlock = navLinks
    ? `        <div className="hidden md:flex items-center gap-4 ml-4">\n${navLinks}\n        </div>`
    : '';
  return `'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import AuthStatus, { type AuthStatusPaths } from '@/components/auth/auth-status';
import { authPaths } from '@/lib/auth-config';

export interface NavbarProps {
  appName?: string;
  homePath?: string;
  paths?: AuthStatusPaths;
  className?: string;
}

export default function Navbar({
  appName = process.env.NEXT_PUBLIC_APP_NAME ?? 'Mi Aplicación',
  homePath = authPaths.home,
  paths,
  className = '',
}: NavbarProps) {
  const pathname = usePathname();
  const isAuthRoute = pathname.startsWith('/auth');
  const bgClass = isAuthRoute
    ? 'bg-gray-900 border-gray-800 text-white'
    : 'bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 text-gray-900 dark:text-gray-100';

  return (
    <nav
      className={
        'flex items-center justify-between px-4 py-3 border-b ' + bgClass + ' ' + className
      }
      role="navigation"
    >
      <div className="flex items-center gap-6">
        <Link
          href={homePath}
          className="text-xl font-bold hover:opacity-90 transition-opacity"
        >
          {appName}
        </Link>
${extraNavBlock}
      </div>
      <div className="flex items-center gap-4">
        <AuthStatus paths={paths} />
      </div>
    </nav>
  );
}
`;
}

function generateDrawingContextContent(): string {
  return `'use client';

import React, { createContext, useContext, useReducer, ReactNode } from 'react';

interface DrawingState {
  isDrawing: boolean;
  currentTool: 'pen' | 'eraser' | 'select';
  strokeWidth: number;
  strokeColor: string;
  canvasData: any[];
}

type DrawingAction =
  | { type: 'START_DRAWING' }
  | { type: 'STOP_DRAWING' }
  | { type: 'SET_TOOL'; tool: 'pen' | 'eraser' | 'select' }
  | { type: 'SET_STROKE_WIDTH'; width: number }
  | { type: 'SET_STROKE_COLOR'; color: string }
  | { type: 'ADD_STROKE'; stroke: any }
  | { type: 'CLEAR_CANVAS' }
  | { type: 'UNDO' };

const initialState: DrawingState = {
  isDrawing: false,
  currentTool: 'pen',
  strokeWidth: 2,
  strokeColor: '#000000',
  canvasData: [],
};

function drawingReducer(state: DrawingState, action: DrawingAction): DrawingState {
  switch (action.type) {
    case 'START_DRAWING':
      return { ...state, isDrawing: true };
    case 'STOP_DRAWING':
      return { ...state, isDrawing: false };
    case 'SET_TOOL':
      return { ...state, currentTool: action.tool };
    case 'SET_STROKE_WIDTH':
      return { ...state, strokeWidth: action.width };
    case 'SET_STROKE_COLOR':
      return { ...state, strokeColor: action.color };
    case 'ADD_STROKE':
      return { ...state, canvasData: [...state.canvasData, action.stroke] };
    case 'CLEAR_CANVAS':
      return { ...state, canvasData: [] };
    case 'UNDO':
      return { ...state, canvasData: state.canvasData.slice(0, -1) };
    default:
      return state;
  }
}

const DrawingContext = createContext<{
  state: DrawingState;
  dispatch: React.Dispatch<DrawingAction>;
} | null>(null);

export function DrawingProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(drawingReducer, initialState);

  return (
    <DrawingContext.Provider value={{ state, dispatch }}>
      {children}
    </DrawingContext.Provider>
  );
}

export function useDrawing() {
  const context = useContext(DrawingContext);
  if (!context) {
    throw new Error('useDrawing must be used within a DrawingProvider');
  }
  return context;
}
`;
}

function generateViteSvgContent(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" aria-hidden="true" role="img" class="iconify iconify--logos" width="31.88" height="32" preserveAspectRatio="xMidYMid meet" viewBox="0 0 256 257"><defs><linearGradient id="IconifyId1813088fe1fbc01fb466" x1="-.828%" x2="57.636%" y1="7.652%" y2="78.411%"><stop offset="0%" stop-color="#41D1FF"></stop><stop offset="100%" stop-color="#BD34FE"></stop></linearGradient><linearGradient id="IconifyId1813088fe1fbc01fb467" x1="43.376%" x2="50.316%" y1="2.242%" y2="89.03%"><stop offset="0%" stop-color="#FFEA83"></stop><stop offset="8.333%" stop-color="#FFDD35"></stop><stop offset="100%" stop-color="#FFA800"></stop></linearGradient></defs><path fill="url(#IconifyId1813088fe1fbc01fb466)" d="M255.153 37.938L134.897 252.976c-2.483 4.44-8.862 4.466-11.382.048L.875 37.958c-2.746-4.814 1.371-10.646 6.827-9.67l120.385 21.517a6.537 6.537 0 0 0 2.322-.004l117.867-21.483c5.438-.991 9.574 4.796 6.877 9.62Z"></path><path fill="url(#IconifyId1813088fe1fbc01fb467)" d="M185.432.063L96.44 17.501a3.268 3.268 0 0 0-2.634 3.014l-5.474 92.456a3.268 3.268 0 0 0 3.997 3.378l24.777-5.718c2.318-.535 4.413 1.507 3.936 3.838l-7.361 36.047c-.495 2.426 1.782 4.5 4.151 3.78l15.304-4.649c2.372-.72 4.652 1.36 4.15 3.788l-11.698 56.621c-.732 3.542 3.979 5.473 5.943 2.437l1.313-2.028l72.516-144.72c1.215-2.423-.88-5.186-3.54-4.672l-25.505 4.922c-2.396.462-4.435-1.77-3.759-4.114l16.646-57.705c.677-2.35-1.37-4.583-3.769-4.113Z"></path></svg>`;
}

function generateIndexCssContent(): string {
  return `:root {
  font-family: Inter, system-ui, Avenir, Helvetica, Arial, sans-serif;
  line-height: 1.5;
  font-weight: 400;

  color-scheme: light dark;
  color: rgba(255, 255, 255, 0.87);
  background-color: #242424;

  font-synthesis: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  -webkit-text-size-adjust: 100%;
}

a {
  font-weight: 500;
  color: #646cff;
  text-decoration: inherit;
}
a:hover {
  color: #535bf2;
}

body {
  margin: 0;
  display: flex;
  place-items: center;
  min-width: 320px;
  min-height: 100vh;
}

h1 {
  font-size: 3.2em;
  line-height: 1.1;
}

button {
  border-radius: 8px;
  border: 1px solid transparent;
  padding: 0.6em 1.2em;
  font-size: 1em;
  font-weight: 500;
  font-family: inherit;
  background-color: #1a1a1a;
  color: white;
  cursor: pointer;
  transition: border-color 0.25s;
}
button:hover {
  border-color: #646cff;
}
button:focus,
button:focus-visible {
  outline: 4px auto -webkit-focus-ring-color;
}

@media (prefers-color-scheme: light) {
  :root {
    color: #213547;
    background-color: #ffffff;
  }
  a:hover {
    color: #747bff;
  }
  button {
    background-color: #f9f9f9;
    color: #213547;
  }
}`;
}

function generateViteTailwindConfigContent(): string {
  return `/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
`;
}

function generateLabelContent(): string {
  return `import * as React from "react"
import * as LabelPrimitive from "@radix-ui/react-label"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const labelVariants = cva(
  "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
)

const Label = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root> &
    VariantProps<typeof labelVariants>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn(labelVariants(), className)}
    {...props}
  />
))
Label.displayName = LabelPrimitive.Root.displayName

export { Label }
`;
}

function generateTsconfigNodeContent(): string {
  return `{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true
  },
  "include": ["vite.config.ts"]
}
`;
}

// Funciones para generar contenido de archivos de configuración
function generateEnvExampleContent(template: string): string {
  const common = `# Environment Variables
# Copy this file to .env.local and fill in your values

# Application
NEXT_PUBLIC_APP_NAME=my-app
NEXT_PUBLIC_APP_URL=http://localhost:8741

# PocketBase (auth)
NEXT_PUBLIC_POCKETBASE_URL=http://127.0.0.1:8090

# Database (if needed)
# DATABASE_URL=

# Authentication (if needed)
# NEXTAUTH_SECRET=
# NEXTAUTH_URL=http://localhost:8741

# API Keys (if needed)
# OPENAI_API_KEY=
# STRIPE_SECRET_KEY=
# STRIPE_PUBLISHABLE_KEY=`;

  switch (template) {
    case 'next-js':
      return common + `\n\n# Next.js specific\nNEXT_PUBLIC_VERCEL_URL=\nANALYZE=false`;
    case 'vite-react':
      return `# Environment Variables\n# Copy this file to .env.local and fill in your values\n\n# Vite\nVITE_APP_NAME=my-app\nVITE_APP_URL=http://localhost:5173\n\n# API Keys (if needed)\n# VITE_API_KEY=`;
    default:
      return common;
  }
}

function generateEslintConfigContent(template: string): string {
  switch (template) {
    case 'next-js':
      return `{\n  "extends": [\n    "next/core-web-vitals",\n    "prettier"\n  ],\n  "rules": {\n    "@typescript-eslint/no-unused-vars": "warn",\n    "@typescript-eslint/no-explicit-any": "warn",\n    "react-hooks/exhaustive-deps": "warn"\n  }\n}`;
    case 'vite-react':
      return `{\n  "root": true,\n  "env": { "browser": true, "es2020": true },\n  "extends": [\n    "eslint:recommended",\n    "@typescript-eslint/recommended",\n    "react-hooks/recommended",\n    "prettier"\n  ],\n  "ignorePatterns": ["dist", ".eslintrc.cjs"],\n  "parser": "@typescript-eslint/parser",\n  "plugins": ["react-refresh"],\n  "rules": {\n    "react-refresh/only-export-components": [\n      "warn",\n      { "allowConstantExport": true }\n    ],\n    "@typescript-eslint/no-unused-vars": "warn"\n  }\n}`;
    default:
      return `{\n  "extends": ["eslint:recommended", "prettier"],\n  "rules": {\n    "no-unused-vars": "warn",\n    "no-console": "warn"\n  }\n}`;
  }
}

function generatePrettierConfigContent(): string {
  return `{\n  "semi": true,\n  "trailingComma": "es5",\n  "singleQuote": true,\n  "printWidth": 80,\n  "tabWidth": 2,\n  "useTabs": false\n}`;
}

function generateEditorConfigContent(): string {
  return `root = true\n\n[*]\ncharset = utf-8\nend_of_line = lf\ninsert_final_newline = true\ntrim_trailing_whitespace = true\nindent_style = space\nindent_size = 2\n\n[*.md]\ntrim_trailing_whitespace = false`;
}

// Función para generar contenido del componente Button
function generateButtonContent(): string {
  return `import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline:
          "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };`;
}

// Función para generar el componente Slider
function generateSliderContent(): string {
  return `'use client';

import * as React from "react"
import * as SliderPrimitive from "@radix-ui/react-slider"
import { cn } from "@/lib/utils"

const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SliderPrimitive.Root
    ref={ref}
    className={cn(
      "relative flex w-full touch-none select-none items-center",
      className
    )}
    {...props}
  >
    <SliderPrimitive.Track className="relative h-2 w-full grow overflow-hidden rounded-full bg-secondary">
      <SliderPrimitive.Range className="absolute h-full bg-primary" />
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb className="block h-5 w-5 rounded-full border-2 border-primary bg-background ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50" />
  </SliderPrimitive.Root>
))
Slider.displayName = SliderPrimitive.Root.displayName

export { Slider }`;
}

// Función para generar el componente Tabs
function generateTabsContent(): string {
  return `'use client';

import * as React from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"
import { cn } from "@/lib/utils"

const Tabs = TabsPrimitive.Root

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      "inline-flex h-10 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground",
      className
    )}
    {...props}
  />
))
TabsList.displayName = TabsPrimitive.List.displayName

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm",
      className
    )}
    {...props}
  />
))
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      className
    )}
    {...props}
  />
))
TabsContent.displayName = TabsPrimitive.Content.displayName

export {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
}`;
}

// Función para generar el componente Toggle
function generateToggleContent(): string {
  return `'use client';

import * as React from "react"
import * as TogglePrimitive from "@radix-ui/react-toggle"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const toggleVariants = cva(
  "inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors hover:bg-muted hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-accent data-[state=on]:text-accent-foreground",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        outline:
          "border border-input bg-transparent hover:bg-accent hover:text-accent-foreground",
      },
      size: {
        default: "h-10 px-3",
        sm: "h-9 px-2.5",
        lg: "h-11 px-5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ToggleProps
  extends React.ComponentPropsWithoutRef<typeof TogglePrimitive.Root>,
    VariantProps<typeof toggleVariants> {}

const Toggle = React.forwardRef<
  React.ElementRef<typeof TogglePrimitive.Root>,
  ToggleProps
>(({ className, variant, size, ...props }, ref) => (
  <TogglePrimitive.Root
    ref={ref}
    className={cn(toggleVariants({ variant, size, className }))}
    {...props}
  />
))

Toggle.displayName = TogglePrimitive.Root.displayName

export { Toggle, toggleVariants }`;
}

// Función para generar descripción sofisticada usando IA
async function generateSophisticatedDescription(description: string, modelConfig?: any): Promise<string> {
  if (!modelConfig) {
    return description; // Retornar descripción original si no hay configuración del modelo
  }

  // Normalizar propiedades del modelConfig (soporta tanto snake_case como camelCase)
  const normalizedConfig = {
    url: modelConfig?.url || modelConfig?.base_url || modelConfig?.baseURL || '',
    apiKey: modelConfig?.apiKey || modelConfig?.api_key || '',
    model: modelConfig?.model || modelConfig?.model_name || 'gemini-2.5-pro',
    provider: modelConfig?.provider || ''
  };

  if (!normalizedConfig.url || !normalizedConfig.apiKey) {
    console.warn('⚠️ Configuración del modelo incompleta, usando descripción original');
    return description;
  }

  try {
    const sophisticatedPrompt = `Eres un asistente de IA experto en refinar descripciones de proyectos de software. Dada la siguiente descripción de un usuario, expande y mejora la descripción para que sea más detallada, profesional y útil para generar una aplicación. Incluye aspectos como:

1. **Tipo de aplicación**: Especifica si es web, móvil, escritorio, API, etc.
2. **Tecnologías sugeridas**: Si no se especifican, elige las más adecuadas y modernas
3. **Características clave**: Funcionalidades principales y secundarias
4. **Diseño UI/UX**: Estilo visual, paleta de colores, tipografía, layout
5. **Arquitectura**: Estructura de componentes, patrones de diseño, estado global
6. **Funcionalidades avanzadas**: Autenticación, base de datos, APIs, tiempo real
7. **Optimización**: Performance, SEO, accesibilidad, responsive design
8. **Casos de uso**: Escenarios específicos de uso y flujos de usuario
9. **Escalabilidad**: Consideraciones para crecimiento futuro
10. **Integración**: APIs externas, servicios de terceros, herramientas

Transforma la idea básica en una especificación técnica clara, completa y profesional que un desarrollador senior pueda implementar inmediatamente.

Descripción del usuario:
"""
${description}
"""

Tu respuesta debe ser solo la descripción refinada y técnicamente detallada, sin preámbulos ni explicaciones adicionales.`;

    const isOllamaCloud =
      normalizedConfig.provider?.toLowerCase().includes('ollama cloud') ||
      normalizedConfig.provider?.toLowerCase().includes('ollama_cloud') ||
      normalizedConfig.provider?.toLowerCase().includes('ollama-cloud') ||
      normalizedConfig.url.includes('ollama.com') ||
      normalizedConfig.url.includes('ollama.cloud');

    let refinedDescription: string;
    if (isOllamaCloud) {
      refinedDescription = await callModelGeneric(normalizedConfig, [{ role: 'system', content: sophisticatedPrompt }], { temperature: 0.4, maxTokens: 8192 });
    } else {
      const response = await fetch(normalizedConfig.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${normalizedConfig.apiKey}`
        },
        body: JSON.stringify({
          model: normalizedConfig.model,
          messages: [{ role: 'system', content: sophisticatedPrompt }],
          temperature: 0.4,
          max_tokens: 8192,
        })
      });

      if (!response.ok) {
        console.error('Error en API del modelo IA:', response.status);
        return description; // Retornar descripción original en caso de error
      }

      const data = await response.json();
      refinedDescription = data.choices?.[0]?.message?.content ?? '';
    }

    return refinedDescription.trim() || description;
  } catch (error) {
    console.error('Error generando descripción sofisticada:', error);
    return description; // Retornar descripción original en caso de error
  }
}

// Fallback: detectar páginas por palabras clave en la descripción
function detectPagesFromKeywords(description: string): { route: string; purpose: string }[] {
  const d = description.toLowerCase();
  const pages: { route: string; purpose: string }[] = [];
  const add = (route: string, purpose: string, keywords: string[]) => {
    if (keywords.some(k => d.includes(k))) {
      if (!pages.find(p => p.route === route)) pages.push({ route, purpose });
    }
  };

  add('about',        'Sobre nosotros / información de la empresa',      ['about', 'sobre nosotros', 'quienes somos', 'empresa', 'historia']);
  add('contacto',     'Formulario de contacto / información de contacto', ['contact', 'contacto', 'email', 'teléfono', 'llamar', 'mensaje']);
  add('productos',    'Galería o listado de productos',                ['producto', 'productos', 'catalogo', 'catálogo', 'galería', 'galeria', 'items', 'articulos', 'artículos', 'mercancia']);
  add('servicios',    'Página de servicios ofrecidos',                 ['servicio', 'servicios', 'ofrecemos', 'soluciones', 'consultoría']);
  add('blog',         'Blog / artículos / noticias',                   ['blog', 'noticias', 'articulos', 'artículos', 'posts', 'publicaciones']);
  add('portafolio',   'Portafolio / trabajos / proyectos',             ['portafolio', 'portfolio', 'trabajos', 'proyectos', 'clientes', 'casos']);
  add('faq',          'Preguntas frecuentes',                          ['faq', 'preguntas frecuentes', 'dudas', 'ayuda']);
  add('precios',      'Tabla de precios / planes',                     ['precio', 'precios', 'pricing', 'planes', 'tarifas', 'costos', 'suscripcion', 'suscripción']);
  add('testimonios',  'Testimonios de clientes',                       ['testimonio', 'testimonios', 'reviews', 'opiniones', 'clientes']);
  add('categorias',   'Categorías de productos o contenido',           ['categoria', 'categorías', 'categorias', 'clasificacion', 'filtros', 'secciones']);
  add('galeria',      'Galería de imágenes o multimedia',              ['galeria', 'galería', 'fotos', 'imagenes', 'imágenes', 'media']);
  add('equipo',       'Equipo / staff / miembros',                     ['equipo', 'team', 'staff', 'miembros', 'profesionales', 'doctores', 'abogados']);

  // Si se mencionan "categorías" y "productos", añadir página de categorías
  if (d.includes('categoria') && d.includes('producto')) {
    add('categorias', 'Categorías de productos', ['categoria']);
  }

  console.log(`[detectPagesFromKeywords] Keywords detectadas: ${pages.length} páginas → ${pages.map(p=>p.route).join(', ')}`);
  return pages;
}

// Función para detectar páginas adicionales necesarias según la descripción
async function detectAdditionalPages(
  description: string,
  appName: string,
  modelConfig?: StructureRequest['modelConfig']
): Promise<{ route: string; purpose: string }[]> {
  // Fallback por keywords si no hay modelo o falla la detección
  const fallbackPages = detectPagesFromKeywords(description);
  if (!modelConfig?.url || !modelConfig?.apiKey) {
    console.log('⚠️ Sin modelo configurado, usando detección por keywords. Páginas:', fallbackPages.map(p => p.route).join(', ') || 'ninguna');
    return fallbackPages;
  }

  const prompt = `Analiza la siguiente descripción de una aplicación web y determina qué páginas adicionales necesita además de la página principal (home).

Descripción de la aplicación:
"""
${description}
"""

Instrucciones:
1. Identifica TODAS las páginas que la app necesita: about, contact, pricing, productos, categorias, galeria, blog, servicios, portafolio, etc.
2. También detecta páginas dinámicas si se mencionan: productos por categoría, detalle de producto, perfil de usuario, etc.
3. Solo devuelve páginas que sean REALMENTE necesarias según la descripción.
4. La página principal (home) ya existe, NO la incluyas.
5. Usa nombres de ruta en minúsculas y sin espacios (kebab-case).

Responde ÚNICAMENTE con un array JSON en este formato exacto, sin explicaciones adicionales, sin markdown, sin comillas invertidas:
[
  {"route": "about", "purpose": "Descripción breve de qué va esta página"},
  {"route": "productos", "purpose": "Galería de productos"},
  {"route": "contacto", "purpose": "Formulario de contacto"}
]

Si NO necesita páginas adicionales, responde exactamente: []`;

  try {
    const isOllamaCloud =
      modelConfig.provider?.toLowerCase().includes('ollama cloud') ||
      modelConfig.provider?.toLowerCase().includes('ollama_cloud') ||
      modelConfig.provider?.toLowerCase().includes('ollama-cloud') ||
      modelConfig.url.includes('ollama.com') ||
      modelConfig.url.includes('ollama.cloud');

    let content: string;
    if (isOllamaCloud) {
      content = (await callModelGeneric(modelConfig, [{ role: 'system', content: prompt }], { temperature: 0.3, maxTokens: 2048 })).trim();
    } else {
      const response = await fetch(modelConfig.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${modelConfig.apiKey}`
        },
        body: JSON.stringify({
          model: modelConfig.model || 'gemini-2.5-pro',
          messages: [{ role: 'system', content: prompt }],
          temperature: 0.3,
          max_tokens: 2048,
        })
      });

      if (!response.ok) {
        console.warn('⚠️ Error detectando páginas adicionales:', response.status);
        return [];
      }

      const result = await response.json();
      content = result.choices?.[0]?.message?.content?.trim() || '';
    }

    // Intentar extraer JSON de múltiples formatos posibles
    let pages: any[] | null = null;

    // 1. Buscar bloque markdown ```json ... ```
    const mdMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (mdMatch) {
      try {
        const parsed = JSON.parse(mdMatch[1].trim());
        if (Array.isArray(parsed)) pages = parsed;
      } catch { /* ignorar */ }
    }

    // 2. Buscar array JSON entre corchetes (primer [ que cierre correctamente]
    if (!pages) {
      const firstBracket = content.indexOf('[');
      const lastBracket = content.lastIndexOf(']');
      if (firstBracket !== -1 && lastBracket > firstBracket) {
        try {
          const parsed = JSON.parse(content.slice(firstBracket, lastBracket + 1));
          if (Array.isArray(parsed)) pages = parsed;
        } catch { /* ignorar */ }
      }
    }

    // 3. Fallback a keywords si no se pudo parsear
    if (!pages) {
      console.log('⚠️ No se pudo parsear JSON de páginas, usando fallback por keywords');
      return fallbackPages;
    }

    if (Array.isArray(pages)) {
      const validPages = pages.filter((p: any) => p && p.route && typeof p.route === 'string');
      console.log(`✅ Detectadas ${validPages.length} páginas adicionales:`, validPages.map((p: any) => p.route).join(', '));
      if (validPages.length === 0 && fallbackPages.length > 0) {
        console.log('⚠️ Modelo no detectó páginas pero keywords sí → usando fallback');
        return fallbackPages;
      }
      return validPages;
    }
    return fallbackPages;
  } catch (error) {
    console.warn('⚠️ Error detectando páginas adicionales, usando fallback por keywords:', error);
    return fallbackPages;
  }
}

// Escribir la estructura generada en disco
async function writeStructureToDisk(
  structure: FileStructure[],
  basePath: string
): Promise<{ filesCreated: number; dirsCreated: number }> {
  let filesCreated = 0;
  let dirsCreated = 0;

  async function writeItems(items: FileStructure[], currentPath: string) {
    for (const item of items) {
      const itemPath = path.join(currentPath, item.path);
      if (item.type === 'directory') {
        await fs.mkdir(itemPath, { recursive: true });
        dirsCreated++;
        if (item.children && item.children.length > 0) {
          await writeItems(item.children, currentPath);
        }
      } else {
        await fs.mkdir(path.dirname(itemPath), { recursive: true });
        await fs.writeFile(itemPath, item.content || '', 'utf8');
        filesCreated++;
      }
    }
  }

  await writeItems(structure, basePath);
  return { filesCreated, dirsCreated };
}

export async function POST(request: NextRequest) {
  try {
    const startTime = Date.now();
    const body: StructureRequest = await request.json();
    const { appName, template, complexity, features, description, modelConfig, optimizeForSpeed = false, uploadedFiles = [], uploadedImages = [] } = body;

    // DEBUG: Comprehensive logging of what we're receiving (same as mobile API)
    console.log(`🔍 DEBUG - Web API received:`);
    console.log(`   Template: "${template}"`);
    console.log(`   AppName: "${appName}"`);
    console.log(`   Complexity: "${complexity}"`);
    console.log(`   Features: [${features.join(', ')}]`);
    console.log(`   Full body keys:`, Object.keys(body));
    console.log(`   Raw template value type:`, typeof template);
    console.log(`   Raw template value length:`, template.length);
    console.log(`   Raw template value charCodes:`, template.split('').map(c => c.charCodeAt(0)));

    // Log de archivos subidos
    if (uploadedFiles.length > 0) {
      console.log(`📎 Archivos subidos: ${uploadedFiles.length}`);
      uploadedFiles.forEach(file => {
        console.log(`  - ${file.name} (${file.type}, ${(file.size / 1024).toFixed(1)}KB)`);
      });
    }

    if (uploadedImages.length > 0) {
      console.log(`🖼️ Imágenes subidas: ${uploadedImages.length}`);
      uploadedImages.forEach(image => {
        console.log(`  - ${image.name} (${image.type}, ${(image.size / 1024).toFixed(1)}KB)`);
      });
    }

    // Validar parámetros requeridos
    if (!appName || !template) {
      return NextResponse.json(
        { error: 'appName y template son requeridos' },
        { status: 400 }
      );
    }

    // OPTIMIZACIÓN: Usar descripción simple para reducir tiempo de procesamiento
    // La descripción sofisticada con IA puede tomar 3-8 segundos adicionales
    let sophisticatedDescription = description;

    if (optimizeForSpeed) {
      console.log('🚀 MODO RÁPIDO ACTIVADO - Saltando generación de descripción sofisticada');
      sophisticatedDescription = `Aplicación ${template} llamada "${appName}" con las siguientes características: ${features.join(', ')}. ${description}`;
    } else if (modelConfig && complexity === 'complex') {
      console.log('Generando descripción sofisticada para proyecto complejo...');
      const aiStartTime = Date.now();
      sophisticatedDescription = await generateSophisticatedDescription(description, modelConfig);
      const aiEndTime = Date.now();
      console.log(`⏱️ Tiempo de generación de descripción: ${aiEndTime - aiStartTime}ms`);
    } else {
      console.log('⚡ Optimización: Usando descripción simple para mayor velocidad');
      sophisticatedDescription = `Aplicación ${template} llamada "${appName}" con las siguientes características: ${features.join(', ')}. ${description}`;
    }

    // Si se seleccionó la característica 'api', inyectar la configuración de API personalizada
    if (features.includes('api')) {
      const apiConfig = await readApiConfig();
      if (apiConfig) {
        sophisticatedDescription += `\n\n**CONFIGURACIÓN DE API PERSONALIZADA**:\nLa aplicación DEBE integrarse con la siguiente API personalizada. Usa estos endpoints, modelos de datos y esquemas en el código generado (incluye handlers, servicios, tipos y UI conectada a esta API):\n${apiConfig}`;
        console.log('✅ API config inyectada en la descripción');
      } else {
        console.log('⚠️ Característica "api" seleccionada pero no se encontró API/zeus-api-config.json');
      }
    }

    // Detectar páginas adicionales necesarias según la descripción
    let additionalPages: { route: string; purpose: string }[] = [];

    // Si el usuario especificó páginas personalizadas, usarlas directamente
    if (body.customPages && body.customPages.length > 0) {
      console.log(`📄 Usando páginas personalizadas del usuario: ${body.customPages.length}`);
      additionalPages = body.customPages
        .map(p => ({
          route: p.name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\-]/g, ''),
          purpose: p.description || `Página ${p.name}`
        }))
        .filter(p => p.route);
      console.log(`✅ Páginas personalizadas a generar: ${additionalPages.length}`, additionalPages.map(p => p.route));
    } else {
      // Modo estricto: si el usuario NO añadió páginas en el campo "Páginas
      // Personalizadas" del formulario, NO se crean páginas adicionales
      // automáticamente (ni por keywords ni por IA). Solo se generará la home
      // base del template.
      console.log('ℹ️  customPages vacío: no se crearán páginas adicionales (modo estricto).');
    }

    console.log(`✅ Total páginas adicionales a generar: ${additionalPages.length}`, additionalPages.map(p => p.route));

    // OPTIMIZACIÓN: Generar estructura base optimizada
    console.log('📁 Generando estructura base optimizada...');
    const projectStructure = generateProjectStructure(template, appName, complexity, features, additionalPages);
    console.log(`📦 Estructura generada: ${projectStructure.length} archivos`);

    // OPTIMIZACIÓN: Validar estructura mínima requerida
    const validatedStructure = validateMinimalStructure(projectStructure, template, appName, features);
    console.log('✅ Estructura validada y optimizada');

    // Calcular estadísticas
    const stats = {
      totalFiles: 0,
      totalDirectories: 0,
      configFiles: 0
    };

    const countItems = (items: FileStructure[]) => {
      for (const item of items) {
        if (item.type === 'file') {
          stats.totalFiles++;
          if (item.name.includes('config') || item.name.includes('.json') || item.name.includes('.js') || item.name.includes('.ts')) {
            stats.configFiles++;
          }
        } else {
          stats.totalDirectories++;
          if (item.children) {
            countItems(item.children);
          }
        }
      }
    };

    countItems(projectStructure);

    const totalTime = Date.now() - startTime;
    console.log(`📊 TIEMPO TOTAL DE ESTRUCTURA: ${totalTime}ms${optimizeForSpeed ? ' (MODO RÁPIDO)' : ''}`);

    // Post-proceso: si features incluye 'database', mantener referencias a PB_Datos en package.json
    // Solo limpiar si NO se solicitó la característica de base de datos
    try {
      // Verificar si el usuario solicitó la característica de base de datos
      const needsPBDatos = features && Array.isArray(features) && features.includes('database');
      console.log('🔎 Post-proceso PB_Datos -> característica database solicitada:', needsPBDatos);
      console.log('   Features recibidas:', features);
      
      // Solo limpiar referencias si NO se solicitó database
      if (!needsPBDatos) {
        console.log('⚠️ Característica "database" NO solicitada.');
        console.log('🧹 Limpiando referencias a PB_Datos del package.json...');
        
        const findFileNode = (items: FileStructure[], filePath: string): FileStructure | null => {
          for (const it of items) {
            if (it.type === 'file' && it.path === filePath) return it;
            if (it.children) {
              const r = findFileNode(it.children, filePath);
              if (r) return r;
            }
          }
          return null;
        };
        
        const pkgNode = findFileNode(validatedStructure, 'package.json');
        if (pkgNode && typeof pkgNode.content === 'string' && pkgNode.content.trim()) {
          try {
            const pkg = JSON.parse(pkgNode.content);
            if (pkg && pkg.scripts && typeof pkg.scripts === 'object') {
              let scriptsModified = false;
              for (const key of Object.keys(pkg.scripts)) {
                const val = String(pkg.scripts[key] ?? '');
                if (val.includes('PB_Datos')) {
                  scriptsModified = true;
                  let cleaned = val
                    .replace(/"?npm\s+run\s+dev\s+--prefix\s+PB_Datos\s+--\s+-p\s+\d+"?/g, '')
                    .replace(/--prefix\s+PB_Datos/g, '')
                    .replace(/PB_Datos/g, '')
                    .replace(/\s{2,}/g, ' ')
                    .replace(/\s*&&\s*&?\s*/g, ' && ')
                    .trim();
                  cleaned = cleaned.replace(/concurrently\s+"\s*"\s*/g, 'concurrently ').trim();
                  cleaned = cleaned.replace(/^&&\s+/, '').replace(/\s+&&$/, '').trim();
                  pkg.scripts[key] = cleaned;
                  console.log(`   ✓ Script "${key}" limpiado`);
                }
              }
              if (scriptsModified) {
                pkgNode.content = JSON.stringify(pkg, null, 2);
                console.log('✅ Referencias a PB_Datos eliminadas del package.json');
              }
            }
          } catch (e) {
            console.error('❌ Error al parsear package.json:', e);
          }
        } else {
          console.log('⚠️ No se encontró package.json o está vacío');
        }
      } else {
        console.log('✅ Característica "database" solicitada. Manteniendo referencias a PB_Datos en package.json.');
      }
    } catch (e) {
      console.error('❌ Error en post-proceso PB_Datos:', e);
    }

    // ✅ Escribir estructura base en disco (solo archivos con contenido predefinido)
    let resolvedProjectRoot = '';
    try {
      const targetPath = await getProjectRoot(body.projectId, body.projectRoot || '');
      resolvedProjectRoot = targetPath;
      if (targetPath) {
        console.log(`💾 Escribiendo estructura base en disco: ${targetPath}`);
        // Solo escribir archivos que YA tienen contenido (no los que se generarán después)
        const predefinedFiles: FileStructure[] = [];
        function collectPredefined(items: FileStructure[]) {
          for (const item of items) {
            if (item.type === 'file' && item.content) {
              predefinedFiles.push(item);
            } else if (item.children) {
              collectPredefined(item.children);
            }
          }
        }
        collectPredefined(validatedStructure);
        for (const file of predefinedFiles) {
          try {
            const filePath = path.join(targetPath, file.path);
            await fs.mkdir(path.dirname(filePath), { recursive: true });
            await fs.writeFile(filePath, file.content!, 'utf8');
            console.log(`✅ Archivo base creado: ${file.path}`);
          } catch (fErr) {
            console.warn(`⚠️ No se pudo escribir ${file.path}:`, fErr);
          }
        }
        console.log(`✅ Estructura base escrita: ${predefinedFiles.length} archivos en ${targetPath}`);
      }
    } catch (writeError) {
      console.error('❌ Error escribiendo estructura en disco:', writeError);
    }

    return NextResponse.json({
      success: true,
      structure: validatedStructure,
      stats,
      metadata: {
        appName,
        template,
        complexity,
        features,
        originalDescription: description,
        sophisticatedDescription,
        generatedAt: new Date().toISOString(),
        processingTime: totalTime,
        fastMode: optimizeForSpeed, // Indicar si se usó modo rápido
        projectRoot: resolvedProjectRoot,
        additionalPages: additionalPages || []
      }
    });

  } catch (error) {
    console.error('Error generando estructura del proyecto:', error);
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    );
  }
}