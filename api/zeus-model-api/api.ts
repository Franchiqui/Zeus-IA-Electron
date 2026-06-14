import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import {
  callModel,
  handleWebSearchLoop,
  performWebSearch,
  extractCodeChangeFromResponse,
  buildAssistantStructuredContent,
  generatePlanWithModel,
  ChatBody,
  PlanModelConfig,
  ExplorerNode,
} from './model-service';

dotenv.config();

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cors());

// ============================================
// Unified Chat Endpoint
// ============================================

/**
 * @swagger
 * /api/zeus-model-api/chat:
 *   post:
 *     summary: Chat with AI model (OpenAI, Deepseek, Ollama, Ollama Cloud, LM Studio)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               provider: { type: string, enum: ['OpenAI', 'Deepseek', 'Ollama', 'Ollama Cloud', 'LM Studio'] }
 *               model: { type: string }
 *               history: { type: array }
 *               newMessage: { type: object }
 *               systemContext: { type: string }
 *               hiddenContext: { type: string }
 *               webSearch: { type: boolean }
 *               images: { type: array }
 *               apiKey: { type: string }
 *               apiUrl: { type: string }
 *     responses:
 *       200:
 *         description: Model response
 */
app.post('/api/zeus-model-api/chat', async (req: Request, res: Response) => {
  try {
    const body = req.body as ChatBody & { apiKey?: string; apiUrl?: string };

    if (!body.provider || !body.model || !body.newMessage?.content) {
      return res.status(400).json({ error: 'Datos incompletos' });
    }

    let apiKey = body.apiKey;
    let apiUrl = body.apiUrl;

    if (!apiKey) {
      if (body.provider === 'OpenAI') apiKey = process.env.OPENAI_API_KEY;
      else if (body.provider === 'Deepseek') apiKey = process.env.DEEPSEEK_API_KEY;
      else if (body.provider === 'Ollama Cloud') apiKey = process.env.OLLAMA_CLOUD_API_KEY;
      else if (body.provider === 'LM Studio') apiKey = '';
    }

    if (!apiUrl) {
      if (body.provider === 'OpenAI') apiUrl = 'https://api.openai.com/v1/chat/completions';
      else if (body.provider === 'Deepseek') apiUrl = process.env.DEEPSEEK_API_URL ?? 'https://api.deepseek.com/chat/completions';
      else if (body.provider === 'Ollama') apiUrl = 'http://localhost:11434/api/chat';
      else if (body.provider === 'Ollama Cloud') apiUrl = process.env.OLLAMA_CLOUD_URL ?? 'https://ollama.com/api/generate';
      else if (body.provider === 'LM Studio') apiUrl = `${process.env.LM_STUDIO_URL || 'http://localhost:1234'}/v1/chat/completions`;
    }

    // Web search augmentation
    if (body.webSearch && body.newMessage?.content) {
      const searchContext = await performWebSearch(body.newMessage.content);
      if (searchContext) {
        body.hiddenContext = (body.hiddenContext || '') + '\n\n' + searchContext;
      }
    }

    let text = await callModel(body, apiKey, apiUrl);

    // Web search loop
    if (body.webSearch && text) {
      text = await handleWebSearchLoop(body, text, apiKey, apiUrl, body.model);
    }

    const structured = buildAssistantStructuredContent(text);
    const codeChangeObj = extractCodeChangeFromResponse(text);

    return res.status(200).json({
      success: true,
      text,
      codeBubbles: structured.codeBubbles,
      codeChangeDetected: !!codeChangeObj,
      codeChangeExplanation: (codeChangeObj as any)?.explanation || '',
    });
  } catch (error: any) {
    console.error('❌ Error en POST /api/zeus-model-api/chat:', error);
    return res.status(500).json({ error: error.message || 'Error interno del servidor' });
  }
});

// ============================================
// Unified Plan Endpoint
// ============================================

/**
 * @swagger
 * /api/zeus-model-api/plan:
 *   post:
 *     summary: Generate a plan using an AI model
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Plan actions
 */
app.post('/api/zeus-model-api/plan', async (req: Request, res: Response) => {
  try {
    const {
      description,
      explorer,
      structure,
      hints,
      fileSamples,
      model,
      modelId,
      userId,
      autonomy,
      protectedPaths,
      allowedExtensions,
      uiLibrary,
      deliverables,
      activeFile,
      contextFiles,
    } = req.body as {
      description: string;
      explorer?: ExplorerNode[] | Record<string, any>;
      structure?: any;
      hints?: { path?: string; type?: any };
      fileSamples?: Array<{ path: string; contentSample: string }>;
      model?: PlanModelConfig;
      modelId?: string;
      userId?: string;
      autonomy?: 'guided' | 'semi' | 'full';
      protectedPaths?: string[];
      allowedExtensions?: string[];
      uiLibrary?: string;
      deliverables?: 'plan' | 'plan_and_skeletons';
      activeFile?: { path: string; content: string };
      contextFiles?: Array<{ path: string; content: string }>;
    };

    if (!description) {
      return res.status(400).json({ error: 'Debes proporcionar una descripción' });
    }

    const actions = await generatePlanWithModel({
      description,
      explorer,
      structure,
      hints,
      fileSamples,
      model,
      modelId,
      userId,
      autonomy,
      protectedPaths,
      allowedExtensions,
      uiLibrary,
      deliverables,
      activeFile,
      contextFiles,
    });

    return res.status(200).json({ actions });
  } catch (error: any) {
    console.error('❌ Error en POST /api/zeus-model-api/plan:', error);
    return res.status(500).json({ error: error.message || 'Error interno del servidor' });
  }
});

// ============================================
// Health check
// ============================================
app.get('/api/zeus-model-api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

const PORT = process.env.ZEUS_MODEL_API_PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Zeus Model API running on http://localhost:${PORT}`);
  console.log(`📌 Endpoints: POST /api/zeus-model-api/chat, POST /api/zeus-model-api/plan`);
});

export default app;
