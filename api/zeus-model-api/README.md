# Zeus Model API

# API REST de Edición y Navegación de Código para Zeus IA

## 1. Propósito General

La API Zeus Code Manipulation Service (ZCMS) proporciona a un asistente de inteligencia artificial (Zeus IA) integrado en un IDE la capacidad de explorar, leer y modificar el código fuente de una aplicación con una precisión quirúrgica. Está diseñada para operar sobre árboles de archivos reales y manejar archivos de cualquier tamaño, permitiendo correcciones desde un único carácter hasta la reescritura completa de un fichero. La API actúa como una capa de abstracción segura y eficiente entre el modelo de lenguaje y el sistema de archivos del proyecto, garantizando que todas las operaciones se realicen de forma atómica, trazable y sin corrupción de datos.

## 2. Casos de Uso Principales

- Corrección puntual  
  El modelo necesita cambiar una variable mal escrita → la API recibe una coordenada exacta (línea, columna, offset) y un nuevo valor, y aplica el cambio sin afectar el resto del archivo.

- Modificación de una línea completa  
  Reemplazo de una sentencia, una importación o una asignación con precisión de línea. La API valida que la línea objetivo coincida con el contenido esperado antes de modificarla.

- Inserción/eliminación de un fragmento  
  El asistente decide añadir un bloque de código en una ubicación concreta (por ejemplo, antes de una función) o eliminar un rango de líneas. La API soporta operaciones de inserción y eliminación basadas en coordenadas.

- Reescritura total de un archivo  
  Para refactorizaciones masivas o regeneración completa del contenido, el modelo puede enviar el nuevo contenido entero. La API garantiza consistencia mediante verificaciones de suma de comprobación (checksum) y crea respaldos.

- Navegación inteligente del código base  
  El modelo consulta la estructura del proyecto (árbol de carpetas), busca archivos por nombre, extensión o contenido, y obtiene segmentos de archivos grandes sin necesidad de transferir ficheros completos.

- Edición concurrente segura  
  El IDE puede tener archivos abiertos. La API maneja bloqueos optimistas (ETags) para prevenir ediciones fantasma y conflictos entre el usuario y la IA.

## 3. Endpoints Sugeridos

Todos los endpoints se sirven bajo el prefijo `/api/v1/workspaces/{workspaceId}`.

### 3.1 Exploración del Sistema de Archivos

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET`  | `/tree` | Devuelve la estructura jerárquica completa del proyecto (carpetas y archivos) con opciones de profundidad limitada y filtro por extensión. |
| `GET`  | `/files/search` | Busca archivos dentro del proyecto usando un patrón glob (`/.ts`), nombre o contenido textual (con opción de regex limitada). |
| `GET`  | `/files/{fileId}/info` | Obtiene metadatos del archivo (tamaño, hash SHA‑256, fecha de modificación, charset detectado). |

### 3.2 Lectura Eficiente de Archivos Grandes

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET`  | `/files/{fileId}/content` | Obtiene el contenido completo del archivo. Acepta el parámetro `lines` para limitar a un rango (ej. `?lines=100-200`). La respuesta incluye ETag del hash del contenido. |
| `GET`  | `/files/{fileId}/chunk?offset=0&length=4096` | Lectura a nivel de bytes, ideal para archivos de más de 10 MB. Soporta peticiones `Range` HTTP estándar. |

### 3.3 Operaciones de Escritura de Alta Precisión

| Método | Ruta | Descripción |
|--------|------|-------------|
| `PATCH` | `/files/{fileId}/character` | Reemplaza uno o varios caracteres consecutivos en una posición exacta (línea, columna, offset y longitud). |
| `PATCH` | `/files/{fileId}/line` | Reemplaza una línea completa o un rango de líneas. Se puede exigir coincidencia previa de contenido (`expectedContent`) para evitar corrupciones. |
| `PATCH` | `/files/{fileId}/fragment` | Inserta o elimina un bloque de texto en una posición definida por coordenadas (antes/después de línea, o en offset). |
| `PUT`  | `/files/{fileId}/content` | Sustituye el contenido entero del archivo. Requiere la cabecera `If-Match` con el ETag actual para prevenir sobreescrituras accidentales. |

### 3.4 Control de Sesión y Contexto

| Método | Ruta | Descripción |
|--------|------|-------------|
| `POST` | `/context` | Crea un contexto de edición que puede agrupar varios cambios en una transacción. |
| `POST` | `/context/{contextId}/commit` | Aplica atómicamente todos los cambios registrados en el contexto. |
| `DELETE`| `/context/{contextId}` | Descarta el contexto sin aplicar cambios. |

### 3.5 Registro de Actividad y Reversión

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET`  | `/files/{fileId}/history` | Historial de cambios aplicados por Zeus IA, con posibilidad de revertir a una versión anterior (`POST .../revert`). |
| `POST` | `/files/{fileId}/backup` | Genera un respaldo manual antes de una operación crítica. |

## 4. Modelo de Datos

A continuación se describen las entidades fundamentales que circulan en las peticiones y respuestas.

### 4.1 FileNode (vista del sistema de archivos)

```json
{
  "id": "path:src/utils/helpers.ts",
  "name": "helpers.ts",
  "type": "file",
  "mimeType": "text/plain",
  "size": 12543,
  "hash": "sha256:abc123...",
  "children": null
}
```

La propiedad `id` es una representación canónica basada en la ruta relativa al workspace, normalizada y escapada para URLs.

### 4.2 FileInfo (metadatos extendidos)

```json
{
  "fileId": "path:src/utils/helpers.ts",
  "exists": true,
  "size": 12543,
  "hash": "sha256:abc123...",
  "lineCount": 320,
  "encoding": "UTF-8",
  "lastModified": "2025-01-15T10:30:00Z",
  "etag": "\"d41d8cd98f00b204e9800998ecf8427e\""
}
```

### 4.3 FilePatch (operación de escritura)

Cada endpoint de escritura consume un objeto que describe la transformación deseada. Ejemplo de reemplazo de carácter:

```json
{
  "operation": "replaceCharacters",
  "position": {
    "line": 42,
    "column": 5,
    "offset": 1200
  },
  "length": 1,
  "newText": "x",
  "expectedCurrentText": "y"
}
```

### 4.4 FileChange (entrada en el historial)

```json
{
  "changeId": "uuid-1234",
  "fileId": "path:src/utils/helpers.ts",
  "timestamp": "...",
  "type": "character",
  "description": "Cambió 'y' por 'x' en línea 42 columna 5",
  "patch": { ... },
  "previousHash": "...",
  "newHash": "..."
}
```

## 5. Seguridad

La API se despliega típicamente en un entorno de confianza (ej. extensión de IDE), pero debe implementar medidas robustas para evitar fugas de información y daños al código.

- Autenticación y autorización: tokens de acceso (API Key o JWT) generados por el IDE para cada sesión. Cada token está vinculado a un `workspaceId` y tiene alcance limitado (solo lectura, lectura‑escritura, etc.). Renovación automática mediante refresh tokens de corta duración.
- Aislamiento de paths: todas las rutas se resuelven respecto al directorio raíz del workspace, impidiendo viajes fuera del sandbox (`../`). Se valida estrictamente que los `fileId` pertenezcan al proyecto.
- Validación de contenido: antes de aplicar cualquier cambio se comprueba que la zona afectada contenga exactamente el texto esperado (campo `expectedCurrentText`). Esto previene modificaciones sobre código alterado externamente.
- Protección contra escrituras masivas: se limita la frecuencia de operaciones por token (rate limiting) y se requiere confirmación explícita para modificaciones que afecten más de N líneas.
- Cifrado y confidencialidad: la comunicación siempre se realiza sobre HTTPS con TLS 1.3. Las copias temporales de archivos (backups) se almacenan cifradas y se eliminan tras un tiempo configurable.
- Registro de auditoría: cada cambio queda registrado con el identificador del modelo, el prompt asociado y el resultado, lo que permite trazabilidad completa en entornos de desarrollo profesional.

## 6. Stack Tecnológico Sugerido

- Lenguaje de backend: Node.js con TypeScript (alternativa robusta: Rust con Actix‑web para máximo rendimiento en manejo de archivos grandes).
- Framework REST: Express.js con middlewares de compresión, CORS y helmet, o Fastify para latencias ultrabajas.
- Manejo de sistema de archivos: módulo `fs/promises` con streams para chunks. Librería `chokidar` para notificaciones opcionales de cambios en tiempo real.
- Almacenamiento de metadatos: base de datos embebida tipo SQLite (o nivelDB) para el historial de cambios, índices de búsqueda y estados de contexto. No debe cargarse en memoria ya que los proyectos pueden ser extensos.
- Búsqueda avanzada: `ripgrep` o `grep` con ejecución controlada para búsquedas textuales de alta velocidad. Se pueden exponer como un endpoint con límite de resultados.
- Transacciones y atomicidad: operaciones de escritura múltiple se envuelven en un contexto que primero escribe en archivos temporales y luego renombra atómicamente tras verificar checksums. Se puede implementar con `fs.rename`.
- Contenedorización: despliegue ligero como un proceso local o sidecar en el entorno de desarrollo, sin dependencias externas. Se empaqueta con pkg o se distribuye como imagen OCI.

## 7. Consideraciones de Rendimiento y Escalabilidad

- Archivos extremadamente grandes (logs, dumps): el endpoint `/chunk` con soporte de `Range` permite al modelo leer segmentos pequeños sin cargar el archivo completo. La paginación automática basada en líneas evita superar límites de memoria.
- Caché inteligente: el hash de cada archivo se cachememoria y solo se recalcula si `mtime` es más reciente. Esto acelera verificaciones de consistencia.
- Compresión de respuestas: uso de gzip/brotli en respuestas de contenido para reducir latencia, sobre todo en estructuras de árbol grandes.
- Operaciones asíncronas: todas las lecturas y escrituras son no bloqueantes. Para modificaciones de muchos archivos se utilizan colas de trabajo con concurrencia controlada.
- Estrategia de errores: códigos HTTP estándar (404 para archivo no encontrado, 409 para conflicto de edición, 412 si falla la verificación de contenido previo). Mensajes de error descriptivos en JSON permiten al modelo reaccionar de forma autónoma.

Esta API REST se concibe como un componente fundamental para cerrar la brecha entre la inteligencia artificial generativa y el desarrollo de software real, ofreciendo un control absoluto sobre el código base sin sacrificar seguridad ni integridad. Su diseño modular permite extenderla fácilmente con versiones futuras que incorporen AST (análisis de sintaxis) para operaciones semánticas, integración con control de versiones y colaboración en tiempo real.

## Instalación

```bash
npm install
```

## Ejecución

```bash
npm start
```

## Desarrollo

```bash
npm run dev
```

## Swagger

Abre `http://localhost:8741/api-docs` una vez iniciado el servidor.