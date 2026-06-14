## Generador de Aplicaciones de Zeus IA

El **Generador de Aplicaciones** es el componente estrella de Zeus IA. Permite crear aplicaciones completas desde cero mediante inteligencia artificial, sin necesidad de escribir código manualmente.

### Tipos de Aplicaciones que Puede Generar

#### 1. **Aplicaciones Web** (`generate-app`)
- **Stack**: Next.js + React + TypeScript + Tailwind CSS
- **Estructura**: Páginas, componentes, layouts, estilos
- **Características**: Routing, SSR/SSG, API routes
- **Ejemplo**: `app/page.tsx`, `components/`, `lib/`

#### 2. **Aplicaciones Móviles** (`generate-app-movil`)
- **Stack**: React Native + Expo
- **Estructura**: Pantallas, navegación, componentes nativos
- **Características**: Gestos, animaciones, cámara, GPS
- **Ejemplo**: `screens/`, `navigation/`, `components/`

#### 3. **Aplicaciones de Escritorio** (`generate-app-escritorio`)
- **Stack**: Electron + React
- **Estructura**: Ventanas, menús, procesos del sistema
- **Características**: Acceso a sistema de archivos, notificaciones
- **Ejemplo**: `electron/main.js`, `preload.js`

#### 4. **Páginas Web Estáticas** (`generate-app-page-web`)
- **Stack**: HTML + CSS + JavaScript vanilla
- **Estructura**: Página única o múltiples páginas
- **Características**: Responsive, SEO básico
- **Ejemplo**: `index.html`, `styles.css`, `app.js`

### Proceso de Generación (2 Pasos)

#### **Paso 1: Generar Estructura**
El sistema analiza tu descripción y crea la estructura de carpetas y archivos:


mi-app/
├── app/
│   ├── layout.tsx
│   ├── page.tsx
│   └── globals.css
├── components/
│   ├── Header.tsx
│   └── Footer.tsx
├── lib/
│   └── utils.ts
├── public/
│   └── logo.png
├── package.json
├── tsconfig.json
└── tailwind.config.ts


#### **Paso 2: Generar Contenido**
Una vez aprobada la estructura, genera el contenido de cada archivo con código funcional completo.

### Endpoints Clave

| Endpoint | Función |
|----------|---------|
| `POST /api/generate-app/structure` | Genera la estructura del proyecto |
| `POST /api/generate-app/content` | Genera el contenido de los archivos |
| `POST /api/generate-app-movil/structure` | Estructura para apps móviles |
| `POST /api/generate-app-movil/content` | Contenido para apps móviles |
| `POST /api/generate-app-escritorio/structure` | Estructura para apps de escritorio |
| `POST /api/generate-app-escritorio/content` | Contenido para apps de escritorio |

### Características Avanzadas

- **Personalización**: Puedes especificar librerías, estilos, y funcionalidades exactas
- **Corrección Automática**: Si hay errores, el sistema los detecta y corrige
- **Validación de Componentes**: Verifica que los componentes sean correctos antes de generarlos
- **Integración con Git**: Puedes inicializar repositorio automáticamente
- **Vista Previa**: Puedes previsualizar la app generada en tiempo real

### Ejemplo de Uso

**Usuario**: "Crea una aplicación web de lista de tareas con Next.js"

**Zeus IA**:
1. Genera estructura con carpetas `app/`, `components/`, `lib/`
2. Crea `page.tsx` con la interfaz principal
3. Crea `components/TaskList.tsx`, `components/TaskForm.tsx`
4. Añade lógica de estado con hooks de React
5. Estilos con Tailwind CSS
6. Instala dependencias y deja la app lista para ejecutar
