'use client';

import React from 'react';
import Link from 'next/link';
import Image from 'next/image';

interface FooterProps {
  className?: string;
}

const Footer = React.memo<FooterProps>(({ className = '' }) => {
  const currentYear = new Date().getFullYear();

  return (
    <footer className={'bg-background/50 backdrop-blur-sm text-foreground fixed bottom-0 left-0 right-0 ' + className} aria-label="Pie de página">
      <div className="container mx-auto px-4 py-2">
        <div className="flex items-center justify-between h-8">
          <div className="flex-1 flex justify-start">
            <Link href="/" className="inline-block">
              <div className="relative w-28 h-10">
                <Image
                  src="https://zeus-basedatos.fly.dev/api/files/pbc_1998862360/4ou6mzfabp7anmr/logo_zeus_gn460at9a5.png"
                  alt="Logo"
                  fill
                  className="object-contain rounded-lg"
                  sizes="(max-width: 768px) 100vw, 128px"
                />
              </div>
            </Link>
          </div>
          
          <div className="flex-1 text-center flex items-end justify-center">
            <p className="text-xs text-foreground/70 whitespace-nowrap">
              © {currentYear}. Todos los derechos reservados. Aplicación creada con www.zeus-ia.com
            </p>
          </div>
          
          <div className="flex-1"></div>
        </div>
      </div>
    </footer>
  );
});

Footer.displayName = 'Footer';

export default Footer;
  
  