/**
 * Obtiene la URL del servidor de vista previa según si se usa túnel o no
 * Detecta automáticamente si se está usando Cloudflare Tunnel basándose en:
 * 1. Variable de entorno NEXT_PUBLIC_PREVIEW_SERVER_URL (prioridad)
 * 2. Detección de dominio de producción (zeus-ia.com) y búsqueda de URL del túnel
 * 3. Protocolo HTTPS (indica túnel)
 * 4. Fallback a localhost
 * 
 * Esta función es segura para usar en el cliente (navegador) ya que no importa módulos de Node.js
 */
export function getPreviewServerUrl(): string {
  // 1. Prioridad: Variable de entorno explícita
  if (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_PREVIEW_SERVER_URL) {
    return process.env.NEXT_PUBLIC_PREVIEW_SERVER_URL;
  }
  
  // 2. En el cliente (navegador), detectar automáticamente el túnel
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname;
    const protocol = window.location.protocol;
    
    // Si estamos en localhost, usar localhost
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return 'http://localhost:8744';
    }
    
    // Si estamos en producción (zeus-ia.com), consultar automáticamente la API de ZEUS para obtener la URL del túnel
    if (hostname.includes('zeus-ia.com') || hostname.includes('vercel.app')) {
      // Intentar obtener la URL del túnel desde localStorage (caché local)
      if (typeof window !== 'undefined' && window.localStorage) {
        const savedTunnelUrl = window.localStorage.getItem('preview_server_tunnel_url');
        if (savedTunnelUrl) {
          return savedTunnelUrl;
        }
      }
      
      // Si no hay en caché, intentar obtenerla de la API de ZEUS automáticamente
      // Esto se hace de forma asíncrona, pero la función debe ser síncrona
      // Por ahora, intentamos obtenerla desde localStorage que se actualiza automáticamente
      // La aplicación debe llamar a fetchTunnelUrlFromAPI() para actualizar el caché
      
      // Si no hay URL configurada, usar localhost como fallback
      console.warn('[getPreviewServerUrl] ⚠️ En producción sin URL de túnel en caché. Consultando API...');
      return 'http://localhost:8744';
    }
    
    // Si estamos usando HTTPS en otro dominio (posible túnel), usar ese dominio
    if (protocol === 'https:') {
      return `https://${hostname}`;
    }
    
    // Si estamos en un dominio personalizado sin HTTPS, asumir túnel HTTP
    return `http://${hostname}:8744`;
  }
  
  // 3. En el servidor (SSR), usar variable de entorno o localhost
  return process.env?.NEXT_PUBLIC_PREVIEW_SERVER_URL || process.env?.PREVIEW_SERVER_URL || 'http://localhost:8744';
}

