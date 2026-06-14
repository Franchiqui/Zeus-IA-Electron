import '../styles/globals.css';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import React from 'react';
import { ThemeProvider } from '../components/theme-provider';
import { TranslationProvider } from '../contexts/translation-context';
import { TooltipProvider } from '../components/ui/tooltip';
import { AuthProvider } from '@/context/AuthContext';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'zeus Studio - Visual Component Editor for Next.js',
  description: 'Design, edit, and visualize your Next.js components instantly.',
  icons: {
    icon: [
      { url: '/favicon.ico' },
      { url: '/favicon.png', type: 'image/png' },
    ],
    shortcut: '/favicon.ico',
    apple: [
      { url: '/favicon.png', sizes: '180x180', type: 'image/png' },
    ],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning className="h-full">
      <body className={`${inter.className} h-full overflow-hidden`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          <AuthProvider>
            <TranslationProvider>
              <TooltipProvider>
                <div className="h-full w-full bg-card">
                  {children}
                </div>
              </TooltipProvider>
            </TranslationProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
