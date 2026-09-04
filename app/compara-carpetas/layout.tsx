'use client';

import './globals.css';
import { Providers } from '@/components/Providers';
import { ComponentSelectorHelper } from '@/components/component-selector-helper';


export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  

  // Check if we're in the main application context and prevent rendering
  // if we're not supposed to show the floating chat
  const isMainApp = typeof window !== 'undefined' && (
    new URLSearchParams(window.location.search).get('mainApp') === 'true' ||
    window.location.pathname === '/editor'
  );

  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Providers>
          
          <ComponentSelectorHelper />
          {children}
          
        </Providers>
      </body>
    </html>
  );
}