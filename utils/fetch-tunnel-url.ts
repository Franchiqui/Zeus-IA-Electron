/**
 * Obtiene la URL del túnel desde la API de ZEUS automáticamente
 * Esta función debe llamarse cuando la aplicación se carga en producción
 * para obtener la URL más reciente del túnel del usuario
 */
export async function fetchTunnelUrlFromAPI(userToken: string | null): Promise<string | null> {
  if (!userToken) {
    console.warn('[fetchTunnelUrlFromAPI] No hay token de usuario. No se puede obtener la URL del túnel.');
    return null;
  }

  try {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 
                   (typeof window !== 'undefined' ? window.location.origin : 'https://zeus-ia.com');
    
    const response = await fetch(`${apiUrl}/api/preview-viewer/tunnel-url`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${userToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (response.ok) {
      const data = await response.json();
      if (data.ok && data.tunnelUrl) {
        // Guardar en localStorage para caché
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.setItem('preview_server_tunnel_url', data.tunnelUrl);
        }
        console.log('[fetchTunnelUrlFromAPI] ✅ URL del túnel obtenida:', data.tunnelUrl);
        return data.tunnelUrl;
      }
    } else {
      console.warn('[fetchTunnelUrlFromAPI] ⚠️ No se pudo obtener la URL del túnel:', response.status);
    }
  } catch (error: any) {
    console.warn('[fetchTunnelUrlFromAPI] ⚠️ Error al obtener URL del túnel:', error.message);
  }

  return null;
}

/**
 * Registra el token del usuario en el visor local para que pueda enviar la URL del túnel automáticamente
 */
export async function registerTokenInLocalViewer(userToken: string | null): Promise<boolean> {
  if (!userToken) {
    return false;
  }

  try {
    // Intentar conectar con el visor local (localhost:8744 o 8745)
    const ports = [8744, 8745];
    
    for (const port of ports) {
      try {
        const response = await fetch(`http://localhost:${port}/api/register-token`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ token: userToken })
        });

        if (response.ok) {
          console.log(`[registerTokenInLocalViewer] ✅ Token registrado en visor local (puerto ${port})`);
          return true;
        }
      } catch {
        // Continuar con el siguiente puerto
        continue;
      }
    }
    
    console.warn('[registerTokenInLocalViewer] ⚠️ No se pudo conectar con el visor local. Asegúrate de que esté ejecutándose.');
    return false;
  } catch (error: any) {
    console.warn('[registerTokenInLocalViewer] ⚠️ Error al registrar token:', error.message);
    return false;
  }
}

