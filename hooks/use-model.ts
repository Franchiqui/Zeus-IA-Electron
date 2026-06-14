'use client';

export function useModel(): { selectedModel: any } {
    // Retornar un objeto con selectedModel desde localStorage si existe
    if (typeof window !== 'undefined') {
        try {
            const modelConfig = localStorage.getItem('modelConfig');
            if (modelConfig) {
                return { selectedModel: JSON.parse(modelConfig) };
            }
        } catch (error) {
            console.error('[useModel] Error reading modelConfig from localStorage:', error);
        }
    }
    return { selectedModel: null };
}
