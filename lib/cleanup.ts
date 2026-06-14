/**
 * Utilidad para limpiar completamente el estado de la aplicación
 * Usado al cambiar de usuario o cerrar sesión
 */

export const clearAllAppState = () => {
  console.log('Limpiando estado completo de la aplicación...');
  
  try {
    // 1. Limpiar localStorage
    const keysToRemove = [
      'pb_auth',
      'zeus_chat_persisted',
      'zeus_chat_history_positions_v5',
      'zeus_chat_fab_position'
    ];
    
    keysToRemove.forEach(key => {
      try {
        localStorage.removeItem(key);
        console.log(`Eliminado localStorage: ${key}`);
      } catch (e) {
        console.warn(`No se pudo eliminar localStorage ${key}:`, e);
      }
    });
    
    // 2. Limpiar sessionStorage
    try {
      sessionStorage.clear();
      console.log('SessionStorage limpiado');
    } catch (e) {
      console.warn('No se pudo limpiar sessionStorage:', e);
    }
    
    // 3. Limpiar cookies
    try {
      document.cookie.split(";").forEach(c => {
        document.cookie = c.replace(/^ +/, "").replace(/=.*/, "=;expires=Thu, 01 Jan 1970 00:00:00 UTC;path=/");
      });
      console.log('Cookies limpiadas');
    } catch (e) {
      console.warn('No se pudo limpiar cookies:', e);
    }
    
    // 4. Limpiar PocketBase si está disponible
    try {
      if (typeof window !== 'undefined' && (window as any).pb) {
        (window as any).pb.authStore.clear();
        console.log('PocketBase authStore limpiado');
      }
    } catch (e) {
      console.warn('No se pudo limpiar PocketBase:', e);
    }
    
    console.log('Estado de la aplicación limpiado completamente');
    
  } catch (e) {
    console.error('Error crítico al limpiar estado:', e);
  }
};

export const forceReload = () => {
  console.log('Forzando recarga completa...');
  
  try {
    // Forzar recarga con timestamp para evitar caché
    const timestamp = Date.now();
    const url = `${window.location.pathname}?t=${timestamp}`;
    
    console.log(`Recargando URL: ${url}`);
    window.location.href = url;
    
    // Fallback si href no funciona
    setTimeout(() => {
      console.log('Fallback: usando window.location.reload()');
      window.location.reload();
    }, 1000);
    
  } catch (e) {
    console.error('Error al forzar recarga:', e);
    // Último recurso
    window.location.reload();
  }
};

export const clearAndReload = () => {
  clearAllAppState();
  setTimeout(() => {
    forceReload();
  }, 100);
};
