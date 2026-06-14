'use client';

import { User, Settings, LogOut, UserCircle, BadgeCheck } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './dropdown-menu';
import { Avatar, AvatarImage, AvatarFallback } from './avatar';
import { cn } from '../../lib/utils';

export type UserMenuProps = {
  name?: string;
  email?: string;
  plan?: string;
  avatarUrl?: string;
  className?: string;
  onPlan?: () => void;
  onProfile?: () => void;
  onSettings?: () => void;
  onLogout?: () => void;
};

/**
 * Menú de usuario reutilizable para avatares en Zeus.
 * Incluye: nombre, plan, perfil, configuración, cerrar sesión.
 */
export function UserMenu({
  name,
  email,
  plan,
  avatarUrl,
  className,
  onPlan,
  onProfile,
  onSettings,
  onLogout,
}: UserMenuProps) {
  const initial = name?.charAt(0)?.toUpperCase() || email?.charAt(0)?.toUpperCase() || 'U';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Avatar
          className={cn(
            'h-8 w-8 ring-2 ring-amber-500 ring-offset-2 ring-offset-gray-900 cursor-pointer transition-transform hover:scale-[1.02]',
            className
          )}
        >
          <AvatarImage src={avatarUrl || ''} alt={name || 'Usuario'} />
          <AvatarFallback className="bg-gradient-to-br from-amber-400 to-amber-600 text-gray-900 font-semibold">
            {initial}
          </AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        sideOffset={10}
        className="min-w-[200px] rounded-xl border border-white/10 bg-gradient-to-b from-slate-900 via-slate-900/95 to-slate-950 text-foreground shadow-2xl shadow-amber-500/15"
      >
        <DropdownMenuLabel className="flex flex-col gap-1 px-3 py-2">
          <span className="text-sm font-semibold leading-tight">{name || 'Usuario'}</span>
          {email && <span className="text-xs text-foreground/70/80">{email}</span>}
        </DropdownMenuLabel>

        <DropdownMenuSeparator className="bg-white/10" />

        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            onPlan?.();
          }}
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-amber-500/15 focus:bg-amber-500/20"
        >
          <BadgeCheck className="h-4 w-4 text-amber-400" />
          <div className="flex flex-col leading-tight">
            <span className="font-medium">Plan</span>
            <span className="text-[11px] text-foreground/70/80">{plan || 'Ver detalles'}</span>
          </div>
        </DropdownMenuItem>

        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            onProfile?.();
          }}
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-amber-500/15 focus:bg-amber-500/20"
        >
          <User className="h-4 w-4 text-amber-300" />
          <span>Perfil</span>
        </DropdownMenuItem>

        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            onSettings?.();
          }}
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-amber-500/15 focus:bg-amber-500/20"
        >
          <Settings className="h-4 w-4 text-amber-300" />
          <span>Configuración</span>
        </DropdownMenuItem>

        <DropdownMenuSeparator className="bg-white/10" />

        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            onLogout?.();
          }}
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-rose-200 hover:bg-rose-500/15 focus:bg-rose-500/20"
        >
          <LogOut className="h-4 w-4" />
          <span>Cerrar sesión</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
