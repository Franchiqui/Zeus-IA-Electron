import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Limpia el texto de marcas Markdown comunes para que el TTS (Text-to-Speech)
 * lo lea de forma natural sin pronunciar símbolos.
 */
export function cleanTextForTTS(text: string): string {
  if (!text) return '';
  
  return text
    // Eliminar bloques de código
    .replace(/```[\s\S]*?```/g, ' bloque de código ')
    // Eliminar comentarios técnicos y barras
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\//g, '')
    .replace(/\/\*/g, '')
    .replace(/\*\//g, '')
    // Eliminar negritas y cursivas
    .replace(/\*\*/g, '')
    .replace(/\*/g, '')
    .replace(/__/g, '')
    .replace(/_/g, '')
    // Eliminar emoticonos de texto comunes
    .replace(/[:;]-?[)D(|P]/g, '')
    .replace(/>:\(/g, '')
    // Eliminar encabezados
    .replace(/#{1,6}\s/g, '')
    // Eliminar enlaces [texto](url) -> texto
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Eliminar imágenes ![alt](url) -> imagen
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, ' imagen ')
    // Eliminar bloques ZEUS_API_CALL y ZEUS_ACTION y marcadores de estado
    .replace(/\[ZEUS_API_CALL\][\s\S]*?\[\/ZEUS_API_CALL\]/g, ' ejecutando comando ')
    .replace(/\[ZEUS_ACTION\][\s\S]*?\[\/ZEUS_ACTION\]/g, ' ejecutando acción ')
    .replace(/\[FIN\]/gi, '')
    .replace(/\[CONTINUAR\]/gi, '')
    // Normalizar espacios y saltos de línea
    .replace(/\n+/g, ' ')
    .trim();
}

/**
 * Convierte una cadena de texto en un slug URL-friendly.
 * Reemplaza espacios y caracteres especiales con guiones.
 */
export function slugify(text: string): string {
  if (!text) return '';
  
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')           // Reemplazar espacios con guiones
    .replace(/[^\w\-]+/g, '')       // Eliminar caracteres no alfanuméricos excepto guiones
    .replace(/\-\-+/g, '-');        // Reemplazar múltiples guiones con uno solo
}
