'use client';

import React from 'react';
import Link from 'next/link';
import { useSession, signOut } from 'next-auth/react';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Loader2, LogOut, Settings, User } from 'lucide-react';
import { authPaths } from '@/lib/auth-config';

export interface AuthStatusPaths {
  login: string;
  register: string;
  home: string;
  profile: string;
  settings: string;
  logout: string;
}

export interface AuthStatusProps {
  /** Rutas personalizadas para los enlaces de auth */
  paths?: Partial<AuthStatusPaths>;
}

export default function AuthStatus({ paths }: AuthStatusProps) {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  
  // Valores por defecto para authPaths en caso de que el import falle o no tenga todas las propiedades
  const defaultAuthPaths: AuthStatusPaths = {
    login: '/auth/login',
    register: '/auth/register',
    home: '/',
    profile: '/profile',
    settings: '/settings',
    logout: '/api/auth/logout',
  };
  
  const safeAuthPaths = authPaths || defaultAuthPaths;
  
  const mergedPaths: AuthStatusPaths = {
    login: paths?.login ?? safeAuthPaths.login,
    register: paths?.register ?? safeAuthPaths.register,
    home: paths?.home ?? safeAuthPaths.home,
    profile: paths?.profile ?? safeAuthPaths.profile,
    settings: paths?.settings ?? safeAuthPaths.settings,
    logout: paths?.logout ?? safeAuthPaths.logout,
  };

  const isLoading = status === 'loading';
  const isAuthenticated = status === 'authenticated';

  if (isLoading) {
    return (
      <div className="flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Cargando...</span>
      </div>
    );
  }

  if (!isAuthenticated) {
    const isLoginPage = pathname === mergedPaths.login;
    const isRegisterPage = pathname === mergedPaths.register;

    return (
      <div className="flex items-center gap-2">
        {!isRegisterPage && (
          <Button asChild variant="outline" size="sm">
            <Link href={mergedPaths.register}>Registrarse</Link>
          </Button>
        )}
        {!isLoginPage && (
          <Button asChild size="sm">
            <Link href={mergedPaths.login}>Iniciar sesión</Link>
          </Button>
        )}
      </div>
    );
  }

  // Verificación adicional para session, aunque status sea 'authenticated'
  if (!session) {
    return null; // O podrías mostrar un estado de error
  }

  const user = session.user;
  const userInitials = user?.name
    ? user.name
        .split(' ')
        .map(n => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
    : user?.email?.[0]?.toUpperCase() ?? 'U';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="relative h-8 w-8 rounded-full">
          <Avatar className="h-8 w-8">
            <AvatarImage src={user?.image ?? undefined} alt={user?.name ?? 'Usuario'} />
            <AvatarFallback>{userInitials}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56" align="end" forceMount>
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col space-y-1">
            <p className="text-sm font-medium leading-none">{user?.name}</p>
            <p className="text-xs leading-none text-muted-foreground">
              {user?.email}
            </p>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href={mergedPaths.profile} className="cursor-pointer">
            <User className="mr-2 h-4 w-4" />
            <span>Perfil</span>
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={mergedPaths.settings} className="cursor-pointer">
            <Settings className="mr-2 h-4 w-4" />
            <span>Configuración</span>
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="cursor-pointer text-red-600 focus:text-red-600 dark:text-destructive dark:focus:text-destructive"
          onClick={() => signOut({ callbackUrl: mergedPaths.home })}
        >
          <LogOut className="mr-2 h-4 w-4" />
          <span>Cerrar sesión</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
