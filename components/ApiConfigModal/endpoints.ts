// API Endpoints configuration
import { ApiEndpoint } from './types';

export const ENDPOINTS: ApiEndpoint[] = [
  {
    id: 'list-categories',
    method: 'GET',
    path: '/api/v1/categories',
    description: 'Lista las categorías raíz con paginación',
    parameters: [
      { name: 'page', type: 'integer', required: false, description: 'Número de página', in: 'query' },
      { name: 'perPage', type: 'integer', required: false, description: 'Elementos por página', in: 'query' }
    ]
  },
  {
    id: 'get-category',
    method: 'GET',
    path: '/api/v1/categories/{categoryId}',
    description: 'Obtiene una categoría y sus hijos directos',
    parameters: [
      { name: 'categoryId', type: 'string', required: true, description: 'ID de la categoría', in: 'path' }
    ]
  },
  {
    id: 'create-category',
    method: 'POST',
    path: '/api/v1/categories',
    description: 'Crea una nueva categoría',
    parameters: [
      { name: 'name', type: 'string', required: true, description: 'Nombre de la categoría', in: 'body' },
      { name: 'description', type: 'string', required: false, description: 'Descripción de la categoría', in: 'body' },
      { name: 'parentId', type: 'string', required: false, description: 'ID de la categoría padre', in: 'body' }
    ],
    requestBody: {
      contentType: 'application/json',
      fields: [
        { name: 'name', type: 'string', required: true, description: 'Nombre de la categoría' },
        { name: 'description', type: 'string', required: false, description: 'Descripción de la categoría' },
        { name: 'parentId', type: 'string', required: false, description: 'ID de la categoría padre' }
      ]
    }
  },
  {
    id: 'update-category',
    method: 'PATCH',
    path: '/api/v1/categories/{categoryId}',
    description: 'Actualiza una categoría',
    parameters: [
      { name: 'categoryId', type: 'string', required: true, description: 'ID de la categoría', in: 'path' },
      { name: 'name', type: 'string', required: false, description: 'Nombre de la categoría', in: 'body' },
      { name: 'description', type: 'string', required: false, description: 'Descripción de la categoría', in: 'body' }
    ],
    requestBody: {
      contentType: 'application/json',
      fields: [
        { name: 'name', type: 'string', required: false, description: 'Nombre de la categoría' },
        { name: 'description', type: 'string', required: false, description: 'Descripción de la categoría' }
      ]
    }
  },
  {
    id: 'delete-category',
    method: 'DELETE',
    path: '/api/v1/categories/{categoryId}',
    description: 'Elimina una categoría y su subárbol',
    parameters: [
      { name: 'categoryId', type: 'string', required: true, description: 'ID de la categoría', in: 'path' }
    ]
  },
  {
    id: 'move-category',
    method: 'POST',
    path: '/api/v1/categories/{categoryId}/move',
    description: 'Mueve una categoría a un nuevo padre',
    parameters: [
      { name: 'categoryId', type: 'string', required: true, description: 'ID de la categoría', in: 'path' },
      { name: 'newParentId', type: 'string', required: true, description: 'ID del nuevo padre', in: 'body' }
    ],
    requestBody: {
      contentType: 'application/json',
      fields: [
        { name: 'newParentId', type: 'string', required: true, description: 'ID del nuevo padre' }
      ]
    }
  },
  {
    id: 'list-documents',
    method: 'GET',
    path: '/api/v1/categories/{categoryId}/documents',
    description: 'Lista documentos dentro de una categoría',
    parameters: [
      { name: 'categoryId', type: 'string', required: true, description: 'ID de la categoría', in: 'path' }
    ]
  },
  {
    id: 'upload-document',
    method: 'POST',
    path: '/api/v1/categories/{categoryId}/documents',
    description: 'Sube un documento a una categoría',
    parameters: [
      { name: 'categoryId', type: 'string', required: true, description: 'ID de la categoría', in: 'path' },
      { name: 'file', type: 'file', required: true, description: 'Archivo a subir', in: 'body' }
    ],
    requestBody: {
      contentType: 'multipart/form-data',
      fields: [
        { name: 'file', type: 'file', required: true, description: 'Archivo a subir' }
      ]
    }
  },
  {
    id: 'get-document',
    method: 'GET',
    path: '/api/v1/documents/{documentId}',
    description: 'Obtiene detalles de un documento',
    parameters: [
      { name: 'documentId', type: 'string', required: true, description: 'ID del documento', in: 'path' }
    ]
  },
  {
    id: 'delete-document',
    method: 'DELETE',
    path: '/api/v1/documents/{documentId}',
    description: 'Elimina un documento',
    parameters: [
      { name: 'documentId', type: 'string', required: true, description: 'ID del documento', in: 'path' }
    ]
  },
  {
    id: 'reprocess-document',
    method: 'POST',
    path: '/api/v1/documents/{documentId}/reprocess',
    description: 'Reprocesa un documento',
    parameters: [
      { name: 'documentId', type: 'string', required: true, description: 'ID del documento', in: 'path' }
    ]
  },
  {
    id: 'document-chunks',
    method: 'POST',
    path: '/api/v1/documents/{documentId}/chunks',
    description: 'Obtiene los chunks de un documento',
    parameters: [
      { name: 'documentId', type: 'string', required: true, description: 'ID del documento', in: 'path' }
    ]
  },
  {
    id: 'search-queries',
    method: 'POST',
    path: '/api/v1/queries/search',
    description: 'Búsqueda semántica',
    parameters: [
      { name: 'query', type: 'string', required: true, description: 'Consulta de búsqueda', in: 'body' },
      { name: 'categoryId', type: 'string', required: false, description: 'ID de la categoría', in: 'body' },
      { name: 'topK', type: 'integer', required: false, description: 'Número de resultados', in: 'body' }
    ],
    requestBody: {
      contentType: 'application/json',
      fields: [
        { name: 'query', type: 'string', required: true, description: 'Consulta de búsqueda' },
        { name: 'categoryId', type: 'string', required: false, description: 'ID de la categoría' },
        { name: 'topK', type: 'integer', required: false, description: 'Número de resultados' }
      ]
    }
  },
  {
    id: 'ask-queries',
    method: 'POST',
    path: '/api/v1/queries/ask',
    description: 'Pregunta con RAG',
    parameters: [
      { name: 'question', type: 'string', required: true, description: 'Pregunta', in: 'body' },
      { name: 'categoryId', type: 'string', required: true, description: 'ID de la categoría', in: 'body' },
      { name: 'modelId', type: 'string', required: true, description: 'ID del modelo', in: 'body' },
      { name: 'topK', type: 'integer', required: false, description: 'Número de resultados', in: 'body' }
    ],
    requestBody: {
      contentType: 'application/json',
      fields: [
        { name: 'question', type: 'string', required: true, description: 'Pregunta' },
        { name: 'categoryId', type: 'string', required: true, description: 'ID de la categoría' },
        { name: 'modelId', type: 'string', required: true, description: 'ID del modelo' },
        { name: 'topK', type: 'integer', required: false, description: 'Número de resultados' }
      ]
    }
  },
  {
    id: 'stream-queries',
    method: 'POST',
    path: '/api/v1/queries/stream',
    description: 'Pregunta con RAG streaming',
    parameters: [
      { name: 'question', type: 'string', required: true, description: 'Pregunta', in: 'body' },
      { name: 'categoryId', type: 'string', required: true, description: 'ID de la categoría', in: 'body' },
      { name: 'modelId', type: 'string', required: true, description: 'ID del modelo', in: 'body' },
      { name: 'topK', type: 'integer', required: false, description: 'Número de resultados', in: 'body' }
    ],
    requestBody: {
      contentType: 'application/json',
      fields: [
        { name: 'question', type: 'string', required: true, description: 'Pregunta' },
        { name: 'categoryId', type: 'string', required: true, description: 'ID de la categoría' },
        { name: 'modelId', type: 'string', required: true, description: 'ID del modelo' },
        { name: 'topK', type: 'integer', required: false, description: 'Número de resultados' }
      ]
    }
  }
];
