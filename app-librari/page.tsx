'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
// Metadata handled via layout
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { StarIcon, MagnifyingGlassIcon, ArrowDownTrayIcon, PlayIcon, TrashIcon } from '@heroicons/react/24/solid';
import FullScreenImageModal from '@/app-librari/components/FullScreenImageModal';
import UploadAppModal from '@/components/upload-app-modal';
import EditAppModal from '@/components/edit-app-modal';
import AppPreviewServer from '@/components/app-preview-server';
import PocketBase from 'pocketbase';

import { z } from 'zod';

// Types
interface AppItem {
  id: string;
  name: string;
  description: string;
  category: 'web' | 'mobile' | 'desktop' | 'pagina-web';
  screenshot: string;
  rating: number;
  zipUrl: string;
  previewUrl: string;
  createdAt: string;
}

interface PreviewState {
  isOpen: boolean;
  zipUrl: string;
  appName: string;
  appId: string;
}

// Zod schema for validation
const AppSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().min(1).max(500),
  category: z.enum(['web', 'mobile', 'desktop', 'pagina-web']),
  rating: z.number().min(0).max(5),
});


export default function Home() {
  const [apps, setApps] = useState<AppItem[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [preview, setPreview] = useState<PreviewState>({ isOpen: false, zipUrl: '', appName: '', appId: '' });
  const [cooldownEnd, setCooldownEnd] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingApp, setEditingApp] = useState<AppItem | null>(null);
  const [fullScreenImage, setFullScreenImage] = useState<{ src: string; alt: string } | null>(null);

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

  // Cargar apps desde PocketBase
  const loadApps = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const records = await pb.collection('apps').getFullList({
        sort: '-created',
      });

      const mapped: AppItem[] = records.map((rec: any) => {
        const screenshotFile = rec.screenshot ?? '';
        const zipFileName = rec.zipFile ?? '';
        return {
          id: rec.id,
          name: rec.name,
          description: rec.description,
          category: rec.category,
          screenshot: screenshotFile
            ? pb.files.getURL(rec, screenshotFile)
            : '',
          rating: rec.rating ?? 0,
          zipUrl: zipFileName
            ? pb.files.getURL(rec, zipFileName)
            : '',
          previewUrl: '',
          createdAt: rec.created,
        };
      });

      setApps(mapped);
    } catch (err: any) {
      console.error('Error cargando apps:', err);
      setError('Error al cargar las aplicaciones desde el servidor.');
    } finally {
      setIsLoading(false);
    }
  }, [pb]);

  useEffect(() => {
    loadApps();
  }, [loadApps]);



  const categories = [
    { id: 'all', label: 'Todas' },
    { id: 'web', label: 'Web' },
    { id: 'mobile', label: 'Móvil' },
    { id: 'desktop', label: 'Escritorio' },
    { id: 'pagina-web', label: 'Páginas Web' },
  ];

  const filteredApps = apps.filter((app) => {
    const matchesSearch =
      app.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      app.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
      app.category.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = activeCategory === 'all' || app.category === activeCategory;
    return matchesSearch && matchesCategory;
  });

  const isCooldownActive = !!(cooldownEnd && Date.now() < cooldownEnd);
  const cooldownSecondsLeft = isCooldownActive ? Math.ceil((cooldownEnd! - Date.now()) / 1000) : 0;

  const handlePreview = useCallback((appId: string, zipUrl: string, name: string) => {
    if (isCooldownActive) return;
    // Activar cooldown INMEDIATAMENTE al abrir la preview (no esperar a ready/closed).
    // Esto evita que el usuario pueda abrir varias apps en paralelo y saturar el
    // servidor mientras la primera se está limpiando.
    setCooldownEnd(Date.now() + 30000); // 30 segundos desde la apertura
    setPreview({ isOpen: true, zipUrl, appName: name, appId });
  }, [isCooldownActive]);

  const handleClosePreview = useCallback(() => {
    setPreview({ isOpen: false, zipUrl: '', appName: '', appId: '' });
    // Al cerrar, renovar el cooldown: el botón debe permanecer desactivado 30s
    // desde el cierre, dando tiempo a que el preview server limpie procesos y
    // PocketBase se reinicie correctamente antes de permitir otra preview.
    setCooldownEnd(Date.now() + 30000);
  }, []);

  /**
   * Llamado por AppPreviewServer cuando termina (ready/error/closed).
   * Solo aplicamos cooldown cuando la preview llegó a 'ready' (tuvo éxito
   * y consumió recursos del servidor). Si falló, permitimos reintento
   * inmediato para no frustrar al usuario.
   */
  const handlePreviewCompleted = useCallback((status: 'ready' | 'error' | 'closed') => {
    if (status === 'ready') {
      setCooldownEnd(Date.now() + 30000); // 30 segundos tras preview exitosa
    }
  }, []);

  useEffect(() => {
    if (!isCooldownActive) return;
    const timer = setInterval(() => {
      if (cooldownEnd && Date.now() >= cooldownEnd) {
        setCooldownEnd(null);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [isCooldownActive, cooldownEnd]);

  const handleDownload = useCallback(async (zipUrl: string, appName: string) => {
    if (!zipUrl) {
      setError('No hay archivo disponible para descargar.');
      return;
    }
    try {
      const response = await fetch(zipUrl);
      if (!response.ok) throw new Error('Download failed');
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${appName}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al descargar');
    }
  }, []);

  const handleDelete = useCallback(async (appId: string, appName: string) => {
    if (!confirm(`¿Estás seguro de que quieres eliminar "${appName}"? Esta acción no se puede deshacer.`)) {
      return;
    }
    try {
      await pb.collection('apps').delete(appId);
      await loadApps(); // Reload the apps list
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al eliminar la aplicación');
    }
  }, [pb, loadApps]);

  const renderStars = (rating: number) => {
    return Array.from({ length: 5 }, (_, i) => (
      <StarIcon
        key={i}
        className={`h-4 w-4 ${i < Math.floor(rating) ? 'text-destructive' : 'text-muted-foreground/60'
          }`}
      />
    ));
  };

  return (
    <>
      {/* Metadata handled via layout metadata.ts */}

      <div className="min-h-screen pb-24 bg-transparent text-foreground">
        {/* Header */}
        <header className="border-b border-destructive/30 bg-background/10 backdrop-blur-sm sticky top-0 z-40">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <h1 className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-success to-success bg-clip-text text-transparent">
                </h1>
                <Button onClick={() => setUploadModalOpen(true)} className="bg-success hover:bg-success text-foreground">
                  Subir aplicación
                </Button>
              </div>
              <div className="relative w-full sm:w-96">
                <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Buscar apps por nombre, descripción o categoría..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 bg-card border border-border/50 rounded-lg focus:outline-none focus:ring-2 focus:ring-success focus:border-transparent text-sm placeholder-muted-foreground/80"
                />
              </div>
            </div>
          </div>
        </header>

        {/* Category Filter */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex flex-wrap gap-2 justify-center">
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id)}
                className={`px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 ${activeCategory === cat.id
                  ? 'bg-success text-foreground shadow-lg shadow-success/30'
                  : 'bg-card text-foreground/70 hover:bg-muted border border-border/50'
                  }`}
              >
                {cat.label}
              </button>
            ))}
          </div>
        </div>

        {/* Error State */}
        {error && (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mb-4">
            <div className="bg-success/50 border border-success rounded-lg p-4 text-success text-sm">
              {error}
            </div>
          </div>
        )}

        {/* Loading State */}
        {isLoading && (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-success"></div>
          </div>
        )}

        {/* App Grid */}
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {filteredApps.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-muted-foreground text-lg">No se encontraron aplicaciones.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredApps.map((app) => (
                <div
                  key={app.id}
                  className="bg-input backdrop-blur-sm border border-border/50 rounded-xl overflow-hidden hover:border-success/50 transition-all duration-300 group"
                >
                  <div
                    className="relative h-48 overflow-hidden bg-input cursor-pointer"
                    onClick={() => setFullScreenImage({ src: app.screenshot || '/placeholder-app.png', alt: app.name })}
                  >
                    <Image
                      src={app.screenshot || '/placeholder-app.png'}
                      alt={app.name}
                      fill
                      unoptimized={app.screenshot?.startsWith('http://127.0.0.1') || app.screenshot?.startsWith('http://localhost')}
                      className="object-cover group-hover:scale-105 transition-transform duration-300"
                      sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-gray-900 via-transparent to-transparent" />
                    <span className="absolute top-3 left-3 px-2 py-1 bg-success/80 text-xs font-medium rounded-full">
                      {categories.find((c) => c.id === app.category)?.label || app.category}
                    </span>
                  </div>
                  <div className="p-4">
                    <h3 className="text-lg font-semibold text-foreground mb-1 truncate">{app.name}</h3>
                    <p className="text-sm text-muted-foreground mb-3 line-clamp-2">{app.description}</p>
                    <div className="flex items-center gap-1 mb-4">{renderStars(app.rating)}</div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handlePreview(app.id, app.zipUrl, app.name)}
                        disabled={isCooldownActive}
                        className={`flex-1 flex items-center justify-center px-3 py-2 text-foreground text-sm font-medium rounded-lg transition-colors ${
                          isCooldownActive
                            ? 'bg-muted/80 cursor-not-allowed opacity-70'
                            : 'bg-success hover:bg-success'
                        }`}
                        title={isCooldownActive ? `Espera ${cooldownSecondsLeft}s para abrir otra app` : 'Vista Previa'}
                      >
                        <PlayIcon className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleDownload(app.zipUrl, app.name)}
                        className="flex-1 flex items-center justify-center px-3 py-2 bg-muted hover:bg-muted/80 text-foreground text-sm font-medium rounded-lg transition-colors"
                        title="Descargar"
                      >
                        <ArrowDownTrayIcon className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => { setEditingApp(app); setEditModalOpen(true); }}
                        className="flex-1 flex items-center justify-center px-3 py-2 bg-primary hover:bg-primary text-foreground text-sm font-medium rounded-lg transition-colors"
                        title="Editar"
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 0L11.828 3H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 0L11.828 3H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 0L11.828 3H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 0L11.828 3H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5" />
                        </svg>
                      </button>
                      <button
                        onClick={() => handleDelete(app.id, app.name)}
                        className="flex-1 flex items-center justify-center px-3 py-2 bg-destructive hover:bg-red-700 text-foreground text-sm font-medium rounded-lg transition-colors"
                        title="Eliminar"
                      >
                        <TrashIcon className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>

        {/* Preview Modal */}
        <AppPreviewServer
          zipUrl={preview.zipUrl}
          appName={preview.appName}
          appId={preview.appId}
          isOpen={preview.isOpen}
          onClose={handleClosePreview}
          onCompleted={handlePreviewCompleted}
        />

        {/* Upload Modal */}
        <UploadAppModal isOpen={uploadModalOpen} onClose={() => setUploadModalOpen(false)} onUploaded={() => loadApps()} />
        <EditAppModal isOpen={editModalOpen} onClose={() => { setEditModalOpen(false); setEditingApp(null); }} app={editingApp} onUpdated={() => { loadApps(); }} />

        {/* Full Screen Image Modal */}
        <FullScreenImageModal
          src={fullScreenImage?.src || ''}
          alt={fullScreenImage?.alt || ''}
          isOpen={!!fullScreenImage}
          onClose={() => setFullScreenImage(null)}
        />

      </div>
    </>
  );
}