// Utilidades para manejar correcciones en archivos

type CorrectionHighlight = {
  filePath: string;
  lineNumber: number;
  startChar?: number;
  endChar?: number;
  oldContent?: string;
  newContent: string;
  description: string;
  timestamp: number;
};

const CORRECTION_HIGHLIGHTS_KEY = 'zeus_correction_highlights';
const EDITOR_HIGHLIGHT_KEY = 'zeus_editor_highlight';

// Guardar correcciones en localStorage
export function saveCorrectionHighlights(highlights: CorrectionHighlight[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(CORRECTION_HIGHLIGHTS_KEY, JSON.stringify(highlights));
  } catch {
    // ignore
  }
}

// Cargar correcciones desde localStorage
export function loadCorrectionHighlights(): CorrectionHighlight[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(CORRECTION_HIGHLIGHTS_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

// Agregar una nueva corrección
export function addCorrectionHighlight(highlight: CorrectionHighlight) {
  const highlights = loadCorrectionHighlights();
  highlights.push(highlight);
  saveCorrectionHighlights(highlights);
  
  // Disparar evento global
  window.dispatchEvent(new CustomEvent('zeus:new-correction', {
    detail: { highlight }
  }));
  
  return highlights;
}

// Eliminar una corrección
export function removeCorrectionHighlight(timestamp: number) {
  const highlights = loadCorrectionHighlights();
  const filtered = highlights.filter(h => h.timestamp !== timestamp);
  saveCorrectionHighlights(filtered);
  return filtered;
}

// Limpiar todas las correcciones
export function clearCorrectionHighlights() {
  saveCorrectionHighlights([]);
}

// Guardar resaltado actual del editor
export function saveEditorHighlight(filePath: string, lineNumber: number) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(EDITOR_HIGHLIGHT_KEY, JSON.stringify({ filePath, lineNumber }));
  } catch {
    // ignore
  }
}

// Cargar resaltado del editor
export function loadEditorHighlight(): { filePath: string; lineNumber: number } | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(EDITOR_HIGHLIGHT_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// Limpiar resaltado del editor
export function clearEditorHighlight() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(EDITOR_HIGHLIGHT_KEY);
}

// Analizar resultados de API para detectar correcciones
export function parseApiResultsForCorrections(apiResults: Array<{ description: string; text: string }>): CorrectionHighlight[] {
  const newHighlights: CorrectionHighlight[] = [];
  
  apiResults.forEach(result => {
    const { description, text } = result;
    
    // Detectar operaciones de corrección en archivos
    if (description.includes('corrigiendo') || description.includes('corrección') || 
        description.includes('fix') || description.includes('arreglando') ||
        description.includes('actualizando') || description.includes('modificando') ||
        description.includes('insertando') || description.includes('eliminando')) {
      
      // Extraer información del archivo y línea
      const fileMatch = description.match(/archivo\s+([^\s]+)/i) || 
                       description.match(/file\s+([^\s]+)/i) ||
                       description.match(/\/([^\/\s]+\.\w+)/) ||
                       description.match(/\b([^\s]+\.\w{2,4})\b/);
      
      const lineMatch = description.match(/línea\s+(\d+)/i) || 
                       description.match(/line\s+(\d+)/i) ||
                       description.match(/lines?\s+(\d+)/i) ||
                       description.match(/\b(\d+)\s*[:)]/);
      
      if (fileMatch) {
        const filePath = fileMatch[1];
        const lineNumber = lineMatch ? parseInt(lineMatch[1]) : 1;
        
        // Extraer contenido nuevo si está disponible en el resultado
        let newContent = '';
        const contentMatch = text.match(/content[\s\S]*?"([^"]+)"/i) ||
                           text.match(/"content"\s*:\s*"([^"]+)"/i);
        
        if (contentMatch) {
          newContent = contentMatch[1];
        } else {
          // Intentar extraer del cuerpo de la solicitud
          const bodyMatch = text.match(/body[\s\S]*?content[\s\S]*?"([^"]+)"/i);
          if (bodyMatch) {
            newContent = bodyMatch[1];
          }
        }
        
        const highlight: CorrectionHighlight = {
          filePath,
          lineNumber,
          newContent: newContent || 'Cambio aplicado',
          description,
          timestamp: Date.now()
        };
        
        newHighlights.push(highlight);
      }
    }
  });
  
  return newHighlights;
}

// Notificar al sistema para abrir el editor con una corrección
export function notifyEditorForCorrection(filePath: string, lineNumber: number, highlights: CorrectionHighlight[]) {
  if (typeof window === 'undefined') return;
  
  window.dispatchEvent(new CustomEvent('zeus:show-correction', {
    detail: { filePath, lineNumber, highlights }
  }));
}

// Notificar para abrir el editor en una línea específica
export function notifyOpenEditorAtLine(filePath: string, lineNumber: number) {
  if (typeof window === 'undefined') return;
  
  window.dispatchEvent(new CustomEvent('zeus:open-editor-at-line', {
    detail: { filePath, lineNumber }
  }));
}

// Notificar para resaltar una línea en el editor
export function notifyHighlightEditorLine(filePath: string, lineNumber: number) {
  if (typeof window === 'undefined') return;
  
  window.dispatchEvent(new CustomEvent('zeus:highlight-editor-line', {
    detail: { filePath, lineNumber }
  }));
}
