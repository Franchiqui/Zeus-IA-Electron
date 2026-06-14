'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import PocketBase from 'pocketbase';

interface AppItem {
  id: string
  name: string
  description: string
  category: string
  rating: number
  screenshot: string
  zipUrl: string
}

interface EditAppModalProps {
  isOpen: boolean
  onClose: () => void
  app: AppItem | null
  onUpdated: () => void
}

export default function EditAppModal({ isOpen, onClose, app, onUpdated }: EditAppModalProps) {
  const { toast } = useToast();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('web');
  const [rating, setRating] = useState(0);
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [screenshotPreview, setScreenshotPreview] = useState<string | null>(null);
  const [dragOverScreenshot, setDragOverScreenshot] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
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

  const resetForm = () => {
    if (app) {
      setTitle(app.name);
      setDescription(app.description);
      setCategory(app.category);
      setRating(app.rating);
      setScreenshotPreview(app.screenshot);
    }
    setScreenshot(null);
    setSubmitError(null);
    if (screenshotInputRef.current) screenshotInputRef.current.value = '';
  };

  useEffect(() => {
    resetForm();
  }, [app]);

  if (!isOpen) return null;

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
    if (!app || !title || !description) return;

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const formData = new FormData();
      formData.append('name', title);
      formData.append('description', description);
      formData.append('category', category);
      formData.append('rating', rating.toString());
      
      if (screenshot) {
        formData.append('screenshot', screenshot);
      }

      await pb.collection('apps').update(app.id, formData);

      toast({ 
        title: 'Aplicación actualizada', 
        description: 'Los cambios se guardaron correctamente.' 
      });
      resetForm();
      onUpdated();
      onClose();
    } catch (err: any) {
      console.error('Error al actualizar app:', err);
      setSubmitError(err?.message || 'Error al actualizar la aplicación. Intenta de nuevo.');
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
          <h2 className="text-lg font-semibold text-foreground">Editar aplicación</h2>
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
              required
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
              required
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

          {/* Rating */}
          <div>
            <Label htmlFor="rating" className="text-sm font-medium text-foreground/70 mb-2 block">Rating</Label>
            <Input
              id="rating"
              type="number"
              min={0}
              max={5}
              step={0.1}
              value={rating}
              onChange={(e) => setRating(parseFloat(e.target.value))}
              className="w-full bg-card border-border/50 text-foreground placeholder-muted-foreground/80 focus:border-destructive focus:ring-red-500"
              placeholder="0.0 - 5.0"
            />
          </div>

          {/* Error */}
          {submitError && (
            <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-lg text-destructive text-sm">
              {submitError}
            </div>
          )}

          {/* Botones */}
          <div className="flex gap-3">
            <Button
              type="button"
              variant="outline"
              className="flex-1 border-border/40 text-foreground/70 hover:bg-card hover:text-foreground"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              className="flex-1 bg-success hover:bg-success text-foreground"
              disabled={!title || !description || isSubmitting}
            >
              {isSubmitting ? 'Guardando...' : 'Guardar cambios'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
