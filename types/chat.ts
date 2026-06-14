// File: src/types/chat.ts

/**
 * Tipos para el sistema de chat con LM Studio
 */

export interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

export interface LLMConfig {
    /** URL del servidor LM Studio (default: http://localhost:1234) */
    url?: string;
    /** Nombre del modelo a usar */
    model?: string;
    /** Temperatura para la generación (0-2, default: 0.7) */
    temperature?: number;
    /** Máximo de tokens a generar (default: 4096) */
    maxTokens?: number;
    /** Top P sampling (0-1, default: 0.95) */
    topP?: number;
    /** Número de respuestas a generar (default: 1) */
    n?: number;
    /** Número de hilos para CPU (default: 8) */
    n_threads?: number;
    /** Usar memory mapping (default: true) */
    use_mmap?: boolean;
}

export interface Conversation {
    id: string;
    user: string;
    title: string;
    model_id: string;
    status: 'active' | 'archived' | 'deleted';
    created: string;
    updated: string;
}

export interface Message {
    id: string;
    conversation: string;
    userId: string;
    content: string;
    role: 'user' | 'assistant';
    model_id?: string;
    created: string;
}

export interface LLMResponse {
    response: string;
    modelUsed: string;
    usage: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
}

export interface StreamLLMResponse {
    response: string;
    modelUsed: string;
    usage: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
}

export interface LMStudioStatus {
    available: boolean;
    models: string[];
    error?: string;
}