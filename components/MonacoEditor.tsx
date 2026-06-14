'use client';

import { useEffect, useRef } from 'react';
import Editor from '@monaco-editor/react';
import { onThemeChange, getStoredTheme, emitThemeChange } from '@/lib/zeus-monaco/theme';
import { getActiveMonacoTheme, onMonacoThemeChange } from '@/lib/zeus-monaco/monaco-theme-service';

// Antes: loader.config({ paths: { vs: 'https://cdn.jsdelivr.net/...' } }) —
// incompatibile con @codingame/monaco-vscode-api, que necesita Monaco bundleado
// localmente para montar el extension host. Ahora Monaco se bundlea vía
// monaco-editor-webpack-plugin en next.config.js.

interface MonacoEditorProps {
  value: string;
  onChange?: (value: string) => void;
  language?: string;
  height?: string;
  readOnly?: boolean;
  disableDiagnostics?: boolean;
}

// Define custom dark blue theme
const defineCustomTheme = (monaco: any) => {
  monaco.editor.defineTheme('dark-blue', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: '', background: '030712', foreground: 'e2e8f0' },
      { token: 'comment', foreground: '64748b', fontStyle: 'italic' },
      { token: 'keyword', foreground: '38bdf8' },
      { token: 'string', foreground: '4ade80' },
      { token: 'number', foreground: 'fbbf24' },
      { token: 'type', foreground: 'c084fc' },
      { token: 'function', foreground: '60a5fa' },
      { token: 'variable', foreground: 'e2e8f0' },
    ],
    colors: {
      'editor.background': '#030712',
      'editor.foreground': '#e2e8f0',
      'editorCursor.foreground': '#38bdf8',
      'editor.selectionBackground': '#1e3a5f',
      'editor.lineHighlightBackground': '#0a0f1a',
      'editorLineNumber.foreground': '#475569',
      'editorLineNumber.activeForeground': '#38bdf8',
      'editorIndentGuide.background': '#0f172a',
      'editorIndentGuide.activeBackground': '#1e293b',
    },
  });
};

export default function MonacoEditor({
  value,
  onChange,
  language = 'typescript',
  height = '100%',
  readOnly = false,
  disableDiagnostics = false
}: MonacoEditorProps) {
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<any>(null);
  const lastAppliedThemeRef = useRef<string | null>(null);

  const applyStoredTheme = async (monaco: any, force = false) => {
    // Primero intentar obtener el tema desde PocketBase
    const pbTheme = await getActiveMonacoTheme();
    const stored = pbTheme?.themeId || getStoredTheme();
    const themeToApply = stored || 'zeus-dark';

    // Si ya aplicamos este tema y no es forzado, skip
    if (!force && lastAppliedThemeRef.current === themeToApply) {
      return;
    }

    // Verificar si el tema existe en Monaco
    const knownThemes = monaco.editor.getKnownThemes();
    if (knownThemes.includes(themeToApply)) {
      monaco.editor.setTheme(themeToApply);
      lastAppliedThemeRef.current = themeToApply;
      console.log('[MonacoEditor] Tema aplicado:', themeToApply);
    } else {
      // Tema no disponible (probablemente de extensión no cargada aún)
      console.warn('[MonacoEditor] Tema no disponible:', themeToApply, 'Temas conocidos:', knownThemes);
      // Usar zeus-dark como fallback
      monaco.editor.setTheme('zeus-dark');
      lastAppliedThemeRef.current = 'zeus-dark';
    }
  };

  const handleEditorDidMount = async (editor: any, monaco: any) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    console.log('[MonacoEditor] montado. monaco id:', monaco?.editor ? 'ok' : 'no');

    // Inicializar Zeus Monaco y cargar extensiones antes de aplicar el tema
    // Importación dinámica para evitar SSR con Monaco
    try {
      const { initZeusMonaco } = await import('@/lib/zeus-monaco/init');
      const { loadInstalledExtensions } = await import('@/lib/zeus-monaco/extensions');

      await initZeusMonaco();
      await loadInstalledExtensions();

      // Ahora aplicar el tema guardado (las extensiones ya están cargadas)
      await applyStoredTheme(monaco, true);
    } catch (err) {
      console.warn('[MonacoEditor] Error inicializando:', err);
      // Fallback a zeus-dark
      monaco.editor.setTheme('zeus-dark');
    }

    if (disableDiagnostics) {
      const tsServices = monaco.languages.typescript as any;
      const diagOpts = {
        noSemanticValidation: true,
        noSyntaxValidation: true,
        noSuggestionDiagnostics: true
      };

      if (tsServices?.javascriptDefaults) {
        tsServices.javascriptDefaults.setDiagnosticsOptions(diagOpts);
      }
      if (tsServices?.typescriptDefaults) {
        tsServices.typescriptDefaults.setDiagnosticsOptions(diagOpts);
      }

      const model = editor.getModel();
      if (model) {
        monaco.editor.setModelMarkers(model, 'typescript', []);
        monaco.editor.setModelMarkers(model, 'javascript', []);
      }
    }
  };

  // Re-aplicar el tema si cambia en otra parte (p.ej. el ThemePicker
  // lo cambió, o el usuario eligió uno en otra pestaña del IDE).
  useEffect(() => {
    return onThemeChange((themeId) => {
      console.log('[MonacoEditor] onThemeChange received:', themeId, 'monacoRef?', !!monacoRef.current);
      if (monacoRef.current && themeId) {
        try {
          monacoRef.current.editor.setTheme(themeId);
          lastAppliedThemeRef.current = themeId;
          console.log('[MonacoEditor] setTheme OK', themeId);
        } catch (err) {
          console.warn('[MonacoEditor] setTheme falló:', err);
        }
      }
    });
  }, []);

  // Escuchar evento de extensiones cargadas para re-aplicar el tema guardado
  // si el usuario tenía seleccionado un tema de extensión
  useEffect(() => {
    const handleExtensionsChanged = async () => {
      // Obtener tema desde PocketBase primero, luego fallback a localStorage
      const pbTheme = await getActiveMonacoTheme();
      const stored = pbTheme?.themeId || getStoredTheme();

      if (stored && monacoRef.current) {
        // Asegurar que las extensiones estén cargadas (importación dinámica)
        const { loadInstalledExtensions } = await import('@/lib/zeus-monaco/extensions');
        await loadInstalledExtensions();

        const knownThemes = monacoRef.current.editor.getKnownThemes();
        if (knownThemes.includes(stored)) {
          monacoRef.current.editor.setTheme(stored);
          lastAppliedThemeRef.current = stored;
          console.log('[MonacoEditor] Tema de extensión re-aplicado:', stored);
        } else {
          console.warn('[MonacoEditor] Tema aún no disponible después de cargar extensiones:', stored);
        }
      }
    };

    window.addEventListener('zeus:extensions-changed', handleExtensionsChanged);
    return () => window.removeEventListener('zeus:extensions-changed', handleExtensionsChanged);
  }, []);

  // Suscribirse a cambios en tiempo real desde PocketBase
  // Esto permite que al cambiar de pestaña y volver, el tema se mantenga
  useEffect(() => {
    return onMonacoThemeChange((themeId, themeName) => {
      console.log('[MonacoEditor] Tema cambiado en realtime:', themeId);
      if (monacoRef.current) {
        monacoRef.current.editor.setTheme(themeId);
        lastAppliedThemeRef.current = themeId;
        // También actualizar localStorage para fallback
        emitThemeChange(themeId);
      }
    });
  }, []);

  return (
    <div className="h-full">
      <Editor
        height={height}
        defaultLanguage={language}
        value={value}
        onChange={(value) => onChange?.(value || '')}
        beforeMount={defineCustomTheme}
        onMount={handleEditorDidMount}
        options={{
          fontSize: 14,
          lineNumbers: 'on',
          roundedSelection: false,
          scrollBeyondLastLine: false,
          automaticLayout: true,
          readOnly,
          padding: { top: 16, bottom: 16 },
          fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
          wordWrap: 'on',
          wrappingIndent: 'indent',
          renderLineHighlight: 'line',
          smoothScrolling: true,
          cursorBlinking: 'smooth',
          cursorSmoothCaretAnimation: 'on',
          minimap: {
            enabled: true,
            side: 'right',
            showSlider: 'always'
          },
          bracketPairColorization: { enabled: true },
          renderValidationDecorations: disableDiagnostics ? 'off' : 'on'
        }}
      />
    </div>
  );
}
