# ZEUS IA — Contexto Completo para Modelo de IA

> **Documento generado el 2026-06-03**  
> **Versión de la app:** Zeus IA (Next.js 16 + Electron 41 + Express API)  
> **Propósito:** Pipeline de contexto para modelo de IA. Incluye arquitectura, happy paths, endpoints REST/HTTP, idiomas, integraciones, prompts del sistema y capacidades operativas.

---

## 1. IDENTIDAD DE LA APLICACIÓN

**Nombre:** Zeus IA  
**Tipo:** IDE / Studio de desarrollo con asistencia de IA, empaquetado como aplicación de escritorio multiplataforma (Windows, macOS, Linux).  
**Frontend:** Next.js 16 (App Router) + React 19 + TypeScript + Tailwind CSS + shadcn/ui + Radix UI + Framer Motion  
**Backend local:** Express.js (puerto 8742)  
**Backend datos:** PocketBase (local 8091 / remoto `zeus-basedatos.fly.dev`)  
**Persistencia local adicional:** Prisma + SQLite (modelo `User` mínimo)  
**Capa escritorio:** Electron 41 (proceso principal arranca todos los servicios)  
**Terminal integrada:** Servidor WebSocket `node-pty` (puerto 3351)  
**Panel auxiliar:** Vite + React (`panel-central/`, puerto 8743) — AI Studio / Preview  
**Sistema de traducción:** 4 idiomas activos:
- `en` — Inglés (completo, ~970 claves en `translations.ts`)
- `es` — Español (completo, ~970 claves en `translations.ts`)
- `fr` — Francés (i18n.ts, diccionario reducido)
- `de` — Alemán (i18n.ts, diccionario reducido)

---

## 2. ARQUITECTURA GENERAL

```
┌─────────────────────────────────────────────┐
│           Electron Main Process             │
│  - Crea ventana                             │
│  - Gestiona IPC (clipboard, zoom, diálogos) │
│  - Arranca automáticamente:                 │
│       1) Next.js        → http://localhost:8741
│       2) Express API    → http://localhost:8742
│       3) Terminal WS    → ws://localhost:3351
│       4) PocketBase     → http://localhost:8091
│       5) Panel Central  → http://localhost:8743
│       6) API RAE        → http://localhost:3011
│       7) Preview Server → (puerto dinámico)
│       8) Formatter      → (puerto dinámico)
└─────────────────────────────────────────────┘
                    │
    ┌───────────────┼───────────────┐
    ▼               ▼               ▼
┌─────────┐   ┌──────────┐   ┌────────────┐
│ Next.js │   │ Express  │   │ PocketBase │
│   App   │   │   API    │   │  (DB+Auth) │
│ 8741    │   │  8742    │   │ 8091/fly   │
└─────────┘   └──────────┘   └────────────┘
    │               │               │
    ▼               ▼               ▼
┌─────────┐   ┌──────────┐   ┌────────────┐
│ App     │   │ Files    │   │ Colecciones│
│ Router  │   │ Plans    │   │ - ai_models│
│ pages/  │   │ Terminal │   │ - conv.    │
│ api/    │   │ Schemas  │   │ - messages │
│ hooks/  │   │ Deploy   │   │ - projects │
│         │   │ Git/GitHub│   │ - pipeline │
└─────────┘   └──────────┘   └────────────┘
```

---

## 3. HAPPY PATHS (FLUJOS PRINCIPALES)

### HP-1: Chat con IA y persistencia
1. Usuario selecciona modelo IA desde el selector superior (OpenAI / Deepseek / Ollama / LM Studio).
2. Escribe mensaje en el chat flotante (`FloatingChatButton`).
3. Se envía `POST /api/chat` con: `provider`, `model`, `newMessage`, `history`, `conversationId`, `projectId`, `userId`.
4. El backend puede redirigir a pipeline externo si hay `pipeline_configs` activo en PocketBase (`http://localhost:3011/api/v1/chat/pipeline`).
5. Si el modelo emite `[WEB_SEARCH]consulta[/WEB_SEARCH]`, se ejecuta búsqueda Tavily y se reinyectan resultados.
6. La respuesta se muestra en el chat; se persiste en PocketBase (`conversations`, `messages`).
7. Usuario puede restaurar conversaciones desde `ChatHistorySidebar`.

### HP-2: Generación de aplicación en dos pasos (TwoStepAppGenerator)
1. **Paso 1 — Configuración:**
   - Usuario introduce nombre, descripción, plantilla (`next-js`, `vite-react`, `vue-nuxt`, `svelte-kit`, `angular`, `fastapi-py`, `react-native`, `html-css-js`).
   - Opcional: activar despliegue de PocketBase en Fly.io.
   - Puede mejorar descripción con IA (`POST /api/generate-prompt`).
   - Puede añadir páginas personalizadas, subir recursos (archivos/imágenes), buscar imágenes en Unsplash.
2. **Generar estructura:** `POST /api/generate-app/structure` → IA devuelve lista de archivos/directorios.
3. **Paso 2 — Contenido:**
   - `POST /api/generate-app/content` (streaming SSE) → IA genera contenido archivo por archivo.
   - Se crean archivos en disco; se muestra progreso en terminal integrada.
   - Correcciones automáticas post-generación (`correct-file`, `fix-missing-imports`, `validate-components`).
   - Se guarda ZIP en PocketBase (`project_archive`, `project_archive_backup`).
4. **Preview:** se inicia servidor dev (`npm run dev`) y se carga vista previa en iframe/panel.

### HP-3: Explorador de archivos + IDE
1. Usuario navega carpetas vía `GET /api/ide-files?path=...` o `GET /api/folders`.
2. Selecciona archivo → se carga en Monaco Editor (`@monaco-editor/react`).
3. Edita contenido → `PUT /api/ide-files` (action=`save`) o `POST /api/save-file`.
4. Backup automático: cada guardado crea `.zeus-backup`.
5. Operaciones contextuales desde IDE Tab:
   - Formatear código
   - Corregir código (`POST /api/correct-file-code`)
   - Fix imports (`POST /api/fix-missing-imports`)
   - Validar componentes (`POST /api/validate-components`)
   - Fix dependencias (`POST /api/fix-dependencies`)
   - Generar icono (`POST /api/generate-icon`)
   - Ver esquema (`GET /api/schema/simple`)
6. Ejecutar dev server / build desde la UI (`npm run dev` / `npm run build`).

### HP-4: Gestión de planes de trabajo (Plans & Tasks)
1. Usuario crea plan: `POST /api/plan` (name, description, model_id).
2. Añade tareas al plan (crear archivo, actualizar archivo, crear carpeta).
3. Tareas pueden ejecutarse directamente (`POST /api/plan/tasks/create`) o guardarse para luego.
4. Ejecutar plan completo: `POST /api/plan/execute` (planName, force).
5. Sistema de rollback disponible.
6. Planes persisten en archivos JSON locales y sincronizan con PocketBase (`structure_plans`).

### HP-5: Generación y testeo de APIs
1. Usuario describe API deseada.
2. `POST /api/generate-api/generate` → IA genera código de API.
3. Guardar configuración: `POST /api/generate-api/save-config`.
4. Testeo: `POST /api/generate-api/test/:id`.
5. Proyectos API guardados en PocketBase (`projects_api`).

### HP-6: Despliegue PocketBase en Fly.io
1. Usuario obtiene token de organización de Fly.io.
2. Rellena formulario: appName, region, memory, orgId, adminEmail, adminPassword, pocketbaseVersion.
3. `POST /api/deploy` → backend orquesta:
   - Crear app en Fly.io
   - Asignar IPv6 (`flyctl ips allocate-v6`)
   - Crear volumen
   - Desplegar máquina Debian con PocketBase descargado desde GitHub Releases
   - Opcional: importar esquema desde `pb_schema.json`
4. Ver estado en panel de despliegue; puede reiniciar máquina, actualizar datos, abrir admin panel.

### HP-7: Autenticación y gestión de modelos IA
1. Registro/login de usuarios en PocketBase (email/password).
2. Usuario registra modelos IA personalizados:
   - `POST /api/modelos` → guarda en PocketBase (`ai_models`)
   - Campos: provider, model_name, base_url, api_key, type (remote/local)
3. Modelos listados y seleccionables desde la UI superior.

### HP-8: Git local + GitHub remoto (IDE)
1. **Panel Git local:**
   - `GitPanel.tsx` detecta repositorios `.git` automáticamente, incluso si el explorador navega a subcarpetas (`resolveGitDir` en backend sube por padres hasta encontrar `.git`, restringido a `DATA_PATH`).
   - Muestra: branch activa, upstream, ahead/behind, staged/unstaged, diff inline, historial de commits, lista de ramas.
   - Operaciones: `init`, `add`, `restore --staged`, `commit`, `push`, `pull`, `checkout`, `branch`, `config` (user.name / user.email).
   - `runGit` tiene timeout de 15 s para evitar hangs del CLI.
2. **Modal GitHub (`GitHubModal.tsx`):**
   - **Auth:** almacena PAT (`ZEUS_GITHUB_TOKEN`) en `localStorage`; valida contra `https://api.github.com/user`.
   - **Mis Repos:** lista repositorios del usuario vía GitHub API (`/user/repos`, hasta 100, ordenados por `updated`). Detecta automáticamente proyectos **Next.js** leyendo `package.json` desde `raw.githubusercontent.com` (caché en `localStorage`).
   - **Nuevo Repo:** crea repo vacío en GitHub y sube archivos actuales vía API REST directa (blobs → trees → commits → refs) sin depender del CLI de git.
   - **Subir Cambios:** actualiza repo existente con la misma estrategia de upload directo.
   - **Clonar:** `git clone --depth 1` (retiene `.git`) con fallback ZIP (`jszip`) si git CLI falla.
3. **Botón GitHub en header:** icono verde (`GitHubSvg`) en `app/page.tsx`, abre el modal directamente.
4. **Proxy Next.js:** `next.config.js` redirige `/api/git/*` y `/api/github/*` a `http://localhost:8742` para evitar 404 en desarrollo.

### HP-9: Comparación de carpetas / código
1. `app/compara-carpetas/` — escaneo recursivo de dos carpetas, comparación lado a lado.
2. `app/compara-code/` — comparación de bloques de código (diff).

---

## 4. ENDPOINTS REST — SERVIDOR EXPRESS (Puerto 8742)

Base URL: `http://localhost:8742/api`

### 4.1. Folders (`/api/folders`)
| Método | Ruta | Body / Query | Descripción |
|--------|------|--------------|-------------|
| POST   | `/` | `{ name, path, [planName], [saveToPlan] }` | Crear carpeta |
| GET    | `/` | `?path=...` | Listar carpetas |
| PUT    | `/:name` | `{ newName, path, [planName], [saveToPlan] }` | Renombrar carpeta |
| DELETE | `/:name` | `?path=...&[planName]&[saveToPlan]` | Borrar carpeta |

### 4.2. Files (`/api/files`)
| Método | Ruta | Body / Query | Descripción |
|--------|------|--------------|-------------|
| POST   | `/` | `{ name, extension, path, [content], [planName], [saveToPlan] }` | Crear archivo |
| GET    | `/:name` | `?path=...&[raw=1]` | Ver archivo |
| GET    | `/` | `?path=...` | Listar archivos |
| PUT    | `/:name` | `{ path, [content], [newName], [planName], [saveToPlan] }` | Actualizar/renombrar |
| DELETE | `/:name` | `?path=...&[planName]&[saveToPlan]` | Borrar archivo |

### 4.3. Lines (subruta de files: `/api/files/:name/lines`)
| Método | Ruta | Body / Query | Descripción |
|--------|------|--------------|-------------|
| GET    | `/` | `?path=&startLine=&endLine=` | Ver líneas específicas |
| GET    | `/list` | `?path=` | Listar todas las líneas numeradas |
| POST   | `/` | `{ path, [lineNumber], content, [planName], [saveToPlan] }` | Insertar líneas |
| PUT    | `/:lineNumber` | `{ path, content, [numLines], [planName], [saveToPlan] }` | Sustituir líneas |
| DELETE | `/:lineNumber` | `?path=&[numLines]` | Borrar líneas |

### 4.4. Characters (subruta de líneas: `/api/files/:name/lines/:lineNumber/chars`)
| Método | Ruta | Body / Query | Descripción |
|--------|------|--------------|-------------|
| GET    | `/` | `?path=&startCharIndex=&endCharIndex=` | Ver caracteres |
| GET    | `/list` | `?path=` | Listar todos los caracteres de línea |
| POST   | `/` | `{ path, position, content, [planName], [saveToPlan] }` | Insertar caracteres |
| PUT    | `/` | `{ path, startCharIndex, endCharIndex, content, [planName], [saveToPlan] }` | Sustituir caracteres |
| DELETE | `/` | `?path=&startCharIndex=&endCharIndex=` | Borrar caracteres |

### 4.5. Commands (`/api/commands`)
| Método | Ruta | Body | Descripción |
|--------|------|------|-------------|
| POST   | `/run` | `{ command, [path] }` | Ejecutar comando del sistema |

### 4.6. Config (`/api/config`)
| Método | Ruta | Body / Respuesta | Descripción |
|--------|------|------------------|-------------|
| POST   | `/config/data-path` | `{ dataPath }` | Actualizar `DATA_PATH` en `.env` |
| GET    | `/config/data-path` | `{ dataPath }` | Obtener `DATA_PATH` actual |

### 4.7. History (`/api/history`)
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET    | `/files/:name/history` | Historial de cambios de archivo |
| POST   | `/files/:name/undo` | Deshacer último cambio |
| GET    | `/history/files` | Listar archivos con historial |

### 4.8. Plan (`/api/plan`)
| Método | Ruta | Body / Query | Descripción |
|--------|------|--------------|-------------|
| GET    | `/list` | — | Lista simplificada de planes |
| GET    | `/` | — | Listar planes completos |
| POST   | `/` | `{ name, [description], [model_id] }` | Crear plan |
| POST   | `/save` | Plan object | Guardar/actualizar plan |
| GET    | `/tasks` | `?fileName=...` | Listar tareas |
| POST   | `/tasks/create` | Task object | Crear tarea y ejecutar directamente |
| POST   | `/tasks/save` | Task object | Guardar tarea sin ejecutar |
| GET    | `/tasks/:name` | — | Ver tarea (501 - no implementado) |
| PUT    | `/tasks/:id` | — | Actualizar tarea (501) |
| DELETE | `/tasks/:id` | — | Borrar tarea (501) |
| POST   | `/execute` | `{ planName, [force] }` | Ejecutar todas las tareas pendientes |
| POST   | `/execute-task` | — | Ejecutar tarea individual (501) |
| GET    | `/:name` | — | Obtener plan |
| PUT    | `/:name` | Plan object | Actualizar plan |
| DELETE | `/:name` | — | Borrar plan |

### 4.9. Schema (`/api/schema`)
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET    | `/schema` | Esquema completo recursivo de `DATA_PATH` (con previews de texto < 50KB) |
| GET    | `/schema/simple` | Esquema simplificado (solo nombres; ignora `node_modules`, `.next`, etc.) |

### 4.10. Structure (`/api/structure`)
| Método | Ruta | Body | Descripción |
|--------|------|------|-------------|
| POST   | `/structure` | Array de folders/files | Preparar estructura; soporta `saveToPlan` |
| POST   | `/structure/execute` | — | Ejecutar estructura preparada |
| GET    | `/structure/tree` | — | Ver árbol de estructura creada |
| POST   | `/structure/save` | — | Guardar estructura a JSON |
| GET    | `/structure/list` | — | Listar estructuras guardadas |
| GET    | `/structure/load` | — | Cargar estructura desde JSON |

### 4.11. Git (`/api/git`) — Git local
Base: controlador `gitController.js`. Usa `resolveGitDir(subPath)` para subir por directorios padre (restringido a `DATA_PATH`) y encontrar la raíz `.git`. `runGit` tiene timeout de 15 s.

| Método | Ruta | Body / Query | Descripción |
|--------|------|--------------|-------------|
| GET    | `/is-repo` | `?path=` | `{ isRepo, gitRoot }` — detecta `.git` y devuelve ruta raíz relativa |
| GET    | `/status` | `?path=` | Estado completo: branch, upstream, ahead/behind, archivos staged/unstaged |
| GET    | `/log` | `?path=&limit=` | Historial de commits (formato porcelain) |
| GET    | `/branches` | `?path=` | Listar ramas; marca la activa |
| GET    | `/diff` | `?path=&file=&staged=` | Diff de archivo (staged o unstaged) |
| GET    | `/remote-url` | `?path=` | URL del remote `origin` |
| POST   | `/init` | `{ path }` | `git init` |
| POST   | `/add` | `{ path, files[] }` | `git add` |
| POST   | `/unstage` | `{ path, files[] }` | `git restore --staged` |
| POST   | `/commit` | `{ path, message }` | `git commit -m` |
| POST   | `/push` | `{ path, branch }` | `git push origin <branch>` |
| POST   | `/pull` | `{ path }` | `git pull` |
| POST   | `/checkout` | `{ path, branch }` | `git checkout <branch>` |
| POST   | `/branch` | `{ path, name }` | `git checkout -b <name>` |
| POST   | `/config` | `{ path, name, email }` | `git config user.name / user.email` |

### 4.12. GitHub (`/api/github`) — Remoto
Base: controlador `githubController.js`. No requiere CLI de git para create/update; usa la REST API de GitHub directamente (blobs, trees, commits, refs). Para `cloneRepo` sí usa `git clone --depth 1` con fallback ZIP.

| Método | Ruta | Body | Descripción |
|--------|------|------|-------------|
| POST   | `/create-repo` | `{ token, path, repoName, repoDescription, isPrivate }` | Crea repo en GitHub, sube archivos locales vía upload directo **y además inicializa `.git` local + commit + remote + push** si el proyecto no era repo. |
| POST   | `/update-repo` | `{ token, path, repoUrl }` | Actualiza repo existente con archivos locales actuales (upload directo). |
| POST   | `/clone-repo` | `{ repoUrl, token }` | Clona con `git clone --depth 1` (conserva `.git`); fallback ZIP si falla. |
| GET    | `/repos` | — | Lista simplificada de repos vinculados (no implementado en backend; frontend usa API GitHub directa). |
| POST   | `/delete-repo` | `{ token, owner, repo }` | Elimina repo de GitHub. Devuelve `{ success }` también cuando GitHub responde 404 (ya no existe). Para 401/403 parsea `message`+`documentation_url` de GitHub y devuelve un `hint` en castellano explicando la causa probable (scope `delete_repo` faltante, falta de admin rights, rate limit, token inválido). |
| POST   | `/sync-local` | `{ path, [message] }` | Sincroniza repo git local (config + add + commit) sin usar shell; usa `execFile` con array de argumentos. Si no existe `.git`, hace init defensivo. Emite `zeus:git-local-updated` al terminar. |
| POST   | `/check-linked` | `{ token, owner, repo }` | Comprueba si un repo sigue existiendo en GitHub (`GET /repos/:owner/:repo`). Usado por el frontend para detectar referencias huérfanas tras borrar en github.com. |
| POST   | `/remove-remote` | `{ path }` | Quita el remote `origin` y opcionalmente `.git` del proyecto local. Usado cuando el usuario quiere desvincular. |

### 4.13. API RAE (`api/api-rae/api.ts`) — Pipeline de IA
Servicio Node/TypeScript independiente. Gestiona modelos, proveedores y pipeline configs. Usado por `ApiConfigModal`.

Base URL: `http://localhost:3011/api/v1`

| Método | Ruta | Body / Query | Descripción |
|--------|------|--------------|-------------|
| GET    | `/models` | `?limit=` | Listar modelos registrados |
| GET    | `/models/:id` | — | Obtener modelo |
| POST   | `/models` | `{ name, provider, baseUrl, ... }` | Crear modelo |
| PUT    | `/models/:id` | `{ ... }` | Actualizar modelo |
| DELETE | `/models/:id` | — | Eliminar modelo |
| GET    | `/providers` | `?limit=` | Listar proveedores |
| POST   | `/providers` | `{ name, ... }` | Crear proveedor |
| GET    | `/pipeline-configs` | `?limit=&sort=` | Listar configs de pipeline |
| GET    | `/pipeline-configs/active` | — | Obtener pipeline activo |
| POST   | `/pipeline-configs` | `{ name, endpointUrl, active, ... }` | Crear config |
| PUT    | `/pipeline-configs/:id` | `{ ... }` | Actualizar config |
| POST   | `/chat/pipeline` | `{ messages, model, ... }` | Endpoint de chat con pipeline externo |

### 4.14. Endpoints adicionales en `server.js`
| Método | Ruta | Handler | Descripción |
|--------|------|---------|-------------|
| GET    | `/api/health` | — | Healthcheck |
| GET    | `/api/plans/list` | `planController` | Listar planes guardados |
| GET    | `/api/data` | `planController.explorerData` | Explorar datos |
| GET    | `/api/plan/tasks` | `planController.listTasks` | Listar tareas |
| GET    | `/api/structure/list` | `structureController.listSavedStructures` | Listar estructuras guardadas |

---

## 5. API ROUTES — NEXT.JS APP ROUTER (`app/api/*`)

Base URL: `http://localhost:8741/api` (o relativo `/api/*` desde el frontend)

### 5.1. Chat e IA
| Método | Ruta | Body / Query | Descripción |
|--------|------|--------------|-------------|
| POST   | `/chat` | `{ provider, model, newMessage, history, webSearch, images, conversationId, projectId, userId, modelRecordId }` | Chat principal con IA (OpenAI, Deepseek, Ollama, LM Studio). Persiste en PocketBase. Soporte pipeline redirect a `localhost:3011/api/v1/chat/pipeline`. Búsqueda web Tavily integrada. |
| GET    | `/chat` | `?conversationId=` o `?modelRecordId=` | Obtener conversaciones/mensajes |
| DELETE | `/chat` | `?conversationId=` | Eliminar conversación y mensajes |
| PATCH  | `/chat` | `{ title }` | Actualizar título de conversación |
| POST   | `/generate-prompt` | `{ description, [model] }` | Mejorar descripción de usuario usando IA |
| POST   | `/plan-with-model` | `{ description, [model], [autonomy] }` | Generar plan de acciones (`create_file`, `update_file`, `create_folder`) desde descripción. Autonomía: `guided`, `semi`, `full`. |

### 5.2. Generación de aplicaciones
| Método | Ruta | Body | Descripción |
|--------|------|------|-------------|
| POST   | `/generate-app` | `{ name, template, description, features, pages, resources, [deployConfig] }` | Generación completa de apps. Templates: `next-js`, `vite-react`, `vue-nuxt`, `svelte-kit`, `angular`, `fastapi-py`, `react-native`, `html-css-js`. Genera estructura + contenido vía SSE. Guarda ZIP en PocketBase. |
| POST   | `/generate-app/content` | `{ projectId, filePath, [template], [description] }` | Generar contenido individual de archivo vía IA (streaming) |
| POST   | `/generate-app/structure` | `{ name, template, description, [features] }` | Generar solo estructura de archivos (lista de paths) |
| POST   | `/generate-app-escritorio` | Similar a `/generate-app` | App de escritorio (Electron) |
| POST   | `/generate-app-movil` | Similar a `/generate-app` | App móvil (Capacitor / React Native) |
| POST   | `/generate-app-page-web` | Similar a `/generate-app` | Página web simple |

### 5.3. IDE y manejo de archivos
| Método | Ruta | Body / Query | Descripción |
|--------|------|--------------|-------------|
| GET    | `/ide-files` | `?path=&type=&name=&raw=` | Listar carpetas/archivos o leer archivo individual (raw/binario) |
| POST   | `/ide-files` | `{ action: 'createFile'|'createFolder', path, name, [content] }` | Crear archivo/carpeta |
| PUT    | `/ide-files` | `{ action: 'rename'|'save', path, name, [newName], [content] }` | Renombrar o guardar archivo |
| DELETE | `/ide-files` | `?path=&name=` | Eliminar archivo/carpeta |
| POST   | `/ide-files/undo` | `{ filePath }` | Deshacer cambios (restaura `.zeus-backup`) |
| POST   | `/ide-schema` | `{ description, [model] }` | Generar esquema Prisma desde descripción usando IA |
| POST   | `/read-file` | `{ filePath, [projectRoot] }` | Leer archivo seguro (prevención path traversal) |
| POST   | `/save-file` | `{ filePath, content, [encoding], [skipBackup] }` | Guardar archivo con backup automático. Soporta base64/dataURL |
| GET    | `/project-structure` | — | Escanear `DATA_PATH` completo; detecta framework desde `package.json` |
| POST   | `/create-folder` | `{ path, name }` | Crear carpeta |

### 5.4. Configuración y corrección de código
| Método | Ruta | Body | Descripción |
|--------|------|------|-------------|
| GET    | `/config/data-path` | — | Leer `DATA_PATH` del `.env` |
| POST   | `/config/data-path` | `{ dataPath }` | Escribir `DATA_PATH` en `.env` |
| POST   | `/correct-code` | `{ updates: [{filePath, issueSummary, patchSnippet, currentContent}], projectRoot, [model] }` | Corregir múltiples archivos aplicando reemplazos fallidos |
| POST   | `/correct-file-code` | `{ filePath, content, [model] }` | Corregir código de archivo individual |
| POST   | `/fix-dependencies` | `{ projectPath }` | Reinstalar/limpiar dependencias del proyecto |
| POST   | `/fix-error` | `{ errorOutput, [projectRoot], [model] }` | Analizar errores y sugerir correcciones vía IA |
| POST   | `/fix-missing-imports` | `{ filePath, [projectRoot] }` | Detectar y corregir imports faltantes |
| POST   | `/corrections/apply` | `{ corrections: [{filePath, patch}] }` | Aplicar parches generados por IA |

### 5.5. Modelos de IA
| Método | Ruta | Body / Query | Descripción |
|--------|------|--------------|-------------|
| POST   | `/modelos` | `{ provider, model_name, base_url, api_key, type, [userId] }` | Crear modelo en PocketBase (`ai_models`) |
| GET    | `/modelos` | `?user=...` | Listar modelos de un usuario |
| PATCH  | `/modelos` | `{ id, ...fields }` | Actualizar modelo |
| DELETE | `/modelos` | `?id=...` | Eliminar modelo |

### 5.6. Generación de APIs y despliegue
| Método | Ruta | Body / Query | Descripción |
|--------|------|--------------|-------------|
| POST   | `/generate-api/generate` | `{ description, [template], [model] }` | Generar código de API vía IA |
| POST   | `/generate-api/save-config` | `{ config }` | Guardar configuración de API generada |
| POST   | `/generate-api/test/:id` | `{ requestBody }` | Test de endpoint generado |
| GET    | `/generate-api/projects` | — | CRUD proyectos API en PocketBase |
| GET/PUT/DELETE | `/generate-api/projects/:id` | — | Operaciones sobre proyecto API específico |
| POST   | `/generate-api-description` | `{ description, [template] }` | Generar descripción OpenAPI/Swagger |
| POST   | `/deploy` | `{ flyApiToken, pocketbaseEmail, pocketbasePassword, appName, region, memory, organizationId, pocketbaseVersion, [enableSSL], [pbSchema] }` | Despliegue automatizado PocketBase en Fly.io (máquinas, volúmenes, IPs, Debian) |
| POST   | `/preview-panel` | `{ projectPath }` | Iniciar servidor de preview para panel/app generada |
| POST   | `/start-preview-server` | `{ projectPath, [port] }` | Iniciar servidor preview local |

### 5.7. Imágenes y assets
| Método | Ruta | Body / Query | Descripción |
|--------|------|--------------|-------------|
| GET    | `/images` | `?query=&page=&per_page=&orientation=` | Búsqueda imágenes Unsplash |
| POST   | `/generate-icon` | `{ mode: 'prompt'|'url'|'input', [prompt], [url], [imageData], [openAiKey] }` | Generar icono `.ico` (tamaños: 16,24,32,48,128,256). Modos: DALL-E 3, descarga URL, o subir PNG/base64. Actualiza `package.json`. Persiste en PocketBase si hay `projectId`. |
| POST   | `/upload-image` | FormData / `{ image, [projectId] }` | Subir imagen al proyecto |
| GET    | `/serve-upload` | `?fileName=` | Servir archivos subidos |
| POST   | `/copy-uploads-to-public` | `{ projectPath }` | Copiar uploads a carpeta `public` |

### 5.8. APK / Móvil
| Método | Ruta | Body | Descripción |
|--------|------|------|-------------|
| POST   | `/build-apk` | `{ projectPath }` | Proxy al servidor Express `:8742/api/build-apk` |
| GET    | `/download-apk` | — | Proxy descarga APK generado |

### 5.9. Proyectos y utilidades
| Método | Ruta | Body / Query | Descripción |
|--------|------|--------------|-------------|
| GET/POST | `/project/get-root` | — / `{ projectPath }` | Obtener/establecer ruta raíz del proyecto |
| POST   | `/run-project-dev` | `{ projectPath }` | Ejecutar `npm run dev` en proyecto |
| POST   | `/run-project-build` | `{ projectPath }` | Ejecutar build de proyecto |
| GET    | `/schema/simple` | — | Esquema simplificado del proyecto |
| POST   | `/structure-plan/generate` | `{ description, [model] }` | Generar plan de estructura vía IA |
| POST   | `/structure-plan/execute-stage` | `{ planId, stageIndex }` | Ejecutar etapa de plan de estructura |
| POST   | `/validate-components` | `{ projectPath, [model] }` | Validar componentes generados |
| GET    | `/code_template/:nombre` | — | Obtener template de código por nombre |
| POST   | `/apply-plan` | `{ plan, [projectPath] }` | Aplicar plan generado al proyecto |

### 5.10. Otras rutas
| Método | Ruta | Descripción |
|--------|------|-------------|
| POST   | `/compara-carpetas/api/scan` | Escaneo comparativo de carpetas |
| GET    | `/compara-carpetas/api/scan/stream` | Escaneo streaming de carpetas |

---

## 6. PROVEEDORES DE IA SOPORTADOS

| Proveedor | Variable de entorno / Config | URL por defecto | Función interna |
|-----------|------------------------------|-----------------|-----------------|
| **OpenAI** | `OPENAI_API_KEY` | `https://api.openai.com/v1/chat/completions` | `callOpenAI()` |
| **Deepseek** | `DEEPSEEK_API_KEY` | `https://api.deepseek.com/chat/completions` | `callDeepseek()` |
| **Ollama** | — (local) | `http://localhost:11434/api/chat` | `callOllama()` |
| **LM Studio** | — (local) | `http://localhost:1234/v1/chat/completions` | `callLMStudio()` |

**Búsqueda web:** Tavily API (`TAVILY_API_KEY`) — `performWebSearch()` en `model-service.ts`.  
**Generación de imágenes:** DALL-E 3 (OpenAI) para iconos; Unsplash API (`UNSPLASH_ACCESS_KEY`) para assets de apps.

---

## 7. BASES DE DATOS Y COLECCIONES

### 7.1. Prisma (SQLite local)
```prisma
model User {
  id        Int      @id @default(autoincrement())
  email     String   @unique
  name      String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

### 7.2. PocketBase — Colecciones principales
| Colección | Propósito | Campos clave |
|-----------|-----------|--------------|
| `ai_models` | Configuración de modelos IA | `provider`, `model_name`, `base_url`, `api_key`, `type` (remote/local), `user` |
| `conversations` | Conversaciones de chat | `user`, `project_id`, `model_id`, `title`, `last_message` |
| `messages` | Mensajes individuales | `conversation`, `role`, `content`, `type`, `fileInfo`, `action_type`, `created` |
| `projects` | Proyectos generados | `name`, `template`, `description`, `user`, `project_archive` (file), `project_archive_backup` (file) |
| `projects_api` | Proyectos de API generados | `name`, `description`, `config`, `user` |
| `structure_plans` | Planes de estructura | `name`, `description`, `structure`, `user` |
| `pipeline_configs` | Configuración de pipelines IA | `name`, `endpoint_url`, `active`, `user` |
| `file_path` | Registro de rutas de archivos | `path`, `project`, `user` |

**Instancias PocketBase:**
- Local: `http://127.0.0.1:8091`
- Remota (Fly.io): `https://zeus-basedatos.fly.dev`

---

## 8. PROMPTS DEL SISTEMA PARA IA

### 8.1. Prompts principales
- `ZEUS_SYSTEM_PROMPT` / `ZEUS_SYSTEM_PROMPT_SHORT` — Instrucciones detalladas sobre autonomía total, formato `code_change` JSON, uso de `[ZEUS_API_CALL]`, comandos de terminal, flujo de creación de aplicaciones.
- El modelo debe generar cambios de código en formato JSON estructurado (`code_change`) para ser aplicados automáticamente.
- Soporte de ejecución de comandos de terminal autónoma cuando es seguro.
- Capacidad de búsqueda web integrada (tag `[WEB_SEARCH]`).

### 8.2. Prompt especializado de planificación
- `buildPlannerPrompt()` — Prompt para planificación de cambios de código en proyectos Next.js.

---

## 9. FORMATOS DE COMUNICACIÓN ESPERADOS

### 9.1. `code_change` JSON (usado por el modelo para proponer cambios)
```json
{
  "code_changes": [
    {
      "file_path": "app/page.tsx",
      "action": "create|update|delete",
      "content": "...nuevo contenido completo del archivo...",
      "explanation": "Breve explicación del cambio"
    }
  ]
}
```

### 9.2. API call tag (para invocar endpoints del sistema)
```
[ZEUS_API_CALL]
POST /api/files
{ "name": "example.ts", "extension": "ts", "path": "/", "content": "..." }
[/ZEUS_API_CALL]
```

### 9.3. Web search tag
```
[WEB_SEARCH]consulta de búsqueda[/WEB_SEARCH]
```

---

## 10. TEMPLATES DE GENERACIÓN DE APPS

| Template | Descripción |
|----------|-------------|
| `next-js` | Next.js 13+ App Router |
| `vite-react` | Vite + React |
| `vue-nuxt` | Vue / Nuxt |
| `svelte-kit` | SvelteKit |
| `angular` | Angular |
| `fastapi-py` | FastAPI (Python) |
| `react-native` | React Native / Capacitor |
| `html-css-js` | HTML/CSS/JS estático |

---

## 11. COMPONENTES Y PÁGINAS PRINCIPALES DEL FRONTEND

| Ruta / Componente | Descripción |
|-------------------|-------------|
| `app/layout.tsx` | Root layout con Providers, ComponentSelectorHelper, soporte zoom `zeus-zoom` |
| `app/page.tsx` | Dashboard principal (`APIFileCommander`): explorador de archivos, IDE, chat, planes, API tester, generador de apps, botón GitHub en header (~5200 líneas) |
| `app/compara-carpetas/page.tsx` | Comparador de carpetas |
| `app/compara-code/page.tsx` | Comparador de código |
| `app/generator/two-step/page.tsx` | Generador de apps en dos pasos |
| `app-preview/page.tsx` | Preview de apps generadas (`ZeusStudio`) |
| `components/ide/GitPanel.tsx` | Panel Git local: status, stage, diff, commit, log, branches, push/pull, config. Detecta `.git` en subcarpetas vía `gitRoot`. Soporta `fetchWithTimeout` (8 s). |
| `components/ide/GitHubModal.tsx` | Modal GitHub con 4 pestañas: **Auth** (PAT), **Mis Repos** (listado + detección Next.js + botón borrar inline por repo), **Repos vinculados** (lista del proyecto con botón borrar + botón abrir + botón update), **Nuevo Repo** (formulario creación) y **Subir Cambios** (update). Persistencia en `localStorage`. Al abrirse ejecuta auto-purgado de referencias huérfanas vía `/check-linked` para que un repo borrado en github.com no quede como "vinculado". El borrado en GitHub reutiliza `deleteRepositoryFromGitHub(owner, repo, label)` que muestra `hint` en el toast para errores 401/403/404 con explicación en castellano. |
| `components/ui/github-icon.tsx` | SVG custom del logo GitHub (lucide-react no exporta `Github`). Usado en header y modal. |
| `components/ide/IDETab.tsx` | Tab IDE con explorador, editor Monaco y panel Git lateral. Pasa `onSetExplorerPath` a `GitPanel`. |

---

## 12. SERVICIOS Y UTILIDADES CLAVE

### 12.1. `lib/`
| Archivo | Función |
|---------|---------|
| `lib/pocketbase.ts` | Cliente PB con fallback local/remoto, autenticación admin |
| `lib/pb-api.ts` | Configuración compartida PB para API routes |
| `lib/collections.ts` | Constantes de colecciones y campos PB |
| `lib/store.ts` | Zustand store global (auth, modelos seleccionados, preview, explorer) |
| `lib/env.ts` | Lectura/escritura de variables de entorno |
| `lib/generatePbSchema.ts` | Generador de esquemas Prisma desde descripciones |
| `lib/correctionUtils.ts` | Utilidades para correcciones de código |
| `lib/diff-utils.ts` | Utilidades de diff |
| `lib/smartReplace.ts` | Reemplazo inteligente de código |
| `lib/validations.ts` | Esquemas de validación (Zod) |
| `lib/utils.ts` | Utilidades generales (`cn`, etc.) |
| `lib/translations.ts` | Diccionarios completos en/en (~970 claves cada uno) |
| `lib/i18n.ts` | Motor i18n con 3 idiomas (`es`, `fr`, `de`) + fallback |
| `next.config.js` | Configuración de Next.js. Incluye `rewrites()` para proxy de `/api/git/*` y `/api/github/*` al Express backend (`localhost:8742`) |

### 12.2. Backend Express (`api/`)
| Archivo | Función |
|---------|---------|
| `api/server.js` | Servidor Express principal (puerto 8742). Monta routers y middleware |
| `api/routes/git.js` | Router `/api/git/*` — delega a `gitController` |
| `api/routes/github.js` | Router `/api/github/*` — delega a `githubController` |
| `api/controllers/gitController.js` | Operaciones Git locales (`init`, `status`, `commit`, `push`, `pull`, `diff`, `log`, `branch`, `config`). Usa `resolveGitDir()` para subir por padres restringido a `DATA_PATH` |
| `api/controllers/githubController.js` | Integración GitHub remota (`createRepo`, `updateRepo`, `cloneRepo`, `deleteRepo`, `listRepos`). Usa upload directo vía REST API (blobs → trees → commits → refs) sin depender del CLI de git. `cloneRepo` usa `git clone --depth 1` con fallback ZIP |
| `api/api-rae/api.ts` | Servicio API RAE (puerto 3011) — pipeline de modelos/proveedores |
| `electron/main.js` | Proceso principal Electron. Arranca Next.js, Express, Terminal, PocketBase, Panel Central, API RAE, Preview Server, Formatter. Gestiona IPC, ventana y cierre limpio de procesos |

---

## 13. VARIABLES DE ENTORNO IMPORTANTES

| Variable | Descripción |
|----------|-------------|
| `DATA_PATH` | Ruta raíz para operaciones de archivos/carpetas |
| `OPENAI_API_KEY` | Clave OpenAI |
| `DEEPSEEK_API_KEY` | Clave Deepseek |
| `TAVILY_API_KEY` | Clave búsqueda web Tavily |
| `UNSPLASH_ACCESS_KEY` | Clave Unsplash |
| `FLY_API_TOKEN` | Token de organización Fly.io |
| `POCKETBASE_URL` | URL de PocketBase (local o remoto) |
| `POCKETBASE_LOCAL_URL` | URL local de PocketBase (default `http://127.0.0.1:8091`) |
| `POCKETBASE_LOCAL_ADMIN_EMAIL` / `POCKETBASE_LOCAL_ADMIN_PASSWORD` | Credenciales admin PocketBase local |
| `ZEUS_API_ENV_PATH` | Ruta al `.env` gestionado por Electron para la API |
| `ELECTRON_ZOOM` | Factor de zoom inicial de la ventana (default `1.0`) |
| `ZEUS_SYSTEM_PROMPT` / `ZEUS_SYSTEM_PROMPT_SHORT` | Prompts del sistema para IA |

---

## 14. COMANDOS DE NPM DISPONIBLES (package.json)

| Script | Comando |
|--------|---------|
| `dev` | `next dev -p 8741` |
| `build` | `next build` |
| `start` | `next start -p 8741` |
| `electron` | `electron .` |
| `electron:dev` | `set NODE_ENV=development && electron .` |
| `electron:prod` | `set NODE_ENV=production && electron .` |
| `electron:build:win` | `electron-builder --win` |
| `electron:build:mac` | `electron-builder --mac` |
| `electron:build:linux` | `electron-builder --linux` |
| `package` | `npm run build && electron-builder` |

---

## 15. NOTAS PARA EL MODELO (PIPELINE)

1. **Todas las operaciones de archivos usan `DATA_PATH` como raíz segura.** Nunca operar fuera de esa ruta. El backend usa `resolveGitDir()` para subir por padre hasta encontrar `.git`, restringido a `DATA_PATH`.
2. **El sistema soporta 4 idiomas:** si el usuario escribe en español, inglés, francés o alemán, responder en el mismo idioma.
3. **Los cambios de código deben preferir el formato `code_change` JSON** para que el frontend pueda aplicarlos automáticamente.
4. **Si necesitas información externa**, usa el tag `[WEB_SEARCH]consulta[/WEB_SEARCH]`.
5. **Si necesitas ejecutar un comando del sistema**, usa `[ZEUS_API_CALL]POST /api/commands/run { command: "..." }[/ZEUS_API_CALL]`.
6. **Para crear/actualizar archivos**, usa los endpoints `/api/files` o `/api/ide-files`; para líneas específicas, `/api/files/:name/lines`.
7. **La autonomía del modelo puede ser:** `guided` (cada paso requiere confirmación), `semi` (confirmación solo en acciones destructivas), `full` (ejecución automática de todo).
8. **PocketBase es la fuente de verdad** para: conversaciones, mensajes, modelos de IA, proyectos generados, planes de estructura.
9. **El proyecto usa React 19 + Next.js 16 + TypeScript.** Todo código generado debe ser compatible con esta stack (a menos que el template seleccionado sea otro).
10. **La UI usa Tailwind CSS + shadcn/ui + Radix UI.** Los componentes generados deben usar estas librerías cuando se generen para Next.js/Vite React.
11. **Git/GitHub — decisiones técnicas recientes:**
    - `next.config.js` define `rewrites()` para proxy de `/api/git/*` y `/api/github/*` al Express backend (`localhost:8742`), evitando 404 desde Next.js.
    - `GitPanel` calcula `safeProjectPath = projectPath.replace(/\/.git$/i, '')` e `effectivePath = gitRoot || safeProjectPath`, para que navegar dentro de `.git` o subcarpetas del repo no rompa el panel.
    - `localStorage` (token/repos GitHub) **solo se lee en `useEffect`**, nunca en el inicializador de `useState`, para evitar hydration mismatch en React 19.
    - `runGit` en backend tiene timeout de 15 s con `SIGTERM` para evitar hangs del CLI.
    - Tras clonar, **no se elimina `.git`** — el repo local sigue siendo un repo Git válido para el panel.
    - El frontend usa `fetchWithTimeout` (8 s AbortController) para todas las llamadas al panel Git.
    - **Crear repo desde el modal = flujo completo automático**: el backend hace `git init` → `git add .` → `commit` → añade `origin` con token embebido en URL → `git push -u origin main`, todo en `initAndPushLocalRepo`. El token se reemplaza después por la URL pública (`git remote set-url origin <https://github.com/...>`) para no dejarlo en `.git/config`.
    - **Auto-purgado de repos huérfanos**: al abrir el modal se llama a `POST /api/github/check-linked` para cada repo vinculado; los que devuelven 404 (borrados en github.com) se eliminan del `localStorage` y de la UI sin pedir confirmación.
    - **Borrado de repo en GitHub**: `deleteRepositoryFromGitHub(owner, repo, label)` es la función única usada por ambas pestañas ("Repos vinculados" y "Mis repos"). El backend trata 404 como éxito, parsea `message`+`documentation_url` de GitHub y devuelve un `hint` en castellano según el código: 403 con `delete_repo`/`resource not accessible` → falta el scope; 403 con `must have admin rights` → sin permisos admin sobre el repo/org; 403 con `rate limit` → esperar; 401 → token inválido.
    - **Eventos cross-component**: `sync-local` y `initAndPushLocalRepo` emiten `window.dispatchEvent(new CustomEvent('zeus:git-local-updated'))` para que `GitPanel` refresque estado sin polling.

---

*Fin del contexto de Zeus IA.*
