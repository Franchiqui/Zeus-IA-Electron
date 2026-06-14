'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import pb from '@/lib/pocketbase';

interface AuthContextType {
  user: any | null;
  token: string | null;
  isLoading: boolean;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<any>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Cargar estado inicial
    const syncAuth = () => {
      setUser(pb.authStore.model);
      setToken(pb.authStore.token);
      setIsLoading(false);
    };

    syncAuth();

    // Escuchar cambios en el authStore de PocketBase
    const unsubscribe = pb.authStore.onChange((token, model) => {
      console.log('🔐 AuthContext: Cambio detectado en PocketBase', { hasToken: !!token, userId: model?.id });
      setUser(model);
      setToken(token);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const logout = () => {
    pb.authStore.clear();
    setUser(null);
    setToken(null);
  };

  return (
    <AuthContext.Provider value={{ user, token, isLoading, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    return { user: null, token: null, isLoading: false, logout: () => {} };
  }
  return context;
}
