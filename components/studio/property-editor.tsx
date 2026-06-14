'use client';

import React, { useState, useCallback } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { Label } from '../ui/label';
import { Input } from '../ui/input';
import { Slider } from '../ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Button } from '../ui/button';
import { Separator } from '../ui/separator';
import { Switch } from '../ui/switch';
import { toast } from 'sonner';
import { 
  Palette, 
  Square, 
  Type, 
  Box, 
  Droplets,
  RefreshCw,
  Eye,
  EyeOff,
  Sparkles,
  Home, User, Settings, Heart, Star, Search, Mail, Phone, Calendar, Camera, Edit, Trash, Plus, Minus, X, Zap, Move, RotateCcw, Save, Paintbrush, Ruler, Image, HelpCircle, AlertTriangle,
  Check as CheckIconComponent,
  RefreshCw as RefreshCwIconComponent,
  Download,
  Upload,
  Copy,
  Server,
  Activity, AlertCircle, Archive, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, AtSign, Award, Bell, Bookmark, Check as CheckIcon, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Circle, Clipboard, Clock, Cloud, Code, Command, CreditCard, Database, Disc, ExternalLink, File, Filter, Flag, Folder, Gift, Globe, Grid, HardDrive, Hash, Headphones, Inbox, Info, Key, Layers, LifeBuoy, Link, List, Lock, LogIn, LogOut, Map, Menu, MessageCircle, MessageSquare, Mic, Monitor, Moon, MoreHorizontal, MoreVertical, MousePointer, Music, Navigation, Package, Paperclip, Pause, PenTool, Play, Power, Printer, QrCode, Repeat, Rss, Scissors, Send, Share, Shield, ShoppingBag, ShoppingCart, Sun, Tag, Target, Terminal, ThumbsDown, ThumbsUp, ToggleLeft, ToggleRight, TrendingDown, TrendingUp, Truck, Tv, Umbrella, Unlock, Users, Video, Voicemail, Volume1, Volume2, VolumeX, Wallet, Watch, Wifi, ZoomIn, ZoomOut
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { useTranslation } from '../../contexts/translation-context';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';

// Color Picker Component with Color Palette
function ColorPicker({ color, onColorChange, disableAutoSave = false }: { 
  color: string; 
  onColorChange: (color: string) => void; 
  disableAutoSave?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  
  // Verificar si el color es transparente
  const isTransparent = color === 'transparent' || color === 'rgba(0, 0, 0, 0)' || color === '#00000000' || !color;
  
  // Cargar colores personalizados del localStorage
  const [customColors, setCustomColors] = React.useState<string[]>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('zeus-studio-custom-colors');
      return saved ? JSON.parse(saved) : [];
    }
    return [];
  });
  
  // Paleta de colores predefinidos
  const defaultColorPalette = [
    // Transparente (primero en la lista)
    'transparent',
    // Colores primarios
    '#000000', '#FFFFFF', '#FF0000', '#00FF00', '#0000FF',
    // Azules
    '#3b82f6', '#2563eb', '#1d4ed8', '#1e40af', '#1e3a8a',
    // Verdes
    '#10b981', '#059669', '#047857', '#065f46', '#064e3b',
    // Rojos
    '#ef4444', '#dc2626', '#b91c1c', '#991b1b', '#7f1d1d',
    // Amarillos
    '#f59e0b', '#d97706', '#b45309', '#92400e', '#78350f',
    // Púrpuras
    '#8b5cf6', '#7c3aed', '#6d28d9', '#5b21b6', '#4c1d95',
    // Rosas
    '#ec4899', '#db2777', '#be185d', '#9f1239', '#831843',
    // Grises
    '#6b7280', '#4b5563', '#374151', '#1f2937', '#111827',
    // Naranjas
    '#f97316', '#ea580c', '#c2410c', '#9a3412', '#7c2d12',
    // Cyan
    '#06b6d4', '#0891b2', '#0e7490', '#155e75', '#164e63',
  ];
  
  // Combinar paleta por defecto con colores personalizados
  const colorPalette = [...defaultColorPalette, ...customColors];
  
  // Guardar automáticamente el último color usado (con delay para evitar interferencia en gradientes)
  React.useEffect(() => {
    if (!disableAutoSave && color && !isTransparent && !defaultColorPalette.includes(color)) {
      // Verificar si el color ya está en customColors
      if (!customColors.includes(color)) {
        // Usar timeout para evitar interferencia cuando se está editando un degradado
        const timeoutId = setTimeout(() => {
          // Mover el color al principio de la lista de colores personalizados
          const newCustomColors = [color, ...customColors.filter(c => c !== color)].slice(0, 20); // Máximo 20 colores personalizados
          setCustomColors(newCustomColors);
          localStorage.setItem('zeus-studio-custom-colors', JSON.stringify(newCustomColors));
          console.log('[ColorPicker] Color guardado automáticamente:', color);
        }, 500); // 500ms de delay
        
        return () => clearTimeout(timeoutId);
      }
    }
  }, [color, isTransparent, customColors, defaultColorPalette, disableAutoSave]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="w-10 h-10 rounded border-2 border-gray-300 dark:border-border/40 cursor-pointer hover:border-blue-500 transition-colors relative"
          style={{ backgroundColor: isTransparent ? 'transparent' : color }}
          onClick={() => setOpen(true)}
        >
          {isTransparent && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-xs text-muted-foreground font-bold">/</div>
            </div>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-4" align="start">
        <div className="space-y-4">
          <div>
            <Label className="mb-2 block text-sm font-medium">Seleccionar Color</Label>
            <div className="flex items-center space-x-2 mb-4">
              <Input
                type="color"
                value={isTransparent ? '#000000' : color}
                onChange={(e) => {
                  onColorChange(e.target.value);
                  setOpen(false);
                }}
                className="w-16 h-10 cursor-pointer"
              />
              <Input
                type="text"
                value={color || 'transparent'}
                onChange={(e) => {
                  const value = e.target.value;
                  // Permitir 'transparent', códigos hex, rgba, etc.
                  if (value === '' || value === 'transparent' || value.startsWith('#') || value.startsWith('rgba')) {
                    onColorChange(value === '' ? 'transparent' : value);
                  }
                }}
                className="flex-1"
                placeholder="transparent o #000000"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => {
                onColorChange('transparent');
                setOpen(false);
              }}
            >
              Establecer como Transparente
            </Button>
          </div>
          
          <div>
            <Label className="text-sm font-medium mb-2 block">Paleta de Colores</Label>
            <div className="grid grid-cols-10 gap-2">
              {colorPalette.map((paletteColor, index) => {
                const isTransparentColor = paletteColor === 'transparent';
                const isCustomColor = index >= defaultColorPalette.length;
                return (
                  <button
                    key={paletteColor}
                    type="button"
                    className={cn(
                      "w-8 h-8 rounded border-2 cursor-pointer hover:scale-110 transition-transform relative",
                      color === paletteColor ? "border-blue-500 ring-2 ring-blue-300" : 
                      isCustomColor ? "border-purple-400 dark:border-purple-600" : "border-gray-300 dark:border-border/40"
                    )}
                    style={{ backgroundColor: isTransparentColor ? 'transparent' : paletteColor }}
                    onClick={() => {
                      onColorChange(paletteColor);
                      setOpen(false);
                    }}
                    title={isTransparentColor ? 'Transparente' : `${paletteColor}${isCustomColor ? ' (Personalizado)' : ''}`}
                  >
                    {isTransparentColor && (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="text-[10px] text-muted-foreground font-bold">/</div>
                      </div>
                    )}
                    {isCustomColor && (
                      <div className="absolute -top-1 -right-1 w-2 h-2 bg-accent rounded-full border border-white dark:border-border/80"></div>
                    )}
                  </button>
                );
              })}
            </div>
            {customColors.length > 0 && (
              <div className="mt-2 text-xs text-muted-foreground/80">
                {customColors.length} color{customColors.length > 1 ? 'es' : ''} personalizado{customColors.length > 1 ? 's' : ''}
              </div>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// Gradient Editor Component
function GradientEditor({ gradient, onGradientChange }: { gradient: string; onGradientChange: (gradient: string) => void }) {
  // Parse gradient string to extract colors and angle
  const parseGradient = (grad: string) => {
    // Regex mejorado que soporta transparent, hex, rgba, rgb
    const regex = /linear-gradient\((\d+)deg,\s*(transparent|#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3}|rgba?\(.+?\))\s*0%,\s*(transparent|#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3}|rgba?\(.+?\))\s*100%\)/;
    const match = regex.exec(grad);
    if (match && match.length >= 4) {
      return {
        angle: parseInt(match[1]),
        fromColor: match[2],
        toColor: match[3],
      };
    }
    return { angle: 135, fromColor: '#667eea', toColor: '#764ba2' };
  };

  const { angle, fromColor: parsedFromColor, toColor: parsedToColor } = parseGradient(gradient);
  const lastGradientRef = React.useRef(gradient);
  
  // Estado local para mantener los colores seleccionados
  const [localFromColor, setLocalFromColor] = React.useState(parsedFromColor);
  const [localToColor, setLocalToColor] = React.useState(parsedToColor);
  
  // Actualizar estados locales cuando cambia el gradiente externo
  React.useEffect(() => {
    const { fromColor: newFromColor, toColor: newToColor } = parseGradient(gradient);
    setLocalFromColor(newFromColor);
    setLocalToColor(newToColor);
  }, [gradient]);

  const updateGradient = (newAngle?: number, newFromColor?: string, newToColor?: string) => {
    const finalAngle = newAngle !== undefined ? newAngle : angle;
    const finalFromColor = newFromColor !== undefined ? newFromColor : localFromColor;
    const finalToColor = newToColor !== undefined ? newToColor : localToColor;
    
    // Actualizar estados locales
    if (newFromColor !== undefined) setLocalFromColor(newFromColor);
    if (newToColor !== undefined) setLocalToColor(newToColor);
    
    const newGradient = `linear-gradient(${finalAngle}deg, ${finalFromColor} 0%, ${finalToColor} 100%)`;
    
    // Solo actualizar si el gradiente realmente cambió
    if (newGradient !== lastGradientRef.current) {
      lastGradientRef.current = newGradient;
      onGradientChange(newGradient);
    }
  };

  // Actualizar la referencia cuando el gradiente cambia desde fuera
  React.useEffect(() => {
    if (gradient !== lastGradientRef.current) {
      lastGradientRef.current = gradient;
    }
  }, [gradient]);

  return (
    <>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label className="mb-2 block">Color inicial</Label>
          <div className="flex items-center space-x-2">
            <ColorPicker 
              color={localFromColor} 
              onColorChange={(color) => updateGradient(undefined, color, undefined)} 
              disableAutoSave={true}
            />
            <Input
              type="text"
              value={localFromColor}
              onChange={(e) => updateGradient(undefined, e.target.value, undefined)}
              className="flex-1"
              placeholder="#667eea"
            />
          </div>
        </div>
        <div>
          <Label className="mb-2 block">Color final</Label>
          <div className="flex items-center space-x-2">
            <ColorPicker 
              color={localToColor} 
              onColorChange={(color) => updateGradient(undefined, undefined, color)} 
              disableAutoSave={true}
            />
            <Input
              type="text"
              value={localToColor}
              onChange={(e) => updateGradient(undefined, undefined, e.target.value)}
              className="flex-1"
              placeholder="#764ba2"
            />
          </div>
        </div>
      </div>
      <div>
        <Label className="mb-2 block">Ángulo: {angle}°</Label>
        <div className="flex items-center space-x-4">
          <Slider
            value={[angle]}
            min={0}
            max={360}
            step={1}
            onValueChange={(value) => updateGradient(value[0], undefined, undefined)}
            className="flex-1"
          />
          <div className="text-sm text-muted-foreground/80 min-w-[80px] text-right">
            {angle}°
          </div>
        </div>
      </div>
    </>
  );
}

interface PropertyEditorProps {
  selectedComponent: {
    id: string;
    name: string;
    type: string;
    background?: {
      hasImage: boolean;
      imageUrl: string;
      backgroundImage: string;
      backgroundColor: string;
      backgroundSize: string;
      backgroundPosition: string;
      backgroundRepeat: string;
      backgroundOpacity: number;
      isImgTag: boolean;
      imgSrc: string;
      imgAlt: string;
      hasChildImages: boolean;
      childImageInfo?: {
        src: string;
        alt: string;
        tagName: string;
      };
      tag: string;
    };
    icon?: {
      hasIcon: boolean;
      name: string;
      size: number;
      color: string;
      strokeWidth: number;
    };
  };
  properties: Record<string, any>;
  onPropertyChange: (properties: any) => void;
  projectId?: string;
  projectSource?: string;
  onDownloadImages?: () => void;
  onDeleteComponent?: (componentId: string) => void;
}

export function PropertyEditor({ 
  selectedComponent, 
  properties: savedProperties, 
  onPropertyChange, 
  projectId, 
  projectSource, 
  onDownloadImages, 
  onDeleteComponent
}: PropertyEditorProps) {
  const { t } = useTranslation();
  const [isUploading, setIsUploading] = useState(false);
  const [uploadedImages, setUploadedImages] = useState<Record<string, any>>({});
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [publicUploadsExists, setPublicUploadsExists] = useState(true);

  // Detectar automáticamente el puerto del servidor con fallback para Zeus
  const getImageUrl = (relativeUrl: string) => {
    if (typeof window !== 'undefined') {
      const currentPort = window.location.port;
      const currentUrl = `${window.location.protocol}//${window.location.hostname}:${currentPort}`;
      
      // Si estamos en puerto 3000, usarlo directamente
      if (currentPort === '3000') {
        return currentUrl;
      }
      
      // Para otros puertos, crear URLs de prueba
      const zeusUrl = `${window.location.protocol}//${window.location.hostname}:3000`;
      
      console.log('[PropertyEditor] 🌐 URLs generadas:', {
        current: currentUrl,
        zeus: zeusUrl
      });
      
      // Devolver un objeto con ambas opciones para que el componente intente ambas
      return {
        primary: currentUrl,
        fallback: zeusUrl
      };
    }
    return { primary: `http://localhost:3000`, fallback: null };
  };
  
  // Función para obtener URL pública de imagen subida
  const getServerImageUrl = (fileName: string, _projectId?: string) => {
    return `/api/serve-upload?fileName=${encodeURIComponent(fileName)}`;
  };

  // Copiar texto al portapapeles con fallback
  const copyToClipboard = async (text: string, label: string) => {
    if (!text) {
      toast.info(`No hay ${label} para copiar`);
      return;
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        toast.success(`${label} copiada al portapapeles`);
      } else {
        // Fallback para navegadores sin clipboard API
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(textarea);
        if (ok) {
          toast.success(`${label} copiada al portapapeles`);
        } else {
          throw new Error('execCommand copy failed');
        }
      }
    } catch (err) {
      console.error('[PropertyEditor] Error al copiar:', err);
      toast.error(`Error al copiar la ${label}. Copie manualmente del campo de texto.`);
    }
  };

  // Función para convertir URLs del servidor en URLs relativas amigables
  const getFriendlyImageUrl = (serverUrl: string): string => {
    try {
      // Si es una URL del endpoint de uploads, convertirla a ruta relativa directa
      if (serverUrl.includes('/api/serve-upload')) {
        const url = new URL(serverUrl, 'http://localhost');
        const fileName = url.searchParams.get('fileName');
        if (fileName) {
          return `/${fileName}`;
        }
        return serverUrl;
      }

      // Si ya es una URL relativa directa (/imagen.jpg), devolverla tal cual
      if (serverUrl.match(/^\/[^\/]+\.\w+$/)) {
        return serverUrl;
      }

      // Si ya es una URL relativa de uploads, devolverla tal cual
      if (serverUrl.startsWith('/uploads/')) {
        return serverUrl;
      }

      // Para otras URLs, devolver la original
      return serverUrl;
    } catch (error) {
      console.warn('[PropertyEditor] Error al convertir URL amigable:', error);
      return serverUrl;
    }
  };

  // Función para convertir URLs relativas en URLs del servidor
  const getServerUrlFromFriendly = (friendlyUrl: string, projectId?: string): string => {
    // Si es una URL relativa de uploads, convertirla al endpoint del servidor
    if (friendlyUrl.startsWith('/uploads/')) {
      const fileName = friendlyUrl.split('/uploads/')[1];
      if (fileName) {
        return getServerImageUrl(fileName, projectId);
      }
    }
    
    // Si ya es una URL del servidor, devolverla tal cual
    if (friendlyUrl.includes('/api/serve-upload')) {
      return friendlyUrl;
    }
    
    // Para otras URLs, devolver la original
    return friendlyUrl;
  };


  // Componente de imagen inteligente que intenta múltiples puertos
  const SmartImage = ({ src, alt, className, onError }: any) => {
    const [currentUrlIndex, setCurrentUrlIndex] = useState(0);

    const getUrlList = (imageSrc: string) => {
      if (!imageSrc) return [];
      
      const list: string[] = [];
      
      // Si es una URL del endpoint de serve-upload o base64, agregarla primero
      if (imageSrc.includes('/api/serve-upload') || imageSrc.startsWith('data:')) {
        list.push(imageSrc);
      } else if (imageSrc.startsWith('/uploads/')) {
        // Convertir ruta de uploads antigua al nuevo endpoint de la API
        const fileName = imageSrc.split('/uploads/').pop();
        if (fileName) {
          list.push(`/api/serve-upload?fileName=${encodeURIComponent(fileName)}`);
        }
        list.push(imageSrc);
      } else if (imageSrc.match(/^[0-9]+-.*?\.(jpg|jpeg|png|gif|webp|svg)$/i)) {
        // Es un nombre de archivo puro de Zeus, intentar vía API
        list.push(`/api/serve-upload?fileName=${encodeURIComponent(imageSrc)}`);
      } else {
        // URL externa o relativa directa
        list.push(imageSrc);
      }
      
      return list;
    };

    const urls = getUrlList(src);
    const currentSrc = urls[currentUrlIndex];

    const handleError = (e: any) => {
      console.warn(`[SmartImage] ❌ Error con URL ${currentUrlIndex}:`, currentSrc);

      if (currentUrlIndex < urls.length - 1) {
        // Intentar con la siguiente URL
        setCurrentUrlIndex(currentUrlIndex + 1);
        console.log(`[SmartImage] 🔄 Intentando con URL ${currentUrlIndex + 1}:`, urls[currentUrlIndex + 1]);
      } else {
        console.error('[SmartImage] ❌ Todas las URLs fallaron:', urls);
        if (onError) onError(e);
      }
    };

    if (!currentSrc) return <div className="flex items-center justify-center bg-gray-100 dark:bg-card text-xs text-muted-foreground">Sin imagen</div>;

    return (
      <img
        src={currentSrc}
        alt={alt}
        className={className}
        onError={handleError}
        onLoad={() => console.log(`[SmartImage] ✅ Imagen cargada con URL ${currentUrlIndex}:`, currentSrc)}
      />
    );
  };

  // Función para copiar las imágenes subidas a la carpeta public/
  const downloadPublicUploads = async () => {
    try {
      console.log('[PropertyEditor] 📦 Copiando uploads selectivos a public/...');
      
      const fileNames = Object.keys(uploadedImages);
      if (fileNames.length === 0) {
        toast.info('No hay imágenes subidas en este proyecto para copiar.');
        return;
      }

      const response = await fetch('/api/copy-uploads-to-public', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: fileNames })
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || `Error al copiar archivos (${response.status})`);
      }

      toast.success(`✅ ${result.copied.length} archivo(s) copiado(s) a la carpeta public/`);
      console.log('[PropertyEditor] ✅ Archivos copiados:', result.copied);

      if (result.skipped.length > 0) {
        console.warn('[PropertyEditor] ⚠️ Archivos omitidos:', result.skipped);
      }

      // Actualizar uploadedImages con la URL relativa directa para cada archivo copiado
      const updatedImages = { ...uploadedImages };
      for (const fileName of result.copied) {
        if (updatedImages[fileName]) {
          updatedImages[fileName] = {
            ...updatedImages[fileName],
            relativeUrl: `/${fileName}`
          };
        }
      }
      setUploadedImages(updatedImages);
      const storageKey = projectId ? `zeus_uploaded_images_${projectId}` : 'zeus_uploaded_images';
      localStorage.setItem(storageKey, JSON.stringify(updatedImages));
      console.log('[PropertyEditor] ✅ URLs relativas actualizadas:', result.copied);
    } catch (error) {
      console.error('[PropertyEditor] ❌ Error al copiar a public/:', error);
      toast.error(error instanceof Error ? error.message : 'Error al copiar las imágenes');
    }
  };

  // Función para manejar la carga de imágenes (soporta múltiples archivos)
  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);
    let successfulUploads = 0;
    let failedUploads = 0;

    try {
      // Procesar cada archivo
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        
        // Validar que sea una imagen
        if (!file.type.startsWith('image/')) {
          toast.error(`El archivo ${file.name} no es una imagen`);
          failedUploads++;
          continue;
        }

        try {
          // Crear FormData para la subida
          const formData = new FormData();
          formData.append('file', file);

          // Agregar projectId si está disponible
          if (projectId) {
            formData.append('projectId', projectId);
          }

          // Agregar projectSource si está disponible
          if (projectSource) {
            formData.append('projectSource', projectSource);
          }

          console.log(`[PropertyEditor] 📤 Subiendo imagen (${i + 1}/${files.length}):`, {
            fileName: file.name,
            fileSize: file.size,
            fileType: file.type,
            projectId,
            projectSource
          });

          // Subir al servidor
          const response = await fetch('/api/upload-image', {
            method: 'POST',
            body: formData,
          });

          if (!response.ok) {
            const rawText = await response.text();
            let errorData: { error?: string } = { error: rawText || `Error ${response.status}: ${response.statusText}` };
            try {
              const parsed = JSON.parse(rawText);
              if (parsed.error) errorData = parsed;
            } catch {
              // No era JSON, usar el texto raw
            }
            console.error('[PropertyEditor] ❌ Error del servidor:', { status: response.status, body: rawText });
            throw new Error(errorData.error || `Error ${response.status}: ${response.statusText}`);
          }

          const result = await response.json();
          console.log('[PropertyEditor] ✅ Respuesta del servidor:', result);

          if (result.success && result.data) {
            // Guardar en localStorage (específico del proyecto)
            try {
              const storageKey = projectId ? `zeus_uploaded_images_${projectId}` : 'zeus_uploaded_images';
              const existingImages = JSON.parse(localStorage.getItem(storageKey) || '{}');
              existingImages[result.data.fileName] = {
                ...result.data,
                uploadedAt: new Date().toISOString()
              };

              localStorage.setItem(storageKey, JSON.stringify(existingImages));
              setUploadedImages(existingImages);

              successfulUploads++;
              console.log(`[PropertyEditor] ✅ Imagen guardada en localStorage (${storageKey}):`, result.data.fileName);
            } catch (storageError) {
              console.error('[PropertyEditor] ❌ Error en localStorage:', storageError);
              toast.error(`Error al guardar la referencia de ${file.name}`);
              failedUploads++;
            }
          } else {
            throw new Error(result.error || 'Error al subir la imagen');
          }
        } catch (fileError) {
          console.error(`[PropertyEditor] ❌ Error al subir ${file.name}:`, fileError);
          const errorMessage = fileError instanceof Error ? fileError.message : 'Error desconocido';
          toast.error(`Error al subir ${file.name}: ${errorMessage}`);
          failedUploads++;
        }
      }

      // Mostrar resumen final
      if (successfulUploads > 0) {
        toast.success(`✅ ${successfulUploads} imagen(es) subida(s) correctamente`);
      }
      if (failedUploads > 0) {
        toast.warning(`⚠️ ${failedUploads} imagen(es) fallaron al subirse`);
      }

    } catch (error) {
      console.error('[PropertyEditor] ❌ Error general en la subida:', error);
      const errorMessage = error instanceof Error ? error.message : 'Error desconocido';
      toast.error(`Error en la subida: ${errorMessage}`);
    } finally {
      setIsUploading(false);
    }

    // Limpiar el input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Cargar imágenes almacenadas al montar el componente o cambiar el proyecto
  React.useEffect(() => {
    try {
      const storageKey = projectId ? `zeus_uploaded_images_${projectId}` : 'zeus_uploaded_images';
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const parsedImages = JSON.parse(stored);
        console.log(`[PropertyEditor] 📋 Cargando imágenes almacenadas para ${storageKey}:`, Object.keys(parsedImages).length, 'imágenes');
        setUploadedImages(parsedImages);
      } else {
        setUploadedImages({});
        console.log(`[PropertyEditor] 📋 No hay imágenes almacenadas para ${storageKey}`);
      }
    } catch (error) {
      console.error('[PropertyEditor] ❌ Error al cargar imágenes almacenadas:', error);
    }
  }, [projectId]);

  // Verificar si existe la carpeta public/uploads
  React.useEffect(() => {
    const checkPublicUploads = async () => {
      try {
        const response = await fetch('/api/check-public-uploads', {
          method: 'GET',
        });

        if (response.ok) {
          const result = await response.json();
          setPublicUploadsExists(result.exists);
          console.log('[PropertyEditor] 📁 Carpeta public/uploads existe:', result.exists);
        }
      } catch (error) {
        console.warn('[PropertyEditor] ⚠️ No se pudo verificar la carpeta public/uploads:', error);
        setPublicUploadsExists(false);
      }
    };

    checkPublicUploads();
  }, []);

  const defaultProperties = {
    background: {
      color: 'transparent',
      gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      type: 'solid' as 'solid' | 'gradient' | 'image',
      image: '',
      imageOpacity: 1,
      imageSize: 'cover' as 'cover' | 'contain' | 'auto' | 'repeat' | 'scale-down' | 'custom',
      customSize: 100, // tamaño personalizado en porcentaje
      positionX: 50, // posición horizontal en porcentaje (0-100)
      positionY: 50, // posición vertical en porcentaje (0-100)
    },
    display: {
      value: 'block' as 'block' | 'none' | 'inline' | 'inline-block' | 'flex' | 'grid',
    },
    img: {
      src: '',
      alt: '',
    },
    border: {
      color: '#e5e7eb',
      width: 1,
      radius: 8,
      style: 'solid' as 'solid' | 'dashed' | 'dotted',
    },
    size: {
      width: 'auto',
      height: 'auto',
      padding: 16,
      margin: 0,
      position: 'relative' as 'relative' | 'absolute' | 'fixed',
      positionX: 0, // posición horizontal en pixels (-500 a 500)
      positionY: 0, // posición vertical en pixels (-500 a 500)
    },
    typography: {
      fontFamily: 'Inter',
      fontSize: 16,
      fontWeight: 400,
      color: '#ffffff',
      textGradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      textType: 'solid' as 'solid' | 'gradient',
      lineHeight: 1.5,
      alignment: 'left' as 'left' | 'center' | 'right' | 'justify',
      textContent: '', // Nuevo campo para cambiar el contenido del texto
      textStroke: {
        enabled: false,
        color: '#000000',
        width: 1,
        opacity: 1,
      },
      textShadow: {
        enabled: false,
        color: '#000000',
        blur: 4,
        offsetX: 2,
        offsetY: 2,
        opacity: 0.5,
      },
    },
    shadow: {
      color: '#000000',
      blur: 10,
      spread: 0,
      offsetX: 0,
      offsetY: 4,
      opacity: 0.1,
    },
    icon: {
      name: '',
      size: 20,
      color: '#000000',
      strokeWidth: 2,
    },
  };

  const [newTextContent, setNewTextContent] = useState('');

  React.useEffect(() => {
    if (properties?.typography?.textContent) {
      setNewTextContent(properties.typography.textContent);
    } else {
      setNewTextContent('');
    }
  }, [savedProperties?.typography?.textContent, selectedComponent]);

  // Track if user has made any changes to avoid applying defaults
  const [hasUserMadeChanges, setHasUserMadeChanges] = useState(false);
  const [properties, setProperties] = useState<any | null>(savedProperties || null);
  const isInitialMount = React.useRef(true);

  // Update properties when savedProperties change (component selection or undo/redo)
  // Usar useRef para rastrear el último valor y evitar bucles infinitos
  const lastSavedPropertiesRef = React.useRef<string | null>(null);
  const lastComponentIdRef = React.useRef<string | undefined>(undefined);
  
  // CRÍTICO: Capturar el ID del componente cuando se selecciona para usarlo al guardar
  // Esto evita que los cambios se guarden en el componente incorrecto si selectedComponentId cambia
  const currentComponentIdRef = React.useRef<string | null>(null);
  
  // Track which categories have been modified by the user
  const modifiedCategoriesRef = React.useRef<Set<string>>(new Set());

  // Estilos personalizados guardados
  type SavedStyle = {
    id: string;
    name: string;
    type: 'button' | 'text' | 'container' | 'icon';
    properties: any;
    createdAt: number;
  };

  // Inicializar estilos desde localStorage - solo en el cliente
  const getInitialSavedStyles = (): Record<string, SavedStyle[]> => {
    // Verificar si estamos en el cliente antes de acceder a localStorage
    if (typeof window === 'undefined') {
      return {
        button: [],
        text: [],
        container: [],
        icon: [],
      };
    }
    
    try {
      const stored = localStorage.getItem('zeus-saved-styles');
      if (stored) {
        const parsed = JSON.parse(stored);
        // Asegurar que todos los tipos estén presentes
        return {
          button: parsed.button || [],
          text: parsed.text || [],
          container: parsed.container || [],
          icon: parsed.icon || [],
        };
      }
    } catch (error) {
      console.error('[PropertyEditor] Error loading saved styles:', error);
    }
    return {
      button: [],
      text: [],
      container: [],
      icon: [],
    };
  };

  const [savedStyles, setSavedStyles] = useState<Record<string, SavedStyle[]>>(() => getInitialSavedStyles());
  const [styleName, setStyleName] = useState('');
  const [savedStyleType, setSavedStyleType] = useState<'button' | 'text' | 'container' | 'icon'>('button');
  const [applyStyleType, setApplyStyleType] = useState<'button' | 'text' | 'container' | 'icon'>('button');
  const [selectedStyleId, setSelectedStyleId] = useState('');

  // Guardar estilos en localStorage cuando cambien
  React.useEffect(() => {
    try {
      const stylesToSave = {
        button: savedStyles.button || [],
        text: savedStyles.text || [],
        container: savedStyles.container || [],
        icon: savedStyles.icon || [],
      };
      localStorage.setItem('zeus-saved-styles', JSON.stringify(stylesToSave));
      console.log('[PropertyEditor] Estilos guardados en localStorage:', stylesToSave);
    } catch (error) {
      console.error('[PropertyEditor] Error saving styles:', error);
    }
  }, [savedStyles]);

  // Recargar estilos desde localStorage cuando cambie el componente (por si acaso)
  React.useEffect(() => {
    try {
      const stored = localStorage.getItem('zeus-saved-styles');
      if (stored) {
        const parsed = JSON.parse(stored);
        // Solo actualizar si hay diferencias para evitar bucles
        const currentStylesString = JSON.stringify(savedStyles);
        const storedStylesString = JSON.stringify({
          button: parsed.button || [],
          text: parsed.text || [],
          container: parsed.container || [],
          icon: parsed.icon || [],
        });
        
        if (currentStylesString !== storedStylesString) {
          console.log('[PropertyEditor] Recargando estilos desde localStorage al cambiar componente');
          setSavedStyles({
            button: parsed.button || [],
            text: parsed.text || [],
            container: parsed.container || [],
            icon: parsed.icon || [],
          });
        }
      }
    } catch (error) {
      console.error('[PropertyEditor] Error reloading styles:', error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedComponent?.id]);

  const handleSaveStyle = () => {
    if (!styleName.trim() || !savedStyleType || !properties) {
      console.warn('[PropertyEditor] No se puede guardar estilo:', {
        hasName: !!styleName.trim(),
        hasType: !!savedStyleType,
        hasProperties: !!properties
      });
      return;
    }

    const newStyle: SavedStyle = {
      id: `style-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: styleName.trim(),
      type: savedStyleType,
      properties: JSON.parse(JSON.stringify(properties)), // Deep copy
      createdAt: Date.now(),
    };

    setSavedStyles(prev => {
      const updated = {
        ...prev,
        [savedStyleType]: [...(prev[savedStyleType] || []), newStyle],
      };
      console.log('[PropertyEditor] Estilo guardado:', {
        name: newStyle.name,
        type: newStyle.type,
        totalStylesForType: updated[savedStyleType].length,
        allStyles: updated
      });
      
      // Actualizar automáticamente el tipo en "Aplicar Estilo Guardado" para que coincida
      setApplyStyleType(savedStyleType);
      
      return updated;
    });

    setStyleName('');
  };

  const handleApplyStyle = () => {
    if (!selectedStyleId || !applyStyleType) return;

    const style = savedStyles[applyStyleType]?.find(s => s.id === selectedStyleId);
    if (!style) return;

    // Aplicar las propiedades guardadas
    setProperties(style.properties);
    setHasUserMadeChanges(true);

    // Notificar al padre
    if (onPropertyChange) {
      onPropertyChange(style.properties);
    }

    console.log('Estilo aplicado:', style.name);
  };

  const handleDeleteStyle = (styleId: string) => {
    if (!applyStyleType) return;

    setSavedStyles(prev => ({
      ...prev,
      [applyStyleType]: (prev[applyStyleType] || []).filter(s => s.id !== styleId),
    }));

    setSelectedStyleId('');
    console.log('Estilo eliminado');
  };

  // Crear iconMap dentro del componente usando useMemo para asegurar que los componentes estén disponibles
  const iconMap = React.useMemo<Record<string, React.ElementType>>(() => {
    const map: Record<string, React.ElementType> = {
      home: Home,
      user: User,
      settings: Settings,
      heart: Heart,
      star: Star,
      search: Search,
      mail: Mail,
      phone: Phone,
      calendar: Calendar,
      camera: Camera,
      edit: Edit,
      trash: Trash,
      plus: Plus,
      minus: Minus,
      checkIcon: CheckIconComponent,
      x: X,
      zap: Zap,
      refreshCw: RefreshCwIconComponent,
      move: Move,
      rotateCcw: RotateCcw,
      save: Save,
      paintbrush: Paintbrush,
      ruler: Ruler,
      image: Image,
      activity: Activity,
      alertCircle: AlertCircle,
      archive: Archive,
      arrowDown: ArrowDown,
      arrowLeft: ArrowLeft,
      arrowRight: ArrowRight,
      arrowUp: ArrowUp,
      atSign: AtSign,
      award: Award,
      bell: Bell,
      bookmark: Bookmark,
      check: CheckIcon,
      chevronDown: ChevronDown,
      chevronLeft: ChevronLeft,
      chevronRight: ChevronRight,
      chevronUp: ChevronUp,
      circle: Circle,
      clipboard: Clipboard,
      clock: Clock,
      cloud: Cloud,
      code: Code,
      command: Command,
      creditCard: CreditCard,
      database: Database,
      disc: Disc,
      download: Download,
      externalLink: ExternalLink,
      file: File,
      filter: Filter,
      flag: Flag,
      folder: Folder,
      gift: Gift,
      globe: Globe,
      grid: Grid,
      hardDrive: HardDrive,
      hash: Hash,
      headphones: Headphones,
      inbox: Inbox,
      info: Info,
      key: Key,
      layers: Layers,
      lifeBuoy: LifeBuoy,
      link: Link,
      list: List,
      lock: Lock,
      logIn: LogIn,
      logOut: LogOut,
      map: Map,
      menu: Menu,
      messageCircle: MessageCircle,
      messageSquare: MessageSquare,
      mic: Mic,
      monitor: Monitor,
      moon: Moon,
      moreHorizontal: MoreHorizontal,
      moreVertical: MoreVertical,
      mousePointer: MousePointer,
      music: Music,
      navigation: Navigation,
      package: Package,
      paperclip: Paperclip,
      pause: Pause,
      penTool: PenTool,
      play: Play,
      power: Power,
      printer: Printer,
      qrCode: QrCode,
      repeat: Repeat,
      rss: Rss,
      scissors: Scissors,
      send: Send,
      share: Share,
      shield: Shield,
      shoppingBag: ShoppingBag,
      shoppingCart: ShoppingCart,
      sun: Sun,
      tag: Tag,
      target: Target,
      terminal: Terminal,
      thumbsDown: ThumbsDown,
      thumbsUp: ThumbsUp,
      toggleLeft: ToggleLeft,
      toggleRight: ToggleRight,
      trendingDown: TrendingDown,
      trendingUp: TrendingUp,
      truck: Truck,
      tv: Tv,
      umbrella: Umbrella,
      unlock: Unlock,
      upload: Upload,
      users: Users,
      video: Video,
      voicemail: Voicemail,
      volume1: Volume1,
      volume2: Volume2,
      volumeX: VolumeX,
      wallet: Wallet,
      watch: Watch,
      wifi: Wifi,
      zoomIn: ZoomIn,
      zoomOut: ZoomOut,
    };
    
    // Debug: verificar que el iconMap se creó correctamente
    if (process.env.NODE_ENV === 'development') {
      const iconKeys = Object.keys(map);
      const missingIcons = iconKeys.filter(key => !map[key]);
      if (missingIcons.length > 0) {
        console.warn('[PropertyEditor] Iconos faltantes en iconMap:', missingIcons);
      }
      console.log('[PropertyEditor] iconMap creado con', iconKeys.length, 'iconos');
    }
    
    return map;
  }, []);

  React.useEffect(() => {
    // Reset modified categories when component changes
    const componentChanged = lastComponentIdRef.current !== selectedComponent?.id;
    if (componentChanged) {
      modifiedCategoriesRef.current.clear();
      // If there are saved properties, mark those categories as modified
      if (savedProperties) {
        Object.keys(savedProperties).forEach(category => {
          modifiedCategoriesRef.current.add(category);
        });
      }
    }
    
    // Serializar savedProperties para comparación
    const currentSavedPropsString = savedProperties ? JSON.stringify(savedProperties) : null;
    
    // Actualizar si cambió el componente o las propiedades
    if (componentChanged || currentSavedPropsString !== lastSavedPropertiesRef.current) {
      lastSavedPropertiesRef.current = currentSavedPropsString;
      lastComponentIdRef.current = selectedComponent?.id;
      
      // CRÍTICO: Capturar el ID del componente cuando se selecciona
      if (selectedComponent?.id) {
        currentComponentIdRef.current = selectedComponent.id;
        console.log('[PropertyEditor] Component ID capturado:', selectedComponent.id);
      }
      
      const wasInitialMount = isInitialMount.current;
      
      if (savedProperties) {
        // Component has saved properties, use them
        // Crear copia para asegurar nueva referencia
        setProperties(JSON.parse(JSON.stringify(savedProperties)));
        // Si es un cambio de componente (no undo/redo), marcar como cambios del usuario
        if (wasInitialMount || componentChanged) {
          setHasUserMadeChanges(true);
        }
        // Resetear el flag solo cuando cambia el componente
        if (componentChanged) {
          isInitialMount.current = true;
        }
      } else if (selectedComponent) {
        // Component selected but no saved properties - check if it has background info from component-selector-helper
        console.log('[PropertyEditor] 🔍 Verificando información de fondo del componente seleccionado:', selectedComponent);
        
        // 🔥 NUEVO: Verificar si el componente tiene información de fondo del iframe
        if (selectedComponent.background && selectedComponent.background.hasImage) {
          console.log('[PropertyEditor] ✅ Imagen detectada en componente seleccionado, inicializando propiedades...', selectedComponent.background);
          
          // Inicializar propiedades con la información de la imagen detectada
          const initialProperties = {
            background: {
              type: 'image',
              image: selectedComponent.background.imageUrl,
              // Mantener otras propiedades por defecto
              color: 'transparent',
              gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
            }
          };
          
          setProperties(initialProperties);
          setHasUserMadeChanges(true); // Marcar como si el usuario hubiera hecho cambios para que se apliquen
          console.log('[PropertyEditor] ✅ Propiedades inicializadas con imagen:', initialProperties);
        } else if (selectedComponent.icon && selectedComponent.icon.hasIcon) {
          // Componente seleccionado tiene un icono detectado
          console.log('[PropertyEditor] ✅ Icono detectado en componente seleccionado, inicializando propiedades...', selectedComponent.icon);

          const initialProperties = {
            icon: {
              name: selectedComponent.icon.name,
              size: selectedComponent.icon.size || 20,
              color: selectedComponent.icon.color || '#000000',
              strokeWidth: selectedComponent.icon.strokeWidth || 2,
            }
          };

          setProperties(initialProperties);
          setHasUserMadeChanges(true);
          console.log('[PropertyEditor] ✅ Propiedades inicializadas con icono:', initialProperties);
        } else {
          // Component selected but no saved properties and no background info - don't apply defaults
          // Set to null so no styles are applied
          setProperties(null);
          setHasUserMadeChanges(false);
          console.log('[PropertyEditor] ℹ️ Sin propiedades guardadas ni imagen detectada');
        }
        // Resetear el flag solo cuando cambia el componente
        if (componentChanged) {
          isInitialMount.current = true;
        }
        // IMPORTANTE: No llamar a onPropertyChange aquí para evitar aplicar estilos
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedComponent?.id, savedProperties]);

  // Notify parent when properties change - ONLY if user has made changes
  React.useEffect(() => {
    console.log('[PropertyEditor] useEffect de notificación al padre triggered:', {
      isInitialMount: isInitialMount.current,
      hasUserMadeChanges,
      hasSelectedComponent: !!selectedComponent,
      hasProperties: !!properties,
      hasOnPropertyChange: !!onPropertyChange,
      shouldNotify: !isInitialMount.current && selectedComponent && hasUserMadeChanges && properties
    });
    
    // Saltar la primera ejecución (montaje inicial o cambio de componente)
    if (isInitialMount.current) {
      console.log('[PropertyEditor] 🚫 Saltando notificación (montaje inicial)');
      isInitialMount.current = false;
      return;
    }
    
    // Solo notificar cuando el usuario haya hecho cambios explícitos
    if (onPropertyChange && selectedComponent && hasUserMadeChanges && properties) {
        // Enviar TODAS las propiedades del componente actual, no solo las filtradas
        console.log('[PropertyEditor] ✅ Notificando al padre de cambios de propiedades (full properties object):', properties);
        console.log('[PropertyEditor] 📤 Enviando onPropertyChange con:', {
          selectedComponentId: selectedComponent.id,
          selectedComponentName: selectedComponent.name,
          propertiesKeys: Object.keys(properties),
          hasBackground: !!properties.background,
          backgroundImage: properties.background?.image,
          backgroundType: properties.background?.type
        });
        onPropertyChange(properties);
    } else {
      console.log('[PropertyEditor] 🚫 No se notifica al padre porque:', {
        hasOnPropertyChange: !!onPropertyChange,
        hasSelectedComponent: !!selectedComponent,
        hasUserMadeChanges,
        hasProperties: !!properties
      });
    }
    // Si no hay cambios del usuario, NO llamar a onPropertyChange en absoluto
    // Esto evita que se apliquen estilos por defecto
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [properties, hasUserMadeChanges]);

  const updateProperty = (category: keyof typeof defaultProperties, key: string, value: any) => {
    console.log('[PropertyEditor] updateProperty called:', { category, key, value });
    console.log('[PropertyEditor] Estado antes de updateProperty:', {
      hasUserMadeChanges,
      selectedComponentId: selectedComponent?.id,
      currentProperties: properties
    });
    
    setHasUserMadeChanges(true);
    // Mark this category as modified
    modifiedCategoriesRef.current.add(category);
    
    setProperties((prev: any) => {
      // Si no hay propiedades previas, crear un objeto vacío
      // Solo aplicar la propiedad que el usuario está cambiando
      const currentProps = prev || {};
      const currentCategory = currentProps[category] || {};
      
      // Para icon, asegurar que tenemos un objeto completo solo si es la primera vez
      let updatedCategory = { ...currentCategory };
      if (category === 'icon') {
        // Solo establecer propiedades por defecto si no existen
        if (!updatedCategory.name) updatedCategory.name = defaultProperties.icon.name;
        if (!updatedCategory.size) updatedCategory.size = defaultProperties.icon.size;
        if (!updatedCategory.color) updatedCategory.color = defaultProperties.icon.color;
        if (!updatedCategory.strokeWidth) updatedCategory.strokeWidth = defaultProperties.icon.strokeWidth;
      }
      
      // Actualizar solo la propiedad específica
      updatedCategory[key] = value;
      
      const newProps = {
        ...currentProps,
        [category]: updatedCategory,
      };
      
      console.log('[PropertyEditor] Updated properties:', {
        category,
        key,
        value,
        previousValue: currentCategory[key],
        newValue: value,
        fullNewProps: newProps,
        hasUserMadeChangesAfter: true
      });
      
      return newProps;
    });
    
    console.log('[PropertyEditor] Estado después de updateProperty:', {
      hasUserMadeChanges,
      modifiedCategories: Array.from(modifiedCategoriesRef.current)
    });
  };

  const resetCategory = (category: keyof typeof defaultProperties) => {
    setHasUserMadeChanges(true);
    const defaults = {
      background: { color: 'transparent', gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', type: 'solid' },
      display: { value: 'block' },
      img: { src: '', alt: '' },
      border: { color: '#e5e7eb', width: 1, radius: 8, style: 'solid' },
      size: { width: 'auto', height: 'auto', padding: 16, margin: 0, position: 'relative', positionX: 0, positionY: 0 },
      typography: { 
      fontFamily: 'Inter', 
      fontSize: 16, 
      fontWeight: 400, 
      color: '#ffffff', 
      textGradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      textType: 'solid' as 'solid' | 'gradient',
      lineHeight: 1.5, 
      alignment: 'left', 
      textContent: '',
      textStroke: { enabled: false, color: '#000000', width: 1, opacity: 1 }, 
      textShadow: { enabled: false, color: '#000000', blur: 4, offsetX: 2, offsetY: 2, opacity: 0.5 }
    },
      shadow: { color: '#000000', blur: 10, spread: 0, offsetX: 0, offsetY: 4, opacity: 0.1 },
      icon: { name: '', size: 20, color: '#000000', strokeWidth: 2 },
    };
    setProperties((prev: {
        background: {
          color: string; gradient: string; type: "solid" | "gradient" | "image"; image: string; imageOpacity: number; imageSize: "cover" | "contain" | "auto" | "repeat" | "scale-down" | "custom"; customSize: number; // tamaño personalizado en porcentaje
          positionX: number; // posición horizontal en porcentaje (0-100)
          positionY: number;
        }; display: { value: "block" | "none" | "inline" | "inline-block" | "flex" | "grid"; }; img: { src: string; alt: string; }; border: { color: string; width: number; radius: number; style: "solid" | "dashed" | "dotted"; }; size: {
          width: string; height: string; padding: number; margin: number; position: "relative" | "absolute" | "fixed"; positionX: number; // posición horizontal en pixels (-500 a 500)
          positionY: number;
        }; typography: {
          fontFamily: string; fontSize: number; fontWeight: number; color: string; textGradient: string; textType: "solid" | "gradient"; lineHeight: number; alignment: "left" | "center" | "right" | "justify"; textContent: string; // Nuevo campo para cambiar el contenido del texto
          textStroke: { enabled: boolean; color: string; width: number; opacity: number; }; textShadow: { enabled: boolean; color: string; blur: number; offsetX: number; offsetY: number; opacity: number; };
        }; shadow: { color: string; blur: number; spread: number; offsetX: number; offsetY: number; opacity: number; }; icon: { name: string; size: number; color: string; strokeWidth: number; };
      }) => {
      const currentProps = prev || defaultProperties;
      return {
        ...currentProps,
        [category]: defaults[category],
      };
    });
  };

  if (!selectedComponent) {
    return (
      <div className="flex flex-col items-center justify-center h-full w-full p-8 text-center bg-card overflow-hidden">
        <Box className="h-16 w-16 text-muted-foreground/60 mb-4 opacity-50" />
        <h3 className="text-lg font-semibold mb-2 text-foreground/80">{t('noComponentSelected')}</h3>
        <p className="text-sm text-muted-foreground">
          {t('selectComponentInstructions')}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full w-full overflow-hidden">
      {/* Component Header */}
      <div className="p-4 border-b bg-gradient-to-r from-gray-800 to-gray-700">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">{selectedComponent.name}</h2>
            <p className="text-sm text-muted-foreground">
              {selectedComponent.type} • ID: {selectedComponent.id}
            </p>
          </div>
          <div className="flex items-center space-x-2">
            {onDeleteComponent && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onDeleteComponent(selectedComponent.id)}
                className="border-destructive text-destructive hover:bg-destructive hover:text-foreground transition-colors"
                title="Eliminar componente"
              >
                <Trash className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </div>


      {/* Property Tabs */}
      <Tabs defaultValue="background" className="flex-1 flex flex-col relative">
        <TabsList className="grid grid-cols-3 grid-rows-2 p-2 gap-1 h-auto shrink-0">
          <TabsTrigger 
            value="background" 
            className="flex items-center justify-center gap-2 text-xs data-[state=active]:border-[1.5px] data-[state=active]:border-dashed data-[state=active]:border-[#ADFF2F]"
          >
            <Palette className="h-4 w-4" />
            <span>{t('background')}</span>
          </TabsTrigger>
          <TabsTrigger 
            value="border" 
            className="flex items-center justify-center gap-2 text-xs data-[state=active]:border-[1.5px] data-[state=active]:border-dashed data-[state=active]:border-[#ADFF2F]"
          >
            <Square className="h-4 w-4" />
            <span>{t('border')}</span>
          </TabsTrigger>
          <TabsTrigger 
            value="size" 
            className="flex items-center justify-center gap-2 text-xs data-[state=active]:border-[1.5px] data-[state=active]:border-dashed data-[state=active]:border-[#ADFF2F]"
          >
            <Box className="h-4 w-4" />
            <span className="text-xs">{t('sizeAndPosition')}</span>
          </TabsTrigger>
          <TabsTrigger 
            value="typography" 
            className="flex items-center justify-center gap-2 text-xs data-[state=active]:border-[1.5px] data-[state=active]:border-dashed data-[state=active]:border-[#ADFF2F]"
          >
            <Type className="h-4 w-4" />
            <span>{t('typography')}</span>
          </TabsTrigger>
          <TabsTrigger 
            value="shadow" 
            className="flex items-center justify-center gap-2 text-xs data-[state=active]:border-[1.5px] data-[state=active]:border-dashed data-[state=active]:border-[#ADFF2F]"
          >
            <Droplets className="h-4 w-4" />
            <span>{t('shadow')}</span>
          </TabsTrigger>
          <TabsTrigger 
            value="icon" 
            className="flex items-center justify-center gap-2 text-xs data-[state=active]:border-[1.5px] data-[state=active]:border-dashed data-[state=active]:border-[#ADFF2F]"
          >
            <Sparkles className="h-4 w-4" />
            <span>{t('icon')}</span>
          </TabsTrigger>
        </TabsList>

        <div className="flex-1 relative overflow-hidden">
          {/* Background Tab */}
          <TabsContent value="background" className="absolute inset-0 overflow-y-auto p-4 space-y-6 m-0">
            <div className="space-y-4 pb-8">
              <div className="flex items-center justify-between">
                <Label>{t('backgroundType')}</Label>
                <Select
                  value={properties?.background?.type || defaultProperties.background.type}
                  onValueChange={(value: any) => updateProperty('background', 'type', value)}
                >
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="solid">{t('solidColor')}</SelectItem>
                    <SelectItem value="gradient">{t('gradient')}</SelectItem>
                    <SelectItem value="image">{t('image')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>


              {(properties?.background?.type || defaultProperties.background.type) === 'solid' && (
                <div className="space-y-4">
                  <div>
                    <Label className="mb-2 block">{t('color')}</Label>
                    <div className="flex items-center space-x-4">
                      <ColorPicker
                        color={properties?.background?.color || defaultProperties.background.color}
                        onColorChange={(newColor) => updateProperty('background', 'color', newColor)}
                      />
                      <Input
                        value={properties?.background?.color || defaultProperties.background.color}
                        onChange={(e) => updateProperty('background', 'color', e.target.value)}
                        className="flex-1"
                        placeholder="transparent"
                      />
                    </div>
                  </div>
                </div>
              )}

              {(properties?.background?.type || defaultProperties.background.type) === 'gradient' && (
                <div className="space-y-4">
                  <div>
                    <Label className="mb-2 block">{t('gradientPreview')}</Label>
                    <div
                      className="h-20 rounded-lg border"
                      style={{ background: properties?.background?.gradient || defaultProperties.background.gradient }}
                    />
                  </div>
                  <GradientEditor
                    gradient={properties?.background?.gradient || defaultProperties.background.gradient}
                    onGradientChange={(gradient) => {
                      // Actualizar gradiente y tipo en una sola operación
                      setHasUserMadeChanges(true);
                      modifiedCategoriesRef.current.add('background');
                      setProperties((prev: any) => {
                        const currentProps = prev || {};
                        const currentBackground = currentProps.background || {};
                        
                        const newProps = {
                          ...currentProps,
                          background: {
                            ...currentBackground,
                            gradient: gradient,
                            type: 'gradient' // Asegurar que el tipo sea 'gradient'
                          }
                        };
                        
                        // NO llamar a onPropertyChange aquí - dejar que el useEffect lo maneje
                        // Esto evita bucles infinitos
                        
                        return newProps;
                      });
                    }}
                  />
                </div>
              )}

              {(properties?.background?.type || defaultProperties.background.type) === 'image' && (
                <div className="space-y-4">
                  <div className="space-y-3">
                    <div>
                      <Label className="mb-2 block">{t('imageUrl')}</Label>
                      <div className="flex gap-2">
                        <Input
                          placeholder={t('enterImageUrl')}
                          value={getFriendlyImageUrl((properties?.background as any)?.image || '')}
                          onChange={(e) => {
                            // Convertir la URL amigable de vuelta a URL del servidor antes de guardar
                            const serverUrl = getServerUrlFromFriendly(e.target.value, projectId);
                            updateProperty('background', 'image', serverUrl);
                          }}
                          className="flex-1"
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            const friendlyUrl = getFriendlyImageUrl((properties?.background as any)?.image || '');
                            copyToClipboard(friendlyUrl, 'URL amigable');
                          }}
                          title="Copiar URL amigable (/uploads/nombre.jpg)"
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            const serverUrl = (properties?.background as any)?.image || '';
                            copyToClipboard(serverUrl, 'URL del servidor');
                          }}
                          title="Copiar URL del servidor (completa)"
                        >
                          <Server className="h-4 w-4" />
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground/80 dark:text-muted-foreground mt-1">
                        Ruta relativa: /uploads/nombre-archivo.jpg
                      </p>
                    </div>
                    
                    <div>
                      <Label className="mb-2 block text-xs text-muted-foreground">URL del Servidor (Interna)</Label>
                      <div className="text-xs font-mono text-foreground/70 bg-card p-2 rounded break-all max-h-20 overflow-y-auto">
                        {(properties?.background as any)?.image || 'Sin imagen seleccionada'}
                      </div>
                      <p className="text-xs text-muted-foreground/80 dark:text-muted-foreground mt-1">
                        URL utilizada internamente para cargar la imagen
                      </p>
                    </div>
                  </div>
                  
                  {/* Separador para carga de imágenes */}
                  <div className="flex items-center space-x-2">
                    <div className="flex-1 h-px bg-gray-300 dark:bg-muted/80"></div>
                    <span className="text-xs text-muted-foreground/80 dark:text-muted-foreground">O</span>
                    <div className="flex-1 h-px bg-gray-300 dark:bg-muted/80"></div>
                  </div>
                  
                  {/* Botón de carga de imagen */}
                  <div>
                    <Label className="mb-2 block">{t('uploadImage')}</Label>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={handleImageUpload}
                      className="hidden"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isUploading}
                      className="w-full border-dashed border-2 hover:border-blue-500 transition-colors"
                    >
                      {isUploading ? (
                        <>
                          <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                          {t('uploading')}...
                        </>
                      ) : (
                        <>
                          <Upload className="h-4 w-4 mr-2" />
                          {t('selectImage')}
                        </>
                      )}
                    </Button>
                  </div>

                  {/* Galería de imágenes cargadas */}
                  {Object.keys(uploadedImages).length > 0 && (
                    <div>
                      <Label className="mb-2 block">{t('uploadedImages') || 'Imágenes Subidas'}</Label>
                      <div className="grid grid-cols-3 gap-2 max-h-32 overflow-y-auto">
                        {Object.entries(uploadedImages).map(([fileName, imageData]) => (
                          <div
                            key={fileName}
                            className="relative group cursor-pointer border rounded overflow-hidden hover:border-blue-500 transition-colors"
                            onClick={() => {
                              // En el EDITOR, preferimos SIEMPRE la URL del servidor (/api/serve-upload)
                              // porque las rutas relativas (/imagen.jpg) solo funcionan dentro del reproductor.
                              const serverUrl = getServerImageUrl(fileName, projectId);
                              const imageUrl = serverUrl || imageData.url || imageData.data;
                              
                              console.log('[PropertyEditor] 🖼️ Seleccionando imagen de galería:', {
                                fileName,
                                url: imageUrl,
                                hasRelative: !!imageData.relativeUrl,
                                serverUrl: serverUrl
                              });

                              updateProperty('background', 'image', imageUrl);
                              if (properties?.background?.type !== 'image') {
                                updateProperty('background', 'type', 'image');
                              }
                            }}
                          >
                            <SmartImage
                              src={getServerImageUrl(fileName, projectId) || imageData.url || imageData.data}
                              alt={imageData.originalName || fileName}
                              className="w-full h-16 object-cover"
                            />
                            <div className="absolute inset-0 bg-background/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                              <CheckIconComponent className="h-4 w-4 text-foreground" />
                            </div>
                            <button
                              onClick={async (e) => {
                                e.stopPropagation();
                                
                                try {
                                  // Eliminar archivo físico del servidor
                                  const deleteParams = new URLSearchParams();
                                  deleteParams.append('fileName', fileName);
                                  if (projectId) {
                                    deleteParams.append('projectId', projectId);
                                  }
                                  if (projectSource) {
                                    deleteParams.append('projectSource', projectSource);
                                  }
                                  
                                  const response = await fetch(`/api/upload-image?${deleteParams}`, {
                                    method: 'DELETE',
                                  });
                                  
                                  if (response.ok) {
                                    console.log(`[PropertyEditor] ✅ Archivo físico eliminado: ${fileName}`);
                                  } else {
                                    console.warn(`[PropertyEditor] ⚠️ No se pudo eliminar el archivo físico: ${fileName}`);
                                  }
                                } catch (error) {
                                  console.warn(`[PropertyEditor] ⚠️ Error eliminando archivo físico: ${fileName}`, error);
                                }
                                
                                // Eliminar del localStorage
                                const newImages = { ...uploadedImages };
                                delete newImages[fileName];
                                setUploadedImages(newImages);
                                localStorage.setItem('zeus_uploaded_images', JSON.stringify(newImages));
                                
                                // Si la imagen eliminada estaba en uso, limpiar la propiedad
                                if ((properties?.background as any)?.image === (imageData.url || imageData.data)) {
                                  updateProperty('background', 'image', '');
                                }
                                
                                toast.success('Imagen eliminada');
                              }}
                            className="absolute top-1 right-1 bg-destructive text-foreground rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive"
                          >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Botón de descarga si hay imágenes */}
                  {Object.keys(uploadedImages).length > 0 && (
                    <div className="bg-blue-50 dark:bg-primary/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                      <div className="flex items-center space-x-3">
                        <div className="flex-1">
                          <div className="flex items-center space-x-2 mb-2">
                            <Download className="h-5 w-5 text-primary dark:text-primary" />
                            <Label className="text-sm font-semibold text-blue-800 dark:text-primary-foreground/80">
                              Imágenes disponibles ({Object.keys(uploadedImages).length})
                            </Label>
                          </div>
                          <p className="text-xs text-primary dark:text-primary-foreground">
                            {projectId && projectId.length > 0
                              ? 'Copia las imágenes subidas a la carpeta public/ del proyecto'
                              : projectSource === 'local' && !publicUploadsExists
                                ? 'Las imágenes están en el servidor. Copia las imágenes a la carpeta public/ de tu proyecto local.'
                                : 'Copia las imágenes subidas a la carpeta public/ del proyecto'
                            }
                          </p>
                        </div>
                        <Button
                          onClick={downloadPublicUploads}
                          className="border-blue-500 bg-primary text-foreground hover:bg-primary"
                          size="sm"
                        >
                          <Download className="h-4 w-4 mr-2" />
                          Copiar a public
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Advertencia si es proyecto local y no existe la carpeta */}
                  {projectSource === 'local' && !publicUploadsExists && Object.keys(uploadedImages).length === 0 && (
                    <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
                      <div className="flex items-center space-x-2 mb-2">
                        <AlertTriangle className="h-5 w-5 text-yellow-600 dark:text-warning" />
                        <Label className="text-sm font-semibold text-yellow-800 dark:text-yellow-200">
                          Carpeta public/uploads no encontrada
                        </Label>
                      </div>
                      <p className="text-xs text-yellow-700 dark:text-yellow-300">
                        Las imágenes subidas se guardarán en el servidor. Usa el botón "Copiar a public" cuando hayas subido imágenes.
                      </p>
                    </div>
                  )}

                  {/* Vista previa de la imagen */}
                  {(properties?.background as any)?.image && (
                    <div>
                      <Label className="mb-2 block">Vista Previa</Label>
                      <div 
                        className="h-32 rounded-lg border relative overflow-hidden"
                        style={{
                          backgroundImage: `url(${(properties?.background as any)?.image})`,
                          backgroundSize: (properties?.background as any)?.imageSize === 'custom' 
                            ? `${(properties?.background as any)?.customSize || 100}% auto`
                            : (properties?.background as any)?.imageSize || 'cover',
                          backgroundPosition: `${(properties?.background as any)?.positionX || 50}% ${(properties?.background as any)?.positionY || 50}%`,
                          backgroundRepeat: (properties?.background as any)?.imageSize === 'repeat' ? 'repeat' : 'no-repeat',
                          opacity: (properties?.background as any)?.imageOpacity || 1
                        }}
                      >
                        <div className="absolute inset-0 flex items-center justify-center bg-background/20">
                          <span className="text-foreground text-xs bg-background/50 px-2 py-1 rounded">
                            Vista previa de imagen
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Controles de imagen */}
                  {(properties?.background as any)?.image && (
                    <>
                      <Separator />
                      
                      {/* Control de Opacidad */}
                      <div>
                        <Label className="mb-2 block">{t('imageOpacity')}</Label>
                        <div className="flex items-center space-x-3">
                          <Slider
                            value={[(properties?.background as any)?.imageOpacity || 1]}
                            max={1}
                            min={0.1} // Mínimo 10% para que la imagen no desaparezca completamente
                            step={0.01}
                            onValueChange={(value) => updateProperty('background', 'imageOpacity', value[0])}
                            className="flex-1"
                          />
                          <span className="text-sm text-muted-foreground/80 w-12 text-right">
                            {Math.round(((properties?.background as any)?.imageOpacity || 1) * 100)}%
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground/80 mt-1">
                          Mínimo 10% para mantener la imagen visible
                        </p>
                      </div>

                      {/* Control de Tamaño */}
                      <div>
                        <Label className="mb-2 block">{t('imageSize')}</Label>
                        <Select
                          value={(properties?.background as any)?.imageSize || 'cover'}
                          onValueChange={(value) => updateProperty('background', 'imageSize', value)}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="cover">{t('cover')}</SelectItem>
                            <SelectItem value="contain">{t('contain')}</SelectItem>
                            <SelectItem value="auto">{t('auto')}</SelectItem>
                            <SelectItem value="repeat">{t('repeat')}</SelectItem>
                            <SelectItem value="scale-down">{t('scaleDown')}</SelectItem>
                            <SelectItem value="custom">{t('custom')}</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Control de tamaño personalizado */}
                      {(properties?.background as any)?.imageSize === 'custom' && (
                        <div>
                          <Label className="mb-2 block">{t('customSize')}</Label>
                          <div className="flex items-center space-x-3">
                            <Slider
                              value={[(properties?.background as any)?.customSize || 100]}
                              max={500}
                              min={10}
                              step={1}
                              onValueChange={(value) => updateProperty('background', 'customSize', value[0])}
                              className="flex-1"
                            />
                            <span className="text-sm text-muted-foreground/80 w-12 text-right">
                              {(properties?.background as any)?.customSize || 100}%
                            </span>
                          </div>
                        </div>
                      )}

                      {/* Controles de posición de imagen */}
                      {(properties?.background as any)?.image && (
                        <>
                          <Separator />
                          <div>
                            <Label className="mb-2 block">{t('imagePosition')}</Label>
                            
                            {/* Control de Posición X */}
                            <div className="mb-3">
                              <div className="flex items-center justify-between mb-1">
                                <Label className="text-sm">{t('positionX')}</Label>
                                <span className="text-xs text-muted-foreground/80">
                                  {(properties?.background as any)?.positionX || 50}%
                                </span>
                              </div>
                              <Slider
                                value={[(properties?.background as any)?.positionX || 50]}
                                max={100}
                                min={0}
                                step={1}
                                onValueChange={(value) => updateProperty('background', 'positionX', value[0])}
                                className="w-full"
                              />
                            </div>
                            
                            {/* Control de Posición Y */}
                            <div>
                              <div className="flex items-center justify-between mb-1">
                                <Label className="text-sm">{t('positionY')}</Label>
                                <span className="text-xs text-muted-foreground/80">
                                  {(properties?.background as any)?.positionY || 50}%
                                </span>
                              </div>
                              <Slider
                                value={[(properties?.background as any)?.positionY || 50]}
                                max={100}
                                min={0}
                                step={1}
                                onValueChange={(value) => updateProperty('background', 'positionY', value[0])}
                                className="w-full"
                              />
                            </div>
                          </div>
                        </>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
            <Separator />
            <Button 
              variant="outline" 
              onClick={() => resetCategory('background')}
              className="border-[1.5px] border-input bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-white/20 via-white/10 to-transparent text-foreground shadow-[0_0_8px_hsl(var(--input)/0.4)]"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              {t('resetBackground')}
            </Button>

            {/* Estilos Personalizados */}
            <Separator className="my-6" />
            <div className="space-y-4 max-h-[300px] overflow-y-auto pr-2">
              <div className="flex items-center justify-between">
                <Label className="text-base font-semibold">{t('customStyles')}</Label>
              </div>
              
              {/* Guardar Estilo Actual */}
              <div className="space-y-3 p-4 border rounded-lg bg-gray-50 dark:bg-background">
                <Label className="text-sm font-medium">{t('saveCurrentStyle')}</Label>
                
                <div className="space-y-3">
                  <div>
                    <Label className="text-xs mb-1 block">{t('componentType')}</Label>
                    <Select
                      value={savedStyleType || 'button'}
                      onValueChange={(value) => setSavedStyleType(value as 'button' | 'text' | 'container' | 'icon')}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={t('selectType')} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="button">{t('button')}</SelectItem>
                        <SelectItem value="text">{t('text')}</SelectItem>
                        <SelectItem value="container">{t('container')}</SelectItem>
                        <SelectItem value="icon">{t('icon')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div>
                    <Label className="text-xs mb-1 block">{t('styleName')}</Label>
                    <div className="flex gap-2">
                      <Input
                        value={styleName}
                        onChange={(e) => setStyleName(e.target.value)}
                        placeholder={t('enterStyleName')}
                        className="flex-1"
                      />
                      <Button
                        onClick={handleSaveStyle}
                        disabled={!styleName.trim() || !savedStyleType}
                        size="sm"
                        className="border-[1.5px] border-input bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-white/20 via-white/10 to-transparent text-foreground shadow-[0_0_8px_hsl(var(--input)/0.4)] disabled:opacity-50"
                      >
                        {t('save')}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Aplicar Estilo Guardado */}
              <div className="space-y-3 p-4 border rounded-lg bg-gray-50 dark:bg-background">
                <Label className="text-sm font-medium">{t('applySavedStyle')}</Label>
                
                <div className="space-y-3">
                  <div>
                    <Label className="text-xs mb-1 block">{t('componentType')}</Label>
                    <Select
                      value={applyStyleType || 'button'}
                      onValueChange={(value) => {
                        setApplyStyleType(value as 'button' | 'text' | 'container' | 'icon');
                        setSelectedStyleId('');
                      }}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={t('selectType')} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="button">{t('button')}</SelectItem>
                        <SelectItem value="text">{t('text')}</SelectItem>
                        <SelectItem value="container">{t('container')}</SelectItem>
                        <SelectItem value="icon">{t('icon')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  {(() => {
                    const stylesForType = savedStyles[applyStyleType || 'button'] || [];
                    console.log('[PropertyEditor] Estilos disponibles para tipo', applyStyleType, ':', stylesForType.length, stylesForType);
                    
                    return stylesForType.length > 0 ? (
                      <>
                        <div>
                          <Label className="text-xs mb-1 block">{t('selectStyle')}</Label>
                          <Select
                            value={selectedStyleId}
                            onValueChange={(value) => setSelectedStyleId(value)}
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder={t('selectStyle')} />
                            </SelectTrigger>
                            <SelectContent>
                              {stylesForType.map((style) => (
                                <SelectItem key={style.id} value={style.id}>
                                  {style.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      
                      <Button
                        variant="outline"
                        onClick={handleApplyStyle}
                        disabled={!selectedStyleId}
                        className={`w-full border-[1.5px] bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-white/20 via-white/10 to-transparent text-foreground ${
                          selectedStyleId 
                            ? 'border-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]' 
                            : 'border-input shadow-[0_0_8px_hsl(var(--input)/0.4)] opacity-50 cursor-not-allowed'
                        }`}
                        size="sm"
                      >
                        {t('applyStyle')}
                      </Button>
                      
                      {selectedStyleId && (
                        <Button
                          variant="outline"
                          onClick={() => handleDeleteStyle(selectedStyleId)}
                          className="w-full border-[1.5px] border-destructive bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-white/20 via-white/10 to-transparent text-foreground shadow-[0_0_8px_rgba(239,68,68,0.5)]"
                          size="sm"
                        >
                          {t('deleteStyle')}
                        </Button>
                      )}
                      </>
                    ) : (
                      <p className="text-xs text-muted-foreground/80 dark:text-muted-foreground text-center py-2">
                        {t('noStylesForType')}
                      </p>
                    );
                  })()}
                </div>
              </div>
            </div>
          </TabsContent>

          {/* Border Tab */}
          <TabsContent value="border" className="absolute inset-0 overflow-y-auto p-4 space-y-6 m-0">
            <div className="space-y-4">
              <div>
                <Label className="mb-2 block">{t('borderColor')}</Label>
                <div className="flex items-center space-x-4">
                  <ColorPicker
                    color={properties?.border?.color || defaultProperties.border.color}
                    onColorChange={(newColor) => updateProperty('border', 'color', newColor)}
                  />
                  <Input
                    value={properties?.border?.color || defaultProperties.border.color}
                    onChange={(e) => updateProperty('border', 'color', e.target.value)}
                    className="flex-1"
                    placeholder="#e5e7eb"
                  />
                </div>
              </div>
              <div>
                <Label className="mb-2 block">{t('borderWidth')}</Label>
                <Slider
                  value={[properties?.border?.width ?? defaultProperties.border.width]}
                  max={20}
                  onValueChange={(value) => updateProperty('border', 'width', value[0])}
                />
              </div>
              <div>
                <Label className="mb-2 block">{t('borderRadius')}</Label>
                <Slider
                  value={[properties?.border?.radius ?? defaultProperties.border.radius]}
                  max={100}
                  onValueChange={(value) => updateProperty('border', 'radius', value[0])}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label>{t('borderStyle')}</Label>
                <Select
                  value={properties?.border?.style || defaultProperties.border.style}
                  onValueChange={(value: any) => updateProperty('border', 'style', value)}
                >
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="solid">{t('solid')}</SelectItem>
                    <SelectItem value="dashed">{t('dashed')}</SelectItem>
                    <SelectItem value="dotted">{t('dotted')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Separator />

            {/* Text Stroke Section */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Borde del Texto</Label>
                <div className="flex items-center space-x-2">
                  <Switch
                    checked={properties?.typography?.textStroke?.enabled || false}
                    onCheckedChange={(enabled) => updateProperty('typography', 'textStroke', {
                      ...properties?.typography?.textStroke,
                      enabled
                    })}
                  />
                  <span className="text-xs text-muted-foreground/80">
                    {properties?.typography?.textStroke?.enabled ? 'Activado' : 'Desactivado'}
                  </span>
                </div>
              </div>
              
              {(properties?.typography?.textStroke?.enabled || false) && (
                <>
                  <div>
                    <Label className="mb-2 block">Color del Borde</Label>
                    <div className="flex items-center space-x-4">
                      <ColorPicker
                        color={properties?.typography?.textStroke?.color || '#000000'}
                        onColorChange={(color) => updateProperty('typography', 'textStroke', {
                          ...properties?.typography?.textStroke,
                          color
                        })}
                      />
                      <Input
                        value={properties?.typography?.textStroke?.color || '#000000'}
                        onChange={(e) => {
                          const value = e.target.value;
                          if (value === '' || value.startsWith('#') || value.startsWith('rgba') || value.startsWith('rgb')) {
                            updateProperty('typography', 'textStroke', {
                              ...properties?.typography?.textStroke,
                              color: value === '' ? '#000000' : value
                            });
                          }
                        }}
                        className="flex-1"
                        placeholder="#000000"
                      />
                    </div>
                  </div>
                  
                  <div>
                    <Label className="mb-2 block">Grosor del Borde</Label>
                    <div className="flex items-center space-x-4">
                      <Slider
                        value={[properties?.typography?.textStroke?.width || 1]}
                        min={0.5}
                        max={10}
                        step={0.5}
                        onValueChange={(value) => updateProperty('typography', 'textStroke', {
                          ...properties?.typography?.textStroke,
                          width: value[0]
                        })}
                        className="flex-1"
                      />
                      <span className="text-sm text-muted-foreground/80 w-12 text-right">
                        {properties?.typography?.textStroke?.width || 1}px
                      </span>
                    </div>
                  </div>
                  
                  <div>
                    <Label className="mb-2 block">Opacidad del Borde</Label>
                    <div className="flex items-center space-x-4">
                      <Slider
                        value={[properties?.typography?.textStroke?.opacity || 1]}
                        min={0}
                        max={1}
                        step={0.1}
                        onValueChange={(value) => updateProperty('typography', 'textStroke', {
                          ...properties?.typography?.textStroke,
                          opacity: value[0]
                        })}
                        className="flex-1"
                      />
                      <span className="text-sm text-muted-foreground/80 w-12 text-right">
                        {Math.round((properties?.typography?.textStroke?.opacity || 1) * 100)}%
                      </span>
                    </div>
                  </div>
                </>
              )}
            </div>
            <Separator />
            <Button 
              variant="outline" 
              onClick={() => resetCategory('border')}
              className="border-[1.5px] border-input bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-white/20 via-white/10 to-transparent text-foreground shadow-[0_0_8px_hsl(var(--input)/0.4)]"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              {t('resetBorder')}
            </Button>
          </TabsContent>

          {/* Size & Position Tab */}
          <TabsContent value="size" className="absolute inset-0 overflow-y-auto p-4 space-y-6 m-0">
            <div className="space-y-4">
              <div>
                <Label className="mb-2 block">{t('width')}</Label>
                <Input
                  value={properties?.size?.width || defaultProperties.size.width}
                  onChange={(e) => updateProperty('size', 'width', e.target.value)}
                  placeholder="e.g., 100px, 50%, auto"
                />
              </div>
              <div>
                <Label className="mb-2 block">{t('height')}</Label>
                <Input
                  value={properties?.size?.height || defaultProperties.size.height}
                  onChange={(e) => updateProperty('size', 'height', e.target.value)}
                  placeholder="e.g., 100px, 50%, auto"
                />
              </div>
              <div>
                <Label className="mb-2 block">{t('padding')}</Label>
                <Slider
                  value={[properties?.size?.padding ?? defaultProperties.size.padding]}
                  max={100}
                  onValueChange={(value) => updateProperty('size', 'padding', value[0])}
                />
              </div>
              <div>
                <Label className="mb-2 block">{t('margin')}</Label>
                <Slider
                  value={[properties?.size?.margin ?? defaultProperties.size.margin]}
                  max={100}
                  onValueChange={(value) => updateProperty('size', 'margin', value[0])}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label>{t('position')}</Label>
                <Select
                  value={properties?.size?.position || defaultProperties.size.position}
                  onValueChange={(value: any) => updateProperty('size', 'position', value)}
                >
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="relative">{t('relative')}</SelectItem>
                    <SelectItem value="absolute">{t('absolute')}</SelectItem>
                    <SelectItem value="fixed">{t('fixed')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Position X Slider */}
              <div>
                <Label className="mb-2 block flex items-center gap-2">
                  <ArrowLeft className="h-4 w-4" />
                  {t('positionX')} (Izquierda/Derecha)
                  <ArrowRight className="h-4 w-4" />
                </Label>
                <Slider
                  value={[properties?.size?.positionX ?? defaultProperties.size.positionX]}
                  min={-500}
                  max={500}
                  step={1}
                  onValueChange={(value) => updateProperty('size', 'positionX', value[0])}
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-muted-foreground/80 mt-1">
                  <span>-500px</span>
                  <span className="text-center">{properties?.size?.positionX ?? defaultProperties.size.positionX}px</span>
                  <span>500px</span>
                </div>
              </div>
              
              {/* Position Y Slider */}
              <div>
                <Label className="mb-2 block flex items-center gap-2">
                  <ArrowUp className="h-4 w-4" />
                  {t('positionY')} (Arriba/Abajo)
                  <ArrowDown className="h-4 w-4" />
                </Label>
                <Slider
                  value={[properties?.size?.positionY ?? defaultProperties.size.positionY]}
                  min={-500}
                  max={500}
                  step={1}
                  onValueChange={(value) => updateProperty('size', 'positionY', value[0])}
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-muted-foreground/80 mt-1">
                  <span>-500px</span>
                  <span className="text-center">{properties?.size?.positionY ?? defaultProperties.size.positionY}px</span>
                  <span>500px</span>
                </div>
              </div>
            </div>
            <Separator />
            <Button 
              variant="outline" 
              onClick={() => resetCategory('size')}
              className="border-[1.5px] border-input bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-white/20 via-white/10 to-transparent text-foreground shadow-[0_0_8px_hsl(var(--input)/0.4)]"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              {t('resetSizeAndPosition')}
            </Button>
          </TabsContent>

          {/* Typography Tab */}
          <TabsContent value="typography" className="absolute inset-0 overflow-y-auto p-4 space-y-6 m-0">
            <div className="space-y-4">
              <div>
                <Label className="mb-2 block">{t('fontFamily')}</Label>
                <Select
                  value={properties?.typography?.fontFamily || defaultProperties.typography.fontFamily}
                  onValueChange={(value) => updateProperty('typography', 'fontFamily', value)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue>
                      <span style={{ fontFamily: properties?.typography?.fontFamily || defaultProperties.typography.fontFamily }}>
                        {properties?.typography?.fontFamily || defaultProperties.typography.fontFamily}
                      </span>
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent className="max-h-[300px]">
                    {/* Fuentes del sistema */}
                    <SelectItem value="Arial" className="font-sans">
                      <span style={{ fontFamily: 'Arial, sans-serif' }}>Arial</span>
                    </SelectItem>
                    <SelectItem value="Helvetica" className="font-sans">
                      <span style={{ fontFamily: 'Helvetica, sans-serif' }}>Helvetica</span>
                    </SelectItem>
                    <SelectItem value="Times New Roman" className="font-serif">
                      <span style={{ fontFamily: 'Times New Roman, serif' }}>Times New Roman</span>
                    </SelectItem>
                    <SelectItem value="Courier New" className="font-mono">
                      <span style={{ fontFamily: 'Courier New, monospace' }}>Courier New</span>
                    </SelectItem>
                    <SelectItem value="Verdana" className="font-sans">
                      <span style={{ fontFamily: 'Verdana, sans-serif' }}>Verdana</span>
                    </SelectItem>
                    <SelectItem value="Georgia" className="font-serif">
                      <span style={{ fontFamily: 'Georgia, serif' }}>Georgia</span>
                    </SelectItem>
                    <SelectItem value="Palatino" className="font-serif">
                      <span style={{ fontFamily: 'Palatino, serif' }}>Palatino</span>
                    </SelectItem>
                    <SelectItem value="Garamond" className="font-serif">
                      <span style={{ fontFamily: 'Garamond, serif' }}>Garamond</span>
                    </SelectItem>
                    <SelectItem value="Bookman" className="font-serif">
                      <span style={{ fontFamily: 'Bookman, serif' }}>Bookman</span>
                    </SelectItem>
                    <SelectItem value="Comic Sans MS" className="font-sans">
                      <span style={{ fontFamily: 'Comic Sans MS, sans-serif' }}>Comic Sans MS</span>
                    </SelectItem>
                    <SelectItem value="Trebuchet MS" className="font-sans">
                      <span style={{ fontFamily: 'Trebuchet MS, sans-serif' }}>Trebuchet MS</span>
                    </SelectItem>
                    <SelectItem value="Impact" className="font-sans">
                      <span style={{ fontFamily: 'Impact, sans-serif' }}>Impact</span>
                    </SelectItem>
                    <SelectItem value="Lucida Console" className="font-mono">
                      <span style={{ fontFamily: 'Lucida Console, monospace' }}>Lucida Console</span>
                    </SelectItem>
                    <SelectItem value="Tahoma" className="font-sans">
                      <span style={{ fontFamily: 'Tahoma, sans-serif' }}>Tahoma</span>
                    </SelectItem>
                    <SelectItem value="Lucida Sans Unicode" className="font-sans">
                      <span style={{ fontFamily: 'Lucida Sans Unicode, sans-serif' }}>Lucida Sans Unicode</span>
                    </SelectItem>
                    
                    {/* Google Fonts - Sans Serif */}
                    <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">Google Fonts - Sans Serif</div>
                    <SelectItem value="Inter">
                      <span style={{ fontFamily: 'Inter, sans-serif' }}>Inter</span>
                    </SelectItem>
                    <SelectItem value="Roboto">
                      <span style={{ fontFamily: 'Roboto, sans-serif' }}>Roboto</span>
                    </SelectItem>
                    <SelectItem value="Open Sans">
                      <span style={{ fontFamily: 'Open Sans, sans-serif' }}>Open Sans</span>
                    </SelectItem>
                    <SelectItem value="Lato">
                      <span style={{ fontFamily: 'Lato, sans-serif' }}>Lato</span>
                    </SelectItem>
                    <SelectItem value="Montserrat">
                      <span style={{ fontFamily: 'Montserrat, sans-serif' }}>Montserrat</span>
                    </SelectItem>
                    <SelectItem value="Poppins">
                      <span style={{ fontFamily: 'Poppins, sans-serif' }}>Poppins</span>
                    </SelectItem>
                    <SelectItem value="Raleway">
                      <span style={{ fontFamily: 'Raleway, sans-serif' }}>Raleway</span>
                    </SelectItem>
                    <SelectItem value="Ubuntu">
                      <span style={{ fontFamily: 'Ubuntu, sans-serif' }}>Ubuntu</span>
                    </SelectItem>
                    <SelectItem value="Nunito">
                      <span style={{ fontFamily: 'Nunito, sans-serif' }}>Nunito</span>
                    </SelectItem>
                    <SelectItem value="Source Sans Pro">
                      <span style={{ fontFamily: 'Source Sans Pro, sans-serif' }}>Source Sans Pro</span>
                    </SelectItem>
                    <SelectItem value="Work Sans">
                      <span style={{ fontFamily: 'Work Sans, sans-serif' }}>Work Sans</span>
                    </SelectItem>
                    <SelectItem value="DM Sans">
                      <span style={{ fontFamily: 'DM Sans, sans-serif' }}>DM Sans</span>
                    </SelectItem>
                    <SelectItem value="Manrope">
                      <span style={{ fontFamily: 'Manrope, sans-serif' }}>Manrope</span>
                    </SelectItem>
                    <SelectItem value="Plus Jakarta Sans">
                      <span style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>Plus Jakarta Sans</span>
                    </SelectItem>
                    <SelectItem value="Outfit">
                      <span style={{ fontFamily: 'Outfit, sans-serif' }}>Outfit</span>
                    </SelectItem>
                    <SelectItem value="Space Grotesk">
                      <span style={{ fontFamily: 'Space Grotesk, sans-serif' }}>Space Grotesk</span>
                    </SelectItem>
                    <SelectItem value="Figtree">
                      <span style={{ fontFamily: 'Figtree, sans-serif' }}>Figtree</span>
                    </SelectItem>
                    <SelectItem value="Sora">
                      <span style={{ fontFamily: 'Sora, sans-serif' }}>Sora</span>
                    </SelectItem>
                    <SelectItem value="Lexend">
                      <span style={{ fontFamily: 'Lexend, sans-serif' }}>Lexend</span>
                    </SelectItem>
                    
                    {/* Google Fonts - Serif */}
                    <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">Google Fonts - Serif</div>
                    <SelectItem value="Playfair Display">
                      <span style={{ fontFamily: 'Playfair Display, serif' }}>Playfair Display</span>
                    </SelectItem>
                    <SelectItem value="Merriweather">
                      <span style={{ fontFamily: 'Merriweather, serif' }}>Merriweather</span>
                    </SelectItem>
                    <SelectItem value="Lora">
                      <span style={{ fontFamily: 'Lora, serif' }}>Lora</span>
                    </SelectItem>
                    <SelectItem value="Crimson Text">
                      <span style={{ fontFamily: 'Crimson Text, serif' }}>Crimson Text</span>
                    </SelectItem>
                    <SelectItem value="PT Serif">
                      <span style={{ fontFamily: 'PT Serif, serif' }}>PT Serif</span>
                    </SelectItem>
                    <SelectItem value="Libre Baskerville">
                      <span style={{ fontFamily: 'Libre Baskerville, serif' }}>Libre Baskerville</span>
                    </SelectItem>
                    <SelectItem value="Bitter">
                      <span style={{ fontFamily: 'Bitter, serif' }}>Bitter</span>
                    </SelectItem>
                    <SelectItem value="Cormorant">
                      <span style={{ fontFamily: 'Cormorant, serif' }}>Cormorant</span>
                    </SelectItem>
                    <SelectItem value="EB Garamond">
                      <span style={{ fontFamily: 'EB Garamond, serif' }}>EB Garamond</span>
                    </SelectItem>
                    <SelectItem value="Abril Fatface">
                      <span style={{ fontFamily: 'Abril Fatface, serif' }}>Abril Fatface</span>
                    </SelectItem>
                    
                    {/* Google Fonts - Display/Decorative */}
                    <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">Google Fonts - Display</div>
                    <SelectItem value="Oswald">
                      <span style={{ fontFamily: 'Oswald, sans-serif' }}>Oswald</span>
                    </SelectItem>
                    <SelectItem value="Bebas Neue">
                      <span style={{ fontFamily: 'Bebas Neue, sans-serif' }}>Bebas Neue</span>
                    </SelectItem>
                    <SelectItem value="Anton">
                      <span style={{ fontFamily: 'Anton, sans-serif' }}>Anton</span>
                    </SelectItem>
                    <SelectItem value="Righteous">
                      <span style={{ fontFamily: 'Righteous, sans-serif' }}>Righteous</span>
                    </SelectItem>
                    <SelectItem value="Bungee">
                      <span style={{ fontFamily: 'Bungee, sans-serif' }}>Bungee</span>
                    </SelectItem>
                    <SelectItem value="Fredoka One">
                      <span style={{ fontFamily: 'Fredoka One, sans-serif' }}>Fredoka One</span>
                    </SelectItem>
                    <SelectItem value="Lilita One">
                      <span style={{ fontFamily: 'Lilita One, sans-serif' }}>Lilita One</span>
                    </SelectItem>
                    <SelectItem value="Bangers">
                      <span style={{ fontFamily: 'Bangers, sans-serif' }}>Bangers</span>
                    </SelectItem>
                    <SelectItem value="Creepster">
                      <span style={{ fontFamily: 'Creepster, sans-serif' }}>Creepster</span>
                    </SelectItem>
                    
                    {/* Google Fonts - Monospace */}
                    <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">Google Fonts - Monospace</div>
                    <SelectItem value="Roboto Mono">
                      <span style={{ fontFamily: 'Roboto Mono, monospace' }}>Roboto Mono</span>
                    </SelectItem>
                    <SelectItem value="Source Code Pro">
                      <span style={{ fontFamily: 'Source Code Pro, monospace' }}>Source Code Pro</span>
                    </SelectItem>
                    <SelectItem value="Fira Code">
                      <span style={{ fontFamily: 'Fira Code, monospace' }}>Fira Code</span>
                    </SelectItem>
                    <SelectItem value="JetBrains Mono">
                      <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>JetBrains Mono</span>
                    </SelectItem>
                    <SelectItem value="Courier Prime">
                      <span style={{ fontFamily: 'Courier Prime, monospace' }}>Courier Prime</span>
                    </SelectItem>
                    <SelectItem value="Inconsolata">
                      <span style={{ fontFamily: 'Inconsolata, monospace' }}>Inconsolata</span>
                    </SelectItem>
                    <SelectItem value="Space Mono">
                      <span style={{ fontFamily: 'Space Mono, monospace' }}>Space Mono</span>
                    </SelectItem>
                    
                    {/* Google Fonts - Handwriting/Script */}
                    <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">Google Fonts - Handwriting</div>
                    <SelectItem value="Dancing Script">
                      <span style={{ fontFamily: 'Dancing Script, cursive' }}>Dancing Script</span>
                    </SelectItem>
                    <SelectItem value="Pacifico">
                      <span style={{ fontFamily: 'Pacifico, cursive' }}>Pacifico</span>
                    </SelectItem>
                    <SelectItem value="Satisfy">
                      <span style={{ fontFamily: 'Satisfy, cursive' }}>Satisfy</span>
                    </SelectItem>
                    <SelectItem value="Caveat">
                      <span style={{ fontFamily: 'Caveat, cursive' }}>Caveat</span>
                    </SelectItem>
                    <SelectItem value="Kalam">
                      <span style={{ fontFamily: 'Kalam, cursive' }}>Kalam</span>
                    </SelectItem>
                    <SelectItem value="Permanent Marker">
                      <span style={{ fontFamily: 'Permanent Marker, cursive' }}>Permanent Marker</span>
                    </SelectItem>
                    <SelectItem value="Shadows Into Light">
                      <span style={{ fontFamily: 'Shadows Into Light, cursive' }}>Shadows Into Light</span>
                    </SelectItem>
                    
                    {/* Fuente personalizada */}
                    <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">Personalizada</div>
                    <SelectItem value="inherit">
                      <span>inherit (heredar del padre)</span>
                    </SelectItem>
                    <SelectItem value="initial">
                      <span>initial (valor inicial)</span>
                    </SelectItem>
                  </SelectContent>
                </Select>
                <div className="mt-2 text-xs text-muted-foreground">
                  <Input
                    value={properties?.typography?.fontFamily || defaultProperties.typography.fontFamily}
                    onChange={(e) => updateProperty('typography', 'fontFamily', e.target.value)}
                    placeholder="O escribe una fuente personalizada..."
                    className="text-xs"
                  />
                </div>
              </div>
              <div>
                <Label className="mb-2 block">{t('fontSize')}</Label>
                <Slider
                  value={[properties?.typography?.fontSize ?? defaultProperties.typography.fontSize]}
                  max={200}
                  onValueChange={(value) => updateProperty('typography', 'fontSize', value[0])}
                />
              </div>
              <div>
                <Label className="mb-2 block">{t('fontWeight')}</Label>
                <Slider
                  value={[properties?.typography?.fontWeight ?? defaultProperties.typography.fontWeight]}
                  max={900}
                  step={100}
                  onValueChange={(value) => updateProperty('typography', 'fontWeight', value[0])}
                />
              </div>
              <div>
                <Label className="mb-2 block">Tipo de Color</Label>
                <Select
                  value={properties?.typography?.['textType'] || defaultProperties.typography.textType}
                  onValueChange={(value: 'solid' | 'gradient') => {
                    updateProperty('typography', 'textType', value);
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="solid">Color Sólido</SelectItem>
                    <SelectItem value="gradient">Degradado</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {(properties?.typography?.['textType'] || defaultProperties.typography.textType) === 'solid' && (
                <div>
                  <Label className="mb-2 block">{t('fontColor')}</Label>
                  <div className="flex items-center space-x-4">
                    <ColorPicker
                      color={properties?.typography?.color || defaultProperties.typography.color}
                      onColorChange={(color) => updateProperty('typography', 'color', color)}
                    />
                    <Input
                      value={properties?.typography?.color || defaultProperties.typography.color}
                      onChange={(e) => {
                        const value = e.target.value;
                        // Permitir 'transparent', códigos hex, rgba, etc.
                        if (value === '' || value === 'transparent' || value.startsWith('#') || value.startsWith('rgba') || value.startsWith('rgb')) {
                          updateProperty('typography', 'color', value === '' ? 'transparent' : value);
                        }
                      }}
                      className="flex-1"
                      placeholder="transparent o #000000"
                    />
                  </div>
                </div>
              )}

              {(properties?.typography?.['textType'] || defaultProperties.typography.textType) === 'gradient' && (
                <div className="space-y-4">
                  <div>
                    <Label className="mb-2 block">Degradado de Texto</Label>
                    <div
                      className="h-12 rounded-lg border flex items-center justify-center text-foreground font-bold text-lg"
                      style={{ 
                        background: properties?.typography?.['textGradient'] || defaultProperties.typography.textGradient,
                        WebkitBackgroundClip: 'text',
                        WebkitTextFillColor: 'transparent',
                        backgroundClip: 'text'
                      }}
                    >
                      Ejemplo
                    </div>
                  </div>
                  <GradientEditor
                    gradient={properties?.typography?.['textGradient'] || defaultProperties.typography.textGradient}
                    onGradientChange={(gradient) => {
                      updateProperty('typography', 'textGradient', gradient);
                    }}
                  />
                </div>
              )}
              <div>
                <Label className="mb-2 block">{t('lineHeight')}</Label>
                <Slider
                  value={[properties?.typography?.lineHeight ?? defaultProperties.typography.lineHeight]}
                  min={1}
                  max={3}
                  step={0.1}
                  onValueChange={(value) => updateProperty('typography', 'lineHeight', value[0])}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label>{t('textAlignment')}</Label>
                <Select
                  value={properties?.typography?.alignment || defaultProperties.typography.alignment}
                  onValueChange={(value: any) => updateProperty('typography', 'alignment', value)}
                >
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="left">{t('left')}</SelectItem>
                    <SelectItem value="center">{t('center')}</SelectItem>
                    <SelectItem value="right">{t('right')}</SelectItem>
                    <SelectItem value="justify">{t('justify')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              {/* Text Content Editor */}
              <Separator />
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium flex items-center gap-2">
                    <Edit className="h-4 w-4" />
                    Cambiar Contenido del Texto
                  </Label>
                </div>
                
                <div className="space-y-3">
                  <div>
                    <Label className="mb-2 block text-xs">Nuevo texto</Label>
                    <div className="flex gap-2">
                      <Input
                        value={newTextContent}
                        onChange={(e) => setNewTextContent(e.target.value)}
                        placeholder="Escribe el nuevo texto aquí..."
                        className="flex-1"
                      />
                      <Button
                        onClick={() => {
                          if (newTextContent) {
                            console.log('[PropertyEditor] 💾 Guardando texto:', {
                              componentId: selectedComponent?.id,
                              newText: newTextContent,
                              currentProperties: properties
                            });
                            
                            // Usar updateProperty para asegurar que se marque como modificado
                            updateProperty('typography', 'textContent', newTextContent);
                            
                            // Verificar que se guardó correctamente
                            setTimeout(() => {
                              console.log('[PropertyEditor] 🔍 Verificando guardado:', {
                                savedProperties: properties,
                                hasTextContent: !!(properties as any)?.typography?.textContent,
                                textContentValue: (properties as any)?.typography?.textContent
                              });
                            }, 100);
                            
                            toast.success('✅ Texto guardado correctamente');
                            console.log('[PropertyEditor] ✅ Texto guardado en las propiedades del componente');
                          }
                        }}
                        disabled={!newTextContent || !selectedComponent?.id}
                        size="sm"
                        className="border-[1.5px] border-input bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-white/20 via-white/10 to-transparent text-foreground shadow-[0_0_8px_hsl(var(--input)/0.4)] disabled:opacity-50"
                      >
                        Guardar Texto
                      </Button>
                    </div>
                  </div>
                  
                  <div className="text-xs text-muted-foreground/80 dark:text-muted-foreground">
                    💡 Escribe el nuevo texto y haz clic en "Guardar Texto" para cambiar el contenido del elemento seleccionado. Los cambios se guardarán y aplicarán al refrescar la vista previa.
                  </div>
                </div>
              </div>
            </div>
            <Separator />
            <Button 
              variant="outline" 
              onClick={() => resetCategory('typography')}
              className="border-[1.5px] border-input bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-white/20 via-white/10 to-transparent text-foreground shadow-[0_0_8px_hsl(var(--input)/0.4)]"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              {t('resetTypography')}
            </Button>
          </TabsContent>

          {/* Shadow Tab */}
          <TabsContent value="shadow" className="absolute inset-0 overflow-y-auto p-4 space-y-6 m-0">
            <div className="space-y-4">
              <div>
                <Label className="mb-2 block">{t('shadowColor')}</Label>
                <div className="flex items-center space-x-4">
                  <ColorPicker
                    color={properties?.shadow?.color || defaultProperties.shadow.color}
                    onColorChange={(color) => updateProperty('shadow', 'color', color)}
                  />
                  <Input
                    value={properties?.shadow?.color || defaultProperties.shadow.color}
                    onChange={(e) => updateProperty('shadow', 'color', e.target.value)}
                    className="flex-1"
                    placeholder="transparent o #000000"
                  />
                </div>
              </div>
              <div>
                <Label className="mb-2 block">{t('blurRadius')}</Label>
                <Slider
                  value={[properties?.shadow?.blur ?? defaultProperties.shadow.blur]}
                  max={100}
                  onValueChange={(value) => updateProperty('shadow', 'blur', value[0])}
                />
              </div>
              <div>
                <Label className="mb-2 block">{t('spreadRadius')}</Label>
                <Slider
                  value={[properties?.shadow?.spread ?? defaultProperties.shadow.spread]}
                  max={100}
                  onValueChange={(value) => updateProperty('shadow', 'spread', value[0])}
                />
              </div>
              <div>
                <Label className="mb-2 block">{t('offsetX')}</Label>
                <Slider
                  value={[properties?.shadow?.offsetX ?? defaultProperties.shadow.offsetX]}
                  min={-50}
                  max={50}
                  onValueChange={(value) => updateProperty('shadow', 'offsetX', value[0])}
                />
              </div>
              <div>
                <Label className="mb-2 block">{t('offsetY')}</Label>
                <Slider
                  value={[properties?.shadow?.offsetY ?? defaultProperties.shadow.offsetY]}
                  min={-50}
                  max={50}
                  onValueChange={(value) => updateProperty('shadow', 'offsetY', value[0])}
                />
              </div>
              <div>
                <Label className="mb-2 block">{t('opacity')}</Label>
                <Slider
                  value={[properties?.shadow?.opacity ?? defaultProperties.shadow.opacity]}
                  min={0}
                  max={1}
                  step={0.01}
                  onValueChange={(value) => updateProperty('shadow', 'opacity', value[0])}
                />
              </div>
            </div>
            <Separator />

            {/* Text Shadow Section */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Sombra del Texto</Label>
                <div className="flex items-center space-x-2">
                  <Switch
                    checked={properties?.typography?.textShadow?.enabled || false}
                    onCheckedChange={(enabled) => updateProperty('typography', 'textShadow', {
                      ...properties?.typography?.textShadow,
                      enabled
                    })}
                  />
                  <span className="text-xs text-muted-foreground/80">
                    {properties?.typography?.textShadow?.enabled ? 'Activada' : 'Desactivada'}
                  </span>
                </div>
              </div>
              
              {(properties?.typography?.textShadow?.enabled || false) && (
                <>
                  <div>
                    <Label className="mb-2 block">Color de la Sombra</Label>
                    <div className="flex items-center space-x-4">
                      <ColorPicker
                        color={properties?.typography?.textShadow?.color || '#000000'}
                        onColorChange={(color) => updateProperty('typography', 'textShadow', {
                          ...properties?.typography?.textShadow,
                          color
                        })}
                      />
                      <Input
                        value={properties?.typography?.textShadow?.color || '#000000'}
                        onChange={(e) => updateProperty('typography', 'textShadow', {
                          ...properties?.typography?.textShadow,
                          color: e.target.value
                        })}
                        className="flex-1"
                        placeholder="#000000"
                      />
                    </div>
                  </div>
                  
                  <div>
                    <Label className="mb-2 block">Radio de Desenfoque</Label>
                    <Slider
                      value={[properties?.typography?.textShadow?.blur ?? 4]}
                      max={50}
                      onValueChange={(value) => updateProperty('typography', 'textShadow', {
                        ...properties?.typography?.textShadow,
                        blur: value[0]
                      })}
                    />
                  </div>
                  
                  <div>
                    <Label className="mb-2 block">Desplazamiento X</Label>
                    <Slider
                      value={[properties?.typography?.textShadow?.offsetX ?? 2]}
                      min={-20}
                      max={20}
                      onValueChange={(value) => updateProperty('typography', 'textShadow', {
                        ...properties?.typography?.textShadow,
                        offsetX: value[0]
                      })}
                    />
                  </div>
                  
                  <div>
                    <Label className="mb-2 block">Desplazamiento Y</Label>
                    <Slider
                      value={[properties?.typography?.textShadow?.offsetY ?? 2]}
                      min={-20}
                      max={20}
                      onValueChange={(value) => updateProperty('typography', 'textShadow', {
                        ...properties?.typography?.textShadow,
                        offsetY: value[0]
                      })}
                    />
                  </div>
                  
                  <div>
                    <Label className="mb-2 block">Opacidad de la Sombra</Label>
                    <div className="flex items-center space-x-4">
                      <Slider
                        value={[properties?.typography?.textShadow?.opacity ?? 0.5]}
                        min={0}
                        max={1}
                        step={0.1}
                        onValueChange={(value) => updateProperty('typography', 'textShadow', {
                          ...properties?.typography?.textShadow,
                          opacity: value[0]
                        })}
                        className="flex-1"
                      />
                      <span className="text-sm text-muted-foreground/80 w-12 text-right">
                        {Math.round((properties?.typography?.textShadow?.opacity ?? 0.5) * 100)}%
                      </span>
                    </div>
                  </div>
                </>
              )}
            </div>
            <Separator />
            <Button 
              variant="outline" 
              onClick={() => resetCategory('shadow')}
              className="border-[1.5px] border-input bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-white/20 via-white/10 to-transparent text-foreground shadow-[0_0_8px_hsl(var(--input)/0.4)]"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              {t('resetShadow')}
            </Button>
          </TabsContent>

          {/* Icon Tab */}
          <TabsContent value="icon" className="absolute inset-0 overflow-y-auto p-4 space-y-6 m-0">
            <div className="space-y-4">
              <div>
                <Label className="mb-2 block">Seleccionar Icono</Label>
                <div className="text-xs text-muted-foreground/80 mb-2">
                  Icono actual: {properties?.icon?.name || 'Ninguno'}
                </div>
                <div className="border rounded-md p-2 bg-gray-50 dark:bg-background max-h-[400px] overflow-y-auto">
                  <div className="grid grid-cols-4 gap-2">
                    {[
                        '', // Opción para "Ninguno"
                        'home', 'user', 'settings', 'heart', 'star', 'search', 'mail', 'phone',
                        'calendar', 'camera', 'edit', 'trash', 'plus', 'minus', 'checkIcon', 'x',
                        'zap', 'refreshCw', 'move', 'rotateCcw', 'save', 'paintbrush', 'ruler', 'image',
                        'activity', 'alertCircle', 'archive', 'arrowDown', 'arrowLeft', 'arrowRight', 'arrowUp', 'atSign',
                        'award', 'bell', 'bookmark', 'check', 'chevronDown', 'chevronLeft', 'chevronRight', 'chevronUp',
                        'circle', 'clipboard', 'clock', 'cloud', 'code', 'command', 'creditCard', 'database',
                        'disc', 'download', 'externalLink', 'file', 'filter', 'flag', 'folder',
                        'gift', 'globe', 'grid', 'hardDrive', 'hash', 'headphones', 'inbox',
                        'info', 'key', 'layers', 'lifeBuoy', 'link', 'list',
                        'lock', 'logIn', 'logOut', 'map', 'menu', 'messageCircle', 'messageSquare', 'mic',
                        'monitor', 'moon', 'moreHorizontal', 'moreVertical', 'mousePointer', 'music', 'navigation', 'package',
                        'paperclip', 'pause', 'penTool', 'play', 'power', 'printer', 'qrCode', 'repeat',
                        'rss', 'scissors', 'send', 'share', 'shield', 'shoppingBag', 'shoppingCart', 'sun',
                        'tag', 'target', 'terminal', 'thumbsDown', 'thumbsUp', 'toggleLeft', 'toggleRight', 'trendingDown',
                        'trendingUp', 'truck', 'tv', 'umbrella', 'unlock', 'upload', 'users', 'video',
                        'voicemail', 'volume1', 'volume2', 'volumeX', 'wallet', 'watch', 'wifi',
                        'zoomIn', 'zoomOut'
                      ].map((iconKey) => {
                        // Skip empty icon keys
                        if (!iconKey || iconKey.trim() === '') {
                          return null;
                        }
                        
                        const IconComponent = iconMap[iconKey];
                        const currentIconName = properties?.icon?.name || '';
                        const isSelected = currentIconName === iconKey;
                        
                        // Debug: verificar si el icono está disponible
                        if (!IconComponent && process.env.NODE_ENV === 'development') {
                          console.warn(`[PropertyEditor] Icono "${iconKey}" no encontrado en iconMap`);
                        }
                        
                        // Debug: verificar el tipo del componente
                        if (IconComponent && process.env.NODE_ENV === 'development' && iconKey === 'archive') {
                          const iconComponentAny = IconComponent as any;
                          console.log(`[PropertyEditor] IconComponent para "${iconKey}":`, {
                            type: typeof IconComponent,
                            isFunction: typeof IconComponent === 'function',
                            isReactComponent: iconComponentAny.$$typeof === Symbol.for('react.forward_ref') || iconComponentAny.$$typeof === Symbol.for('react.element'),
                            name: iconComponentAny.name || iconComponentAny.displayName
                          });
                        }
                        
                        return (
                          <button
                            key={iconKey}
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              console.log('[PropertyEditor] Icon button clicked:', iconKey, 'Component:', IconComponent);
                              updateProperty('icon', 'name', iconKey);
                            }}
                            className={cn(
                              "flex flex-col items-center justify-center gap-1 p-3 rounded-md border-2 transition-all cursor-pointer",
                              "hover:bg-gray-100 dark:hover:bg-card hover:border-blue-500",
                              "focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2",
                              isSelected 
                                ? "bg-blue-50 dark:bg-primary/20 border-blue-500" 
                                : "bg-white dark:bg-card border-gray-200 dark:border-border/50",
                              !IconComponent && "opacity-50"
                            )}
                            disabled={!IconComponent}
                            title={!IconComponent ? `Icono "${iconKey}" no disponible` : undefined}
                          >
                            <div 
                              className={cn(
                                "w-6 h-6 flex items-center justify-center flex-shrink-0",
                                isSelected 
                                  ? "text-primary dark:text-primary" 
                                  : "text-black dark:text-foreground"
                              )}
                              style={{ 
                                minWidth: '24px',
                                minHeight: '24px'
                              }}
                            >
                              {iconKey === '' ? (
                                // Opción "Ninguno" - mostrar una X
                                <X 
                                  size={24} 
                                  strokeWidth={properties?.icon?.strokeWidth || defaultProperties.icon.strokeWidth}
                                  stroke="currentColor"
                                  fill="none"
                                  className="text-current"
                                />
                              ) : IconComponent ? (
                                <IconComponent 
                                  size={24} 
                                  strokeWidth={properties?.icon?.strokeWidth || defaultProperties.icon.strokeWidth}
                                  stroke="currentColor"
                                  fill="none"
                                  className="text-current"
                                />
                              ) : (
                                <Circle 
                                  size={24} 
                                  strokeWidth={properties?.icon?.strokeWidth || defaultProperties.icon.strokeWidth}
                                  stroke="currentColor"
                                  fill="none"
                                  className="text-current"
                                />
                              )}
                            </div>
                            <span className="text-xs text-center capitalize truncate w-full">
                              {iconKey === '' ? 'Ninguno' : iconKey}
                            </span>
                          </button>
                        );
                      }).filter(Boolean)}
                  </div>
                </div>
              </div>

              <div>
                <Label className="mb-2 block">Color del Icono</Label>
                <div className="flex items-center space-x-4">
                  <ColorPicker
                    color={properties?.icon?.color || defaultProperties.icon.color}
                    onColorChange={(color) => {
                      console.log('[PropertyEditor] Icon color changed via ColorPicker:', color);
                      if (color) {
                        updateProperty('icon', 'color', color);
                      }
                    }}
                  />
                  <Input
                    type="text"
                    value={properties?.icon?.color || defaultProperties.icon.color}
                    onChange={(e) => {
                      const newColor = e.target.value;
                      console.log('[PropertyEditor] Icon color input changed:', newColor);
                      if (newColor) {
                        updateProperty('icon', 'color', newColor);
                      }
                    }}
                    className="flex-1"
                    placeholder="#000000"
                  />
                </div>
                <div className="text-xs text-muted-foreground/80 mt-1">
                  Color actual: {properties?.icon?.color || defaultProperties.icon.color}
                </div>
              </div>

              <div>
                <Label className="mb-2 block">
                  Tamaño del Icono: <span className="font-semibold">{properties?.icon?.size || defaultProperties.icon.size}px</span>
                </Label>
                <Slider
                  value={[properties?.icon?.size || defaultProperties.icon.size]}
                  onValueChange={(value) => {
                    const newSize = value[0];
                    console.log('[PropertyEditor] Icon size slider changed:', newSize);
                    if (newSize && newSize >= 8 && newSize <= 128) {
                      updateProperty('icon', 'size', newSize);
                    }
                  }}
                  min={8}
                  max={128}
                  step={1}
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-muted-foreground/80 mt-1">
                  <span>8px</span>
                  <span>128px</span>
                </div>
              </div>

              <div>
                <Label className="mb-2 block">
                  Grosor del Trazo: <span className="font-semibold">{properties?.icon?.strokeWidth || defaultProperties.icon.strokeWidth}px</span>
                </Label>
                <Slider
                  value={[properties?.icon?.strokeWidth || defaultProperties.icon.strokeWidth]}
                  onValueChange={(value) => {
                    const newStrokeWidth = value[0];
                    console.log('[PropertyEditor] Icon stroke width slider changed:', newStrokeWidth);
                    if (newStrokeWidth && newStrokeWidth >= 0.5 && newStrokeWidth <= 8) {
                      updateProperty('icon', 'strokeWidth', newStrokeWidth);
                    }
                  }}
                  min={0.5}
                  max={8}
                  step={0.5}
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-muted-foreground/80 mt-1">
                  <span>0.5px</span>
                  <span>8px</span>
                </div>
              </div>
              
              <Separator />
              <Button 
                variant="outline" 
                onClick={() => {
                  console.log('[PropertyEditor] Resetting icon properties');
                  setProperties((prev: any) => {
                    const newProps = { ...prev };
                    delete newProps?.icon;
                    return newProps;
                  });
                  modifiedCategoriesRef.current.delete('icon');
                  setHasUserMadeChanges(true);
                  // Notificar al padre que se eliminó el icono
                  if (onPropertyChange && selectedComponent) {
                    setTimeout(() => {
                      onPropertyChange({ icon: null });
                    }, 0);
                  }
                }}
                className="border-[1.5px] border-input bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-white/20 via-white/10 to-transparent text-foreground shadow-[0_0_8px_hsl(var(--input)/0.4)]"
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Restablecer Icono
              </Button>
            </div>
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}                                 
