'use client';

import { useState, useEffect } from 'react';
import { User, LogOut } from 'lucide-react';
import pb from '@/lib/pocketbase';
import { useStore } from '@/lib/store';

export default function UserInfo() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const logoutStore = useStore(state => state.logout);

  useEffect(() => {
    const loadUserInfo = () => {
      console.log('Cargando información del usuario...');
      try {
        if (typeof window !== 'undefined') {
          const pbAuth = localStorage.getItem('pb_auth');
          console.log('pb_auth encontrado:', !!pbAuth);
          
          if (pbAuth) {
            const authData = JSON.parse(pbAuth);
            console.log('authData:', authData);
            
            if (authData.model && (authData.model.name || authData.model.email)) {
              console.log('Usuario encontrado:', authData.model.name || authData.model.email);
              setUser(authData.model);
            } else {
              console.log('No se encontró model.name o email en authData');
              setUser(null);
            }
          } else {
            console.log('No hay pb_auth en localStorage');
            setUser(null);
          }
        }
      } catch (e) {
        console.error('Error al cargar información del usuario:', e);
        setUser(null);
      } finally {
        setLoading(false);
      }
    };

    // Cargar solo una vez al inicio
    loadUserInfo();

    // Escuchar cambios en localStorage (solo para eventos de otras pestañas)
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'pb_auth') {
        console.log('Cambio en pb_auth detectado');
        loadUserInfo();
      }
    };

    // Escuchar cambios personalizados (para la misma pestaña)
    const handleCustomStorageChange = () => {
      loadUserInfo();
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('storage', handleStorageChange);
      // Evento personalizado para cambios en la misma pestaña
      window.addEventListener('pb_auth_changed', handleCustomStorageChange);
      
      return () => {
        window.removeEventListener('storage', handleStorageChange);
        window.removeEventListener('pb_auth_changed', handleCustomStorageChange);
      };
    }
  }, []);

  const handleLogout = () => {
    // 1. Limpiar sesión en PocketBase
    pb.authStore.clear();
    
    // 2. Limpiar Store de Zustand
    logoutStore();
    
    // 3. Limpiar localStorage
    localStorage.removeItem('pb_auth');
    localStorage.removeItem('pocketbase_auth');
    localStorage.removeItem('zeus_chat_persisted');
    localStorage.removeItem('zeus_chat_history_positions_v5');
    localStorage.removeItem('zeus_chat_fab_position');
    localStorage.removeItem('main-store'); // Zustand persistence key
    
    // 4. Notificar a otros componentes
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('pb_auth_changed'));
    }
    
    // 5. Redireccionar al inicio y forzar limpieza total de estados
    window.location.href = '/';
  };

  if (loading) {
    return null;
  }

  if (!user) {
    return null;
  }

  return (
    <div className="flex items-center gap-3 px-3 py-1.5 bg-background/60 backdrop-blur-md rounded-full border border-white/10">
      <User className="w-4 h-4 text-green-400" />
      <span className="text-sm text-foreground font-medium">{user.name}</span>
      <button
        onClick={handleLogout}
        className="p-1 text-muted-foreground hover:text-destructive hover:bg-red-400/10 rounded-full transition-all duration-200"
        title="Cerrar sesión"
      >
        <LogOut className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
