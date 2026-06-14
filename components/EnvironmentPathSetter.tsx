import React, { useState, useCallback, useEffect } from 'react';
import { useStore } from '@/lib/store';
import { useTranslation } from '@/contexts/translation-context';

// Componente para configurar la variable de entorno DATA_PATH
const EnvironmentPathSetter: React.FC = () => {
  const { t } = useTranslation();
  const [dataPath, setDataPath] = useState('C:\\Zeus-IA-Desktop-2\\api\\data');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const loadCurrentDataPath = async () => {
      try {
        const response = await fetch('/api/config/data-path');
        if (response.ok) {
          const result = await response.json();
          if (result?.dataPath) {
            setDataPath(String(result.dataPath));
            localStorage.setItem('ZEUS_DATA_PATH', String(result.dataPath));
            return;
          }
        }
      } catch {
        // fallback abajo
      }

      const cached = localStorage.getItem('ZEUS_DATA_PATH');
      if (cached) {
        setDataPath(cached);
      }
    };

    loadCurrentDataPath();
  }, []);

  const handleSavePath = useCallback(async (pathToSave?: string) => {
    const targetPath = pathToSave ?? dataPath;
    if (!targetPath || targetPath.trim() === '') {
      alert(t('envPathEmptyError'));
      return;
    }
    setIsSaving(true);
    try {
      // Guardar en localStorage como respaldo
      localStorage.setItem('ZEUS_DATA_PATH', targetPath);

      // Hacer llamada API real para actualizar la variable de entorno
      console.log('Enviando DATA_PATH al servidor:', targetPath);

      const response = await fetch('/api/config/data-path', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ dataPath: targetPath })
      });

      console.log('Respuesta del servidor:', response.status, response.statusText);

      if (response.ok) {
        const result = await response.json();
        console.log('DATA_PATH guardado exitosamente:', result);
        if (result?.dataPath) {
          setDataPath(String(result.dataPath));
          localStorage.setItem('ZEUS_DATA_PATH', String(result.dataPath));
        }

        // Refrescar exploradores y planes
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('resetExplorerPath'));
          window.dispatchEvent(new CustomEvent('clearEditorFiles'));
        }
        setTimeout(() => {
          const store = useStore.getState();
          store.refreshExplorer();
          store.refreshPlans();
        }, 150);

        alert(t('envPathUpdated'));
        // NOTE: Se eliminó el reload de página para preservar las pestañas abiertas.
        // Cada pestaña mantiene su propio projectRoot; al cambiar de pestaña se refresca automáticamente.
      } else {
        const errorText = await response.text();
        console.error('Error del servidor:', response.status, errorText);
        throw new Error(`Error ${response.status}: ${errorText || 'Error al guardar DATA_PATH en el servidor'}`);
      }
    } catch (error) {
      console.error('Error completo al guardar DATA_PATH:', error);
      const errorMessage = error instanceof Error ? error.message : t('toastUnknownError');
      alert(t('envPathSaveError').replace('{error}', errorMessage));
    } finally {
      setIsSaving(false);
    }
  }, [dataPath]);

  const handleSelectFolder = useCallback(async () => {
    if (typeof window === 'undefined') return;
    const electronAPI = (window as any).electronAPI;
    if (!electronAPI?.selectFolder) {
      alert(t('envPathFolderPickerUnavailable'));
      return;
    }

    try {
      const result = await electronAPI.selectFolder();
      if (result?.canceled || !result?.filePath) {
        return;
      }
      const selectedPath = result.filePath;
      setDataPath(selectedPath);
      // Guardar automáticamente la ruta seleccionada
      await handleSavePath(selectedPath);
    } catch (error) {
      console.error('Error al seleccionar carpeta:', error);
      alert(t('envPathFolderPickerError'));
    }
  }, [handleSavePath]);

  return (
    <div className="data-path-setter">
      <label htmlFor="data-path-input" className="data-path-label">{t('envPathLabel')}</label>
      <div className="data-path-input-wrapper">
        <input
          id="data-path-input"
          type="text"
          value={dataPath}
          onChange={(e) => setDataPath(e.target.value)}
          className="data-path-input"
          placeholder={t('envPathPlaceholder')}
        />
        <button
          onClick={handleSelectFolder}
          disabled={isSaving}
          className="data-path-button"
          title={t('envPathSelectFolder')}
        >
          {isSaving ? '...' : t('envPathButton')}
        </button>
      </div>
    </div>
  );
};

export default EnvironmentPathSetter;