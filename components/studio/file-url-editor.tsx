'use client';

import React, { useState, useEffect } from 'react';
import { ScrollArea } from '../ui/scroll-area';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Search, File, Link, Save, AlertCircle, Upload } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useTranslation } from '../../contexts/translation-context';
import { toast } from 'sonner';

interface UrlMatch {
  id: string;
  line: number;
  column: number;
  startIndex: number;
  endIndex: number;
  originalUrl: string;
  currentUrl: string;
  context: string;
  urlType: 'image' | 'video' | 'audio' | 'document' | 'website' | 'other';
}

interface ProjectFile {
  name: string;
  path: string;
  content: string;
  urls: UrlMatch[];
}

interface FileUrlEditorProps {
  projectFiles: Map<string, string>; // Map<path, content>
  onSaveFile: (filePath: string, newContent: string) => Promise<boolean>;
  onRefreshFiles?: () => Promise<void>;
  isLoading?: boolean;
  devServerUrl?: string;
}

export function FileUrlEditor({
  projectFiles,
  onSaveFile,
  onRefreshFiles,
  isLoading = false,
  devServerUrl = ''
}: FileUrlEditorProps) {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState('');
  
  // Evitar que el componente se salga del contenedor
  const containerClasses = "flex flex-col h-full w-full border-r bg-card overflow-hidden max-w-full";
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [filesWithUrls, setFilesWithUrls] = useState<ProjectFile[]>([]);
  const [editingUrls, setEditingUrls] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [manualFileMappings, setManualFileMappings] = useState<Record<string, string>>({});
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // Función para detectar el tipo de URL
  const getUrlType = (url: string): UrlMatch['urlType'] => {
    const urlLower = url.toLowerCase();
    
    // Dominios de imágenes conocidos
    const imageDomains = [
      'images.unsplash.com',
      'imgur.com',
      'i.imgur.com',
      'cloud.githubusercontent.com',
      'githubusercontent.com',
      'placehold.it',
      'placeholder.com',
      'lorempixel.com'
    ];
    
    const isImageDomain = imageDomains.some(domain => urlLower.includes(domain));
    if (isImageDomain) return 'image';
    
    // Extensiones de imagen
    const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico'];
    const hasImageExtension = imageExtensions.some(ext => 
      urlLower.endsWith(`.${ext}`) || urlLower.includes(`.${ext}?`) || urlLower.includes(`.${ext}&`)
    );
    if (hasImageExtension || urlLower.includes('image/')) return 'image';
    
    // Extensiones de video
    const videoExtensions = ['mp4', 'avi', 'mov', 'wmv', 'flv', 'webm', 'mkv'];
    const hasVideoExtension = videoExtensions.some(ext => 
      urlLower.endsWith(`.${ext}`) || urlLower.includes(`.${ext}?`) || urlLower.includes(`.${ext}&`)
    );
    if (hasVideoExtension) return 'video';
    
    // Extensiones de audio
    const audioExtensions = ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a'];
    const hasAudioExtension = audioExtensions.some(ext => 
      urlLower.endsWith(`.${ext}`) || urlLower.includes(`.${ext}?`) || urlLower.includes(`.${ext}&`)
    );
    if (hasAudioExtension) return 'audio';
    
    // Extensiones de documentos
    const docExtensions = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv'];
    const hasDocExtension = docExtensions.some(ext => 
      urlLower.endsWith(`.${ext}`) || urlLower.includes(`.${ext}?`) || urlLower.includes(`.${ext}&`)
    );
    if (hasDocExtension) return 'document';
    
    // URLs de sitios web (dominios comunes)
    const websitePatterns = ['http://', 'https://', 'www.'];
    const isWebsite = websitePatterns.some(pattern => urlLower.includes(pattern));
    if (isWebsite) return 'website';
    
    return 'other';
  };

  // Extraer URLs de un contenido de archivo (reutilizable)
  const extractUrlsFromContent = (content: string, filePath: string): UrlMatch[] => {
    const resourceExtensions = [
      'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico',
      'mp4', 'avi', 'mov', 'wmv', 'flv', 'webm', 'mkv',
      'mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a',
      'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv'
    ];
    const extPattern = resourceExtensions.join('|');

    const regexes = [
      // 1. URLs completas http(s) entre comillas
      /(?:"|')((?:https?:)?\/\/[^\s"']+)(?:"|')/gi,
      // 2. Atributos src/href/url entre comillas - Soporta URLs y rutas relativas que empiezan por / o uploads/
      /(?:src|href|url|poster|srcSet|backgroundImage|background)\s*[=:]\s*["']((?:https?:\/\/[^\s"']+)|\/[^\s"']+|uploads\/[^\s"']+)["']/gi,
      // 3. Imports estáticos de recursos
      new RegExp(`import\\s+[^'"]*['"]([^'"]+\\.(?:${extPattern}))['"]`, 'gi'),
      // 4. require() o dynamic import con recursos
      new RegExp(`(?:require\\(|import\\(['"])([^'"]+\\.(?:${extPattern}))['"]\\)?`, 'gi'),
      // 5. Cadenas genéricas entre comillas con extensión de recurso - Soporta rutas relativas
      new RegExp(`(?:"|')((?:https?:\/\/[^\\s"']+|\\/[^\\s"']+|uploads\/[^\\s"']+|[^\\s"']+)\\.(?:${extPattern}))(?:"|')`, 'gi'),
    ];

    const foundUrls = new Map<string, UrlMatch>();

    const runRegex = (regex: RegExp) => {
      let match;
      while ((match = regex.exec(content)) !== null) {
        const url = match[1];
        if (!url) continue;

        const normalizedUrl = url.trim();

        // Filtrar falsos positivos
        const jsKeywords = ['typeof', 'instanceof', 'undefined', 'null', 'true', 'false', 'function', 'return', 'const', 'let', 'var'];
        if (jsKeywords.includes(normalizedUrl)) continue;

        // Calcular índices exactos de la URL dentro del archivo
        const fullMatchStart = match.index;
        const fullMatchText = match[0];
        const groupText = match[1];
        const groupOffset = fullMatchText.indexOf(groupText);
        const urlStartIndex = fullMatchStart + groupOffset;
        const urlEndIndex = urlStartIndex + groupText.length;

        // Calcular línea y columna para mostrar en UI
        const line = content.substring(0, urlStartIndex).split('\n').length;
        const lastNewline = content.lastIndexOf('\n', urlStartIndex);
        const column = lastNewline < 0 ? urlStartIndex : urlStartIndex - lastNewline - 1;
        const id = `${filePath}-${urlStartIndex}-${urlEndIndex}`;

        // Evitar duplicados exactos
        if (foundUrls.has(id)) continue;

        foundUrls.set(id, {
          id,
          line,
          column,
          startIndex: urlStartIndex,
          endIndex: urlEndIndex,
          originalUrl: normalizedUrl,
          currentUrl: normalizedUrl,
          context: content.substring(
            Math.max(0, urlStartIndex - 50),
            Math.min(content.length, urlEndIndex + 50)
          ).trim(),
          urlType: getUrlType(normalizedUrl)
        });
      }
    };

    regexes.forEach(r => runRegex(r));
    return Array.from(foundUrls.values());
  };

  // Extraer URLs de los archivos del proyecto cuando cambian
  useEffect(() => {
    if (!projectFiles || projectFiles.size === 0) {
      setFilesWithUrls(prev => prev.filter(f => f.path.startsWith('manual://')));
      setSelectedFile(null);
      return;
    }

    const filesArray: ProjectFile[] = [];

    projectFiles.forEach((content, path) => {
      const urls = extractUrlsFromContent(content, path);
      if (urls.length > 0) {
        filesArray.push({
          name: path.split('/').pop() || path,
          path,
          content,
          urls
        });
      }
    });

    // Conservar archivos cargados manualmente
    setFilesWithUrls(prev => {
      const manualFiles = prev.filter(f => f.path.startsWith('manual://'));
      return [...filesArray, ...manualFiles];
    });
    console.log('[FileUrlEditor] Archivos con URLs encontrados:', filesArray.length);
  }, [projectFiles]);

  // Filtrar archivos según búsqueda
  const filteredFiles = searchQuery
    ? filesWithUrls.filter(file => 
        file.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        file.path.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : filesWithUrls;

  const handleFileSelect = (filePath: string) => {
    setSelectedFile(filePath);
    // Resetear ediciones al cambiar de archivo
    setEditingUrls({});
  };

  const handleManualFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (!content) return;

      const path = `manual://${file.name}`;
      const urls = extractUrlsFromContent(content, path);

      if (urls.length === 0) {
        toast.info(t('noUrlsInFile').replace('{fileName}', file.name));
        return;
      }

      setFilesWithUrls(prev => {
        // Evitar duplicados: si ya existe un manual con este nombre, reemplazarlo
        const filtered = prev.filter(f => f.path !== path);
        return [...filtered, {
          name: file.name,
          path,
          content,
          urls
        }];
      });

      // Intentar autocompletar el mapeo buscando en projectFiles
      const autoFound = Array.from(projectFiles.keys()).find(p => p.endsWith(file.name));
      setManualFileMappings(prev => ({
        ...prev,
        [path]: autoFound || ''
      }));

      setSelectedFile(path);
      setEditingUrls({});
      toast.success(t('fileLoadedWithUrls').replace('{fileName}', file.name).replace('{count}', urls.length.toString()));
    };
    reader.readAsText(file);

    // Limpiar el input para permitir volver a seleccionar el mismo archivo
    e.target.value = '';
  };

  const handleUrlChange = (urlId: string, newValue: string) => {
    setEditingUrls(prev => ({
      ...prev,
      [urlId]: newValue
    }));
  };

  const handleSaveFile = async () => {
    if (!selectedFile || isSaving) return;

    const file = filesWithUrls.find(f => f.path === selectedFile);
    if (!file) {
      console.error('[FileUrlEditor] ❌ No se encontró el archivo seleccionado:', selectedFile);
      return;
    }

    // Resolver path real si es un archivo cargado manualmente
    let realFilePath = selectedFile;
    if (selectedFile.startsWith('manual://')) {
      const mapping = manualFileMappings[selectedFile];
      if (mapping && mapping.trim()) {
        realFilePath = mapping.trim();
        console.log('[FileUrlEditor] 🗺️ Path manual resuelto vía mapeo:', { manual: selectedFile, real: realFilePath });
      } else {
        toast.error(t('specifyRealPathBeforeSaving'));
        console.error('[FileUrlEditor] ❌ No hay mapeo para archivo manual:', selectedFile);
        return;
      }
    }

    console.log('[FileUrlEditor] 💾 Iniciando guardado:', file.name, '| Tamaño:', file.content.length, 'chars', '| Path:', realFilePath);

    setIsSaving(true);

    try {
      let newContent = file.content;

      // Recopilar todos los cambios que realmente modifican la URL
      const edits = Object.entries(editingUrls)
        .map(([urlId, newUrl]) => {
          const urlMatch = file.urls.find(u => u.id === urlId);
          if (urlMatch && newUrl !== urlMatch.originalUrl) {
            console.log('[FileUrlEditor] ✏️ URL editada:', {
              id: urlId,
              original: urlMatch.originalUrl,
              nueva: newUrl,
              startIndex: urlMatch.startIndex,
              endIndex: urlMatch.endIndex
            });
            return { urlMatch, newUrl };
          }
          return null;
        })
        .filter(Boolean) as { urlMatch: UrlMatch; newUrl: string }[];

      if (edits.length === 0) {
        console.log('[FileUrlEditor] ℹ️ No hay cambios para guardar');
        toast.info(t('noChangesToSave'));
        return;
      }

      // Ordenar por endIndex descendente para evitar que los índices se desplacen
      edits.sort((a, b) => b.urlMatch.endIndex - a.urlMatch.endIndex);

      // Aplicar cada reemplazo usando los índices exactos del archivo original
      for (const edit of edits) {
        const { urlMatch, newUrl } = edit;

        // VERIFICACIÓN DE SEGURIDAD: confirmar que en la posición esperada está realmente la URL original
        const actualAtPosition = newContent.substring(urlMatch.startIndex, urlMatch.endIndex);
        console.log('[FileUrlEditor] 🔍 Verificando posición:', {
          start: urlMatch.startIndex,
          end: urlMatch.endIndex,
          esperado: urlMatch.originalUrl,
          actual: actualAtPosition,
          coincide: actualAtPosition === urlMatch.originalUrl
        });

        if (actualAtPosition !== urlMatch.originalUrl) {
          // Intentar encontrar la URL original en el contenido actual
          const foundIndex = newContent.indexOf(urlMatch.originalUrl);
          if (foundIndex !== -1) {
            console.warn('[FileUrlEditor] ⚠️ Índices desfasados. Reintentando en posición:', foundIndex);
            newContent =
              newContent.substring(0, foundIndex) +
              newUrl +
              newContent.substring(foundIndex + urlMatch.originalUrl.length);
          } else {
            console.error('[FileUrlEditor] ❌ No se encontró la URL original en el archivo. Abortando.');
            toast.error(t('urlOriginalNotFound'));
            return;
          }
        } else {
          newContent =
            newContent.substring(0, urlMatch.startIndex) +
            newUrl +
            newContent.substring(urlMatch.endIndex);
        }

        console.log('[FileUrlEditor] 📝 Reemplazo aplicado. Nuevo tamaño:', newContent.length);
      }

      // PROTECCIÓN DE SEGURIDAD: abortar si el nuevo contenido es sospechosamente corto
      const minAllowedLength = Math.max(1, file.content.length * 0.1);
      if (newContent.length < minAllowedLength) {
        console.error('[FileUrlEditor] 🚨 Abortado: el nuevo contenido es demasiado corto', {
          originalLength: file.content.length,
          newLength: newContent.length,
          minAllowed: minAllowedLength
        });
        toast.error(t('saveResultTooShort'));
        return;
      }

      console.log('[FileUrlEditor] 📤 Enviando a onSaveFile:', selectedFile, '| Tamaño final:', newContent.length);

      const success = await onSaveFile(realFilePath, newContent);

      if (success) {
        toast.success(t('fileUpdatedSuccessfully').replace('{fileName}', file.name));
        // Resetear ediciones después de guardar
        setEditingUrls({});

        // Refrescar los archivos del proyecto si se proporciona la función
        if (onRefreshFiles) {
          console.log('[FileUrlEditor] 🔄 Llamando a onRefreshFiles después de guardar');
          try {
            await onRefreshFiles();
            console.log('[FileUrlEditor] ✅ Archivos refrescados exitosamente');
          } catch (error) {
            console.error('[FileUrlEditor] ❌ Error al refrescar archivos:', error);
          }
        }
      } else {
        toast.error(t('errorSavingFile').replace('{fileName}', file.name));
      }
    } catch (error) {
      console.error('[FileUrlEditor] Error al guardar:', error);
      toast.error(t('errorSavingChanges'));
    } finally {
      setIsSaving(false);
    }
  };

  const selectedFileInfo = selectedFile 
    ? filesWithUrls.find(f => f.path === selectedFile)
    : null;

  return (
    <div className={containerClasses}>
      {/* Header */}
      <div className="p-4 border-b border-border/50 flex-shrink-0">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-foreground/80">{t('urlEditorTitle')}</h2>
          <div className="flex items-center text-sm text-muted-foreground">
            <Link className="h-4 w-4 mr-1" />
            <span>{filesWithUrls.reduce((acc, file) => acc + file.urls.length, 0)} {t('urlsFound')}</span>
          </div>
        </div>
        
        {/* Selector de archivos */}
        <div className="mb-3 flex gap-2">
          <div className="flex-1">
            <Select value={selectedFile || ''} onValueChange={handleFileSelect}>
              <SelectTrigger className="bg-muted border-border/40 text-foreground/80">
                <SelectValue placeholder={t('selectFileWithUrls')} />
              </SelectTrigger>
              <SelectContent className="bg-muted border-border/40">
                {filteredFiles.map((file) => (
                  <SelectItem
                    key={file.path}
                    value={file.path}
                    className="text-foreground/80 hover:bg-muted/80"
                  >
                    <div className="flex items-center">
                      <File className="h-4 w-4 mr-2 text-primary shrink-0" />
                      <div className="flex flex-col min-w-0">
                        <span className="truncate max-w-[180px]">{file.name}</span>
                        <span className="text-[10px] text-muted-foreground/80 truncate max-w-[180px]">
                          {file.path}
                        </span>
                      </div>
                      <span className="ml-auto text-xs text-muted-foreground shrink-0">
                        ({file.urls.length} URLs)
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            variant="outline"
            size="icon"
            title={t('loadFileManually')}
            onClick={() => fileInputRef.current?.click()}
            className="border-border/40 text-foreground/70 hover:bg-muted shrink-0"
          >
            <Upload className="h-4 w-4" />
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".tsx,.jsx,.ts,.js,.html,.css,.json,.md"
            className="hidden"
            onChange={handleManualFileUpload}
          />
        </div>

        {/* Barra de búsqueda */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t('searchFilesPlaceholder' as any)}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 bg-muted border-border/40 text-foreground/80"
          />
        </div>
      </div>

      {/* Contenido principal */}
      <div className="flex-1 bg-card overflow-auto">
        {filesWithUrls.length === 0 ? (
          <div className="text-center py-12 px-4 text-muted-foreground">
            <AlertCircle className="h-16 w-16 mx-auto mb-4 opacity-50 text-muted-foreground/60" />
            <p className="text-base font-semibold mb-2 text-foreground/70">{t('noUrlsFound')}</p>
            <p className="text-base text-success font-medium mb-4">
              {t('loadProjectToSearchUrls')}
            </p>
            <p className="text-xs text-muted-foreground/60">
              {t('urlsWillBeSearchedIn')}
            </p>
          </div>
        ) : selectedFile && selectedFileInfo ? (
          <div className="p-4">
            <div className="mb-6">
              <h3 className="text-lg font-medium text-foreground/80 mb-2 flex items-center">
                <File className="h-5 w-5 mr-2 text-primary" />
                {selectedFileInfo.name}
              </h3>
              <p className="text-sm text-muted-foreground mb-4">
                {selectedFileInfo.urls.length} {t('urlsFoundInThisFile')}
              </p>

              {/* Input de mapeo para archivos manuales */}
              {selectedFileInfo.path.startsWith('manual://') && (
                <div className="mb-4">
                  <label className="block text-xs text-warning mb-1">
                    {t('realProjectPathLabel')}
                  </label>
                  <input
                    type="text"
                    value={manualFileMappings[selectedFileInfo.path] || ''}
                    onChange={(e) => {
                      setManualFileMappings(prev => ({
                        ...prev,
                        [selectedFileInfo.path]: e.target.value
                      }));
                    }}
                    placeholder="app/page.tsx"
                    className="w-full bg-background border border-yellow-600/50 text-foreground/80 font-mono text-sm p-2 rounded"
                  />
                </div>
              )}

              <div className="flex gap-2">
                <Button
                  onClick={handleSaveFile}
                  disabled={isSaving || Object.keys(editingUrls).length === 0}
                  className="bg-primary hover:bg-primary"
                >
                  <Save className="h-4 w-4 mr-2" />
                  {isSaving ? t('saving' as any) : t('save')}
                </Button>
                {Object.keys(editingUrls).length > 0 && (
                  <Button
                    variant="outline"
                    onClick={() => setEditingUrls({})}
                    className="border-border/40 text-foreground/70 hover:bg-muted"
                  >
                    {t('cancelEditing')}
                  </Button>
                )}
              </div>
            </div>

            {/* Lista de URLs */}
            <div className="space-y-4">
              {selectedFileInfo.urls.map((url) => {
                const isEdited = editingUrls[url.id] !== undefined && editingUrls[url.id] !== url.originalUrl;
                const currentValue = editingUrls[url.id] ?? url.originalUrl;
                
                return (
                  <div 
                    key={url.id} 
                    className={cn(
                      "border rounded-lg p-4 bg-muted/50 border-border/40 w-full max-w-full overflow-hidden",
                      isEdited && "border-yellow-500/50 bg-warning/10"
                    )}
                  >
                    <div className="flex items-start gap-4 w-full max-w-full overflow-hidden">
                      {/* Previsualización de la URL */}
                      <div className="flex-shrink-0">
                        <div className="w-16 h-16 bg-muted/80 rounded p-2 flex items-center justify-center">
                          {url.urlType === 'image' ? (
                            // Vista previa de imagen
                            <>
                              <img
                                src={
                                  url.originalUrl.startsWith('/') && !url.originalUrl.startsWith('//')
                                    ? `${devServerUrl.replace(/\/+$/, '')}${url.originalUrl}`
                                    : url.originalUrl.startsWith('uploads/')
                                      ? `/api/serve-upload?fileName=${encodeURIComponent(url.originalUrl.replace('uploads/', ''))}`
                                      : url.originalUrl
                                }
                                alt={t('preview')}
                                className="w-12 h-12 object-cover rounded bg-card"
                                onError={(e) => {
                                  console.log('[FileUrlEditor] ❌ Error cargando imagen:', url.originalUrl);
                                  const target = e.target as HTMLImageElement;
                                  target.style.display = 'none';
                                  const nextSibling = target.nextElementSibling as HTMLElement;
                                  if (nextSibling) nextSibling.style.display = 'flex';
                                }}
                                onLoad={(e) => {
                                  console.log('[FileUrlEditor] ✅ Imagen cargada:', url.originalUrl);
                                }}
                              />
                              <div
                                className="w-12 h-12 hidden items-center justify-center rounded bg-card text-muted-foreground/80 text-[10px] text-center px-1"
                              >
                                <span>{t('notAvailable')}</span>
                              </div>
                            </>
                          ) : (
                            // Placeholder para otros tipos de contenido
                            <div className="w-12 h-12 flex items-center justify-center rounded bg-card text-muted-foreground">
                              {/* Mostrar ícono según el tipo detectado */}
                              {url.urlType === 'video' && '🎬'}
                              {url.urlType === 'audio' && '🎵'}
                              {url.urlType === 'document' && '📄'}
                              {url.urlType === 'website' && '🌐'}
                              {url.urlType === 'other' && '🔗'}
                            </div>
                          )}
                        </div>
                      </div>
                      
                      <div className="flex-1 min-w-0 max-w-full overflow-hidden">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-xs font-mono text-muted-foreground">
                            {t('line')} {url.line}
                          </span>
                          <span className={cn(
                            "text-xs px-2 py-1 rounded",
                            url.urlType === 'image' && "bg-accent/20 text-purple-300",
                            url.urlType === 'video' && "bg-primary/20 text-primary-foreground",
                            url.urlType === 'audio' && "bg-success/20 text-success",
                            url.urlType === 'document' && "bg-warning/20 text-yellow-300",
                            url.urlType === 'website' && "bg-indigo-500/20 text-indigo-300",
                            url.urlType === 'other' && "bg-muted/60/20 text-foreground/70"
                          )}>
                            {url.urlType === 'image' && t('urlTypeImage')}
                            {url.urlType === 'video' && t('urlTypeVideo')}
                            {url.urlType === 'audio' && t('urlTypeAudio')}
                            {url.urlType === 'document' && t('urlTypeDocument')}
                            {url.urlType === 'website' && t('urlTypeWebsite')}
                            {url.urlType === 'other' && t('urlTypeOther')}
                          </span>
                          {isEdited && (
                            <span className="text-xs bg-warning/20 text-yellow-300 px-2 py-1 rounded">
                              {t('edited')}
                            </span>
                          )}
                        </div>
                        
                        <div className="mb-3 max-w-full">
                          <label className="block text-xs text-muted-foreground mb-1">
                            {t('originalUrl')}
                          </label>
                          <div className="text-sm font-mono text-foreground/70 bg-background/50 p-2 rounded overflow-x-auto max-w-full">
                            <div className="whitespace-nowrap">
                              {url.originalUrl}
                            </div>
                          </div>
                        </div>
                        
                        <div className="max-w-full">
                          <label className="block text-xs text-muted-foreground mb-1">
                            {t('newUrl')}
                          </label>
                          <textarea
                            value={currentValue}
                            onChange={(e) => handleUrlChange(url.id, e.target.value)}
                            className="w-full bg-background border border-border/40 text-foreground/80 font-mono text-sm p-2 rounded resize-none h-12 whitespace-nowrap overflow-x-auto overflow-y-hidden"
                            placeholder={t('enterNewUrlPlaceholder')}
                            rows={1}
                            style={{ 
                              minWidth: '100%',
                              width: '100%',
                              scrollbarWidth: 'thin',
                              scrollbarColor: '#4B5563 #1F2937'
                            }}
                          />
                        </div>
                      </div>
                    </div>
                    
                    {/* Contexto */}
                    <div className="mt-3 pt-3 border-t border-border/40">
                      <label className="block text-xs text-muted-foreground mb-1">
                        {t('context')}
                      </label>
                      <pre className="text-xs text-muted-foreground bg-background/30 p-2 rounded overflow-x-auto">
                        {url.context}
                      </pre>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="p-4">
            <div className="space-y-3">
              {filteredFiles.map((file) => (
                <div
                  key={file.path}
                  className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border/40 cursor-pointer"
                  onClick={() => setSelectedFile(file.path)}
                >
                  <div className="flex items-center">
                    <File className="h-4 w-4 mr-3 text-primary" />
                    <div>
                      <div className="font-medium text-foreground/80">{file.name}</div>
                      <div className="text-xs text-muted-foreground truncate max-w-[200px]">
                        {file.path}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center">
                    <span className="bg-primary/20 text-primary-foreground text-xs px-2 py-1 rounded-full">
                      {file.urls.length} URLs
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-border/50 text-xs text-muted-foreground bg-background">
        <div className="flex items-center justify-between">
          <span>{t('selectFileToEditUrls')}</span>
          <span>{filesWithUrls.length} {t('filesWithUrls')}</span>
        </div>
      </div>
    </div>
  );
}