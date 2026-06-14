'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import PocketBase from 'pocketbase';

interface UploadAppModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUploaded?: () => void;
}

export default function UploadAppModal({ isOpen, onClose, onUploaded }: UploadAppModalProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('web');
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [screenshotPreview, setScreenshotPreview] = useState<string | null>(null);
  const [dragOverZip, setDragOverZip] = useState(false);
  const [dragOverScreenshot, setDragOverScreenshot] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const screenshotInputRef = useRef<HTMLInputElement>(null);

  // Inicializar PocketBase local (igual que en api-librari/index.ts)
  const pb = useMemo(() => {
    const instance = new PocketBase(process.env.POCKETBASE_LOCAL_URL || 'http://127.0.0.1:8091');
    instance.autoCancellation(false);
    return instance;
  }, []);

  // Autenticar como administrador
  useEffect(() => {
    const authAdmin = async () => {
      try {
        await pb.admins.authWithPassword(
          process.env.POCKETBASE_LOCAL_ADMIN_EMAIL || 'zeus@ia.com',
          process.env.POCKETBASE_LOCAL_ADMIN_PASSWORD || '1234567890'
        );
      } catch (error) {
        console.error('Error autenticando administrador:', error);
      }
    };
    authAdmin();
  }, [pb]);

  if (!isOpen) return null;

  const resetForm = () => {
    setTitle('');
    setDescription('');
    setCategory('web');
    setZipFile(null);
    setScreenshot(null);
    setScreenshotPreview(null);
    setSubmitError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (screenshotInputRef.current) screenshotInputRef.current.value = '';
  };

  const handleZipDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverZip(false);
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith('.zip')) {
      setZipFile(file);
    }
  };

  const handleScreenshotDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverScreenshot(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      setScreenshot(file);
      const reader = new FileReader();
      reader.onload = (event) => {
        setScreenshotPreview(event.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !description || !zipFile) return;

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const formData = new FormData();
      formData.append('name', title);
      formData.append('description', description);
      formData.append('category', category);
      formData.append('zipFile', zipFile);
      if (screenshot) {
        formData.append('screenshot', screenshot);
      }

      await pb.collection('apps').create(formData);

      resetForm();
      onClose();
      onUploaded?.();
    } catch (err: any) {
      console.error('Error al crear app:', err);
      setSubmitError(err?.message || 'Error al publicar la aplicación. Intenta de nuevo.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-sm" onClick={onClose}>
      <div
        className="relative w-full max-w-lg mx-4 bg-background rounded-xl shadow-2xl border border-border/50"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border/50">
          <h2 className="text-lg font-semibold text-foreground">Subir aplicación</h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Captura */}
          <div>
            <Label className="text-sm font-medium text-foreground/70 mb-2 block">Captura</Label>
            <div
              className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
                dragOverScreenshot ? 'border-destructive bg-destructive/10' : 'border-border/40 hover:border-border/30'
              }`}
              onDragOver={(e) => { e.preventDefault(); setDragOverScreenshot(true); }}
              onDragLeave={() => setDragOverScreenshot(false)}
              onDrop={handleScreenshotDrop}
              onClick={() => screenshotInputRef.current?.click()}
            >
              {screenshotPreview ? (
                <img src={screenshotPreview} alt="Preview" className="max-h-40 mx-auto rounded" />
              ) : (
                <div className="text-muted-foreground">
                  <svg className="h-12 w-12 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <p className="text-sm">Arrastra una imagen o haz clic para seleccionar</p>
                </div>
              )}
              <input
                ref={screenshotInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    setScreenshot(file);
                    const reader = new FileReader();
                    reader.onload = (event) => {
                      setScreenshotPreview(event.target?.result as string);
                    };
                    reader.readAsDataURL(file);
                  }
                }}
              />
            </div>
          </div>

          {/* Título */}
          <div>
            <Label htmlFor="title" className="text-sm font-medium text-foreground/70 mb-2 block">Título</Label>
            <Input
              id="title"
              className="w-full bg-card border-border/50 text-foreground placeholder-muted-foreground/80 focus:border-destructive focus:ring-red-500"
              placeholder="Nombre de la aplicación"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          {/* Descripción */}
          <div>
            <Label htmlFor="description" className="text-sm font-medium text-foreground/70 mb-2 block">Descripción</Label>
            <textarea
              id="description"
              className="w-full bg-card border border-border/50 text-foreground placeholder-muted-foreground/80 rounded-lg p-2 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent resize-none"
              rows={3}
              placeholder="Describe tu aplicación..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {/* Categoría */}
          <div>
            <Label htmlFor="category" className="text-sm font-medium text-foreground/70 mb-2 block">Categoría</Label>
            <select
              id="category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full bg-card border border-border/50 text-foreground rounded-lg p-2 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
            >
              <option value="web">Web</option>
              <option value="mobile">Móvil</option>
              <option value="desktop">Escritorio</option>
              <option value="pagina-web">Página Web</option>
            </select>
          </div>

          {/* Archivo ZIP */}
          <div>
            <Label className="text-sm font-medium text-foreground/70 mb-2 block">Archivo ZIP</Label>
            <div
              className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
                dragOverZip ? 'border-destructive bg-destructive/10' : 'border-border/40 hover:border-border/30'
              }`}
              onDragOver={(e) => { e.preventDefault(); setDragOverZip(true); }}
              onDragLeave={() => setDragOverZip(false)}
              onDrop={handleZipDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              {zipFile ? (
                <div className="text-foreground/70">
                  <svg className="h-10 w-10 mx-auto mb-2 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="font-medium">{zipFile.name}</p>
                  <p className="text-xs text-muted-foreground/80">{(zipFile.size / 1024 / 1024).toFixed(2)} MB</p>
                </div>
              ) : (
                <div className="text-muted-foreground">
                  <svg className="h-10 w-10 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                  <p className="text-sm">Arrastra un archivo .zip o haz clic para seleccionar</p>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept=".zip"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) setZipFile(file);
                }}
              />
            </div>
          </div>

          {/* Error */}
          {submitError && (
            <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-lg text-destructive text-sm">
              {submitError}
            </div>
          )}

          {/* Botón de enviar */}
          <Button
            type="submit"
            className="w-full bg-destructive hover:bg-red-700 text-foreground"
            disabled={!title || !description || !zipFile || !screenshot || isSubmitting}
          >
            {isSubmitting ? 'Publicando...' : 'Publicar aplicación'}
          </Button>
        </form>
      </div>
    </div>
  );
}