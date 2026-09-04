'use client';

import { useEffect } from 'react';
import './globals.css';
import '../components/styles.css';
import { audiowide } from '@/lib/fonts';
import Script from 'next/script';

import { Providers } from '@/components/Providers';
import { ComponentSelectorHelper } from '@/components/component-selector-helper';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  useEffect(() => {
    try {
      const saved = localStorage.getItem('zeus-zoom');
      if (!saved) return;
      const factor = parseFloat(saved);
      if (Number.isNaN(factor)) return;
      const api = (window as any).electronAPI?.zoom;
      if (api) {
        api.set(Math.max(0.5, Math.min(3, factor)));
      } else {
        document.documentElement.style.zoom = String(Math.max(0.5, Math.min(3, factor)));
      }
    } catch {
      // ignorar errores de localStorage
    }
  }, []);

  return (
    <html lang="en" suppressHydrationWarning className="h-full">
      <body className={`${audiowide.variable} h-full overflow-hidden`}>
        <Providers>
          <ComponentSelectorHelper />
          {children}
        </Providers>
              <Script src="http://localhost:8744/inspector-client.js" strategy="afterInteractive" />
      </body>
    </html>
  );
}
