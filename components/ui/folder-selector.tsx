'use client';

import { useRef, useState, useCallback } from 'react';
import { FolderOpen } from 'lucide-react';

interface FolderSelectorProps {
  label: string;
  value: string;
  onChange: (path: string) => void;
  placeholder?: string;
  buttonColor?: 'blue' | 'purple';
}

export function FolderSelector({ label, value, onChange, placeholder = 'Ruta de la carpeta', buttonColor = 'blue' }: FolderSelectorProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string>('');

  const handleOpenFile = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const file = files[0];
      setFileName(file.name);
      if (file instanceof File && (file as any).path) {
        onChange((file as any).path);
      }
    }
  }, [onChange]);

  const buttonClass = buttonColor === 'blue'
    ? 'bg-primary hover:bg-primary'
    : 'bg-accent hover:bg-purple-700';

  return (
    <div>
      <label className="block text-sm font-medium text-foreground/70 mb-2">
        {label}
      </label>
      <div className="relative">
        <FolderOpen className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full pl-10 pr-4 py-2 bg-muted border border-border/40 rounded-lg text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
        />
      </div>
      <div className="mt-2 flex items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          onChange={handleFileChange}
          className="hidden"
        />
        <button
          type="button"
          onClick={handleOpenFile}
          className={`px-3 py-1.5 text-sm rounded-lg transition-colors flex items-center gap-1.5 ${buttonClass}`}
        >
          <FolderOpen className="w-4 h-4" />
          Explorar Archivo
        </button>
        {fileName && (
          <span className="text-sm text-muted-foreground truncate max-w-[200px]">
            {fileName}
          </span>
        )}
      </div>
    </div>
  );
}