'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import ZeusStudio from '../components/studio/main-studio';
import { useAuth } from '@/context/AuthContext';
import { Loader2 } from 'lucide-react';

export default function Home() {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    // Esperar a que la autenticación termine de cargar
    if (!isLoading) {
      // Si no hay usuario autenticado, redirigir al login
      if (!user) {
        console.log('[page] Usuario no autenticado, redirigiendo al login...');
        router.push('/auth/login');
      }
    }
  }, [user, isLoading, router]);

  // Mostrar loading mientras se verifica la autenticación
  if (isLoading) {
    return (
      <div className="h-full w-full bg-card flex items-center justify-center">
        <div className="flex flex-col items-center space-y-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Verificando autenticación...</p>
        </div>
      </div>
    );
  }

  // Si no hay usuario, no renderizar nada (ya se está redirigiendo)
  if (!user) {
    return (
      <div className="h-full w-full bg-card flex items-center justify-center">
        <div className="flex flex-col items-center space-y-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Redirigiendo al login...</p>
        </div>
      </div>
    );
  }

  // Si hay usuario autenticado, mostrar el editor
  return (
    <div className="h-full w-full bg-card">
      <ZeusStudio />
    </div>
  );
}
