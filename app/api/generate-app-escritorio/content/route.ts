import { NextRequest, NextResponse } from 'next/server';
import { getModelConfig } from '@/api/zeus-model-api/model-service';
import { readApiConfig } from '@/api/utils';
import { createOllamaCloudStream, finalizeContent, cleanGeneratedContent, isValidModelResponse } from '@/api/zeus-model-api/streaming-content-generator';

interface ContentRequest {
  filePath: string;
  template: string;
  appName: string;
  complexity: 'simple' | 'standard' | 'complex';
  features: string[];
  description: string;
  projectStructure?: any;
  modelConfig?: {
    url: string;
    apiKey: string;
    model: string;
  };
  context?: {
    relatedFiles?: string[];
    dependencies?: string[];
    purpose?: string;
  };
  optimizeForSpeed?: boolean;
  isLocalModel?: boolean;
  uploadedFiles?: {
    name: string;
    type: string;
    size: number;
    content: string;
  }[];
  uploadedImages?: {
    name: string;
    type: string;
    size: number;
    dataUrl: string;
    url?: string; // URL para imágenes seleccionadas de Unsplash
  }[];
  additionalPages?: {
    route: string;
    purpose: string;
  }[];
}

interface StreamChunk {
  type: 'content' | 'complete' | 'error';
  filePath: string;
  content?: string;
  chunk?: string;
  error?: string;
  metadata?: {
    linesGenerated?: number;
    estimatedTotal?: number;
    progress?: number;
    duration?: number;
    chunksProcessed?: number;
    validChunks?: number;
  };
}

// Función para generar prompts específicos según el tipo de archivo
function generateFilePrompt(filePath: string, template: string, appName: string, complexity: string, features: string[], description: string, context?: any, uploadedFiles?: any[], uploadedImages?: any[], apiConfig?: string, additionalPages?: { route: string; purpose: string }[]): string {
  const fileExtension = filePath.split('.').pop();
  const fileName = filePath.split('/').pop();
  const isComponent = filePath.includes('component') || filePath.includes('Component');
  const isPage = filePath.includes('page') || filePath.includes('Page') || filePath.includes('routes');
  const isLayout = filePath.includes('layout') || filePath.includes('Layout');
  const isAPI = filePath.includes('api') || filePath.includes('routes.py');
  const isConfig = fileName?.includes('config') || fileExtension === 'json';

  let basePrompt = `Genera código production-ready para:

**ARCHIVO**: ${filePath}
**FRAMEWORK**: ${template}
**APP**: ${appName}
**FEATURES**: ${features.join(', ')}
**DESCRIPCIÓN**: ${description}

**REQUISITOS**:
- Código limpio y modular
- TypeScript con tipos estrictos
- Responsive design
- Mejores prácticas de seguridad
- Optimizado para performance
`;

  if (apiConfig) {
    basePrompt += `\n\n**CONFIGURACIÓN DE API PERSONALIZADA**:\nLa aplicación DEBE integrarse con la siguiente API personalizada. Usa estos endpoints, modelos de datos y esquemas en el código generado (incluye handlers, servicios, tipos y UI conectada a esta API):\n${apiConfig}`;
    basePrompt += `\n\n**INSTRUCCIONES PARA COMPONENTES DE UI DE LA API**:\nPara CADA endpoint de la API anterior, DEBES crear componentes de UI funcionales que permitan interactuar con ellos. Ejemplos:\n- Si hay un endpoint GET para listar recursos → crea un componente con tabla/lista que haga fetch y muestre los datos\n- Si hay un endpoint POST para crear → crea un formulario con validación para enviar datos\n- Si hay un endpoint PUT/PATCH para actualizar → crea un modal o formulario de edición\n- Si hay un endpoint DELETE → crea un botón de eliminar con confirmación\n- Usa hooks de React (useState, useEffect) para estado y fetch\n- Maneja estados de loading, error y éxito con feedback visual\n- Los componentes deben estar en components/api/ o en la ubicación apropiada del proyecto\n- Exporta los componentes para que puedan importarse en las páginas`;
  }

  // Prompt extra específico para archivos de componentes API forzados en la estructura
  if (filePath.includes('ApiDashboard.tsx') || filePath.includes('ApiClient.ts') || filePath.includes('api-client/page.tsx')) {
    basePrompt += `\n\n**ESTE ARCHIVO ES OBLIGATORIO PARA LA INTEGRACIÓN DE LA API**:\nEste archivo forma parte del sistema de gestión de la API. DEBE implementar funcionalidades completas para interactuar con TODOS los endpoints definidos en la configuración de API. No omitas ningún endpoint. Crea tablas, formularios, modales y botones de acción para cada operación CRUD. Usa fetch/axios con manejo de errores y estados de carga.`;
  }

  if (filePath === 'app/page.tsx' && complexity === 'complex') {
    basePrompt += `

  **REQUERIMIENTO ADICIONAL**:
  `;
  }

  if (context?.purpose) {
    basePrompt += `\n- Propósito del archivo: ${context.purpose}`;
  }
  
  // Agregar información de archivos subidos si están disponibles
  if (uploadedFiles && uploadedFiles.length > 0) {
    basePrompt += `\n\n**ARCHIVOS DE REFERENCIA (INFORMACIÓN QUE DEBES INCORPORAR EN EL CÓDIGO)**:`;
    uploadedFiles.forEach(file => {
      basePrompt += `
- ${file.name} (${file.type}):
\`\`\`
${file.content.substring(0, 1000)}${file.content.length > 1000 ? '...' : ''}
\`\`\``;
    });
    basePrompt += `\n\nINSTRUCCIONES PARA ARCHIVOS DE REFERENCIA: Usa el contenido de estos archivos como base, inspiración o datos para el código que generes. Si es documentación, incorpórala en el texto de la UI. Si son datos (JSON, CSV), úsalos en el componente. Si es código, inspírate en la estructura pero adapta al framework ${template}.`;
  }
  
  if (uploadedImages && uploadedImages.length > 0) {
    basePrompt += `\n\n**IMÁGENES DE REFERENCIA (OBLIGATORIO: USAR ESTAS IMÁGENES EN EL CÓDIGO GENERADO)**:`;
    uploadedImages.forEach((image, index) => {
      if ((image as any).url) {
        const imageUrl = (image as any).url;
        basePrompt += `\n- Imagen ${index + 1}: ${image.name || 'imagen-seleccionada'} - URL: ${imageUrl}`;
        basePrompt += `\n  USAR ESTA IMAGEN en componentes visuales (hero, galerías, cards, etc.) con: <img src="${imageUrl}" alt="..." /> o usando Next.js Image component`;
      } else if ((image as any).dataUrl || (image as any).path) {
        const imgName = image.name || `uploaded-image-${index + 1}`;
        const imgPath = (image as any).path || `/uploads/${imgName}`;
        basePrompt += `\n- Imagen ${index + 1}: ${imgName} - PATH: ${imgPath}`;
        basePrompt += `\n  USAR ESTA IMAGEN en componentes visuales con: <img src="${imgPath}" alt="..." /> o usando Next.js Image component con src="${imgPath}"`;
      } else {
        basePrompt += `\n- ${image.name} (${image.type}) - Usar como referencia visual para el diseño`;
      }
    });
    basePrompt += `\n\nIMPORTANTE: Las imágenes listadas arriba DEBEN ser incluidas directamente en el código generado, especialmente en componentes como hero sections, galerías, cards de características, etc. NO uses URLs de imágenes genéricas de internet.`;
  }

  // Prompts específicos según el tipo de archivo
  if (isComponent) {
    basePrompt += `

**COMPONENTE**:
- React.memo, hooks optimizados
- Props TypeScript estrictas
- Tailwind CSS responsive
- Accesibilidad ARIA`;
    
    // Instrucción específica para el footer
    if (filePath.includes('footer') || filePath.includes('Footer')) {
      basePrompt += `
- **CRÍTICO PARA FOOTER**: El texto del copyright DEBE incluir exactamente: "© ${new Date().getFullYear()} ${appName}. Todos los derechos reservados. Aplicación creada con www.zeus-ia.com"
- El footer DEBE mostrar este texto completo del copyright como se especifica arriba`;
    }
  } else if (isPage) {
    basePrompt += `

**PÁGINA**:
- SEO meta tags optimizados
- Loading states y error boundaries
- Responsive mobile-first
- Performance optimizado
- CRÍTICO: Asegúrate de que todos los hooks (useState, useEffect, useStore, etc.) se llamen DENTRO del componente funcional o de un custom hook. NO los llames a nivel global del archivo.
- **MANDATORY IMPORT**: Si el archivo es app/page.tsx, DEBES incluir esta importación al inicio del archivo: import Footer from '@/components/layout/footer';
- **MANDATORY USAGE**: DEBES usar el componente Footer en el JSX. Incluye <Footer /> al final del return del componente, antes de cerrar el contenedor principal.
- **CRÍTICO**: NO crees elementos footer inline. SIEMPRE usa el componente Footer importado. El componente Footer manejará automáticamente el texto de copyright.
- El componente Footer DEBE estar incluido en la estructura JSX del componente de la página.
- **CRÍTICO PADDING**: El Footer está fijo en la parte inferior (fixed bottom-0). El contenedor principal DEBE tener padding-bottom (pb-20 o pb-24) para evitar que el contenido se oculte detrás del footer. Ejemplo: <div className="min-h-screen pb-20 bg-white"> o <main className="pb-20">.`;
  } else if (isLayout) {
    basePrompt += `

**LAYOUT**:
- Context providers y error boundaries
- Navegación responsive
- Theme system con dark mode
- Accesibilidad ARIA landmarks`;
    if (apiConfig) {
      basePrompt += `\n- DEBES importar y usar Navbar desde '@/components/Navbar' (o './components/Navbar') en el layout, renderizándolo antes de {children}. El Navbar DEBE incluir un link a /api-client para acceder al dashboard de la API.`;
    }
  } else if (isAPI) {
    basePrompt += `

**API**:
- Validación con Zod/Joi
- Manejo de errores estructurado
- Seguridad JWT/CORS
- Performance y caching`;
  } else if (fileExtension === 'css' || fileExtension === 'scss') {
    basePrompt += `

**CSS**:
- Variables CSS y design tokens
- Grid/Flexbox responsive
- Dark mode support
- Animaciones optimizadas
- CRÍTICO: Usa solo propiedades CSS válidas y sintaxis correcta
- NO uses propiedades CSS inventadas o con sintaxis incorrecta
- Verifica que todas las propiedades CSS sean estándar`;
  } else if (fileExtension === 'ts' || fileExtension === 'js') {
    if (fileName === 'utils.ts' || fileName === 'utils.js') {
      basePrompt += `

**UTILIDADES**:
- Funciones puras y tipadas
- Validación y sanitización
- Performance optimizado
- Tree-shaking friendly`;
    } else if (fileName === 'main.ts' || fileName === 'main.tsx') {
      basePrompt += `

**PUNTO DE ENTRADA**:
- Inicialización de la app
- Configuración de entorno
- Code splitting y lazy loading
- Error tracking y analytics`;
    }
  }

  // Agregar información sobre dependencias disponibles según el template
  let availableDependencies = '';
  if (template === 'next-js') {
    availableDependencies = `

**DEPENDENCIAS DISPONIBLES**:
- React 18.2.0, Next.js 14.0.0
- UI: @headlessui/react, @heroicons/react, lucide-react
- Styling: tailwindcss, clsx, tailwind-merge, class-variance-authority
- Forms: react-hook-form, zod, @hookform/resolvers
- State: zustand
- Utils: date-fns, framer-motion
- NO uses: react-dropzone, material-ui, antd, o librerías no listadas`;
  } else if (template === 'vite-react') {
    availableDependencies = `

**DEPENDENCIAS DISPONIBLES**:
- React 18.2.0, React Router DOM
- UI: @headlessui/react, @heroicons/react
- Styling: tailwindcss, clsx, tailwind-merge
- Forms: react-hook-form, zod, @hookform/resolvers
- State: zustand
- HTTP: axios
- Utils: date-fns, framer-motion
- NO uses: react-dropzone, material-ui, antd, o librerías no listadas`;
  }

  basePrompt += availableDependencies;

  // Incluir información de páginas adicionales disponibles
  if (additionalPages && additionalPages.length > 0) {
    basePrompt += `

**PÁGINAS ADICIONALES DISPONIBLES**:
El proyecto incluye las siguientes páginas adicionales. DEBES crear enlaces de navegación a ellas cuando sea apropiado (Navbar, menús, botones, cards clickeables, etc.):
${additionalPages.map(p => `- /${p.route} → ${p.purpose}`).join('\n')}

**REGLAS DE NAVEGACIÓN**:
- Usa Next.js Link component para navegación interna: <Link href="/${additionalPages[0].route}">...</Link>
- Crea enlaces visibles y accesibles a todas las páginas listadas arriba.
- En el Navbar: incluye links a cada página adicional en el menú de navegación.
- En el Footer: incluye links a cada página adicional en las columnas de links.`;
  } else {
    basePrompt += `

**REGLAS DE NAVEGACIÓN (CRÍTICO)**:
- SOLO crea enlaces, botones o items de navegación que apunten a páginas que REALMENTE EXISTAN en el proyecto.
- Si la estructura del proyecto NO incluye app/about/page.tsx, app/contact/page.tsx, o páginas similares, NO crees enlaces a /about, /contact, etc.
- La navegación (Navbar, Footer, botones) debe SOLO enlazar a páginas existentes. Si no estás seguro, enlaza a "/" o usa anclas scroll-to-section.
- NUNCA inventes rutas de páginas que no existan en la estructura de archivos.`;
  }

  basePrompt += `

**INSTRUCCIONES**:
- Genera SOLO código, sin explicaciones
- NO uses bloques de código
- Código production-ready
- Usa mejores prácticas de ${template}
- Optimizado para performance
- CRÍTICO: Solo usa las dependencias listadas arriba
- Para file uploads usa input HTML estándar, NO react-dropzone
- Para drag-and-drop usa eventos HTML5 nativos si es necesario
- Para CSS: SOLO usa propiedades CSS válidas con sintaxis correcta
- Para CSS: NO inventes propiedades o uses sintaxis incorrecta como 'perspective-origin-xcenter'
- Para CSS: Usa 'perspective-origin: center bottom' en lugar de sintaxis incorrecta`;

  return basePrompt;
}

// Función para generar contenido con streaming
async function generateFileContentWithStreaming(
  filePath: string,
  template: string,
  appName: string,
  complexity: string,
  features: string[],
  description: string,
  context?: any,
  customModelConfig?: { url: string; apiKey: string; model: string },
  optimizeForSpeed: boolean = false,
  uploadedFiles?: any[],
  uploadedImages?: any[],
  isLocalModel?: boolean,
  apiConfig?: string,
  additionalPages?: { route: string; purpose: string }[]
): Promise<ReadableStream> {
  const encoder = new TextEncoder();

  // 1. Preparar prompt y config fuera del stream para poder bifurcar antes.
  const prompt = generateFilePrompt(filePath, template, appName, complexity, features, description, context, uploadedFiles, uploadedImages, apiConfig, additionalPages);

  // Normalizar propiedades del modelConfig (soporta tanto snake_case como camelCase)
  const normalizeModelConfig = (config: any) => ({
    url: config?.url || config?.base_url || config?.baseURL || '',
    apiKey: config?.apiKey || config?.api_key || '',
    model: config?.model || config?.model_name || 'gemini-2.5-pro',
    provider: config?.provider || ''
  });

  const normalizedConfig = normalizeModelConfig(customModelConfig || await getModelConfig());

  // 2. Bifurcación para Ollama Cloud (no soporta SSE streaming estándar).
  //    Debe resolverse FUERA del ReadableStream.start() para que el stream
  //    de Ollama se conecte realmente a la respuesta HTTP.
  const isOllamaCloud =
    normalizedConfig.provider?.toLowerCase().includes('ollama cloud') ||
    normalizedConfig.provider?.toLowerCase().includes('ollama_cloud') ||
    normalizedConfig.provider?.toLowerCase().includes('ollama-cloud') ||
    normalizedConfig.url.includes('ollama.com') ||
    normalizedConfig.url.includes('ollama.cloud');

  if (isOllamaCloud) {
    const systemMessage = optimizeForSpeed
      ? 'Genera código funcional básico. SOLO código, sin explicaciones. Sé muy conciso.'
      : 'Genera código production-ready siguiendo mejores prácticas. Responde SOLO con código, sin explicaciones ni markdown. Sé conciso pero completo.';

    return createOllamaCloudStream({
      prompt,
      systemMessage,
      modelConfig: normalizedConfig,
      filePath,
      template,
      optimizeForSpeed,
      isLocalModel
    });
  }

  return new ReadableStream({
    async start(controller) {
      try {
        // Configurar la llamada al modelo con parámetros optimizados
        let requestBody;
        const isGoogleApi = normalizedConfig.url.includes('generativelanguage.googleapis.com');

        if (isGoogleApi) {
          // Adaptar para la API de Gemini
          requestBody = {
            contents: [
              {
                role: 'user', // Gemini usa 'user' y 'model'
                parts: [{ text: prompt }]
              }
            ],
            generationConfig: {
              temperature: optimizeForSpeed ? 0.3 : 0.1,
              maxOutputTokens: isLocalModel ? 8000 : (optimizeForSpeed ? 16000 : 32000),
              topP: 0.9,
            },
          };
        } else {
          // Cuerpo de solicitud para APIs compatibles con OpenAI
          requestBody = {
            model: normalizedConfig.model,
            messages: [
              {
                role: 'system',
                content: optimizeForSpeed
                  ? 'Genera código funcional básico. SOLO código, sin explicaciones. Sé muy conciso.'
                  : 'Genera código production-ready siguiendo mejores prácticas. Responde SOLO con código, sin explicaciones ni markdown. Sé conciso pero completo.'
              },
              {
                role: 'user',
                content: prompt
              }
            ],
            stream: true,
            temperature: optimizeForSpeed ? 0.3 : 0.1,
            max_tokens: isLocalModel ? 8000 : (optimizeForSpeed ? 16000 : 32000),
            top_p: 0.9,
            frequency_penalty: 0.1
          };
        }

        if (optimizeForSpeed) {
          console.log('🚀 MODO RÁPIDO ACTIVADO - Configuración optimizada para velocidad');
        }

        console.log(`📝 Generando contenido para: ${filePath}`);

        const apiKey = normalizedConfig.apiKey;
        let apiUrl = normalizedConfig.url;

        if (isGoogleApi) {
          // Para Gemini, la URL de streaming es diferente y el modelo es gemini-2.5-pro
          apiUrl = apiUrl.replace(/gemini-1.5-flash(-latest)?|gemini-pro/, 'gemini-2.5-pro');
          apiUrl = apiUrl.replace(':generateContent', ':streamGenerateContent');
          apiUrl = `${apiUrl}?key=${apiKey}`;
        }
        

        
        // Crear AbortController para timeout
        const controller_fetch = new AbortController();
        const timeoutMs = isLocalModel ? 300000 : (optimizeForSpeed ? 180000 : 300000); // 5 min local, 3 min vs 5 min
        const timeoutId = setTimeout(() => {
          console.warn(`⏰ Timeout alcanzado después de ${timeoutMs/1000}s`);
          controller_fetch.abort();
        }, timeoutMs);
        
        console.log(`⏱️ Timeout configurado: ${timeoutMs/1000}s`);
        
        let response;
        try {
          const headers: HeadersInit = {
            'Content-Type': 'application/json',
            'Accept': 'text/event-stream'
          };

          if (!isGoogleApi) {
            headers['Authorization'] = `Bearer ${apiKey}`;
          }

          response = await fetch(apiUrl, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(requestBody),
            signal: controller_fetch.signal
          });
        } catch (fetchError: any) {
          clearTimeout(timeoutId);
          if (fetchError.name === 'AbortError') {
            throw new Error('Timeout: La generación tomó demasiado tiempo. Intenta reducir la complejidad del archivo.');
          }
          throw new Error(`Error de conexión con el modelo: ${fetchError.message}`);
        }
        
        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorText = await response.text().catch(() => 'Unknown error');
          console.error(`❌ Error del modelo (${response.status}):`, errorText);
          throw new Error(`Error del modelo: ${response.status} - ${errorText}`);
        }

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error('No se pudo obtener el reader del stream');
        }
        
        console.log('✅ Stream iniciado correctamente');

        let accumulatedContent = '';
        let linesGenerated = 0;
        let partialData = ''; // Buffer para datos parciales
        let chunksProcessed = 0;
        let validChunks = 0;
        let startTime = Date.now();
        
        while (true) {
          const { done, value } = await reader.read();
          
          if (done) break;
          
          const chunk = new TextDecoder().decode(value);
          // Combinar con datos parciales previos
          const fullChunk = partialData + chunk;
          const lines = fullChunk.split('\n');
          
          // Guardar la última línea como parcial si no termina en \n
          partialData = chunk.endsWith('\n') ? '' : lines.pop() || '';
          
          for (const line of lines) {
            if (line.trim() && line.startsWith('data: ')) {
              const data = line.slice(6).trim();
              chunksProcessed++;
              
              if (data === '[DONE]') {
                // Limpiar y finalizar el contenido generado
                const cleanedContent = finalizeContent(accumulatedContent, filePath, template);
                
                const duration = Date.now() - startTime;
                
                console.log(`🏁 Stream completado para ${filePath}:`);
                console.log(`   📊 Chunks procesados: ${chunksProcessed}`);
                console.log(`   ✅ Chunks válidos: ${validChunks}`);
                console.log(`   📝 Líneas generadas: ${cleanedContent.split('\n').length}`);
                console.log(`   ⏱️ Duración: ${duration}ms`);
                
                // Enviar el contenido completo limpio
                const completeChunk: StreamChunk = {
                  type: 'complete',
                  filePath,
                  content: cleanedContent,
                  metadata: {
                    linesGenerated: cleanedContent.split('\n').length,
                    progress: 100,
                    duration,
                    chunksProcessed,
                    validChunks
                  }
                };
                
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(completeChunk)}\n\n`));
                controller.close();
                return;
              }
              
              try {
                // Validar que data no esté vacío y sea un JSON válido
                if (!data || data.trim() === '') {
                  continue;
                }
                
                // Verificar que el data parece ser JSON válido
                const trimmedData = data.trim();
                if (!trimmedData.startsWith('{') && !trimmedData.startsWith('[')) {
                  // No es JSON, probablemente un mensaje de texto
                  continue;
                }
                
                // Intentar parsear el JSON
                let parsed;
                try {
                  parsed = JSON.parse(trimmedData);
                } catch (jsonError: any) {
                  // Log detallado del error para debugging
                  console.warn(`JSON parse error at position ${jsonError.message.match(/position (\d+)/)?.[1] || 'unknown'}:`, jsonError.message);
                  console.warn('Raw data length:', trimmedData.length);
                  console.warn('Data preview:', trimmedData.substring(0, 100));
                  
                  // Si el JSON está incompleto, intentar repararlo
                  let cleanedData = trimmedData;
                  
                  // Verificar si es una cadena JSON incompleta
                  if (cleanedData.startsWith('{') && !cleanedData.endsWith('}')) {
                    // Intentar cerrar el JSON incompleto
                    const openBraces = (cleanedData.match(/{/g) || []).length;
                    const closeBraces = (cleanedData.match(/}/g) || []).length;
                    if (openBraces > closeBraces) {
                      cleanedData += '}'.repeat(openBraces - closeBraces);
                    }
                  }
                  
                  // Verificar si hay comillas sin cerrar
                  const quotes = (cleanedData.match(/"/g) || []).length;
                  if (quotes % 2 !== 0) {
                    // Encontrar la última comilla y verificar si necesita cierre
                    const lastQuoteIndex = cleanedData.lastIndexOf('"');
                    if (lastQuoteIndex > 0) {
                      const afterQuote = cleanedData.substring(lastQuoteIndex + 1).trim();
                      // Solo agregar comilla si parece que falta el cierre
                      if (!afterQuote.match(/^[,}\]]/)) {
                        cleanedData += '"';
                      }
                    }
                  }
                  
                  try {
                    parsed = JSON.parse(cleanedData);
                    console.log('✅ Successfully repaired and parsed JSON');
                  } catch (secondError: any) {
                    console.error('❌ JSON repair failed:', secondError.message);
                    console.error('Original error:', jsonError.message);
                    console.error('Cleaned data preview:', cleanedData.substring(0, 200));
                    continue; // Saltar este chunk y continuar
                  }
                }
                 
                 // Validar que el JSON parseado tiene la estructura esperada
                 if (!isValidModelResponse(parsed)) {
                   console.warn('Invalid model response structure:', Object.keys(parsed || {}));
                   continue;
                 }
                 
                 const content = parsed?.choices?.[0]?.delta?.content || parsed?.delta?.content || parsed?.content;
                 
                 if (content && typeof content === 'string') {
                    accumulatedContent += content;
                    linesGenerated = accumulatedContent.split('\n').length;
                    validChunks++;
                    
                    // Enviar chunk de contenido
                    const contentChunk: StreamChunk = {
                      type: 'content',
                      filePath,
                      chunk: content,
                      metadata: {
                        linesGenerated,
                        estimatedTotal: Math.max(50, linesGenerated * 2),
                        progress: Math.min(95, (linesGenerated / 50) * 100),
                        chunksProcessed,
                        validChunks
                      }
                    };
                    
                    try {
                      controller.enqueue(encoder.encode(`data: ${JSON.stringify(contentChunk)}\n\n`));
                    } catch (enqueueError: any) {
                      console.error('Error enqueueing content chunk:', enqueueError.message);
                      // Continuar sin fallar completamente
                    }
                  }
              } catch (parseError: any) {
                console.error('Error parsing SSE data:', parseError.message);
                console.error('Raw data that failed to parse:', data.substring(0, 500));
                // Continuar procesando otros chunks en lugar de fallar completamente
              }
            }
          }
        }
        
      } catch (error) {
        console.error('Error generando contenido:', error);
        
        let errorMessage = 'Error desconocido';
        if (error instanceof Error) {
          if (error.name === 'AbortError') {
            errorMessage = 'Timeout: La generación tomó demasiado tiempo. Intenta con un archivo más simple o reduce la complejidad.';
          } else {
            errorMessage = error.message;
          }
        }
        
        const errorChunk: StreamChunk = {
          type: 'error',
          filePath,
          error: errorMessage
        };
        
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(errorChunk)}\n\n`));
        controller.close();
      }
    }
  });
}

// Función para verificar si un archivo tiene contenido predefinido
function getStaticFileContent(filePath: string, template?: string, appName?: string, features: string[] = []): string | null {
  const fileName = filePath.split('/').pop()?.toLowerCase();
  
  // Verificar archivos específicos que deben usar contenido estático
  if (fileName === 'button.tsx' || filePath.includes('/ui/button.tsx')) {
    return `import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline:
          "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };`;
  }

  // components/ui/card.tsx: componente Card (shadcn). El modelo NO debe generar contenido de página aquí.
  if (fileName === 'card.tsx' || filePath.includes('/ui/card.tsx')) {
    return `import * as React from 'react';
import { cn } from '@/lib/utils';

const Card = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      'rounded-lg border bg-card text-card-foreground shadow-sm',
      className
    )}
    {...props}
  />
));
Card.displayName = 'Card';

const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('flex flex-col space-y-1.5 p-6', className)}
    {...props}
  />
));
CardHeader.displayName = 'CardHeader';

const CardTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h3
    ref={ref}
    className={cn(
      'text-2xl font-semibold leading-none tracking-tight',
      className
    )}
    {...props}
  />
));
CardTitle.displayName = 'CardTitle';

const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn('text-sm text-muted-foreground', className)}
    {...props}
  />
));
CardDescription.displayName = 'CardDescription';

const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('p-6 pt-0', className)} {...props} />
));
CardContent.displayName = 'CardContent';

const CardFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('flex items-center p-6 pt-0', className)}
    {...props}
  />
));
CardFooter.displayName = 'CardFooter';

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardDescription,
  CardContent,
};
`;
  }

  // app/metadata.ts: contenido fijo; el modelo NO debe crear metadata en app/page.tsx
  if (filePath === 'app/metadata.ts' && template === 'next-js') {
    const title = (appName && String(appName).replace(/'/g, "\\'")) || 'App';
    return `import type { Metadata } from 'next';

/** Metadata de la aplicación. Único lugar donde se define; NO exportar metadata en app/page.tsx. */
export const metadata: Metadata = {
  title: '${title} | Zeus IA',
  description: 'Aplicación creada con Zeus IA - www.zeus-ia.com',
  openGraph: {
    title: '${title} | Zeus IA',
    description: 'Aplicación creada con Zeus IA - www.zeus-ia.com',
  },
};
`;
  }
  
  // Proporcionar contenido estático correcto para layout.tsx
  if (filePath === 'app/layout.tsx' && template === 'next-js') {
    const hasAuth = features.includes('authentication');
    const hasDatabase = features.includes('database');
    const hasChat = features.includes('chat');
    const hasApi = features.includes('api');
    const hasNavbar = hasAuth || hasDatabase || hasChat || hasApi;
    
    return `'use client';

import './globals.css';
import { Inter } from 'next/font/google';
${hasNavbar ? "import Navbar from '@/components/Navbar';\n" : ""}
import { Providers } from '@/components/Providers';
${hasChat ? "import { FloatingChatButton } from '@/src/components/ui/floating-chat-button';\nimport { FloatingChat } from '@/FloatingChat/Chat/index';\nimport { DraggableFloatingChat } from '@/FloatingChat/Chat/DraggableFloatingChat';\nimport { useState } from 'react';\nimport { MessageSquare } from 'lucide-react';\n" : ""}

const inter = Inter({ subsets: ['latin'] });

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  ${hasChat ? "const [isChatOpen, setIsChatOpen] = useState(false);\n\n const [isAuthenticated, setIsAuthenticated] = useState(false);\n\n  const handleToggleChat = () => {\n    setIsChatOpen((prev) => !prev);\n  };\n\n  const handleCloseChat = () => {\n    setIsChatOpen(false);\n  };" : ""}

  // Check if we're in the main application context and prevent rendering
  // if we're not supposed to show the floating chat
  const isMainApp = typeof window !== 'undefined' && (
    new URLSearchParams(window.location.search).get('mainApp') === 'true' ||
    window.location.pathname === '/editor'
  );

  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <Providers>
          ${hasNavbar ? '<Navbar />\n          ' : ''}
          {children}
          ${hasChat ? `
          {!isMainApp && (
            <>
              <FloatingChatButton onClick={handleToggleChat}>
                <MessageSquare className="w-6 h-6" />
              </FloatingChatButton>

              {isChatOpen && (
                <DraggableFloatingChat
                  isOpen={isChatOpen}
                  onClose={handleCloseChat}
                >
                  <FloatingChat
                    config={{ pocketbaseUrl: process.env.NEXT_PUBLIC_POCKETBASE_URL || 'http://127.0.0.1:8090' }}
                    isOpen={true}
                    onClose={handleCloseChat}
                    isAuthenticated={isAuthenticated}
                    setIsAuthenticated={setIsAuthenticated}
                  />
                </DraggableFloatingChat>
              )}
            </>
          )}` : ''}
        </Providers>
      </body>
    </html>
  );
}`;

  }

  // Proporcionar contenido estático correcto para theme-provider.tsx
  if (filePath.includes('theme-provider.tsx') || fileName === 'theme-provider.tsx') {
    return `'use client';

import * as React from 'react';
import { ThemeProvider as NextThemesProvider } from 'next-themes';
import { type ThemeProviderProps } from 'next-themes';

export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
`;
  }

  // Proporcionar contenido estático correcto para Providers.tsx
  if (filePath.includes('Providers.tsx') || fileName === 'providers.tsx') {
    return `'use client';

import * as React from 'react';
import { ThemeProvider } from '@/components/theme-provider';
import { Toaster } from '@/components/ui/toaster';
import { useStore } from '@/lib/store';
import { AuthProvider } from '@/lib/auth';

export function Providers({ children }: { children: React.ReactNode }) {
  React.useEffect(() => {
    useStore.getState().init();
  }, []);

  return (
    <AuthProvider>
      <ThemeProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
        disableTransitionOnChange
      >
        {children}
        <Toaster />
      </ThemeProvider>
    </AuthProvider>
  );
};
`;
  }

  return null;
}

export async function POST(request: NextRequest) {
  try {
    const body: ContentRequest = await request.json();
    const { filePath, template, appName, complexity, features, description, context, modelConfig, optimizeForSpeed = false, uploadedFiles = [], uploadedImages = [], isLocalModel, additionalPages } = body;
    
    // Log de archivos subidos para contenido
    if (uploadedFiles.length > 0) {
      console.log(`📎 Usando ${uploadedFiles.length} archivos de referencia para ${filePath}`);
    }
    
    if (uploadedImages.length > 0) {
      console.log(`🖼️ Usando ${uploadedImages.length} imágenes de referencia para ${filePath}`);
    }

    // Validar parámetros requeridos
    if (!filePath || !template || !appName) {
      return NextResponse.json(
        { error: 'filePath, template y appName son requeridos' },
        { status: 400 }
      );
    }

    console.log(`📝 Generando contenido para: ${filePath}`);

    // Verificar si el archivo tiene contenido predefinido
    const staticContent = getStaticFileContent(filePath, template, appName, features);
    if (staticContent) {
      console.log(`✅ Usando contenido estático para: ${filePath}`);
      
      // Crear stream que devuelve contenido estático inmediatamente
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          const chunk = {
            type: 'content',
            filePath,
            chunk: staticContent,
            metadata: {
              linesGenerated: staticContent.split('\n').length,
              estimatedTotal: staticContent.split('\n').length,
              progress: 100,
              chunksProcessed: 1,
              validChunks: 1
            }
          };
          
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
          
          const completeChunk = {
            type: 'complete',
            filePath,
            content: staticContent
          };
          
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(completeChunk)}\n\n`));
          controller.close();
        }
      });
      
      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST',
          'Access-Control-Allow-Headers': 'Content-Type'
        }
      });
    }

    // Leer configuración de API personalizada si la característica está activa
    let apiConfig: string | undefined;
    if (features?.includes('api')) {
      const apiConfigContent = await readApiConfig();
      if (apiConfigContent) {
        apiConfig = apiConfigContent;
        console.log('✅ API config inyectada en el prompt de contenido');
      } else {
        console.log('⚠️ Característica "api" seleccionada pero no se encontró API/zeus-api-config.json');
      }
    }

    // Generar contenido con streaming
    const stream = await generateFileContentWithStreaming(
      filePath,
      template,
      appName,
      complexity || 'standard',
      features || [],
      description || '',
      context,
      modelConfig,
      optimizeForSpeed,
      uploadedFiles,
      uploadedImages,
      isLocalModel,
      apiConfig,
      additionalPages
    );

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type'
      }
    });

  } catch (error) {
    console.error('Error en endpoint de contenido:', error);
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    );
  }
}

// Endpoint GET para obtener información sobre un archivo específico
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const filePath = searchParams.get('filePath');
  const template = searchParams.get('template');

  if (!filePath || !template) {
    return NextResponse.json(
      { error: 'filePath y template son requeridos' },
      { status: 400 }
    );
  }

  // Proporcionar información sobre el archivo
  const fileInfo = {
    filePath,
    template,
    estimatedLines: getEstimatedLines(filePath, template),
    complexity: getFileComplexity(filePath),
    dependencies: getFileDependencies(filePath, template),
    purpose: getFilePurpose(filePath)
  };

  return NextResponse.json(fileInfo);
}

// Funciones auxiliares para el endpoint GET
function getEstimatedLines(filePath: string, template: string): number {
  const fileName = filePath.split('/').pop();
  const fileExtension = filePath.split('.').pop();
  
  if (fileName === 'package.json') return 30;
  if (fileExtension === 'json') return 20;
  if (filePath.includes('config')) return 25;
  if (filePath.includes('page') || filePath.includes('Page')) return 80;
  if (filePath.includes('layout') || filePath.includes('Layout')) return 60;
  if (filePath.includes('component') || filePath.includes('Component')) return 50;
  if (fileExtension === 'css' || fileExtension === 'scss') return 100;
  if (fileName === 'README.md') return 40;
  
  return 40; // Default
}

function getFileComplexity(filePath: string): 'low' | 'medium' | 'high' {
  if (filePath.includes('config') || filePath.includes('.json')) return 'low';
  if (filePath.includes('component') || filePath.includes('Component')) return 'medium';
  if (filePath.includes('page') || filePath.includes('api') || filePath.includes('layout')) return 'high';
  
  return 'medium';
}

function getFileDependencies(filePath: string, template: string): string[] {
  const dependencies: string[] = [];
  
  if (template === 'next-js') {
    dependencies.push('next', 'react', 'react-dom');
    if (filePath.includes('.tsx') || filePath.includes('.ts')) {
      dependencies.push('@types/react', '@types/node');
    }
  } else if (template === 'vite-react') {
    dependencies.push('react', 'react-dom', 'vite');
    if (filePath.includes('.tsx') || filePath.includes('.ts')) {
      dependencies.push('@types/react', '@types/react-dom');
    }
  }
  
  return dependencies;
}

function getFilePurpose(filePath: string): string {
  const fileName = filePath.split('/').pop();
  
  if (fileName === 'package.json') return 'Configuración de dependencias y scripts del proyecto';
  if (fileName === 'README.md') return 'Documentación principal del proyecto';
  if (fileName?.includes('config')) return 'Archivo de configuración del framework';
  if (filePath.includes('page')) return 'Página principal de la aplicación';
  if (filePath.includes('layout')) return 'Layout base para todas las páginas';
  if (filePath.includes('component')) return 'Componente reutilizable';
  if (filePath.includes('api')) return 'Endpoint de API';
  if (fileName?.endsWith('.css')) return 'Estilos globales de la aplicación';
  
  return 'Archivo del proyecto';
}