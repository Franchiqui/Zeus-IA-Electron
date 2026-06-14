'use client';

import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@/components/theme-provider';
import { Toaster } from '@/components/ui/toaster';
import { useStore } from '@/lib/store';
import { loadAndApplyTheme } from '@/lib/theme-engine';
import { ChatProvider } from '@/components/ChatContext';
import { EditorProvider } from '@/context/editor-context';
import { ProjectProvider } from '@/context/ProjectContext';
import { TerminalProvider } from '@/context/TerminalContext';
import { AuthProvider } from '@/context/AuthContext';
import { TranslationProvider } from '@/contexts/translation-context';
import { TooltipProvider } from '@/components/ui/tooltip';

const queryClient = new QueryClient();

export function Providers({ children }: { children: React.ReactNode }) {
  React.useEffect(() => {
    useStore.getState().init();
    // Diferir aplicación del tema hasta después de la hidratación
    const id = requestAnimationFrame(() => {
      void loadAndApplyTheme();
    });
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider
        attribute="class"
        defaultTheme="dark"
        enableSystem={false}
        disableTransitionOnChange
      >
        <AuthProvider>
          <TranslationProvider>
            <TooltipProvider>
              <ProjectProvider>
                <TerminalProvider>
                  <EditorProvider>
                    <ChatProvider>
                      {children}
                    </ChatProvider>
                  </EditorProvider>
                </TerminalProvider>
              </ProjectProvider>
            </TooltipProvider>
          </TranslationProvider>
        </AuthProvider>
        <Toaster />
      </ThemeProvider>
    </QueryClientProvider>
  );
};
