import Editor from '@monaco-editor/react';
import type { Monaco } from '@monaco-editor/react';
import { useEffect } from 'react';
import { configureTypeScript, syncProjectFilesToMonaco } from './monacoEnv';

const DEMO_TS = `import { engine } from "@luminary/core";

const zeus = new engine.Zeus({ mode: 'high-perf', sync: true });

export async function deploy(ctx: unknown) {
  return zeus.synthesize(ctx);
}
`;

/** Mismo criterio que el valor mostrado en Monaco (demo sin proyecto, vacío con proyecto, o código PB). */
export function getMonacoCopyValue(codeFromPb: string | null, projectId: string | null): string {
  const hasProjectContent = Boolean(codeFromPb && codeFromPb.trim());
  if (hasProjectContent) return codeFromPb!;
  if (!projectId) return DEMO_TS;
  return '';
}

type Props = {
  codeFromPb: string | null;
  projectId: string | null;
  projectLoading: boolean;
  emptyHint: string;
  files?: Record<string, string>; // Archivos del proyecto para validación cruzada
};

export function ZeusMonacoPane({ codeFromPb, projectId, projectLoading, emptyHint, files = {} }: Props) {
  const hasProjectContent = Boolean(codeFromPb && codeFromPb.trim());
  const value = hasProjectContent ? codeFromPb! : !projectId ? DEMO_TS : '';

  const beforeMount = (m: Monaco) => {
    // Configurar TypeScript para mostrar errores
    configureTypeScript();

    m.editor.defineTheme('zeus-code', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '5c7986', fontStyle: 'italic' },
        { token: 'keyword', foreground: '7dd3fc' },
        { token: 'identifier', foreground: 'e2e8f0' },
        { token: 'type.identifier', foreground: '67e8f9' },
        { token: 'string', foreground: 'a5f3fc' },
        { token: 'number', foreground: 'fcd34d' },
        { token: 'delimiter', foreground: '94a3b8' },
        { token: 'operator', foreground: '38bdf8' }
      ],
      colors: {
        'editor.background': '#000000',
        'editor.foreground': '#e2e8f0',
        'editorLineNumber.foreground': '#475569',
        'editorLineNumber.activeForeground': '#7dd3fc',
        'editorCursor.foreground': '#22d3ee',
        'editor.selectionBackground': '#0e749055',
        'editor.inactiveSelectionBackground': '#164e6355',
        'scrollbarSlider.background': '#33415588',
        'scrollbarSlider.hoverBackground': '#475569aa'
      }
    });
  };

  // Sincronizar archivos del proyecto con Monaco para validación cruzada
  useEffect(() => {
    if (files && Object.keys(files).length > 0) {
      syncProjectFilesToMonaco(files);
    }
  }, [files]);

  return (
    <div className="flex-1 min-h-0 flex flex-col relative bg-background">
      {!value && projectId && !projectLoading ? (
        <div className="absolute inset-0 z-10 flex items-start justify-center pt-8 px-6 pointer-events-none">
          <p className="text-[11px] text-sky-300/90 font-medium text-center max-w-md leading-relaxed">{emptyHint}</p>
        </div>
      ) : null}
      <Editor
        height="100%"
        className="min-h-0 flex-1"
        language="typescript"
        theme="zeus-code"
        value={value}
        beforeMount={beforeMount}
        options={{
          readOnly: false,
          minimap: { enabled: false },
          fontSize: 11,
          lineHeight: 16,
          fontFamily: '"JetBrains Mono", "Cascadia Code", "Fira Code", Consolas, monospace',
          wordWrap: 'on',
          wrappingIndent: 'indent',
          scrollBeyondLastLine: false,
          padding: { top: 10, bottom: 10 },
          renderLineHighlight: 'line',
          smoothScrolling: true,
          cursorBlinking: 'smooth',
          cursorSmoothCaretAnimation: 'on',
          bracketPairColorization: { enabled: true }
        }}
      />
    </div>
  );
}
