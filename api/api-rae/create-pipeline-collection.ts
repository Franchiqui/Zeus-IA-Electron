import PocketBase from 'pocketbase';
import dotenv from 'dotenv';

dotenv.config({ path: './.env' });
dotenv.config({ path: './API/.env' });

const pbUrl = process.env.PB_URL || process.env.NEXT_PUBLIC_PB_URL || 'http://127.0.0.1:8091';
const pb = new PocketBase(pbUrl);

async function createPipelineCollection() {
  try {
    // Authenticate as admin
    const email = process.env.PB_ADMIN_EMAIL || 'zeus@ia.com';
    const password = process.env.PB_ADMIN_PASSWORD || '1234567890';
    
    await pb.collection('_superusers').authWithPassword(email, password);
    console.log('[PocketBase] Admin autenticado');

    // Create the pipeline_configs collection
    const collection = await pb.collections.create({
      name: 'pipeline_configs',
      type: 'base',
      schema: [
        {
          name: 'name',
          type: 'text',
          required: true,
        },
        {
          name: 'ingestionModelId',
          type: 'text',
          required: false,
        },
        {
          name: 'retrievalModelId',
          type: 'text',
          required: false,
        },
        {
          name: 'orchestrationModelId',
          type: 'text',
          required: false,
        },
        {
          name: 'generationModelId',
          type: 'text',
          required: false,
        },
        {
          name: 'isActive',
          type: 'bool',
          required: false,
        },
        {
          name: 'systemPrompt',
          type: 'text',
          required: false,
        },
        {
          name: 'chunkSize',
          type: 'number',
          required: false,
        },
        {
          name: 'chunkOverlap',
          type: 'number',
          required: false,
        },
        {
          name: 'embeddingModelId',
          type: 'text',
          required: false,
        },
      ],
    });

    console.log('[PocketBase] Colección pipeline_configs creada exitosamente:', collection);
  } catch (error) {
    console.error('[PocketBase] Error creando colección:', error);
    process.exit(1);
  }
}

createPipelineCollection();
