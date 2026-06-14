# Instrucciones para Integrar el Component Selector Helper

Para que los cambios de estilos se apliquen en el iframe, necesitas agregar el helper script a tu proyecto Next.js.

## Opción 1: Usar el Componente React (Recomendado)

1. Copia el archivo `component-selector-helper.tsx` a tu proyecto (por ejemplo, en `/components/component-selector-helper.tsx`)

2. En tu `app/layout.tsx` o `app/layout.ts`, importa y usa el componente:

```tsx
'use client';

import './globals.css';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { Providers } from '@/components/Providers';
import { ComponentSelectorHelper } from '@/components/component-selector-helper';

const inter = Inter({ subsets: ['latin'] });

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <Providers>
          <ComponentSelectorHelper />
          {children}
        </Providers>
      </body>
    </html>
  );
}
```

**IMPORTANTE**: Solo usa el componente `<ComponentSelectorHelper />`, NO uses el Script también. Usar ambos puede causar conflictos.

## Opción 2: Usar el Script JavaScript

1. Copia el archivo `component-selector-helper.js` a la carpeta `public` de tu proyecto

2. En tu `app/layout.tsx`, agrega el script:

```tsx
import Script from 'next/script';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Script src="/component-selector-helper.js" strategy="afterInteractive" />
        {children}
      </body>
    </html>
  );
}
```

## Notas Importantes

- **Solo usa UNA opción**, no ambas a la vez
- El helper script escucha mensajes del editor y aplica los estilos CSS automáticamente
- Los estilos se aplican usando selectores `[data-component-id="..."]`
- Si tus componentes no tienen el atributo `data-component-id`, los estilos no se aplicarán

## Verificar que Funciona

1. Abre la consola del navegador (F12)
2. Deberías ver: "Component Selector Helper loaded"
3. Cuando edites propiedades, deberías ver: "Component styles applied via postMessage"
4. Los cambios deberían verse inmediatamente en el iframe
