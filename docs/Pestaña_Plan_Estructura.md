**pestaña "Plan de Estructuras"** (o "Structure Plans"):

## ¿Qué es la pestaña Plan de Estructuras?

Es una herramienta visual y funcional dentro de Zeus IA que permite **diseñar, guardar y ejecutar la estructura completa de carpetas y archivos de un proyecto de software** antes de escribirlos físicamente en el disco.

## Funcionalidades principales

### 1. **Diseño visual de la estructura**
- Puedes definir un árbol jerárquico de carpetas y archivos (similar a un explorador de archivos).
- Soporta la creación de:
  - **Carpetas** (con nombre y ruta)
  - **Archivos** (con nombre, extensión y contenido inicial)
- La estructura se representa como un JSON anidado que describe todo el proyecto.

### 2. **Guardado de planes**
- Los planes de estructura se almacenan en **PocketBase** en la colección `structure_plans`.
- Cada plan tiene:
  - `name`: Nombre del plan
  - `description`: Descripción opcional
  - `structure`: El JSON completo de la estructura
  - `user`: Relación con el usuario que lo creó
- Puedes tener múltiples planes guardados y reutilizarlos.

### 3. **Ejecución del plan**
- Una vez diseñado, puedes **ejecutar el plan** para que Zeus IA cree físicamente todas las carpetas y archivos en el sistema de archivos.
- La ejecución respeta la jerarquía definida y crea todo de una sola vez.

### 4. **Integración con el pipeline de IA**
- Los planes de estructura se integran con el sistema de **pipeline de contexto** del modelo de IA.
- Cuando el modelo necesita crear una aplicación completa, primero genera un plan de estructura, lo guarda, y luego lo ejecuta.

## Endpoints relacionados (API REST)

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| `POST` | `/api/structure` | Crear una estructura completa (carpetas + archivos) |
| `POST` | `/api/structure/execute` | Ejecutar la estructura preparada |
| `GET` | `/api/structure/tree` | Obtener el árbol de estructura creado |
| `POST` | `/api/structure/save` | Guardar estructura a archivo JSON |
| `GET` | `/api/structure/list` | Listar estructuras guardadas |
| `GET` | `/api/structure/load` | Cargar estructura desde archivo |

## ¿Para qué sirve?

- **Planificación visual**: Ver cómo quedará la estructura del proyecto antes de crearlo.
- **Reutilización**: Guardar plantillas de estructuras para proyectos similares.
- **Automatización**: El modelo de IA puede generar y ejecutar estructuras completas sin intervención manual.
- **Colaboración**: Compartir planes de estructura entre desarrolladores.

## Ejemplo de uso típico

1. El usuario dice: *"Crea una aplicación Next.js con autenticación y base de datos"*
2. Zeus IA genera un **plan de estructura** con:
   - Carpeta raíz del proyecto
   - Subcarpetas (`app`, `components`, `lib`, `types`, etc.)
   - Archivos base (`layout.tsx`, `page.tsx`, `package.json`, etc.)
3. El plan se guarda en PocketBase
4. Se ejecuta el plan → se crean todas las carpetas y archivos en el disco
5. El usuario puede ver la estructura creada y empezar a trabajar

## Notas importantes

- **Los planes se guardan en PocketBase**, no en el sistema de archivos local (aunque pueden exportarse a JSON).
- **La ejecución es atómica**: o se crea todo correctamente o no se crea nada (rollback implícito).
- **Soporta estructuras anidadas** de cualquier profundidad.
- **Los archivos pueden tener contenido inicial** (código boilerplate, configuraciones, etc.).

