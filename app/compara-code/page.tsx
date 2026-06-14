'use client';

import Image from 'next/image';
import { ArrowLeft, LogOut } from 'lucide-react';
import CodeComparator from '@/components/CodeComparator';
import ProtectedRoute from '@/components/ProtectedRoute';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';

function ComparatorContent() {
  const { user, logout } = useAuth();

  const handleNavigateToZeus = () => {
    window.location.href = 'https://www.zeus-ia.com';
  };

  return (
    <div className="h-screen overflow-hidden bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900">
      <div className="absolute top-4 left-4 z-10">
        <Image
          src="/LOGO_ZEUS.png"
          alt="ZEUS Logo"
          width={240}
          height={120}
          className="h-auto w-auto max-h-32 object-contain"
          priority
        />
      </div>
      <div className="absolute top-4 right-4 z-10 flex items-center gap-3">
        {user && (
          <div className="text-foreground text-sm mr-2 hidden md:block">
            {user.email}
          </div>
        )}
        <Button
          onClick={logout}
          variant="outline"
          size="sm"
          className="border-destructive/50 text-destructive hover:bg-red-900/20 hover:text-red-300"
        >
          <LogOut className="h-4 w-4 mr-2" />
          Cerrar Sesión
        </Button>
        <button
          onClick={handleNavigateToZeus}
          className="px-4 py-2 text-foreground font-medium rounded-lg border border-green-500 bg-gradient-to-b from-white/10 to-transparent shadow-[0_0_15px_rgba(34,197,94,0.5)] hover:shadow-[0_0_20px_rgba(34,197,94,0.7)] transition-all duration-300 hover:scale-105 flex items-center gap-2"
        >
          <ArrowLeft className="h-4 w-4" />
          Volver a Zeus
        </button>
      </div>
      <CodeComparator />
    </div>
  );
}

export default function Home() {
  return (
    <ProtectedRoute>
      <ComparatorContent />
    </ProtectedRoute>
  );
}
