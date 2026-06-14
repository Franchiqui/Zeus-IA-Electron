'use client';

import { useEffect, useCallback } from 'react';
import Image from 'next/image';
import { XMarkIcon } from '@heroicons/react/24/solid';

interface FullScreenImageModalProps {
  src: string;
  alt: string;
  isOpen: boolean;
  onClose: () => void;
}

export default function FullScreenImageModal({ src, alt, isOpen, onClose }: FullScreenImageModalProps) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    },
    [onClose]
  );

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    } else {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/90 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative max-w-[90vw] max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute -top-10 right-0 text-foreground hover:text-foreground/70 transition-colors"
          aria-label="Cerrar vista completa"
        >
          <XMarkIcon className="h-8 w-8" />
        </button>
        <Image
          src={src}
          alt={alt}
          width={1200}
          height={800}
          className="object-contain rounded-lg shadow-2xl"
          style={{ maxWidth: '90vw', maxHeight: '90vh' }}
          unoptimized={src.startsWith('http://127.0.0.1') || src.startsWith('http://localhost')}
        />
      </div>
    </div>
  );
}
