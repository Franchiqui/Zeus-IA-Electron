# ApiCol Conocimiento

Para organizar el almacenamiento de esta API Se utilizará una base de datos local de Pocket Base.

## Documento de Arquitectura de API: Apicol API v1.0

### 1. Resumen Ejecutivo y Propósito

Apicol API es una interfaz de programación de aplicaciones (API) RESTful diseñada para ser el núcleo de un Sistema de Gestión de Conocimiento Aumentado por Recuperación (RAG) y Orquestación de Modelos de Lenguaje de Gran Escala (LLM). Su propósito es abstraer la complejidad de la interacción con múltiples proveedores de IA y la gestión de conocimiento estructurado, proporcionando una capa de servicio unificada, segura y escalable.

La API permite a los desarrolladores y sistemas externos:
- Orquestar Modelos de IA: Configurar, gestionar y consultar una flota heterogénea de modelos de lenguaje (OpenAI, Google, Anthropic, Ollama, etc.) a través de una única interfaz.
- Gestionar Conocimiento Jerárquico: Crear, mantener y navegar por una base de conocimiento organizada en una taxonomía de árbol (categorías anidadas), donde cada nodo puede contener documentos o fragmentos de información.
- Ejecutar Consultas Contextuales (RAG): Realizar preguntas en lenguaje natural que, de forma transparente, recuperan el contexto más relevante de la base de conocimiento y lo inyectan en el prompt del modelo configurado, generando respuestas precisas y fundamentadas.

La metáfora de "categorías dentro de categorías" se materializa en un sistema de taxonomías flexibles, permitiendo una organización lógica y navegable del conocimiento, desde lo más general hasta lo más específico.

### 2. Stack Tecnológico Propuesto

- Framework API: Python con FastAPI (por su rendimiento, validación automática con Pydantic y generación de documentación OpenAPI/Swagger).
- Base de Datos Relacional: PostgreSQL (para almacenar la estructura de taxonomías, configuraciones de modelos, metadatos de documentos y usuarios).
- Base de Datos Vectorial: pgvector (extensión de PostgreSQL) o Qdrant (servicio dedicado) para almacenar y buscar embeddings de forma eficiente.
- Procesamiento de Documentos: Apache Tika o Unstructured.io (para extraer texto de PDFs, DOCX, etc.).
- Generación de Embeddings: Modelo de embeddings de OpenAI (`text-embedding-3-small`), Google (`text-embedding-004`) o modelos locales como BGE o all-MiniLM-L6-v2.
- Autenticación y Autorización: OAuth 2.0 con JWT (JSON Web Tokens) y control de acceso basado en roles (RBAC).
- Contenedorización: Docker y Docker Compose para entornos de desarrollo y producción.
- Documentación: OpenAPI 3.1 (generada automáticamente por FastAPI).

### 3. Modelo de Datos Conceptual

#### 3.1. Entidades Principales

- `User`: Representa un usuario del sistema (Administrador, Editor, Consultor).
- `AIProvider`: Configuración de un proveedor de IA (nombre, endpoint base, tipo de API key).
- `AIModel`: Instancia de un modelo configurado (ej. `gpt-4-turbo`). Pertenece a un `AIProvider`. Contiene parámetros por defecto (temperatura, `max_tokens`, etc.).
- `Category`: Nodo en el árbol de taxonomía. Tiene una relación padre-hijo recursiva (`parent_id`). Almacena nombre, descripción y metadatos.
- `Document`: Representa un archivo o texto plano subido. Pertenece a una `Category`. Contiene el texto original y metadatos (tipo MIME, fecha de subida).
- `DocumentChunk`: Fragmento de un `Document` (ej. 500 tokens). Es la unidad que se vectoriza y almacena en la base de datos vectorial. Contiene el texto del fragmento y su `embedding`.
- `Conversation`: Historial de una sesión de preguntas y respuestas. Puede estar asociada a un `AIModel` y a un contexto de `Category`.
- `QueryLog`: Registro de cada consulta RAG, incluyendo el prompt final, los fragmentos recuperados, el modelo usado y la respuesta generada.

#### 3.2. Relaciones Clave

- `Category` 1:N `Category` (auto-referencia jerárquica).
- `Category` 1:N `Document`.
- `Document` 1:N `DocumentChunk`.
- `AIModel` 1:N `Conversation`.
- `User` 1:N `Conversation`.

### 4. Endpoints de la API (RESTful)

La API se estructura en los siguientes recursos principales. Todas las rutas están prefijadas con `/api/v1`.

#### 4.1. Gestión de Modelos de IA (`/models`)

| Método | Ruta | Descripción |
| :--- | :--- | :--- |
| `GET` | `/providers` | Lista los proveedores de IA disponibles y configurados. |
| `POST` | `/providers` | Registra un nuevo proveedor (ej. añadir una API key para OpenAI). |
| `GET` | `/models` | Lista todas las instancias de modelos configurados. |
| `POST` | `/models` | Crea una nueva configuración de modelo (selecciona proveedor, define parámetros). |
| `GET` | `/models/{model_id}` | Obtiene los detalles de un modelo específico. |
| `PATCH` | `/models/{model_id}` | Actualiza la configuración de un modelo (ej. cambiar temperatura). |
| `DELETE` | `/models/{model_id}` | Elimina una configuración de modelo. |

#### 4.2. Gestión de Taxonomías (`/taxonomies`)

| Método | Ruta | Descripción |
| :--- | :--- | :--- |
| `GET` | `/categories` | Lista las categorías raíz (primer nivel). Soporta paginación. |
| `GET` | `/categories/{category_id}` | Obtiene una categoría y sus hijos directos (subcategorías). |
| `POST` | `/categories` | Crea una nueva categoría. El cuerpo incluye `parent_id` (opcional, para crear subcategorías). |
| `PATCH` | `/categories/{category_id}` | Actualiza el nombre o descripción de una categoría. |
| `DELETE` | `/categories/{category_id}` | Elimina una categoría y todo su sub-árbol (cascada). |
| `POST` | `/categories/{category_id}/move` | Mueve una categoría a un nuevo padre (reorganización del árbol). |

#### 4.3. Gestión de Documentos (`/documents`)

| Método | Ruta | Descripción |
| :--- | :--- | :--- |
| `GET` | `/categories/{category_id}/documents` | Lista los documentos dentro de una categoría. |
| `POST` | `/categories/{category_id}/documents` | Sube un nuevo documento a una categoría. Acepta `multipart/form-data` (archivo) o `application/json` (texto plano). |
| `GET` | `/documents/{document_id}` | Obtiene los metadatos y el contenido de un documento. |
| `DELETE` | `/documents/{document_id}` | Elimina un documento y sus fragmentos vectorizados. |
| `POST` | `/documents/{document_id}/reprocess` | Fuerza el re-vectorizado de un documento (útil si se cambia el modelo de embeddings). |

#### 4.4. Consultas Contextuales (RAG) (`/queries`)

| Método | Ruta | Descripción |
| :--- | :--- | :--- |
| `POST` | `/queries/ask` | Endpoint principal. Realiza una pregunta. Cuerpo: `{ "question": "...", "model_id": "...", "category_id": "..." (opcional, para restringir búsqueda), "top_k": 5 (opcional) }`. Devuelve la respuesta del modelo y los fragmentos de contexto utilizados. |
| `POST` | `/queries/stream` | Versión del endpoint `/ask` que utiliza Server-Sent Events (SSE) para transmit

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