/**
 * Hot Reload Client para Vista Previa
 * Se conecta al WebSocket del servidor de vista previa y recarga el iframe cuando detecta cambios
 */
(function() {
  'use strict';

  // ✅ Detectar si estamos usando un túnel (Cloudflare) o localhost
  function httpToWs(url) {
    if (!url) return null;
    try {
      const u = new URL(url);
      u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
      return u.toString().replace(/\/$/, '');
    } catch (e) {
      return null;
    }
  }

  function getWebSocketUrl() {
    // 1. Prioridad: Override explícito desde la UI/entorno o variables de entorno
    // Buscar en múltiples lugares donde puede estar configurada la URL del túnel
    const override =
      window.__PREVIEW_WS_URL ||
      (typeof window !== 'undefined' && window.NEXT_PUBLIC_PREVIEW_SERVER_URL) ||
      (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_PREVIEW_SERVER_URL) ||
      window.PREVIEW_SERVER_URL;
    
    if (override) {
      const overrideWs = httpToWs(override);
      if (overrideWs) {
        console.log('[HotReload] ✅ Usando URL de túnel configurada:', overrideWs);
        return overrideWs;
      }
    }

    // 2. Intentar obtener desde localStorage (puede ser configurada manualmente)
    if (typeof window !== 'undefined' && window.localStorage) {
      const savedTunnelUrl = window.localStorage.getItem('preview_server_tunnel_url');
      if (savedTunnelUrl) {
        const savedWs = httpToWs(savedTunnelUrl);
        if (savedWs) {
          console.log('[HotReload] ✅ Usando URL de túnel desde localStorage:', savedWs);
          return savedWs;
        }
      }
    }

    const hostname = window.location.hostname;
    const protocol = window.location.protocol;
    const port = window.location.port;

    // 3. Si estamos en localhost, usar ws://localhost:3030
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return `ws://localhost:${port || 3030}`;
    }
    
    // 4. Si estamos en producción (zeus-ia.com), el túnel debe estar configurado explícitamente
    // Si no está configurado, intentar localhost como fallback
    if (hostname.includes('zeus-ia.com') || hostname.includes('vercel.app')) {
      console.warn('[HotReload] ⚠️ Detectado dominio de producción sin URL de túnel configurada.');
      console.warn('[HotReload] 💡 Para usar Cloudflare Tunnel:');
      console.warn('[HotReload]    1. Configura NEXT_PUBLIC_PREVIEW_SERVER_URL en Vercel con: https://newfoundland-seats-mercury-msie.trycloudflare.com');
      console.warn('[HotReload]    2. O ejecuta en consola: localStorage.setItem("preview_server_tunnel_url", "https://newfoundland-seats-mercury-msie.trycloudflare.com")');
      // Intentar localhost como último recurso
      return 'ws://localhost:3030';
    }
    
    // 5. Si estamos usando HTTPS en otro dominio (posible túnel), usar wss://
    // Solo si NO es un dominio conocido de producción
    if (protocol === 'https:') {
      const wsProtocol = 'wss:';
      const wsHost = hostname;
      const tunnelWsUrl = `${wsProtocol}//${wsHost}`;
      console.log('[HotReload] Detectado HTTPS (posible túnel), usando:', tunnelWsUrl);
      return tunnelWsUrl;
    }
    
    // 6. Si estamos en un dominio personalizado (no localhost) pero sin HTTPS,
    // asumir que puede ser un túnel HTTP (menos común, pero posible)
    if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
      return `ws://${hostname}:${port || 3030}`;
    }
    
    // 7. Fallback: localhost
    return `ws://localhost:${port || 3030}`;
  }

  let ws = null;
  let reconnectAttempts = 0;
  const MAX_RECONNECT_ATTEMPTS = 5;
  const RECONNECT_DELAY = 3000;
  let currentProjectId = null;
  let reloadDebounceTimer = null;
  const RELOAD_DEBOUNCE_MS = 500; // Esperar 500ms antes de recargar para agrupar múltiples cambios

  function connectWebSocket(projectId, fallbackTried = false) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      console.log('[HotReload] WebSocket ya está conectado');
      return;
    }

    try {
      const wsUrl = getWebSocketUrl();
      console.log(`[HotReload] Conectando a WebSocket: ${wsUrl}`);
      
      // Intentar conectar al WebSocket
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log('[HotReload] ✅ WebSocket conectado');
        reconnectAttempts = 0;
        
        // Suscribirse al proyecto actual
        if (projectId) {
          subscribeToProject(projectId);
        }
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('[HotReload] 📨 Mensaje recibido del servidor:', data.type, data);
          
          if (data.type === 'connected') {
            console.log('[HotReload] Conectado al servidor:', data.message);
            if (currentProjectId) {
              subscribeToProject(currentProjectId);
            }
          } else if (data.type === 'project-refreshed') {
            // Verificar que el proyecto coincida (si se especifica)
            if (data.projectId && currentProjectId && data.projectId !== currentProjectId) {
              console.log(`[HotReload] ⚠️ Mensaje de proyecto refrescado recibido para otro proyecto (${data.projectId} vs ${currentProjectId}), ignorando...`);
              return;
            }
            
            console.log('[HotReload] 🔄 Proyecto refrescado desde PocketBase', data.projectId ? `(proyecto: ${data.projectId})` : '');
            console.log('[HotReload] 📊 Detalles del mensaje:', {
              projectId: data.projectId,
              currentProjectId: currentProjectId,
              forceReload: data.forceReload,
              waitBeforeReload: data.waitBeforeReload,
              timestamp: data.timestamp
            });
            
            const waitTime = data.waitBeforeReload || 2000; // Esperar 2 segundos por defecto
            
            if (data.forceReload) {
              console.log(`[HotReload] ⏳ Forzando recarga de la vista previa después de ${waitTime}ms...`);
              // Esperar antes de recargar para dar tiempo a Next.js a recompilar
              setTimeout(() => {
                console.log('[HotReload] 🔄 Ejecutando recarga de vista previa ahora...');
                reloadPreview();
              }, waitTime);
            } else {
              console.log('[HotReload] 📅 Programando recarga con debounce...');
              scheduleReload();
            }
          } else if (data.type === 'fileChange' && data.projectId === currentProjectId) {
            console.log(`[HotReload] 📝 Cambio detectado en archivo: ${data.filePath}`);
            scheduleReload();
          } else {
            console.log('[HotReload] ℹ️ Mensaje no manejado:', data.type);
          }
        } catch (error) {
          console.warn('[HotReload] ⚠️ Error procesando mensaje:', error);
          console.warn('[HotReload] 📄 Contenido del mensaje:', event.data);
        }
      };

      ws.onerror = (error) => {
        console.error('[HotReload] Error en WebSocket:', error);
        // Si falla en entorno túnel/producción, intentar fallback a localhost:3030 una sola vez
        if (!fallbackTried && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
          console.warn('[HotReload] Intentando fallback a ws://localhost:3030 ...');
          setTimeout(() => {
            try {
              connectWebSocket(projectId, true);
            } catch (e) {
              console.error('[HotReload] Error conectando fallback:', e);
            }
          }, 500);
        }
      };

      ws.onclose = () => {
        console.log('[HotReload] WebSocket desconectado');
        ws = null;
        
        // Intentar reconectar si no excedimos el límite
        if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          reconnectAttempts++;
          console.log(`[HotReload] Intentando reconectar (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
          setTimeout(() => {
            if (currentProjectId) {
              connectWebSocket(currentProjectId, fallbackTried);
            }
          }, RECONNECT_DELAY);
        } else if (!fallbackTried && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
          // Último recurso: intentar una vez el fallback a localhost si aún no se probó
          console.warn('[HotReload] Máximo de intentos alcanzado, intentando fallback a ws://localhost:3030 ...');
          connectWebSocket(currentProjectId, true);
        } else {
          console.warn('[HotReload] Máximo de intentos de reconexión alcanzado');
        }
      };
    } catch (error) {
      console.error('[HotReload] Error conectando WebSocket:', error);
    }
  }

  function subscribeToProject(projectId) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      currentProjectId = projectId;
      ws.send(JSON.stringify({
        type: 'subscribe',
        projectId: projectId
      }));
      console.log(`[HotReload] Suscrito al proyecto: ${projectId}`);
    } else {
      console.warn('[HotReload] WebSocket no está conectado, no se puede suscribir');
    }
  }

  function scheduleReload() {
    // Cancelar recarga anterior si existe
    if (reloadDebounceTimer) {
      clearTimeout(reloadDebounceTimer);
    }

    // Programar nueva recarga
    reloadDebounceTimer = setTimeout(() => {
      reloadPreview();
    }, RELOAD_DEBOUNCE_MS);
  }

  function reloadPreview() {
    // Buscar el iframe de vista previa - intentar múltiples métodos
    let iframe = document.getElementById('live-preview-iframe');
    
    // Si no se encuentra por ID, buscar por otros métodos
    if (!iframe) {
      // Buscar por clase o atributo
      iframe = document.querySelector('iframe[title*="Preview"]') || 
               document.querySelector('iframe[title*="preview"]') ||
               document.querySelector('iframe.preview-frame') ||
               document.querySelector('iframe');
    }
    
    if (iframe && iframe.src) {
      console.log('[HotReload] 🔄 Recargando vista previa completamente...');
      console.log('[HotReload] URL actual del iframe:', iframe.src);
      
      try {
        // Guardar la URL base (sin parámetros de query existentes)
        const originalUrl = new URL(iframe.src);
        const baseUrl = originalUrl.origin + originalUrl.pathname;
        
        // Crear una nueva URL con múltiples parámetros de cache-busting únicos
        const timestamp = Date.now();
        const randomId = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
        const newUrl = `${baseUrl}?_reload=${timestamp}&_nocache=${timestamp}&_t=${timestamp}&_refresh=${randomId}&_force=${Date.now()}`;
        
        console.log('[HotReload] Nueva URL con cache-busting agresivo:', newUrl);
        
        // MÉTODO COMPATIBLE CON REACT: No remover el iframe del DOM
        // En su lugar, usar múltiples técnicas para forzar recarga completa sin romper React
        
        // Paso 1: Disparar evento personalizado para que React actualice el key y fuerce re-mount
        try {
          const reloadEvent = new CustomEvent('hotreload:iframe-reloaded', {
            detail: { url: newUrl, timestamp: Date.now() }
          });
          window.dispatchEvent(reloadEvent);
          console.log('[HotReload] 📢 Evento personalizado disparado para notificar a React');
        } catch (eventError) {
          console.warn('[HotReload] ⚠️ Error disparando evento personalizado:', eventError);
        }
        
        // Paso 2: Cambiar el src del iframe de manera agresiva para forzar recarga
        // Primero vaciar el src para forzar descarga
        const originalSrc = iframe.src;
        iframe.src = '';
        
        // Pequeño delay para asegurar que el navegador procese el cambio
        setTimeout(() => {
          // Cambiar a la nueva URL con cache-busting
          iframe.src = newUrl;
          console.log('[HotReload] ✅ Iframe src actualizado con nueva URL');
          
          // Paso 3: Intentar forzar recarga desde dentro del iframe (si es posible)
          setTimeout(() => {
            try {
              if (iframe.contentWindow && iframe.contentWindow.location) {
                // Intentar recargar desde dentro con cache-busting adicional
                const innerUrl = new URL(newUrl);
                innerUrl.searchParams.set('_inner_reload', Date.now());
                iframe.contentWindow.location.replace(innerUrl.toString());
                console.log('[HotReload] ✅ Recarga forzada desde dentro del iframe');
              }
            } catch (e) {
              // Si hay error de CORS, es normal, el iframe ya se recargó
              console.log('[HotReload] ℹ️ No se pudo recargar desde dentro (CORS normal):', e.message);
            }
          }, 500);
          
          // Paso 4: Verificar después de 2 segundos si la recarga funcionó
          setTimeout(() => {
            // Si el src no cambió o está vacío, intentar método alternativo
            if (iframe.src === originalSrc || iframe.src === '' || !iframe.src) {
              console.warn('[HotReload] ⚠️ La recarga no funcionó completamente, intentando método alternativo...');
              try {
                // Último recurso: cambiar href directamente
                if (iframe.contentWindow && iframe.contentWindow.location) {
                  iframe.contentWindow.location.href = newUrl;
                  console.log('[HotReload] ✅ Recarga alternativa usando location.href');
                }
              } catch (e) {
                console.warn('[HotReload] ⚠️ No se pudo usar método alternativo:', e.message);
              }
            } else {
              console.log('[HotReload] ✅ Verificación: Iframe recargado correctamente');
            }
          }, 2000);
        }, 100);
        
      } catch (error) {
        console.error('[HotReload] ❌ Error al recargar iframe:', error);
        console.error('[HotReload] 📄 Stack:', error.stack);
        
        // Fallback: intentar método simple de recarga
        try {
          if (iframe && iframe.src) {
            const url = new URL(iframe.src);
            url.searchParams.set('_fallback_reload', Date.now());
            iframe.src = '';
            setTimeout(() => {
              iframe.src = url.toString();
              console.log('[HotReload] ✅ Recarga usando método fallback');
            }, 100);
          }
        } catch (fallbackError) {
          console.error('[HotReload] ❌ Error en método fallback:', fallbackError);
        }
      }
    } else {
      console.warn('[HotReload] ⚠️ Iframe de vista previa no encontrado');
      console.warn('[HotReload] Iframes disponibles:', Array.from(document.querySelectorAll('iframe')).map(iframe => ({
        id: iframe.id,
        title: iframe.title,
        src: iframe.src?.substring(0, 100)
      })));
    }
  }

  // API pública para que el editor pueda usar
  window.HotReload = {
    connect: (projectId) => {
      currentProjectId = projectId;
      connectWebSocket(projectId);
    },
    disconnect: () => {
      if (ws) {
        ws.close();
        ws = null;
      }
      currentProjectId = null;
    },
    subscribe: (projectId) => {
      subscribeToProject(projectId);
    }
  };

  // Auto-conectar si hay un proyecto activo
  // Esto se puede llamar desde el editor cuando se carga un proyecto
  console.log('[HotReload] Cliente cargado. Usa HotReload.connect(projectId) para iniciar.');
})();

