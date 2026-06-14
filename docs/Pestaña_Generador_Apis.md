Pestaña **"Generador de APIs"** es una herramienta que permite **crear, probar y desplegar APIs completas** mediante inteligencia artificial, sin necesidad de escribir código manualmente.

### Funcionalidades principales:

1.  **Generación de código de API**: Puedes describir en lenguaje natural qué necesitas (ej: "API REST para gestión de usuarios con autenticación JWT") y la IA genera el código completo del backend.

2.  **Guardado de configuraciones**: Las configuraciones de las APIs generadas se pueden guardar para reutilizarlas o modificarlas después.

3.  **Prueba de endpoints**: Una vez generada la API, puedes probar sus endpoints directamente desde la interfaz, enviando peticiones de prueba.

4.  **Gestión de proyectos API**: CRUD completo de proyectos de API almacenados en PocketBase (crear, leer, actualizar, eliminar).

5.  **Generación de descripciones OpenAPI/Swagger**: Puedes generar automáticamente la documentación estándar de tu API en formato OpenAPI/Swagger a partir de una descripción textual.

6.  **Despliegue automatizado**: Integración con Fly.io para desplegar la API generada (incluyendo PocketBase) de forma automática, configurando:
    - Token de Fly.io
    - Credenciales de PocketBase
    - Nombre de la app
    - Región
    - Memoria
    - Organización
    - Versión de PocketBase
    - Opcionalmente SSL y esquema de base de datos

### Rutas/Endpoints asociados:

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/generate-api/generate` | Generar código de API vía IA |
| POST | `/generate-api/save-config` | Guardar configuración de API generada |
| POST | `/generate-api/test/:id` | Test de endpoint generado |
| GET | `/generate-api/projects` | Listar proyectos API |
| GET/PUT/DELETE | `/generate-api/projects/:id` | CRUD sobre proyecto API específico |
| POST | `/generate-api-description` | Generar descripción OpenAPI/Swagger |
| POST | `/deploy` | Despliegue automatizado en Fly.io |

En resumen, es una herramienta **low-code / no-code** para desarrolladores que quieren crear APIs funcionales, documentadas y desplegables en producción, todo desde la misma interfaz de Zeus IA.