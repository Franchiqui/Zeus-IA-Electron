import { NextRequest, NextResponse } from 'next/server';
import { join } from 'path';
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import JSZip from 'jszip';
import { getPocketBase } from '../../../lib/pocketbase';

// Marcar como ruta dinámica
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId');
    const selectedImagesParam = searchParams.get('selectedImages');
    
    if (!projectId) {
      return NextResponse.json({ 
        error: 'Missing projectId parameter' 
      }, { status: 400 });
    }
    
    // Parsear imágenes seleccionadas
    let selectedImages = [];
    if (selectedImagesParam) {
      try {
        selectedImages = JSON.parse(decodeURIComponent(selectedImagesParam));
        console.log('[download-uploads-db] 🖼️ Imágenes seleccionadas recibidas:', selectedImages);
        console.log('[download-uploads-db] 📊 Total de imágenes recibidas:', selectedImages.length);
        
        // Logging detallado de cada imagen
        selectedImages.forEach((img: { name: any; url: string; }, index: number) => {
          console.log(`[download-uploads-db] 🖼️ Imagen ${index + 1}:`, {
            name: img.name,
            url: img.url,
            urlIsValid: !!img.url && img.url.length > 0,
            isCompleteUrl: img.url?.startsWith('http')
          });
        });
      } catch (parseError) {
        console.warn('[download-uploads-db] ⚠️ Error parseando imágenes seleccionadas:', parseError);
        selectedImages = [];
      }
    } else {
      console.log('[download-uploads-db] ⚠️ No se recibieron imágenes seleccionadas');
    }
    
    console.log('[download-uploads-db] 📦 Iniciando proceso de actualización de proyecto...', { projectId });
    
    // Conectar a PocketBase
    const pb = await getPocketBase();
    
    // Paso 1: Obtener el proyecto de la base de datos
    console.log('[download-uploads-db] 🔍 Buscando proyecto en base de datos...');
    
    let projectRecord;
    let zipFileName = null;
    let zipFieldName = null;
    
    try {
      projectRecord = await pb.collection('projects').getOne(projectId);
      
      // Logging detallado de todos los campos del proyecto
      console.log('[download-uploads-db] 📋 Datos completos del proyecto:', {
        id: projectRecord.id,
        name: projectRecord.name,
        collectionId: projectRecord.collectionId,
        zip_file: projectRecord.zip_file,
        zipFile: projectRecord.zipFile,
        file: projectRecord.file,
        project_file: projectRecord.project_file,
        projectFile: projectRecord.projectFile,
        // Todos los campos disponibles
        allFields: Object.keys(projectRecord)
      });
      
      // Campo específico para archivos ZIP de proyectos
      const zipField = 'project_archive';
      zipFieldName = zipField;
      zipFileName = projectRecord[zipField] || null;
      
      // Logging de verificación
      console.log('[download-uploads-db] 🔍 Verificando campo project_archive:', {
        fieldName: zipField,
        fileName: zipFileName,
        fieldExists: zipField in projectRecord,
        fieldValue: projectRecord[zipField]
      });
      
      console.log('[download-uploads-db] 🔍 Campo ZIP encontrado:', {
        fieldName: zipFieldName,
        fileName: zipFileName,
        hasAnyZipField: !!zipFileName
      });
      
      if (!zipFileName) {
        throw new Error(`Proyecto encontrado pero no tiene archivo ZIP asociado. Campos disponibles: ${Object.keys(projectRecord).join(', ')}`);
      }
      
    } catch (projectError: any) {
      console.error('[download-uploads-db] ❌ Error obteniendo proyecto:', projectError);
      throw new Error(`Proyecto no encontrado o sin archivo: ${projectError.message}`);
    }
    
    let tempDir = `/tmp/project-update-${projectId}-${Date.now()}`;
    
    // Paso 2: Manejar archivo ZIP del proyecto
    console.log('[download-uploads-db] 📥 Manejando archivo ZIP del proyecto...');
    
    if (zipFileName) {
      // Caso 1: El proyecto ya tiene un ZIP asociado
      console.log('[download-uploads-db] 📦 Proyecto tiene ZIP existente, descargando...');
      console.log('[download-uploads-db] 📁 Usando campo:', zipFieldName, 'con valor:', zipFileName);
      
      // Usar el método correcto de PocketBase para obtener la URL del archivo
      const zipFileUrl = pb.files.getUrl(projectRecord, zipFileName);
      console.log('[download-uploads-db] 📍 URL del ZIP (método PocketBase):', zipFileUrl);
      
      const zipResponse = await fetch(zipFileUrl);
      if (!zipResponse.ok) {
        throw new Error(`Error descargando ZIP: ${zipResponse.status} ${zipResponse.statusText}`);
      }
      
      const zipArrayBuffer = await zipResponse.arrayBuffer();
      console.log('[download-uploads-db] ✅ ZIP descargado:', zipArrayBuffer.byteLength, 'bytes');
      
      // Paso 3: Extraer y procesar el ZIP
      console.log('[download-uploads-db] 📂 Procesando archivo ZIP...');
      
      const zip = new JSZip();
      const loadedZip = await zip.loadAsync(zipArrayBuffer);
      
      mkdirSync(tempDir, { recursive: true });
      
      // Extraer todos los archivos
      const extractPromises: any[] = [];
      loadedZip.forEach((relativePath, zipEntry) => {
        if (!zipEntry.dir) {
          const filePath = join(tempDir, relativePath);
          const dirPath = join(tempDir, ...relativePath.split('/').slice(0, -1));
          
          extractPromises.push(
            new Promise<void>((resolve) => {
              mkdirSync(dirPath, { recursive: true });
              zipEntry.async('nodebuffer').then(content => {
                writeFileSync(filePath, new Uint8Array(content));
                resolve();
              });
            })
          );
        }
      });
      
      await Promise.all(extractPromises);
      console.log('[download-uploads-db] ✅ Archivos extraídos a:', tempDir);
      
    } else {
      // Caso 2: El proyecto NO tiene ZIP, crear estructura básica
      console.log('[download-uploads-db] 🆕 Proyecto sin ZIP, creando estructura básica...');
      
      mkdirSync(tempDir, { recursive: true });
      
      // Crear estructura de proyecto básica
      const publicDir = join(tempDir, 'public');
      const uploadsDir = join(publicDir, 'uploads');
      mkdirSync(uploadsDir, { recursive: true });
      
      // Crear archivos básicos del proyecto
      const indexHtml = `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${projectRecord.name || 'Proyecto Zeus'}</title>
</head>
<body>
    <h1>Proyecto ${projectRecord.name || 'Zeus'}</h1>
    <p>Generado desde el editor Zeus</p>
</body>
</html>`;
      
      writeFileSync(join(tempDir, 'index.html'), indexHtml);
      console.log('[download-uploads-db] 📄 Archivos básicos creados');
    }
    
    // Paso 4: Verificar/crear carpeta public/uploads
    const publicDir = join(tempDir, 'public');
    const uploadsDir = join(publicDir, 'uploads');
    
    if (existsSync(uploadsDir)) {
      console.log('[download-uploads-db] 📁 Carpeta public/uploads ya existe');
    } else {
      mkdirSync(uploadsDir, { recursive: true });
      console.log('[download-uploads-db] 🆕 Carpeta public/uploads creada');
    }
    
    // Paso 5: Simular imágenes seleccionadas (en implementación real vendrían del frontend)
    console.log('[download-uploads-db] 🖼️ Procesando imágenes seleccionadas...');
    
    // Usar las imágenes seleccionadas recibidas del frontend
    // Si no hay, usar las simuladas como fallback
    const imagesToProcess = selectedImages.length > 0 ? selectedImages : [
      { 
        name: '1768511596632_xjq9a4.jpg', 
        url: 'https://components.zeus-ia.com:/api/serve-upload?fileName=1768511596632_xjq9a4.jpg&projectId=udpywplcgpvv4qz' 
      },
      { 
        name: '1768511604603_2rzrxt.jpg', 
        url: 'https://components.zeus-ia.com:/api/serve-upload?fileName=1768511604603_2rzrxt.jpg&projectId=udpywplcgpvv4qz' 
      }
    ];
    
    // Paso 6: Descargar y guardar imágenes seleccionadas
    console.log('[download-uploads-db] 📥 Descargando imágenes seleccionadas...');
    
    const imageDownloadPromises = selectedImages.map(async (image: { name: string; url: string | Request | URL; }) => {
      try {
        console.log('[download-uploads-db] 📥 Descargando:', image.name);
        
        const response = await fetch(image.url);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const arrayBuffer = await response.arrayBuffer();
        const imagePath = join(uploadsDir, image.name);
        writeFileSync(imagePath, new Uint8Array(arrayBuffer));
        
        console.log('[download-uploads-db] ✅ Imagen guardada:', image.name);
        return { success: true, name: image.name };
      } catch (error) {
        console.error('[download-uploads-db] ❌ Error con imagen:', image.name, error);
        return { success: false, name: image.name, error };
      }
    });
    
    const imageResults = await Promise.all(imageDownloadPromises);
    const successfulImages = imageResults.filter(r => r.success).length;
    
    console.log('[download-uploads-db] 📊 Imágenes procesadas:', {
      total: selectedImages.length,
      successful: successfulImages,
      failed: selectedImages.length - successfulImages
    });
    
    // Paso 7: Crear nuevo archivo ZIP actualizado
    console.log('[download-uploads-db] 📦 Creando ZIP actualizado...');
    
    const updatedZip = new JSZip();
    
    // Agregar todos los archivos al nuevo ZIP
    const addFilesToUpdatedZip = (dirPath: string, basePath: string = '') => {
      // Recorrer recursivamente el directorio
      const walkDir = (currentPath: string, zipPath: string = '') => {
        if (!existsSync(currentPath)) return;
        
        const items = readdirSyncSafe(currentPath);
        for (const item of items) {
          const fullPath = join(currentPath, item);
          const isDir = isDirectorySafe(fullPath);
          const itemZipPath = zipPath ? `${zipPath}/${item}` : item;
          
          if (isDir) {
            // Para directorios, continuar recursivamente
            walkDir(fullPath, itemZipPath);
          } else {
            // Para archivos, leer y agregar al ZIP
            try {
              const fileContent = readFileSync(fullPath);
              updatedZip.file(itemZipPath, new Uint8Array(fileContent));
              console.log('[download-uploads-db] 📄 Agregado al ZIP:', itemZipPath);
            } catch (fileError) {
              console.warn('[download-uploads-db] ⚠️ Error leyendo archivo:', fullPath, fileError);
            }
          }
        }
      };
      
      walkDir(dirPath, basePath);
    };
    
    // Funciones auxiliares seguras
    const readdirSyncSafe = (dirPath: string) => {
      try {
        return require('fs').readdirSync(dirPath);
      } catch {
        return [];
      }
    };
    
    const isDirectorySafe = (filePath: string) => {
      try {
        return require('fs').statSync(filePath).isDirectory();
      } catch {
        return false;
      }
    };
    
    addFilesToUpdatedZip(tempDir);
    
    // Generar el ZIP actualizado
    const updatedZipBuffer = await updatedZip.generateAsync({ type: 'arraybuffer' });
    console.log('[download-uploads-db] ✅ ZIP actualizado generado:', updatedZipBuffer.byteLength, 'bytes');
    
    // Paso 8: Limpiar archivos temporales
    try {
      rmSync(tempDir, { recursive: true, force: true });
      console.log('[download-uploads-db] 🧹 Archivos temporales limpiados');
    } catch (cleanupError) {
      console.warn('[download-uploads-db] ⚠️ Error limpiando temporales:', cleanupError);
    }
    
    // Paso 9: Subir el ZIP actualizado a PocketBase (como hace el botón de guardar)
    console.log('[download-uploads-db] 📤 Subiendo ZIP actualizado a PocketBase...');
    
    try {
      // Crear Blob del ZIP
      const zipBlob = new Blob([updatedZipBuffer], { type: 'application/zip' });
      
      // Crear FormData para la subida
      const formData = new FormData();
      formData.append('project_archive', zipBlob, `${projectRecord.name || 'project'}_updated.zip`);
      
      // Actualizar el proyecto en PocketBase
      const updateResponse = await pb.collection('projects').update(projectId, formData);
      
      console.log('[download-uploads-db] ✅ Proyecto actualizado en PocketBase:', updateResponse);
      
      // Devolver respuesta de éxito (sin archivo para descargar)
      return NextResponse.json({
        success: true,
        message: 'Proyecto actualizado con las imágenes incluidas',
        projectId: projectId,
        imagesAdded: successfulImages
      }, { status: 200 });
      
    } catch (uploadError: any) {
      console.error('[download-uploads-db] ❌ Error subiendo a PocketBase:', uploadError);
      throw new Error(`Error al actualizar el proyecto: ${uploadError.message}`);
    }
    
  } catch (error) {
    console.error('[download-uploads-db] ❌ Error en proceso:', error);
    
    // Limpiar archivos temporales en caso de error
    try {
      const tempPattern = '/tmp/project-update-*';
      // En producción se limpiarían los directorios específicos
    } catch (cleanupError) {
      console.warn('[download-uploads-db] ⚠️ Error en limpieza:', cleanupError);
    }
    
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Error desconocido en el proceso' 
    }, { status: 500 });
  }
}