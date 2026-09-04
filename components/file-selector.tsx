import React, { useState, useCallback } from 'react';
import { sessionFetch } from '@/lib/projectStore';

// ==================================================================
// Tipado (Ajustar si existen interfaces globales más detalladas)
// ==================================================================

/** 
 * Interfaz para un ítem escaneado (carpeta o archivo)
 */
interface ScannedItem {
  id: string;
  name: string;
  type: 'folder' | 'file';
  path: string;
}

/** 
 * Estructura de error que viene del backend (para manejo específico)
 * @typedef {Object} ScanError
 * @property {string} code - Código de error (ej: FS_ERROR, API_ERROR).
 * @property {string} message - Mensaje descriptivo.
 * @property {string} detail - Detalles adicionales.
 */

interface FileSelectorProps {
  onScanComplete: (scannedItems: ScannedItem[], error: string | null) => void;
}

/**
 * Componente que maneja la selección de directorios y el escaneo de contenido.
 * @param {FileSelectorProps} props - Props del componente.
 */
const FileSelector: React.FC<FileSelectorProps> = ({ onScanComplete }: FileSelectorProps) => {
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [scannedItems, setScannedItems] = useState<ScannedItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  // Estado para almacenar el mensaje de error específico del escaneo, que puede ser no fatal.
  const [scanError, setScanError] = useState<string | null>(null);

  /**
   * Simula la selección de directorios por el usuario.
   * En un entorno real, esta función sería llamada al interactuar con un <input type="file"> 
   * o un selector nativo de archivos.
   * @param {string[]} paths - Arreglo de rutas seleccionadas.
   */
  const handlePathSelection = useCallback((paths: string[]) => {
    setSelectedPaths(paths);
    setScanError(null);
    setScannedItems([]);
  }, []);

  /**
   * Lógica principal para llamar al API de escaneo.
   * Maneja errores específicos para prevenir el fallo de desestructuración.
   */
  const handleScan = useCallback(async () => {
    if (selectedPaths.length === 0) {
      setScanError("Por favor, selecciona al menos una carpeta para escanear.");
      return;
    }

    setIsLoading(true);
    setScanError(null);
    setScannedItems([]);

    try {
      // Asumiendo que el endpoint existe y maneja el escaneo del sistema de archivos.
      const response = await sessionFetch('/api/scan', { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths: selectedPaths }),
      });

      let data: any;
      try {
        data = await response.json();
      } catch (e) {
        // Manejar caso donde el servidor no devuelve JSON válido
        throw new Error("Error de respuesta del servidor: No se pudo parsear el JSON.");
      }

      // 1. Manejo de Error General del Backend (ej. 500 Internal Server Error)
      if (!response.ok) {
        // Si el error es capturado por la capa de API (ej. 400 Bad Request)
        const errorMessage = data?.error?.message || `Fallo al escanear: Estado ${response.status} ${response.statusText}`; 
        setScanError(`Error de escaneo: ${errorMessage}`);
        onScanComplete([], `ERROR_CRITICO: ${errorMessage}`);
        setIsLoading(false);
        return;
      }

      // 2. Manejo de Errores Lógicos de Negocio (El fallo 'Dice carpeta A no tiene API')
      if (data.error && typeof data.error.message === 'string') {
        const errorMessage = data.error.message;
        // Detectar el patrón de error no fatal (e.g., 'no tiene API')
        if (errorMessage.includes("no tiene API") || errorMessage.includes("recursos no disponibles")) {
          // Es un error de aviso, no debe detener el proceso
          setScanError(`Advertencia: ${errorMessage} (Se han procesado los recursos disponibles).`);
        }
      }
    } catch (error) {
      console.error("Error al escanear:", error);
      setScanError("Error al escanear. Por favor, intenta de nuevo.");
      const errorMessage = error instanceof Error ? error.message : String(error);
      onScanComplete([], "ERROR_CRITICO: " + errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, [selectedPaths, onScanComplete]);
  
  return null;
};

export default FileSelector;