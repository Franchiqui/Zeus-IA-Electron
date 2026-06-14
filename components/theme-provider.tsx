'use client';

import { ThemeProvider as CustomThemeProvider } from '@/lib/theme-context';

interface ThemeProviderProps {
  children: React.ReactNode;
  attribute?: string;
  defaultTheme?: string;
  enableSystem?: boolean;
  disableTransitionOnChange?: boolean;
}

export function ThemeProvider({ children, defaultTheme = 'system' }: ThemeProviderProps) {
  return <CustomThemeProvider defaultTheme={defaultTheme as any}>{children}</CustomThemeProvider>;
}
