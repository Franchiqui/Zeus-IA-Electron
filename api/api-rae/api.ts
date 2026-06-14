import express, { Request, Response } from 'express';
import { z } from 'zod';
import swaggerUi from 'swagger-ui-express';
import swaggerJsdoc from 'swagger-jsdoc';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import multer from 'multer';
import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';
import { pb, authAsAdmin } from './pocketbase';

const __zeusFilterObjectToPbFilter = (value: any): string => {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value !== 'object' || Array.isArray(value)) return String(value);

  const entries = Object.entries(value as Record<string, unknown>);
  return entries
    .map(([k, v]) => {
      if (v === null) return k + ' = null';
      if (typeof v === 'number' || typeof v === 'boolean') return k + ' = ' + String(v);
      const escaped = String(v).replace(/'/g, "\\'");
      return k + " = '" + escaped + "'";
    })
    .join(' && ');
};

const __zeusCollection = (pb: any, name: string) => {
  const svc = (pb as any).collection(name) as any;

  if (typeof svc.getRecord !== 'function') {
    svc.getRecord = (id: string, options?: any) => svc.getOne(id, options);
  }
  if (typeof svc.createRecord !== 'function') {
    svc.createRecord = (data: any, options?: any) => svc.create(data, options);
  }
  if (typeof svc.updateRecord !== 'function') {
    svc.updateRecord = (id: string, data: any, options?: any) => svc.update(id, data, options);
  }
  if (typeof svc.deleteRecord !== 'function') {
    svc.deleteRecord = (id: string, options?: any) => svc.delete(id, options);
  }
  if (typeof svc.getMany !== 'function') {
    svc.getMany = async (params?: any) => {
      const rawPage = Number(params?.page ?? 1);
      const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
      const rawLimit = Number(params?.limit ?? params?.perPage ?? 30);
      const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 30;
      const options: Record<string, unknown> = {};

      if (params?.sort != null) options.sort = String(params.sort);
      if (params?.expand != null) options.expand = params.expand;
      if (params?.fields != null) options.fields = params.fields;
      if (params?.filter != null) {
        const filter = __zeusFilterObjectToPbFilter(params.filter);
        if (filter) options.filter = filter;
      }

      const res = await svc.getList(page, limit, options);
      return {
        records: Array.isArray(res?.items) ? res.items : [],
        page: typeof res?.page === 'number' ? res.page : page,
        limit: typeof res?.perPage === 'number' ? res.perPage : limit,
        total: typeof res?.totalItems === 'number' ? res.totalItems : 0,
        totalPages: typeof res?.totalPages === 'number' ? res.totalPages : 1
      };
    };
  }

  return svc;
};


dotenv.config({ path: './.env' });

// ===== Embedding fijo: siempre Ollama local con nomic-embed-text =====
const OLLAMA_BASE_URL  = (process.env.OLLAMA_BASE_URL  || 'http://127.0.0.1:11434').replace(/\/$/, '');
const OLLAMA_EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text';

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());

// Authenticate with PocketBase on startup
// Generic CRUD route generator
function registerCrudRoutes(collectionName: string, basePath: string) {
  const svc = __zeusCollection(pb, collectionName);

  app.get(basePath, async (req: Request, res: Response) => {
    try {
      const rawPage = Number(req.query.page ?? 1);
      const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
      const rawPerPage = Number(req.query.perPage ?? req.query.limit ?? 30);
      const perPage = Number.isFinite(rawPerPage) && rawPerPage > 0 ? rawPerPage : 30;
      const result = await svc.getList(page, perPage);
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  app.post(basePath, async (req: Request, res: Response) => {
    try {
      await authAsAdmin();
      const record = await svc.create(req.body);
      res.status(201).json(record);
    } catch (e) {
      res.status(400).json({ error: String(e) });
    }
  });

  app.get(`${basePath}/:id`, async (req: Request, res: Response) => {
    try {
      const record = await svc.getOne(req.params.id);
      res.json(record);
    } catch (e) {
      res.status(404).json({ error: 'Not found' });
    }
  });

  app.patch(`${basePath}/:id`, async (req: Request, res: Response) => {
    try {
      await authAsAdmin();
      const record = await svc.update(req.params.id, req.body);
      res.json(record);
    } catch (e) {
      res.status(400).json({ error: String(e) });
    }
  });

  app.delete(`${basePath}/:id`, async (req: Request, res: Response) => {
    try {
      await authAsAdmin();
      await svc.delete(req.params.id);
      res.json({ success: true, id: req.params.id });
    } catch (e) {
      res.status(404).json({ error: String(e) });
    }
  });
}

// Register standard CRUD routes
registerCrudRoutes('providers', '/api/v1/providers');
registerCrudRoutes('models', '/api/v1/models');
registerCrudRoutes('conversations', '/api/v1/conversations');
registerCrudRoutes('messages', '/api/v1/messages');
registerCrudRoutes('pipeline_configs', '/api/v1/pipeline-configs');
registerCrudRoutes('chunks', '/api/v1/chunks');
registerCrudRoutes('ai_models', '/api/v1/ai-models');

// Logging inicial de conexión
console.log('[API RAE] Conectando a PocketBase en:', pb.baseUrl);
authAsAdmin().then(() => {
  console.log('[API RAE] Autenticación admin exitosa');
}).catch((e) => {
  console.error('[API RAE] Fallo autenticación admin:', e);
});

// ─── Custom CRUD: Categories with cascade delete ───
const categoriesSvc = __zeusCollection(pb, 'categories');
const documentsSvc = __zeusCollection(pb, 'documents');
const chunksSvc = __zeusCollection(pb, 'chunks');

app.get('/api/v1/categories', async (req: Request, res: Response) => {
  try {
    const rawPage = Number(req.query.page ?? 1);
    const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
    const rawPerPage = Number(req.query.perPage ?? req.query.limit ?? 30);
    const perPage = Number.isFinite(rawPerPage) && rawPerPage > 0 ? rawPerPage : 30;
    const result = await categoriesSvc.getList(page, perPage);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.post('/api/v1/categories', async (req: Request, res: Response) => {
  try {
    const record = await categoriesSvc.create(req.body);
    res.status(201).json(record);
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

app.get('/api/v1/categories/:id', async (req: Request, res: Response) => {
  try {
    const record = await categoriesSvc.getOne(req.params.id);
    res.json(record);
  } catch (e) {
    res.status(404).json({ error: 'Not found' });
  }
});

app.patch('/api/v1/categories/:id', async (req: Request, res: Response) => {
  try {
    const record = await categoriesSvc.update(req.params.id, req.body);
    res.json(record);
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

app.delete('/api/v1/categories/:id', async (req: Request, res: Response) => {
  try {
    const categoryId = req.params.id;

    // 1. Obtener documentos de la categoría
    const docsRes = await documentsSvc.getMany({ filter: { categoryId }, limit: 1000 });
    const docs = docsRes.records || [];

    // 2. Borrar chunks de cada documento, luego los documentos
    for (const doc of docs) {
      const chunksRes = await chunksSvc.getMany({ filter: { documentId: doc.id }, limit: 1000 });
      const chunks = chunksRes.records || [];
      for (const chunk of chunks) {
        await chunksSvc.delete(chunk.id);
      }
      await documentsSvc.delete(doc.id);
    }

    // 3. Borrar la categoría
    await categoriesSvc.delete(categoryId);
    res.json({ success: true, id: categoryId, deletedDocuments: docs.length });
  } catch (e) {
    res.status(404).json({ error: String(e) });
  }
});

// ─── Custom CRUD: Documents with cascade delete ───
app.get('/api/v1/documents', async (req: Request, res: Response) => {
  try {
    const rawPage = Number(req.query.page ?? 1);
    const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
    const rawPerPage = Number(req.query.perPage ?? req.query.limit ?? 30);
    const perPage = Number.isFinite(rawPerPage) && rawPerPage > 0 ? rawPerPage : 30;
    const result = await documentsSvc.getList(page, perPage);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.post('/api/v1/documents', async (req: Request, res: Response) => {
  try {
    const record = await documentsSvc.create(req.body);
    res.status(201).json(record);
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

app.get('/api/v1/documents/:id', async (req: Request, res: Response) => {
  try {
    const record = await documentsSvc.getOne(req.params.id);
    res.json(record);
  } catch (e) {
    res.status(404).json({ error: 'Not found' });
  }
});

app.patch('/api/v1/documents/:id', async (req: Request, res: Response) => {
  try {
    const record = await documentsSvc.update(req.params.id, req.body);
    res.json(record);
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

app.delete('/api/v1/documents/:id', async (req: Request, res: Response) => {
  try {
    const documentId = req.params.id;

    // 1. Borrar chunks asociados
    const chunksRes = await chunksSvc.getMany({ filter: { documentId }, limit: 1000 });
    const chunks = chunksRes.records || [];
    for (const chunk of chunks) {
      await chunksSvc.delete(chunk.id);
    }

    // 2. Borrar el documento
    await documentsSvc.delete(documentId);
    res.json({ success: true, id: documentId, deletedChunks: chunks.length });
  } catch (e) {
    res.status(404).json({ error: String(e) });
  }
});

// Special routes for categories
app.post('/api/v1/categories/:id/move', async (req: Request, res: Response) => {
  try {
    const svc = __zeusCollection(pb, 'categories');
    const record = await svc.update(req.params.id, { parentId: req.body.newParentId });
    res.json(record);
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

app.get('/api/v1/categories/:categoryId/documents', async (req: Request, res: Response) => {
  try {
    const svc = __zeusCollection(pb, 'documents');
    const result = await svc.getMany({
      filter: { categoryId: req.params.categoryId }
    });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.post('/api/v1/categories/:categoryId/documents', upload.single('file'), async (req: Request, res: Response) => {
  try {
    console.log('Upload route hit. categoryId:', req.params.categoryId, 'body:', req.body, 'file:', req.file?.originalname);
    const svc = __zeusCollection(pb, 'documents');
    const formData = new FormData();

    if (req.body.title) formData.append('title', req.body.title);
    if (req.body.description) formData.append('description', req.body.description);
    formData.append('categoryId', req.params.categoryId);

    if (req.file) {
      const blob = new Blob([new Uint8Array(req.file.buffer)], { type: req.file.mimetype });
      formData.append('file', blob, req.file.originalname);
    }

    const record = await svc.create(formData);
    res.status(201).json(record);
  } catch (e) {
    console.error('Upload document error:', e);
    res.status(400).json({ error: String(e) });
  }
});

// Special route for documents reprocess
app.post('/api/v1/documents/:id/reprocess', async (req: Request, res: Response) => {
  try {
    const svc = __zeusCollection(pb, 'documents');
    const record = await svc.getOne(req.params.id);
    res.json({ status: 'reprocess_queued', documentId: req.params.id, title: record?.title, description: record?.description, categoryId: record?.categoryId });
  } catch (e) {
    res.status(404).json({ error: 'Document not found' });
  }
});

// Helper to extract text from a document file
async function extractTextFromDocument(documentId: string): Promise<string> {
  const record = await pb.collection('documents').getOne(documentId);
  console.log('Extract text debug:', { id: documentId, file: record.file, type: typeof record.file });
  if (!record || !record.file) return '';

  // Normalize filename from PocketBase file field (string, array of strings, or array of objects)
  let filename: string | undefined;
  if (Array.isArray(record.file)) {
    const first = record.file[0];
    filename = typeof first === 'string' ? first : (first?.name || first?.fileName);
  } else if (typeof record.file === 'string') {
    filename = record.file;
  } else if (record.file && typeof record.file === 'object') {
    filename = record.file.name || record.file.fileName;
  }
  if (!filename) {
    console.warn('Could not resolve filename from record.file:', record.file);
    return '';
  }

  // Build file URL using the full record (needs id + collectionId for pb.files.getUrl)
  let fileUrl: string;
  try {
    fileUrl = pb.files.getUrl(record, filename);
  } catch {
    // Fallback: manually construct the direct PocketBase files API URL
    fileUrl = `${pb.baseUrl}/api/files/${record.collectionId || record.collectionName || 'documents'}/${documentId}/${encodeURIComponent(filename)}`;
  }
  console.log('File URL:', fileUrl);

  // Download with admin auth token
  const token = pb.authStore.token;
  const res = await fetch(fileUrl, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  console.log('Download response status:', res.status, res.statusText);
  if (!res.ok) throw new Error(`Failed to download file: ${res.status} ${res.statusText}`);

  const buffer = Buffer.from(await res.arrayBuffer());
  const mimeType = res.headers.get('content-type') || '';
  console.log('Downloaded file:', { mimeType, size: buffer.length });

  if (mimeType.includes('pdf')) {
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    const parsed = await parser.getText();
    return parsed.text || '';
  }
  if (mimeType.includes('wordprocessingml') || mimeType.includes('msword')) {
    const parsed = await mammoth.extractRawText({ buffer });
    return parsed.value || '';
  }
  if (mimeType.includes('text') || mimeType.includes('json') || mimeType.includes('javascript') || mimeType.includes('html') || mimeType.includes('php') || mimeType.includes('python')) {
    return buffer.toString('utf-8');
  }
  return '';
}

// Generate chunks and embeddings for a document
app.post('/api/v1/documents/:id/chunks', async (req: Request, res: Response) => {
  try {
    const docSvc = __zeusCollection(pb, 'documents');
    const pipelineSvc = __zeusCollection(pb, 'pipeline_configs');
    const chunksSvc = __zeusCollection(pb, 'chunks');

    const doc = await docSvc.getOne(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    let text = req.body.text || doc.content || '';
    if (!text) {
      try {
        text = await extractTextFromDocument(req.params.id);
      } catch (e) {
        console.warn('Failed to extract text from file:', e);
      }
    }
    if (!text) return res.status(400).json({ error: 'No text to chunk. Provide text in body or ensure the document has a file with extractable content.' });

    const pipelineRes = await pipelineSvc.getMany({ filter: { isActive: true }, limit: 1 });
    const config = pipelineRes.records?.[0] || {};
    const chunkSize = config.chunkSize || 1000;
    const chunkOverlap = config.chunkOverlap || 200;
    const embeddingModelId = config.embeddingModelId;

    const chunks = chunkText(text, chunkSize, chunkOverlap);
    const created: any[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const content = chunks[i];
      let embedding: number[] = [];
      if (embeddingModelId) {
        try {
          embedding = await generateEmbedding(content, embeddingModelId);
        } catch (e) {
          console.warn('Embedding failed for chunk', i, e);
        }
      }
      const record = await chunksSvc.create({
        documentId: doc.id,
        categoryId: doc.categoryId || '',
        content,
        embedding: JSON.stringify(embedding),
        chunkIndex: i + 1
      });
      created.push(record);
    }

    await docSvc.update(doc.id, { chunksGenerated: true, content: text });
    res.json({ documentId: doc.id, chunksCreated: created.length, chunks: created });
  } catch (e: any) {
    console.error('Chunk generation error:', e);
    if (e?.response?.data) {
      console.error('PocketBase error data:', JSON.stringify(e.response.data, null, 2));
    }
    res.status(500).json({ error: String(e), details: e?.response?.data || null });
  }
});

// Search chunks by similarity
app.post('/api/v1/queries/search', async (req: Request, res: Response) => {
  try {
    const { question, categoryId, topK = 5 } = req.body;
    if (!question) return res.status(400).json({ error: 'question is required' });

    const pipelineSvc = __zeusCollection(pb, 'pipeline_configs');
    const pipelineRes = await pipelineSvc.getMany({ filter: { isActive: true }, limit: 1 });
    const config = pipelineRes.records?.[0] || {};
    const embeddingModelId = config.embeddingModelId;
    if (!embeddingModelId) return res.status(400).json({ error: 'No embedding model configured' });

    const questionEmbedding = await generateEmbedding(question, embeddingModelId);

    const chunksSvc = __zeusCollection(pb, 'chunks');
    const filter: any = {};
    if (categoryId) filter.categoryId = categoryId;
    const allChunks = await chunksSvc.getMany({ filter, limit: 1000 });
    const records = allChunks.records || [];

    const scored = records.map((r: any) => {
      const emb = JSON.parse(r.embedding || '[]');
      const score = cosineSimilarity(questionEmbedding, emb);
      return { ...r, score };
    });

    scored.sort((a: any, b: any) => b.score - a.score);
    const top = scored.slice(0, topK);
    res.json({ question, results: top });
  } catch (e) {
    console.error('Search error:', e);
    res.status(500).json({ error: String(e) });
  }
});

// Query routes
app.post('/api/v1/queries/ask', async (req: Request, res: Response) => {
  try {
    const svc = __zeusCollection(pb, 'ask');
    const record = await svc.create(req.body);
    res.status(201).json(record);
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

app.post('/api/v1/queries/stream', async (req: Request, res: Response) => {
  try {
    const svc = __zeusCollection(pb, 'stream');
    const record = await svc.create(req.body);
    res.status(201).json(record);
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

// Serve endpoints.json for the frontend
app.get('/endpoints.json', (req: Request, res: Response) => {
  res.sendFile(path.join(process.cwd(), 'API', 'endpoints.json'));
});

// Chat relay endpoint
app.post('/api/v1/chat', async (req: Request, res: Response) => {
  const { message, modelId, history = [], stream = false, systemContext = '' } = req.body;
  if (!message) {
    return res.status(400).json({ error: 'message is required' });
  }

  try {
    const pipelineSvc = __zeusCollection(pb, 'pipeline_configs');
    const pipelineRes = await pipelineSvc.getMany({ filter: { isActive: true }, limit: 1 });
    const activePipeline = pipelineRes.records?.[0];

    // Si hay un pipeline activo y el interruptor isActive es true, usar pipeline
    if (activePipeline && activePipeline.isActive) {
      console.log(`[Chat] Usando pipeline activo: ${activePipeline.name}`);
      // Redirigir internamente a la lógica de pipeline (copiando la lógica o llamando a la función)
      // Para simplificar y evitar duplicación, podemos llamar al endpoint de pipeline internamente o refactorizar
      // Pero dado que ya tenemos el código abajo, vamos a llamar a la función que implementa el pipeline o simplemente dejar que el frontend decida.
      // El usuario pidió que el interruptor controle el comportamiento.
      
      // Llamamos a la lógica de pipeline (podemos reutilizar el código de /api/v1/chat/pipeline)
      return await handlePipelineChat(req, res, activePipeline);
    }

    if (!modelId) {
      return res.status(400).json({ error: 'modelId is required when pipeline is inactive' });
    }

    const modelSvc = __zeusCollection(pb, 'models');
    const providerSvc = __zeusCollection(pb, 'providers');

    const model = await modelSvc.getOne(modelId);
    if (!model) return res.status(404).json({ error: 'Model not found' });
    console.log(`[Chat] Model fields:`, Object.keys(model));
    console.log(`[Chat] Model data:`, JSON.stringify(model, null, 2));

    const provider = await providerSvc.getOne(model.providerId);
    if (!provider) return res.status(404).json({ error: 'Provider not found' });

    const baseUrl = String(provider.baseUrl || '').replace(/\/$/, '');
    const apiKey = provider.apiKey || '';
    const modelName = model.model || model.modelName || model.name || '';
    const temperature = typeof model.temperature === 'number' ? model.temperature : 0.7;
    const maxTokens = typeof model.maxTokens === 'number' ? model.maxTokens : 2048;

    // Detect provider type by baseUrl
    const isOllama = provider.name === 'Ollama' || baseUrl.includes(':11434');
    const isLocal = isOllama || baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1');

    // UNIFIED TRUNCATION LOGIC for non-pipeline chat
    const MAX_TOTAL_TOKENS = isLocal ? 2500 : 30000;
    const historyMessages = Array.isArray(history) ? history : [];
    
    // 1. Truncate System Context if it's too big
    let finalSystemContext = systemContext || '';
    if (estimateTokens(finalSystemContext) > 1000) {
      finalSystemContext = finalSystemContext.substring(0, 4000) + '\n... [Instrucciones truncadas]';
    }

    let systemTokens = estimateTokens(finalSystemContext);
    let messageTokens = estimateTokens(message || '');
    
    // 2. Decide how much history to keep
    let finalHistory = historyMessages;
    let historyTokens = finalHistory.reduce((sum: number, m: any) => sum + estimateTokens(m.content || ''), 0);
    
    if (systemTokens + historyTokens + messageTokens > MAX_TOTAL_TOKENS - 500) {
      finalHistory = historyMessages.slice(-2);
      historyTokens = finalHistory.reduce((sum: number, m: any) => sum + estimateTokens(m.content || ''), 0);
    }

    const messages = [
      ...(finalSystemContext ? [{ role: 'system', content: finalSystemContext }] : []),
      ...finalHistory,
      { role: 'user', content: message }
    ];

    if (isLocal) {
      req.socket.setTimeout(0); // No timeout for local generation
    }

    if (!stream) {
      let providerRes: any;
      let answer = '';

      if (isOllama) {
        const ollamaRes = await fetch(`${baseUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: modelName,
            messages,
            stream: false,
            options: { temperature, num_predict: maxTokens }
          })
        });
        if (!ollamaRes.ok) throw new Error(`Ollama error: ${ollamaRes.status}`);
        providerRes = await ollamaRes.json();
        answer = providerRes.message?.content || '';
      } else {
        // OpenAI-compatible (OpenAI, DeepSeek, etc.)
        const openaiRes = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: modelName,
            messages,
            temperature,
            max_tokens: maxTokens
          })
        });
        if (!openaiRes.ok) {
          const errText = await openaiRes.text();
          throw new Error(`Provider error ${openaiRes.status}: ${errText}`);
        }
        providerRes = await openaiRes.json();
        answer = providerRes.choices?.[0]?.message?.content || '';
      }

      return res.json({
        role: 'assistant',
        content: answer,
        model: modelName,
        provider: provider.name,
        usage: providerRes.usage || null
      });
    }

    // Streaming SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    if (isOllama) {
      const ollamaRes = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelName,
          messages,
          stream: true,
          options: { temperature, num_predict: maxTokens }
        })
      });
      if (!ollamaRes.ok || !ollamaRes.body) throw new Error(`Ollama error: ${ollamaRes.status}`);
      const reader = ollamaRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const chunk = JSON.parse(line);
              if (chunk.message?.content) {
                res.write(`data: ${JSON.stringify({ content: chunk.message.content })}\n\n`);
              }
              if (chunk.done) {
                res.write(`data: [DONE]\n\n`);
                res.end();
                return;
              }
            } catch { /* ignore */ }
          }
        }
      } finally {
        reader.releaseLock();
      }
      res.write(`data: [DONE]\n\n`);
      res.end();
    } else {
      const openaiRes = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: modelName,
          messages,
          temperature,
          max_tokens: maxTokens,
          stream: true
        })
      });
      if (!openaiRes.ok || !openaiRes.body) {
        const errText = await openaiRes.text();
        throw new Error(`Provider error ${openaiRes.status}: ${errText}`);
      }
      const reader = openaiRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed === 'data: [DONE]') {
              res.write(`data: [DONE]\n\n`);
              res.end();
              return;
            }
            if (trimmed.startsWith('data: ')) {
              try {
                const chunk = JSON.parse(trimmed.slice(6));
                const content = chunk.choices?.[0]?.delta?.content;
                if (typeof content === 'string') {
                  res.write(`data: ${JSON.stringify({ content })}\n\n`);
                }
              } catch { /* ignore */ }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
      res.write(`data: [DONE]\n\n`);
      res.end();
    }
  } catch (e) {
    if (!res.headersSent) {
      res.status(500).json({ error: String(e) });
    } else {
      res.write(`data: ${JSON.stringify({ error: String(e) })}\n\n`);
      res.end();
    }
  }
});

// Simple token estimator (roughly 4 chars per token)
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// Helper to call any model by ID with a list of messages
async function callModelById(modelId: string, messages: any[], override?: any, stream: boolean = false) {
  let baseUrl = '';
  let apiKey = '';
  let modelName = '';
  let temperature = 0.7;
  let maxTokens = 2048;
  let topP: number | undefined;
  let frequencyPenalty: number | undefined;
  let presencePenalty: number | undefined;
  let isOllama = false;
  let isOllamaCloud = false;

  if (override && override.provider) {
    baseUrl = String(override.apiUrl || override.baseUrl || '').replace(/\/$/, '');
    apiKey = override.apiKey || '';
    modelName = override.model || '';
    temperature = typeof override.temperature === 'number' ? override.temperature : 0.7;
    maxTokens = typeof override.maxTokens === 'number' ? override.maxTokens : 4096;
    topP = typeof override.topP === 'number' ? override.topP : undefined;
    frequencyPenalty = typeof override.frequencyPenalty === 'number' ? override.frequencyPenalty : undefined;
    presencePenalty = typeof override.presencePenalty === 'number' ? override.presencePenalty : undefined;
    isOllamaCloud = override.provider === 'Ollama Cloud';
    if (!isOllamaCloud) {
      isOllama = override.provider === 'Ollama' || baseUrl.includes(':11434');
    }
  } else {
    const modelSvc = __zeusCollection(pb, 'models');
    const providerSvc = __zeusCollection(pb, 'providers');
    const model = await modelSvc.getOne(modelId);
    if (!model) throw new Error('Model not found: ' + modelId);
    const provider = await providerSvc.getOne(model.providerId);
    if (!provider) throw new Error('Provider not found for model: ' + modelId);

    baseUrl = String(provider.baseUrl || '').replace(/\/$/, '');
    apiKey = provider.apiKey || '';
    modelName = model.modelName || model.name || model.nombre_modelo || '';
    temperature = typeof model.temperature === 'number' ? model.temperature : 0.7;
    maxTokens = typeof model.maxTokens === 'number' ? model.maxTokens : 2048;
    isOllamaCloud = provider.name === 'Ollama Cloud';
    isOllama = baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1') || baseUrl.includes(':11434');

    if (!modelName) {
      throw new Error(`Model name is empty for model ID: ${modelId}. Available fields: ${Object.keys(model).join(', ')}`);
    }

    console.log(`[callModelById] Model ID: ${modelId}, Name: ${modelName}, Provider: ${provider.name}, BaseURL: ${baseUrl}, isOllama: ${isOllama}`);
  }

  let answer = '';
  if (isOllamaCloud) {
    const prompt = messages.map((m: any) => {
      if (m.role === 'system') return `System: ${m.content}`;
      if (m.role === 'user') return `User: ${m.content}`;
      return `${m.role}: ${m.content}`;
    }).join('\n\n') + '\n\nAssistant:';
    const reqBody: any = {
      model: modelName,
      prompt,
      stream: false, // Ollama Cloud no soporta streaming
      options: { temperature, num_predict: maxTokens }
    };
    if (typeof topP === 'number') reqBody.options.top_p = topP;
    if (typeof frequencyPenalty === 'number') reqBody.options.repeat_penalty = frequencyPenalty;
    if (typeof presencePenalty === 'number') reqBody.options.presence_penalty = presencePenalty;

    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify(reqBody)
    });
    if (!res.ok) throw new Error(`Ollama Cloud error: ${res.status}`);
    const data = (await res.json()) as any;
    answer = data.response || '';
  } else if (isOllama) {
    const ollamaRes = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelName, messages, stream, options: { temperature, num_predict: maxTokens } })
    });
    if (!ollamaRes.ok) throw new Error(`Ollama error: ${ollamaRes.status}`);

    if (stream) {
      // Handle streaming response
      const reader = ollamaRes.body?.getReader();
      if (!reader) throw new Error('No reader available for streaming');

      const decoder = new TextDecoder();
      let fullContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n').filter(line => line.trim());

        for (const line of lines) {
          try {
            const data = JSON.parse(line);
            if (data.message?.content) {
              fullContent += data.message.content;
            }
          } catch {
            // Skip invalid JSON lines
          }
        }
      }

      answer = fullContent;
    } else {
      // Handle non-streaming response
      const data = (await ollamaRes.json()) as any;
      answer = data.message?.content || '';
    }
  } else {
    const endpoint = baseUrl.endsWith('/chat/completions') ? baseUrl : `${baseUrl}/chat/completions`;
    const openaiRes = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ model: modelName, messages, temperature, max_tokens: maxTokens })
    });
    if (!openaiRes.ok) {
      const errText = await openaiRes.text();
      throw new Error(`Provider error ${openaiRes.status}: ${errText}`);
    }
    const data = (await openaiRes.json()) as any;
    answer = data.choices?.[0]?.message?.content || '';
  }
  return answer;
}

// Chunking utility
function chunkText(text: string, chunkSize: number, chunkOverlap: number): string[] {
  const size = chunkSize > 0 ? chunkSize : 1000;
  const overlap = chunkOverlap >= 0 ? chunkOverlap : 200;
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + size, text.length);
    chunks.push(text.slice(start, end));
    start += size - overlap;
    if (start >= end) break;
  }
  return chunks;
}

// Embedding generation
async function generateEmbedding(text: string, modelId?: string): Promise<number[]> {
  let url = `${OLLAMA_BASE_URL}/api/embed`;
  let modelName = OLLAMA_EMBED_MODEL;
  let apiKey = '';

  if (modelId) {
    try {
      const modelSvc = __zeusCollection(pb, 'models');
      const providerSvc = __zeusCollection(pb, 'providers');
      const model = await modelSvc.getOne(modelId);
      if (model) {
        modelName = model.model || model.modelName || model.name || OLLAMA_EMBED_MODEL;
        const provider = await providerSvc.getOne(model.providerId);
        if (provider) {
          const baseUrl = String(provider.baseUrl || '').replace(/\/$/, '');
          apiKey = provider.apiKey || '';
          
          const isOllama = provider.name === 'Ollama' || baseUrl.includes(':11434');
          if (isOllama) {
            url = `${baseUrl}/api/embed`;
          } else {
            url = `${baseUrl}/embeddings`;
          }
        }
      }
    } catch (e) {
      console.warn(`[Embedding] Error fetching model ${modelId}, using default:`, e);
    }
  }

  console.log(`[Embedding] Llamando a ${url} con modelo ${modelName}`);

  const isOllama = url.includes('/api/embed');
  const body = isOllama 
    ? { model: modelName, input: text }
    : { model: modelName, input: text }; 

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`[Embedding] Error ${res.status}: ${errText}`);
  }

  const data = (await res.json()) as any;
  const embedding = isOllama ? data.embeddings?.[0] : data.data?.[0]?.embedding;
  
  if (!Array.isArray(embedding)) {
    throw new Error(`[Embedding] Respuesta inválida de ${url}. Datos: ${JSON.stringify(data).substring(0, 100)}`);
  }

  console.log(`[Embedding] OK — dimensiones: ${embedding.length}`);
  return embedding;
}

// Cosine similarity
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// Get active pipeline config
app.get('/api/v1/pipeline-configs/active', async (req: Request, res: Response) => {
  try {
    const svc = __zeusCollection(pb, 'pipeline_configs');

    // Intentar con filtro booleano explícito (string para PocketBase)
    let result = await svc.getMany({ filter: 'isActive = true', limit: 1 });
    let configs = result.records || [];

    // Fallback: si no encuentra, listar todas y filtrar localmente
    if (configs.length === 0) {
      console.log('[Pipeline/active] Filtro booleano no devolvió resultados, intentando listar todas...');
      const allResult = await svc.getMany({ limit: 100 });
      const allConfigs = allResult.records || [];
      console.log('[Pipeline/active] Total pipeline configs en BD:', allConfigs.length);
      console.log('[Pipeline/active] Estados isActive:', allConfigs.map((c: any) => ({ id: c.id, name: c.name, isActive: c.isActive })));
      configs = allConfigs.filter((c: any) => c.isActive === true || c.isActive === 1 || c.isActive === 'true');
    }

    if (configs.length === 0) {
      console.log('[Pipeline/active] No hay pipeline activo');
      return res.status(404).json({ error: 'No active pipeline config' });
    }

    console.log('[Pipeline/active] Pipeline activo encontrado:', configs[0].id, configs[0].name);
    res.json(configs[0]);
  } catch (e) {
    console.error('[Pipeline/active] Error:', e);
    res.status(500).json({ error: String(e) });
  }
});

// Create embedding model if not exists
app.post('/api/v1/models/create-embedding-model', async (req: Request, res: Response) => {
  try {
    await authAsAdmin();
    const modelSvc = __zeusCollection(pb, 'models');
    const providerSvc = __zeusCollection(pb, 'providers');

    // 1. Ensure Ollama provider exists
    let provider: any;
    const providersRes = await providerSvc.getMany({ filter: 'name = "Ollama"', limit: 1 });
    if (providersRes.records?.length > 0) {
      provider = providersRes.records[0];
    } else {
      provider = await providerSvc.create({
        name: 'Ollama',
        baseUrl: OLLAMA_BASE_URL,
        apiKey: '',
        isActive: true
      });
    }

    // 2. Ensure embedding model exists
    const modelsRes = await modelSvc.getMany({ filter: `name = "${OLLAMA_EMBED_MODEL}"`, limit: 1 });
    if (modelsRes.records?.length > 0) {
      return res.json(modelsRes.records[0]);
    }

    const newModel = await modelSvc.create({
      name: OLLAMA_EMBED_MODEL,
      providerId: provider.id,
      modelName: OLLAMA_EMBED_MODEL,
      temperature: 0,
      maxTokens: 2048,
      isActive: true,
      isEmbedding: true
    });

    res.status(201).json(newModel);
  } catch (e) {
    console.error('Error in create-embedding-model:', e);
    res.status(500).json({ error: String(e) });
  }
});

// Fix pipeline embedding model reference
app.post('/api/v1/pipeline-configs/fix-embedding-model', async (req: Request, res: Response) => {
  try {
    await authAsAdmin();
    const pipelineSvc = __zeusCollection(pb, 'pipeline_configs');
    const modelSvc = __zeusCollection(pb, 'models');

    const result = await pipelineSvc.getMany({ filter: { isActive: true }, limit: 1 });
    if (result.records?.length === 0) return res.status(404).json({ error: 'No active pipeline' });
    const config = result.records[0];

    const modelsRes = await modelSvc.getMany({ filter: `name = "${OLLAMA_EMBED_MODEL}"`, limit: 1 });
    if (modelsRes.records?.length === 0) return res.status(404).json({ error: 'Embedding model not found' });
    const model = modelsRes.records[0];

    const updated = await pipelineSvc.update(config.id, { embeddingModelId: model.id });
    res.json({ success: true, config: updated });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// Pipeline chat handler function
async function handlePipelineChat(req: Request, res: Response, config: any) {
  const { message, history = [], stream = false, modelConfig, systemContext, hiddenContext } = req.body;
  let isStreamingStarted = false;

  try {
    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      isStreamingStarted = true;
      // Send an initial heartbeat/metadata chunk
      res.write(`data: ${JSON.stringify({ status: 'starting', pipeline: config.name })}\n\n`);
    }

    // Phase 1: Ingesta/Pre-procesamiento
    console.log(`[Pipeline] Phase 1: Ingestion (${config.ingestionModelId || 'skipped'}, active: ${config.ingestionActive !== false})`);
    let phase1Content = message;
    if (config.ingestionModelId && config.ingestionActive !== false) {
      const ingestionPrompt = config.systemPrompt
        ? `${config.systemPrompt}\n\nResume el siguiente texto para facilitar su embedding, manteniendo la información clave:`
        : 'Resume el siguiente texto para facilitar su embedding, manteniendo la información clave:';
      try {
        console.log(`[Pipeline] Calling ingestion model with ID: ${config.ingestionModelId}`);
        phase1Content = await callModelById(config.ingestionModelId, [
          { role: 'system', content: ingestionPrompt },
          { role: 'user', content: message }
        ], undefined, stream);
        if (isStreamingStarted) res.write(`data: ${JSON.stringify({ status: 'ingestion_complete' })}\n\n`);
      } catch (e) {
        console.warn('[Pipeline] Ingestion failed:', e);
        console.warn('[Pipeline] Ingestion model ID:', config.ingestionModelId);
        if (isStreamingStarted) res.write(`data: ${JSON.stringify({ warning: 'Ingestion failed, using raw message' })}\n\n`);
      }
    }

    // Phase 2: Recuperacion (R)
    console.log(`[Pipeline] Phase 2: Retrieval (${config.embeddingModelId || 'skipped'}, active: ${config.retrievalActive !== false})`);
    let retrievedChunks: string[] = [];
    if (config.embeddingModelId && config.retrievalActive !== false) {
      try {
        const questionEmbedding = await generateEmbedding(phase1Content, config.embeddingModelId);
        const chunksSvc = __zeusCollection(pb, 'chunks');
        const allChunks = await chunksSvc.getMany({ limit: 1000 });
        const records = allChunks.records || [];
        const scored = records.map((r: any) => {
          const emb = JSON.parse(r.embedding || '[]');
          const score = cosineSimilarity(questionEmbedding, emb);
          return { content: r.content, score };
        });
        scored.sort((a: any, b: any) => b.score - a.score);
        retrievedChunks = scored.slice(0, config.topK || 5).map((c: any) => c.content);
        if (isStreamingStarted) res.write(`data: ${JSON.stringify({ status: 'retrieval_complete', chunksCount: retrievedChunks.length })}\n\n`);
      } catch (e) {
        console.warn('[Pipeline] Retrieval phase error:', e);
        if (isStreamingStarted) res.write(`data: ${JSON.stringify({ warning: 'Retrieval failed' })}\n\n`);
      }
    }
    const contextText = retrievedChunks.join('\n---\n');

    // Phase 3: Orquestacion (L)
    console.log(`[Pipeline] Phase 3: Orchestration (${config.orchestrationModelId || 'skipped'}, active: ${config.orchestrationActive !== false})`);
    let phase3Content = contextText || phase1Content;
    if (config.orchestrationModelId && config.orchestrationActive !== false) {
      const orchestrationPrompt = config.systemPrompt
        ? `${config.systemPrompt}\n\nDescompón la siguiente pregunta o texto en sub-preguntas claras que faciliten la respuesta:`
        : 'Descompón la siguiente pregunta o texto en sub-preguntas claras que faciliten la respuesta:';
      try {
        console.log(`[Pipeline] Calling orchestration model with ID: ${config.orchestrationModelId}`);
        phase3Content = await callModelById(config.orchestrationModelId, [
          { role: 'system', content: orchestrationPrompt },
          { role: 'user', content: contextText || phase1Content }
        ], undefined, stream);
        if (isStreamingStarted) res.write(`data: ${JSON.stringify({ status: 'orchestration_complete' })}\n\n`);
      } catch (e) {
        console.warn('[Pipeline] Orchestration failed:', e);
        console.warn('[Pipeline] Orchestration model ID:', config.orchestrationModelId);
        if (isStreamingStarted) res.write(`data: ${JSON.stringify({ warning: 'Orchestration failed' })}\n\n`);
      }
    }

    // Phase 4: Generacion Final (L)
    console.log(`[Pipeline] Phase 4: Generation (${config.generationModelId || 'none'}, active: ${config.generationActive !== false})`);
    if (!config.generationModelId || config.generationActive === false) {
      const finalRes = { role: 'assistant', content: phase3Content, pipeline: { configId: config.id, configName: config.name } };
      if (isStreamingStarted) {
        res.write(`data: ${JSON.stringify({ content: phase3Content })}\n\n`);
        res.write(`data: [DONE]\n\n`);
        res.end();
        return;
      }
      return res.json(finalRes);
    }

    // Combinar el systemContext del proyecto/editor con el systemPrompt del pipeline
    let systemInstruction = config.systemPrompt || 'Responde la pregunta del usuario basándote en el contexto proporcionado.';
    
    // Añadir metadatos del pipeline para que el modelo sepa dónde está
    const pipelineMetadata = `--- METADATOS DEL PIPELINE ---
Nombre del Pipeline: ${config.name}
ID: ${config.id}
Fase 1 (Ingesta): ${config.ingestionModelId || 'Desactivada'}
Fase 2 (Recuperación/Embedding): ${config.embeddingModelId || 'Desactivada'}
Fase 3 (Orquestación): ${config.orchestrationModelId || 'Desactivada'}
Fase 4 (Generación): ${config.generationModelId || 'Activa'}
------------------------------`;

    systemInstruction = `${pipelineMetadata}\n\n${systemInstruction}`;

    if (systemContext) {
      systemInstruction = `${systemContext}\n\n---\n\nINSTRUCCIONES DEL PIPELINE:\n${systemInstruction}`;
    }

    // Combinar contexto recuperado (RAG) con hiddenContext del editor/proyecto
    let combinedContext = contextText || '';
    if (hiddenContext) {
      combinedContext = combinedContext
        ? `${combinedContext}\n\n---\n\nCONTEXTO ADICIONAL DEL PROYECTO/EDITOR:\n${hiddenContext}`
        : hiddenContext;
    }

    // Build history messages first so we can estimate their size
    const historyMessages: any[] = Array.isArray(history) ? history : [];

    // Truncate EVERYTHING to fit within LM Studio's default 4096 context
    const MAX_TOTAL_TOKENS = 2500; // Very safe margin for local models
    
    // 1. Truncate System Instruction if it's huge (often contains massive directory structures)
    let finalSystemInstruction = systemInstruction;
    if (estimateTokens(finalSystemInstruction) > 1000) {
      console.log(`[Pipeline] Truncating System Instruction from ${estimateTokens(finalSystemInstruction)} to 1000 tokens`);
      finalSystemInstruction = finalSystemInstruction.substring(0, 4000) + '\n... [Instrucciones de sistema truncadas por tamaño]';
    }

    let systemTokens = estimateTokens(finalSystemInstruction);
    let messageTokens = estimateTokens(message || '');
    
    // 2. Decide how much history to keep
    let finalHistory = historyMessages;
    let historyTokens = finalHistory.reduce((sum: number, m: any) => sum + estimateTokens(m.content || ''), 0);
    
    if (systemTokens + historyTokens + messageTokens > MAX_TOTAL_TOKENS - 500) {
      console.log('[Pipeline] History too large, keeping only last 2 messages');
      finalHistory = historyMessages.slice(-2);
      historyTokens = finalHistory.reduce((sum: number, m: any) => sum + estimateTokens(m.content || ''), 0);
    }

    // 3. Truncate Combined Context (RAG) based on remaining space
    let availableForContext = MAX_TOTAL_TOKENS - systemTokens - historyTokens - messageTokens;
    if (combinedContext && estimateTokens(combinedContext) > availableForContext) {
      console.log(`[Pipeline] Truncating Context from ${estimateTokens(combinedContext)} to ~${availableForContext} tokens`);
      const charLimit = Math.max(0, availableForContext * 4);
      combinedContext = combinedContext.substring(0, charLimit) + '\n... [Contexto truncado por límite de tokens]';
    }

    const userPrompt = combinedContext 
      ? `Contexto recuperado:\n${combinedContext}\n\nPregunta original del usuario: ${message}\n\nResponde detalladamente basándote en el contexto anterior y en tus instrucciones de sistema.`
      : `Pregunta original del usuario: ${message}\n\nResponde basándote en tus instrucciones de sistema y conocimiento general (no se encontró contexto adicional relevante para esta consulta específica).`;

    // Build messages including conversation history so the pipeline remembers context
    const generationMessages = [
      { role: 'system', content: finalSystemInstruction },
      ...(finalHistory.length > 0 ? finalHistory.slice(0, -1) : []),
      { role: 'user', content: userPrompt }
    ];

    if (!stream) {
      const finalAnswer = await callModelById(config.generationModelId, generationMessages, modelConfig, false);
      return res.json({
        role: 'assistant',
        content: finalAnswer,
        pipeline: {
          configId: config.id,
          configName: config.name,
          phase1: config.ingestionModelId ? phase1Content : null,
          phase2: config.embeddingModelId ? { retrievedChunks, contextUsed: !!contextText } : null,
          phase3: config.orchestrationModelId ? phase3Content : null,
          phase4: finalAnswer
        }
      });
    }

    let baseUrl: string;
    let apiKey: string;
    let modelName: string;
    let temperature: number;
    let maxTokens: number;
    let isOllama = false;
    let isOllamaCloud = false;
    let topP: number | undefined;
    let frequencyPenalty: number | undefined;
    let presencePenalty: number | undefined;

    if (modelConfig && modelConfig.provider) {
      baseUrl = String(modelConfig.apiUrl || modelConfig.baseUrl || '').replace(/\/$/, '');
      apiKey = modelConfig.apiKey || '';
      modelName = modelConfig.model || '';
      temperature = typeof modelConfig.temperature === 'number' ? modelConfig.temperature : 0.7;
      maxTokens = typeof modelConfig.maxTokens === 'number' ? modelConfig.maxTokens : 4096;
      topP = typeof modelConfig.topP === 'number' ? modelConfig.topP : undefined;
      frequencyPenalty = typeof modelConfig.frequencyPenalty === 'number' ? modelConfig.frequencyPenalty : undefined;
      presencePenalty = typeof modelConfig.presencePenalty === 'number' ? modelConfig.presencePenalty : undefined;
      isOllamaCloud = modelConfig.provider === 'Ollama Cloud';
      if (!isOllamaCloud) {
        isOllama = modelConfig.provider === 'Ollama' || baseUrl.includes(':11434');
      }
    } else {
      const modelSvc = __zeusCollection(pb, 'models');
      const providerSvc = __zeusCollection(pb, 'providers');
      const model = await modelSvc.getOne(config.generationModelId);
      if (!model) throw new Error('Generation model not found');
      console.log(`[Pipeline] Generation model fields:`, Object.keys(model));
      console.log(`[Pipeline] Generation model data:`, JSON.stringify(model, null, 2));
      const provider = await providerSvc.getOne(model.providerId);
      if (!provider) throw new Error('Provider not found');
      baseUrl = String(provider.baseUrl || '').replace(/\/$/, '');
      apiKey = provider.apiKey || '';
      modelName = model.model || model.modelName || model.name || model.nombre_modelo || '';
      temperature = typeof model.temperature === 'number' ? model.temperature : 0.7;
      maxTokens = typeof model.maxTokens === 'number' ? model.maxTokens : 4096;
      isOllamaCloud = provider.name === 'Ollama Cloud';
      isOllama = provider.name === 'Ollama' || (!isOllamaCloud && baseUrl.includes(':11434'));
    }
    const messages = generationMessages;

    if (isOllamaCloud) {
      const prompt = messages.map((m: any) => {
        if (m.role === 'system') return `System: ${m.content}`;
        if (m.role === 'user') return `User: ${m.content}`;
        return `${m.role}: ${m.content}`;
      }).join('\n\n') + '\n\nAssistant:';
      const reqBody: any = {
        model: modelName,
        prompt,
        stream: true,
        options: { temperature, num_predict: maxTokens }
      };
      if (typeof topP === 'number') reqBody.options.top_p = topP;
      if (typeof frequencyPenalty === 'number') reqBody.options.repeat_penalty = frequencyPenalty;
      if (typeof presencePenalty === 'number') reqBody.options.presence_penalty = presencePenalty;

      const ollamaRes = await fetch(baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify(reqBody)
      });
      if (!ollamaRes.ok || !ollamaRes.body) throw new Error(`Ollama Cloud error: ${ollamaRes.status}`);
      const reader = ollamaRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const chunk = JSON.parse(line);
              if (typeof chunk.response === 'string') {
                res.write(`data: ${JSON.stringify({ content: chunk.response })}\n\n`);
              }
              if (chunk.done) { res.write(`data: [DONE]\n\n`); res.end(); return; }
            } catch { /* ignore */ }
          }
        }
      } finally { reader.releaseLock(); }
      res.write(`data: [DONE]\n\n`); res.end();
    } else if (isOllama) {
      console.log(`[Pipeline] Generation: Calling Ollama with model: ${modelName}, baseUrl: ${baseUrl}`);
      console.log(`[Pipeline] Full URL: ${baseUrl}/api/chat`);
      const startTime = Date.now();
      
      // Primero obtener toda la respuesta sin streaming
      const ollamaRes = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: modelName, messages, stream: false, options: { temperature, num_predict: maxTokens } })
      });
      console.log(`[Pipeline] Ollama response received in ${Date.now() - startTime}ms, status: ${ollamaRes.status}`);
      if (!ollamaRes.ok) {
        const errorText = await ollamaRes.text().catch(() => '');
        console.error(`[Pipeline] Ollama error: ${ollamaRes.status}, response: ${errorText}`);
        throw new Error(`Ollama error: ${ollamaRes.status}`);
      }
      const data = await ollamaRes.json() as { message?: { content?: string } };
      const fullContent = data.message?.content || '';
      console.log(`[Pipeline] Full content length: ${fullContent.length} characters`);
      
      // Simular streaming enviando caracteres a velocidad controlada
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      
      const charsPerChunk = 5; // Enviar 5 caracteres por chunk
      const delayBetweenChunks = 30; // 30ms entre chunks para velocidad controlada
      
      console.log(`[Pipeline] Starting simulated streaming with ${fullContent.length} characters`);
      for (let i = 0; i < fullContent.length; i += charsPerChunk) {
        const chunk = fullContent.substring(i, i + charsPerChunk);
        console.log(`[Pipeline] Sending chunk ${i / charsPerChunk}: "${chunk}"`);
        res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
        await new Promise(resolve => setTimeout(resolve, delayBetweenChunks));
      }
      console.log(`[Pipeline] Finished streaming ${fullContent.length} characters`);
      
      res.write(`data: [DONE]\n\n`);
      res.end();
    } else {
      const endpoint = baseUrl.endsWith('/chat/completions') ? baseUrl : `${baseUrl}/chat/completions`;
      const openaiRes = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({ model: modelName, messages, temperature, max_tokens: maxTokens, stream: true })
      });
      if (!openaiRes.ok || !openaiRes.body) { const errText = await openaiRes.text(); throw new Error(`Provider error ${openaiRes.status}: ${errText}`); }
      const reader = openaiRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed === 'data: [DONE]') { res.write(`data: [DONE]\n\n`); res.end(); return; }
            if (trimmed.startsWith('data: ')) {
              try {
                const chunk = JSON.parse(trimmed.slice(6));
                const content = chunk.choices?.[0]?.delta?.content;
                if (typeof content === 'string') {
                  res.write(`data: ${JSON.stringify({ content })}\n\n`);
                }
              } catch { /* ignore */ }
            }
          }
        }
      } finally { reader.releaseLock(); }
      res.write(`data: [DONE]\n\n`); res.end();
    }
  } catch (e) {
    console.error('[Pipeline] Error:', e);
    if (!isStreamingStarted) {
      res.status(500).json({ error: String(e) });
    } else {
      res.write(`data: ${JSON.stringify({ error: String(e) })}\n\n`);
      res.end();
    }
  }
}

// Pipeline chat endpoint
app.post('/api/v1/chat/pipeline', async (req: Request, res: Response) => {
  const { message, pipelineConfigId } = req.body;
  if (!message) return res.status(400).json({ error: 'message is required' });

  try {
    const pipelineSvc = __zeusCollection(pb, 'pipeline_configs');
    let config: any;
    if (pipelineConfigId) {
      config = await pipelineSvc.getOne(pipelineConfigId);
    } else {
      const result = await pipelineSvc.getMany({ filter: { isActive: true }, limit: 1 });
      const configs = result.records || [];
      if (configs.length === 0) return res.status(404).json({ error: 'No active pipeline config' });
      config = configs[0];
    }
    if (!config) return res.status(404).json({ error: 'Pipeline config not found' });

    return await handlePipelineChat(req, res, config);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// Legacy mock routes (keep for backwards compatibility)
// Zod Schemas
export const ApiColConocimientoSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type ApiColConocimiento = z.infer<typeof ApiColConocimientoSchema>;

// Mock Data Store
let records: any[] = [
  { id: '1', name: 'Sample Record', description: 'This is a sample generated record' }
];

/**
 * @swagger
 * /api/apicol-conocimiento:
 *   get:
 *     summary: Get all ApiCol Conocimiento records
 *     responses:
 *       200:
 *         description: List of records
 */
app.get('/api/apicol-conocimiento', (req: Request, res: Response) => {
  res.json(records);
});

/**
 * @swagger
 * /api/apicol-conocimiento:
 *   post:
 *     summary: Create a new ApiCol Conocimiento record
 *     responses:
 *       201:
 *         description: Created record
 */
app.post('/api/apicol-conocimiento', (req: Request, res: Response) => {
  try {
    const data = ApiColConocimientoSchema.parse(req.body);
    const newRecord = { ...data, id: Date.now().toString() };
    records.push(newRecord);
    res.status(201).json(newRecord);
  } catch (error) {
    res.status(400).json({ error: 'Invalid data' });
  }
});

/**
 * @swagger
 * /api/apicol-conocimiento/{id}:
 *   get:
 *     summary: Get ApiCol Conocimiento record by id
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Record
 *       404:
 *         description: Not found
 */
app.get('/api/apicol-conocimiento/:id', (req: Request, res: Response) => {
  const rec = records.find((r) => r.id === req.params.id);
  if (!rec) return res.status(404).json({ error: 'Not found' });
  res.json(rec);
});

/**
 * @swagger
 * /api/apicol-conocimiento/{id}:
 *   put:
 *     summary: Update ApiCol Conocimiento record
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Updated
 *       404:
 *         description: Not found
 */
app.put('/api/apicol-conocimiento/:id', (req: Request, res: Response) => {
  const i = records.findIndex((r) => r.id === req.params.id);
  if (i === -1) return res.status(404).json({ error: 'Not found' });
  const data = ApiColConocimientoSchema.partial().parse(req.body);
  records[i] = { ...records[i], ...data };
  res.json(records[i]);
});

/**
 * @swagger
 * /api/apicol-conocimiento/{id}:
 *   delete:
 *     summary: Delete ApiCol Conocimiento record
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       204:
 *         description: Deleted
 *       404:
 *         description: Not found
 */
app.delete('/api/apicol-conocimiento/:id', (req: Request, res: Response) => {
  const i = records.findIndex((r) => r.id === req.params.id);
  if (i === -1) return res.status(404).json({ error: 'Not found' });
  records.splice(i, 1);
  res.status(204).send();
});

// Swagger Config
const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'ApiCol Conocimiento API',
      version: '1.0.0',
      description: 'Para organizar el almacenamiento de esta API Se utilizará una base de datos local de Pocket Base. Apicol API es una interfaz de programación de aplicaciones (API) RESTful diseñada para ser el núcleo de un Sistema de Gestión de Conocimiento Aumentado por Recuperación (RAG) y Orquestación de Modelos de Lenguaje de Gran Escala (LLM). Su propósito es abstraer la complejidad de la interacción con múltiples proveedores de IA y la gestión de conocimiento estructurado,…',
    },
    servers: [{ url: 'http://localhost:8743' }],
    paths:
      {
        "/api/apicol-conocimiento": {
          "get": {
            "tags": [
              "ApiCol Conocimiento"
            ],
            "summary": "ApiCol Conocimiento: GET /api/apicol-conocimiento",
            "description": "Operación GET sobre /api/apicol-conocimiento",
            "responses": {
              "200": {
                "description": "OK"
              }
            },
            "parameters": [
              {
                "in": "query",
                "name": "page",
                "required": false,
                "description": "Número de página (empieza en 1)",
                "schema": {
                  "type": "integer",
                  "minimum": 1,
                  "default": 1
                }
              },
              {
                "in": "query",
                "name": "limit",
                "required": false,
                "description": "Cuántos ítems devolver por página",
                "schema": {
                  "type": "integer",
                  "minimum": 1,
                  "maximum": 500,
                  "default": 20
                }
              },
              {
                "in": "query",
                "name": "offset",
                "required": false,
                "description": "Desplazamiento alternativo a page/limit (índice base 0)",
                "schema": {
                  "type": "integer",
                  "minimum": 0,
                  "default": 0
                }
              },
              {
                "in": "query",
                "name": "search",
                "required": false,
                "description": "Texto de búsqueda / filtro libre",
                "schema": {
                  "type": "string"
                }
              },
              {
                "in": "query",
                "name": "sortBy",
                "required": false,
                "description": "Campo por el que ordenar",
                "schema": {
                  "type": "string"
                }
              },
              {
                "in": "query",
                "name": "sortOrder",
                "required": false,
                "description": "asc = ascendente, desc = descendente",
                "schema": {
                  "type": "string",
                  "enum": [
                    "asc",
                    "desc"
                  ]
                }
              }
            ]
          },
          "post": {
            "tags": [
              "ApiCol Conocimiento"
            ],
            "summary": "ApiCol Conocimiento: POST /api/apicol-conocimiento",
            "description": "Operación POST sobre /api/apicol-conocimiento",
            "responses": {
              "200": {
                "description": "OK"
              },
              "201": {
                "description": "Created"
              }
            }
          }
        },
        "/api/apicol-conocimiento/{id}": {
          "get": {
            "tags": [
              "ApiCol Conocimiento"
            ],
            "summary": "ApiCol Conocimiento: GET /api/apicol-conocimiento/{id}",
            "description": "Operación GET sobre /api/apicol-conocimiento/{id}",
            "responses": {
              "200": {
                "description": "OK"
              }
            },
            "parameters": [
              {
                "in": "path",
                "name": "id",
                "required": true,
                "description": "Identificador id",
                "schema": {
                  "type": "string"
                }
              }
            ]
          },
          "put": {
            "tags": [
              "ApiCol Conocimiento"
            ],
            "summary": "ApiCol Conocimiento: PUT /api/apicol-conocimiento/{id}",
            "description": "Operación PUT sobre /api/apicol-conocimiento/{id}",
            "responses": {
              "200": {
                "description": "OK"
              }
            },
            "parameters": [
              {
                "in": "path",
                "name": "id",
                "required": true,
                "description": "Identificador id",
                "schema": {
                  "type": "string"
                }
              }
            ]
          },
          "delete": {
            "tags": [
              "ApiCol Conocimiento"
            ],
            "summary": "ApiCol Conocimiento: DELETE /api/apicol-conocimiento/{id}",
            "description": "Operación DELETE sobre /api/apicol-conocimiento/{id}",
            "responses": {
              "204": {
                "description": "No content"
              }
            },
            "parameters": [
              {
                "in": "path",
                "name": "id",
                "required": true,
                "description": "Identificador id",
                "schema": {
                  "type": "string"
                }
              }
            ]
          }
        }
      }
  },
  apis: ['./runtime-api.ts'],
};

function __zeusApplyDefinitionPathsToSwaggerSpec(spec: any, definition: any): any {
  const defPaths = definition && typeof definition === 'object' ? definition.paths : null;
  if (!defPaths || typeof defPaths !== 'object' || !spec || typeof spec !== 'object') return spec;
  if (!spec.paths || typeof spec.paths !== 'object') spec.paths = {};
  const verbs = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'];
  for (const pathKey of Object.keys(defPaths)) {
    const defItem = (defPaths as Record<string, unknown>)[pathKey];
    if (!defItem || typeof defItem !== 'object') continue;
    const specItem = (spec.paths as Record<string, unknown>)[pathKey];
    if (!specItem || typeof specItem !== 'object') continue;
    for (const verb of verbs) {
      const defOp = (defItem as Record<string, unknown>)[verb];
      const specOp = (specItem as Record<string, unknown>)[verb];
      if (!defOp || typeof defOp !== 'object' || !specOp || typeof specOp !== 'object') continue;
      if (Array.isArray((defOp as { parameters?: unknown }).parameters)) {
        const dp = (defOp as { parameters: unknown[] }).parameters;
        if (dp.length > 0) (specOp as { parameters: unknown[] }).parameters = dp;
      }
      const defRb = (defOp as { requestBody?: unknown }).requestBody;
      if (
        defRb &&
        typeof defRb === 'object' &&
        defRb !== null &&
        typeof (defRb as { content?: unknown }).content === 'object' &&
        (defRb as { content: unknown }).content !== null
      ) {
        (specOp as { requestBody: unknown }).requestBody = defRb;
      }
    }
  }
  return spec;
}

const swaggerSpec = __zeusApplyDefinitionPathsToSwaggerSpec(swaggerJsdoc(swaggerOptions), (swaggerOptions as { definition?: { paths?: unknown } }).definition);

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, { customCss: ".swagger-ui .info .title{font-size:1.5rem!important;line-height:1.3;font-weight:600}.swagger-ui .info .description{font-size:.875rem!important;line-height:1.55!important;max-width:56rem;color:#3b4151;font-weight:400}.swagger-ui .info .description p{margin:.45em 0}.swagger-ui .info .description ul,.swagger-ui .info .description ol{margin:.4em 0 .4em 1.15em}.swagger-ui .info .description h1,.swagger-ui .info .description h2,.swagger-ui .info .description h3,.swagger-ui .info .description h4{font-size:1rem!important;font-weight:600!important;margin:.7em 0 .35em!important;line-height:1.35!important}" }));
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, { customCss: ".swagger-ui .info .title{font-size:1.5rem!important;line-height:1.3;font-weight:600}.swagger-ui .info .description{font-size:.875rem!important;line-height:1.55!important;max-width:56rem;color:#3b4151;font-weight:400}.swagger-ui .info .description p{margin:.45em 0}.swagger-ui .info .description ul,.swagger-ui .info .description ol{margin:.4em 0 .4em 1.15em}.swagger-ui .info .description h1,.swagger-ui .info .description h2,.swagger-ui .info .description h3,.swagger-ui .info .description h4{font-size:1rem!important;font-weight:600!important;margin:.7em 0 .35em!important;line-height:1.35!important}" }));

// Catch-all 404 — devuelve JSON en vez del HTML por defecto de Express
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: 'Endpoint no encontrado', path: req.path, method: req.method });
});

// Global JSON error handler
app.use((err: any, req: Request, res: Response, next: any) => {
  console.error('API unhandled error:', err);
  const status = err.status || err.statusCode || 500;
  res.status(status).json({ error: err.message || 'Internal server error', detail: String(err) });
});

const port = process.env.PORT || 3011;
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
  console.log(`Swagger UI available on http://localhost:${port}/api-docs and http://localhost:${port}/docs`);
});
