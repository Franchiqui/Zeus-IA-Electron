'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Button } from '../ui/button';
import { Maximize2, Minimize2, ZoomIn, ZoomOut, RotateCcw, MousePointer, MousePointer2, Zap, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Move, RefreshCw } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { useTranslation } from '../../contexts/translation-context';
import { toast } from 'sonner';

interface ComponentNode {
  id: string;
  name: string;
  type: 'container' | 'button' | 'text' | 'image' | 'input' | 'custom';
  children?: ComponentNode[];
}

interface PreviewPanelProps {
  viewMode: 'desktop' | 'tablet' | 'mobile';
  onComponentClick: (id: string) => void;
  selectedComponentId: string | null;
  components?: ComponentNode[];
  componentProperties?: Record<string, any>;
  generatedCss?: string;
  isProjectLoaded?: boolean;
  projectPath?: string;
  devServerUrl?: string;
  onDevServerUrlChange?: (url: string) => void;
  ensureComponentIdRef?: React.MutableRefObject<((componentId: string) => void) | null>;
  getValidComponentIdsRef?: React.MutableRefObject<((componentIds: string[]) => Promise<string[]>) | null>;
  onPropertyChange?: (componentId: string, properties: any) => void;
  onComponentIdsGenerated?: (count: number, data: any) => void;
  currentPort?: string;
  onPortChange?: (port: string) => void;
  isMaximised?: boolean;
  onMaximiseToggle?: () => void;
}

export function PreviewPanel({ viewMode, onComponentClick, selectedComponentId, components, componentProperties = {}, generatedCss = '', isProjectLoaded = false, projectPath = '', devServerUrl = 'http://localhost:3000', onDevServerUrlChange, ensureComponentIdRef, getValidComponentIdsRef, onPropertyChange, onComponentIdsGenerated, currentPort = '3000', onPortChange, isMaximised = false, onMaximiseToggle }: PreviewPanelProps) {
  const { t } = useTranslation();
  
  // Log cuando devServerUrl cambia (en el render)
  useEffect(() => {
    console.log('[PreviewPanel] 📥 devServerUrl recibido como prop:', devServerUrl);
  }, [devServerUrl]);
  
  const [zoom, setZoom] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [useLivePreview, setUseLivePreview] = useState(true);
  const [iframeError, setIframeError] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const injectionInProgressRef = useRef(false);
  const lastInjectionTimeRef = useRef(0);
  const iconTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [iframeKey, setIframeKey] = useState(0); // Key para forzar recarga del iframe
  const [localPort, setLocalPort] = useState<string>(currentPort);
  const wasProjectLoadedRef = useRef(isProjectLoaded); // Track previous isProjectLoaded state

  // Detect when project is first loaded and force iframe re-mount
  useEffect(() => {
    if (!wasProjectLoadedRef.current && isProjectLoaded) {
      console.log('[PreviewPanel] 🚀 Project just loaded, forcing iframe re-mount');
      setIframeKey(prev => prev + 1);
    }
    wasProjectLoadedRef.current = isProjectLoaded;
  }, [isProjectLoaded]);

  // Enviar propiedades actualizadas al iframe
  const sendPropertiesToIframe = (componentId: string, properties: any) => {
    const iframe = iframeRef.current;
    if (!iframe || !iframe.contentWindow) {
      console.log('[PreviewPanel] ⚠️ Iframe no disponible para enviar propiedades');
      return;
    }

    try {
      iframe.contentWindow.postMessage({
        type: 'updateComponentProperties',
        componentId: componentId,
        properties: properties
      }, '*');
      console.log('[PreviewPanel] 📤 Propiedades enviadas al iframe:', { componentId, properties });
    } catch (error) {
      console.error('[PreviewPanel] ❌ Error al enviar propiedades al iframe:', error);
    }
  };

  // Enviar propiedades cuando cambian
  useEffect(() => {
    if (selectedComponentId && componentProperties[selectedComponentId]) {
      sendPropertiesToIframe(selectedComponentId, componentProperties[selectedComponentId]);
    }
  }, [componentProperties, selectedComponentId]);
  
  // Functions to move selected element
  const moveElement = (direction: 'up' | 'down' | 'left' | 'right') => {
    if (!selectedComponentId || !onPropertyChange) return;
    
    console.log(`[PreviewPanel] 🎯 Intentando mover elemento ${direction}`);
    console.log(`[PreviewPanel] 📍 selectedComponentId:`, selectedComponentId);
    console.log(`[PreviewPanel] 📊 onPropertyChange disponible:`, !!onPropertyChange);
    
    const currentProps = componentProperties[selectedComponentId] || {};
    const currentSize = currentProps.size || {};
    const step = 10; // Move 10px per click
    
    console.log(`[PreviewPanel] 📏 Propiedades actuales:`, currentProps);
    console.log(`[PreviewPanel] 📏 Size actual:`, currentSize);
    
    // Use current position or default to 0
    let newPositionX = currentSize.positionX || 0;
    let newPositionY = currentSize.positionY || 0;
    
    console.log(`[PreviewPanel] 📍 Posición inicial:`, { x: newPositionX, y: newPositionY });
    
    switch (direction) {
      case 'up':
        newPositionY -= step;
        break;
      case 'down':
        newPositionY += step;
        break;
      case 'left':
        newPositionX -= step;
        break;
      case 'right':
        newPositionX += step;
        break;
    }
    
    const updatedProps = {
      ...currentProps,
      size: {
        ...currentSize,
        positionX: newPositionX,
        positionY: newPositionY,
        left: `${newPositionX}px`,
        top: `${newPositionY}px`,
      }
    };
    
    console.log(`[PreviewPanel] ✅ Propiedades actualizadas:`, updatedProps);
    console.log(`[PreviewPanel] 📍 Nueva posición:`, { x: newPositionX, y: newPositionY });
    
    onPropertyChange(selectedComponentId, updatedProps);

    // Send properties directly to iframe for immediate movement
    setTimeout(() => {
      sendPropertiesToIframe(selectedComponentId, updatedProps);
    }, 100);
  };
  
  // Sincronizar el puerto local con el prop
  useEffect(() => {
    setLocalPort(currentPort);
  }, [currentPort]);

  // Handle keyboard navigation for moving elements in fullscreen
  useEffect(() => {
    if (!isMaximised || !selectedComponentId) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Only move if arrow keys are pressed without modifiers
      if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      
      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault();
          moveElement('up');
          break;
        case 'ArrowDown':
          e.preventDefault();
          moveElement('down');
          break;
        case 'ArrowLeft':
          e.preventDefault();
          moveElement('left');
          break;
        case 'ArrowRight':
          e.preventDefault();
          moveElement('right');
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isMaximised, selectedComponentId, componentProperties, onPropertyChange]);

  const viewportSizes = {
    desktop: 'w-full h-full',
    tablet: 'max-w-[768px] h-full mx-auto',
    mobile: 'max-w-[375px] h-full mx-auto',
  };

  // Ensure script is injected before sending messages
  const ensureScriptInjected = (callback: () => void) => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    // Check if script is already ready by sending a test message
    const testMessageId = Date.now();
    const timeoutId = setTimeout(() => {
      console.log('[PreviewPanel] ⏰ Script no respondió, inyectando...');
      injectCommunicationScript(iframe, callback);
    }, 500);

    const handleTestResponse = (event: MessageEvent) => {
      if (event.data.type === 'iframeScriptReady') {
        clearTimeout(timeoutId);
        window.removeEventListener('message', handleTestResponse);
        console.log('[PreviewPanel] ✅ Script ya está inyectado');
        callback();
      }
    };

    window.addEventListener('message', handleTestResponse);
    
    // Send test message to check if script is ready
    iframe.contentWindow?.postMessage({
      type: 'testScriptReady',
      messageId: testMessageId
    }, '*');
  };

  // Inject communication script directly
  const injectCommunicationScript = (iframe: HTMLIFrameElement, callback: () => void) => {
    try {
      const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
      if (!iframeDoc) {
        console.log('[PreviewPanel] ⚠️ No se puede acceder al documento del iframe (CORS)');
        return;
      }
      
      // Crear y ejecutar el script directamente en el iframe
      const script = iframeDoc.createElement('script');
      script.textContent = `
        console.log('[Iframe] 🚀 Script de comunicación creado e inyectado');
        
        // Responder a test de inmediato
        if (window.location.href.includes('testScriptReady')) {
          window.parent.postMessage({
            type: 'iframeScriptReady',
            timestamp: Date.now()
          }, '*');
        }
        
        // Crear el manejador de mensajes
        window.addEventListener('message', function(event) {
          console.log('[Iframe] 📨 Mensaje recibido:', event.data?.type);
          
          if (event.data.type === 'testScriptReady') {
            console.log('[Iframe] 🧪 Test recibido, respondiendo...');
            window.parent.postMessage({
              type: 'iframeScriptReady',
              timestamp: Date.now()
            }, '*');
          } else if (event.data.type === 'enableSelection') {
            console.log('[Iframe] ✅ Selección habilitada');
            window.parent.postMessage({
              type: 'selectionReady'
            }, '*');
          } else if (event.data.type === 'disableSelection') {
            console.log('[Iframe] ✅ Selección deshabilitada');
          } else if (event.data.type === 'applyComponentStyles') {
            console.log('[Iframe] 🎨 Aplicando estilos CSS');
            if (event.data.css) {
              let style = document.getElementById('zeus-component-styles');
              if (style) {
                style.remove();
              }
              style = document.createElement('style');
              style.id = 'zeus-component-styles';
              
              // Para el editor: REMOVER CSS con ::before para evitar conflictos
              let cleanCSS = event.data.css;
              cleanCSS = cleanCSS.replace(/\/\* Reemplazar contenido de texto \*\/[\s\S]*?&::before \{[\s\S]*?\}\s*\}/g, '');
              cleanCSS = cleanCSS.replace(/\[data-component-id="[^"]+"\] \{[\s\S]*?font-size: 0 !important;[\s\S]*?\}/g, (match) => {
                // Restaurar estilos de texto originales para el editor
                return match.replace(/font-size: 0 !important;[\s\S]*?text-shadow: none !important;/g, '');
              });
              
              style.textContent = cleanCSS;
              document.head.appendChild(style);
              console.log('[Iframe] ✅ Estilos CSS aplicados (limpios para editor)');
            }
            
            // Aplicar actualizaciones de texto desde mensajes (sistema original del editor)
            if (event.data.componentProperties) {
              console.log('[Iframe] 📝 Procesando actualizaciones de texto desde componentProperties');
              const textUpdates = [];
              
              Object.entries(event.data.componentProperties).forEach(([componentId, props]) => {
                if (props?.typography?.textContent) {
                  console.log('[Iframe] 📝 Procesando textContent para', componentId, ':', props.typography.textContent);
                  textUpdates.push({
                    componentId,
                    textContent: props.typography.textContent
                  });
                }
              });
              
              // Aplicar actualizaciones de texto con el sistema original
              if (textUpdates.length > 0) {
                console.log('[Iframe] 📝 Aplicando', textUpdates.length, 'actualizaciones de texto (sistema original)');
                textUpdates.forEach(function(update) {
                  const element = document.querySelector('[data-component-id="' + update.componentId + '"]');
                  console.log('[Iframe] 🎯 Elemento encontrado:', !!element, 'para ID:', update.componentId);
                  
                  if (element) {
                    const oldText = element.innerText;
                    element.innerText = update.textContent;
                    console.log('[Iframe] ✅ Elemento actualizado con sistema original:', {
                      componentId: update.componentId,
                      oldText: oldText,
                      newText: update.textContent,
                      tagName: element.tagName
                    });
                  } else {
                    console.warn('[Iframe] ❌ Elemento no encontrado para actualización de texto:', update.componentId);
                  }
                });
              }
            }
          } else if (event.data.type === 'updateTextContents' && Array.isArray(event.data.updates)) {
            console.log('[Iframe] 📨 Recibido mensaje updateTextContents:', event.data.updates);
            
            event.data.updates.forEach(function(update) {
              console.log('[Iframe] 🔍 Procesando actualización:', update);
              const element = document.querySelector('[data-component-id="' + update.componentId + '"]');
              console.log('[Iframe] 🎯 Elemento encontrado:', !!element, 'para ID:', update.componentId);
              
              if (element) {
                const oldText = element.innerText;
                element.innerText = update.textContent;
                console.log('[Iframe] ✅ Elemento actualizado:', {
                  componentId: update.componentId,
                  oldText: oldText,
                  newText: update.textContent,
                  tagName: element.tagName
                });
              } else {
                console.warn('[Iframe] ❌ Elemento no encontrado para actualización de texto:', update.componentId);
              }
            });
          }
        });
        
        console.log('[Iframe] ✅ Script de manejo de mensajes ejecutado correctamente');
        
        // Enviar confirmación al padre
        window.parent.postMessage({
          type: 'iframeScriptReady',
          timestamp: Date.now()
        }, '*');
      `;
      
      iframeDoc.head.appendChild(script);
      console.log('[PreviewPanel] ✅ Script de comunicación inyectado directamente en el iframe');
      
      // Esperar un poco y ejecutar callback
      setTimeout(() => {
        callback();
      }, 100);
      
    } catch (error) {
      console.error('[PreviewPanel] ❌ Error al inyectar script en iframe:', error);
    }
  };

  // Inject selection script into iframe
  const injectSelectionScript = (enable: boolean) => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    // Prevent multiple simultaneous injections
    const now = Date.now();
    if (enable && (injectionInProgressRef.current || (now - lastInjectionTimeRef.current < 1000))) {
      return;
    }

    if (enable) {
      injectionInProgressRef.current = true;
      lastInjectionTimeRef.current = now;
    }

    // Always try to send message to iframe first (works even with CORS)
    iframe.contentWindow?.postMessage({ 
      type: enable ? 'enableSelection' : 'disableSelection' 
    }, '*');

    // Enviar mensaje para que el iframe cree el script de comunicación
    if (enable) {
      iframe.contentWindow?.postMessage({
        type: 'createMessageHandler',
        timestamp: Date.now()
      }, '*');
      
      console.log('[PreviewPanel] 📤 Mensaje para crear manejador enviado al iframe');
    }

    try {
      const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
      if (!iframeDoc) {
        console.log('Cannot access iframe document (CORS). Selection will work via postMessage if iframe supports it.');
        return;
      }

      if (enable) {
        // Remove existing selection styles if any
        const existingStyle = iframeDoc.getElementById('component-selector-style');
        if (existingStyle) existingStyle.remove();

        // Add selection styles
        const style = iframeDoc.createElement('style');
        style.id = 'component-selector-style';
        style.textContent = `
          * {
            position: relative;
          }
          .component-selector-hover {
            outline: none !important;
            outline-offset: 0 !important;
            cursor: inherit !important;
            z-index: auto !important;
          }
          .component-selector-selected {
            outline: none !important;
            outline-offset: 0 !important;
            background-color: transparent !important;
            z-index: auto !important;
          }
          .resize-handle {
            display: none !important;
          }
          .resize-handle.nw { display: none !important; }
          .resize-handle.ne { display: none !important; }
          .resize-handle.sw { display: none !important; }
          .resize-handle.se { display: none !important; }
          .resize-handle.n { display: none !important; }
          .resize-handle.s { display: none !important; }
          .resize-handle.e { display: none !important; }
          .resize-handle.w { display: none !important; }
        `;
        iframeDoc.head.appendChild(style);
        
        // Inject scrollbar hide styles for mobile view
        if (viewMode === 'mobile') {
          const scrollbarStyle = iframeDoc.createElement('style');
          scrollbarStyle.id = 'mobile-scrollbar-hide';
          scrollbarStyle.textContent = `
            * {
              scrollbar-width: none !important;
              -ms-overflow-style: none !important;
            }
            *::-webkit-scrollbar {
              display: none !important;
              width: 0 !important;
              height: 0 !important;
            }
            html, body {
              scrollbar-width: none !important;
              -ms-overflow-style: none !important;
              overflow-x: hidden !important;
            }
            html::-webkit-scrollbar, body::-webkit-scrollbar {
              display: none !important;
              width: 0 !important;
              height: 0 !important;
            }
          `;
          iframeDoc.head.appendChild(scrollbarStyle);
        }

        // Function to add resize handles
        const addResizeHandles = (element: HTMLElement) => {
          // Remove existing handles
          element.querySelectorAll('.resize-handle').forEach(handle => handle.remove());

          const positions = ['nw', 'ne', 'sw', 'se', 'n', 's', 'e', 'w'];
          
          positions.forEach(pos => {
            const handle = iframeDoc.createElement('div');
            handle.className = `resize-handle ${pos}`;
            handle.setAttribute('data-position', pos);
            element.appendChild(handle);

            handle.addEventListener('mousedown', (e) => {
              e.preventDefault();
              e.stopPropagation();
              startResize(element, pos, e);
            });
          });
        };

        // Function to start resizing
        const startResize = (element: HTMLElement, position: string, e: MouseEvent) => {
          const startX = e.clientX;
          const startY = e.clientY;
          const startWidth = element.offsetWidth;
          const startHeight = element.offsetHeight;
          const startLeft = element.offsetLeft;
          const startTop = element.offsetTop;

          const computedStyle = window.getComputedStyle(element);
          if (computedStyle.position === 'static') {
            element.style.position = 'relative';
          }

          const onMouseMove = (e: MouseEvent) => {
            const deltaX = e.clientX - startX;
            const deltaY = e.clientY - startY;

            let newWidth = startWidth;
            let newHeight = startHeight;
            let newLeft = startLeft;
            let newTop = startTop;

            if (position.includes('e')) {
              newWidth = Math.max(20, startWidth + deltaX);
            }
            if (position.includes('w')) {
              newWidth = Math.max(20, startWidth - deltaX);
              newLeft = startLeft + deltaX;
            }
            if (position.includes('s')) {
              newHeight = Math.max(20, startHeight + deltaY);
            }
            if (position.includes('n')) {
              newHeight = Math.max(20, startHeight - deltaY);
              newTop = startTop + deltaY;
            }

            element.style.width = `${newWidth}px`;
            element.style.height = `${newHeight}px`;
            if (position.includes('w')) {
              element.style.left = `${newLeft}px`;
            }
            if (position.includes('n')) {
              element.style.top = `${newTop}px`;
            }
          };

          const onMouseUp = () => {
            iframeDoc.removeEventListener('mousemove', onMouseMove);
            iframeDoc.removeEventListener('mouseup', onMouseUp);
          };

          iframeDoc.addEventListener('mousemove', onMouseMove);
          iframeDoc.addEventListener('mouseup', onMouseUp);
        };

        // Add event listeners to all elements using event delegation
        const addSelectionListeners = () => {
          // Remove existing listeners first to avoid duplicates
          const existingListeners = (iframeDoc.body as any).__selectionListeners;
          if (existingListeners) {
            iframeDoc.body.removeEventListener('mouseover', existingListeners.mouseover);
            iframeDoc.body.removeEventListener('mouseout', existingListeners.mouseout);
            iframeDoc.body.removeEventListener('click', existingListeners.click);
          }

          // Use event delegation on body for better performance
          const mouseoverHandler = (_e: Event) => {
            // Hover visual highlighting deshabilitado intencionalmente
          };

          const mouseoutHandler = (_e: Event) => {
            // Hover visual highlighting deshabilitado intencionalmente
          };

          const clickHandler = (e: Event) => {
            if (!enable) return;
            const target = e.target as HTMLElement;
            if (!target || target.tagName === 'SCRIPT' || target.tagName === 'STYLE' || target.classList.contains('resize-handle')) return;
            
            e.preventDefault();
            e.stopPropagation();
            
            // Remove previous selection and handles
            iframeDoc.querySelectorAll('.component-selector-selected').forEach(sel => {
              sel.classList.remove('component-selector-selected');
              sel.querySelectorAll('.resize-handle').forEach(handle => handle.remove());
            });
            
            // Add selection to clicked element
            target.classList.add('component-selector-selected');
            
            // Add resize handles
            addResizeHandles(target);
            
            // Get element info
            const tagName = target.tagName.toLowerCase();
            const className = typeof target.className === 'string' ? target.className : '';
            const id = target.id || '';
            const text = target.innerText?.substring(0, 50) || '';
            
            // Try to find matching component
            const componentInfo = {
              tag: tagName,
              className: className,
              id: id,
              text: text
            };
            
            // Send message to parent
            window.parent.postMessage({
              type: 'componentSelected',
              component: componentInfo
            }, '*');
          };

          iframeDoc.body.addEventListener('mouseover', mouseoverHandler, true);
          iframeDoc.body.addEventListener('mouseout', mouseoutHandler, true);
          iframeDoc.body.addEventListener('click', clickHandler, true);

          // Store listeners for cleanup
          (iframeDoc.body as any).__selectionListeners = {
            mouseover: mouseoverHandler,
            mouseout: mouseoutHandler,
            click: clickHandler
          };
        };

        // Wait for iframe to be fully loaded
        const tryInject = () => {
          try {
            if (iframeDoc.body && iframeDoc.body.children.length > 0) {
              addSelectionListeners();
            } else {
              setTimeout(tryInject, 100);
            }
          } catch (e) {
            console.log('Error injecting selection script:', e);
          }
        };

        if (iframeDoc.readyState === 'complete' && iframeDoc.body) {
          setTimeout(tryInject, 100);
        } else {
          iframe.addEventListener('load', () => {
            setTimeout(tryInject, 500);
          }, { once: true });
        }
      } else {
        // Disable selection
        try {
          const style = iframeDoc.getElementById('component-selector-style');
          if (style) style.remove();
          
          // Remove event listeners
          const existingListeners = (iframeDoc.body as any).__selectionListeners;
          if (existingListeners) {
            iframeDoc.body.removeEventListener('mouseover', existingListeners.mouseover);
            iframeDoc.body.removeEventListener('mouseout', existingListeners.mouseout);
            iframeDoc.body.removeEventListener('click', existingListeners.click);
            delete (iframeDoc.body as any).__selectionListeners;
          }
          
          const allElements = iframeDoc.querySelectorAll('*');
          allElements.forEach((el) => {
            const element = el as HTMLElement;
            element.classList.remove('component-selector-hover', 'component-selector-selected');
            element.querySelectorAll('.resize-handle').forEach(handle => handle.remove());
          });
        } catch (e) {
          console.log('Error removing selection:', e);
        }
      }
    } catch (error) {
      // CORS error is expected in many cases, silently handle it
      if (enable) {
        injectionInProgressRef.current = false;
      }
    }
    
    if (enable) {
      // Reset injection flag after a delay
      setTimeout(() => {
        injectionInProgressRef.current = false;
      }, 2000);
    }
  };

  // Expose function to generate component IDs via ref
  // Expose function to ensure a component has a data-component-id
  useEffect(() => {
    if (ensureComponentIdRef) {
      ensureComponentIdRef.current = (componentId: string) => {
        const iframe = iframeRef.current;
        
        // PROTECCIÓN: Verificar que el iframe existe y es válido
        if (!iframe) {
          console.warn('[PreviewPanel] No se puede asegurar ID: iframe no encontrado');
          return;
        }
        
        // PROTECCIÓN: Verificar que tenemos acceso al contentWindow
        if (!iframe.contentWindow) {
          console.warn('[PreviewPanel] No se puede asegurar ID: no hay acceso a contentWindow del iframe');
          return;
        }
        
        // Enviar mensaje al iframe para asegurar que el componente tiene un ID
        try {
          iframe.contentWindow.postMessage({
            type: 'ensureComponentId',
            componentId: componentId
          }, '*');
          console.log('[PreviewPanel] Mensaje ensureComponentId enviado al iframe para:', componentId);
        } catch (error) {
          console.error('[PreviewPanel] Error al enviar mensaje al iframe:', error);
        }
      };
    }
    
    return () => {
      if (ensureComponentIdRef) {
        ensureComponentIdRef.current = null;
      }
      if (getValidComponentIdsRef) {
        getValidComponentIdsRef.current = null;
      }
    };
  }, [ensureComponentIdRef, getValidComponentIdsRef]);

  // Expose function to get valid component IDs from iframe
  useEffect(() => {
    if (getValidComponentIdsRef) {
      getValidComponentIdsRef.current = async (componentIds: string[]): Promise<string[]> => {
        return new Promise((resolve) => {
          const iframe = iframeRef.current;
          if (!iframe || !iframe.contentWindow) {
            console.warn('[PreviewPanel] Iframe not ready, cannot get valid component IDs.');
            resolve([]);
            return;
          }

          const messageId = `get_valid_ids_${Date.now()}`;
          const timeout = setTimeout(() => {
            console.warn('[PreviewPanel] Timeout waiting for iframe response. Resolving with empty array.');
            window.removeEventListener('message', handleIframeResponse);
            resolve([]);
          }, 5000); // 5 seconds timeout

          const handleIframeResponse = (event: MessageEvent) => {
            if (event.data && event.data.type === 'cleanedComponentPropertiesResponse' && event.data.messageId === messageId) {
              clearTimeout(timeout);
              window.removeEventListener('message', handleIframeResponse);
              console.log('[PreviewPanel] Received valid component IDs from iframe:', event.data.validComponentIds.length);
              resolve(event.data.validComponentIds);
            }
          };

          window.addEventListener('message', handleIframeResponse);

          iframe.contentWindow.postMessage({
            type: 'requestValidComponentIds',
            componentIds: componentIds,
            messageId: messageId
          }, '*');
          console.log('[PreviewPanel] Requested valid component IDs from iframe.');
        });
      };
    }

    return () => {
      if (getValidComponentIdsRef) {
        getValidComponentIdsRef.current = null;
      }
    };
  }, [getValidComponentIdsRef]);

  // Listen for messages from iframe
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data.type === 'componentIdsGenerated') {
        // Log detailed information
        if (event.data.sample && event.data.sample.length > 0) {
          console.log('[PreviewPanel] Sample of generated IDs:', event.data.sample);
        }
        if (event.data.allIds) {
          console.log(`[PreviewPanel] Total elements with data-component-id: ${event.data.allIds.length}`);
          // Store in window for easy access
          (window as any).__generatedComponentIds = event.data.allIds;
        }
        
        // Notify parent component about completion
        if (onComponentIdsGenerated) {
          onComponentIdsGenerated(event.data.count || 0, event.data);
        } else {
          // Fallback: show toast directly if callback is not provided
          toast.success(`Se generaron ${event.data.count} data-component-id`, {
            description: 'Todos los elementos ahora tienen identificadores únicos'
          });
        }
      } else if (event.data.type === 'componentIdUpdated') {
        // El iframe ha actualizado un ID antiguo a uno nuevo
        // Necesitamos actualizar las propiedades guardadas en el editor
        const { oldId, newId } = event.data;
        console.log(`[PreviewPanel] ID actualizado de "${oldId}" a "${newId}"`);
        
        // Notificar al componente padre para que actualice las propiedades
        // Esto se manejará en main-studio.tsx
        // Enviar mensaje al padre para actualizar el ID en las propiedades
        window.postMessage({
          type: 'updateComponentId',
          oldId: oldId,
          newId: newId
        }, '*');
      } else if (event.data.type === 'componentSelected') {
        const componentInfo = event.data.component;
        // Try to find matching component in our component tree
        const findComponentByInfo = (comps: ComponentNode[]): ComponentNode | null => {
          for (const comp of comps) {
            if (comp.name.toLowerCase().includes(componentInfo.tag) || 
                comp.id.includes(componentInfo.id) ||
                comp.name.toLowerCase().includes(componentInfo.text.toLowerCase())) {
              return comp;
            }
            if (comp.children) {
              const found = findComponentByInfo(comp.children);
              if (found) return found;
            }
          }
          return null;
        };

        // IMPORTANTE: Siempre usar el componentId del iframe cuando esté disponible
        // Esto asegura que los estilos se apliquen al elemento correcto
        let componentIdToUse: string;
        
        if (componentInfo.componentId) {
          // PRIORIDAD 1: Usar siempre el componentId del iframe si está disponible
          // Este es el ID real del elemento en el DOM (data-component-id)
          componentIdToUse = componentInfo.componentId;
          
          console.log('[PreviewPanel] ✅ Using iframe componentId:', componentIdToUse);
        } else {
          // Si no hay componentId del iframe, generar uno temporal basado en el elemento
          // Este ID se reemplazará cuando se genere el ID real en el iframe
          const timestamp = Date.now();
          componentIdToUse = `temp-${componentInfo.tag}-${timestamp}`;
          console.log('[PreviewPanel] ⚠️ No componentId from iframe, using temporary ID:', componentIdToUse);
        }
        
        console.log('[PreviewPanel] Component selected:', {
          componentIdFromIframe: componentInfo.componentId,
          componentIdToUse: componentIdToUse,
          tag: componentInfo.tag,
          className: componentInfo.className,
          text: componentInfo.text?.substring(0, 50)
        });
        
        // IMPORTANTE: Si el elemento no tiene un data-component-id, asegurarnos de que se genere uno
        // Esto debe hacerse ANTES de llamar a onComponentClick para que el ID esté listo
        if (!componentInfo.componentId) {
          // El elemento no tiene componentId - necesitamos generarlo
          // Enviar mensaje para asegurar que el elemento seleccionado tenga un ID
          // El iframe generará un ID único basado en las características del elemento
          iframeRef.current?.contentWindow?.postMessage({
            type: 'ensureComponentId',
            componentId: componentIdToUse
          }, '*');
          
          console.log('[PreviewPanel] Sent ensureComponentId message, waiting for generated ID...');
          
          // NO llamar a onComponentClick todavía - esperar a que se genere el ID real
          // El ID se actualizará cuando llegue el mensaje componentIdEnsured
          return; // Salir temprano y esperar el ID generado
        } else {
          // El elemento ya tiene un data-component-id, usarlo directamente
          // Verificar que esté aplicado correctamente
          iframeRef.current?.contentWindow?.postMessage({
            type: 'setComponentId',
            componentId: componentInfo.componentId,
            selector: `[data-component-id="${componentInfo.componentId}"]`,
            tag: componentInfo.tag
          }, '*');
          
          console.log('[PreviewPanel] Sent setComponentId message:', {
            componentId: componentInfo.componentId,
            selector: `[data-component-id="${componentInfo.componentId}"]`
          });
          
          // Usar el componentId del iframe directamente
          // IMPORTANTE: Actualizar la selección inmediatamente para que las propiedades se guarden en el elemento correcto
          console.log('[PreviewPanel] ✅ Using iframe componentId directly:', componentIdToUse, {
            tag: componentInfo.tag,
            className: componentInfo.className,
            text: componentInfo.text?.substring(0, 30),
            timestamp: componentInfo.timestamp
          });
          
          // 🔥 FIX CRÍTICO: Verificar si este componente ya tiene propiedades guardadas
          const hasStoredProperties = componentProperties[componentIdToUse];
          
          if (hasStoredProperties) {
            console.log('[PreviewPanel] 📦 Componente ya tiene propiedades guardadas, manteniendo ID:', componentIdToUse);
            // Si ya tiene propiedades, usar ese ID como referencia principal
            onComponentClick(componentIdToUse);
          } else {
            // Componente nuevo, verificar si hay otros componentes con propiedades similares
            const similarComponents = Object.keys(componentProperties).filter(id => {
              // Buscar componentes con propiedades similares (mismo tag)
              const element = document.querySelector(`[data-component-id="${id}"]`);
              return element && element.tagName.toLowerCase() === componentInfo.tag;
            });
            
            if (similarComponents.length > 0) {
              console.warn('[PreviewPanel] ⚠️ Componentes similares encontrados con propiedades guardadas:', similarComponents);
              console.warn('[PreviewPanel] 💡 Considera si quieres usar uno de estos IDs en su lugar');
            }
            
            // Para componentes nuevos, proceder normalmente
            onComponentClick(componentIdToUse);
          }
        }
      } else if (event.data.type === 'componentIdEnsured') {
        // El iframe ha generado/asegurado un componentId para el elemento seleccionado
        // Actualizar el selectedComponentId con el ID generado para que las propiedades se guarden correctamente
        const { requestedId, generatedId } = event.data;
        
        console.log('[PreviewPanel] ✅ ComponentId ensured:', {
          requestedId: requestedId,
          generatedId: generatedId
        });
        
        // IMPORTANTE: Siempre usar el ID generado por el iframe
        // Este es el ID real del elemento seleccionado en el DOM
        if (generatedId) {
          console.log('[PreviewPanel] ✅ Updating selectedComponentId to generated ID:', generatedId);
          
          // Verificar que el elemento con este ID existe en el iframe
          iframeRef.current?.contentWindow?.postMessage({
            type: 'verifyComponentId',
            componentId: generatedId
          }, '*');
          
          // Actualizar la selección con el ID generado (este es el ID real del elemento)
          // Esto debe hacerse inmediatamente para que las propiedades se guarden en el elemento correcto
          onComponentClick(generatedId);
          
          // Si el ID generado es diferente al solicitado, también mover propiedades si existen
          if (generatedId !== requestedId && componentProperties[requestedId]) {
            console.log('[PreviewPanel] ⚠️ Moving properties from', requestedId, 'to', generatedId);
            // Notificar al padre para mover las propiedades
            onPropertyChange?.(generatedId, componentProperties[requestedId]);
            // Las propiedades se moverán en main-studio cuando reciba el mensaje
          }
        }
      } else if (event.data.type === 'componentResized') {
        // Manejar cambios de tamaño del componente
        const resizeInfo = event.data.component;
        if (resizeInfo.componentId && onPropertyChange) {
          // Obtener las propiedades actuales del componente
          const currentProps = componentProperties[resizeInfo.componentId] || {};
          
          // Actualizar las propiedades de tamaño
          const updatedProps = {
            ...currentProps,
            size: {
              ...currentProps.size,
              width: `${resizeInfo.width}px`,
              height: `${resizeInfo.height}px`,
              position: currentProps.size?.position || 'relative'
            }
          };
          
          // Si hay cambios de posición (left, top), también guardarlos
          if (resizeInfo.left !== undefined || resizeInfo.top !== undefined) {
            updatedProps.size = {
              ...updatedProps.size,
              left: resizeInfo.left !== undefined ? `${resizeInfo.left}px` : currentProps.size?.left,
              top: resizeInfo.top !== undefined ? `${resizeInfo.top}px` : currentProps.size?.top
            };
          }
          
          console.log('[PreviewPanel] Component resized:', {
            componentId: resizeInfo.componentId,
            width: resizeInfo.width,
            height: resizeInfo.height,
            updatedProps
          });
          
          // Actualizar las propiedades del componente
          onPropertyChange(resizeInfo.componentId, updatedProps);
        }
      } else if (event.data.type === 'updateTextContent') {
        // Manejar la actualización del contenido del texto
        const { componentId, newText } = event.data;
        
        if (componentId && newText !== undefined) {
          console.log('[PreviewPanel] 📝 Recibida solicitud para actualizar texto:', {
            componentId,
            newText
          });
          
          // Enviar el mensaje al iframe para que actualice el texto
          iframeRef.current?.contentWindow?.postMessage({
            type: 'updateTextContent',
            componentId: componentId,
            newText: newText
          }, '*');
          
          toast.success('Actualizando texto en la vista previa...');
        }
      } else if (event.data.type === 'textContentUpdated') {
        // Manejar la respuesta del iframe sobre la actualización del texto
        const { componentId, newText, success, error } = event.data;
        
        if (success) {
          toast.success('✅ Texto actualizado correctamente', {
            description: `Componente: ${componentId}`
          });
          console.log('[PreviewPanel] ✅ Texto actualizado exitosamente en el iframe:', {
            componentId,
            newText
          });
        } else {
          toast.error('❌ Error al actualizar texto', {
            description: error || 'No se pudo encontrar el elemento'
          });
          console.error('[PreviewPanel] ❌ Error al actualizar texto en el iframe:', {
            componentId,
            error
          });
        }
      } else if (event.data.type === 'requestTextUpdate') {
        // El PropertyEditor solicita actualizar el texto en el iframe
        const { componentId, newText } = event.data;
        
        console.log('[PreviewPanel] 📝 Solicitud de actualización de texto recibida:', {
          componentId,
          newText
        });
        
        // Enviar mensaje al iframe para que actualice su propio texto
        const iframe = iframeRef.current;
        if (iframe && iframe.contentWindow) {
          console.log('[PreviewPanel] 📤 Enviando mensaje de actualización al iframe');
          
          iframe.contentWindow.postMessage({
            type: 'updateTextContent',
            componentId: componentId,
            newText: newText
          }, '*');
          
          toast.success('✅ Texto actualizado en la vista previa');
          console.log('[PreviewPanel] ✅ Mensaje de actualización enviado al iframe');
        } else {
          toast.error('No se pudo encontrar la vista previa');
        }
      } else if (event.data.type === 'iconProperties') {
        // Reenviar actualizaciones de icono al iframe
        const iconProperties = event.data.iconProperties;
        if (iconProperties && Object.keys(iconProperties).length > 0) {
          console.log('[PreviewPanel] 📤 Reenviando iconProperties al iframe:', iconProperties);
          iframeRef.current?.contentWindow?.postMessage({
            type: 'applyComponentIcons',
            iconProperties: iconProperties
          }, '*');
        }
      } else if (event.data.type === 'createMessageHandler') {
        console.log('[PreviewPanel] 📤 Solicitud para crear manejador recibida del iframe');
        
        // Intentar inyectar el script directamente en el iframe
        try {
          const iframe = iframeRef.current;
          if (!iframe) return;
          
          const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
          if (!iframeDoc) {
            console.log('[PreviewPanel] ❌ No se puede acceder al documento del iframe (CORS)');
            return;
          }
          
          // Crear y ejecutar el script directamente en el iframe
          const script = iframeDoc.createElement('script');
          script.textContent = `
            console.log('[Iframe] 🚀 Script de comunicación creado e inyectado');
            
            // Crear el manejador de mensajes
            window.addEventListener('message', function(event) {
              console.log('[Iframe] 📨 Mensaje recibido:', event.data?.type);
              
              if (event.data.type === 'enableSelection') {
                console.log('[Iframe] ✅ Selección habilitada');
                window.parent.postMessage({
                  type: 'selectionReady'
                }, '*');
              } else if (event.data.type === 'disableSelection') {
                console.log('[Iframe] ✅ Selección deshabilitada');
                  // Send confirmation back to parent
                  window.parent.postMessage({
                    type: 'textContentUpdated',
                    componentId: componentId,
                    newText: newText,
                    success: true
                  }, '*');
                  
                  console.log('[Iframe] ✅ Texto actualizado exitosamente');
                } else {
                  console.warn('[Iframe] ❌ Elemento no encontrado con componentId:', componentId);
                  
                  // Send error back to parent
                  window.parent.postMessage({
                    type: 'textContentUpdated',
                    componentId: componentId,
                    newText: newText,
                    success: false,
                    error: 'Element not found'
                  }, '*');
                }
              } else if (event.data.type === 'updateTextContents') {
                // Actualizar múltiples textos a la vez
                const { updates } = event.data;
                
                console.log('[Iframe] 📝 Recibidas actualizaciones de texto múltiples:', updates);
                
                updates.forEach(({ componentId, textContent }) => {
                  const element = document.querySelector('[data-component-id="' + componentId + '"]');
                  
                  if (element) {
                    console.log('[Iframe] ✅ Actualizando texto:', {
                      componentId,
                      textContent
                    });
                    
                    // Actualizar el texto
                    if (element.tagName.toLowerCase() === 'input' || element.tagName.toLowerCase() === 'textarea') {
                      element.value = textContent;
                    } else {
                      element.innerText = textContent;
                    }
                  } else {
                    console.warn('[Iframe] ❌ Elemento no encontrado:', componentId);
                  }
                });
                
                console.log('[Iframe] ✅ Actualizaciones de texto completadas');
              } else if (event.data.type === 'applyComponentStyles') {
                const { css, componentProperties } = event.data;
                
                console.log('[Iframe] 🎨 Recibidos estilos y propiedades:', {
                  hasCSS: !!css,
                  hasComponentProperties: !!componentProperties,
                  componentCount: componentProperties ? Object.keys(componentProperties).length : 0
                });
                
                // Apply CSS styles
                if (css) {
                  // Remove existing style element if any
                  const existingStyle = document.getElementById('component-styles');
                  if (existingStyle) existingStyle.remove();
                  
                  // Add new styles
                  const styleElement = document.createElement('style');
                  styleElement.id = 'component-styles';
                  styleElement.textContent = css;
                  
          updates.forEach(({ componentId, textContent }) => {
            const element = document.querySelector('[data-component-id="' + componentId + '"]');
                    
            if (element) {
              console.log('[Iframe] ✅ Actualizando texto:', {
                componentId,
                textContent
              });
                      
              // Actualizar el texto
              if (element.tagName.toLowerCase() === 'input' || element.tagName.toLowerCase() === 'textarea') {
                element.value = textContent;
              } else {
                element.innerText = textContent;
              }
            } else {
              console.warn('[Iframe] ❌ Elemento no encontrado:', componentId);
            }
          });
                  
          console.log('[Iframe] ✅ Actualizaciones de texto completadas');
        } else if (event.data.type === 'applyComponentStyles') {
          const { css, componentProperties } = event.data;
                  
          console.log('[Iframe] 🎨 Recibidos estilos y propiedades:', {
            hasCSS: !!css,
            hasComponentProperties: !!componentProperties,
            componentCount: componentProperties ? Object.keys(componentProperties).length : 0
          });
                  
          // Apply CSS styles
          if (css) {
            // Remove existing style element if any
            const existingStyle = document.getElementById('component-styles');
            if (existingStyle) existingStyle.remove();
                    
            // Add new styles
            const styleElement = document.createElement('style');
            styleElement.id = 'component-styles';
            styleElement.textContent = css;
            document.head.appendChild(styleElement);
                    
            console.log('[Iframe] ✅ Estilos CSS aplicados');
          }
                  
          // Apply text content for components that have it (now handled by CSS)
          if (componentProperties) {
            console.log('[PreviewPanel] 📝 Text content handled by CSS, no message sending needed');
          }
        } else if (event.data.type === 'loadGoogleFonts') {
          // Load Google Fonts
          const { fontsUrl } = event.data;
          console.log('[Iframe] 🎨 Loading Google Fonts:', fontsUrl);
          
          // Remove existing Google Fonts link
          const existingLink = document.querySelector('link[data-zeus-google-fonts]');
          if (existingLink) existingLink.remove();
          
          // Add new Google Fonts link
          const link = document.createElement('link');
          link.rel = 'stylesheet';
          link.href = fontsUrl;
          link.setAttribute('data-zeus-google-fonts', 'true');
          document.head.appendChild(link);
          
          console.log('[Iframe] ✅ Google Fonts loaded successfully');
        }
            // Enviar confirmación al padre
            window.parent.postMessage({
              type: 'iframeScriptReady',
              timestamp: Date.now()
            }, '*');
          `;
          
          iframeDoc.head.appendChild(script);
          console.log('[PreviewPanel] ✅ Script de comunicación inyectado directamente en el iframe');
          
        } catch (error) {
          console.error('[PreviewPanel] ❌ Error al inyectar script en iframe:', error);
        }
      } else if (event.data.type === 'testResponse') {
        console.log('[PreviewPanel] 🧪 Respuesta de prueba recibida del iframe:', {
          timestamp: event.data.timestamp,
          received: event.data.received
        });
        toast.success('✅ Comunicación con iframe funcionando');
      } else if (event.data.type === 'executeScript' && event.data.scriptCode) {
        console.log('[PreviewPanel] 📤 Ejecutando script recibido del iframe:', event.data.scriptCode.substring(0, 100) + '...');
        
        // Ejecutar el script recibido
        try {
          eval(event.data.scriptCode);
          console.log('[PreviewPanel] ✅ Script ejecutado correctamente');
        } catch (error) {
          console.error('[PreviewPanel] ❌ Error al ejecutar script:', error);
        }
      } else if (event.data.type === 'iframeScriptReady') {
        console.log('[PreviewPanel] ✅ Script del iframe inyectado correctamente:', {
          timestamp: event.data.timestamp
        });
      } else if (event.data.type === 'debugLog') {
        // 🔥 NUEVO: Mostrar logs de debugging del component-selector-helper
        console.log(event.data.message, event.data.data);
      }
      
      // Handle selection mode enable/disable from iframe
      // Note: We don't re-inject here to avoid infinite loops
      // The script should be injected when selectionMode changes, not when iframe reports ready
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [components, onComponentClick, selectionMode, componentProperties, selectedComponentId, onPropertyChange]);

  // Re-inject script when selection mode changes
  useEffect(() => {
    if (selectionMode && iframeRef.current && !injectionInProgressRef.current) {
      const iframe = iframeRef.current;
      // Wait a bit for iframe to be ready
      const timer = setTimeout(() => {
        if (selectionMode) {
          injectSelectionScript(true);
        }
      }, 500);
      return () => clearTimeout(timer);
    } else if (!selectionMode && iframeRef.current) {
      injectionInProgressRef.current = false;
      injectSelectionScript(false);
    }
  }, [selectionMode]);

  // Inject scrollbar styles in main document head
  useEffect(() => {
    const styleId = 'preview-scrollbar-styles';
    let styleElement = document.getElementById(styleId) as HTMLStyleElement;
    
    if (!styleElement) {
      styleElement = document.createElement('style');
      styleElement.id = styleId;
      document.head.appendChild(styleElement);
    }

    if (viewMode === 'mobile') {
      styleElement.textContent = `
        /* Hide scrollbars in mobile view */
        [data-preview-container] {
          scrollbar-width: none !important;
          -ms-overflow-style: none !important;
        }
        [data-preview-container]::-webkit-scrollbar {
          display: none !important;
          width: 0 !important;
          height: 0 !important;
        }
        [data-preview-content] {
          scrollbar-width: none !important;
          -ms-overflow-style: none !important;
        }
        [data-preview-content]::-webkit-scrollbar {
          display: none !important;
          width: 0 !important;
          height: 0 !important;
        }
      `;
    } else {
      styleElement.textContent = `
        /* Thin scrollbars for desktop/tablet */
        [data-preview-container] {
          scrollbar-width: thin !important;
          scrollbar-color: rgba(156, 163, 175, 0.3) transparent !important;
        }
        [data-preview-container]::-webkit-scrollbar {
          width: 4px !important;
          height: 4px !important;
        }
        [data-preview-container]::-webkit-scrollbar-track {
          background: transparent !important;
        }
        [data-preview-container]::-webkit-scrollbar-thumb {
          background-color: rgba(156, 163, 175, 0.3) !important;
          border-radius: 2px !important;
        }
        [data-preview-container]::-webkit-scrollbar-thumb:hover {
          background-color: rgba(156, 163, 175, 0.3) !important;
        }
        [data-preview-content] {
          scrollbar-width: thin !important;
          scrollbar-color: rgba(156, 163, 175, 0.3) transparent !important;
        }
        [data-preview-content]::-webkit-scrollbar {
          width: 4px !important;
          height: 4px !important;
        }
        [data-preview-content]::-webkit-scrollbar-track {
          background: transparent !important;
        }
        [data-preview-content]::-webkit-scrollbar-thumb {
          background-color: rgba(156, 163, 175, 0.3) !important;
          border-radius: 2px !important;
        }
        [data-preview-content]::-webkit-scrollbar-thumb:hover {
          background-color: rgba(156, 163, 175, 0.3) !important;
        }
      `;
    }

    return () => {
      // Don't remove on unmount, keep styles
    };
  }, [viewMode]);

  // Inject scrollbar styles when viewMode changes in iframe
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const injectScrollbarStyles = () => {
      try {
        const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
        if (!iframeDoc || !iframeDoc.body) return;

        // Remove existing scrollbar style
        const existingStyle = iframeDoc.getElementById('mobile-scrollbar-hide');
        if (existingStyle) existingStyle.remove();

        const scrollbarStyle = iframeDoc.createElement('style');
        scrollbarStyle.id = 'mobile-scrollbar-hide';
        
        if (viewMode === 'mobile') {
          scrollbarStyle.textContent = `
            * {
              scrollbar-width: none !important;
              -ms-overflow-style: none !important;
            }
            *::-webkit-scrollbar {
              display: none !important;
              width: 0 !important;
              height: 0 !important;
            }
            html, body {
              scrollbar-width: none !important;
              -ms-overflow-style: none !important;
            }
            html::-webkit-scrollbar, body::-webkit-scrollbar {
              display: none !important;
              width: 0 !important;
              height: 0 !important;
            }
          `;
        } else {
          scrollbarStyle.textContent = `
            * {
              scrollbar-width: thin !important;
              scrollbar-color: rgba(156, 163, 175, 0.3) transparent !important;
            }
            *::-webkit-scrollbar {
              width: 4px !important;
              height: 4px !important;
            }
            *::-webkit-scrollbar-track {
              background: transparent !important;
            }
            *::-webkit-scrollbar-thumb {
              background-color: rgba(156, 163, 175, 0.3) !important;
              border-radius: 2px !important;
            }
            *::-webkit-scrollbar-thumb:hover {
              background-color: rgba(156, 163, 175, 0.3) !important;
            }
          `;
        }
        
        iframeDoc.head.appendChild(scrollbarStyle);
      } catch (error) {
        // CORS error, can't inject
      }
    };

    // Try to inject immediately
    injectScrollbarStyles();

    // Also try after iframe loads
    iframe.addEventListener('load', injectScrollbarStyles);
    return () => {
      iframe.removeEventListener('load', injectScrollbarStyles);
    };
  }, [viewMode]);

  // Inject component styles into iframe using postMessage
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !isProjectLoaded || !generatedCss) {
      console.log('[PreviewPanel] Not sending styles - iframe:', !!iframe, 'isProjectLoaded:', isProjectLoaded, 'hasGeneratedCss:', !!generatedCss);
      return;
    }

    const sendStylesToIframe = () => {
      // Small delay to ensure iframe is ready
      setTimeout(() => {
          iframe.contentWindow?.postMessage({
            type: 'applyComponentStyles',
            css: generatedCss,
            componentProperties: componentProperties, // 🔥 NUEVO: Incluir componentProperties para actualizar imágenes
          }, '*');
          console.log('[PreviewPanel] Sent generated CSS to iframe via postMessage');
          console.log('[PreviewPanel] 📤 ComponentProperties incluidos:', Object.keys(componentProperties));
      }, 100);
    };

    sendStylesToIframe();

    const handleIframeLoad = () => {
      console.log('[PreviewPanel] Iframe loaded, re-sending styles...');
      setTimeout(sendStylesToIframe, 500);
    };
    
    iframe.addEventListener('load', handleIframeLoad);
    
    return () => {
      iframe.removeEventListener('load', handleIframeLoad);
    };
  }, [generatedCss, isProjectLoaded]);

  // Handle real-time text updates
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !isProjectLoaded) {
      return;
    }

    if (componentProperties) {
      const textUpdates = Object.entries(componentProperties)
        .filter(([_, props]: [string, any]) => props.typography?.textContent)
        .map(([componentId, props]: [string, any]) => ({
          componentId,
          textContent: props.typography.textContent
        }));
      
      if (textUpdates.length > 0) {
        // Small delay to ensure iframe is ready for messages
        setTimeout(() => {
            iframe.contentWindow?.postMessage({
                type: 'updateTextContents',
                updates: textUpdates
            }, '*');
        }, 150); // Slightly longer delay than CSS to avoid race conditions
      }
    }
  }, [componentProperties, isProjectLoaded]);
  // Limpiar el timeout de iconos al desmontar
  useEffect(() => {
    return () => {
      if (iconTimeoutRef.current) {
        clearTimeout(iconTimeoutRef.current);
      }
    };
  }, []);

  // Actualizar iframe cuando cambia devServerUrl (por ejemplo, cuando se obtiene la URL del túnel)
  useEffect(() => {
    console.log('[PreviewPanel] 🔄 useEffect ejecutado para devServerUrl:', {
      devServerUrl,
      isProjectLoaded,
      useLivePreview,
      hasIframe: !!iframeRef.current
    });
    
    const iframe = iframeRef.current;
    if (!iframe) {
      console.log('[PreviewPanel] ⚠️ Iframe no existe todavía');
      return;
    }
    
    if (!useLivePreview) {
      console.log('[PreviewPanel] ⚠️ useLivePreview está desactivado');
      return;
    }
    
    // Si el proyecto no está cargado, esperar a que se cargue
    if (!isProjectLoaded) {
      console.log('[PreviewPanel] ⏳ Esperando a que el proyecto se cargue antes de actualizar iframe');
      return;
    }

    // Si el src del iframe es diferente al devServerUrl, actualizarlo
    const currentSrc = iframe.src || '';
    const targetSrc = devServerUrl || '';
    
    console.log('[PreviewPanel] 🔍 Comparando URLs:', {
      currentSrc,
      targetSrc,
      areEqual: currentSrc === targetSrc,
      currentPort,
      targetIncludesProxy: targetSrc.includes('/proxy/')
    });
    
    // Comparar URLs normalizadas (sin trailing slashes)
    const normalizeUrl = (url: string) => {
      if (!url) return '';
      return url.trim().replace(/\/$/, '');
    };
    const normalizedCurrent = normalizeUrl(currentSrc);
    const normalizedTarget = normalizeUrl(targetSrc);
    
    // SIEMPRE actualizar si las URLs son diferentes (comparación exacta, no normalizada)
    // Esto asegura que el iframe se actualice cuando cambia el puerto, incluso si la URL normalizada es similar
    if (currentSrc !== targetSrc && targetSrc) {
      console.log('[PreviewPanel] 🔄 Actualizando iframe con nueva URL:', targetSrc);
      console.log('[PreviewPanel] 🔍 URL actual del iframe:', currentSrc);
      console.log('[PreviewPanel] 🔍 Nueva URL a establecer:', targetSrc);
      console.log('[PreviewPanel] 🔍 URLs normalizadas - Actual:', normalizedCurrent);
      console.log('[PreviewPanel] 🔍 URLs normalizadas - Target:', normalizedTarget);
      setIframeError(false); // Resetear error al cambiar URL
      // Forzar recarga del iframe cambiando su key
      const newKey = iframeKey + 1;
      console.log('[PreviewPanel] 🔑 Cambiando iframeKey de', iframeKey, 'a', newKey);
      setIframeKey(newKey);
    } else if (targetSrc && currentSrc === targetSrc) {
      console.log('[PreviewPanel] ✅ Iframe ya tiene la URL correcta (exacta):', targetSrc);
      console.log('[PreviewPanel] 🔍 URL actual del iframe (exacta):', currentSrc);
    } else {
      console.log('[PreviewPanel] ⚠️ No se actualiza el iframe:', {
        currentSrc,
        targetSrc,
        normalizedCurrent,
        normalizedTarget,
        hasIframe: !!iframe,
        useLivePreview,
        isProjectLoaded
      });
    }
  }, [devServerUrl, isProjectLoaded, useLivePreview]);
  
  // Log cuando se monta el iframe para debugging
  useEffect(() => {
    console.log('[PreviewPanel] 📊 Estado del preview:', {
      devServerUrl,
      isProjectLoaded,
      useLivePreview,
      iframeError,
      iframeKey,
      currentPort
    });
    console.log('[PreviewPanel] 🔍 URL del iframe actual (desde ref):', iframeRef.current?.src);
  }, [devServerUrl, isProjectLoaded, useLivePreview, iframeError, iframeKey, currentPort]);

  // Convert component properties to inline styles
  const getComponentInlineStyles = (componentId: string): React.CSSProperties => {
    const props = componentProperties[componentId];
    if (!props) return {};

    const styles: React.CSSProperties = {};

    // Background
    if (props.background) {
      if (props.background.type === 'solid') {
        styles.backgroundColor = props.background.color;
      } else if (props.background.type === 'gradient') {
        styles.background = props.background.gradient;
      } else if (props.background.type === 'image' && props.background.image) {
        // Para la opacidad de la imagen, necesitamos usar una técnica especial
        // para que solo afecte a la imagen y no al contenido
        const positionX = props.background.positionX || 50;
        const positionY = props.background.positionY || 50;
        const imageSize = props.background.imageSize || 'cover';
        const imageOpacity = props.background.imageOpacity || 1;
        
        if (imageSize === 'custom') {
          const customSize = props.background.customSize || 100;
          styles.backgroundSize = `${customSize}% auto`;
        } else {
          styles.backgroundSize = imageSize;
        }
        
        styles.backgroundPosition = `${positionX}% ${positionY}%`;
        styles.backgroundRepeat = imageSize === 'repeat' ? 'repeat' : 'no-repeat';
        
        // Si la opacidad no es 1, no podemos usar opacity directamente porque afectaría al contenido
        // En su lugar, necesitamos usar una técnica con pseudo-elemento o rgba
        if (imageOpacity !== 1) {
          // Para estilos inline, no podemos usar pseudo-elementos directamente
          // Así que usamos una técnica alternativa: crear un wrapper o usar CSS custom properties
          styles.position = 'relative';
          // La opacidad se manejará a través del CSS string con pseudo-elemento
          (styles as any).dataImageOpacity = imageOpacity;
          (styles as any).dataImageUrl = props.background.image;
          (styles as any).dataImageSize = imageSize;
          (styles as any).dataImagePosition = `${positionX}% ${positionY}%`;
        } else {
          // Si opacidad es 1, aplicar la imagen normalmente
          styles.backgroundImage = `url(${props.background.image})`;
        }
      }
    }

    // Border
    if (props.border) {
      styles.border = `${props.border.width}px ${props.border.style} ${props.border.color}`;
      styles.borderRadius = `${props.border.radius}px`;
    }

    // Size & Position
    if (props.size) {
      if (props.size.width !== 'auto') styles.width = props.size.width;
      if (props.size.height !== 'auto') styles.height = props.size.height;
      styles.padding = `${props.size.padding}px`;
      styles.margin = `${props.size.margin}px`;
      styles.position = props.size.position;
    }

    // Typography
    if (props.typography) {
      styles.fontFamily = props.typography.fontFamily;
      styles.fontSize = `${props.typography.fontSize}px`;
      styles.fontWeight = props.typography.fontWeight;
      
      // Verificar si es degradado o color sólido
      const textType = (props.typography as any)?.textType || 'solid';
      if (textType === 'gradient' && (props.typography as any)?.textGradient) {
        // Aplicar degradado al texto
        styles.background = (props.typography as any).textGradient;
        styles.WebkitBackgroundClip = 'text';
        styles.WebkitTextFillColor = 'transparent';
        styles.backgroundClip = 'text';
      } else {
        // Aplicar color sólido
        styles.color = props.typography.color;
      }
      
      styles.lineHeight = props.typography.lineHeight;
      styles.textAlign = props.typography.alignment;
      
      // Text Stroke (Borde del Texto)
      if (props.typography.textStroke && props.typography.textStroke.enabled) {
        const strokeColor = props.typography.textStroke.color || '#000000';
        const strokeWidth = props.typography.textStroke.width || 1;
        const strokeOpacity = props.typography.textStroke.opacity || 1;
        
        // Aplicar stroke usando WebKitTextStroke para React
        (styles as any).WebkitTextStroke = `${strokeWidth}px ${strokeColor}`;
        
        // Para opacidad, necesitamos convertir a RGBA si es hex
        if (strokeOpacity < 1 && strokeColor.startsWith('#')) {
          const r = parseInt(strokeColor.slice(1, 3), 16);
          const g = parseInt(strokeColor.slice(3, 5), 16);
          const b = parseInt(strokeColor.slice(5, 7), 16);
          const rgbaColor = `rgba(${r}, ${g}, ${b}, ${strokeOpacity})`;
          (styles as any).WebkitTextStroke = `${strokeWidth}px ${rgbaColor}`;
        }
      }
      
      // Text Shadow (Sombra del Texto)
      if (props.typography.textShadow && props.typography.textShadow.enabled) {
        const shadowColor = props.typography.textShadow.color || '#000000';
        const shadowBlur = props.typography.textShadow.blur || 4;
        const shadowOffsetX = props.typography.textShadow.offsetX || 2;
        const shadowOffsetY = props.typography.textShadow.offsetY || 2;
        const shadowOpacity = props.typography.textShadow.opacity || 0.5;
        
        // Ajustar opacidad del color
        let finalShadowColor = shadowColor;
        if (shadowOpacity < 1 && shadowColor.startsWith('#')) {
          const r = parseInt(shadowColor.slice(1, 3), 16);
          const g = parseInt(shadowColor.slice(3, 5), 16);
          const b = parseInt(shadowColor.slice(5, 7), 16);
          finalShadowColor = `rgba(${r}, ${g}, ${b}, ${shadowOpacity})`;
        } else if (shadowOpacity < 1 && shadowColor.startsWith('rgb')) {
          finalShadowColor = shadowColor.replace('rgb', 'rgba').replace(')', `, ${shadowOpacity})`);
        }
        
        styles.textShadow = `${shadowOffsetX}px ${shadowOffsetY}px ${shadowBlur}px ${finalShadowColor}`;
      }
    }

    // Shadow
    if (props.shadow) {
      const shadowColor = props.shadow.color || '#000000';
      const opacity = props.shadow.opacity || 0.1;
      const hexToRgba = (hex: string, alpha: number): string => {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
      };
      const rgba = hexToRgba(shadowColor, opacity);
      styles.boxShadow = `${props.shadow.offsetX}px ${props.shadow.offsetY}px ${props.shadow.blur}px ${props.shadow.spread}px ${rgba}`;
    }

    return styles;
  };

  // Render component recursively
  const renderComponent = (component: ComponentNode, depth: number = 0): React.ReactNode => {
    const isSelected = selectedComponentId === component.id;
    const baseClasses = cn(
      "relative transition-all duration-200 cursor-pointer border-2 border-dashed border-transparent",
      isSelected && "ring-2 ring-blue-500 ring-offset-2 border-blue-500"
    );

    const getComponentStyles = () => {
      switch (component.type) {
        case 'container':
          return "min-h-[100px] p-4 bg-muted/50 rounded-lg m-2";
        case 'button':
          return "px-6 py-3 bg-primary text-foreground rounded-lg m-2 transition-colors inline-block";
        case 'text':
          return "p-4 text-foreground/80 m-2";
        case 'input':
          return "px-4 py-2 bg-muted/80 text-foreground rounded border border-border/50 m-2";
        case 'image':
          return "w-32 h-32 bg-muted/80 rounded m-2 flex items-center justify-center";
        default:
          return "p-4 bg-muted/30 rounded m-2";
      }
    };

    // Get inline styles from component properties
    const inlineStyles = getComponentInlineStyles(component.id);

    return (
      <div
        key={component.id}
        data-component-id={component.id}
        className={cn(baseClasses, getComponentStyles())}
        style={{ marginLeft: `${depth * 16}px`, ...inlineStyles }}
        {...(((inlineStyles as any).dataImageOpacity && (inlineStyles as any).dataImageOpacity !== 1) && {
          'data-image-opacity': (inlineStyles as any).dataImageOpacity,
          'data-image-url': (inlineStyles as any).dataImageUrl,
          'data-image-size': (inlineStyles as any).dataImageSize,
          'data-image-position': (inlineStyles as any).dataImagePosition,
        })}
        onClick={(e) => {
          e.stopPropagation();
          onComponentClick(component.id);
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          if (component.type === 'text') {
            onComponentClick(component.id);
          }
        }}
      >
        {/* Component Label */}
        <div className="absolute top-1 left-1 bg-primary/80 text-foreground text-xs px-2 py-0.5 rounded opacity-100 transition-opacity pointer-events-none">
          {component.name} ({component.type})
        </div>

        {/* Component Content */}
        {component.type === 'text' && (
          <div className="text-foreground/80">{component.name}</div>
        )}
        {component.type === 'button' && (
          <div className="text-foreground">{component.name}</div>
        )}
        {component.type === 'input' && (
          <input type="text" placeholder={component.name} className="bg-transparent outline-none w-full" readOnly />
        )}
        {component.type === 'image' && (
          <div className="text-muted-foreground text-sm">Image: {component.name}</div>
        )}
        {component.type === 'container' && (
          <div className="text-foreground/70 text-sm font-medium mb-2">{component.name}</div>
        )}

        {/* Selected Indicator */}
        {isSelected && (
          <div className="absolute -top-2 -right-2 bg-primary text-foreground text-xs px-2 py-1 rounded shadow-lg z-10">
            Selected
          </div>
        )}

        {/* Render Children */}
        {component.children && component.children.length > 0 && (
          <div className="mt-2 space-y-2">
            {component.children.map((child) => renderComponent(child, depth + 1))}
          </div>
        )}

        {/* Empty Container Indicator */}
        {component.type === 'container' && (!component.children || component.children.length === 0) && (
          <div className="text-muted-foreground/60 text-xs italic mt-2">Empty container - add components here</div>
        )}
      </div>
    );
  };

  return (
    <div className={`flex flex-col h-full bg-gradient-to-br from-gray-900 to-gray-800 ${isMaximised ? 'fixed inset-0 z-50' : ''}`}>
      {/* Preview Controls - SIEMPRE VISIBLE y con ancho completo en pantalla completa */}
      <div className={`flex items-center justify-between p-4 border-b bg-background/80 backdrop-blur ${isMaximised ? 'fixed top-16 left-0 right-0 z-[100] bg-background w-full' : ''}`}>
        <div className="flex items-center space-x-2">
          <span className="text-sm font-medium">{t('preview')}</span>
          {isMaximised && (
            <>
              <div className="h-6 w-px bg-muted"></div>
            </>
          )}
          {isProjectLoaded && useLivePreview && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const newMode = !selectionMode;
                    setSelectionMode(newMode);
                    // Wait a bit for state to update, then inject script
                    setTimeout(() => {
                      injectSelectionScript(newMode);
                    }, 100);
                  }}
                  className={`border-[1.5px] bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-white/20 via-white/10 to-transparent text-foreground ${
                    selectionMode 
                      ? 'border-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]' 
                      : 'border-input shadow-[0_0_8px_hsl(var(--input)/0.4)]'
                  }`}
                >
                  {selectionMode ? (
                    <MousePointer2 className="h-4 w-4 mr-2" />
                  ) : (
                    <MousePointer className="h-4 w-4 mr-2" />
                  )}
                  {selectionMode ? t('selectionActive') : t('selectComponents')}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {selectionMode ? t('selectionTooltip') : t('enableSelection')}
              </TooltipContent>
            </Tooltip>
          )}
          <div className="flex items-center space-x-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setZoom(Math.min(2, zoom + 0.1))}
                  disabled={zoom >= 2}
                >
                  <ZoomIn className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('zoomIn')}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setZoom(Math.max(0.5, zoom - 0.1))}
                  disabled={zoom <= 0.5}
                >
                  <ZoomOut className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('zoomOut')}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setZoom(1)}
                >
                  <RotateCcw className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('resetZoom')}</TooltipContent>
            </Tooltip>
            <span className="text-xs text-muted-foreground px-2">
              {Math.round(zoom * 100)}%
            </span>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          {/* Port Control */}
          {onPortChange && (
            <>
              <div className="flex items-center space-x-2 px-2">
                <span className="text-sm text-muted-foreground">{t('portLabel')}</span>
                <input
                  type="number"
                  value={localPort}
                  onChange={(e) => {
                    setLocalPort(e.target.value);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      console.log('[PreviewPanel] 🔘 Enter presionado, aplicando puerto:', localPort);
                      if (onPortChange) {
                        onPortChange(localPort);
                      } else {
                        console.error('[PreviewPanel] ❌ onPortChange no está definido');
                      }
                    }
                  }}
                  className="w-20 bg-card text-foreground/70 px-2 py-1 rounded-md text-sm border border-border/50 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
                  placeholder="3000"
                />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        console.log('[PreviewPanel] 🔘 Botón de aplicar puerto clickeado');
                        console.log('[PreviewPanel] 🔍 localPort:', localPort);
                        console.log('[PreviewPanel] 🔍 onPortChange definido:', !!onPortChange);
                        if (onPortChange) {
                          console.log('[PreviewPanel] ✅ Llamando a onPortChange con:', localPort);
                          onPortChange(localPort);
                        } else {
                          console.error('[PreviewPanel] ❌ onPortChange no está definido');
                        }
                      }}
                      className="h-8 px-2 border-[1.5px] border-blue-500 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-white/20 via-white/10 to-transparent text-foreground shadow-[0_0_8px_rgba(59,130,246,0.5)]"
                    >
                      <Zap className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {t('connectToPort')}
                  </TooltipContent>
                </Tooltip>
              </div>
              <div className="h-6 w-px bg-muted"></div>
            </>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              console.log('[PreviewPanel] 🖱️ Botón de pantalla completa clickeado');
              console.log('[PreviewPanel] 📊 Estado actual:', { isMaximised, onMaximiseToggle: !!onMaximiseToggle });
              console.log('[PreviewPanel] 🔍 Tipo de botón:', isMaximised ? 'MINIMIZAR' : 'MAXIMIZAR');
              if (onMaximiseToggle) {
                console.log('[PreviewPanel] ✅ Llamando a onMaximiseToggle');
                onMaximiseToggle();
              } else {
                console.warn('[PreviewPanel] ⚠️ onMaximiseToggle no está disponible');
              }
            }}
          >
            {isMaximised ? (
              <Minimize2 className="h-4 w-4" />
            ) : (
              <Maximize2 className="h-4 w-4" />
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              // Borrar datos de zeus-studio-data del localStorage
              localStorage.removeItem('zeus-studio-data');
              console.log('[PreviewPanel] 🗑️ Datos zeus-studio-data borrados del localStorage');
              
              // Recargar la página
              window.location.reload();
            }}
            className="border-[1.5px] border-success bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-white/20 via-white/10 to-transparent text-foreground shadow-[0_0_8px_hsl(var(--success)/0.5)]"
          >
            {t('refreshPreview')}
          </Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const iframe = document.querySelector('iframe') as HTMLIFrameElement;
                  if (iframe && iframe.src) {
                    console.log('[PreviewPanel] 🔄 Refrescando iframe...');
                    
                    // Método simple pero efectivo: añadir timestamp para evitar caché
                    const originalSrc = iframe.src;
                    const timestamp = new Date().getTime();
                    const separator = originalSrc.includes('?') ? '&' : '?';
                    
                    // Eliminar timestamp anterior si existe
                    const cleanSrc = originalSrc.split(/[?&]_t=/)[0];
                    iframe.src = `${cleanSrc}${separator}_t=${timestamp}`;
                    
                    toast.success('🔄 Iframe refrescado');
                  } else {
                    toast.error('No se encontró el iframe para refrescar');
                  }
                }}
                className="border-[1.5px] border-blue-500 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-white/20 via-white/10 to-transparent text-foreground shadow-[0_0_8px_rgba(59,130,246,0.5)]"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Refrescar Iframe</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Cruz de flechas flotante para mover elementos - solo en pantalla completa */}
      {isMaximised && selectedComponentId && (
        <div className="absolute bottom-32 right-32 z-[100]">
          {/* Botón arriba */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => moveElement('up')}
            className="absolute h-10 w-10 bg-background border border-blue-500/50 text-primary rounded-full shadow-[0_0_15px_rgba(59,130,246,0.5)] hover:bg-primary hover:text-foreground transition-all"
            style={{ top: '-110px', left: '-20px' }}
          >
            <ArrowUp className="h-6 w-6" />
          </Button>
          
          {/* Botón izquierda */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => moveElement('left')}
            className="absolute h-10 w-10 bg-background border border-blue-500/50 text-primary rounded-full shadow-[0_0_15px_rgba(59,130,246,0.5)] hover:bg-primary hover:text-foreground transition-all"
            style={{ top: '-60px', left: '-70px' }}
          >
            <ArrowLeft className="h-6 w-6" />
          </Button>
          
          {/* Botón derecha */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => moveElement('right')}
            className="absolute h-10 w-10 bg-background border border-blue-500/50 text-primary rounded-full shadow-[0_0_15px_rgba(59,130,246,0.5)] hover:bg-primary hover:text-foreground transition-all"
            style={{ top: '-60px', left: '30px' }}
          >
            <ArrowRight className="h-6 w-6" />
          </Button>
          
          {/* Botón abajo */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => moveElement('down')}
            className="absolute h-10 w-10 bg-background border border-blue-500/50 text-primary rounded-full shadow-[0_0_15px_rgba(59,130,246,0.5)] hover:bg-primary hover:text-foreground transition-all"
            style={{ top: '-10px', left: '-20px' }}
          >
            <ArrowDown className="h-6 w-6" />
          </Button>
        </div>
      )}

      {/* Preview Area */}
      <div 
        data-preview-container
        className={`flex-1 relative overflow-hidden ${isMaximised ? 'pt-24' : ''}`}
        style={viewMode === 'mobile' ? {
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
        } as React.CSSProperties : {
          scrollbarWidth: 'thin',
          scrollbarColor: 'rgba(156, 163, 175, 0.3) transparent',
        } as React.CSSProperties}
      >
        <div className={cn(
          "relative bg-gradient-to-b from-gray-800 to-gray-900 transition-all duration-300",
          viewportSizes[viewMode],
          isMaximised && "fixed inset-0 z-50 !w-full !h-full !max-w-none !m-0 !rounded-none"
        )}
        style={{
          transform: `scale(${zoom})`,
          transformOrigin: 'center center',
          ...(isMaximised && { top: '96px' })
        }}>
          {/* Preview Content */}
          <div 
            data-preview-content
            className="h-full overflow-auto p-4 bg-white dark:bg-background relative"
            style={viewMode === 'mobile' ? {
              scrollbarWidth: 'none',
              msOverflowStyle: 'none',
            } as React.CSSProperties : {
              scrollbarWidth: 'thin',
              scrollbarColor: 'rgba(156, 163, 175, 0.3) transparent',
            } as React.CSSProperties}
          >
            {isProjectLoaded && useLivePreview ? (
              // Live preview using iframe
              <div className="h-full w-full relative">
                {iframeError ? (
                  <div className="flex items-center justify-center h-full">
                    <div className="text-center space-y-4 max-w-md p-6 bg-warning/10 border border-yellow-500/20 rounded-lg">
                      <div className="text-4xl">⚠️</div>
                      <h3 className="text-lg font-semibold text-foreground">{t('devServerNotRunning')}</h3>
                      <p className="text-sm text-muted-foreground">
                        {t('startDevServer')}
                      </p>
                      <div className="bg-card text-success p-3 rounded font-mono text-sm text-left">
                        <div>cd {projectPath || 'your-project'}</div>
                        <div>npm run dev</div>
                      </div>
                      <div className="flex items-center gap-2 mt-4">
                        <input
                          type="text"
                          value={devServerUrl}
                          onChange={(e) => onDevServerUrlChange?.(e.target.value)}
                          placeholder="http://localhost:3000"
                          className="flex-1 px-3 py-2 bg-background border border-input rounded text-sm"
                        />
                        <Button
                          size="sm"
                          onClick={() => {
                            setIframeError(false);
                            const iframe = document.getElementById('preview-iframe') as HTMLIFrameElement;
                            if (iframe) {
                              iframe.src = devServerUrl;
                            }
                          }}
                        >
                          {t('retry')}
                        </Button>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setUseLivePreview(false)}
                        className="mt-2"
                      >
                        {t('useComponentTreeView')}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="relative w-full h-full bg-transparent" style={{ minHeight: '600px', backgroundColor: 'transparent' }}>
                    <iframe
                      key={iframeKey}
                      ref={iframeRef}
                      id="preview-iframe"
                      src={devServerUrl}
                      className="w-[90%] h-full mx-auto"
                      title="Preview"
                      onLoadStart={() => {
                        console.log('[PreviewPanel] 🚀 Iniciando carga del iframe con URL:', devServerUrl);
                      }}
                      style={{ 
                        width: '100%',
                        height: '100%',
                        minHeight: '600px',
                        border: 'none',
                        display: 'block',
                        backgroundColor: 'transparent',
                        scrollbarWidth: 'thin',
                        scrollbarColor: 'rgba(156, 163, 175, 0.5) transparent',
                        msOverflowStyle: 'auto'
                      }}
                      onError={(e) => {
                        console.error('[PreviewPanel] ❌ Error al cargar iframe:', e);
                        console.error('[PreviewPanel] ❌ URL que falló:', devServerUrl);
                        setIframeError(true);
                        // Verificar si es un error de DNS (túnel desconectado)
                        if (devServerUrl.includes('trycloudflare.com')) {
                          console.warn('[PreviewPanel] ⚠️ Posible desconexión del túnel de Cloudflare');
                        }
                      }}
                      onLoad={(e) => {
                        console.log('[PreviewPanel] ✅ Iframe onLoad event disparado');
                        console.log('[PreviewPanel] 🔍 URL del iframe:', (e.target as HTMLIFrameElement).src);
                        console.log('[PreviewPanel] 🔍 devServerUrl actual:', devServerUrl);
                        console.log('[PreviewPanel] 🔍 isProjectLoaded:', isProjectLoaded);
                        console.log('[PreviewPanel] 🔍 useLivePreview:', useLivePreview);
                        
                        try {
                          const iframe = e.target as HTMLIFrameElement;
                          console.log('[PreviewPanel] 🔍 Iframe element:', iframe);

                          let iframeDoc: Document | null = null;
                          try {
                            iframeDoc = iframe.contentDocument;
                          } catch (crossOriginError) {
                            console.log('[PreviewPanel] ℹ️ Iframe cross-origin, contentDocument no accesible');
                          }

                          // Check if iframe content loaded successfully
                          try {
                            if (!iframeDoc && iframe.contentWindow) {
                              iframeDoc = iframe.contentWindow.document;
                            }
                            if (iframeDoc) {
                              console.log('[PreviewPanel] ✅ Acceso al documento del iframe exitoso');
                              console.log('[PreviewPanel] 🔍 Document readyState:', iframeDoc.readyState);
                              console.log('[PreviewPanel] 🔍 Document URL:', iframeDoc.URL);
                              console.log('[PreviewPanel] 🔍 Document title:', iframeDoc.title);
                              console.log('[PreviewPanel] 🔍 Body exists:', !!iframeDoc.body);
                              console.log('[PreviewPanel] 🔍 Body children count:', iframeDoc.body?.children.length || 0);
                              
                              // Check for 404 or error pages
                              const bodyText = iframeDoc.body?.innerText || '';
                              const bodyHTML = iframeDoc.body?.innerHTML || '';
                              console.log('[PreviewPanel] 🔍 Contenido del body (primeros 200 caracteres):', bodyText.substring(0, 200));
                              console.log('[PreviewPanel] 🔍 HTML del body (primeros 500 caracteres):', bodyHTML.substring(0, 500));
                              
                              // Detectar errores comunes de conexión/DNS
                              const errorIndicators = [
                                '404', 'Not Found', 'Cannot GET',
                                'No se encontró la dirección IP',
                                'DNS_PROBE_FINISHED_NXDOMAIN',
                                'ERR_NAME_NOT_RESOLVED',
                                'X-Frame-Options',
                                'ERR_CONNECTION_REFUSED',
                                'ERR_CONNECTION_TIMED_OUT',
                                'ERR_NAME_NOT_RESOLVED',
                                'This site can\'t be reached',
                                'No se puede acceder a este sitio'
                              ];
                              
                              const hasError = errorIndicators.some(indicator => 
                                bodyText.includes(indicator) || bodyHTML.includes(indicator)
                              );
                              
                              if (hasError) {
                                console.error('[PreviewPanel] ❌ Error detectado en el contenido del iframe');
                                console.error('[PreviewPanel] 🔍 Contenido del error:', bodyText.substring(0, 500));
                                setIframeError(true);
                                // Si es un error de DNS/conexión y estamos usando un túnel, limpiar caché
                                if (devServerUrl.includes('trycloudflare.com')) {
                                  console.warn('[PreviewPanel] ⚠️ Túnel desconectado o expirado, limpiando caché');
                                  localStorage.removeItem('preview_server_tunnel_url');
                                  // Notificar al componente padre para que actualice el estado del túnel
                                  if (onDevServerUrlChange) {
                                    onDevServerUrlChange('http://localhost:3000');
                                  }
                                }
                              } else {
                                console.log('[PreviewPanel] ✅ Contenido del iframe parece válido');
                                setIframeError(false);
                                // If selection mode is active, inject script after a delay
                                if (selectionMode) {
                                  setTimeout(() => {
                                    injectSelectionScript(true);
                                  }, 1000);
                                }
                              }
                            } else {
                              console.log('[PreviewPanel] ⚠️ No se puede acceder al documento del iframe (CORS esperado)');
                              setIframeError(false);
                            }
                          } catch (corsError: any) {
                            // CORS error is expected, but iframe might still work
                            console.log('[PreviewPanel] ℹ️ Error CORS esperado (no se puede acceder al contenido):', corsError.message);
                            // Try to detect error by checking iframe location
                            setTimeout(() => {
                              try {
                                const iframeWindow = iframe.contentWindow;
                                if (iframeWindow) {
                                  const currentUrl = iframeWindow.location.href;
                                  console.log('[PreviewPanel] 🔍 URL actual del iframe (desde contentWindow):', currentUrl);
                                  // Verificar si la URL coincide (ignorando trailing slashes)
                                  const normalizeUrl = (url: string) => url.replace(/\/$/, '');
                                  const urlMatches = normalizeUrl(currentUrl) === normalizeUrl(devServerUrl);
                                  
                                  if (urlMatches) {
                                    console.log('[PreviewPanel] ✅ URL del iframe coincide con devServerUrl');
                                    console.log('[PreviewPanel] ✅ El iframe debería estar mostrando el contenido correctamente');
                                  } else if (currentUrl.includes('404') || currentUrl.includes('error')) {
                                    console.warn('[PreviewPanel] ⚠️ URL del iframe contiene error:', currentUrl);
                                  } else {
                                    console.warn('[PreviewPanel] ⚠️ URL del iframe no coincide:', {
                                      actual: currentUrl,
                                      esperada: devServerUrl
                                    });
                                    // No establecer error, puede ser que el iframe redirigió correctamente
                                  }
                                }
                              } catch (e: any) {
                                // Can't access due to CORS, assume it's working
                                console.log('[PreviewPanel] ℹ️ No se puede acceder a contentWindow (CORS):', e.message);
                              }
                            }, 1000);
                            setIframeError(false);
                          }
                        } catch (err: any) {
                          console.error('[PreviewPanel] ❌ Error en onLoad check:', err);
                          setIframeError(false);
                        }
                      }}
                      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-pointer-lock allow-top-navigation"
                      allow="fullscreen"
                      loading="eager"
                    />
                  </div>
                )}
              </div>
            ) : isProjectLoaded && components && components.length > 0 ? (
              // Component tree view
              <div className="min-h-full space-y-4">
                <div className="mb-4 p-2 bg-primary/10 border border-blue-500/20 rounded text-sm text-primary flex items-center justify-between">
                  <span>{t('projectLoaded').replace('{count}', components.length.toString())}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setUseLivePreview(true)}
                  >
                    {t('switchToLivePreview')}
                  </Button>
                </div>
                {components.map((component) => (
                  <div key={component.id}>
                    {renderComponent(component, 0)}
                  </div>
                ))}
              </div>
            ) : (
              // Empty state - no project loaded
              <div className="flex items-center justify-center h-full">
                <div className="text-center space-y-4 max-w-md">
                  <video
                    src="/Zeus_Video.mp4"
                    autoPlay
                    muted
                    loop
                    playsInline
                    className="w-full max-w-sm mx-auto rounded-lg bg-transparent"
                  />
                  <h3 className="text-xl font-semibold text-foreground">{t('noProjectLoaded')}</h3>
                  <p className="text-base text-success font-medium">
                    {t('loadProjectInstructions')}
                  </p>
                  <p className="text-sm text-muted-foreground mt-4">
                    {t('clickLoadProject')}
                  </p>
                  </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* View Mode Indicator */}
      <div className="p-3 border-t bg-background/80 backdrop-blur">
        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center space-x-2">
            <div className={cn(
              "w-3 h-3 rounded-full",
              viewMode === 'desktop' && "bg-success",
              viewMode === 'tablet' && "bg-warning",
              viewMode === 'mobile' && "bg-primary"
            )}></div>
            <span className="font-medium">
              {viewMode === 'desktop' ? t('desktopView') : viewMode === 'tablet' ? t('tabletView') : t('mobileView')}
            </span>
          </div>
          <span className="text-muted-foreground">
            {t('realTimeUpdates')}
          </span>
        </div>
      </div>
    </div>
  );
}
