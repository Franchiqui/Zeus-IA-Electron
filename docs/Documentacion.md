¡Excelente pregunta! Basándome en el contexto que me has proporcionado, puedo desglosar los distintos componentes de **Zeus IA** que forman parte de este proyecto. El contexto describe una arquitectura compleja con múltiples servicios y módulos.

Aquí tienes una lista detallada de los componentes de Zeus IA identificados:

### 1. **Frontend (Next.js + React 19)**
*   **Framework:** Next.js 16 con React 19 y TypeScript.
*   **UI:** Tailwind CSS, shadcn/ui y Radix UI.
*   **Componentes Clave:**
    *   `GitPanel`: Panel principal para gestión de Git/GitHub.
    *   `ApiDashboard`: Dashboard para la API.
    *   `ApiClient`: Cliente para interactuar con la API.
    *   `Navbar`, `Sidebar`, `Footer`: Componentes de layout.
    *   `auth-status`: Componente para el estado de autenticación.
    *   `theme-provider`: Proveedor de temas (claro/oscuro).
    *   `error-boundary`: Manejo de errores.
    *   `component-selector-helper`: Un helper extenso (134KB) para seleccionar componentes.
*   **Hooks:** `use-debounce`, `use-local-storage`, `use-toast`.
*   **Contextos:** `drawing-context`, `editor-context`, `file-context`.
*   **Librería de UI:** Componentes como `button`, `input`, `modal`, `toast`, `tabs`, `tooltip`, etc.

### 2. **Backend (Express.js)**
*   **Descripción:** Un servidor Express que actúa como proxy y lógica de negocio.
*   **Configuración:** Se ejecuta en `localhost:8742`.
*   **Controladores (Módulos):**
    *   **`gitController.js`**: Gestiona operaciones Git locales (status, log, branches, clone, sync, etc.).
    *   **`githubController.js`**: Gestiona la interacción con la API de GitHub (repos, linked repos, check-linked, delete-repo).
    *   **`structureController.js`**: Maneja la creación, visualización y guardado de estructuras de proyecto.
    *   **`apiController.js`**: Gestiona la API principal del sistema.
*   **Funcionalidades Clave:**
    *   Proxy para rutas `/api/git/*` y `/api/github/*` (configurado en `next.config.js`).
    *   Timeout de 15 segundos para comandos Git.
    *   Manejo de errores de GitHub con mensajes en castellano.
    *   Eventos `CustomEvent` para comunicación cross-component (`zeus:git-local-updated`).

### 3. **API RAE (api-rae) - Pipeline de IA**
*   **Descripción:** Un servicio Node/TypeScript independiente para gestionar modelos, proveedores y pipelines de IA.
*   **URL Base:** `http://localhost:3011/api/v1`
*   **Endpoints:**
    *   `GET /models`: Listar modelos.
    *   `POST /models`: Crear un nuevo modelo.
    *   `PUT /models/:id`: Actualizar un modelo.
    *   `GET /models/:id`: Obtener un modelo específico.
*   **Uso:** Es utilizado por el componente `ApiConfigModal` para configurar los modelos de IA.

### 4. **PocketBase (Base de Datos y Autenticación)**
*   **Descripción:** Una base de datos backend como servicio (BaaS) que también maneja la autenticación de usuarios.
*   **Archivos Clave:**
    *   `pocketbase.ts`: Configuración del cliente.
    *   `auth-config.ts` / `auth-config.tsx`: Configuración de autenticación.
    *   `pb_data/`: Directorio con datos de la base de datos (incluyendo avatares de usuarios).
    *   `pb_migrations/`: Migraciones de la base de datos (creación de tablas `players`, `scores`, `game_sessions`).
*   **Funcionalidades:**
    *   Almacenamiento de datos de usuarios.
    *   Gestión de sesiones de juego (TETRIS).
    *   Almacenamiento de archivos (avatares).

### 5. **Almacenamiento Local (LocalStorage)**
*   **Uso:** Para almacenar tokens de GitHub, repositorios vinculados y otras preferencias del usuario en el navegador.
*   **Regla Importante:** Solo se lee en `useEffect` para evitar errores de hidratación en React 19.

### 6. **Configuración y Estructura del Proyecto**
*   **Archivos de Configuración:**
    *   `next.config.js`: Configuración de Next.js (rewrites, etc.).
    *   `.env`, `.env.local`, `.env.example`: Variables de entorno.
    *   `package.json`: Dependencias del proyecto.
    *   `.eslintrc.json`, `.prettierrc`: Configuración de linting y formato.
    *   `.editorconfig`: Configuración del editor.
*   **Plan de Proyecto:** `plans/tetris_app.json` (un plan para una app de Tetris, que parece ser el propósito principal del proyecto).

### Resumen de la Arquitectura:

En resumen, **Zeus IA** es un sistema completo que integra un frontend moderno (Next.js/React), un backend personalizado (Express), un servicio de IA independiente (API RAE), una base de datos (PocketBase) y una profunda integración con Git y GitHub. Todo ello orquestado para, en este caso, construir una aplicación de Tetris.