/**
 * Host de extensiones propio de Zeus.
 *
 * Sustituye a `@codingame/monaco-vscode-api` (que no bundlea correctamente
 * con Next.js 16). En vez de ejecutar el código de las extensiones, este
 * host lee los `contributes.*` del `package.json` de cada .vsix y los
 * aplica directamente sobre la API estándar de Monaco.
 *
 * Capacidades soportadas en v1 (ver plan):
 *   - themes         → monaco.editor.defineTheme()
 *   - grammars       → setLanguageConfiguration() (TextMate scoping básico)
 *   - snippets       → monaco.languages.registerCompletionItemProvider()
 *   - languages      → monaco.languages.register()
 *   - keybindings    → monaco.editor.addCommand() (con keybindings)
 *   - commands       → registro en tabla interna (no se ejecutan)
 *
 * No soportado: configuration, menus, views, webviews, **ejecución del
 * código de la extensión** (entry point `main`).
 *
 * El host se inicializa UNA vez (singleton) con `bindMonaco()`. Después,
 * `register()` aplica una extensión y `unload(key)` la desactiva.
 *
 * Modelo de datos:
 *   LoadedExtension.files = Map<"ruta virtual" (e.g. "extension/themes/x.json"), contenido:string>
 *   El caller (extensions.ts) hace el read de los archivos vía IPC de forma
 *   ASÍNCRONA y luego pasa el contenido ya cargado al host. Esto evita el
 *   problema de "no puedo hacer I/O síncrono desde apply*()".
 */

import type * as monacoTypes from 'monaco-editor';

// =============================================================================
// Tipos del manifest (subset relevante para v1)
// =============================================================================

export interface ThemeContribution {
  id: string;
  label: string;
  uiTheme: 'vs' | 'vs-dark' | 'hc-black' | 'hc-light';
  path: string;
}

export interface GrammarContribution {
  language: string;
  scopeName: string;
  path: string;
  /** Configuración del lenguaje (opcional, se carga si existe). */
  languageConfigurationPath?: string;
  /** Aliases secundarios que la extensión registra. */
  aliases?: string[];
  /** Mapeo fileExtension → scopeName (opcional, override del manifest). */
  injectTo?: string[];
}

export interface SnippetContribution {
  language: string;
  path: string;
}

export interface LanguageContribution {
  id: string;
  aliases?: string[];
  extensions?: string[];
  filenames?: string[];
  filenamePatterns?: string[];
  configuration?: string;
  firstLine?: string;
  icon?: { light?: string; dark?: string };
}

export interface CommandContribution {
  command: string;
  title: string;
  category?: string;
  icon?: { light?: string; dark?: string };
}

export interface KeybindingContribution {
  command: string;
  key: string;
  when?: string;
  mac?: string;
  linux?: string;
  win?: string;
}

export interface ParsedManifest {
  name: string;
  displayName?: string;
  description?: string;
  version: string;
  publisher: string;
  engines?: { vscode?: string };
  contributes?: {
    themes?: ThemeContribution[];
    grammars?: GrammarContribution[];
    snippets?: SnippetContribution[];
    languages?: LanguageContribution[];
    commands?: CommandContribution[];
    keybindings?: KeybindingContribution[];
    configuration?: unknown;
  };
  main?: string;
}

// =============================================================================
// Extensión cargada
// =============================================================================

export interface LoadedExtension {
  /** "publisher.name" */
  id: string;
  version: string;
  /** namespace (publisher) */
  namespace: string;
  /** name (última parte del id) */
  name: string;
  /** "publisher.name@version" — clave única para el Map */
  key: string;
  displayName: string;
  description: string;
  categories: string[];
  manifest: ParsedManifest;
  /**
   * Mapa "ruta virtual dentro del .vsix" (e.g. "extension/themes/x.json")
   * → "contenido del archivo en string".
   *
   * Las claves pueden tener o no prefijo "/". El lookup prueba ambas formas.
   */
  files: Map<string, string>;
}

// =============================================================================
// Host
// =============================================================================

class ZeusExtensionHostImpl {
  private monaco: typeof monacoTypes | null = null;
  /** Si ya tenemos un bind "estable" (típicamente: la instancia del editor
   * real), no aceptamos rebinds desde otros lugares (init.ts, etc.). Esto
   * evita que el Marketplace cargue extensiones sobre la instancia webpack
   * bundleada, que es diferente de la instancia que usa el editor. */
  private monacoLocked = false;
  /** Mapa "publisher.name@version" → LoadedExtension */
  private loaded = new Map<string, LoadedExtension>();
  /** ID de extensión → disposable[] de Monaco (providers, etc.) */
  private disposableByExt = new Map<string, monacoTypes.IDisposable[]>();
  /** commandId → CommandContribution (solo registro, no se ejecuta el handler) */
  private commandRegistry = new Map<string, CommandContribution>();

  /**
   * Vincula la instancia de Monaco. Llamar UNA sola vez al inicio de la app.
   *
   * Importante: el primer `Editor` que se monte debe llamar a esta función
   * y marcase como "instancia estable" (`lockMonaco()` después del bind).
   * Una vez bloqueada, las llamadas subsiguientes son NO-OP — incluso si
   * `init.ts` intenta re-bindear con su instancia webpack. Esto evita
   * perder las definiciones de tema que el editor ya tiene.
   *
   * Si la llamada es un rebind (escenario: el editor se monta después de
   * que `init.ts` ya bindeó la instancia webpack), re-vinculamos y
   * re-aplicamos TODAS las extensiones registradas para que vivan en la
   * nueva instancia (la del editor).
   */
  bindMonaco(monaco: typeof monacoTypes): void {
    if (this.monaco === monaco) return;
    if (this.monacoLocked) {
      // Ya hay un bind estable (la instancia del editor). Ignorar.
      console.log('[zeus-host] bindMonaco ignorado — instancia ya bloqueada');
      return;
    }
    const previous = this.monaco;
    this.monaco = monaco;
    if (previous != null) {
      console.log('[zeus-host] rebind — re-aplicando', this.loaded.size, 'extensión(es)');
      this.disposableByExt.clear();
      for (const ext of this.loaded.values()) {
        try {
          const disposables: monacoTypes.IDisposable[] = [];
          this.applyContributes(ext, disposables);
          this.disposableByExt.set(ext.key, disposables);
        } catch (err) {
          console.warn(`[zeus-host] re-apply de ${ext.id} falló:`, err);
        }
      }
    }
  }

  /**
   * Marca la instancia actual como "estable": a partir de aquí, bindMonaco()
   * ignorará rebinds. Llamar desde el `beforeMount` del primer editor que
   * se monte (CodeEditor), justo después del bindMonaco().
   */
  lockMonaco(): void {
    if (this.monaco != null) this.monacoLocked = true;
  }

  /**
   * ¿El host está listo para registrar extensiones?
   */
  isReady(): boolean {
    return this.monaco != null;
  }

  /**
   * Registra una extensión. Si ya estaba cargada la misma versión, no hace nada
   * (idempotente). Si hay otra versión del mismo id, la nueva reemplaza a la
   * anterior (mismo comportamiento que VS Code).
   */
  async register(ext: LoadedExtension): Promise<void> {
    if (!this.monaco) {
      throw new Error('ZeusExtensionHost: bindMonaco() no se ha llamado');
    }

    if (this.loaded.has(ext.key)) {
      return;
    }

    // Si hay otra versión del mismo id, descargar la anterior
    const sameIdDifferentVersion = Array.from(this.loaded.keys()).find(
      (k) => k.startsWith(ext.id + '@') && k !== ext.key,
    );
    if (sameIdDifferentVersion) {
      await this.unload(sameIdDifferentVersion);
    }

    this.loaded.set(ext.key, ext);
    const disposables: monacoTypes.IDisposable[] = [];

    try {
      this.applyContributes(ext, disposables);
      this.disposableByExt.set(ext.key, disposables);
    } catch (err) {
      this.disposeAll(disposables);
      this.loaded.delete(ext.key);
      throw err;
    }
  }

  /**
   * Descarga una extensión (libera sus disposables y limpia registros).
   * `key` es "publisher.name@version".
   */
  async unload(key: string): Promise<void> {
    const ext = this.loaded.get(key);
    if (!ext) return;

    const disposables = this.disposableByExt.get(key) ?? [];
    this.disposeAll(disposables);
    this.disposableByExt.delete(key);

    const c = ext.manifest.contributes ?? {};
    if (c.commands) {
      for (const cmd of c.commands) {
        this.commandRegistry.delete(cmd.command);
      }
    }

    this.loaded.delete(key);
  }

  /**
   * Lista de extensiones actualmente cargadas.
   */
  list(): LoadedExtension[] {
    return Array.from(this.loaded.values());
  }

  /**
   * Mapa de comandos registrados (para la UI de "Comandos instalados").
   */
  getCommands(): CommandContribution[] {
    return Array.from(this.commandRegistry.values());
  }

  /**
   * Temas registrados por las extensiones instaladas.
   * Devuelve `{ id, label, uiTheme, extensionId }` por cada `contributes.themes[]`.
   *
   * NOTA: `monaco.editor.defineTheme()` ya se ha llamado durante `register()`
   * para cada uno. El ThemePicker solo necesita enumerarlos para que el
   * usuario elija uno y llame a `monaco.editor.setTheme(id)`.
   */
  getRegisteredThemes(): { id: string; label: string; uiTheme: string; extensionId: string; extensionDisplayName: string }[] {
    const out: { id: string; label: string; uiTheme: string; extensionId: string; extensionDisplayName: string }[] = [];
    for (const ext of this.loaded.values()) {
      const themes = ext.manifest.contributes?.themes ?? [];
      for (const t of themes) {
        // Sincronizar con el id seguro que applyTheme usó (puede haberlo
        // sanitizado). Si el id sigue siendo vacío o con caracteres no
        // seguros, lo saltamos — el ThemePicker no debe mostrar entradas
        // inválidas que al seleccionarlas pasarían `undefined`.
        const safeId = sanitizeThemeId(t.id, t.label, ext.id, t.path);
        if (!safeId) continue;
        t.id = safeId;
        out.push({
          id: safeId,
          label: t.label || safeId,
          uiTheme: t.uiTheme || 'vs-dark',
          extensionId: ext.id,
          extensionDisplayName: ext.displayName || ext.id,
        });
      }
    }
    return out;
  }

  // ===========================================================================
  // Privados: aplicación de contributes
  // ===========================================================================

  /**
   * Aplica todos los `contributes.*` de una extensión a la instancia actual
   * de Monaco. Usado tanto por `register()` (primera vez) como por
   * `bindMonaco()` (rebind tras cambiar de instancia Monaco).
   *
   * Los disposables (themes, snippets, keybindings) se van acumulando en
   * el array `disposables` que pasa el llamador, para poder liberarlos en
   * `unload()` o en un rebind posterior.
   */
  private applyContributes(
    ext: LoadedExtension,
    disposables: monacoTypes.IDisposable[],
  ): void {
    const c = ext.manifest.contributes ?? {};

    if (c.themes) {
      for (const theme of c.themes) {
        const d = this.applyTheme(theme, ext);
        if (d) disposables.push(d);
      }
    }

    if (c.grammars) {
      for (const grammar of c.grammars) {
        this.applyGrammar(grammar, ext);
      }
    }

    if (c.languages) {
      for (const lang of c.languages) {
        this.applyLanguage(lang, ext);
      }
    }

    if (c.snippets) {
      for (const snippet of c.snippets) {
        const d = this.applySnippets(snippet, ext);
        if (d) disposables.push(d);
      }
    }

    if (c.commands) {
      for (const cmd of c.commands) {
        this.commandRegistry.set(cmd.command, cmd);
      }
    }

    if (c.keybindings) {
      for (const kb of c.keybindings) {
        const d = this.applyKeybinding(kb);
        if (d) disposables.push(d);
      }
    }
  }

  /**
   * Resuelve un path del manifest a contenido. Acepta tanto "themes/x.json"
   * como "/themes/x.json" como "extension/themes/x.json" (los manifests
   * de VS Code a veces usan prefijos distintos).
   */
  private resolveFile(ext: LoadedExtension, manifestPath: string): string | null {
    const candidates = [
      manifestPath,
      manifestPath.replace(/^\//, ''),
      `extension/${manifestPath.replace(/^\//, '')}`,
    ];
    for (const c of candidates) {
      const content = ext.files.get(c);
      if (content != null) return content;
    }
    return null;
  }

  private applyTheme(
    theme: ThemeContribution,
    ext: LoadedExtension,
  ): monacoTypes.IDisposable | null {
    if (!this.monaco) return null;

    // Monaco lanza "Illegal theme name!" si el id contiene caracteres no
    // permitidos (paréntesis, espacios, etc.). Sanitizamos a un id seguro
    // basado en el id original (si existe) o derivamos uno del label/path.
    // Esto es seguro porque `getRegisteredThemes()` y el ThemePicker usan
    // el id retornado por esta función, que sincronizamos vía `theme.id`.
    const safeId = sanitizeThemeId(theme.id, theme.label, ext.id, theme.path);
    if (safeId == null) {
      console.warn(`[zeus-host] ${ext.id}: tema sin id válido (label="${theme.label}", path="${theme.path}")`);
      return null;
    }

    const raw = this.resolveFile(ext, theme.path);
    if (raw == null) {
      console.warn(`[zeus-host] ${ext.id}: theme "${theme.id}" no encontrado (${theme.path})`);
      return null;
    }

    let themeData: any;
    try {
      themeData = JSON.parse(stripJsonComments(raw));
    } catch (err) {
      console.warn(`[zeus-host] ${ext.id}: theme JSON inválido ${theme.path}`, err);
      return null;
    }

    try {
      const tokenColors: monacoTypes.editor.ITokenThemeRule[] = Array.isArray(themeData.tokenColors)
        ? themeData.tokenColors.map((rule: any) => ({
            token: typeof rule === 'string' ? rule : rule.scope,
            foreground: rule.settings?.foreground,
            background: rule.settings?.background,
            fontStyle: rule.settings?.fontStyle,
          }))
        : [];

      const colors = themeData.colors || {};
      this.monaco.editor.defineTheme(safeId, {
        base: this.normalizeBase(themeData.type ?? theme.uiTheme),
        inherit: themeData.inherit ?? true,
        rules: tokenColors,
        colors: this.normalizeColors(colors),
      });
      // Sobrescribimos el id en el theme contribution para que getRegisteredThemes
      // devuelva el id correcto (sincronizado con el que se acaba de registrar).
      theme.id = safeId;
    } catch (err) {
      console.warn(`[zeus-host] ${ext.id}: defineTheme falló para ${theme.id}`, err);
      return null;
    }

    return { dispose: () => {} };
  }

  private normalizeBase(t: string): monacoTypes.editor.BuiltinTheme {
    switch (t) {
      case 'light':
      case 'vs':
        return 'vs';
      case 'dark':
      case 'vs-dark':
        return 'vs-dark';
      case 'hc-black':
        return 'hc-black';
      case 'hc-light':
        return 'hc-light';
      default:
        return 'vs-dark';
    }
  }

  private normalizeColors(colors: Record<string, string>): monacoTypes.editor.IColors {
    return colors;
  }

  private applyGrammar(grammar: GrammarContribution, ext: LoadedExtension): void {
    if (!this.monaco) return;

    const raw = this.resolveFile(ext, grammar.path);
    if (raw == null) {
      console.warn(`[zeus-host] ${ext.id}: grammar "${grammar.language}" no encontrado (${grammar.path})`);
      return;
    }

    let grammarData: any;
    try {
      grammarData = JSON.parse(stripJsonComments(raw));
    } catch (err) {
      console.warn(`[zeus-host] ${ext.id}: grammar JSON inválido ${grammar.path}`, err);
      return;
    }

    // Sin monaco-textmate no podemos tokenizar TextMate completo. Lo que sí
    // podemos: cargar la language configuration (comentarios, brackets,
    // autoclose) para que el editor respete la sintaxis básica declarada en
    // la grammar. Para highlighting TextMate real, instalar
    // monaco-textmate como mejora futura.
    try {
      this.monaco.languages.setLanguageConfiguration(grammar.language, {
        comments: { lineComment: '//', blockComment: ['/*', '*/'] },
        brackets: [
          ['{', '}'], ['[', ']'], ['(', ')'],
        ],
        autoClosingPairs: [
          { open: '{', close: '}' }, { open: '[', close: ']' },
          { open: '(', close: ')' }, { open: '"', close: '"' },
          { open: "'", close: "'" }, { open: '`', close: '`' },
        ],
      });
    } catch (err) {
      console.warn(`[zeus-host] ${ext.id}: setLanguageConfiguration falló para ${grammar.language}`, err);
    }

    // language-configuration.json opcional referenciada desde la grammar
    if (grammar.languageConfigurationPath) {
      const cfgRaw = this.resolveFile(ext, grammar.languageConfigurationPath);
      if (cfgRaw) {
        try {
          const config = JSON.parse(stripJsonComments(cfgRaw));
          this.monaco.languages.setLanguageConfiguration(grammar.language, {
            comments: config.comments,
            brackets: config.brackets,
            autoClosingPairs: config.autoClosingPairs,
            surroundingPairs: config.surroundingPairs,
            folding: config.folding,
            wordPattern: config.wordPattern,
            indentationRules: config.indentationRules,
          });
        } catch {
          // Ya tenemos una config por defecto; ignorar
        }
      }
    }
  }

  private applyLanguage(lang: LanguageContribution, ext: LoadedExtension): void {
    if (!this.monaco) return;

    try {
      this.monaco.languages.register({
        id: lang.id,
        aliases: lang.aliases,
        extensions: lang.extensions,
        filenames: lang.filenames,
        filenamePatterns: lang.filenamePatterns,
        firstLine: lang.firstLine,
      });
    } catch (err) {
      if (!(err as Error).message?.includes('already registered')) {
        console.warn(`[zeus-host] ${ext.id}: register(${lang.id}) falló`, err);
      }
    }

    if (lang.configuration) {
      const raw = this.resolveFile(ext, lang.configuration);
      if (raw) {
        try {
          const config = JSON.parse(stripJsonComments(raw));
          this.monaco.languages.setLanguageConfiguration(lang.id, {
            comments: config.comments,
            brackets: config.brackets,
            autoClosingPairs: config.autoClosingPairs,
            surroundingPairs: config.surroundingPairs,
            folding: config.folding,
            wordPattern: config.wordPattern,
            indentationRules: config.indentationRules,
          });
        } catch (err) {
          console.warn(`[zeus-host] ${ext.id}: language config ${lang.configuration} falló`, err);
        }
      }
    }
  }

  private applySnippets(
    snippet: SnippetContribution,
    ext: LoadedExtension,
  ): monacoTypes.IDisposable | null {
    if (!this.monaco) return null;

    const raw = this.resolveFile(ext, snippet.path);
    if (raw == null) {
      console.warn(`[zeus-host] ${ext.id}: snippet "${snippet.language}" no encontrado (${snippet.path})`);
      return null;
    }

    let data: Record<string, { prefix: string | string[]; body: string | string[]; description?: string }>;
    try {
      data = JSON.parse(stripJsonComments(raw));
    } catch (err) {
      console.warn(`[zeus-host] ${ext.id}: snippet JSON inválido ${snippet.path}`, err);
      return null;
    }

    const language = snippet.language;
    const snippets = Object.entries(data).map(([name, entry]) => {
      const prefix = Array.isArray(entry.prefix) ? entry.prefix[0] : entry.prefix;
      const body = Array.isArray(entry.body) ? entry.body.join('\n') : entry.body;
      return {
        label: prefix,
        detail: name,
        description: entry.description || name,
        insertText: body,
        insertTextRules: this.monaco!.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        kind: this.monaco!.languages.CompletionItemKind.Snippet,
        range: undefined as any,
      };
    });

    if (snippets.length === 0) return null;

    const provider = this.monaco.languages.registerCompletionItemProvider(language, {
      provideCompletionItems: (model, position) => {
        const word = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        };
        return {
          suggestions: snippets.map((s) => ({ ...s, range })),
        };
      },
      triggerCharacters: ['.', ':', ' '],
    });

    return provider;
  }

  private applyKeybinding(kb: KeybindingContribution): monacoTypes.IDisposable | null {
    if (!this.monaco) return null;

    // En v1, registramos el comando por id y dejamos el keybinding visible
    // solo a nivel informativo (no podemos añadir atajos globales sin un
    // editor concreto). Si el usuario lo invocara por código, se loguea.
    try {
      this.monaco.editor.addCommand({
        id: `zeus-ext:${kb.command}`,
        run: () => {
          console.info(`[zeus-host] Comando ${kb.command} (keybinding: ${kb.key}) — no implementado en v1`);
        },
      });
    } catch (err) {
      console.warn(`[zeus-host] addCommand falló para keybinding ${kb.key}:`, err);
      return null;
    }

    return { dispose: () => {} };
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  private disposeAll(disposables: monacoTypes.IDisposable[]): void {
    for (const d of disposables) {
      try {
        d.dispose();
      } catch (err) {
        console.warn('[zeus-host] disposable.dispose() falló:', err);
      }
    }
  }
}

/**
 * Convierte un id de tema arbitrario en un id seguro para Monaco.
 *
 * Monaco exige que el id del tema coincida con `[a-zA-Z0-9_-]+`. Si el
 * id del manifest tiene espacios, paréntesis u otros caracteres, lo
 * sanitizamos. Si el id es vacío o solo tiene caracteres no permitidos,
 * derivamos uno del label, del path, o del id de la extensión.
 */
function sanitizeThemeId(
  id: string | undefined | null,
  label: string | undefined | null,
  extensionId: string,
  path: string,
): string | null {
  const fromSource = (s: string | undefined | null): string | null => {
    if (!s) return null;
    // Reemplazar todo lo que no sea [a-zA-Z0-9_-] por `-` y recortar.
    const cleaned = s
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return cleaned || null;
  };
  // 1) id del manifest
  let safe = fromSource(id);
  if (safe) return safe;
  // 2) label del tema
  safe = fromSource(label);
  if (safe) return safe;
  // 3) nombre del archivo (sin extensión, sin carpetas)
  const baseName = path.split('/').pop() || '';
  safe = fromSource(baseName.replace(/\.jsonc?$/i, ''));
  if (safe) return `${extensionId}-${safe}`;
  // 4) Fallback
  return `${extensionId}-theme`;
}

function stripJsonComments(s: string): string {
  // VS Code usa JSONC (con // y /* */ comentarios) en language-configuration.json
  // y a veces en grammars/*.json. Hacemos un strip simple.
  // IMPORTANTE: hay que eliminar // inline (al final de una línea tras un valor)
  // y no solo los que están al inicio. La regex `\s+//.*$` con `gm` los captura.
  // Truco: partimos el string carácter a carácter con un mini-parser que solo
  // rastrea strings y comentarios, para no tocar `//` que aparezca dentro de
  // un string (p.ej. "https://example.com"). Esto es un parser JSONC minimal
  // suficiente para los theme files de VS Code.
  let out = '';
  let i = 0;
  const n = s.length;
  let inString = false;
  let stringQuote = '';
  while (i < n) {
    const c = s[i];
    const c2 = s[i + 1];
    if (inString) {
      out += c;
      if (c === '\\' && i + 1 < n) {
        out += c2;
        i += 2;
        continue;
      }
      if (c === stringQuote) inString = false;
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      inString = true;
      stringQuote = c;
      out += c;
      i++;
      continue;
    }
    if (c === '/' && c2 === '/') {
      // Comentario de línea: saltar hasta el final de línea (sin emitir el \n)
      while (i < n && s[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && c2 === '*') {
      // Comentario de bloque: saltar hasta */
      i += 2;
      while (i < n && !(s[i] === '*' && s[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  // Quitar trailing commas (, o ; antes de } o ])
  return out.replace(/,(\s*[}\]])/g, '$1');
}

export const host = new ZeusExtensionHostImpl();
