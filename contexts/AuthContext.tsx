'use client';

import { createContext, useContext, useEffect, useState, ReactNode, useCallback, JSX } from 'react';
import { pb } from '../lib/pocketbase';
import { useRouter } from 'next/navigation';

type AuthRecord = {
  id: string;
  collectionId: string;
  collectionName: string;
  created: string;
  updated: string;
  [key: string]: any;
};

type User = {
  id: string;
  email: string;
  username?: string;
  name?: string;
  avatar?: string;
  created: string;
  updated: string;
  emailVisibility?: boolean;
  token?: string;
  githubAccessToken?: string;
};

type AuthContextType = {
  user: User | null;
  loading: boolean;
  initialized: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<AuthRecord>;
  register: (email: string, password: string, userData?: Partial<User>) => Promise<AuthRecord>;
  logout: () => void;
  clearError: () => void;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const mapRecordToUser = useCallback((record: any): User | null => {
    if (!record) return null;
        
    // Verificar si hay token de GitHub en sessionStorage
    const githubTokenFromStorage = typeof window !== 'undefined' ? sessionStorage.getItem('zeus_github_token') : null;
    
    const avatarUrl = record.avatar ? pb.files.getUrl(record, record.avatar) : '';

    const user: User = {
      id: record.id,
      email: record.email,
      username: record.username || '',
      name: record.name || '',
      avatar: avatarUrl,
      created: record.created,
      updated: record.updated,
      token: pb.authStore.token,
      githubAccessToken: record.githubAccessToken || githubTokenFromStorage || undefined
    };
    
    // Limpiar el token de GitHub de sessionStorage después de usarlo
    if (githubTokenFromStorage && typeof window !== 'undefined') {
      sessionStorage.removeItem('zeus_github_token');
    }
    
    return user;
  }, []);

  // Initialize PocketBase and set up auth store change listener
  useEffect(() => {
    const initializePocketBase = async () => {
      try {
        setError(null);

        // Check if there's a token in sessionStorage (from Zeus navigation) or URL (fallback)
        if (typeof window !== 'undefined') {
          // Primero intentar obtener el token de sessionStorage (más seguro)
          let tokenFromStorage = sessionStorage.getItem('zeus_auth_token');
          
          // Si no hay en sessionStorage, intentar desde URL (compatibilidad con versiones anteriores)
          if (!tokenFromStorage) {
            const urlParams = new URLSearchParams(window.location.search);
            tokenFromStorage = urlParams.get('token');
            
            // Si viene de URL, limpiarlo inmediatamente
            if (tokenFromStorage) {
              urlParams.delete('token');
              const newUrl = window.location.pathname + (urlParams.toString() ? '?' + urlParams.toString() : '');
              window.history.replaceState({}, '', newUrl);
            }
          }
          
          if (tokenFromStorage && !pb.authStore.token) {
            try {
              // Set the token and try to refresh to get user data
              pb.authStore.save(tokenFromStorage, null);
              await pb.collection('users').authRefresh();
              
              // Limpiar el token de sessionStorage después de usarlo
              sessionStorage.removeItem('zeus_auth_token');
            } catch (error: any) {
              console.warn('Failed to authenticate with token from storage/URL:', error);
              pb.authStore.clear();
              // Remove invalid token from storage
              sessionStorage.removeItem('zeus_auth_token');
            }
          }
          
          // También verificar si hay token de GitHub en sessionStorage
          const githubTokenFromStorage = sessionStorage.getItem('zeus_github_token');
          if (githubTokenFromStorage) {
            console.log('✅ GitHub token received from Zeus via sessionStorage');
            // Guardar el token de GitHub en el contexto del usuario
            // Lo agregaremos al objeto user cuando se cree
          }
        }
        
        const handleAuthChange = () => {
          const user = pb.authStore.model ? mapRecordToUser(pb.authStore.model) : null;
          setUser(user);
        };
        
        const removeListener = pb.authStore.onChange(handleAuthChange, true);

        // Check if we have a valid auth store and attempt to refresh
        if (pb.authStore.token) {
          try {
            await pb.collection('users').authRefresh();
          } catch (error: any) {
            const msg = String(error?.message || '');
            const unauthorized = msg.includes('401') || msg.toLowerCase().includes('unauthorized');
            if (unauthorized) {
              pb.authStore.clear();
            }
          }
        }

        handleAuthChange();
        setInitialized(true);
        setLoading(false);

        return () => {
          removeListener();
        };
      } catch (error) {
        console.error('Failed to initialize PocketBase:', error);
        setError('Failed to initialize authentication');
        setInitialized(true);
        setLoading(false);
      }
    };

    initializePocketBase();
  }, [mapRecordToUser]);

  const login = useCallback(async (email: string, password: string): Promise<AuthRecord> => {
    try {
      setError(null);
            const authData = await pb.collection('users').authWithPassword(email, password);
      const user = mapRecordToUser(authData.record);
      setUser(user);
      
      // Map the response to AuthRecord
      const {
        id,
        collectionId,
        collectionName,
        created,
        updated,
        ...rest
      } = authData.record;
      return {
        id,
        collectionId: collectionId || '',
        collectionName: collectionName || 'users',
        created: created || new Date().toISOString(),
        updated: updated || new Date().toISOString(),
        ...rest
      };
    } catch (error: any) {
      const errorMessage = error?.message || 'Login failed';
      setError(errorMessage);
      throw error;
    }
  }, [mapRecordToUser]);

  const register = useCallback(async (
    email: string,
    password: string,
    userData?: Partial<User>
  ): Promise<AuthRecord> => {
    try {
      setError(null);
            
      // Create user
      const userRecord = await pb.collection('users').create({
        email,
        password,
        passwordConfirm: password,
        ...userData,
      });

      // Auto-login after registration
      const authData = await pb.collection('users').authWithPassword(email, password);
      const user = mapRecordToUser(authData.record);
      setUser(user);
      
      // Map the response to AuthRecord
      const {
        id,
        collectionId,
        collectionName,
        created,
        updated,
        ...rest
      } = authData.record;
      return {
        id,
        collectionId: collectionId || '',
        collectionName: collectionName || 'users',
        created: created || new Date().toISOString(),
        updated: updated || new Date().toISOString(),
        ...rest
      };
    } catch (error: any) {
      const errorMessage = error?.message || 'Registration failed';
      setError(errorMessage);
      throw error;
    }
  }, [mapRecordToUser]);

  const logout = useCallback(() => {
        pb.authStore.clear();
    setUser(null);
    router.push('/auth/login');
  }, [router]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        initialized,
        error,
        login,
        register,
        logout,
        clearError,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
