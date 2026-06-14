'use client';

import { type AuthStatusPaths } from '@/components/auth/auth-status';

export interface AuthConfig {
  /** Rutas de autenticación utilizadas en toda la aplicación */
  paths: AuthStatusPaths;
  /** Configuración de sesión */
  session: {
    /** Tiempo máximo de sesión en segundos (por defecto 7 días) */
    maxAge: number;
    /** Actualizar sesión automáticamente */
    updateAge: number;
  };
  /** Configuración de proveedores OAuth */
  providers: {
    google?: {
      clientId: string;
      clientSecret: string;
    };
    github?: {
      clientId: string;
      clientSecret: string;
    };
  };
  /** Configuración de seguridad */
  security: {
    /** Longitud mínima de contraseña */
    passwordMinLength: number;
    /** Requerir caracteres especiales en contraseña */
    requireSpecialChars: boolean;
    /** Bloquear después de X intentos fallidos */
    maxFailedAttempts: number;
    /** Tiempo de bloqueo en minutos */
    lockoutDuration: number;
  };
}

/** Rutas de autenticación por defecto */
export const authPaths: AuthStatusPaths = {
  home: '/',
  login: '/auth/login',
  register: '/auth/register',
  profile: '/dashboard/profile',
  settings: '/dashboard/settings',
  logout: '/api/auth/logout',
};

/** Configuración de autenticación por defecto */
export const defaultAuthConfig: AuthConfig = {
  paths: authPaths,
  session: {
    maxAge: 60 * 60 * 24 * 7, // 7 días
    updateAge: 60 * 60 * 24, // 1 día
  },
  providers: {
    google: process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET
      ? {
          clientId: process.env.AUTH_GOOGLE_ID,
          clientSecret: process.env.AUTH_GOOGLE_SECRET,
        }
      : undefined,
    github: process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET
      ? {
          clientId: process.env.AUTH_GITHUB_ID,
          clientSecret: process.env.AUTH_GITHUB_SECRET,
        }
      : undefined,
  },
  security: {
    passwordMinLength: 8,
    requireSpecialChars: true,
    maxFailedAttempts: 5,
    lockoutDuration: 15,
  },
};

/** Obtener configuración de autenticación */
export function getAuthConfig(): AuthConfig {
  return defaultAuthConfig;
}

/** Verificar si una ruta requiere autenticación */
export function isProtectedRoute(pathname: string): boolean {
  const protectedRoutes = [
    '/dashboard',
    '/profile',
    '/settings',
    '/admin',
  ];
  
  return protectedRoutes.some(route => 
    pathname === route || pathname.startsWith(route + '/')
  );
}

/** Verificar si una ruta es pública (accesible sin autenticación) */
export function isPublicRoute(pathname: string): boolean {
  const publicRoutes = [
    '/',
    '/auth/login',
    '/auth/register',
    '/auth/forgot-password',
    '/auth/reset-password',
    '/about',
    '/contact',
    '/privacy',
    '/terms',
  ];
  
  return publicRoutes.some(route => 
    pathname === route || pathname.startsWith(route + '/')
  );
}

/** Obtener la ruta de redirección después del login */
export function getLoginRedirectUrl(returnUrl?: string): string {
  const config = getAuthConfig();
  if (returnUrl && !isPublicRoute(returnUrl)) {
    return returnUrl;
  }
  return config.paths.home;
}

/** Obtener la ruta de redirección después del logout */
export function getLogoutRedirectUrl(): string {
  const config = getAuthConfig();
  return config.paths.home;
}

/** Validar fortaleza de contraseña */
export function validatePassword(password: string): {
  isValid: boolean;
  errors: string[];
} {
  const config = getAuthConfig();
  const errors: string[] = [];
  
  if (password.length < config.security.passwordMinLength) {
    errors.push(`La contraseña debe tener al menos ${config.security.passwordMinLength} caracteres`);
  }
  
  if (config.security.requireSpecialChars && !/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
    errors.push('La contraseña debe contener al menos un carácter especial');
  }
  
  if (!/[A-Z]/.test(password)) {
    errors.push('La contraseña debe contener al menos una letra mayúscula');
  }
  
  if (!/[a-z]/.test(password)) {
    errors.push('La contraseña debe contener al menos una letra minúscula');
  }
  
  if (!/\d/.test(password)) {
    errors.push('La contraseña debe contener al menos un número');
  }
  
  return {
    isValid: errors.length === 0,
    errors,
  };
}

/** Verificar si un proveedor OAuth está configurado */
export function isProviderEnabled(provider: 'google' | 'github'): boolean {
  const config = getAuthConfig();
  return !!config.providers[provider];
}

/** Obtener lista de proveedores OAuth habilitados */
export function getEnabledProviders(): Array<'google' | 'github'> {
  const config = getAuthConfig();
  const providers: Array<'google' | 'github'> = [];
  
  if (config.providers.google) providers.push('google');
  if (config.providers.github) providers.push('github');
  
  return providers;
}

/** Tipo para rutas de navegación relacionadas con autenticación */
export type AuthNavigation = {
  label: string;
  href: string;
  requiresAuth: boolean;
  requiresNoAuth: boolean;
};

/** Obtener navegación basada en estado de autenticación */
export function getAuthNavigation(isAuthenticated: boolean): AuthNavigation[] {
  const config = getAuthConfig();
  
  const baseNavigation: AuthNavigation[] = [
    {
      label: 'Inicio',
      href: config.paths.home,
      requiresAuth: false,
      requiresNoAuth: false,
    },
  ];
  
  if (isAuthenticated) {
    return [
      ...baseNavigation,
      {
        label: 'Perfil',
        href: config.paths.profile,
        requiresAuth: true,
        requiresNoAuth: false,
      },
      {
        label: 'Configuración',
        href: config.paths.settings,
        requiresAuth: true,
        requiresNoAuth: false,
      },
    ];
  }
  
  return [
    ...baseNavigation,
    {
      label: 'Iniciar Sesión',
      href: config.paths.login,
      requiresAuth: false,
      requiresNoAuth: true,
    },
    {
      label: 'Registrarse',
      href: config.paths.register,
      requiresAuth: false,
      requiresNoAuth: true,
    },
  ];
}
