'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '../ui/resizable';
import { TopToolbar } from './top-toolbar';
import { ComponentExplorer } from './component-explorer';
import { FileUrlEditor } from './file-url-editor';
import { FileIconEditor } from './file-icon-editor';
import { PreviewPanel } from './preview-panel';
import { PropertyEditor } from './property-editor';
import { TextEditor } from './text-editor';
import { Toaster } from '../../hooks/use-toaster';
import { toast } from 'sonner';
import { useTranslation } from '../../contexts/translation-context';
import { useChatContext } from '@/components/ChatContext';
import { useEditor } from '@/context/editor-context';
import { useAuth } from '@/context/AuthContext';
import { getPocketBase } from '../../lib/pocketbase';
import { generateZeusIconScript } from '../../lib/zeus-icon-script-template';
import { iconPaths } from '../../lib/zeus-icon-paths';
import JSZip from 'jszip';

// Declaración para extender el objeto Window
declare global {
  interface Window {
    zeusTextUpdates?: Record<string, string>;
    zeusTextForCSS?: Record<string, string>;
  }
}

interface ComponentNode {
  id: string;
  name: string;
  type: 'container' | 'button' | 'text' | 'image' | 'input' | 'custom';
  children?: ComponentNode[];
  properties?: Record<string, any>;
}

// Empty initial state - no demo components
const emptyComponents: ComponentNode[] = [];

export default function zeusStudio() {
    const { t } = useTranslation();
    const { setMessages } = useChatContext();
    const { askZeus } = useEditor();
    const { user, isLoading: authLoading } = useAuth();
    const [selectedComponentId, setSelectedComponentId] = useState<string | null>(null);
    // Usar un ref para mantener el selectedComponentId más reciente y evitar problemas de timing
    const selectedComponentIdRef = useRef<string | null>(null);
    // Ref para capturar el ID del componente que está siendo editado en PropertyEditor
    const editingComponentIdRef = useRef<string | null>(null);
    // 🔥 NUEVO: Almacenar información del background del componente seleccionado desde el iframe
    const [selectedComponentBackground, setSelectedComponentBackground] = useState<any>(null);
    const [viewMode, setViewMode] = useState<'desktop' | 'tablet' | 'mobile'>('desktop');
    const [textEditorOpen, setTextEditorOpen] = useState(false);
    const [selectedText, setSelectedText] = useState('Welcome to zeus Studio');
    const [components, setComponents] = useState<ComponentNode[]>(emptyComponents);
    const [projectName, setProjectName] = useState<string>('');
    const [isProjectLoaded, setIsProjectLoaded] = useState(false);
    const [projectPath, setProjectPath] = useState<string>('');
    const [devServerUrl, setDevServerUrl] = useState<string>('http://localhost:3000');
    const [isTunnelConnected, setIsTunnelConnected] = useState<boolean>(false);
    const [isConnectingTunnel, setIsConnectingTunnel] = useState<boolean>(false);
    const [currentPort, setCurrentPort] = useState<string>('3000');
    const [editablePort, setEditablePort] = useState<string>('3000');
    const [useLocalhost, setUseLocalhost] = useState<boolean>(true); // Flag para forzar localhost cuando el usuario cambia el puerto
    const userChangedPortRef = useRef<boolean>(false); // Ref para rastrear si el usuario cambió el puerto manualmente

    // Estado para forzar re-montaje del PreviewPanel cuando se carga un proyecto
    const [previewPanelKey, setPreviewPanelKey] = useState(0);

    // Estado para pantalla completa del preview
    const [isPreviewMaximised, setIsPreviewMaximised] = useState(false);

    // Estado para pestaña del panel izquierdo (URLs vs Iconos)
    const [leftPanelTab, setLeftPanelTab] = useState<'urls' | 'icons'>('urls');

    // Log para debuggear cambios de tab
    useEffect(() => {
        console.log('[main-studio] leftPanelTab changed to:', leftPanelTab);
    }, [leftPanelTab]);

    // Función para toggle de pantalla completa
    const handlePreviewMaximiseToggle = useCallback(() => {
        console.log('[main-studio] 🎯 onMaximiseToggle llamado, estado actual:', isPreviewMaximised);
        setIsPreviewMaximised(prev => {
            const newValue = !prev;
            console.log('[main-studio] 🔄 setIsPreviewMaximised ejecutado, nuevo valor:', newValue);
            return newValue;
        });
    }, [isPreviewMaximised]);
    
    // NOTE: Ahora todos los proyectos son locales y el proyecto raíz se guarda por pestaña.
    const getCurrentProjectId = () => null;
    const getProjectSource = (): 'local' => 'local';
    
    // Función para cambiar el puerto y conectarse
    const handlePortChange = (newPort: string) => {
        const port = newPort.trim() || '3000';
        console.log('[handlePortChange] 🚀 Iniciando cambio de puerto a:', port);
        
        // Verificar si estamos en producción (HTTPS)
        const isProduction = typeof window !== 'undefined' && window.location.protocol === 'https:';
        
        // Verificar si hay un túnel disponible
        const tunnelUrl = localStorage.getItem('preview_server_tunnel_url');
        const hasTunnel = tunnelUrl && tunnelUrl !== 'http://localhost:3030' && !tunnelUrl.includes('localhost');
        
        // Si estamos en producción, usar el túnel pero apuntar al puerto correcto
        if (isProduction) {
            if (hasTunnel) {
                // El túnel base apunta al servidor de vista previa (puerto 3030)
                // Pero necesitamos apuntar al puerto 3000 donde corre la aplicación
                // Si el túnel ya incluye /proxy/3000, usarlo directamente
                // Si no, agregar /proxy/{port} para apuntar al puerto específico
                let tunnelUrlForPort = tunnelUrl;
                
                // Si el túnel no incluye /proxy/, agregar /proxy/{port}
                if (!tunnelUrl.includes('/proxy/')) {
                    tunnelUrlForPort = `${tunnelUrl}/proxy/${port}`;
                } else {
                    // Si ya incluye /proxy/, reemplazar el puerto en la ruta
                    tunnelUrlForPort = tunnelUrl.replace(/\/proxy\/\d+/, `/proxy/${port}`);
                }
                
                console.log('[handlePortChange] 🔗 En producción, usando túnel para puerto:', port);
                console.log('[handlePortChange] 🔗 URL del túnel base:', tunnelUrl);
                console.log('[handlePortChange] 🔗 URL del túnel para puerto:', tunnelUrlForPort);
                userChangedPortRef.current = true; // Marcar que el usuario cambió el puerto manualmente
                setUseLocalhost(false);
                console.log('[handlePortChange] 🔄 Estableciendo devServerUrl a:', tunnelUrlForPort);
                setDevServerUrl(tunnelUrlForPort);
                setIsTunnelConnected(true);
                setCurrentPort(port);
                setEditablePort(port);
                
                // Verificar que el estado se actualizó correctamente después de un breve delay
                setTimeout(() => {
                    console.log('[handlePortChange] 🔍 Verificación después de actualizar estados (producción)');
                    console.log('[handlePortChange] 🔍 devServerUrl debería ser:', tunnelUrlForPort);
                }, 100);
                
                // Resetear el flag después de un breve delay
                setTimeout(() => {
                    userChangedPortRef.current = false;
                    console.log('[handlePortChange] 🔄 userChangedPortRef reseteado a false (producción)');
                }, 1000);
                
                toast.success(`Conectado al puerto ${port} a través del túnel`);
                return;
            } else {
                toast.error('No se puede usar localhost en producción. Conecta el túnel primero.');
                return;
            }
        }
        
        // Si estamos en desarrollo:
        // - El iframe mostrará localhost:3000 (para ver la aplicación local)
        // - Pero el túnel permanecerá conectado (para sincronización con Zeus)
        const newUrl = `http://localhost:${port}`;
        console.log('[handlePortChange] 🔗 Cambiando a localhost con puerto:', port);
        console.log('[handlePortChange] 🔗 Nueva URL para iframe:', newUrl);
        console.log('[handlePortChange] 🔗 Manteniendo túnel conectado para sincronización');
        
        // Actualizar estados en el orden correcto
        setCurrentPort(port);
        setEditablePort(port);
        setUseLocalhost(true); // Marcar que el usuario quiere usar localhost en el iframe
        setDevServerUrl(newUrl); // El iframe mostrará localhost - ESTO ES LO MÁS IMPORTANTE
        
        // Mantener el túnel conectado si está disponible (para sincronización con Zeus)
        if (hasTunnel) {
            setIsTunnelConnected(true); // Túnel conectado para sincronización
            console.log('[handlePortChange] ✅ Túnel conectado para sincronización:', tunnelUrl);
        } else {
            setIsTunnelConnected(false);
        }
        
        console.log('[handlePortChange] ✅ Estados actualizados:', {
            currentPort: port,
            devServerUrl: newUrl,
            useLocalhost: true,
            isTunnelConnected: hasTunnel
        });
        
        toast.success(`Conectado al puerto ${port}${hasTunnel ? ' (túnel conectado para sincronización)' : ''}`);
    };
    
    // Función para conectar directamente a localhost (sin túnel)
    const handleDirectPortChange = (port: string) => {
        const finalPort = port.trim() || '3000';
        console.log('[handleDirectPortChange] 🚀 Conectando directamente a localhost:', finalPort);
        
        // Forzar siempre localhost, sin importar si estamos en producción o si hay túnel
        const localhostUrl = `http://localhost:${finalPort}`;
        
        // Desconectar temporalmente el túnel para evitar interferencias
        setIsTunnelConnected(false);
        userChangedPortRef.current = true; // Marcar que el usuario cambió el puerto manualmente
        
        // Actualizar estados
        setCurrentPort(finalPort);
        setEditablePort(finalPort);
        setUseLocalhost(true); // Forzar uso de localhost
        setDevServerUrl(localhostUrl);
        
        console.log('[handleDirectPortChange] ✅ Túnel desconectado temporalmente');
        console.log('[handleDirectPortChange] ✅ Conectado directamente a localhost:', {
            port: finalPort,
            url: localhostUrl,
            useLocalhost: true,
            tunnelDisconnected: true
        });
        
        toast.success(`Conectado directamente a localhost:${finalPort} (túnel desconectado)`);
        
        // Resetear el flag después de un tiempo para no interferir con futuras operaciones
        setTimeout(() => {
            userChangedPortRef.current = false;
        }, 1000);
    };
    
    // Sincronizar el puerto con la URL actual cuando cambia devServerUrl
    useEffect(() => {
        try {
            const url = new URL(devServerUrl);
            if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
                const port = url.port || '3000';
                if (port !== currentPort) {
                    setCurrentPort(port);
                    setEditablePort(port);
                }
            }
        } catch (e) {
            // Si no se puede parsear, mantener el puerto actual
        }
    }, [devServerUrl, currentPort]);
    
    // Función para conectar manualmente al túnel
    const connectTunnelManually = async () => {
        console.log('[connectTunnelManually] 🚀 Iniciando conexión manual al túnel...');
        setIsConnectingTunnel(true);
        
        try {
            // Si estamos en localhost, no intentar conectar
            if (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
                console.log('[connectTunnelManually] ⚠️ En localhost, no se puede conectar al túnel');
                toast.warning('No se puede conectar al túnel en localhost');
                setIsConnectingTunnel(false);
                return;
            }
            
            // Si no hay usuario autenticado, no intentar obtener el túnel
            if (!user?.token) {
                console.log('[connectTunnelManually] ⚠️ No hay usuario autenticado para conectar al túnel');
                console.log('[connectTunnelManually] ⚠️ user:', user, 'token:', user?.token);
                toast.error('Debes estar autenticado para conectar al túnel');
                setIsConnectingTunnel(false);
                return;
            }
            
            console.log('[connectTunnelManually] ✅ Usuario autenticado, token disponible');
            console.log('[connectTunnelManually] 🔄 Conectando manualmente al túnel...');
            
            // SIEMPRE intentar obtener la URL más reciente desde la API primero
            // Esto asegura que usemos la URL del túnel actual, no una antigua en localStorage
            const apiEndpoint = '/api/tunnel-url';
            console.log('[connectTunnelManually] 🔍 Obteniendo URL del túnel desde la API...');
            console.log('[connectTunnelManually] 🔍 Token (primeros 20 caracteres):', user.token.substring(0, 20) + '...');
            
            const response = await fetch(apiEndpoint, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${user.token}`,
                    'Content-Type': 'application/json'
                }
            });
            
            console.log('[connectTunnelManually] 🔍 Respuesta recibida:', {
                status: response.status,
                ok: response.ok,
                statusText: response.statusText
            });
            
            if (response.ok) {
                const data = await response.json();
                console.log('[connectTunnelManually] 🔍 Datos de la API:', data);
                
                if (data.ok && data.tunnelUrl) {
                    const tunnelUrl = data.tunnelUrl;
                    // Construir la URL del túnel con el puerto actual para mostrar la aplicación
                    // El servidor de vista previa está en el túnel base, pero la aplicación está en /proxy/3000
                    const tunnelUrlForPort = tunnelUrl.includes('/proxy/') 
                        ? tunnelUrl.replace(/\/proxy\/\d+/, `/proxy/${currentPort || '3000'}`)
                        : `${tunnelUrl}/proxy/${currentPort || '3000'}`;
                    
                    console.log('[connectTunnelManually] ✅ URL del túnel obtenida de la API:', tunnelUrl);
                    console.log('[connectTunnelManually] 🔗 URL del túnel para puerto:', tunnelUrlForPort);
                    localStorage.setItem('preview_server_tunnel_url', tunnelUrl);
                    setUseLocalhost(false); // Desactivar localhost cuando se conecta el túnel
                    setDevServerUrl(tunnelUrlForPort); // Usar la URL con /proxy/3000 para mostrar la aplicación
                    setIsTunnelConnected(true);
                    toast.success(`Túnel conectado al puerto ${currentPort || '3000'}`);
                } else {
                    console.log('[connectTunnelManually] ⚠️ API respondió pero sin tunnelUrl válido:', data);
                    setIsTunnelConnected(false);
                    toast.error('No se pudo obtener la URL del túnel desde el servidor');
                }
            } else {
                const errorText = await response.text();
                console.warn('[connectTunnelManually] ⚠️ Error en respuesta de API:', {
                    status: response.status,
                    statusText: response.statusText,
                    error: errorText
                });
                setIsTunnelConnected(false);
                toast.error(`Error al conectar: ${response.status} ${response.statusText}`);
            }
        } catch (error: any) {
            console.error('[connectTunnelManually] ❌ Error al conectar al túnel:', error);
            console.error('[connectTunnelManually] ❌ Stack:', error.stack);
            setIsTunnelConnected(false);
            toast.error(`Error al conectar al túnel: ${error.message || 'Error desconocido'}`);
        } finally {
            setIsConnectingTunnel(false);
            console.log('[connectTunnelManually] ✅ Proceso de conexión finalizado');
        }
    };
    
    // Obtener la URL del túnel del servidor de vista previa y conectarse directamente
    useEffect(() => {
        // No hacer nada si la autenticación aún está cargando
        if (authLoading) {
            console.log('[main-studio] ⏳ Esperando a que la autenticación termine...');
            return;
        }
        
        // Verificar si estamos en producción (HTTPS)
        const isProduction = typeof window !== 'undefined' && window.location.protocol === 'https:';
        
        // Si estamos en producción, NO podemos usar localhost (Mixed Content)
        // Intentar usar el túnel si está disponible
        if (isProduction) {
            // Si el usuario acaba de cambiar el puerto, NO sobrescribir el devServerUrl
            if (userChangedPortRef.current) {
                console.log('[main-studio] ⚠️ Usuario acaba de cambiar el puerto en producción, no sobrescribir devServerUrl');
                const tunnelUrl = localStorage.getItem('preview_server_tunnel_url');
                if (tunnelUrl && tunnelUrl !== 'http://localhost:3030' && !tunnelUrl.includes('localhost')) {
                    setIsTunnelConnected(true);
                }
                return;
            }
            
            console.log('[main-studio] 🔒 En producción (HTTPS), no se puede usar localhost');
            let tunnelUrl = localStorage.getItem('preview_server_tunnel_url');
            
            // Intentar obtener la URL actual desde la API si el usuario está autenticado
            // Esto se hace de forma asíncrona para no bloquear el render
            if (user?.token && !authLoading && tunnelUrl) {
                console.log('[main-studio] 🔄 Intentando obtener URL actual del túnel desde la API...');
                // Hacer la petición de forma asíncrona sin bloquear
                fetch('/api/tunnel-url', {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${user.token}`,
                        'Content-Type': 'application/json'
                    }
                })
                .then(apiResponse => {
                    if (apiResponse.ok) {
                        return apiResponse.json();
                    }
                    return null;
                })
                .then(apiData => {
                    if (apiData?.tunnelUrl && apiData.tunnelUrl !== tunnelUrl) {
                        console.log('[main-studio] 🔄 URL del túnel actualizada desde la API:', apiData.tunnelUrl);
                        localStorage.setItem('preview_server_tunnel_url', apiData.tunnelUrl);
                        // Actualizar el estado con la nueva URL
                        const tunnelUrlForPort = apiData.tunnelUrl.includes('/proxy/') 
                            ? apiData.tunnelUrl.replace(/\/proxy\/\d+/, `/proxy/${currentPort || '3000'}`)
                            : `${apiData.tunnelUrl}/proxy/${currentPort || '3000'}`;
                        setDevServerUrl(tunnelUrlForPort);
                        setIsTunnelConnected(true);
                    }
                })
                .catch(apiError => {
                    console.warn('[main-studio] ⚠️ No se pudo obtener URL del túnel desde la API:', apiError);
                    // Continuar con la URL de localStorage
                });
            }
            
            if (tunnelUrl && tunnelUrl !== 'http://localhost:3030' && !tunnelUrl.includes('localhost')) {
                // Construir la URL del túnel con el puerto actual
                const tunnelUrlForPort = tunnelUrl.includes('/proxy/') 
                    ? tunnelUrl.replace(/\/proxy\/\d+/, `/proxy/${currentPort || '3000'}`)
                    : `${tunnelUrl}/proxy/${currentPort || '3000'}`;
                
                console.log('[main-studio] 🔗 Usando túnel en producción:', tunnelUrlForPort);
                setUseLocalhost(false);
                setDevServerUrl(tunnelUrlForPort);
                setIsTunnelConnected(true);
                return;
            } else {
                console.log('[main-studio] ⚠️ No hay túnel disponible en producción');
                // En producción sin túnel, mostrar mensaje pero no usar localhost (causará Mixed Content)
                setDevServerUrl('http://localhost:3000'); // Se mostrará error de Mixed Content
                setCurrentPort('3000');
                setEditablePort('3000');
                setIsTunnelConnected(false);
                toast.warning('⚠️ Conecta el túnel para usar la vista previa en producción', {
                    description: 'No se puede usar localhost desde HTTPS. Usa el botón de conectar túnel.',
                    duration: 10000,
                });
                return;
            }
        }
        
        // Verificar si hay túnel disponible
        const tunnelUrl = localStorage.getItem('preview_server_tunnel_url');
        const hasTunnel = tunnelUrl && tunnelUrl !== 'http://localhost:3030' && !tunnelUrl.includes('localhost');
        
        // Si el usuario quiere usar localhost en el iframe (useLocalhost = true)
        // Pero mantener el túnel conectado para sincronización si está disponible
        if (useLocalhost) {
            const localhostUrl = `http://localhost:${currentPort || '3000'}`;
            console.log('[main-studio] 🔗 Usuario configuró localhost para iframe');
            console.log('[main-studio] 🔍 currentPort:', currentPort);
            console.log('[main-studio] 🔍 localhostUrl calculada:', localhostUrl);
            console.log('[main-studio] 🔍 devServerUrl actual:', devServerUrl);
            console.log('[main-studio] 🔍 userChangedPortRef.current:', userChangedPortRef.current);
            
            // Si el usuario acaba de cambiar el puerto, NO sobrescribir el devServerUrl
            // porque handlePortChange ya lo estableció correctamente
            if (userChangedPortRef.current) {
                console.log('[main-studio] ⚠️ Usuario acaba de cambiar el puerto, no sobrescribir devServerUrl');
                // Mantener el túnel conectado si está disponible (para sincronización)
                if (hasTunnel) {
                    setIsTunnelConnected(true);
                    console.log('[main-studio] ✅ Túnel conectado para sincronización:', tunnelUrl);
                } else {
                    setIsTunnelConnected(false);
                }
                return;
            }
            
            // Si el usuario no acaba de cambiar el puerto, actualizar normalmente
            // Solo actualizar si la URL es diferente para evitar loops infinitos
            if (devServerUrl !== localhostUrl) {
                console.log('[main-studio] 🔄 Estableciendo devServerUrl a:', localhostUrl);
                setDevServerUrl(localhostUrl); // El iframe mostrará localhost
            }
            
            // Mantener el túnel conectado si está disponible (para sincronización)
            if (hasTunnel) {
                setIsTunnelConnected(true);
                console.log('[main-studio] ✅ Túnel conectado para sincronización:', tunnelUrl);
            } else {
                setIsTunnelConnected(false);
            }
            return;
        }
        
        // Si no hay preferencia de localhost y hay túnel disponible, usar el túnel en el iframe
        if (hasTunnel && isTunnelConnected) {
            console.log('[main-studio] 🔗 Usando túnel en iframe:', tunnelUrl);
            setDevServerUrl(tunnelUrl);
            setIsTunnelConnected(true);
            return;
        }
        
        // POR DEFECTO: Usar localhost:3000 siempre, a menos que el usuario explícitamente conecte el túnel
        // Solo usar el túnel si el usuario hace clic en el botón de conectar túnel
        console.log('[main-studio] 🔗 Usando localhost por defecto (no usar túnel automáticamente)');
        const defaultUrl = `http://localhost:${currentPort || '3000'}`;
        if (devServerUrl !== defaultUrl) {
            setDevServerUrl(defaultUrl);
        }
        // No sobrescribir currentPort si ya está configurado
        if (!currentPort || currentPort === '3000') {
            setCurrentPort('3000');
            setEditablePort('3000');
        }
        setIsTunnelConnected(false);
        
        // NO intentar obtener el túnel automáticamente
        // El túnel solo se usará si el usuario hace clic en el botón de conectar túnel
        // Esto evita que el túnel sobrescriba localhost cuando el usuario quiere usar localhost
    }, [authLoading, useLocalhost, currentPort]);
    const [isSaving, setIsSaving] = useState(false);
    const [componentProperties, setComponentProperties] = useState<Record<string, any>>({});
    const [generatedCss, setGeneratedCss] = useState<string>('');
    const [projectDirectoryHandle, setProjectDirectoryHandle] = useState<FileSystemDirectoryHandle | null>(null);
    const [projectFiles, setProjectFiles] = useState<Map<string, string>>(new Map()); // Store file paths and their content
    
    // Historial para deshacer/rehacer
    const [history, setHistory] = useState<Record<string, any>[]>([{}]);
    const [historyIndex, setHistoryIndex] = useState(0);
    const maxHistorySize = 50; // Límite de historial
    
    // Calcular si se puede deshacer/rehacer
    const canUndo = historyIndex > 0;
    const canRedo = historyIndex < history.length - 1;



    // Find component by ID, but also handle cases where selectedComponentId might be a data-component-id from iframe
    const selectedComponent = selectedComponentId
        ? (findComponentById(components, selectedComponentId) || {
            // If not found in tree, create a temporary component object for PropertyEditor
            id: selectedComponentId,
            name: `Elemento (${selectedComponentId.substring(0, 20)}...)`,
            type: 'custom' as const,
            // 🔥 NUEVO: Incluir información del background del iframe
            ...(selectedComponentBackground && { background: selectedComponentBackground })
          })
        : null;

    // CRÍTICO: Actualizar el ref del componente que está siendo editado cuando cambia
    React.useEffect(() => {
        if (selectedComponent?.id) {
            editingComponentIdRef.current = selectedComponent.id;
            console.log('[main-studio] Component ID para edición capturado:', selectedComponent.id);
        }
    }, [selectedComponent?.id]);

    // Load saved data on mount
    useEffect(() => {
        const savedData = localStorage.getItem('zeus-studio-data');
        if (savedData) {
            try {
                const data = JSON.parse(savedData);
                console.log('Loading saved data from localStorage:', data);
                
                // Load project path and name first
                if (data.projectPath) {
                    setProjectPath(data.projectPath);
                }
                if (data.projectName) {
                    setProjectName(data.projectName);
                }
                if (data.devServerUrl) {
                    // En producción, si la URL tiene /proxy/3000, mantenerla
                    // Si no la tiene pero es un túnel, agregar /proxy/3000 si estamos en producción
                    let url = data.devServerUrl;
                    const isProduction = typeof window !== 'undefined' && window.location.protocol === 'https:';
                    
                    if (isProduction && url.includes('trycloudflare.com') && !url.includes('localhost')) {
                        // Si no tiene /proxy/, agregar /proxy/3000
                        if (!url.includes('/proxy/')) {
                            url = `${url}/proxy/3000`;
                            console.log('[main-studio] 🔧 Agregando /proxy/3000 a la URL guardada:', url);
                        } else if (url.endsWith('/proxy/3000')) {
                            // Si ya tiene /proxy/3000, mantenerla
                            console.log('[main-studio] ✅ URL ya tiene /proxy/3000, manteniéndola:', url);
                        }
                    }
                    setDevServerUrl(url);
                }
                
                // Load components if available
                if (data.components && Array.isArray(data.components) && data.components.length > 0) {
                    console.log('Loading components from localStorage:', data.components.length, 'components');
                    setComponents(data.components);
                    setIsProjectLoaded(true);
                } else {
                    // Even if no components, if we have a project path, mark as loaded
                    if (data.projectPath) {
                        setIsProjectLoaded(true);
                        setComponents([]);
                    } else {
                        setComponents([]);
                        setIsProjectLoaded(false);
                    }
                }
                
                // Always load component properties if they exist
                if (data.componentProperties && typeof data.componentProperties === 'object') {
                    console.log('Loading component properties from localStorage:', Object.keys(data.componentProperties).length, 'components with properties');
                    console.log('Component properties:', data.componentProperties);
                    setComponentProperties(data.componentProperties);
                } else {
                    console.log('No component properties found in saved data');
                    setComponentProperties({});
                }
            } catch (error) {
                console.error('Error loading saved data:', error);
                // Clear invalid data
                localStorage.removeItem('zeus-studio-data');
                setComponents([]);
                setIsProjectLoaded(false);
            }
        } else {
            console.log('No saved data found in localStorage');
            setComponents([]);
            setIsProjectLoaded(false);
        }
    }, []);

    // Load project from Zeus - deprecated, all projects are now local
    useEffect(() => {
        // No-op: Zeus project auto-loading removed. Projects are loaded locally.
    }, [isProjectLoaded]);

    function findComponentById(components: any[], id: string): any {
        for (const component of components) {
            if (component.id === id) return component;
            if (component.children) {
                const found = findComponentById(component.children, id);
                if (found) return found;
            }
        }
        return null;
    }

    const handleLoadProject = async () => {
        try {
            toast.info('Cargando proyecto desde DATA_PATH...');

            // 1. Obtener DATA_PATH
            const response = await fetch('/api/config/data-path');
            const data = await response.json();
            const dataPath = data.dataPath;

            if (!dataPath) {
                toast.error('No se encontró DATA_PATH configurado');
                return;
            }

            // 2. Listar archivos del proyecto (raíz)
            const filesResponse = await fetch(`http://localhost:8742/api/files?path=`);
            const filesData = await filesResponse.json();

            if (!filesData.files || filesData.files.length === 0) {
                toast.warning('No se encontraron archivos en el proyecto');
                return;
            }

            // 3. Filtrar solo archivos de componentes (.tsx, .jsx, .ts, .js)
            const componentFiles = filesData.files.filter((file: any) =>
                file.name.match(/\.(tsx|jsx|ts|js)$/i)
            );

            if (componentFiles.length === 0) {
                toast.warning('No se encontraron archivos de componentes');
                return;
            }

            // 4. Leer contenido de cada archivo + explorar subcarpetas conocidas
            const dataTransfer = new DataTransfer();
            const filesMap = new Map<string, string>();

            // Carpetas típicas de Next.js/React para escanear
            const knownFolders = ['app', 'pages', 'components', 'src', 'lib', 'hooks', 'context', 'styles', 'public', 'utils', 'types', 'api'];

            const processFile = async (fileName: string, folderPath: string, relativePath: string) => {
                try {
                    const contentResponse = await fetch(
                        `http://localhost:8742/api/files/${encodeURIComponent(fileName)}?path=${encodeURIComponent(folderPath)}`
                    );
                    const contentData = await contentResponse.json();
                    const content = contentData.content || '';

                    // Crear File
                    const blob = new Blob([content], { type: 'text/plain' });
                    const newFile = new File([blob], relativePath, { type: 'text/plain' });
                    (newFile as any)._relativePath = relativePath;
                    dataTransfer.items.add(newFile);

                    // Guardar en mapa con path relativo
                    filesMap.set(relativePath, content);
                } catch (error) {
                    console.warn(`Error leyendo archivo ${relativePath}:`, error);
                }
            };

            // Procesar archivos raíz
            for (const file of componentFiles) {
                await processFile(file.name, '', file.name);
            }

            // Explorar subcarpetas conocidas recursivamente
            const exploreFolderRecursively = async (folderPath: string) => {
                try {
                    // Obtener archivos de la carpeta actual
                    const subFilesResponse = await fetch(`http://localhost:8742/api/files?path=${encodeURIComponent(folderPath)}`);
                    const subFilesData = await subFilesResponse.json();

                    if (subFilesData.files && subFilesData.files.length > 0) {
                        const subComponentFiles = subFilesData.files.filter((f: any) =>
                            f.name.match(/\.(tsx|jsx|ts|js)$/i)
                        );
                        for (const subFile of subComponentFiles) {
                            await processFile(subFile.name, folderPath, `${folderPath}/${subFile.name}`);
                        }
                    }

                    // Obtener subcarpetas y explorar recursivamente
                    const subFoldersResponse = await fetch(`http://localhost:8742/api/folders?path=${encodeURIComponent(folderPath)}`);
                    const subFoldersData = await subFoldersResponse.json();

                    if (subFoldersData.folders && subFoldersData.folders.length > 0) {
                        for (const subFolder of subFoldersData.folders) {
                            const subFolderName = subFolder.name || subFolder;
                            const subFolderPath = `${folderPath}/${subFolderName}`;
                            await exploreFolderRecursively(subFolderPath);
                        }
                    }
                } catch (error) {
                    console.warn(`[handleLoadProject] Carpeta ${folderPath} no accesible o vacía:`, error);
                }
            };

            for (const folder of knownFolders) {
                await exploreFolderRecursively(folder);
            }

            const fileList = dataTransfer.files;

            if (fileList.length === 0) {
                toast.error('No se pudieron cargar los archivos del proyecto');
                return;
            }

            // 5. Cargar el proyecto
            setProjectFiles(filesMap);
            await handleProjectLoaded(dataPath, fileList);

            // 6. Desplegar el servidor de desarrollo para que el preview funcione
            try {
                toast.info('Iniciando servidor de desarrollo...');
                const deployResponse = await fetch('/api/run-project-dev', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ projectPath: dataPath, port: 3000 })
                });
                const deployData = await deployResponse.json();
                if (deployData.success) {
                    const startedPort = deployData.expectedPort || 3000;
                    const newDevUrl = `http://localhost:${startedPort}`;
                    setDevServerUrl(newDevUrl);
                    toast.success(`Servidor de desarrollo iniciado en ${newDevUrl}`);
                } else {
                    console.warn('[handleLoadProject] No se pudo iniciar servidor dev:', deployData.error);
                    toast.warning('Proyecto cargado, pero no se pudo iniciar el servidor dev');
                }
            } catch (deployErr) {
                console.warn('[handleLoadProject] Error iniciando servidor dev:', deployErr);
                toast.warning('Proyecto cargado, pero error al iniciar servidor dev');
            }

            toast.success(`Proyecto cargado: ${fileList.length} archivos`);
        } catch (error) {
            console.error('Error cargando proyecto:', error);
            toast.error('Error al cargar el proyecto desde DATA_PATH');
        }
    };

    // Parse JSX structure from component text
    const parseJSXStructure = (text: string, componentName: string, componentId: string): ComponentNode | null => {
        // Find the return statement and JSX
        const returnMatch = text.match(/return\s*\(([\s\S]*?)\)\s*;?/);
        if (!returnMatch) {
            // Try to find JSX without return
            const jsxMatch = text.match(/(<[\w\s/="'{}.-]+>[\s\S]*?<\/[\w]+>)/);
            if (!jsxMatch) return null;
        }

        const jsxContent = returnMatch ? returnMatch[1] : text;
        
        // Extract top-level JSX elements
        const topLevelElements: ComponentNode[] = [];
        
        // Find all JSX elements (tags)
        const elementRegex = /<(\w+)([^>]*)>([\s\S]*?)<\/\1>/g;
        const selfClosingRegex = /<(\w+)([^>]*)\s*\/>/g;
        
        let match;
        const processedText = jsxContent;
        
        // Process self-closing tags first
        while ((match = selfClosingRegex.exec(processedText)) !== null) {
            const tagName = match[1];
            const attributes = match[2];
            
            let elementType: ComponentNode['type'] = 'custom';
            if (tagName.toLowerCase() === 'button') elementType = 'button';
            else if (tagName.toLowerCase() === 'input') elementType = 'input';
            else if (tagName.toLowerCase() === 'img' || tagName.toLowerCase() === 'image') elementType = 'image';
            else if (tagName.toLowerCase() === 'p' || tagName.toLowerCase() === 'span' || tagName.toLowerCase() === 'h1' || tagName.toLowerCase() === 'h2' || tagName.toLowerCase() === 'h3') elementType = 'text';
            else elementType = 'container';
            
            topLevelElements.push({
                id: `${componentId}-${tagName}-${topLevelElements.length}`,
                name: tagName,
                type: elementType
            });
        }
        
        // Process regular tags
        const tagRegex = /<(\w+)([^>]*)>([\s\S]*?)<\/\1>/g;
        while ((match = tagRegex.exec(processedText)) !== null) {
            const tagName = match[1];
            const attributes = match[2];
            const innerContent = match[3];
            
            // Skip if it's a component import/usage (starts with uppercase)
            if (tagName[0] === tagName[0].toUpperCase() && tagName !== tagName.toLowerCase()) {
                // It's a component, create a node for it
                topLevelElements.push({
                    id: `${componentId}-${tagName}-${topLevelElements.length}`,
                    name: tagName,
                    type: 'custom',
                    children: parseJSXChildren(innerContent, `${componentId}-${tagName}-${topLevelElements.length}`)
                });
                continue;
            }
            
            let elementType: ComponentNode['type'] = 'custom';
            if (tagName.toLowerCase() === 'button') elementType = 'button';
            else if (tagName.toLowerCase() === 'input') elementType = 'input';
            else if (tagName.toLowerCase() === 'img' || tagName.toLowerCase() === 'image') elementType = 'image';
            else if (tagName.toLowerCase() === 'p' || tagName.toLowerCase() === 'span' || tagName.toLowerCase() === 'h1' || tagName.toLowerCase() === 'h2' || tagName.toLowerCase() === 'h3' || tagName.toLowerCase() === 'h4' || tagName.toLowerCase() === 'h5' || tagName.toLowerCase() === 'h6' || tagName.toLowerCase() === 'label') elementType = 'text';
            else if (tagName.toLowerCase() === 'div' || tagName.toLowerCase() === 'section' || tagName.toLowerCase() === 'main' || tagName.toLowerCase() === 'header' || tagName.toLowerCase() === 'footer' || tagName.toLowerCase() === 'article' || tagName.toLowerCase() === 'nav') elementType = 'container';
            
            // Extract text content if it's a text element
            const textContent = innerContent.trim().replace(/<[^>]+>/g, '').substring(0, 50);
            
            topLevelElements.push({
                id: `${componentId}-${tagName}-${topLevelElements.length}`,
                name: textContent || tagName,
                type: elementType,
                children: elementType === 'container' ? parseJSXChildren(innerContent, `${componentId}-${tagName}-${topLevelElements.length}`) : undefined
            });
        }
        
        // If no elements found, create a simple container
        if (topLevelElements.length === 0) {
            return {
                id: componentId,
                name: componentName,
                type: 'container'
            };
        }
        
        // Return the main component with its children
        return {
            id: componentId,
            name: componentName,
            type: 'container',
            children: topLevelElements
        };
    };
    
    // Parse children from JSX content
    const parseJSXChildren = (content: string, parentId: string): ComponentNode[] => {
        const children: ComponentNode[] = [];
        const tagRegex = /<(\w+)([^>]*)>([\s\S]*?)<\/\1>/g;
        const selfClosingRegex = /<(\w+)([^>]*)\s*\/>/g;
        
        let match;
        let index = 0;
        
        // Process self-closing tags
        while ((match = selfClosingRegex.exec(content)) !== null && index < 10) {
            const tagName = match[1];
            let elementType: ComponentNode['type'] = 'custom';
            if (tagName.toLowerCase() === 'button') elementType = 'button';
            else if (tagName.toLowerCase() === 'input') elementType = 'input';
            else if (tagName.toLowerCase() === 'img' || tagName.toLowerCase() === 'image') elementType = 'image';
            else elementType = 'container';
            
            children.push({
                id: `${parentId}-child-${index}`,
                name: tagName,
                type: elementType
            });
            index++;
        }
        
        // Process regular tags
        while ((match = tagRegex.exec(content)) !== null && index < 10) {
            const tagName = match[1];
            const innerContent = match[3];
            
            let elementType: ComponentNode['type'] = 'custom';
            if (tagName.toLowerCase() === 'button') elementType = 'button';
            else if (tagName.toLowerCase() === 'input') elementType = 'input';
            else if (tagName.toLowerCase() === 'img' || tagName.toLowerCase() === 'image') elementType = 'image';
            else if (tagName.toLowerCase() === 'p' || tagName.toLowerCase() === 'span' || tagName.toLowerCase() === 'h1' || tagName.toLowerCase() === 'h2' || tagName.toLowerCase() === 'h3') elementType = 'text';
            else if (tagName.toLowerCase() === 'div' || tagName.toLowerCase() === 'section' || tagName.toLowerCase() === 'main') elementType = 'container';
            
            const textContent = innerContent.trim().replace(/<[^>]+>/g, '').substring(0, 30);
            
            children.push({
                id: `${parentId}-child-${index}`,
                name: textContent || tagName,
                type: elementType,
                children: elementType === 'container' && innerContent.trim().length > 0 ? parseJSXChildren(innerContent, `${parentId}-child-${index}`) : undefined
            });
            index++;
        }
        
        return children;
    };

    const parseProjectFiles = async (files: FileList): Promise<ComponentNode[]> => {
        const parsedComponents: ComponentNode[] = [];
        const componentFiles: File[] = [];
        const pageFiles: File[] = [];
        
        // Filter component files (.tsx, .jsx, .ts, .js) and exclude node_modules, .next, package-lock.json
        Array.from(files).forEach(file => {
            const name = file.name.toLowerCase();
            // Use webkitRelativePath if available, otherwise use file.name (which may contain full path)
            const filePath = (file as any).webkitRelativePath || (file as any)._relativePath || file.name;
            
            // Exclude node_modules, .next, and package-lock.json
            if (filePath.includes('node_modules') || 
                filePath.includes('.next') || 
                filePath.includes('package-lock.json') ||
                filePath.includes('.git') ||
                filePath.includes('dist') ||
                filePath.includes('build')) {
                return;
            }
            
            if (name.endsWith('.tsx') || name.endsWith('.jsx') || 
                (name.endsWith('.ts') && !name.endsWith('.d.ts')) || 
                (name.endsWith('.js') && !name.includes('.test.'))) {
                // Separate page files from component files
                if (filePath.includes('/app/') || filePath.includes('/pages/') || filePath.includes('page.')) {
                    pageFiles.push(file);
                } else {
                    componentFiles.push(file);
                }
            }
        });

        // Process page files first (these are the entry points)
        for (const file of pageFiles) {
            try {
                const text = await file.text();
                // Use webkitRelativePath if available, otherwise use file.name (which may contain full path)
                const filePath = (file as any).webkitRelativePath || (file as any)._relativePath || file.name;
                const fileName = filePath.split('/').pop()?.replace(/\.(tsx|jsx|ts|js)$/, '') || file.name.replace(/\.(tsx|jsx|ts|js)$/, '');
                
                // Extract component name
                const componentMatch = text.match(/(?:export\s+(?:default\s+)?(?:function|const)\s+(\w+)|export\s+default\s+(\w+))/);
                const componentName = componentMatch ? (componentMatch[1] || componentMatch[2]) : fileName;
                
                const componentId = `page-${fileName.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
                
                // Parse JSX structure
                const parsedComponent = parseJSXStructure(text, componentName, componentId);
                if (parsedComponent) {
                    parsedComponents.push(parsedComponent);
                    console.log(`✓ Parsed page: ${componentName} (${componentId})`);
                } else {
                    // Create a basic component even if parsing fails
                    parsedComponents.push({
                        id: componentId,
                        name: componentName,
                        type: 'container'
                    });
                    console.log(`✓ Created basic component for page: ${componentName} (${componentId})`);
                }
            } catch (error) {
                console.error(`Error parsing page file ${file.name}:`, error);
            }
        }

        // Process component files
        for (const file of componentFiles) {
            try {
                const text = await file.text();
                const fileName = file.name.replace(/\.(tsx|jsx|ts|js)$/, '');
                
                // Extract component name
                const componentMatch = text.match(/(?:export\s+(?:default\s+)?(?:function|const)\s+(\w+)|export\s+default\s+(\w+))/);
                const componentName = componentMatch ? (componentMatch[1] || componentMatch[2]) : fileName;
                
                const componentId = `component-${fileName.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
                
                // Only add if it's not already added as a page
                if (!parsedComponents.some(c => c.id === componentId)) {
                    // Parse JSX structure
                    const parsedComponent = parseJSXStructure(text, componentName, componentId);
                    if (parsedComponent) {
                        parsedComponents.push(parsedComponent);
                        console.log(`✓ Parsed component: ${componentName} (${componentId})`);
                    } else {
                        // Create a basic component even if parsing fails
                        parsedComponents.push({
                            id: componentId,
                            name: componentName,
                            type: 'custom'
                        });
                        console.log(`✓ Created basic component: ${componentName} (${componentId})`);
                    }
                }
            } catch (error) {
                console.error(`Error parsing component file ${file.name}:`, error);
            }
        }

        // If no components found, return empty array
        if (parsedComponents.length === 0) {
            toast.warning('No components found in project.');
            return emptyComponents;
        }

        return parsedComponents;
    };

    const handleProjectLoaded = async (projectPath: string, files?: FileList) => {
        setProjectPath(projectPath);

        // Forzar re-montaje del PreviewPanel para que el iframe se inicialice limpio
        setPreviewPanelKey(prev => prev + 1);

        // Extract project name
        const projectName = projectPath.split(/[\\/]/).pop() || 'Project';
        
        // Detect project type
        const isDatabaseProjectLoading = projectPath.startsWith('database:');
        const isGithubProjectLoading = projectPath.startsWith('github:');
        const isZeusProjectLoading = projectPath.startsWith('zeus:'); // Assuming 'zeus:' prefix for Zeus projects

        let databaseProjectId: string | null = null;
        if (isDatabaseProjectLoading) {
            databaseProjectId = projectPath.replace('database:', '');
        }
        
        // Try to get directory handle for saving files directly to project root
        // This only works if the user has previously granted access via showDirectoryPicker
        // For now, we'll try to request access when saving
        
        if (files && files.length > 0) {
            try {
                toast.info('Analizando archivos del proyecto...');
                
                // Store project files for reference
                const filesMap = new Map<string, string>();
                for (let i = 0; i < files.length; i++) {
                    const file = files[i];
                    // Use webkitRelativePath if available, otherwise use file.name (which may contain full path)
                    const filePath = (file as any).webkitRelativePath || (file as any)._relativePath || file.name;
                    try {
                        const content = await file.text();
                        filesMap.set(filePath, content);
                    } catch (e) {
                        console.warn(`Could not read file ${filePath}:`, e);
                    }
                }
                setProjectFiles(filesMap);
                
                const parsedComponents = await parseProjectFiles(files);
                console.log('Parsed components:', parsedComponents);
                console.log('Number of components:', parsedComponents.length);
                
                // Ensure we have components before setting state
                if (parsedComponents && parsedComponents.length > 0) {
                    setComponents(parsedComponents);
                    setProjectName(projectName);
                    selectedComponentIdRef.current = null;
                    setSelectedComponentId(null);
                    setIsProjectLoaded(true);
                    // Clear old properties when loading a new project
                    setComponentProperties({});
                    
                    // Immediately save to localStorage to update the saved data
                    const dataToSave = {
                        components: parsedComponents,
                        projectPath: projectPath,
                        projectName: projectName,
                        componentProperties: {},
                        devServerUrl: devServerUrl,
                        savedAt: new Date().toISOString(),
                        ...(databaseProjectId && { databaseProjectId })
                    };
                    localStorage.setItem('zeus-studio-data', JSON.stringify(dataToSave));
                    console.log('Project loaded and saved to localStorage:', parsedComponents.length, 'components');
                    
                    toast.success(`Proyecto cargado: ${parsedComponents.length} componente(s) encontrado(s) de ${files.length} archivos procesados.`);
                } else {
                    setComponents([]);
                    setIsProjectLoaded(false);
                    // Clear localStorage if no components found
                    localStorage.removeItem('zeus-studio-data');
                    toast.warning('No se encontraron componentes en el proyecto.');
                }
            } catch (error) {
                console.error('Error loading project:', error);
                toast.error('Error al cargar el proyecto.');
                setComponents([]);
                setIsProjectLoaded(false);
            }
        } else {
            // If no files, try to load components from localStorage if they match this project path
            const savedData = localStorage.getItem('zeus-studio-data');
            if (savedData) {
                try {
                    const data = JSON.parse(savedData);
                    // Check if saved data matches the project path
                    if (data.projectPath === projectPath && data.components && Array.isArray(data.components) && data.components.length > 0) {
                        // Load components from saved data
                        setComponents(data.components);
                        setProjectName(data.projectName || projectName);
                        selectedComponentIdRef.current = null;
                        setSelectedComponentId(null);
                        setIsProjectLoaded(true);
                        setComponentProperties(data.componentProperties || {});
                        
                        // RESTAURAR ARCHIVOS DEL PROYECTO PARA EL EDITOR DE URLS
                        if (data.projectFiles) {
                            const filesMap = new Map<string, string>();
                            Object.entries(data.projectFiles).forEach(([filePath, content]) => {
                                filesMap.set(filePath, content as string);
                            });
                            setProjectFiles(filesMap);
                            console.log('[handleProjectLoaded] 📂 Archivos del proyecto restaurados para editor de URLs:', filesMap.size);
                        }
                        
                        if (data.devServerUrl) {
                            // En producción, si la URL tiene /proxy/3000, mantenerla
                            // Si no la tiene pero es un túnel, agregar /proxy/3000 si estamos en producción
                            let url = data.devServerUrl;
                            const isProduction = typeof window !== 'undefined' && window.location.protocol === 'https:';
                            
                            if (isProduction && url.includes('trycloudflare.com') && !url.includes('localhost')) {
                                // Si no tiene /proxy/, agregar /proxy/3000
                                if (!url.includes('/proxy/')) {
                                    url = `${url}/proxy/3000`;
                                    console.log('[main-studio] 🔧 Agregando /proxy/3000 a la URL guardada:', url);
                                } else if (url.endsWith('/proxy/3000')) {
                                    // Si ya tiene /proxy/3000, mantenerla
                                    console.log('[main-studio] ✅ URL ya tiene /proxy/3000, manteniéndola:', url);
                                }
                            }
                            setDevServerUrl(url);
                        }
                        toast.success(t('projectLoadedFromRecent').replace('{count}', data.components.length.toString()));
                    } else {
                        // No matching saved data, just set the path
                        setProjectName(projectName);
                        setIsProjectLoaded(true);
                        setComponentProperties({});
                        toast.info(t('projectPathSet').replace('{path}', projectPath) + '. ' + t('loadFilesToSeeComponents'));
                    }
                } catch (error) {
                    console.error('Error loading saved data for recent project:', error);
                    setProjectName(projectName);
                    setIsProjectLoaded(true);
                    setComponentProperties({});
                    toast.info(t('projectPathSet').replace('{path}', projectPath));
                }
            } else {
                // No saved data at all
                setProjectName(projectName);
                setIsProjectLoaded(true);
                setComponentProperties({});
                toast.info(t('projectPathSet').replace('{path}', projectPath) + '. ' + t('loadFilesToSeeComponents'));
            }
        }
    };

    // Generate CSS from component properties
    const generateCSS = (): string => {
        console.log('[generateCSS] 🎨 Iniciando generación de CSS...');
        console.log('[generateCSS] 📊 Componentes con propiedades:', Object.keys(componentProperties).length);
        
        const googleFontsToImport = new Set<string>(); // Para recopilar las fuentes de Google
        console.log('[generateCSS] 📋 IDs de componentes:', Object.keys(componentProperties));
        
        let css = '/* Estilos generados por zeus Studio */\n';
        css += '/* Fecha: ' + new Date().toLocaleString('es-ES') + ' */\n';
        css += '/* IMPORTANTE: Este archivo debe ser importado en tu aplicación para que los estilos persistan */\n';
        css += '/* Agrega esto en tu layout.tsx o _app.tsx: import "./zeus-styles.css"; */\n\n';
        
        Object.entries(componentProperties).forEach(([componentId, props]: [string, any]) => {
            // IMPORTANTE: No verificar si el componente está en el árbol
            // Los componentes pueden tener IDs generados automáticamente desde el iframe
            // que no están en el árbol de componentes original
            if (!props || props === null || typeof props !== 'object') {
                console.log(`[generateCSS] ⚠️ Omitiendo componente ${componentId}: props inválidos`);
                return;
            }
            
            // Verificar si el componente está marcado como eliminado
            const isDeleted = props.__deleted === true;
            console.log(`[generateCSS] 📊 Componente ${componentId} está ${isDeleted ? 'ELIMINADO' : 'ACTIVO'}`);
                        
            console.log(`[generateCSS] 📝 Procesando componente ${componentId}:`, {
                hasBackground: !!props.background,
                hasBorder: !!props.border,
                hasSize: !!props.size,
                hasDisplay: !!props.display,
                hasImg: !!props.img,
                hasTypography: !!props.typography,
                hasShadow: !!props.shadow,
                hasTextContent: !!(props.typography?.textContent),
                textContent: props.typography?.textContent,
                sizeKeys: props.size ? Object.keys(props.size) : [],
                isDeleted: isDeleted
            });
                        
            // 🔥 USAR SOLO SELECTORES HTML - El que funciona desde el principio
            // Basado en la estructura HTML existente (como en zeus-styles.css)
            
            let selector = '';
            
            // Generar selector basado en el tipo de componente
            if (['servicios', 'portafolio', 'testimonios', 'proceso', 'faq', 'contacto'].includes(componentId)) {
                // Para secciones principales - usar ID directo
                selector = `section[id="${componentId}"]`;
            } else if (componentId.startsWith('component-')) {
                // Para componentes personalizados - usar clase
                const cleanId = componentId.replace('component-', '');
                selector = `.zeus-component-${cleanId}`;
            } else {
                // Fallback: usar data-component-id
                selector = `[data-component-id="${componentId}"]`;
            }
            
            css += `${selector} {\n`;
                        
            // Si el componente está eliminado, aplicar estilos que lo hagan invisible
            if (isDeleted) {
                console.log(`[generateCSS] 👻 Aplicando estilos de invisibilidad para componente eliminado: ${componentId}`);
                css += `  display: none !important;\n`;
                css += `  visibility: hidden !important;\n`;
                css += `  opacity: 0 !important;\n`;
                css += `  width: 0 !important;\n`;
                css += `  height: 0 !important;\n`;
                css += `  margin: 0 !important;\n`;
                css += `  padding: 0 !important;\n`;
                css += `  border: none !important;\n`;
                css += `  outline: none !important;\n`;
                css += `  box-shadow: none !important;\n`;
                css += `  pointer-events: none !important;\n`;
                css += `  position: absolute !important;\n`;
                css += `  overflow: hidden !important;\n`;
                css += `  z-index: -9999 !important;\n`;
                css += `}\n\n`;
                return; // Salir temprano para componentes eliminados
            }
            
            // Background
            if (props.background) {
                console.log(`[generateCSS] 🎨 Procesando background para ${componentId}:`, props.background);
                const bgType = props.background.type || (props.background.gradient ? 'gradient' : props.background.color ? 'solid' : props.background.image ? 'image' : null);
                
                if (bgType === 'gradient' || (!bgType && props.background.gradient)) {
                    // Gradiente: usar background (no background-color) para que funcione correctamente
                    const gradient = props.background.gradient || 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
                    css += `  background: ${gradient} !important;\n`;
                    css += `  background-color: transparent !important;\n`; // Evitar conflictos
                } else if (bgType === 'solid' || (!bgType && props.background.color)) {
                    const color = props.background.color || 'transparent';
                    // Usar background en lugar de solo background-color para sobrescribir clases de Tailwind como bg-white
                    css += `  background: ${color} !important;\n`;
                    css += `  background-color: ${color} !important;\n`;
                } else if (bgType === 'image' && props.background.image) {
                    css += `  background-image: url(${props.background.image}) !important;\n`;
                    
                    // Procesar tamaño de imagen
                    let imageSize = props.background.imageSize || 'cover';
                    if (imageSize === 'custom' && props.background.customSize) {
                        imageSize = `${props.background.customSize}% auto`;
                    }
                    css += `  background-size: ${imageSize} !important;\n`;
                    
                    // Procesar posición de imagen usando positionX y positionY
                    const posX = props.background.positionX || 50;
                    const posY = props.background.positionY || 50;
                    css += `  background-position: ${posX}% ${posY}% !important;\n`;
                    
                    // Procesar repetición
                    const imageRepeat = props.background.imageSize === 'repeat' ? 'repeat' : 'no-repeat';
                    css += `  background-repeat: ${imageRepeat} !important;\n`;
                    
                    // Opacidad de imagen de fondo (usar pseudo-elemento para afectar solo a la imagen)
                    if (props.background.imageOpacity !== undefined && props.background.imageOpacity !== null && props.background.imageOpacity !== 1) {
                        // Crear pseudo-elemento ::before con la imagen y opacidad
                        css += `  position: relative !important;\n`;
                        css += `  z-index: 0 !important;\n`;
                        css += `  &::before {\n`;
                        css += `    content: '' !important;\n`;
                        css += `    position: absolute !important;\n`;
                        css += `    top: 0 !important;\n`;
                        css += `    left: 0 !important;\n`;
                        css += `    right: 0 !important;\n`;
                        css += `    bottom: 0 !important;\n`;
                        css += `    background-image: url(${props.background.image}) !important;\n`;
                        css += `    background-size: ${imageSize} !important;\n`;
                        css += `    background-position: ${posX}% ${posY}% !important;\n`;
                        css += `    background-repeat: ${imageRepeat} !important;\n`;
                        css += `    opacity: ${props.background.imageOpacity} !important;\n`;
                        css += `    z-index: -1 !important;\n`;
                        css += `  }\n`;
                        css += `  background: transparent !important;\n`;
                        console.log(`[generateCSS] 🎨 Opacidad de imagen aplicada via pseudo-elemento: ${props.background.imageOpacity} para ${componentId}`);
                    }
                    
                    console.log(`[generateCSS] 🖼️ Propiedades de imagen aplicadas para ${componentId}:`, {
                        imageSize,
                        position: `${posX}% ${posY}%`,
                        repeat: imageRepeat,
                        opacity: props.background.imageOpacity
                    });
                }
            }
            
            // Border
            if (props.border) {
                css += `  border: ${props.border.width}px ${props.border.style} ${props.border.color} !important;\n`;
                css += `  border-radius: ${props.border.radius}px !important;\n`;
            }
            
            // Size & Position
            if (props.size) {
                console.log(`[generateCSS] 📏 Procesando size para ${componentId}:`, props.size);
                
                if (props.size.width && props.size.width !== 'auto') css += `  width: ${props.size.width} !important;\n`;
                if (props.size.height && props.size.height !== 'auto') css += `  height: ${props.size.height} !important;\n`;
                if (props.size.padding !== undefined && props.size.padding !== null) css += `  padding: ${props.size.padding}px !important;\n`;
                if (props.size.margin !== undefined && props.size.margin !== null) css += `  margin: ${props.size.margin}px !important;\n`;
                
                const hasPositionX = props.size.positionX !== undefined && props.size.positionX !== null;
                const hasPositionY = props.size.positionY !== undefined && props.size.positionY !== null;
                const hasLeft = props.size.left !== undefined && props.size.left !== null;
                const hasTop = props.size.top !== undefined && props.size.top !== null;
                
                console.log(`[generateCSS] 📍 Verificando posición para ${componentId}:`, {
                    hasPositionX,
                    hasPositionY,
                    hasLeft,
                    hasTop,
                    positionX: props.size.positionX,
                    positionY: props.size.positionY,
                    left: props.size.left,
                    top: props.size.top
                });

                if (hasPositionX || hasPositionY || hasLeft || hasTop) {
                    const position = props.size.position || 'relative';
                    css += `  position: ${position} !important;\n`;
                    
                    // Priorizar positionX/positionY sobre left/top
                    if (hasPositionX) {
                        css += `  left: ${props.size.positionX}px !important;\n`;
                        console.log(`[generateCSS] ✅ Agregado left: ${props.size.positionX}px para ${componentId}`);
                    } else if (hasLeft) {
                        css += `  left: ${props.size.left} !important;\n`;
                        console.log(`[generateCSS] ✅ Agregado left: ${props.size.left} para ${componentId}`);
                    }
                    
                    if (hasPositionY) {
                        css += `  top: ${props.size.positionY}px !important;\n`;
                        console.log(`[generateCSS] ✅ Agregado top: ${props.size.positionY}px para ${componentId}`);
                    } else if (hasTop) {
                        css += `  top: ${props.size.top} !important;\n`;
                        console.log(`[generateCSS] ✅ Agregado top: ${props.size.top} para ${componentId}`);
                    }
                    
                    console.log(`[generateCSS] 📍 Posición aplicada:`, {
                        positionX: hasPositionX ? props.size.positionX : (hasLeft ? props.size.left : 'no'),
                        positionY: hasPositionY ? props.size.positionY : (hasTop ? props.size.top : 'no'),
                        position
                    });
                } else if (props.size.position) {
                    css += `  position: ${props.size.position} !important;\n`;
                    console.log(`[generateCSS] ✅ Agregado position: ${props.size.position} para ${componentId}`);
                } else {
                    console.log(`[generateCSS] ⚠️ No hay propiedades de posición para ${componentId}`);
                }
            } else {
                console.log(`[generateCSS] ⚠️ No hay propiedades size para ${componentId}`);
            }
            
            // Display
            if (props.display) {
                console.log(`[generateCSS] 📱 Procesando display para ${componentId}:`, props.display);
                if (props.display.value) {
                    css += `  display: ${props.display.value} !important;\n`;
                    console.log(`[generateCSS] ✅ Agregado display: ${props.display.value} para ${componentId}`);
                }
            } else {
                console.log(`[generateCSS] ⚠️ No hay propiedades display para ${componentId}`);
            }
            
            // Img
            if (props.img) {
                console.log(`[generateCSS] 🖼️ Procesando img para ${componentId}:`, props.img);
                if (props.img.src !== undefined) {
                    css += `  src: "${props.img.src}" !important;\n`;
                    console.log(`[generateCSS] ✅ Agregado src: "${props.img.src}" para ${componentId}`);
                }
                if (props.img.alt !== undefined) {
                    css += `  alt: "${props.img.alt}" !important;\n`;
                    console.log(`[generateCSS] ✅ Agregado alt: "${props.img.alt}" para ${componentId}`);
                }
            } else {
                console.log(`[generateCSS] ⚠️ No hay propiedades img para ${componentId}`);
            }
            
            // Typography
            if (props.typography) {
                // Agregar comillas si el nombre de la fuente tiene espacios y agregar fallback apropiado
                let fontFamily = props.typography.fontFamily || 'Inter';
                // Si la fuente tiene espacios, agregar comillas
                if (fontFamily.includes(' ') && !fontFamily.startsWith('"') && !fontFamily.startsWith("'")) {
                    fontFamily = `"${fontFamily}"`;
                }
                // Agregar fallback según el tipo de fuente
                const fontFamilyLower = fontFamily.toLowerCase();
                if (fontFamilyLower.includes('mono') || fontFamilyLower.includes('code') || fontFamilyLower === 'courier new' || fontFamilyLower === 'lucida console') {
                    fontFamily += ', monospace';
                } else if (fontFamilyLower.includes('serif') || fontFamilyLower.includes('times') || fontFamilyLower.includes('georgia') || fontFamilyLower.includes('garamond') || fontFamilyLower.includes('playfair') || fontFamilyLower.includes('merriweather') || fontFamilyLower.includes('lora')) {
                    fontFamily += ', serif';
                } else if (fontFamilyLower.includes('script') || fontFamilyLower.includes('cursive') || fontFamilyLower.includes('dancing') || fontFamilyLower.includes('pacifico') || fontFamilyLower.includes('satisfy') || fontFamilyLower.includes('caveat')) {
                    fontFamily += ', cursive';
                } else {
                    fontFamily += ', sans-serif';
                }
                css += `  font-family: ${fontFamily} !important;\n`;
                css += `  font-size: ${props.typography.fontSize || 16}px !important;\n`;
                css += `  font-weight: ${props.typography.fontWeight || 400} !important;\n`;
                css += `  color: ${props.typography.color || '#000000'} !important;\n`;
                css += `  line-height: ${props.typography.lineHeight || 1.5} !important;\n`;
                css += `  text-align: ${props.typography.alignment || 'left'} !important;\n`;

                // Recopilar Google Fonts para importación - usar el nombre de la fuente sin comillas ni fallbacks
                const rawFontFamily = props.typography.fontFamily;
                // Heurística mejorada: si no es 'Inter' y no es una fuente genérica CSS, asumimos que es una Google Font que necesita importación
                const genericFonts = ['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'emoji', 'math', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded'];
                if (rawFontFamily && rawFontFamily !== 'Inter' && !genericFonts.includes(rawFontFamily.toLowerCase()) && !rawFontFamily.includes(',')) {
                    googleFontsToImport.add(rawFontFamily);
                }

                // --- NUEVA LÓGICA PARA TEXT GRADIENT ---
                const textType = props.typography.textType || 'solid'; // Default to solid
                if (textType === 'gradient' && props.typography.textGradient) {
                    const gradient = props.typography.textGradient;
                    css += `  background: ${gradient} !important;\n`;
                    css += `  -webkit-background-clip: text !important;\n`;
                    css += `  background-clip: text !important;\n`;
                    css += `  color: transparent !important;\n`; // Make text transparent to show gradient
                    console.log(`[generateCSS] ✅ Text Gradient aplicado para ${componentId}:`, gradient);
                } else if (textType === 'solid' && props.typography.color) {
                    css += `  color: ${props.typography.color} !important;\n`;
                }
                // --- FIN NUEVA LÓGICA ---
;
                
                // Text Content - NO generar CSS para el editor (solo para fuera del editor), pero guardar para mensajes
                if (props.typography.textContent) {
                    // Escapar caracteres especiales para CSS (para fuera del editor)
                    const escapedText = props.typography.textContent
                        .replace(/\\/g, '\\\\')
                        .replace(/"/g, '\\"')
                        .replace(/'/g, "\\'")
                        .replace(/\n/g, '\\A')
                        .replace(/\r/g, '');
                    
                    // NO generar CSS con ::before para el editor (evita conflictos)
                    // El editor usará mensajes directos al iframe
                    
                    // Guardar para enviar mensajes al iframe del editor
                    if (!window.zeusTextUpdates) {
                        window.zeusTextUpdates = {};
                    }
                    window.zeusTextUpdates[componentId] = escapedText;
                    
                    // También guardar en una variable para generar CSS solo para fuera del editor
                    if (!window.zeusTextForCSS) {
                        window.zeusTextForCSS = {};
                    }
                    window.zeusTextForCSS[componentId] = escapedText;
                    
                    console.log(`[generateCSS] ✅ TextContent guardado para iframe y CSS externo:`, escapedText);
                }
                
                // Text stroke and shadow
                if (props.typography.textStroke?.enabled && props.typography.textStroke?.width > 0) {
                    const strokeColor = props.typography.textStroke.color || '#000000';
                    const strokeOpacity = props.typography.textStroke.opacity || 1;
                    
                    // Aplicar color con opacidad si es necesario
                    let finalStrokeColor = strokeColor;
                    if (strokeOpacity !== 1) {
                        const hexToRgba = (hex: string, alpha: number): string => {
                            const r = parseInt(hex.slice(1, 3), 16);
                            const g = parseInt(hex.slice(3, 5), 16);
                            const b = parseInt(hex.slice(5, 7), 16);
                            return `rgba(${r}, ${g}, ${b}, ${alpha})`;
                        };
                        
                        if (strokeColor.startsWith('#')) {
                            finalStrokeColor = hexToRgba(strokeColor, strokeOpacity);
                        } else if (strokeColor.startsWith('rgb(')) {
                            finalStrokeColor = strokeColor.replace('rgb(', 'rgba(').replace(')', `, ${strokeOpacity})`);
                        }
                    }
                    
                    css += `  -webkit-text-stroke: ${props.typography.textStroke.width}px ${finalStrokeColor} !important;\n`;
                    css += `  text-stroke: ${props.typography.textStroke.width}px ${finalStrokeColor} !important;\n`;
                    
                    console.log(`[generateCSS] ✅ Text stroke aplicado para ${componentId}:`, {
                        width: props.typography.textStroke.width,
                        color: finalStrokeColor,
                        enabled: props.typography.textStroke.enabled
                    });
                } else {
                    console.log(`[generateCSS] ⚠️ Text stroke desactivado o sin grosor para ${componentId}:`, {
                        enabled: props.typography.textStroke?.enabled,
                        width: props.typography.textStroke?.width
                    });
                }
                
                // Text Shadow (sombra de texto)
                if (props.typography.textShadow && props.typography.textShadow.enabled) {
                    const shadowColor = props.typography.textShadow.color || '#000000';
                    const shadowBlur = props.typography.textShadow.blur || 4;
                    const shadowOffsetX = props.typography.textShadow.offsetX || 2;
                    const shadowOffsetY = props.typography.textShadow.offsetY || 2;
                    const shadowOpacity = props.typography.textShadow.opacity || 0.5;
                    
                    // Aplicar color con opacidad si es necesario
                    let finalShadowColor = shadowColor;
                    if (shadowOpacity !== 1) {
                        const hexToRgba = (hex: string, alpha: number): string => {
                            const r = parseInt(hex.slice(1, 3), 16);
                            const g = parseInt(hex.slice(3, 5), 16);
                            const b = parseInt(hex.slice(5, 7), 16);
                            return `rgba(${r}, ${g}, ${b}, ${alpha})`;
                        };
                        finalShadowColor = shadowColor.replace('rgb', 'rgba').replace(')', `, ${shadowOpacity})`);
                        if (finalShadowColor === shadowColor) {
                            finalShadowColor = hexToRgba(shadowColor, shadowOpacity);
                        }
                    }
                    
                    css += `  text-shadow: ${shadowOffsetX}px ${shadowOffsetY}px ${shadowBlur}px ${finalShadowColor} !important;\n`;
                }
            }
            
            // Shadow
            if (props.shadow) {
                const shadowColor = props.shadow.color || '#000000';
                const opacity = props.shadow.opacity || 0.1;
                const rgba = hexToRgba(shadowColor, opacity);
                css += `  box-shadow: ${props.shadow.offsetX}px ${props.shadow.offsetY}px ${props.shadow.blur}px ${props.shadow.spread}px ${rgba} !important;\n`;
            }
            
            css += '}\n\n';

            // Icon
            if (props.icon && props.icon.name) {
                const iconName = props.icon.name;
                const iconSize = props.icon.size || 20;
                const iconColor = props.icon.color || '#000000';
                const iconStrokeWidth = props.icon.strokeWidth || 2;
                const pathData = iconPaths[iconName];
                if (pathData) {
                    // Hide any old injected SVGs/containers from legacy scripts
                    css += `${selector} .zeus-injected-icon,\n${selector} > svg[viewBox="0 0 24 24"],\n${selector} svg.lucide,\n${selector} .lucide {\n  display: none !important;\n}\n\n`;

                    // Build SVG data URI with embedded color
                    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${iconColor}" stroke-width="${iconStrokeWidth}" stroke-linecap="round" stroke-linejoin="round"><path d="${pathData}"/></svg>`;
                    const dataUri = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;

                    css += `${selector}::before {\n`;
                    css += `  content: '' !important;\n`;
                    css += `  display: inline-block !important;\n`;
                    css += `  width: ${iconSize}px !important;\n`;
                    css += `  height: ${iconSize}px !important;\n`;
                    css += `  background-image: ${dataUri} !important;\n`;
                    css += `  background-size: contain !important;\n`;
                    css += `  background-repeat: no-repeat !important;\n`;
                    css += `  background-position: center !important;\n`;
                    css += `  vertical-align: middle !important;\n`;
                    css += `  flex-shrink: 0 !important;\n`;
                    css += `}\n\n`;
                }
            }
        });
        
        console.log('[generateCSS] ✅ CSS generado completamente. Longitud total:', css.length);
        console.log('[generateCSS] 📄 Vista previa del CSS generado:');
        console.log(css.substring(0, 1000));
        
        // Agregar @import para Google Fonts al principio del CSS
        let googleFontsImports = '';
        if (googleFontsToImport.size > 0) {
            const fontFamilies = Array.from(googleFontsToImport).map(font => {
                // Reemplazar espacios con '+' y codificar la URL
                return `family=${encodeURIComponent(font.replace(/ /g, '+'))}`;
            }).join('&');
            googleFontsImports = `@import url('https://fonts.googleapis.com/css2?${fontFamilies}&display=swap');\n\n`;
            console.log('[generateCSS] 🔗 Google Fonts importados:', googleFontsImports.trim());
        }
        
        return googleFontsImports + css;
    };

    const generateIconScript = async (iconProperties: Record<string, any>): Promise<string> => {
        const iconPaths: Record<string, string> = {
            home: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M9 22V12h6v10',
            user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
            settings: 'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z M9 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
            heart: 'M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z',
            star: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z',
            search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M21 21l-4.35-4.35',
            mail: 'M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z M22 6l-10 7L2 6',
            phone: 'M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z',
            calendar: 'M19 3h-1V1h-2v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11z M7 10h5v5H7z',
            camera: 'M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z M14 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
            edit: 'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7 M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z',
            trash: 'M3 6h18 M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2',
            plus: 'M12 5v14m7-7H5',
            minus: 'M5 12h14',
            checkIcon: 'M20 6L9 17l-5-5',
            x: 'M18 6L6 18M6 6l12 12',
            zap: 'M13 2L3 14h9l-1 8 10-12h-9l1-8z',
            refreshCw: 'M23 4v6h-6M1 20v-6h6 M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15',
            move: 'M5 9l-3-3 3-3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3-3-3-3M12 19l3-3-3-3M12 5l3-3-3-3M1 12h22M12 1v22',
            rotateCcw: 'M1 4v6h6M3.51 15a9 9 0 1 0 2.13-9.36L1 10',
            save: 'M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z M17 21v-8H7v8 M7 3v5h8',
            paintbrush: 'M9.06 15.54A2 2 0 0 1 8 17.25v3.27a1 1 0 0 1-.7.96 9 9 0 0 1-5.3 0 1 1 0 0 1-.7-.96v-3.27a2 2 0 0 1 .53-1.37l5.83-6.54a2 2 0 0 1 2.77 0l5.83 6.54a2 2 0 0 1 .53 1.37v3.27a1 1 0 0 1-.7.96 9 9 0 0 1-5.3 0 1 1 0 0 1-.7-.96v-3.27a2 2 0 0 1-.53-1.37z',
            ruler: 'M21.3 8.7l-5.6-5.6a1 1 0 0 0-1.4 0l-9.6 9.6a1 1 0 0 0 0 1.4l5.6 5.6a1 1 0 0 0 1.4 0l9.6-9.6a1 1 0 0 0 0-1.4z M7.5 10.5l2 2 M13.5 7.5l2 2 M10.5 13.5l2 2 M16.5 10.5l2 2',
            image: 'M21 19V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2z M8.5 13.5l2.5 3.01L14.5 12l4.5 6H5z',
            // Iconos adicionales
            activity: 'M22 12h-4l-3 9L9 3l-3 9H2',
            alertCircle: 'M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z M12 8v4 M12 16h.01',
            archive: 'M21 8v13H3V8 M1 3h22v5H1z M10 12h4',
            arrowDown: 'M12 5v14M19 12l-7 7-7-7',
            arrowLeft: 'M19 12H5M12 19l-7-7 7-7',
            arrowRight: 'M5 12h14M12 5l7 7-7 7',
            arrowUp: 'M12 19V5M5 12l7-7 7 7',
            atSign: 'M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94 M12 12h.01',
            award: 'M12 15l-3-3 3-3 3 3-3 3z M4.5 12.5l3-3 3 3-3 3z',
            bell: 'M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9 M13.73 21a2 2 0 0 1-3.46 0',
            bookmark: 'M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z',
            check: 'M20 6L9 17l-5-5',
            chevronDown: 'M6 9l6 6 6-6',
            chevronLeft: 'M15 18l-6-6 6-6',
            chevronRight: 'M9 18l6-6-6-6',
            chevronUp: 'M18 15l-6-6-6 6',
            circle: 'M12 12m-10 0a10 10 0 1 0 20 0a10 10 0 1 0 -20 0',
            clipboard: 'M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2 M15 2H9a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1z',
            clock: 'M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z M12 6v6l4 2',
            cloud: 'M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z',
            code: 'M16 18l6-6-6-6M8 6l-6 6 6 6',
            command: 'M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3z M3 21a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3 3 3 0 0 1-3 3H6a3 3 0 0 1-3-3z',
            creditCard: 'M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 0 0 3-3V8a3 3 0 0 0-3-3H6a3 3 0 0 0-3 3v8a3 3 0 0 0 3 3z',
            database: 'M12 8c-1.657 0-3-.895-3-2s1.343-2 3-2 3 .895 3 2-1.343 2-3 2z M12 14c-1.657 0-3-.895-3-2s1.343-2 3-2 3 .895 3 2-1.343 2-3 2z M12 20c-1.657 0-3-.895-3-2s1.343-2 3-2 3 .895 3 2-1.343 2-3 2z M6 8h12M6 14h12M6 20h12',
            disc: 'M12 12m-10 0a10 10 0 1 0 20 0a10 10 0 1 0 -20 0 M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0',
            download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M7 10l5 5 5-5 M12 15V3',
            externalLink: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6 M15 3h6v6 M10 14L21 3',
            facebook: 'M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z',
            file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M16 13H8 M16 17H8 M10 9H8',
            filter: 'M22 3H2l8 9.46V19l4 2v-8.54L22 3z',
            flag: 'M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z M4 22v-7',
            folder: 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z',
            gift: 'M20 7h-4a2 2 0 0 0-2 2v1a2 2 0 0 0 2 2h4v1h-4a2 2 0 0 0-2 2v1a2 2 0 0 0 2 2h4 M12 8v13 M15 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 1 0 0-5z M9 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 1 0 0-5z',
            github: 'M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22',
            globe: 'M21 12a9 9 0 0 1-9 9m9-9a9 9 0 0 0-9-9m9 9H3m9 9a9 9 0 0 1-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 0 1 9-9',
            grid: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
            hardDrive: 'M22 12H2M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z M6 16h.01 M10 16h.01',
            hash: 'M4 8h16M4 16h16M10 3L8 21M16 3l-2 18',
            headphones: 'M3 18v-6a9 9 0 0 1 18 0v6 M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3z M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z',
            inbox: 'M22 12h-6l-2 3h-4l-2-3H2 M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z',
            info: 'M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z M12 16v-4 M12 8h.01',
            instagram: 'M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z M17.5 6.5h.01',
            key: 'M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4',
            layers: 'M12 2L2 7l10 5 10-5-10-5z M2 17l10 5 10-5M2 12l10 5 10-5',
            lifeBuoy: 'M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M4.93 4.93l4.24 4.24M14.83 14.83l4.24 4.24M4.93 19.07l4.24-4.24M14.83 9.17l4.24-4.24',
            link: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71 M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
            linkedin: 'M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z M2 9h4v12H2z M4 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
            list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
            lock: 'M18 11h-1a4 4 0 0 0-4 4v5a4 4 0 0 0 4 4h1a4 4 0 0 0 4-4v-5a4 4 0 0 0-4-4z M7 11V7a5 5 0 0 1 10 0v4',
            logIn: 'M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4 M10 17l5-5-5-5 M15 12H3',
            logOut: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4 M16 17l5-5-5-5 M21 12H9',
            map: 'M1 6v16l7-4 8 4 7-4V2l-7 4-8-4-7 4z M8 2v16M16 6v16',
            menu: 'M3 12h18M3 6h18M3 18h18',
            messageCircle: 'M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z',
            messageSquare: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
            mic: 'M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z M19 10v2a7 7 0 0 1-14 0v-2 M12 19v4 M8 23h8',
            monitor: 'M5 3h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z M12 17v4 M8 21h8',
            moon: 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z',
            moreHorizontal: 'M12 12h.01M19 12h.01M5 12h.01',
            moreVertical: 'M12 12h.01M12 19h.01M12 5h.01',
            mousePointer: 'M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z M13 13l6 6',
            music: 'M9 18V5l12-2v13 M6 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6z M18 13a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
            navigation: 'M3 11l19-9-9 19-2-8-8-2z',
            package: 'M12.89 1.45l8 4A2 2 0 0 1 22 7.24v9.53a2 2 0 0 1-1.11 1.79l-8 4a2 2 0 0 1-1.78 0l-8-4a2 2 0 0 1-1.1-1.8V7.24a2 2 0 0 1 1.11-1.81l8-4a2 2 0 0 1 1.78 0z M2.32 6.16L12 11l9.68-4.84 M12 22.76V11',
            paperclip: 'M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48',
            pause: 'M6 4h4v16H6z M14 4h4v16h-4z',
            penTool: 'M12 19l7-7 3 3-7 7-3-3z M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z M2 2l7.586 7.586 M13 11l7 7',
            play: 'M5 3l14 9-14 9V3z',
            power: 'M18.36 6.64a9 9 0 1 1-12.73 0 M12 2v10',
            printer: 'M6 9V2h12v7 M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2 M6 14h12v8H6z',
            qrCode: 'M3 3h8v8H3z M13 3h8v8h-8z M3 13h8v8H3z M16 13h3 M16 16h3 M19 13v3 M19 16v3',
            repeat: 'M17 1l4 4-4 4 M21 5H11a4 4 0 0 0-4 4v14 M7 23l-4-4 4-4 M3 19h10a4 4 0 0 0 4-4V1',
            rss: 'M4 11a9 9 0 0 1 9 9 M4 4a16 16 0 0 1 16 16 M5 20.01h.01',
            scissors: 'M6 9a3 3 0 0 1 3-3h5a3 3 0 0 1 3 3v.01M6 9a3 3 0 0 0 3 3h5a3 3 0 0 0 3-3v.01 M6 20l4.01-4.01M10 14l-4.01 4.01',
            send: 'M22 2L11 13 M22 2l-7 20-4-9-9-4 20-7z',
            share: 'M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8 M16 6l-4-4-4 4 M12 2v13',
            shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
            shoppingBag: 'M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z M3 6h18 M16 10a4 4 0 0 1-8 0',
            shoppingCart: 'M9 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M19 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6',
            sun: 'M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41',
            tag: 'M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z M7 7h.01',
            target: 'M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41 M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z',
            terminal: 'M4 7l6 6-6 6 M12 19h8',
            thumbsDown: 'M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17',
            thumbsUp: 'M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3',
            toggleLeft: 'M16 5H9a4 4 0 0 0 0 8h7 M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
            toggleRight: 'M16 5H9a4 4 0 0 0 0 8h7 M15 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
            trendingDown: 'M23 18l-9.5-9.5-5 5L1 6 M17 18h6v-6',
            trendingUp: 'M23 6l-9.5 9.5-5-5L1 18 M17 6h6v6',
            truck: 'M1 3h15v13H1z M16 8h4l3 3v5h-7V8z M5 18a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M15 18a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
            tv: 'M21 3H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h5l-1 4h2l-1-4h8c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z',
            twitter: 'M23 3a10.9 10.9 0 0 1-3.14 1.53 4.48 4.48 0 0 0-7.86 3v1A10.66 10.66 0 0 1 3 4s-4 9 5 13a11.64 11.64 0 0 1-7 2c9 5 20 0 20-11.5a4.5 4.5 0 0 0-.08-.83A7.72 7.72 0 0 0 23 3z',
            umbrella: 'M23 12a11.05 11.05 0 0 0-22 0zm-5 7a3 3 0 0 1-6 0v-7',
            unlock: 'M7 11V7a5 5 0 0 1 9.9-1 M12 11h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z',
            upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M17 8l-5-5-5 5 M12 3v12',
            users: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M23 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75',
            video: 'M23 7l-7 5 7 5V7z M14 5H3a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2z',
            voicemail: 'M5.5 12a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0z M12 12h.01 M19 12h.01',
            volume1: 'M11 5L6 9H2v6h4l5 4V5z M15.54 8.46a5 5 0 0 1 0 7.07',
            volume2: 'M11 5L6 9H2v6h4l5 4V5z M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07',
            volumeX: 'M11 5L6 9H2v6h4l5 4V5z M23 9l-6 6M17 9l6 6',
            wallet: 'M21 12V7H5a2 2 0 0 1 2-2h12v4 M3 5v14a2 2 0 0 0 2 2h16v-5 M18 12a2 2 0 0 0 0 4',
            watch: 'M12 18h.01 M8 21h8a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2z',
            wifi: 'M5 12.55a11 11 0 0 1 5.17-2.39 M1.42 9a16 16 0 0 1 21.16 0 M8.53 16.11a6 6 0 0 1 6.95 0 M12 20h.01',
            youtube: 'M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.42a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19c1.72.42 8.6.42 8.6.42s6.88 0 8.6-.42a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.33z M9.75 15.02V8.98l6.22 3.02-6.22 3.02z',
            zoomIn: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M21 21l-4.35-4.35 M11 8v6 M8 11h6',
            zoomOut: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M21 21l-4.35-4.35 M8 11h6',
            };

        // Forze using the latest template to ensure the latest logic (e.g. icon hiding, property naming)
        return generateZeusIconScript(iconPaths, iconProperties, new Date().toLocaleString('es-ES'));
    };

    // Helper to convert hex to rgba
    const hexToRgba = (hex: string, alpha: number): string => {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    };

    // Generate configuration file
    const generateConfigFile = (): string => {
        const config = {
            version: '1.0.0',
            generatedAt: new Date().toISOString(),
            projectName: projectName,
            projectPath: projectPath,
            components: Object.entries(componentProperties).map(([componentId, props]) => {
                // Intentar encontrar el componente en el árbol, pero no es obligatorio
                const component = findComponentById(components, componentId);
                return {
                    id: componentId,
                    name: component?.name || componentId.substring(0, 30) || 'Unknown',
                    type: component?.type || 'custom',
                    properties: props
                };
            })
        };
        
        return `// Configuración generada por zeus Studio\n` +
               `// Fecha: ${new Date().toLocaleString('es-ES')}\n\n` +
               `export const componentStyles = ${JSON.stringify(config, null, 2)};\n`;
    };

    // Function to add CSS import to layout file
    const addCSSImportToLayout = async (directoryHandle: FileSystemDirectoryHandle | null) => {
        if (!directoryHandle) return false;
        
        try {
            // Try to find and modify layout.tsx files
            const layoutPaths = [
                'app/layout.tsx',
                'app/layout.js',
                'src/app/layout.tsx',
                'src/app/layout.js',
                'pages/_app.tsx',
                'pages/_app.js',
                'src/pages/_app.tsx',
                'src/pages/_app.js'
            ];
            
            for (const layoutPath of layoutPaths) {
                try {
                    const pathParts = layoutPath.split('/');
                    let currentHandle: FileSystemDirectoryHandle = directoryHandle;
                    
                    // Navigate through directories
                    for (let i = 0; i < pathParts.length - 1; i++) {
                        try {
                            currentHandle = await currentHandle.getDirectoryHandle(pathParts[i]);
                        } catch {
                            // Directory doesn't exist, skip this path
                            break;
                        }
                    }
                    
                    // Try to get the file
                    const fileName = pathParts[pathParts.length - 1];
                    try {
                        const fileHandle = await currentHandle.getFileHandle(fileName);
                        const file = await fileHandle.getFile();
                        let content = await file.text();
                        
                        // Check if import already exists
                        const importPattern = /import\s+['"]\.\.?\/.*zeus-styles\.css['"];?/;
                        if (importPattern.test(content)) {
                            console.log(`[addCSSImportToLayout] ✅ Import already exists in ${layoutPath}`);
                            return true; // Return true since import already exists
                        }
                        
                        console.log(`[addCSSImportToLayout] 📝 File found: ${layoutPath}, adding import...`);
                        
                        // Determine the correct import path based on file location
                        // Count directory depth to calculate relative path
                        const depth = pathParts.length - 1; // Number of directories
                        let importPath = './zeus-styles.css';
                        if (depth === 1) {
                            // app/layout.tsx or pages/_app.tsx -> ../zeus-styles.css
                            importPath = '../zeus-styles.css';
                        } else if (depth === 2) {
                            // src/app/layout.tsx or src/pages/_app.tsx -> ../../zeus-styles.css
                            importPath = '../../zeus-styles.css';
                        }
                        
                        // Add import always at line 3 (index 2) - simple and predictable
                        const importStatement = `import '${importPath}';`;
                        
                        const lines = content.split('\n');
                        
                        // Always insert at line 3 (index 2)
                        // This ensures it's after "use client" (line 1) and after first import (line 2) if they exist
                        // If file is shorter, it will be added at the end
                        const insertIndex = Math.min(2, lines.length);
                        
                        // Insert the import at line 3
                        lines.splice(insertIndex, 0, importStatement);
                        
                        const newContent = lines.join('\n');
                        
                        // Write back to file
                        const writable = await fileHandle.createWritable();
                        await writable.write(newContent);
                        await writable.close();
                        
                        console.log(`[addCSSImportToLayout] ✅ Successfully added import to ${layoutPath} at line 3`);
                        console.log(`[addCSSImportToLayout] Import statement: ${importStatement}`);
                        return true;
                    } catch (fileError) {
                        // File doesn't exist, try next path
                        console.log(`[addCSSImportToLayout] ⚠️ File not found: ${layoutPath}, trying next...`);
                        continue;
                    }
                } catch (error) {
                    // Error accessing this path, try next
                    console.log(`[addCSSImportToLayout] ⚠️ Error accessing path ${layoutPath}:`, error);
                    continue;
                }
            }
            
            return false;
        } catch (error) {
            console.error('[addCSSImportToLayout] Error:', error);
            return false;
        }
    };

    const addJSImportToLayout = async (directoryHandle: FileSystemDirectoryHandle | null) => {
        if (!directoryHandle) return false;
        
        try {
            // Try to find and modify layout.tsx files
            const layoutPaths = [
                'app/layout.tsx',
                'app/layout.js',
                'src/app/layout.tsx',
                'src/app/layout.js',
                'pages/_app.tsx',
                'pages/_app.js',
                'src/pages/_app.tsx',
                'src/pages/_app.js'
            ];
            
            for (const layoutPath of layoutPaths) {
                try {
                    const pathParts = layoutPath.split('/');
                    let currentHandle: FileSystemDirectoryHandle = directoryHandle;
                    
                    // Navigate through directories
                    for (let i = 0; i < pathParts.length - 1; i++) {
                        try {
                            currentHandle = await currentHandle.getDirectoryHandle(pathParts[i]);
                        } catch {
                            // Directory doesn't exist, skip this path
                            break;
                        }
                    }
                    
                    // Try to get the file
                    const fileName = pathParts[pathParts.length - 1];
                    try {
                        const fileHandle = await currentHandle.getFileHandle(fileName);
                        const file = await fileHandle.getFile();
                        let content = await file.text();
                        
                        // Check if import already exists
                        const importPattern = /import\s+['"]\.\.?\/.*zeus-icons\.js['"];?/;
                        if (importPattern.test(content)) {
                            console.log(`[addJSImportToLayout] ✅ Import already exists in ${layoutPath}`);
                            return true; // Return true since import already exists
                        }
                        
                        console.log(`[addJSImportToLayout] 📝 File found: ${layoutPath}, adding import...`);
                        
                        // Determine the correct import path based on file location
                        // Count directory depth to calculate relative path
                        const depth = pathParts.length - 1; // Number of directories
                        let importPath = './zeus-icons.js';
                        if (depth === 1) {
                            // app/layout.tsx or pages/_app.tsx -> ../zeus-icons.js
                            importPath = '../zeus-icons.js';
                        } else if (depth === 2) {
                            // src/app/layout.tsx or src/pages/_app.tsx -> ../../zeus-icons.js
                            importPath = '../../zeus-icons.js';
                        }
                        
                        // Add import always at line 4 (index 3) - same logic as CSS import
                        // This ensures it's after "use client" (line 1) and after first imports (lines 2-3)
                        const importStatement = `import '${importPath}';`;
                        const lines = content.split('\n');
                        
                        // Always insert at line 4 (index 3) - same as CSS import logic
                        // This ensures it's after "use client" (line 1) and after first import (line 2) if they exist
                        // If file is shorter, it will be added at the end
                        const insertIndex = Math.min(3, lines.length);
                        
                        // Insert the import at line 4
                        lines.splice(insertIndex, 0, importStatement);
                        
                        const newContent = lines.join('\n');
                        
                        // Write back to file
                        const writable = await fileHandle.createWritable();
                        await writable.write(newContent);
                        await writable.close();
                        
                        console.log(`[addJSImportToLayout] ✅ Successfully added import to ${layoutPath} at line ${insertIndex + 1}`);
                        console.log(`[addJSImportToLayout] Import statement: ${importStatement}`);
                        return true;
                    } catch (fileError) {
                        // File doesn't exist, try next path
                        console.log(`[addJSImportToLayout] ⚠️ File not found: ${layoutPath}, trying next...`);
                        continue;
                    }
                } catch (error) {
                    // Error accessing this path, try next
                    console.log(`[addJSImportToLayout] ⚠️ Error accessing path ${layoutPath}:`, error);
                    continue;
                }
            }
            
            return false;
        } catch (error) {
            console.error('[addJSImportToLayout] Error:', error);
            return false;
        }
    };

    // Save individual file based on project type
    // Function to refresh project files state after external changes
    const refreshProjectFiles = useCallback(async () => {
        console.log('[refreshProjectFiles] 🔄 Actualizando estado de archivos del proyecto');
        
        // For database/Zeus projects, we need to reload from PocketBase
        const projectSource = getProjectSource();
        const projectId = getCurrentProjectId();

        console.log('[refreshProjectFiles] 💾 Proyecto local, manteniendo estado actual');
    }, [getProjectSource, getCurrentProjectId]);

    const saveProjectFile = async (filePath: string, newContent: string): Promise<boolean> => {
        try {
            console.log('[saveProjectFile] 📝 Guardando archivo:', filePath, '| Contenido:', newContent?.length ?? 0, 'chars');

            // Detect project type
            const projectSource = getProjectSource();
            const projectId = getCurrentProjectId();
            
            console.log('[saveProjectFile] 📊 Tipo de proyecto:', projectSource);
            
            switch (projectSource) {
                case 'local':
                default:
                    // Para proyectos locales, usar la API /api/save-file para guardar directamente
                    console.log('[saveProjectFile] 💻 Proyecto local, guardando vía API...');
                    console.log('[saveProjectFile] 📄 filePath original:', filePath);
                    console.log('[saveProjectFile] 📏 newContent length:', newContent?.length ?? 0);

                    try {
                        if (!newContent || newContent.length === 0) {
                            console.error('[saveProjectFile] ❌ newContent está vacío, abortando');
                            toast.error('El contenido del archivo está vacío. No se guardaron cambios.');
                            return false;
                        }

                        // Convertir ruta absoluta a relativa respecto al proyecto
                        let relativeFilePath = filePath;
                        if (projectPath && filePath.toLowerCase().startsWith(projectPath.toLowerCase())) {
                            relativeFilePath = filePath.substring(projectPath.length).replace(/^[\\\/]/, '');
                            console.log('[saveProjectFile] 🗺️ Convertido a ruta relativa:', relativeFilePath);
                        } else if (filePath.includes(':\\')) {
                            // Es una ruta absoluta de Windows pero no está bajo projectPath
                            // Intentar extraer solo la parte relativa conocida (ej: components/home/...)
                            const parts = filePath.split(/[\\\/]/);
                            const knownFolders = ['app', 'pages', 'components', 'src', 'lib', 'public', 'styles'];
                            const knownIndex = parts.findIndex(p => knownFolders.includes(p.toLowerCase()));
                            if (knownIndex !== -1) {
                                relativeFilePath = parts.slice(knownIndex).join('/');
                                console.log('[saveProjectFile] 🗺️ Extraída ruta relativa:', relativeFilePath);
                            }
                        }

                        const saveResponse = await fetch('/api/save-file', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                filePath: relativeFilePath,
                                content: newContent
                            })
                        });

                        const saveResult = await saveResponse.json();

                        if (!saveResponse.ok || !saveResult.success) {
                            throw new Error(saveResult.error || `Error ${saveResponse.status}`);
                        }

                        console.log('[saveProjectFile] ✅ Archivo guardado vía API:', saveResult.path);

                        // Actualizar el estado local del archivo
                        setProjectFiles(prev => {
                            const newMap = new Map(prev);
                            newMap.set(filePath, newContent);
                            return newMap;
                        });

                        toast.success(`✅ ${relativeFilePath} guardado`);
                        return true;
                    } catch (error: any) {
                        console.error('[saveProjectFile] ❌ Error al guardar archivo local:', error);
                        toast.error(`Error al guardar: ${error.message}`);
                        return false;
                    }
            }
        } catch (error: any) {
            console.error('[saveProjectFile] ❌ Error general:', error);
            toast.error(`Error al guardar archivo: ${error.message}`);
            return false;
        }
    };

    // Save file using File System Access API or download fallback
    const saveFile = async (content: string, filename: string, mimeType: string) => {
        try {
            console.log(`[saveFile] Attempting to save ${filename}, content length: ${content.length}`);
            
            // If we have a directory handle, save directly to project root
            if (projectDirectoryHandle) {
                try {
                    console.log(`[saveFile] Using directory handle to save ${filename}`);
                    
                    // Check if file already exists and we're saving CSS
                    let finalContent = content;
                    if (filename === 'zeus-styles.css') {
                        try {
                            // Try to get existing file
                            const existingFileHandle = await projectDirectoryHandle.getFileHandle(filename);
                            const existingFile = await existingFileHandle.getFile();
                            const existingContent = await existingFile.text();
                            
                            // Merge existing content with new content
                            finalContent = mergeCssContent(existingContent, content);
                            console.log(`[saveFile] 🔄 Merged existing CSS with new content`);
                            console.log(`[saveFile] 📊 Existing: ${existingContent.length} chars, New: ${content.length} chars, Final: ${finalContent.length} chars`);
                        } catch (getFileError) {
                            // File doesn't exist yet, use new content
                            console.log(`[saveFile] 🆕 CSS file doesn't exist yet, creating new file`);
                            finalContent = content;
                        }
                    }
                    
                    const fileHandle = await projectDirectoryHandle.getFileHandle(filename, { create: true });
                    const writable = await fileHandle.createWritable();
                    await writable.write(finalContent);
                    await writable.close();
                    console.log(`[saveFile] ✅ Successfully saved ${filename} to project directory`);
                    return true;
                } catch (error: any) {
                    console.error(`[saveFile] ❌ Error saving to project directory:`, error);
                    // Fall through to showSaveFilePicker
                }
            } else {
                console.log(`[saveFile] No directory handle available, will use save dialog`);
            }

            // Try File System Access API (Chrome/Edge)
            // IMPORTANTE: showSaveFilePicker requiere activación del usuario
            // Si no está disponible o falla, usar el fallback de descarga
            if ('showSaveFilePicker' in window) {
                try {
                    console.log(`[saveFile] Using showSaveFilePicker for ${filename}`);
                    // @ts-ignore - File System Access API
                    const fileHandle = await window.showSaveFilePicker({
                        suggestedName: filename,
                        // Note: startIn only accepts WellKnownDirectory values like 'documents', 'downloads', 'desktop', etc.
                        // We can't use projectPath directly here
                        types: [{
                            description: mimeType.includes('css') ? 'CSS File' : 'JavaScript File',
                            accept: { [mimeType]: [`.${filename.split('.').pop()}`] }
                        }]
                    });
                    
                    const writable = await fileHandle.createWritable();
                    await writable.write(content);
                    await writable.close();
                    console.log(`[saveFile] ✅ Successfully saved ${filename} via save dialog`);
                    return true;
                } catch (pickerError: any) {
                    // Si showSaveFilePicker falla (por ejemplo, requiere activación del usuario),
                    // usar el fallback de descarga
                    if (pickerError.name === 'SecurityError' || pickerError.message?.includes('activación del usuario')) {
                        console.warn(`[saveFile] ⚠️ showSaveFilePicker requiere activación del usuario, usando fallback de descarga`);
                    } else {
                        console.warn(`[saveFile] ⚠️ Error con showSaveFilePicker:`, pickerError);
                    }
                    // Fall through to download fallback
                }
            }
            
            // Fallback: download file (siempre disponible)
            {
                console.log(`[saveFile] Using download fallback for ${filename}`);
                // Fallback: download file
                const blob = new Blob([content], { type: mimeType });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                console.log(`[saveFile] ✅ Triggered download for ${filename}`);
                return true;
            }
        } catch (error: any) {
            // User cancelled or error occurred
            if (error.name !== 'AbortError') {
                console.error('Error saving file:', error);
                throw error;
            }
            return false;
        }
    };

    const handleSaveChanges = async () => {
        setIsSaving(true);
        try {
            console.log('[handleSaveChanges] 🚀 Iniciando guardado de cambios...');
            console.log('[handleSaveChanges] Component properties antes de limpiar:', Object.keys(componentProperties).length);
            
            // Minimum delay to show loading animation (at least 500ms)
            const minDelay = new Promise(resolve => setTimeout(resolve, 500));
            
            // Clean up obsolete component properties before saving
            console.log('[handleSaveChanges] 🧹 INICIANDO LIMPIEZA DE PROPIEDADES...');
            console.log('[handleSaveChanges] 📊 Antes de limpiar:', {
                totalComponents: Object.keys(componentProperties).length,
                componentIds: Object.keys(componentProperties),
                componentDetails: Object.entries(componentProperties).map(([id, props]) => ({
                    id,
                    hasSize: !!props.size,
                    hasPosition: props.size ? {
                        positionX: props.size.positionX,
                        positionY: props.size.positionY
                    } : null
                }))
            });
            
            const cleanedComponentProperties = await cleanObsoleteComponentProperties(componentProperties);
            
            console.log('[handleSaveChanges] 📊 Después de limpiar:', {
                totalComponents: Object.keys(cleanedComponentProperties).length,
                componentIds: Object.keys(cleanedComponentProperties),
                componentDetails: Object.entries(cleanedComponentProperties).map(([id, props]) => ({
                    id,
                    hasSize: !!props.size,
                    hasPosition: props.size ? {
                        positionX: props.size.positionX,
                        positionY: props.size.positionY
                    } : null
                }))
            });
            
            setComponentProperties(cleanedComponentProperties); // Update state with cleaned properties
            console.log('[handleSaveChanges] Component properties después de limpiar:', Object.keys(cleanedComponentProperties).length);
            
            // Save to localStorage with cleaned properties
            const dataToSave = {
                components: components,
                projectPath: projectPath,
                projectName: projectName,
                componentProperties: cleanedComponentProperties, // Save cleaned properties
                devServerUrl: devServerUrl,
                savedAt: new Date().toISOString()
            };
            
            localStorage.setItem('zeus-studio-data', JSON.stringify(dataToSave));
            console.log('[handleSaveChanges] ✅ Datos guardados en localStorage');

            // --- Generar CSS y JS antes de la lógica condicional de guardado ---
            let cssContentForExternal = '';
            let jsContent: string | null = null;
            // --- FIN Declaraciones de CSS y JS ---
            
            // All projects are local now
            const isDatabaseProject = false;
            const isZeusProject = false;
            const isGithubProject = false;
            const directoryHandle = projectDirectoryHandle;
            console.log('[handleSaveChanges] 📁 Proyecto local detectado, se guardará vía API directa');
            
            // Generate and save CSS file - USAR PROPIEDADES LIMPIADAS
            if (Object.keys(cleanedComponentProperties).length > 0) {
                console.log('[handleSaveChanges] 📝 Generando CSS con propiedades limpiadas...');
                
                // 🔥 CRÍTICO: Asegurar que todos los componentes tengan data-id ANTES de generar CSS
                console.log('[handleSaveChanges] 🔍 Asegurando data-id para todos los componentes antes de guardar...');
                await ensureAllComponentIds();
                
                // Esperar un momento adicional para que los data-id se apliquen completamente
                await new Promise(resolve => setTimeout(resolve, 200));
                
                // Temporalmente reemplazar componentProperties con cleanedComponentProperties para generateCSS
                const originalComponentProperties = componentProperties;
                setComponentProperties(cleanedComponentProperties);
                
                // Pequeño delay para asegurar que el estado se actualice
                await new Promise(resolve => setTimeout(resolve, 50));
                
                const cssContent = generateCSS();
                
                // Generar CSS adicional para fuera del editor (con texto)
                let cssContentForExternal = cssContent;
                if (window.zeusTextForCSS && Object.keys(window.zeusTextForCSS).length > 0) {
                    console.log('[handleSaveChanges] 📝 Generando CSS adicional para fuera del editor:', window.zeusTextForCSS);
                    
                    // Agregar CSS con ::before para cada texto
                    Object.entries(window.zeusTextForCSS).forEach(([componentId, textContent]) => {
                        // Obtener las propiedades del componente para aplicar estilos correctos
                        const props = componentProperties[componentId];
                        if (props?.typography) {
                            const textType = props.typography.textType || 'solid';
                            const escapedText = textContent
                                .replace(/\\/g, '\\\\')
                                .replace(/"/g, '\\"')
                                .replace(/'/g, "\\'")
                                .replace(/\n/g, '\\A')
                                .replace(/\r/g, '');
                            
                            // Agregar CSS con ::before al final del CSS existente
                            console.log('[handleSaveChanges] 🔍 Debug fontFamily para', componentId, ':', props.typography.fontFamily);
                            cssContentForExternal += `\n[data-component-id="${componentId}"] {\n`;
                            cssContentForExternal += `  /* Reemplazar contenido de texto */\n`;
                            cssContentForExternal += `  position: relative !important;\n`;
                            cssContentForExternal += `  /* Ocultar texto original completamente */\n`;
                            cssContentForExternal += `  font-size: 0 !important;\n`;
                            cssContentForExternal += `  line-height: 0 !important;\n`;
                            cssContentForExternal += `  color: transparent !important;\n`;
                            cssContentForExternal += `  text-shadow: none !important;\n`;
                            cssContentForExternal += `  /* Ocultar completamente el contenido original */\n`;
                            cssContentForExternal += `  overflow: hidden !important;\n`;
                            cssContentForExternal += `  text-indent: -9999px !important;\n`;
                            cssContentForExternal += `}\n`;
                            cssContentForExternal += `[data-component-id="${componentId}"]::before {\n`;
                            cssContentForExternal += `  /* Mostrar nuevo texto con ::before */\n`;
                            cssContentForExternal += `  content: "${escapedText}" !important;\n`;
                            cssContentForExternal += `  position: absolute !important;\n`;
                            cssContentForExternal += `  top: 0 !important;\n`;
                            cssContentForExternal += `  left: 0 !important;\n`;
                            cssContentForExternal += `  width: 100% !important;\n`;
                            cssContentForExternal += `  height: 100% !important;\n`;
                            cssContentForExternal += `  display: ${props.typography.alignment === 'center' ? 'flex' : 'block'} !important;\n`;
                            cssContentForExternal += `  align-items: center !important;\n`;
                            cssContentForExternal += `  justify-content: ${props.typography.alignment === 'center' ? 'center' : props.typography.alignment === 'right' ? 'flex-end' : 'flex-start'} !important;\n`;
                            cssContentForExternal += `  text-align: ${props.typography.alignment || 'left'} !important;\n`;
                            cssContentForExternal += `  color: ${textType === 'gradient' ? 'transparent' : (props.typography.color || '#ffffff')} !important;\n`;
                            cssContentForExternal += `  font-family: ${props.typography.fontFamily || 'Inter'} !important;\n`;
                            console.log('[handleSaveChanges] 🔍 CSS fontFamily generado:', props.typography.fontFamily || 'Inter');
                            cssContentForExternal += `  font-size: ${props.typography.fontSize || 16}px !important;\n`;
                            cssContentForExternal += `  font-weight: ${props.typography.fontWeight || 400} !important;\n`;
                            cssContentForExternal += `  line-height: ${props.typography.lineHeight || 1.5} !important;\n`;
                            cssContentForExternal += `  white-space: ${textContent.includes(' ') ? 'normal' : 'nowrap'} !important;\n`;
                            cssContentForExternal += `  z-index: 1 !important;\n`;
                            cssContentForExternal += `  text-indent: 0 !important;\n`;
                            
                            // Aplicar gradiente si es necesario
                            if (textType === 'gradient' && props.typography.textGradient) {
                                cssContentForExternal += `    background: ${props.typography.textGradient} !important;\n`;
                                cssContentForExternal += `    -webkit-background-clip: text !important;\n`;
                                cssContentForExternal += `    background-clip: text !important;\n`;
                            }
                            
                            cssContentForExternal += `}\n`;
                        }
                    });
                    
                    console.log('[handleSaveChanges] ✅ CSS para fuera del editor generado con texto');
                }
                
                // Enviar mensajes de actualización de texto al iframe del editor si hay textos guardados
                if (window.zeusTextUpdates && Object.keys(window.zeusTextUpdates).length > 0) {
                    console.log('[handleSaveChanges] 📝 Enviando actualizaciones de texto al iframe del editor:', window.zeusTextUpdates);
                    
                    // Convertir a formato de array para updateTextContents
                    const textUpdates = Object.entries(window.zeusTextUpdates).map(([componentId, newText]) => ({
                        componentId,
                        textContent: newText
                    }));
                    
                    console.log('[handleSaveChanges] 📤 Formato de actualizaciones:', textUpdates);
                    
                    // Enviar mensaje al iframe con el formato correcto
                    setTimeout(() => {
                        console.log('[handleSaveChanges] 🚀 Enviando mensaje updateTextContents al iframe:', {
                            type: 'updateTextContents',
                            updates: textUpdates
                        });
                        
                        window.postMessage({
                            type: 'updateTextContents',
                            updates: textUpdates
                        }, '*');
                        
                        console.log('[handleSaveChanges] ✅ Mensaje enviado al iframe');
                    }, 100);
                    
                    // Limpiar las actualizaciones después de enviarlas
                    window.zeusTextUpdates = {};
                } else {
                    console.log('[handleSaveChanges] ℹ️ No hay actualizaciones de texto para enviar al iframe');
                }
                
                // Restaurar propiedades originales si es necesario
                setComponentProperties(originalComponentProperties);
                
                console.log('[handleSaveChanges] ✅ CSS generado - Longitud:', cssContentForExternal.length, 'caracteres');
                console.log('[handleSaveChanges] 📊 Componentes con propiedades limpiadas:', Object.keys(cleanedComponentProperties).length);
                console.log('[handleSaveChanges] 📄 Vista previa CSS (primeros 500 caracteres):', cssContentForExternal.substring(0, 500));
                
                if (cssContentForExternal.length === 0 || cssContentForExternal.trim().length < 100) {
                    console.warn('[handleSaveChanges] ⚠️ CSS generado está vacío o muy corto. Puede haber un problema.');
                    toast.warning('El CSS generado está vacío. Verifica que hayas aplicado cambios a los componentes.');
                }
                
                // Generar y guardar archivo JavaScript para iconos
                const iconProperties: Record<string, any> = {};
                Object.entries(cleanedComponentProperties).forEach(([componentId, props]: [string, any]) => {
                    if (props && props.icon) {
                        const { name, size, color, strokeWidth } = props.icon;

                        // Solo persistir iconos cuando el usuario seleccionó uno
                        if (name) {
                            iconProperties[componentId] = {
                                name,
                                size: size ?? 20,
                                color: color ?? '#000000',
                                strokeWidth: strokeWidth ?? 2,
                            };
                        }
                    }
                });
                
                let jsContent: string | null = null;
                let jsSaved = true;
                if (Object.keys(iconProperties).length > 0) {
                    console.log('[handleSaveChanges] 📝 Generando JavaScript para iconos...');
                    jsContent = await generateIconScript(iconProperties);
                    console.log('[handleSaveChanges] ✅ JavaScript generado - Longitud:', jsContent.length, 'caracteres');
                    console.log('[handleSaveChanges] 📊 Componentes con iconos:', Object.keys(iconProperties).length);
                } else {
                    console.log('[handleSaveChanges] ℹ️ No hay iconos para guardar');
                }
                
                // If project is from database, Zeus, or GitHub, skip file system save and save directly to PocketBase
                let cssSaved = true;
                if (isDatabaseProject || isZeusProject || isGithubProject) { // MODIFICADO: Incluye isGithubProject
                    console.log('[handleSaveChanges] 📦 Proyecto de base de datos / Zeus / GitHub detectado, omitiendo guardado local de archivos');
                    console.log('[handleSaveChanges] 📦 Tipo:', isDatabaseProject ? 'Base de datos' : isZeusProject ? 'Zeus' : 'GitHub');
                    // Mark as saved since we'll save to PocketBase / GitHub
                    cssSaved = true;
                    jsSaved = true;
                    await minDelay; // Still wait for minimum delay
                } else {
                    console.log('[handleSaveChanges] 💾 Proyecto local, guardando archivos vía API...');
                    // Save files locally via API for non-database projects
                    console.log('[handleSaveChanges] 💾 Intentando guardar archivo CSS vía API...');
                    const cssSavePromise = saveProjectFile('zeus-styles.css', cssContentForExternal);

                    if (jsContent) {
                        const jsSavePromise = saveProjectFile('zeus-icons.js', jsContent);
                        jsSaved = await jsSavePromise;
                        console.log('[handleSaveChanges] 💾 Resultado del guardado JS:', jsSaved ? '✅ ÉXITO' : '❌ FALLÓ');
                    }

                    // Wait for both minimum delay and save operation
                    const [cssSavedResult] = await Promise.all([cssSavePromise, minDelay]);
                    cssSaved = cssSavedResult;
                }
                
                console.log('[handleSaveChanges] 💾 Resultado del guardado CSS:', cssSaved ? '✅ ÉXITO' : '❌ FALLÓ');
                
                // Verificar que el archivo CSS existe en la raíz del proyecto (solo para proyectos locales, no de base de datos)
                if (cssSaved && directoryHandle && !isDatabaseProject && !isZeusProject) {
                    try {
                        const cssFileHandle = await directoryHandle.getFileHandle('zeus-styles.css');
                        const cssFile = await cssFileHandle.getFile();
                        const savedContent = await cssFile.text();
                        console.log('[handleSaveChanges] ✅ Verificación: Archivo CSS existe en la raíz del proyecto');
                        console.log('[handleSaveChanges] 📄 Tamaño del archivo guardado:', cssFile.size, 'bytes');
                        console.log('[handleSaveChanges] 📄 Contenido del archivo (primeros 500 caracteres):', savedContent.substring(0, 500));
                        console.log('[handleSaveChanges] 📄 Contenido del archivo (últimos 200 caracteres):', savedContent.substring(Math.max(0, savedContent.length - 200)));
                        
                        // Verificar que el contenido guardado coincide con el generado
                        if (savedContent.trim() !== cssContentForExternal.trim()) {
                            console.warn('[handleSaveChanges] ⚠️ ADVERTENCIA: El contenido guardado no coincide con el generado');
                            console.warn('[handleSaveChanges] Generado:', cssContentForExternal.length, 'caracteres');
                            console.warn('[handleSaveChanges] Guardado:', savedContent.length, 'caracteres');
                        } else {
                            console.log('[handleSaveChanges] ✅ El contenido guardado coincide con el generado');
                        }
                        
                        // Verificar que hay estilos en el archivo
                        const styleCount = (savedContent.match(/\[data-component-id=/g) || []).length;
                        console.log('[handleSaveChanges] 📊 Selectores CSS encontrados en el archivo:', styleCount);
                        if (styleCount === 0) {
                            console.error('[handleSaveChanges] ❌ ERROR: El archivo CSS no contiene selectores. El archivo está vacío o corrupto.');
                            toast.error('❌ Error: El archivo CSS está vacío', {
                                description: 'El archivo se guardó pero no contiene estilos. Esto puede indicar un problema con la generación del CSS.',
                                duration: 10000,
                            });
                        }
                    } catch (verifyError) {
                        console.error('[handleSaveChanges] ⚠️ ADVERTENCIA: No se pudo verificar el archivo CSS en la raíz del proyecto:', verifyError);
                        toast.warning('⚠️ No se pudo verificar la ubicación del archivo CSS', {
                            description: 'El archivo se guardó, pero no se pudo verificar que esté en la raíz del proyecto. Asegúrate de que "zeus-styles.css" esté en la raíz (donde está package.json).',
                            duration: 10000,
                        });
                    }
                }
                
                if (cssSaved) {
                    // Config file generation removed - not used
                    // const configContent = generateConfigFile();
                    // await saveFile(
                    //     configContent,
                    //     'zeus-config.js',
                    //     'text/javascript'
                    // );
                    
                    // Try to automatically add CSS import to layout file (solo para proyectos locales, no de base de datos)
                    let importAdded = false;
                    let jsImportAdded = false;
                    if (directoryHandle && !isDatabaseProject && !isZeusProject) {
                        console.log('[handleSaveChanges] Attempting to add CSS import to layout file...');
                        try {
                            importAdded = await addCSSImportToLayout(directoryHandle);
                            
                            // Si hay iconos y se guardó el JS, también agregar la importación del JS
                            console.log('[handleSaveChanges] Checking if JS import should be added:', {
                                hasIcons: Object.keys(iconProperties).length > 0,
                                iconCount: Object.keys(iconProperties).length,
                                jsSaved: jsSaved,
                                shouldAdd: Object.keys(iconProperties).length > 0 && jsSaved
                            });
                            
                            if (Object.keys(iconProperties).length > 0 && jsSaved) {
                                console.log('[handleSaveChanges] ✅ Attempting to add JS import to layout file...');
                                try {
                                    jsImportAdded = await addJSImportToLayout(directoryHandle);
                                    console.log('[handleSaveChanges] ✅ JS import result:', jsImportAdded);
                                } catch (error) {
                                    console.error('[handleSaveChanges] ❌ Error adding JS import:', error);
                                }
                            } else {
                                console.log('[handleSaveChanges] ⚠️ JS import NOT added - conditions not met:', {
                                    hasIcons: Object.keys(iconProperties).length > 0,
                                    jsSaved: jsSaved
                                });
                            }
                            
                            if (importAdded) {
                                // Verificar que el archivo CSS realmente existe
                                try {
                                    const cssFileHandle = await directoryHandle.getFileHandle('zeus-styles.css');
                                    const cssFile = await cssFileHandle.getFile();
                                    console.log('[handleSaveChanges] ✅ Verificación: Archivo CSS existe en la raíz del proyecto');
                                    console.log('[handleSaveChanges] 📄 Tamaño del archivo:', cssFile.size, 'bytes');
                                    
                                    let description = `Archivo CSS generado y guardado en la raíz del proyecto. Importación verificada/agregada en layout.tsx.`;
                                    if (jsImportAdded && Object.keys(iconProperties).length > 0) {
                                        description += ` También se agregó la importación del archivo JavaScript de iconos.`;
                                    } else if (Object.keys(iconProperties).length > 0) {
                                        description += ` IMPORTANTE: Agrega manualmente esta línea para los iconos: import "./zeus-icons.js";`;
                                    }
                                    description += ` Los estilos deberían persistir al refrescar.`;
                                    
                                    toast.success('✅ Cambios guardados correctamente', {
                                        description: description,
                                        duration: 8000,
                                    });
                                } catch (verifyError) {
                                    console.error('[handleSaveChanges] ⚠️ ADVERTENCIA: No se pudo verificar el archivo CSS:', verifyError);
                                    toast.warning('⚠️ Archivo guardado, pero no se pudo verificar', {
                                        description: 'El archivo se guardó, pero no se pudo verificar que esté en la raíz del proyecto. Verifica manualmente que "zeus-styles.css" esté en la raíz (donde está package.json).',
                                        duration: 10000,
                                    });
                                }
                                console.log('[handleSaveChanges] ✅ CSS import added/verified successfully');
                                if (jsImportAdded) {
                                    console.log('[handleSaveChanges] ✅ JS import added/verified successfully');
                                }
                            } else {
                                console.log('[handleSaveChanges] ⚠️ Could not add CSS import automatically (layout file not found or already has import)');
                                // Verificar que el archivo CSS existe aunque no se pudo agregar la importación
                                try {
                                    const cssFileHandle = await directoryHandle.getFileHandle('zeus-styles.css');
                                    const cssFile = await cssFileHandle.getFile();
                                    console.log('[handleSaveChanges] ✅ Verificación: Archivo CSS existe en la raíz del proyecto');
                                    console.log('[handleSaveChanges] 📄 Tamaño del archivo:', cssFile.size, 'bytes');
                                    
                                    let description = `El archivo "zeus-styles.css" se guardó correctamente en la raíz del proyecto. La importación ya existe o no se pudo agregar automáticamente.`;
                                    if (Object.keys(iconProperties).length > 0) {
                                        if (jsImportAdded) {
                                            description += ` También se agregó la importación del archivo JavaScript de iconos.`;
                                        } else {
                                            description += ` IMPORTANTE: Agrega manualmente esta línea para los iconos: import "./zeus-icons.js";`;
                                        }
                                    }
                                    
                                    toast.success('✅ Archivo CSS guardado', {
                                        description: description,
                                        duration: 8000,
                                    });
                                } catch (verifyError) {
                                    console.error('[handleSaveChanges] ⚠️ ADVERTENCIA: No se pudo verificar el archivo CSS:', verifyError);
                                    toast.warning('⚠️ Archivo guardado, pero no se pudo verificar', {
                                        description: 'El archivo se guardó, pero no se pudo verificar que esté en la raíz del proyecto. Verifica manualmente que "zeus-styles.css" esté en la raíz (donde está package.json).',
                                        duration: 10000,
                                    });
                                }
                            }
                        } catch (error) {
                            console.error('[handleSaveChanges] ❌ Error adding CSS/JS import:', error);
                            toast.warning('Archivo guardado, pero error al agregar importación', {
                                description: `Los archivos se guardaron correctamente, pero hubo un error al agregar la importación automáticamente. Revisa la consola.`,
                                duration: 8000,
                            });
                        }
                    } else if (!isDatabaseProject && !isZeusProject) {
                        // Para proyectos locales guardados vía API
                        console.log('[handleSaveChanges] ✅ Archivos guardados vía API correctamente');
                        toast.success('✅ Cambios guardados correctamente', {
                            description: `Los archivos zeus-styles.css y zeus-icons.js se guardaron en el proyecto vía API. Si tienes iconos, asegúrate de tener importado "./zeus-icons.js" en tu layout.`,
                            duration: 8000,
                        });
                    }
                    
                    // Log instrucciones en consola solo para proyectos locales
                    if (!isDatabaseProject && !isZeusProject) {
                        console.log('=== 📋 INFORMACIÓN DE GUARDADO ===');
                        console.log(`✅ Archivo CSS generado: zeus-styles.css`);
                        console.log(`📊 Componentes con estilos: ${Object.keys(cleanedComponentProperties).length}`);
                        console.log(`📝 Tamaño del CSS: ${cssContentForExternal.length} caracteres`);
                        
                        if (directoryHandle) {
                            console.log('✅ El archivo se guardó usando el directorio del proyecto');
                            console.log('✅ Ubicación esperada: raíz del proyecto (donde está package.json)');
                        } else {
                            console.log('✅ El archivo se guardó vía API en la raíz del proyecto');
                            console.log('✅ Ubicación: raíz del proyecto (donde está package.json)');
                        }
                        
                        if (!importAdded && directoryHandle) {
                            console.log('⚠️ La importación no se agregó automáticamente. Agrega manualmente en layout.tsx:');
                            console.log('   import "../zeus-styles.css";');
                        } else if (!directoryHandle) {
                            console.log('⚠️ Para que los estilos persistan, verifica:');
                            console.log('   1. El archivo "zeus-styles.css" está en la raíz del proyecto');
                            console.log('   2. La importación en layout.tsx es: import "../zeus-styles.css";');
                        }
                        
                        console.log('===========================================');
                    }
                    
                    // Update zip in PocketBase removed - all projects are local now
                } else {
                    await minDelay; // Ensure minimum delay even if cancelled
                    toast.info('Cambios guardados en localStorage', {
                        description: 'Los archivos no se guardaron (operación cancelada)',
                    });
                }
            } else {
                await minDelay; // Ensure minimum delay
                toast.success('Cambios guardados correctamente', {
                    description: `Proyecto "${projectName || 'Sin nombre'}" guardado en localStorage`,
                });
            }
        } catch (error: any) {
            console.error('[handleSaveChanges] ❌ ERROR al guardar cambios:', error);
            console.error('[handleSaveChanges] Stack trace:', error?.stack);
            console.error('[handleSaveChanges] Error name:', error?.name);
            console.error('[handleSaveChanges] Error message:', error?.message);
            
            toast.error('❌ Error al guardar los cambios', {
                description: `Error: ${error?.message || 'Error desconocido'}. Revisa la consola para más detalles.`,
                duration: 10000,
            });
        } finally {
            setIsSaving(false);
            console.log('[handleSaveChanges] ✅ Proceso de guardado finalizado');
        }
    };

    // Function to merge CSS content, preserving existing styles and adding/updating new ones
    const mergeCssContent = (existingCss: string, newCss: string): string => {
        console.log('[mergeCssContent] 🔀 Fusionando contenido CSS...');
        console.log('[mergeCssContent] 📊 CSS existente longitud:', existingCss.length);
        console.log('[mergeCssContent] 📊 CSS nuevo longitud:', newCss.length);
        
        // Extraer el encabezado del CSS existente
        const existingLines = existingCss.split('\n');
        const newLines = newCss.split('\n');
        
        // Encontrar el fin del encabezado (líneas que empiezan con /*)
        let headerEndIndex = 0;
        for (let i = 0; i < existingLines.length; i++) {
            if (!existingLines[i].trim().startsWith('/*') && existingLines[i].trim() !== '') {
                headerEndIndex = i;
                break;
            }
        }
        
        // Extraer encabezado existente y estilos existentes
        const existingHeader = existingLines.slice(0, headerEndIndex).join('\n');
        const existingStyles = existingLines.slice(headerEndIndex).join('\n');
        
        // Extraer encabezado nuevo y estilos nuevos
        const newHeaderEndIndex = newLines.findIndex(line => !line.trim().startsWith('/*') && line.trim() !== '');
        const newHeader = newLines.slice(0, newHeaderEndIndex >= 0 ? newHeaderEndIndex : 0).join('\n');
        const newStyles = newLines.slice(newHeaderEndIndex >= 0 ? newHeaderEndIndex : 0).join('\n');
        
        // Extraer selectores existentes para evitar duplicados
        const existingSelectors = new Set<string>();
        const selectorRegex = /\[data-component-id="([^"]+)"\]/g;
        let match;
        while ((match = selectorRegex.exec(existingStyles)) !== null) {
            existingSelectors.add(match[0]);
        }
        
        // Filtrar estilos nuevos para eliminar duplicados
        const filteredNewStyles = newStyles.split('\n').reduce((acc: string[], line: string, index: number, arr: string[]) => {
            // Si es una línea de selector y ya existe, saltar hasta el próximo selector
            if (line.includes('[data-component-id="')) {
                if (existingSelectors.has(line)) {
                    // Encontrar el fin de este bloque de estilos
                    let braceCount = 0;
                    let endIndex = index;
                    for (let i = index; i < arr.length; i++) {
                        if (arr[i].includes('{')) braceCount++;
                        if (arr[i].includes('}')) braceCount--;
                        if (braceCount === 0) {
                            endIndex = i;
                            break;
                        }
                    }
                    // Saltar este bloque completo
                    return acc;
                } else {
                    existingSelectors.add(line);
                }
            }
            acc.push(line);
            return acc;
        }, []).join('\n');
        
        // Combinar encabezado (usar el más reciente) y estilos fusionados
        const mergedContent = newHeader + '\n' + existingStyles + '\n' + filteredNewStyles;
        
        console.log('[mergeCssContent] ✅ CSS fusionado - Longitud final:', mergedContent.length);
        console.log('[mergeCssContent] 📊 Selectores existentes:', existingSelectors.size);
        
        return mergedContent;
    };

    // Function to update project zip in PocketBase
    const updateProjectZipInPocketBase = async (
        projectId: string,
        cssContent: string,
        jsContent: string | null,
        existingFiles: Map<string, string>
    ) => {
        try {
            const { getPocketBase } = await import('../../lib/pocketbase');
            const JSZip = (await import('jszip')).default;
            const pb = await getPocketBase();
            
            // Get current project record
            const projectRecord = await pb.collection('projects').getOne(projectId);
            
            // Download the original zip file to preserve all files
            let zip: InstanceType<typeof JSZip>;
            if (projectRecord.project_archive) {
                console.log('[updateProjectZipInPocketBase] 📥 Descargando zip original para preservar todos los archivos...');
                const fileUrl = pb.files.getUrl(projectRecord, projectRecord.project_archive);
                const response = await fetch(fileUrl);
                if (!response.ok) {
                    throw new Error('Failed to download original project archive');
                }
                const arrayBuffer = await response.arrayBuffer();
                zip = await JSZip.loadAsync(arrayBuffer);
                console.log('[updateProjectZipInPocketBase] ✅ Zip original cargado, archivos encontrados:', Object.keys(zip.files).length);
            } else {
                // If no existing archive, create a new zip
                console.log('[updateProjectZipInPocketBase] ⚠️ No hay archivo zip original, creando uno nuevo');
                zip = new JSZip();
            }
            
            // Add/update all files from existingFiles (these may have been modified)
            console.log('[updateProjectZipInPocketBase] 📝 Actualizando archivos del proyecto:', existingFiles.size);
            for (const [filePath, content] of existingFiles.entries()) {
                zip.file(filePath, content);
            }
            
            // Add/update CSS file (merge with existing if it exists)
            const existingCssFile = zip.file('zeus-styles.css');
            if (existingCssFile) {
                console.log('[updateProjectZipInPocketBase] 📝 Archivo CSS existente encontrado, fusionando contenido...');
                const existingCssContent = await existingCssFile.async('string');
                
                // Extraer estilos existentes y fusionar con nuevos
                const mergedCssContent = mergeCssContent(existingCssContent, cssContent);
                zip.file('zeus-styles.css', mergedCssContent);
                console.log('[updateProjectZipInPocketBase] ✅ CSS fusionado y actualizado');
            } else {
                zip.file('zeus-styles.css', cssContent);
                console.log('[updateProjectZipInPocketBase] ✅ CSS nuevo agregado');
            }
            
            // Add/update JS file if it exists
            if (jsContent) {
                zip.file('zeus-icons.js', jsContent);
                console.log('[updateProjectZipInPocketBase] ✅ JS agregado/actualizado');
            }
            
            // Update layout.tsx files with imports if needed
            const layoutPaths = [
                'app/layout.tsx',
                'app/layout.js',
                'src/app/layout.tsx',
                'src/app/layout.js',
                'pages/_app.tsx',
                'pages/_app.js',
                'src/pages/_app.tsx',
                'src/pages/_app.js'
            ];
            
            console.log('[updateProjectZipInPocketBase] 🔍 Buscando archivos layout para actualizar...');
            console.log('[updateProjectZipInPocketBase] Archivos disponibles en zip:', Object.keys(zip.files).filter(f => f.includes('layout') || f.includes('_app')).slice(0, 10));
            
            let layoutUpdated = false;
            for (const layoutPath of layoutPaths) {
                // Check both exact match and case-insensitive match
                const exactMatch = zip.files[layoutPath];
                const caseInsensitiveMatch = Object.keys(zip.files).find(
                    f => f.toLowerCase() === layoutPath.toLowerCase() && !zip.files[f].dir
                );
                const layoutFile = exactMatch || (caseInsensitiveMatch ? zip.files[caseInsensitiveMatch] : null);
                
                if (layoutFile && !layoutFile.dir) {
                    console.log(`[updateProjectZipInPocketBase] 📝 Archivo layout encontrado: ${layoutPath}`);
                    let layoutContent = await layoutFile.async('string');
                    let contentModified = false;
                    
                    // Add CSS import if not exists
                    const cssImportPattern = /import\s+['"]\.\.?\/.*zeus-styles\.css['"];?/;
                    if (!cssImportPattern.test(layoutContent)) {
                        console.log(`[updateProjectZipInPocketBase] ➕ Agregando importación CSS a ${layoutPath}`);
                        const lines = layoutContent.split('\n');
                        const depth = layoutPath.split('/').length - 1;
                        let importPath = './zeus-styles.css';
                        if (depth === 1) importPath = '../zeus-styles.css';
                        else if (depth === 2) importPath = '../../zeus-styles.css';
                        
                        // Find a good place to insert (after other imports, before component)
                        let insertIndex = 0;
                        for (let i = 0; i < lines.length; i++) {
                            if (lines[i].trim().startsWith('import ')) {
                                insertIndex = i + 1;
                            } else if (lines[i].trim().startsWith('export ') || lines[i].trim().startsWith('function ') || lines[i].trim().startsWith('const ')) {
                                break;
                            }
                        }
                        if (insertIndex === 0) insertIndex = Math.min(2, lines.length);
                        
                        lines.splice(insertIndex, 0, `import '${importPath}';`);
                        layoutContent = lines.join('\n');
                        contentModified = true;
                        console.log(`[updateProjectZipInPocketBase] ✅ Importación CSS agregada en línea ${insertIndex + 1}`);
                    } else {
                        console.log(`[updateProjectZipInPocketBase] ✓ Importación CSS ya existe en ${layoutPath}`);
                    }
                    
                    // Add JS import if not exists and JS file exists
                    if (jsContent) {
                        const jsImportPattern = /import\s+['"]\.\.?\/.*zeus-icons\.js['"];?/;
                        if (!jsImportPattern.test(layoutContent)) {
                            console.log(`[updateProjectZipInPocketBase] ➕ Agregando importación JS a ${layoutPath}`);
                            const lines = layoutContent.split('\n');
                            const depth = layoutPath.split('/').length - 1;
                            let importPath = './zeus-icons.js';
                            if (depth === 1) importPath = '../zeus-icons.js';
                            else if (depth === 2) importPath = '../../zeus-icons.js';
                            
                            // Find a good place to insert (after CSS import if exists, otherwise after other imports)
                            let insertIndex = 0;
                            for (let i = 0; i < lines.length; i++) {
                                if (lines[i].includes('zeus-styles.css')) {
                                    insertIndex = i + 1;
                                    break;
                                } else if (lines[i].trim().startsWith('import ')) {
                                    insertIndex = i + 1;
                                } else if (lines[i].trim().startsWith('export ') || lines[i].trim().startsWith('function ') || lines[i].trim().startsWith('const ')) {
                                    break;
                                }
                            }
                            if (insertIndex === 0) insertIndex = Math.min(3, lines.length);
                            
                            lines.splice(insertIndex, 0, `import '${importPath}';`);
                            layoutContent = lines.join('\n');
                            contentModified = true;
                            console.log(`[updateProjectZipInPocketBase] ✅ Importación JS agregada en línea ${insertIndex + 1}`);
                        } else {
                            console.log(`[updateProjectZipInPocketBase] ✓ Importación JS ya existe en ${layoutPath}`);
                        }
                    }
                    
                    if (contentModified) {
                        // Use the actual path found (could be case-insensitive match)
                        const actualPath = exactMatch ? layoutPath : caseInsensitiveMatch!;
                        zip.file(actualPath, layoutContent);
                        layoutUpdated = true;
                        console.log(`[updateProjectZipInPocketBase] ✅ Layout actualizado: ${actualPath}`);
                    }
                }
            }
            
            if (!layoutUpdated) {
                console.warn('[updateProjectZipInPocketBase] ⚠️ No se encontró ningún archivo layout para actualizar');
            }
            
            // Generate zip blob
            const zipBlob = await zip.generateAsync({ type: 'blob' });
            
            // Create FormData to upload
            const formData = new FormData();
            formData.append('project_archive', zipBlob, `${projectRecord.name || 'project'}.zip`);
            
            // Update project record with new zip
            await pb.collection('projects').update(projectId, formData);
            
            console.log('[updateProjectZipInPocketBase] ✅ Proyecto actualizado en PocketBase');
        } catch (error: any) {
            console.error('[updateProjectZipInPocketBase] ❌ Error:', error);
            throw error;
        }
    };

    const handleUndo = () => {
        if (historyIndex > 0) {
            const previousIndex = historyIndex - 1;
            const previousState = history[previousIndex];
            // Crear una copia profunda del objeto para forzar la actualización
            const newState = JSON.parse(JSON.stringify(previousState));
            setComponentProperties(newState);
            setHistoryIndex(previousIndex);
            toast.success('Cambio deshecho');
        } else {
            toast.info('No hay cambios para deshacer');
        }
    };

    const handleRedo = () => {
        if (historyIndex < history.length - 1) {
            const nextIndex = historyIndex + 1;
            const nextState = history[nextIndex];
            // Crear una copia profunda del objeto para forzar la actualización
            const newState = JSON.parse(JSON.stringify(nextState));
            setComponentProperties(newState);
            setHistoryIndex(nextIndex);
            toast.success('Cambio rehecho');
        } else {
            toast.info('No hay cambios para rehacer');
        }
    };

    const handleReset = () => {
        toast.warning('All changes reset to defaults');
    };

    const handleApplyStylesToCode = () => {
        if (!generatedCss || generatedCss.trim().length < 10) {
            toast.info('No hay estilos generados para aplicar');
            return;
        }

        // Limpiar el CSS de valores "undefined" para no confundir al modelo
        let cleanedCss = generatedCss
            .replace(/undefinedpx/g, 'auto')
            .replace(/undefined/g, 'initial')
            .replace(/\s*[a-z-]+:\s*initial\s*!important;/gi, '') // Eliminar propiedades que quedaron como initial
            .replace(/\n\s*\n/g, '\n'); // Limpiar saltos de línea extra

        // Recopilar pistas de texto para ayudar al modelo a encontrar los archivos
        let hints = '';
        if (window.zeusTextForCSS && Object.keys(window.zeusTextForCSS).length > 0) {
            hints = '\n\n### Pistas de contenido de componentes:\n';
            Object.entries(window.zeusTextForCSS).forEach(([id, text]) => {
                hints += `- Componente \`${id}\` contiene el texto: "${text}"\n`;
            });
        }

        const projectPathHint = projectPath ? `\n\n**Path del proyecto:** \`${projectPath}\`` : '';

        const message = `He realizado cambios de diseño en el editor de componentes. Aquí tienes los estilos generados (limpios) para el proyecto.${projectPathHint}${hints}\n\n### Estilos CSS:\n\`\`\`css\n${cleanedCss}\n\`\`\`\n\n**Instrucciones para el modelo:**\n1. Usa las pistas de texto y el path del proyecto para localizar los componentes reales en el código fuente (puedes usar \`grep\` o \`list files\`).\n2. Aplica estos estilos de forma permanente en los archivos \`.tsx\` correspondientes usando clases de Tailwind CSS o estilos inline.\n3. Una vez aplicados, elimina los atributos \`data-component-id\` si los ves en el código, ya que solo se usan para el editor.`;

        // Usar askZeus para que el chat responda automáticamente
        askZeus(message);

        toast.success('Estilos enviados al chat');
    };

    const ensureComponentIdRef = useRef<((componentId: string) => void) | null>(null);
    const getValidComponentIdsRef = useRef<((componentIds: string[]) => Promise<string[]>) | null>(null);

    // Function to check if properties have any non-default values
    const hasAnyNonDefaultValues = (props: any): boolean => {
        if (!props) return false;
        
        // Check background changes
        if (props.background) {
            const bg = props.background;
            if (bg.type !== 'solid' || bg.color !== 'transparent' || bg.gradient || bg.image) {
                return true;
            }
        }
        
        // Check border changes
        if (props.border) {
            const border = props.border;
            if (border.width !== 1 || border.color !== '#e5e7eb' || border.radius !== 8 || border.style !== 'solid') {
                return true;
            }
        }
        
        // Check size changes (excluding position which is handled separately)
        if (props.size) {
            const size = props.size;
            if (size.width !== 'auto' || size.height !== 'auto' || size.padding !== 16 || size.margin !== 0) {
                return true;
            }
        }
        
        // Check typography changes (excluding textContent, textStroke, textShadow which are handled separately)
        if (props.typography) {
            const typo = props.typography;
            if (typo.fontFamily !== 'Inter' || typo.fontSize !== 16 || typo.fontWeight !== 400 || 
                typo.color !== '#ffffff' || typo.lineHeight !== 1.5 || typo.alignment !== 'left') {
                return true;
            }
        }
        
        // Check shadow changes
        if (props.shadow) {
            const shadow = props.shadow;
            if (shadow.color !== '#000000' || shadow.blur !== 10 || shadow.spread !== 0 || 
                shadow.offsetX !== 0 || shadow.offsetY !== 4 || shadow.opacity !== 0.1) {
                return true;
            }
        }
        
        // Check icon changes
        if (props.icon) {
            const icon = props.icon;
            // Si hay nombre de icono seleccionado o diferencias respecto a los valores por defecto, considerarlo cambio
            if (icon.name) return true;
            if (
                (icon.size !== undefined && icon.size !== 20) ||
                (icon.color !== undefined && icon.color !== '#000000') ||
                (icon.strokeWidth !== undefined && icon.strokeWidth !== 2)
            ) {
                return true;
            }
        }
        
        return false;
    };

    // 🔥 MEJORADO: Función para asegurar que todos los componentes tengan data-id antes de guardar
    const ensureAllComponentIds = useCallback(async () => {
        if (!getValidComponentIdsRef.current || !ensureComponentIdRef.current) {
            console.warn('[ensureAllComponentIds] Refs no disponibles');
            return;
        }

        const componentIds = Object.keys(componentProperties);
        if (componentIds.length === 0) {
            console.log('[ensureAllComponentIds] No hay componentes que verificar');
            return;
        }

        console.log('[ensureAllComponentIds] 🔍 Verificando data-id para todos los componentes:', componentIds);
        
        try {
            // 🔥 MEJORADO: Verificar primero qué componentes ya tienen data-id válido
            const validIds = await getValidComponentIdsRef.current(componentIds);
            const invalidIds = componentIds.filter(id => !validIds.includes(id));
            
            console.log('[ensureAllComponentIds] 📊 Estado actual:', {
                total: componentIds.length,
                valid: validIds.length,
                invalid: invalidIds.length,
                validIds: validIds,
                invalidIds: invalidIds
            });
            
            // 🔥 CRÍTICO: Para componentes con propiedades pero sin data-id válido,
            // debemos regenerar el data-id usando el mismo elemento del DOM
            if (invalidIds.length > 0) {
                console.log('[ensureAllComponentIds] ⚠️ Regenerando data-id para componentes con propiedades...');
                
                // Para cada componente inválido, enviar mensaje especial al iframe
                // para que encuentre el elemento correspondiente y le asigne el mismo ID
                const regeneratePromises = invalidIds.map(id => {
                    return new Promise<void>((resolve) => {
                        console.log(`[ensureAllComponentIds] 🔄 Regenerando ID para: ${id}`);
                        
                        // Enviar mensaje al iframe para regenerar este ID específico
                        window.postMessage({
                            type: 'regenerateComponentId',
                            componentId: id,
                            properties: componentProperties[id]
                        }, '*');
                        
                        // Esperar confirmación
                        const handleMessage = (event: MessageEvent) => {
                            if (event.data.type === 'componentIdRegenerated' && 
                                event.data.componentId === id) {
                                console.log(`[ensureAllComponentIds] ✅ ID regenerado para: ${id}`);
                                window.removeEventListener('message', handleMessage);
                                resolve();
                            }
                        };
                        
                        window.addEventListener('message', handleMessage);
                        
                        // Timeout de seguridad
                        setTimeout(() => {
                            window.removeEventListener('message', handleMessage);
                            console.warn(`[ensureAllComponentIds] ⏰ Timeout para: ${id}`);
                            resolve();
                        }, 3000);
                    });
                });
                
                await Promise.all(regeneratePromises);
                console.log('[ensureAllComponentIds] ✅ Proceso de regeneración completado');

                // Verificar nuevamente (proteger contra desmontaje de PreviewPanel)
                if (!getValidComponentIdsRef.current || !ensureComponentIdRef.current) {
                    console.warn('[ensureAllComponentIds] ⚠️ Refs ya no disponibles tras regeneración, abortando re-verificación');
                    return;
                }
                const recheckValidIds = await getValidComponentIdsRef.current(componentIds);
                const stillInvalid = componentIds.filter(id => !recheckValidIds.includes(id));

                if (stillInvalid.length > 0) {
                    console.warn('[ensureAllComponentIds] ⚠️ Aún quedan componentes sin data-id válido:', stillInvalid);
                    // Como último recurso, generar nuevos IDs
                    const finalPromises = stillInvalid.map(id => {
                        return new Promise<void>((resolve) => {
                            if (ensureComponentIdRef.current) {
                                ensureComponentIdRef.current(id);
                            }
                            setTimeout(resolve, 100);
                        });
                    });
                    await Promise.all(finalPromises);
                }
            } else {
                console.log('[ensureAllComponentIds] ✅ Todos los componentes ya tienen data-id válido');
            }
            
            // 🔥 EXTRA: Forzar la generación de data-id para todos los elementos visibles
            // como medida preventiva
            console.log('[ensureAllComponentIds] 📡 Generando data-id para elementos adicionales...');
            window.postMessage({
                type: 'generateComponentIds',
                componentProperties: componentProperties
            }, '*');
            
            await new Promise(resolve => setTimeout(resolve, 300));
            
        } catch (error) {
            console.error('[ensureAllComponentIds] Error al verificar/generar data-id:', error);
        }
    }, [componentProperties, getValidComponentIdsRef, ensureComponentIdRef]);

    // Function to clean obsolete component properties
    const cleanObsoleteComponentProperties = async (currentProperties: Record<string, any>): Promise<Record<string, any>> => {
        console.log('[cleanObsoleteComponentProperties] 🧹 Iniciando limpieza de propiedades obsoletas...');
        console.log('[cleanObsoleteComponentProperties] 📊 Propiedades actuales:', Object.keys(currentProperties).length);
        console.log('[cleanObsoleteComponentProperties] 📋 IDs a verificar:', Object.keys(currentProperties));
        
        if (!getValidComponentIdsRef.current) {
            console.warn('[cleanObsoleteComponentProperties] ⚠️ getValidComponentIdsRef not available, returning current properties SIN MODIFICAR.');
            console.log('[cleanObsoleteComponentProperties] ✅ Devolviendo propiedades originales:', Object.keys(currentProperties).length);
            return currentProperties;
        }

        try {
            const componentIds = Object.keys(currentProperties);
            if (componentIds.length === 0) {
                console.log('[cleanObsoleteComponentProperties] 📭 No hay componentes que limpiar.');
                return currentProperties;
            }

            console.log(`[cleanObsoleteComponentProperties] 📡 Solicitando IDs válidos al iframe...`, componentIds.length, 'IDs a verificar');
            console.log('[cleanObsoleteComponentProperties] 📤 Enviando IDs:', componentIds);
            
            const validComponentIds = await getValidComponentIdsRef.current(componentIds);
            
            console.log(`[cleanObsoleteComponentProperties] 📥 Recibidos IDs válidos:`, validComponentIds.length, 'de', componentIds.length);
            console.log('[cleanObsoleteComponentProperties] 📋 IDs válidos:', validComponentIds);
            console.log('[cleanObsoleteComponentProperties] ❌ IDs eliminados:', componentIds.filter(id => !validComponentIds.includes(id)));

            const newProperties: Record<string, any> = {};
            let preservedCount = 0;
            let preservedForChanges = 0;
            
            for (const id of validComponentIds) {
                if (currentProperties[id]) {
                    newProperties[id] = currentProperties[id];
                    preservedCount++;
                }
            }
            
            // IMPORTANTE: Preservar componentes con cambios recientes aunque no estén en el iframe
            for (const id of componentIds) {
                if (!validComponentIds.includes(id) && currentProperties[id]) {
                    const props = currentProperties[id];
                    
                    // Verificar si tiene cambios recientes (textContent, textStroke, etc.)
                    const hasRecentChanges = (
                        props.typography?.textContent ||
                        (props.typography?.textStroke?.enabled && props.typography?.textStroke?.width > 0) ||
                        props.typography?.textShadow?.enabled ||
                        hasAnyNonDefaultValues(props)
                    );
                    
                    if (hasRecentChanges) {
                        newProperties[id] = props;
                        preservedForChanges++;
                        console.log(`[cleanObsoleteComponentProperties] ✅ PRESERVADO por cambios recientes: ${id}`, {
                            hasTextContent: !!props.typography?.textContent,
                            hasTextStroke: props.typography?.textStroke?.enabled,
                            hasTextShadow: props.typography?.textShadow?.enabled,
                            hasOtherChanges: hasAnyNonDefaultValues(props)
                        });
                    }
                    
                    // También preservar componentes con posición personalizada
                    if (props.size && (
                        props.size.positionX !== undefined || 
                        props.size.positionY !== undefined
                    )) {
                        if (!newProperties[id]) { // Evitar duplicados
                            newProperties[id] = props;
                            preservedCount++;
                            console.log(`[cleanObsoleteComponentProperties] ✅ PRESERVADO componente con posición: ${id}`, {
                                positionX: props.size.positionX,
                                positionY: props.size.positionY
                            });
                        }
                    }
                }
            }

            const removedCount = componentIds.length - Object.keys(newProperties).length;
            if (removedCount > 0) {
                console.log(`[cleanObsoleteComponentProperties] 🗑️ Eliminados ${removedCount} propiedades obsoletas.`);
            } else {
                console.log(`[cleanObsoleteComponentProperties] ✅ No se eliminaron propiedades. Todos los ${preservedCount + preservedForChanges} componentes son válidos.`);
            }
            
            console.log(`[cleanObsoleteComponentProperties] 📊 Resultado final: ${Object.keys(newProperties).length} propiedades preservadas (${preservedCount} válidos + ${preservedForChanges} por cambios recientes)`);
            return newProperties;
        } catch (error) {
            console.error('[cleanObsoleteComponentProperties] ❌ Error en limpieza:', error);
            console.log('[cleanObsoleteComponentProperties] 🔄 Devolviendo propiedades originales debido a error');
            return currentProperties; // Return original if error
        }
    };


    const handleComponentClick = (id: string) => {
        // IMPORTANTE: Actualizar el selectedComponentId inmediatamente y de forma síncrona
        // Esto asegura que cuando se guarden propiedades, se use el ID correcto
        console.log('[main-studio] handleComponentClick called with id:', id);
        
        // Actualizar el ref primero para acceso inmediato (sin esperar al re-render)
        selectedComponentIdRef.current = id;
        
        // CRÍTICO: Actualizar también el ref del componente que está siendo editado
        editingComponentIdRef.current = id;
        console.log('[main-studio] ✅ editingComponentIdRef actualizado a:', id);
        
        // Actualizar el estado
        setSelectedComponentId(id);
        
        const component = findComponentById(components, id);
        if (component?.type === 'text') {
            setSelectedText(component.name || 'Sample Text');
        }
        
        console.log('[main-studio] ✅ selectedComponentId updated to:', id);
    };

    const handleTextDoubleClick = () => {
        if (selectedComponent?.type === 'text') {
            setTextEditorOpen(true);
        }
    };

    const handleTextSave = (newText: string) => {
        setSelectedText(newText);
        // Update component name if it's a text component
        if (selectedComponentId) {
            updateComponentProperty(selectedComponentId, 'name', newText);
        }
        toast.success('Texto actualizado correctamente');
    };

    const updateComponentProperty = (componentId: string, property: string, value: any) => {
        const updateComponent = (comps: ComponentNode[]): ComponentNode[] => {
            return comps.map(comp => {
                if (comp.id === componentId) {
                    return { ...comp, [property]: value };
                }
                if (comp.children) {
                    return { ...comp, children: updateComponent(comp.children) };
                }
                return comp;
            });
        };
        setComponents(updateComponent(components));
    };

    // Función para eliminar componentes
    const deleteComponent = (componentId: string) => {
        console.log('[main-studio] 🗑️ deleteComponent llamado con ID:', componentId);
        
        // Marcar el componente como eliminado en lugar de eliminarlo completamente
        setComponentProperties(prev => {
            const newProps = { ...prev };
            // Si el componente ya existe, marcarlo como eliminado
            if (newProps[componentId]) {
                newProps[componentId] = {
                    ...newProps[componentId],
                    __deleted: true
                };
            } else {
                // Si no existe, crear entrada marcada como eliminada
                newProps[componentId] = {
                    __deleted: true
                };
            }
            console.log('[main-studio] 👻 Componente marcado como eliminado:', componentId);
            console.log('[main-studio] 📋 Propiedades actualizadas:', Object.keys(newProps));
            return newProps;
        });

        // Eliminar del árbol de componentes
        setComponents(prev => {
            const newComponents = prev.filter(comp => comp.id !== componentId);
            console.log('[main-studio] 🌳 Componente eliminado del árbol:', componentId);
            console.log('[main-studio] 📊 Componentes restantes:', newComponents.map(c => c.id));
            return newComponents;
        });

        // Limpiar selección si el componente eliminado estaba seleccionado
        if (selectedComponentId === componentId) {
            setSelectedComponentId(null);
            selectedComponentIdRef.current = null;
        }

        // Eliminar del iframe - enviar mensaje al iframe específico
        console.log('[main-studio] 📤 Enviando mensaje deleteComponentFromDOM al iframe:', componentId);
        
        // Enviar mensaje tanto al window como intentar encontrar el iframe
        window.postMessage({
            type: 'deleteComponentFromDOM',
            componentId: componentId
        }, '*');
        
        // También intentar enviar directamente al iframe si existe
        const iframes = document.querySelectorAll('iframe');
        iframes.forEach(iframe => {
            if (iframe.contentWindow) {
                try {
                    iframe.contentWindow.postMessage({
                        type: 'deleteComponentFromDOM',
                        componentId: componentId
                    }, '*');
                    console.log('[main-studio] 📤 Mensaje enviado directamente al iframe');
                } catch (error: any) {
                    console.log('[main-studio] ⚠️ No se pudo enviar mensaje directo al iframe:', error?.message);
                }
            }
        });

        toast.success('Componente eliminado');
        
        // Forzar actualización del iframe enviando las propiedades actualizadas
        setTimeout(() => {
            console.log('[main-studio] 🔄 Forzando actualización del iframe después de eliminar');
            // Esto activará el useEffect que envía estilos al iframe
            setComponentProperties(prev => ({ ...prev }));
        }, 100);
    };

    const handlePropertyChange = (componentId: string, properties: any) => {
        // CRÍTICO: Usar el componentId que se pasa como parámetro
        // Este es el ID del componente que está siendo editado en el PropertyEditor
        const idToUse = componentId;
        
        if (!idToUse) {
            console.warn('[main-studio] ⚠️ No se proporcionó componentId, no se pueden guardar propiedades');
            return;
        }
        
        // Verificar que el componentId coincide con el componente seleccionado actualmente
        const currentSelectedId = selectedComponentIdRef.current || selectedComponentId;
        if (componentId !== currentSelectedId) {
            console.warn('[main-studio] ⚠️ ADVERTENCIA: componentId no coincide con el componente seleccionado:', {
                componentIdProvided: componentId,
                selectedComponentId: currentSelectedId,
                idToUse: idToUse,
                message: 'Se guardará en el componentId proporcionado (el componente que está siendo editado)'
            });
        }
        
        console.log('[main-studio] ✅ handlePropertyChange called - usando componentId proporcionado:', {
            componentIdProvided: componentId,
            selectedComponentId: currentSelectedId,
            idToUse: idToUse,
            propertiesKeys: properties ? Object.keys(properties) : [],
            existingProperties: componentProperties[idToUse] ? Object.keys(componentProperties[idToUse]) : []
        });
        
        setComponentProperties(prev => {
            let newProps: Record<string, any>;
            
            // Si properties es null, eliminar las propiedades de ese componente
            if (properties === null || properties === undefined) {
                newProps = { ...prev };
                delete newProps[idToUse];
            } else {
                // Si hay propiedades, actualizarlas - crear copia profunda para asegurar nueva referencia
                // IMPORTANTE: Usar idToUse (el ID del elemento seleccionado actualmente)
                newProps = {
                    ...prev,
                    [idToUse]: JSON.parse(JSON.stringify(properties))
                };
                
                // IMPORTANTE: Cuando se detecta una modificación, asegurar que el componente tenga un data-component-id
                // Esto crea el ID automáticamente solo cuando es necesario
                // Usar setTimeout para asegurar que el estado se actualice primero
                setTimeout(() => {
                    if (ensureComponentIdRef.current && idToUse && 
                        !idToUse.startsWith('component-') && 
                        !idToUse.includes('-nth-child-') &&
                        !componentProperties[idToUse]) {
                        console.log('[main-studio] Ensuring componentId for selected element:', idToUse);
                        ensureComponentIdRef.current(idToUse);
                    }
                }, 0);
            }
            
            // Agregar al historial (solo si es diferente al estado actual)
            const currentState = JSON.stringify(prev);
            const newState = JSON.stringify(newProps);
            
            if (currentState !== newState) {
                setHistory(prevHistory => {
                    // Eliminar cualquier historial futuro (si estamos en medio del historial)
                    const newHistory = prevHistory.slice(0, historyIndex + 1);
                    // Agregar el nuevo estado
                    newHistory.push(JSON.parse(newState));
                    // Limitar el tamaño del historial
                    if (newHistory.length > maxHistorySize) {
                        newHistory.shift();
                        return newHistory;
                    }
                    return newHistory;
                });
                setHistoryIndex(prevIndex => {
                    const newIndex = Math.min(prevIndex + 1, maxHistorySize - 1);
                    return newIndex;
                });
            }
            
            return newProps;
        });
    };

    // Listener para actualizar IDs de componentes cuando el iframe los actualiza
    useEffect(() => {
        const handleUpdateComponentId = (event: MessageEvent) => {
            if (event.data && event.data.type === 'updateComponentId') {
                const { oldId, newId } = event.data;
                
                // Actualizar las propiedades guardadas: mover propiedades del ID antiguo al nuevo
                setComponentProperties(prev => {
                    if (prev[oldId]) {
                        const newProps = { ...prev };
                        // Mover propiedades del ID antiguo al nuevo
                        newProps[newId] = newProps[oldId];
                        // Eliminar el ID antiguo
                        delete newProps[oldId];
                        
                        console.log(`[main-studio] ✅ ID actualizado en propiedades: "${oldId}" -> "${newId}"`);
                        
                        return newProps;
                    }
                    return prev;
                });
                
                // Si el ID actualizado es el seleccionado, actualizar la selección
                if (selectedComponentId === oldId) {
                    selectedComponentIdRef.current = newId;
                    setSelectedComponentId(newId);
                    console.log(`[main-studio] ✅ Selección actualizada: "${oldId}" -> "${newId}"`);
                }
            } else if (event.data && event.data.type === 'componentIdEnsured') {
                // El iframe ha generado/asegurado un componentId
                const { requestedId, generatedId } = event.data;
                
                console.log('[main-studio] ComponentId ensured:', {
                    requestedId: requestedId,
                    generatedId: generatedId
                });
                
                // Si el ID generado es diferente al solicitado, actualizar la selección y mover propiedades
                if (generatedId && generatedId !== requestedId && selectedComponentId === requestedId) {
                    // Mover propiedades del ID solicitado al generado
                    setComponentProperties(prev => {
                        if (prev[requestedId]) {
                            const newProps = { ...prev };
                            newProps[generatedId] = newProps[requestedId];
                            delete newProps[requestedId];
                            console.log(`[main-studio] ✅ Propiedades movidas de "${requestedId}" a "${generatedId}"`);
                            return newProps;
                        }
                        return prev;
                    });
                    
                    // Actualizar la selección con el ID generado
                    selectedComponentIdRef.current = generatedId;
                    setSelectedComponentId(generatedId);
                    console.log(`[main-studio] ✅ Selección actualizada con ID generado: "${generatedId}"`);
                } else if (generatedId && selectedComponentId === requestedId) {
                    // El ID generado coincide, solo actualizar la selección por si acaso
                    selectedComponentIdRef.current = generatedId;
                    setSelectedComponentId(generatedId);
                }
            } else if (event.data && event.data.type === 'componentSelected') {
                // 🔥 NUEVO: Recibir información del componente seleccionado del iframe
                const { component } = event.data;
                
                console.log('[main-studio] 📥 Componente seleccionado desde iframe:', component);
                
                // Actualizar el selectedComponentId con el ID del componente
                if (component.componentId) {
                    selectedComponentIdRef.current = component.componentId;
                    setSelectedComponentId(component.componentId);
                    editingComponentIdRef.current = component.componentId;
                    
                    // 🔥 NUEVO: Almacenar información del background
                    setSelectedComponentBackground(component.background || null);
                    
                    console.log('[main-studio] ✅ Selección actualizada desde iframe:', {
                        componentId: component.componentId,
                        tag: component.tag,
                        hasBackground: !!component.background,
                        backgroundInfo: component.background
                    });
                }
            }
        };
        
        window.addEventListener('message', handleUpdateComponentId);
        
        return () => {
            window.removeEventListener('message', handleUpdateComponentId);
        };
    }, [selectedComponentId]);

    // Inicializar historial cuando se cargan propiedades guardadas
    useEffect(() => {
        if (Object.keys(componentProperties).length > 0 && history.length === 1 && Object.keys(history[0]).length === 0) {
            // Si hay propiedades pero el historial solo tiene el estado vacío inicial,
            // agregar el estado actual al historial
            setHistory([componentProperties]);
            setHistoryIndex(0);
        }
    }, []); // Solo al montar

    // 🔥 NUEVO: Generar data-id para componentes existentes cuando se carga el proyecto
    useEffect(() => {
        if (isProjectLoaded && Object.keys(componentProperties).length > 0 && getValidComponentIdsRef.current && ensureComponentIdRef.current) {
            console.log('[useEffect] 🔄 Proyecto cargado, verificando data-id para componentes existentes...');
            
            // Esperar un momento para que el iframe esté completamente listo
            const timeout = setTimeout(() => {
                ensureAllComponentIds();
            }, 1000);
            
            return () => clearTimeout(timeout);
        }
    }, [isProjectLoaded, componentProperties.length, ensureAllComponentIds]);

    // Auto-save to localStorage and generate CSS whenever componentProperties change
    useEffect(() => {
        // Generate CSS for the preview panel
        const css = generateCSS();
        setGeneratedCss(css);

        // Save if we have any properties, even without project data
        if (Object.keys(componentProperties).length > 0) {
            // Convertir Map a objeto para guardar en localStorage
            const projectFilesObj: Record<string, string> = {};
            projectFiles.forEach((content, filePath) => {
                projectFilesObj[filePath] = content;
            });
            
            const dataToSave = {
                components: components,
                projectPath: projectPath,
                projectName: projectName,
                componentProperties: componentProperties,
                devServerUrl: devServerUrl,
                projectFiles: projectFilesObj, // AGREGADO: Archivos del proyecto para el editor de URLs
                savedAt: new Date().toISOString()
            };
            
            try {
                localStorage.setItem('zeus-studio-data', JSON.stringify(dataToSave));
                console.log('Auto-saved to localStorage:', {
                    propertiesCount: Object.keys(componentProperties).length,
                    allProperties: componentProperties
                });
            } catch (error) {
                console.error('Error auto-saving to localStorage:', error);
            }
            
            // 🔥 NUEVO: Asegurar que todos los componentes tengan data-id antes de enviar actualizaciones
            // Esto es crítico para que los data-id se persistan correctamente
            setTimeout(() => {
                if (getValidComponentIdsRef.current && ensureComponentIdRef.current) {
                    // Obtener todos los componentIds que tienen propiedades
                    const componentIds = Object.keys(componentProperties);
                    if (componentIds.length > 0) {
                        console.log('[useEffect] 🔍 Verificando data-id para componentes con propiedades:', componentIds);
                        
                        // Verificar qué IDs son válidos en el iframe
                        getValidComponentIdsRef.current(componentIds).then(validIds => {
                            const invalidIds = componentIds.filter(id => !validIds.includes(id));
                            
                            if (invalidIds.length > 0) {
                                console.log('[useEffect] ⚠️ Componentes sin data-id válido, generando IDs:', invalidIds);
                                
                                // Generar data-id para los componentes que no lo tienen
                                invalidIds.forEach(id => {
                                    console.log('[useEffect] 🆕 Generando data-id para componente:', id);
                                    ensureComponentIdRef.current?.(id);
                                });
                            } else {
                                console.log('[useEffect] ✅ Todos los componentes ya tienen data-id válido');
                            }
                        }).catch(error => {
                            console.warn('[useEffect] Error al verificar data-id de componentes:', error);
                        });
                    }
                }
            }, 100); // Pequeño delay para asegurar que el iframe esté listo
            
            // Enviar actualizaciones de texto al iframe del editor si hay cambios en textContent
            const textUpdates: Array<{componentId: string, textContent: string}> = [];
            Object.entries(componentProperties).forEach(([componentId, props]) => {
                if (props?.typography?.textContent) {
                    console.log('[useEffect] 📝 Detectado cambio de texto para iframe del editor', componentId, ':', props.typography.textContent);
                    textUpdates.push({
                        componentId,
                        textContent: props.typography.textContent
                    });
                }
            });
            
            // Enviar todas las actualizaciones de texto juntas al iframe del editor
            if (textUpdates.length > 0) {
                setTimeout(() => {
                    console.log('[useEffect] 📤 Enviando actualizaciones de texto en tiempo real al iframe:', textUpdates);
                    window.postMessage({
                        type: 'updateTextContents',
                        updates: textUpdates
                    }, '*');
                }, 150); // Mayor delay para asegurar que los data-id estén generados primero
            }

        }
    }, [componentProperties, components, projectPath, projectName, devServerUrl, projectFiles]);


    return (
        <div className="h-full w-full flex flex-col overflow-hidden bg-card">
            <TopToolbar 
                selectedComponent={selectedComponent?.name || null} 
                projectName={projectName}
                projectType={getProjectSource()}
                projectId={getCurrentProjectId() || undefined}
                onLoadProject={handleLoadProject} 
                onSaveChanges={handleSaveChanges} 
                onUndo={handleUndo} 
                onRedo={handleRedo} 
                onReset={handleReset} 
                onApplyStylesToCode={handleApplyStylesToCode}
                onViewModeChange={setViewMode} 
                viewMode={viewMode} 
                isSaving={isSaving}
                canUndo={canUndo}
                canRedo={canRedo}
                isTunnelConnected={isTunnelConnected}
                onConnectTunnel={connectTunnelManually}
                isConnectingTunnel={isConnectingTunnel}
                currentPort={editablePort}
                onPortChange={handlePortChange}
                onDirectPortChange={handleDirectPortChange}

            />

            <ResizablePanelGroup direction="horizontal" className="flex-1 min-h-0 h-full">
                {/* Left Panel - File URL / Icon Editor */}
                <ResizablePanel id="left-panel" defaultSize={33} minSize={20} className="min-w-0 h-full">
                    <div className="flex flex-col h-full w-full bg-card border-r border-border/50">
                        {/* Tabs */}
                        <div className="flex border-b border-border/50 bg-background">
                            <button
                                className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
                                    leftPanelTab === 'urls'
                                        ? 'bg-card text-primary border-b-2 border-blue-400'
                                        : 'text-muted-foreground hover:text-foreground/80 hover:bg-card/50'
                                }`}
                                onClick={() => setLeftPanelTab('urls')}
                            >
                                {t('urlEditorTitle')}
                            </button>
                            <button
                                className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
                                    leftPanelTab === 'icons'
                                        ? 'bg-card text-accent border-b-2 border-purple-400'
                                        : 'text-muted-foreground hover:text-foreground/80 hover:bg-card/50'
                                }`}
                                onClick={() => setLeftPanelTab('icons')}
                            >
                                {t('iconEditorTitle')}
                            </button>
                        </div>
                        <div className="flex-1 min-h-0 overflow-hidden">
                            {leftPanelTab === 'urls' ? (
                                <FileUrlEditor
                                    projectFiles={projectFiles}
                                    onSaveFile={saveProjectFile}
                                    onRefreshFiles={refreshProjectFiles}
                                    isLoading={!isProjectLoaded}
                                    devServerUrl={devServerUrl}
                                />
                            ) : (
                                <FileIconEditor
                                    projectFiles={projectFiles}
                                    onSaveFile={saveProjectFile}
                                    onRefreshFiles={refreshProjectFiles}
                                    isLoading={!isProjectLoaded}
                                    devServerUrl={devServerUrl}
                                    projectPath={projectPath}
                                />
                            )}
                        </div>
                    </div>
                </ResizablePanel>

                <ResizableHandle withHandle />

                {/* Middle Panel - Preview */}
                <ResizablePanel id="center-panel" defaultSize={34} minSize={20} className="min-w-0 h-full">
                    <PreviewPanel
                        key={previewPanelKey}
                        viewMode={viewMode}
                        onComponentClick={handleComponentClick}
                        selectedComponentId={selectedComponentId}
                        components={components}
                        componentProperties={componentProperties}
                        generatedCss={generatedCss}
                        isProjectLoaded={isProjectLoaded}
                        projectPath={projectPath}
                        devServerUrl={devServerUrl}
                        onDevServerUrlChange={setDevServerUrl}
                        ensureComponentIdRef={ensureComponentIdRef}
                        getValidComponentIdsRef={getValidComponentIdsRef}
                        onPropertyChange={handlePropertyChange}
                        currentPort={currentPort}
                        onPortChange={handlePortChange}
                        isMaximised={isPreviewMaximised}
                        onMaximiseToggle={handlePreviewMaximiseToggle}
                    />
                </ResizablePanel>

                <ResizableHandle withHandle />

                {/* Right Panel - Property Editor */}
                <ResizablePanel id="right-panel" defaultSize={33} minSize={20} className="min-w-0 h-full">
                    <PropertyEditor
                        key={selectedComponentId || 'no-selection'}
                        selectedComponent={selectedComponent}
                        properties={selectedComponentId ? componentProperties[selectedComponentId] : undefined}
                        projectId={getCurrentProjectId() || undefined}
                        projectSource={getProjectSource()}
                        onDeleteComponent={deleteComponent}

                        onPropertyChange={(properties) => {
                            // CRÍTICO: Usar el ref del componente que está siendo editado
                            // Este ref se actualiza cuando se selecciona un componente y no cambia
                            // hasta que se seleccione otro componente
                            const componentIdToUse = editingComponentIdRef.current || selectedComponent?.id || selectedComponentId;
                            
                            if (!componentIdToUse) {
                                console.warn('[main-studio] ⚠️ Intento de guardar propiedades sin componente seleccionado');
                                console.warn('[main-studio] Estado actual:', {
                                    editingComponentIdRef: editingComponentIdRef.current,
                                    selectedComponentId: selectedComponentId,
                                    selectedComponentIdFromComponent: selectedComponent?.id
                                });
                                return;
                            }
                            
                            console.log('[main-studio] PropertyEditor onPropertyChange:', {
                                componentIdToUse: componentIdToUse,
                                editingComponentIdRef: editingComponentIdRef.current,
                                selectedComponentId: selectedComponentId,
                                selectedComponentIdFromComponent: selectedComponent?.id,
                                propertiesKeys: properties ? Object.keys(properties) : [],
                                propertiesPreview: properties ? JSON.stringify(properties).substring(0, 200) : 'null'
                            });
                            
                            handlePropertyChange(componentIdToUse, properties);
                        }}
                    />
                </ResizablePanel>
            </ResizablePanelGroup>


            <TextEditor
                open={textEditorOpen}
                onOpenChange={setTextEditorOpen}
                selectedText={selectedText}
                onSave={handleTextSave}
            />

            <Toaster 
                position="bottom-right"
                expand={false}
                richColors
                closeButton
            />

            {/* Status Bar */}
            <div className="border-t border-border/50 px-4 py-2 text-xs text-muted-foreground bg-background backdrop-blur">
                <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-4">
                        <span>{t('ready')}</span>
                        <span className="text-success">● {t('connected')}</span>
                        <span>{t('components')}: {countComponents(components)}</span>
                    </div>
                    <div className="flex items-center justify-center flex-1">
                        <span className="text-success">2026 © www.zeus-ia.com</span>
                    </div>
                    <div className="flex items-center space-x-4">
                        <span>{t('autoSave')}: On</span>
                        <span>{t('zoom')}: 100%</span>
                        <span>{t('version')}</span>
                    </div>
                </div>
            </div>
        </div>
    );
}

function countComponents(components: any[]): number {
    let count = 0;
    function traverse(comp: any) {
        count++;
        if (comp.children) {
            comp.children.forEach(traverse);
        }
    }
    components.forEach(traverse);
    return count;
}