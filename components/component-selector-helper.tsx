/**
 * Component Selector Helper para Next.js
 * 
 * Agrega este componente a tu layout.tsx para habilitar la selección de componentes
 * desde el editor visual.
 * 
 * Uso:
 * 1. Copia este archivo a tu proyecto Next.js (por ejemplo, en /components/component-selector-helper.tsx)
 * 2. Importa y usa en tu layout.tsx:
 *    import { ComponentSelectorHelper } from '@/components/component-selector-helper';
 *    
 *    export default function RootLayout({ children }) {
 *      return (
 *        <html>
 *          <body>
 *            <ComponentSelectorHelper />
 *            {children}
 *          </body>
 *        </html>
 *      );
 *    }
 */

'use client';

import { useEffect } from 'react';

// Debounce mechanism to prevent rapid repeated calls
let lastGenerationTime = 0;
const GENERATION_COOLDOWN = 2000; // 2 seconds

// 🔥 NUEVO: Estado para el tipo de componente seleccionado
let currentComponentType: 'background' | 'text' | 'image' | 'layout' | 'button' | 'all' = 'all';

// 🔥 NUEVO: Función de logging mejorada para debugging
const debugLog = (message: string, _data?: any) => {
  const logMessage = `[component-selector-helper] ${message}`;

  // Log en la consola del iframe (sin enumerar objetos potencialmente problemáticos)
  console.log(logMessage);

  // También enviar al padre para debugging - solo si estamos en iframe y el padre es accesible
  try {
    if (typeof window !== 'undefined' && window.parent && window.parent !== window && window.parent.postMessage) {
      window.parent.postMessage({
        type: 'debugLog',
        message: logMessage
      }, '*');
    }
  } catch (error) {
    // Ignorar errores de cross-origin o si el padre no está accesible
    console.warn('[component-selector-helper] No se pudo enviar log al padre:', error);
  }
};

// Lista de clases genéricas de Tailwind/shadcn/ui a ignorar al generar IDs
const GENERIC_TAILWIND_CLASSES = new Set([
  'inline-flex', 'flex', 'block', 'inline', 'inline-block', 'grid', 'table', 'contents', 'hidden', 'flow-root',
  'relative', 'absolute', 'fixed', 'sticky', 'static', 'inset-0',
  'items-center', 'items-start', 'items-end', 'items-stretch', 'items-baseline',
  'justify-center', 'justify-start', 'justify-end', 'justify-between', 'justify-around', 'justify-evenly',
  'justify-items-center', 'justify-items-start', 'justify-items-end',
  'whitespace-nowrap', 'whitespace-normal', 'whitespace-pre', 'whitespace-pre-wrap', 'whitespace-pre-line',
  'text-sm', 'text-xs', 'text-base', 'text-lg', 'text-xl', 'text-2xl', 'text-3xl',
  'font-medium', 'font-bold', 'font-normal', 'font-semibold', 'font-light', 'font-extrabold', 'font-thin',
  'leading-none', 'leading-tight', 'leading-snug', 'leading-normal', 'leading-relaxed', 'leading-loose',
  'rounded-md', 'rounded-lg', 'rounded-sm', 'rounded', 'rounded-full', 'rounded-none', 'rounded-xl', 'rounded-2xl', 'rounded-3xl',
  'ring-offset-background', 'transition-colors', 'transition-all', 'transition-transform', 'transition-opacity',
  'focus-visible:outline-none', 'focus-visible:ring-2', 'focus-visible:ring-ring', 'focus-visible:ring-offset-2',
  'disabled:pointer-events-none', 'disabled:opacity-50',
  'bg-background', 'bg-primary', 'bg-secondary', 'bg-destructive', 'bg-muted', 'bg-accent', 'bg-popover', 'bg-card',
  'text-primary', 'text-secondary', 'text-destructive', 'text-muted-foreground', 'text-accent', 'text-popover',
  'text-card', 'text-card-foreground', 'text-primary-foreground', 'text-secondary-foreground',
  'border-input', 'border-border', 'border-transparent',
  'h-9', 'h-10', 'h-11', 'h-8', 'h-12', 'h-6', 'h-7', 'h-5', 'h-4', 'h-3', 'h-2', 'h-1',
  'w-10', 'w-8', 'w-12', 'w-full', 'w-auto', 'w-max', 'w-min', 'w-6', 'w-7', 'w-5', 'w-4', 'w-3', 'w-2', 'w-1', 'w-9',
  'px-3', 'px-4', 'px-8', 'px-2', 'px-6', 'px-1', 'px-5', 'px-10',
  'py-2', 'py-1', 'py-3', 'py-4', 'py-0', 'py-5',
  'p-2', 'p-3', 'p-4', 'p-1', 'p-0', 'p-5',
  'gap-2', 'gap-3', 'gap-4', 'gap-1', 'gap-0', 'gap-5',
  'space-x-2', 'space-y-2', 'space-x-4', 'space-y-4', 'space-x-1', 'space-y-1', 'space-x-3', 'space-y-3',
  'overflow-hidden', 'overflow-auto', 'overflow-scroll', 'overflow-visible', 'overflow-x-auto', 'overflow-y-auto',
  'cursor-pointer', 'cursor-default', 'cursor-grab', 'cursor-grabbing', 'cursor-move', 'cursor-not-allowed',
  'duration-200', 'duration-300', 'duration-100', 'duration-500', 'duration-75',
  'ease-in-out', 'ease-out', 'ease-in', 'ease-linear',
  'border', 'border-0', 'border-t', 'border-b', 'border-l', 'border-r',
  'bg-transparent', 'text-current', 'text-inherit',
  'sr-only', 'not-sr-only',
  'shrink-0', 'grow', 'grow-0', 'flex-1', 'flex-auto', 'flex-initial', 'flex-none',
  'flex-row', 'flex-col', 'flex-wrap', 'flex-nowrap',
  'group', 'peer',
]);

// Función para obtener la clase más específica de un elemento
const getSpecificClass = (className: string): string | null => {
  if (!className) return null;
  const classes = className.split(' ').filter(c => c && c.trim());
  for (const cls of classes) {
    // Ignorar clases genéricas y variantes de estado (hover:, focus:, active:, etc.)
    if (!GENERIC_TAILWIND_CLASSES.has(cls) && !cls.includes(':')) {
      return cls;
    }
  }
  return null;
};

export function ComponentSelectorHelper() {
  // 🔥 NUEVO: Listener para recibir el tipo de componente seleccionado
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data.type === 'componentTypeChanged') {
        currentComponentType = event.data.componentType;
        console.log('[component-selector-helper] 🔄 Tipo de componente actualizado:', currentComponentType);
      }
    };

    window.addEventListener('message', handleMessage);

    // Cleanup
    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, []);

  useEffect(() => {
    // 🔥 NUEVO: Listener para recibir el tipo de componente seleccionado
    const handleMessage = (event: MessageEvent) => {
      if (event.data.type === 'componentTypeChanged') {
        currentComponentType = event.data.componentType;
        console.log('[component-selector-helper] 🔄 Tipo de componente actualizado:', currentComponentType);
      }
    };

    window.addEventListener('message', handleMessage);

    // Cleanup
    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, []);

  useEffect(() => {
    // Verificar si estamos en un iframe
    const isInIframe = window.self !== window.top;

    // Si no estamos en un iframe, solo aplicar IDs desde CSS importado y salir
    if (!isInIframe) {
      // Función para aplicar IDs desde el CSS importado (versión simplificada para modo standalone)
      const applyIdsFromImportedCSSStandalone = async () => {
        // Buscar el CSS importado
        let cssContent = '';

        // Primero, intentar leer desde elementos <style>
        const styleElement = document.getElementById('zeus-component-styles');
        if (styleElement && styleElement.textContent) {
          cssContent = styleElement.textContent;
        } else {
          // Buscar en todos los elementos <style> (Next.js inyecta CSS aquí)
          const allStyles = Array.from(document.querySelectorAll('style'));
          for (const style of allStyles) {
            if (style.textContent &&
              (style.textContent.includes('data-component-id') ||
                style.textContent.includes('zeus'))) {
              cssContent = style.textContent;
              console.log('[component-selector-helper] CSS encontrado en elemento <style>');
              break;
            }
          }
        }

        // Si no se encuentra en <style>, intentar leer desde el archivo CSS importado
        if (!cssContent) {
          try {
            // Buscar el link al archivo CSS
            const cssLink = document.querySelector('link[href*="zeus-styles.css"]') as HTMLLinkElement;
            if (cssLink && cssLink.href) {
              // Intentar hacer fetch al archivo CSS
              const response = await fetch(cssLink.href);
              if (response.ok) {
                cssContent = await response.text();
                console.log('[component-selector-helper] CSS leído desde archivo importado');
              }
            }
          } catch (e) {
            console.warn('[component-selector-helper] No se pudo leer CSS desde archivo (puede ser CORS):', e);
          }
        }

        // Si aún no se encuentra, intentar leer desde las reglas CSS aplicadas de TODOS los stylesheets
        if (!cssContent) {
          try {
            // Buscar en todos los stylesheets (incluyendo los inyectados por Next.js)
            for (let sheetIndex = 0; sheetIndex < document.styleSheets.length; sheetIndex++) {
              try {
                const sheet = document.styleSheets[sheetIndex];
                const rules = sheet.cssRules || sheet.rules;
                if (rules) {
                  for (let i = 0; i < rules.length; i++) {
                    const rule = rules[i] as CSSStyleRule;
                    if (rule.selectorText && rule.selectorText.includes('data-component-id')) {
                      // Reconstruir el CSS desde las reglas
                      cssContent += rule.selectorText + ' {\n';
                      for (let j = 0; j < rule.style.length; j++) {
                        const prop = rule.style[j];
                        cssContent += `  ${prop}: ${rule.style.getPropertyValue(prop)} !important;\n`;
                      }
                      cssContent += '}\n\n';
                    }
                  }
                }
              } catch (e) {
                // Ignorar errores de CORS en algunos stylesheets
                continue;
              }
            }
            if (cssContent) {
              console.log('[component-selector-helper] CSS reconstruido desde reglas CSS aplicadas');
            }
          } catch (e) {
            console.warn('[component-selector-helper] No se pudo leer CSS desde reglas:', e);
          }
        }

        if (cssContent) {
          console.log('[component-selector-helper] Modo standalone: Aplicando IDs desde CSS importado...');
          const componentIdMatches = cssContent.matchAll(/\[data-component-id="([^"]+)"\]/g);
          const componentIdsInCSS = Array.from(componentIdMatches, m => m[1]);

          console.log(`[component-selector-helper] Encontrados ${componentIdsInCSS.length} IDs en CSS:`, componentIdsInCSS);

          componentIdsInCSS.forEach(componentId => {
            let element = document.querySelector(`[data-component-id="${componentId}"]`) as HTMLElement;

            if (!element) {
              // Extraer clase y path del ID
              const { classPart, pathPart } = parseComponentId(componentId);

              console.log(`[component-selector-helper] Buscando elemento para ID "${componentId}", clase extraída: "${classPart}"`);

              if (classPart) {
                // 🔥 NUEVO: Estrategia mejorada para encontrar elementos
                let foundElement: HTMLElement | null = null;

                // 1. Primero intentar con selectores más específicos para componentes
                // Detectar automáticamente si es un componente especial basado en su tipo y contexto
                const isSpecialComponent = (() => {
                  // Para todos los componentes, buscar elementos que coincidan con el ID o tengan características relevantes
                  const generalSelectors = [
                    `[data-component-id*="${componentId}"]`, // Ya tiene data-component-id parcial
                    `#${componentId}`, // Por ID
                    `[class*="${componentId}"]`, // Por clase
                    `h1, h2, h3, h4, h5, h6`, // Headers
                    `section`, // Secciones
                    `div[class*="section"]`, // Divs con clase section
                    `div[class*="container"]`, // Divs con clase container
                    `p`, // Párrafos
                    `span`, // Spans
                    `div` // Divs generales
                  ];

                  for (const selector of generalSelectors) {
                    try {
                      const elements = document.querySelectorAll(selector) as NodeListOf<HTMLElement>;
                      for (const el of elements) {
                        // Verificar si coincide por texto, clase, o ID
                        const text = el.textContent?.toLowerCase() || '';
                        const className = el.className?.toLowerCase() || '';
                        const elementId = el.id?.toLowerCase() || '';

                        if (text.includes(componentId) ||
                          className.includes(componentId) ||
                          elementId.includes(componentId)) {
                          return true;
                        }
                      }
                    } catch (e) {
                      // Ignorar errores
                    }
                  }
                  return false;
                })();

                if (isSpecialComponent) {
                  // Buscar elementos que contengan el texto del ID o que sean semánticamente similares
                  const semanticSelectors = [
                    `[data-component-id*="${componentId}"]`, // Ya tiene data-component-id parcial
                    `#${componentId}`, // Por ID
                    `[class*="${componentId}"]`, // Por clase
                    `h1, h2, h3, h4, h5, h6`, // Headers
                    `section`, // Secciones
                    `div[class*="section"]`, // Divs con clase section
                    `div[class*="container"]`, // Divs con clase container
                  ];

                  for (const selector of semanticSelectors) {
                    try {
                      const elements = document.querySelectorAll(selector) as NodeListOf<HTMLElement>;
                      for (const el of elements) {
                        // Verificar si el elemento es candidato por texto o contexto
                        const text = el.textContent?.toLowerCase() || '';
                        const className = el.className?.toLowerCase() || '';
                        const elementId = el.id?.toLowerCase() || '';

                        if (text.includes(componentId) ||
                          className.includes(componentId) ||
                          elementId.includes(componentId)) {
                          foundElement = el;
                          console.log(`[component-selector-helper] 🎯 Encontrado elemento semántico para "${componentId}":`, el.tagName, el.className);
                          break;
                        }
                      }
                      if (foundElement) break;
                    } catch (e) {
                      // Ignorar errores
                    }
                  }
                }

                // 2. Si no se encontró por semántica, usar la estrategia original
                if (!foundElement) {
                  // Buscar por clase exacta primero
                  const classSelectors = [
                    `.${classPart}`, // Clase exacta
                    `[class*="${classPart}"]`, // Contiene la clase
                    `[class*="${classPart.replace(/-/g, '')}"]`, // Sin guiones
                    `[class*="${classPart.split('-')[0]}"]` // Solo primera parte (ej: "bg" de "bg-white")
                  ];

                  const candidates: HTMLElement[] = [];
                  for (const selector of classSelectors) {
                    try {
                      const found = document.querySelectorAll(selector);
                      found.forEach((el) => {
                        const htmlEl = el as HTMLElement;
                        // Solo considerar elementos que no tienen data-component-id o que no son muy genéricos
                        if (!htmlEl.hasAttribute('data-component-id') &&
                          !['BODY', 'HTML', 'HEAD', 'SCRIPT', 'STYLE'].includes(htmlEl.tagName)) {
                          candidates.push(htmlEl);
                        }
                      });
                    } catch (e) {
                      // Ignorar errores
                    }
                  }

                  console.log(`[component-selector-helper] Encontrados ${candidates.length} candidatos para "${classPart}"`);

                  // Si hay candidatos, verificar el path para encontrar el correcto
                  if (candidates.length > 0 && pathPart) {
                    const pathFromId = pathPart.replace(/--+/g, '-').replace(/^-|-$/g, '').toLowerCase();

                    for (const candidate of candidates) {
                      const candidatePath = generatePathHash(candidate);
                      const normalizedCandidatePath = candidatePath.replace(/--+/g, '-').replace(/^-|-$/g, '');
                      const normalizedPathFromId = pathFromId.replace(/--+/g, '-').replace(/^-|-$/g, '');

                      if (candidates.length === 1 ||
                        normalizedCandidatePath === normalizedPathFromId ||
                        normalizedPathFromId.includes(normalizedCandidatePath) ||
                        normalizedCandidatePath.includes(normalizedPathFromId)) {
                        foundElement = candidate;
                        break;
                      }
                    }
                  }

                  // Si no se encontró por path pero hay candidatos, usar el primero SIN ID (nunca forzar)
                  if (!foundElement && candidates.length > 0) {
                    foundElement = candidates.find(c => !c.hasAttribute('data-component-id')) || null;
                  }
                }

                if (foundElement) {
                  foundElement.setAttribute('data-component-id', componentId);
                  console.log(`[component-selector-helper] ✅ ID "${componentId}" aplicado a elemento:`, foundElement.tagName, foundElement.className || foundElement.id);
                } else {
                  // 🔥 NUEVO: Último recurso - buscar por contenido de texto para IDs comunes
                  if (isSpecialComponent) {
                    console.log(`[component-selector-helper] 🆘 Búsqueda de emergencia por texto para "${componentId}"`);

                    // Buscar en todo el DOM elementos que contengan el texto relevante
                    const allElements = document.querySelectorAll('*') as NodeListOf<HTMLElement>;
                    let emergencyElement: HTMLElement | null = null;

                    for (const el of allElements) {
                      if (el.hasAttribute('data-component-id')) continue; // Skip if already has ID
                      if (['BODY', 'HTML', 'HEAD', 'SCRIPT', 'STYLE', 'META', 'LINK'].includes(el.tagName)) continue;

                      const text = el.textContent?.toLowerCase().trim() || '';
                      const tagName = el.tagName.toLowerCase();

                      // Para componentes especiales, buscar elementos estructurales significativos
                      if (['section', 'main', 'article', 'div', 'header', 'footer', 'p', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tagName) &&
                        text.length > 2 && text.length < 500) {
                        emergencyElement = el;
                        console.log(`[component-selector-helper] 🆘 Encontrado por texto "${componentId}":`, el.tagName, text.substring(0, 50));
                        break;
                      }
                    }

                    if (emergencyElement) {
                      emergencyElement.setAttribute('data-component-id', componentId);
                      console.log(`[component-selector-helper] ✅ ID de emergencia "${componentId}" aplicado a:`, emergencyElement.tagName, emergencyElement.className || emergencyElement.id);
                    } else {
                      console.warn(`[component-selector-helper] ❌ No se encontró elemento de emergencia para "${componentId}"`);
                    }
                  } else {
                    console.warn(`[component-selector-helper] ⚠️ No se encontraron candidatos para clase "${classPart}" (ID: ${componentId})`);
                  }
                }
              }
            } else {
              console.log(`[component-selector-helper] ✅ Elemento ya tiene ID "${componentId}"`);
            }
          });
        } else {
          console.warn('[component-selector-helper] ⚠️ No se encontró CSS importado en la página');
        }
      }

      const tryApplyIds = () => {
        applyIdsFromImportedCSSStandalone().catch(err => {
          console.warn('[component-selector-helper] Error al aplicar IDs:', err);
        });
      };

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
          // Intentar varias veces con delays para asegurar que el CSS esté cargado (Next.js puede tardar)
          setTimeout(tryApplyIds, 100);
          setTimeout(tryApplyIds, 500);
          setTimeout(tryApplyIds, 1000);
          setTimeout(tryApplyIds, 2000);
          setTimeout(tryApplyIds, 3000);
        });
      } else {
        // Si el DOM ya está listo, intentar inmediatamente y con delays
        setTimeout(tryApplyIds, 100);
        setTimeout(tryApplyIds, 500);
        setTimeout(tryApplyIds, 1000);
        setTimeout(tryApplyIds, 2000);
        setTimeout(tryApplyIds, 3000);
      }

      return; // Salir temprano en modo standalone
    }

    // Código para modo iframe (funcionalidad completa de selección)
    let selectionEnabled = false;
    // Rastrear mensajes de iconos procesados para evitar procesar el mismo mensaje múltiples veces
    const processedIconMessages = new Set < string > ();
    let iconProcessingTimeout: NodeJS.Timeout | null = null;

    // Estilos CSS para la selección
    const styleId = 'component-selector-style';
    let styleElement = document.getElementById(styleId);

    if (!styleElement) {
      styleElement = document.createElement('style');
      styleElement.id = styleId;
      styleElement.textContent = `
        * {
          position: relative;
        }
        .component-selector-hover {
          outline: 2px dashed #3b82f6 !important;
          outline-offset: 2px !important;
          cursor: pointer !important;
          z-index: 9999 !important;
        }
        .component-selector-selected {
          outline: 3px solid #3b82f6 !important;
          outline-offset: 2px !important;
          background-color: rgba(59, 130, 246, 0.1) !important;
          z-index: 10000 !important;
        }
        .resize-handle {
          position: absolute;
          width: 12px;
          height: 12px;
          background: #3b82f6;
          border: 2px solid white;
          border-radius: 50%;
          cursor: nwse-resize;
          z-index: 10001 !important;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
        }
        .resize-handle.nw { top: -6px; left: -6px; cursor: nw-resize; }
        .resize-handle.ne { top: -6px; right: -6px; cursor: ne-resize; }
        .resize-handle.sw { bottom: -6px; left: -6px; cursor: sw-resize; }
        .resize-handle.se { bottom: -6px; right: -6px; cursor: se-resize; }
        .resize-handle.n { top: -6px; left: 50%; transform: translateX(-50%); cursor: n-resize; }
        .resize-handle.s { bottom: -6px; left: 50%; transform: translateX(-50%); cursor: s-resize; }
        .resize-handle.e { top: 50%; right: -6px; transform: translateY(-50%); cursor: e-resize; }
        .resize-handle.w { top: 50%; left: -6px; transform: translateY(-50%); cursor: w-resize; }
      `;
      document.head.appendChild(styleElement);
    }

    // Función para habilitar/deshabilitar la selección
    function setSelectionMode(enabled: boolean) {
      debugLog(`🎛️ Modo de selección ${enabled ? 'ACTIVADO' : 'DESACTIVADO'}`);
      selectionEnabled = enabled;

      if (!enabled) {
        // Remover todas las clases de selección y handles
        document.querySelectorAll('.component-selector-selected').forEach(sel => {
          sel.classList.remove('component-selector-selected');
          sel.querySelectorAll('.resize-handle').forEach(handle => handle.remove());
        });
      }
    }

    // Función para agregar puntos de redimensionamiento
    function addResizeHandles(element: HTMLElement) {
      // Remover handles anteriores si existen
      element.querySelectorAll('.resize-handle').forEach(handle => handle.remove());

      // Crear handles para las 8 posiciones (esquinas y lados)
      const positions = ['nw', 'ne', 'sw', 'se', 'n', 's', 'e', 'w'];

      positions.forEach(pos => {
        const handle = document.createElement('div');
        handle.className = `resize-handle ${pos}`;
        handle.setAttribute('data-position', pos);
        element.appendChild(handle);

        // Agregar event listeners para redimensionar
        handle.addEventListener('mousedown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          startResize(element, pos, e);
        });
      });
    }

    // Función para iniciar el redimensionamiento
    function startResize(element: HTMLElement, position: string, e: MouseEvent) {
      const startX = e.clientX;
      const startY = e.clientY;
      const startWidth = element.offsetWidth;
      const startHeight = element.offsetHeight;
      const startLeft = element.offsetLeft;
      const startTop = element.offsetTop;
      const parent = element.offsetParent as HTMLElement;
      const parentRect = parent ? parent.getBoundingClientRect() : { left: 0, top: 0 };

      // Asegurar que el elemento tenga posición relativa o absoluta
      const computedStyle = window.getComputedStyle(element);
      if (computedStyle.position === 'static') {
        element.style.position = 'relative';
      }

      let finalWidth = startWidth;
      let finalHeight = startHeight;
      let finalLeft = startLeft;
      let finalTop = startTop;

      function onMouseMove(e: MouseEvent) {
        const deltaX = e.clientX - startX;
        const deltaY = e.clientY - startY;

        let newWidth = startWidth;
        let newHeight = startHeight;
        let newLeft = startLeft;
        let newTop = startTop;

        // Calcular nuevas dimensiones según la posición del handle
        if (position.includes('e')) {
          newWidth = Math.max(20, startWidth + deltaX);
        }
        if (position.includes('w')) {
          newWidth = Math.max(20, startWidth - deltaX);
          newLeft = startLeft + deltaX;
        }
        if (position.includes('s')) {
          newHeight = Math.max(20, startHeight + deltaY);
        }
        if (position.includes('n')) {
          newHeight = Math.max(20, startHeight - deltaY);
          newTop = startTop + deltaY;
        }

        // Guardar valores finales
        finalWidth = newWidth;
        finalHeight = newHeight;
        finalLeft = newLeft;
        finalTop = newTop;

        // Aplicar nuevos valores
        element.style.width = `${newWidth}px`;
        element.style.height = `${newHeight}px`;
        if (position.includes('w')) {
          element.style.left = `${newLeft}px`;
        }
        if (position.includes('n')) {
          element.style.top = `${newTop}px`;
        }
      }

      function onMouseUp() {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);

        // Notificar al editor sobre el cambio de tamaño solo cuando se suelta el mouse
        const componentId = element.getAttribute('data-component-id');
        if (componentId) {
          window.parent.postMessage({
            type: 'componentResized',
            component: {
              componentId: componentId,
              width: finalWidth,
              height: finalHeight,
              left: finalLeft,
              top: finalTop
            }
          }, '*');
        }
      }

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    }

    // Event delegation para mejor rendimiento
    function setupEventListeners() {
      // Remover listeners anteriores si existen
      document.body.removeEventListener('mouseover', handleMouseOver, true);
      document.body.removeEventListener('mouseout', handleMouseOut, true);
      document.body.removeEventListener('click', handleClick, true);

      // Agregar nuevos listeners
      document.body.addEventListener('mouseover', handleMouseOver, true);
      document.body.addEventListener('mouseout', handleMouseOut, true);
      document.body.addEventListener('click', handleClick, true);
    }

    function handleMouseOver(e: MouseEvent) {
      if (!selectionEnabled) return;

      const target = e.target as HTMLElement;
      if (!target || target.tagName === 'SCRIPT' || target.tagName === 'STYLE' || target.tagName === 'HTML' || target.tagName === 'HEAD') {
        return;
      }

      // Remover hover de todos los elementos
      document.querySelectorAll('.component-selector-hover').forEach(el => {
        el.classList.remove('component-selector-hover');
      });

      // Agregar hover al elemento actual
      target.classList.add('component-selector-hover');
    }

    function handleMouseOut(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (target) {
        target.classList.remove('component-selector-hover');
      }
    }

    // Store mapping of component IDs to DOM elements
    const componentIdMap = new Map < string, HTMLElement> ();
    // Track currently selected component ID
    let currentSelectedComponentId: string | null = null;

    function handleClick(e: MouseEvent) {
      let targetElement = e.target as HTMLElement;
      debugLog(`🖱️ Click detectado - selectionEnabled: ${selectionEnabled}`, {
        target: targetElement,
        tagName: targetElement?.tagName,
        className: targetElement?.className
      });

      if (!selectionEnabled) {
        debugLog(`❌ Selección desactivada, ignorando click`);
        return;
      }

      // Si el click fue en un SVG o dentro de un SVG, navegar hacia arriba
      // hasta encontrar el elemento padre que tenga data-component-id
      if (targetElement.tagName === 'SVG' || targetElement.tagName === 'PATH' || targetElement.tagName === 'CIRCLE' || targetElement.tagName === 'RECT' || targetElement.tagName === 'LINE' || targetElement.tagName === 'POLYLINE' || targetElement.tagName === 'POLYGON' || targetElement.tagName === 'G' || targetElement.closest('svg')) {
        const closestWithId = targetElement.closest('[data-component-id]') as HTMLElement | null;
        if (closestWithId) {
          targetElement = closestWithId;
          debugLog(`🔄 Click en SVG redirigido a padre con ID:`, { newTarget: targetElement.tagName, componentId: targetElement.getAttribute('data-component-id') });
        }
      }

      const target = targetElement;
      if (!target || target.tagName === 'SCRIPT' || target.tagName === 'STYLE' || target.classList.contains('resize-handle')) {
        debugLog(`❌ Elemento no válido para selección:`, { tagName: target.tagName, className: target.className });
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      // Remover selección anterior y sus handles
      document.querySelectorAll('.component-selector-selected').forEach(sel => {
        sel.classList.remove('component-selector-selected');
        sel.querySelectorAll('.resize-handle').forEach(handle => handle.remove());
      });

      // Agregar selección al elemento clickeado
      target.classList.add('component-selector-selected');

      // Agregar puntos de redimensionamiento
      addResizeHandles(target);

      // Obtener información del elemento
      const tagName = target.tagName.toLowerCase();
      const className = typeof target.className === 'string' ? target.className : '';
      const id = target.id || '';
      const text = target.innerText?.substring(0, 50) || '';

      // Helper function to check if element is a text element
      const isTextElement = (tag: string): boolean => {
        const textTags = ['p', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'label', 'button', 'a', 'li', 'td', 'th'];
        return textTags.includes(tag.toLowerCase());
      };

      // Helper function to create a text hash from content
      const createTextHash = (textContent: string): string => {
        if (!textContent || textContent.trim().length === 0) return '';
        // Take first 25 characters, clean and make it URL-safe
        const cleaned = textContent.trim().substring(0, 25)
          .replace(/[^a-zA-Z0-9\s]/g, '') // Remove special chars
          .replace(/\s+/g, '-') // Replace spaces with hyphens
          .toLowerCase();
        return cleaned.length > 0 ? `-${cleaned}` : '';
      };

      // Generate unique component ID using a more specific approach
      // Use existing data-component-id if present, otherwise generate a unique one
      let componentId = target.getAttribute('data-component-id');

      if (!componentId) {
        // Generate a truly unique ID based on element position and properties
        const path: string[] = [];
        let element: HTMLElement | null = target;
        while (element && element !== document.body) {
          const parent: HTMLElement | null = element.parentElement;
          if (parent) {
            const index = Array.from(parent.children).indexOf(element);
            path.unshift(`${element.tagName.toLowerCase()}:nth-child(${index + 1})`);
          }
          element = parent;
        }
        const pathString = path.join(' > ');

        // For text elements, include text content in the ID for better uniqueness
        const textHash = isTextElement(tagName) ? createTextHash(text) : '';

        // Generate stable ID based on element characteristics (not timestamp/random)
        if (id) {
          componentId = id + textHash;
        } else {
          const specificClass = getSpecificClass(className);
          if (specificClass) {
            const cleanClass = specificClass.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
            const pathHash = path.slice(-2).join('-').replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase();
            componentId = `${cleanClass}${pathHash ? '-' + pathHash : ''}${textHash}`;
          } else {
            const pathHash = path.slice(-2).join('-').replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase();
            componentId = `${tagName}${pathHash ? '-' + pathHash : ''}${textHash}`;
          }
        }

        // Clean up the component ID
        componentId = componentId.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase();
        // Remove multiple consecutive hyphens
        componentId = componentId.replace(/-+/g, '-');
        // Remove leading/trailing hyphens
        componentId = componentId.replace(/^-+|-+$/g, '');
        if (componentId.length > 100) {
          componentId = componentId.substring(0, 100);
        }

        // IMPORTANTE: Asegurar que el ID sea único
        // Si ya existe otro elemento con este ID (y no es el elemento actual), hacerlo único
        const existingElement = document.querySelector(`[data-component-id="${componentId}"]`) as HTMLElement;
        if (existingElement && existingElement !== target) {
          console.log(`[component-selector-helper] ⚠️ ID "${componentId}" ya existe en otro elemento, generando ID único...`);
          let uniqueId = componentId;
          let counter = 0;
          while (document.querySelector(`[data-component-id="${uniqueId}"]`)) {
            counter++;
            uniqueId = `${componentId}-${counter}`;
          }
          componentId = uniqueId;
          console.log(`[component-selector-helper] ✅ ID único generado: "${componentId}"`);
        }

        // Store path for better matching
        target.setAttribute('data-component-path', pathString);
      }

      // IMPORTANTE: Verificar que el elemento clickeado sea realmente el que estamos seleccionando
      // Remover cualquier selección anterior
      document.querySelectorAll('.component-selector-selected').forEach(el => {
        el.classList.remove('component-selector-selected');
      });

      // Agregar clase de selección al elemento clickeado
      target.classList.add('component-selector-selected');

      // Set data-component-id on the clicked element (only this specific element)
      target.setAttribute('data-component-id', componentId);
      componentIdMap.set(componentId, target);
      currentSelectedComponentId = componentId;

      console.log(`[component-selector-helper] ✅ Elemento seleccionado: id=${componentId} tag=${tagName} class=${className}`);

      // 🔍 DETECCIÓN DE IMÁGENES DE FONDO - Importante para PropertyEditor
      const computedStyle = window.getComputedStyle(target);
      const backgroundImage = computedStyle.backgroundImage;
      const hasBackgroundImage = backgroundImage && backgroundImage !== 'none' && backgroundImage !== 'initial';

      // 🔍 DETECCIÓN DE IMÁGENES EN ETIQUETAS <img> - Mejorado
      let hasImgTag = false;
      let imgSrc = null;
      let imgAlt = null;

      if (tagName === 'img') {
        hasImgTag = true;
        const imgElement = target as HTMLImageElement;
        imgSrc = imgElement.src;
        imgAlt = imgElement.alt;

        // 🔥 NUEVO: También verificar si tiene srcset o data-src
        if (!imgSrc && imgElement.getAttribute('data-src')) {
          imgSrc = imgElement.getAttribute('data-src');
        }
        if (!imgSrc && imgElement.srcset) {
          // Tomar la primera imagen del srcset
          const srcsetMatch = imgElement.srcset.split(',')[0].trim().split(' ')[0];
          if (srcsetMatch) {
            imgSrc = srcsetMatch;
          }
        }

        // Convertir URLs relativas a absolutas
        if (imgSrc && !imgSrc.startsWith('http') && !imgSrc.startsWith('data:')) {
          imgSrc = new URL(imgSrc, window.location.href).href;
        }

        console.log(`[component-selector-helper] 🖼️ Etiqueta <img> detectada:`, {
          src: imgSrc,
          alt: imgAlt,
          srcset: imgElement.srcset,
          dataSrc: imgElement.getAttribute('data-src')
        });
      }

      // Extraer URL de la imagen si existe (background-image) - Mejorado
      let imageUrl = null;
      if (hasBackgroundImage) {
        const urlMatch = backgroundImage.match(/url\(["']?(.+?)["']?\)/);
        if (urlMatch && urlMatch[1]) {
          imageUrl = urlMatch[1];

          // Convertir URLs relativas a absolutas
          if (imageUrl && !imageUrl.startsWith('http') && !imageUrl.startsWith('data:') && !imageUrl.startsWith('blob:')) {
            try {
              imageUrl = new URL(imageUrl, window.location.href).href;
            } catch (e) {
              console.warn(`[component-selector-helper] ⚠️ No se pudo convertir URL relativa a absoluta:`, imageUrl, e);
            }
          }

          console.log(`[component-selector-helper] 🖼️ Background-image detectado:`, {
            original: urlMatch[1],
            final: imageUrl,
            fullBackground: backgroundImage
          });
        }
      }

      // 🔥 NUEVO: Detectar imágenes hijas en elementos contenedores
      let hasChildImages = false;
      let childImageInfo = null;

      debugLog(`🔍 Buscando imágenes hijas en ${tagName}:`, {
        hasImgTag,
        hasBackgroundImage,
        elementHTML: target.outerHTML?.substring(0, 200)
      });

      if (!hasImgTag && !hasBackgroundImage) {
        // Buscar imágenes hijas directas
        const childImg = target.querySelector('img') as HTMLImageElement;
        debugLog(`🔍 Resultado de búsqueda de imagen hija:`, {
          found: !!childImg,
          childImg: childImg ? {
            src: childImg.src,
            alt: childImg.alt,
            tagName: childImg.tagName
          } : null,
          allChildren: Array.from(target.children).map(child => ({
            tagName: child.tagName,
            className: child.className,
            id: child.id
          }))
        });

        if (childImg) {
          hasChildImages = true;
          childImageInfo = {
            src: childImg.src,
            alt: childImg.alt,
            tagName: childImg.tagName.toLowerCase()
          };

          // Convertir URLs relativas a absolutas
          if (childImageInfo.src && !childImageInfo.src.startsWith('http') && !childImageInfo.src.startsWith('data:')) {
            try {
              childImageInfo.src = new URL(childImageInfo.src, window.location.href).href;
            } catch (e) {
              console.warn(`[component-selector-helper] ⚠️ No se pudo convertir URL de imagen hija:`, childImageInfo.src, e);
            }
          }

          debugLog(`🖼️ Imagen hija detectada en contenedor:`, childImageInfo);
        }
      }

      // 🔥 UNIFICAR: Usar imagen de <img> si no hay background-image, o imagen hija
      const finalImageUrl = imageUrl || imgSrc || (childImageInfo ? childImageInfo.src : null);
      const finalHasImage = hasBackgroundImage || hasImgTag || hasChildImages;

      debugLog(`🎯 RESULTADO FINAL de detección de imágenes:`, {
        finalHasImage,
        finalImageUrl,
        sources: {
          hasBackgroundImage,
          backgroundImage: backgroundImage?.substring(0, 100),
          hasImgTag,
          imgSrc: imgSrc?.substring(0, 100),
          hasChildImages,
          childImageInfo
        }
      });

      // Detectar otras propiedades de fondo relevantes
      const backgroundInfo = {
        hasImage: finalHasImage,
        imageUrl: finalImageUrl,
        backgroundImage: backgroundImage,
        backgroundColor: computedStyle.backgroundColor,
        backgroundSize: computedStyle.backgroundSize,
        backgroundPosition: computedStyle.backgroundPosition,
        backgroundRepeat: computedStyle.backgroundRepeat,
        backgroundOpacity: computedStyle.opacity,
        // 🔥 NUEVO: Información específica para etiquetas <img>
        isImgTag: hasImgTag,
        imgSrc: imgSrc,
        imgAlt: imgAlt,
        // 🔥 NUEVO: Información de imágenes hijas
        hasChildImages: hasChildImages,
        childImageInfo: childImageInfo,
        tag: tagName,
        // 🔥 ESPECIFICACIÓN DE IMAGEN ACTUAL: Guardar la imagen actual del componente
        currentImage: finalImageUrl
      };

      // Detectar iconos SVG de lucide-react en el componente seleccionado
      let iconInfo = null;
      const svgElement = target.querySelector('svg');
      if (svgElement) {
        const svgClasses = svgElement.getAttribute('class') || '';
        const lucideMatch = svgClasses.match(/lucide-([a-z0-9-]+)/);
        if (lucideMatch) {
          const iconName = lucideMatch[1].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
          const svgStyle = window.getComputedStyle(svgElement);
          iconInfo = {
            hasIcon: true,
            name: iconName,
            size: parseInt(svgElement.getAttribute('width') || svgElement.getAttribute('height') || '20', 10),
            color: svgStyle.color || svgStyle.stroke || '#000000',
            strokeWidth: parseInt(svgElement.getAttribute('stroke-width') || '2', 10),
          };
          console.log(`[component-selector-helper] 🎨 Icono detectado:`, iconInfo);
        }
      }

      console.log(`[component-selector-helper] 🖼️ Detección de fondo:`, backgroundInfo);

      // Enviar mensaje al padre (editor) con información adicional para validación
      window.parent.postMessage({
        type: 'componentSelected',
        component: {
          tag: tagName,
          className: className,
          id: id,
          text: text,
          componentId: componentId,
          path: target.getAttribute('data-component-path') || '',
          // Agregar información adicional para validación
          elementIndex: Array.from(target.parentElement?.children || []).indexOf(target),
          timestamp: Date.now(),
          // 🔥 NUEVO: Enviar información de fondo para PropertyEditor
          background: backgroundInfo,
          // 🔥 NUEVO: Enviar información de icono si está disponible
          icon: iconInfo
        }
      }, '*');
    }

    // Function to apply component ID to element
    function applyComponentId(element: HTMLElement, componentId: string) {
      element.setAttribute('data-component-id', componentId);
      componentIdMap.set(componentId, element);
    }

    // Función auxiliar para extraer clase y path de un componentId
    function parseComponentId(componentId: string): { classPart: string; pathPart: string } {
      const idWithoutComponent = componentId.replace(/^component-/, '');

      // El path comienza cuando encontramos el patrón "-{tag}-nth-child-"
      const nthChildMatch = idWithoutComponent.match(/-([a-z]+)-nth-child-/);
      let classPart = '';
      let pathPart = '';

      if (nthChildMatch) {
        // Encontrar dónde comienza el path (antes del primer tag-nth-child)
        const pathStartIndex = idWithoutComponent.indexOf(nthChildMatch[0]);
        classPart = idWithoutComponent.substring(0, pathStartIndex);
        pathPart = idWithoutComponent.substring(pathStartIndex + 1); // +1 para quitar el guión inicial
      } else {
        // Si no hay path, todo es la clase (o es un ID simple)
        classPart = idWithoutComponent;
      }

      return { classPart, pathPart };
    }

    // Función auxiliar para generar el pathHash de un elemento (igual que en handleClick)
    function generatePathHash(element: HTMLElement): string {
      const path: string[] = [];
      let currentElement: HTMLElement | null = element;
      while (currentElement && currentElement !== document.body) {
        const parent: HTMLElement | null = currentElement.parentElement;
        if (parent) {
          const index = Array.from(parent.children).indexOf(currentElement);
          path.unshift(`${currentElement.tagName.toLowerCase()}:nth-child(${index + 1})`);
        }
        currentElement = parent;
      }
      return path.slice(-2).join('-').replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase();
    }

    // Función helper para obtener el path SVG de un icono de lucide-react
    // Esta es una versión simplificada - en producción necesitarías los paths reales de lucide-react
    function getIconPath(iconName: string): string {
      // Mapa simplificado de algunos iconos comunes de lucide-react
      const iconPaths: Record<string, string> = {
        home: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M9 22V12h6v10',
        user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
        settings: 'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z M9 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
        heart: 'M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z',
        star: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z',
        search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M21 21l-4.35-4.35',
        mail: 'M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z M22 6l-10 7L2 6',
        phone: 'M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z',
        calendar: 'M19 3h-1V1h-2v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11z M7 10h5v5H7z',
        camera: 'M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z M14 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
        edit: 'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7 M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z',
        trash: 'M3 6h18 M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2',
        plus: 'M12 5v14m7-7H5',
        minus: 'M5 12h14',
        checkIcon: 'M20 6L9 17l-5-5',
        x: 'M18 6L6 18M6 6l12 12',
        zap: 'M13 2L3 14h9l-1 8 10-12h-9l1-8z',
        refreshCw: 'M23 4v6h-6M1 20v-6h6 M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15',
        move: 'M5 9l-3-3 3-3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3-3-3-3M12 19l3-3-3-3M12 5l3-3-3-3M1 12h22M12 1v22',
        rotateCcw: 'M1 4v6h6M3.51 15a9 9 0 1 0 2.13-9.36L1 10',
        save: 'M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z M17 21v-8H7v8 M7 3v5h8',
        paintbrush: 'M9.06 15.54A2 2 0 0 1 8 17.25v3.27a1 1 0 0 1-.7.96 9 9 0 0 1-5.3 0 1 1 0 0 1-.7-.96v-3.27a2 2 0 0 1 .53-1.37l5.83-6.54a2 2 0 0 1 2.77 0l5.83 6.54a2 2 0 0 1 .53 1.37v3.27a1 1 0 0 1-.7.96 9 9 0 0 1-5.3 0 1 1 0 0 1-.7-.96v-3.27a2 2 0 0 1-.53-1.37z',
        ruler: 'M21.3 8.7l-5.6-5.6a1 1 0 0 0-1.4 0l-9.6 9.6a1 1 0 0 0 0 1.4l5.6 5.6a1 1 0 0 0 1.4 0l9.6-9.6a1 1 0 0 0 0-1.4z M7.5 10.5l2 2 M13.5 7.5l2 2 M10.5 13.5l2 2 M16.5 10.5l2 2',
        image: 'M21 19V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2z M8.5 13.5l2.5 3.01L14.5 12l4.5 6H5z',
        // Iconos adicionales
        activity: 'M22 12h-4l-3 9L9 3l-3 9H2',
        alertCircle: 'M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z M12 8v4 M12 16h.01',
        archive: 'M21 8v13H3V8 M1 3h22v5H1z M10 12h4',
        arrowDown: 'M12 5v14M19 12l-7 7-7-7',
        arrowLeft: 'M19 12H5M12 19l-7-7 7-7',
        arrowRight: 'M5 12h14M12 5l7 7-7 7',
        arrowUp: 'M12 19V5M5 12l7-7 7 7',
        atSign: 'M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94 M12 12h.01',
        award: 'M12 15l-3-3 3-3 3 3-3 3z M4.5 12.5l3-3 3 3-3 3-3-3z',
        bell: 'M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9 M13.73 21a2 2 0 0 1-3.46 0',
        bookmark: 'M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z',
        check: 'M20 6L9 17l-5-5',
        chevronDown: 'M6 9l6 6 6-6',
        chevronLeft: 'M15 18l-6-6 6-6',
        chevronRight: 'M9 18l6-6-6-6',
        chevronUp: 'M18 15l-6-6-6 6',
        circle: 'M12 12m-10 0a10 10 0 1 0 20 0a10 10 0 1 0 -20 0',
        clipboard: 'M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2 M15 2H9a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1z',
        clock: 'M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z M12 6v6l4 2',
        cloud: 'M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z',
        code: 'M16 18l6-6-6-6M8 6l-6 6 6 6',
        command: 'M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3z M3 21a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3 3 3 0 0 1-3 3H6a3 3 0 0 1-3-3z',
        creditCard: 'M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 0 0 3-3V8a3 3 0 0 0-3-3H6a3 3 0 0 0-3 3v8a3 3 0 0 0 3 3z',
        database: 'M12 8c-1.657 0-3-.895-3-2s1.343-2 3-2 3 .895 3 2-1.343 2-3 2z M12 14c-1.657 0-3-.895-3-2s1.343-2 3-2 3 .895 3 2-1.343 2-3 2z M12 20c-1.657 0-3-.895-3-2s1.343-2 3-2 3 .895 3 2-1.343 2-3 2z M6 8h12M6 14h12M6 20h12',
        disc: 'M12 12m-10 0a10 10 0 1 0 20 0a10 10 0 1 0 -20 0 M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0',
        download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M7 10l5 5 5-5 M12 15V3',
        externalLink: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6 M15 3h6v6 M10 14L21 3',
        facebook: 'M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z',
        file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M16 13H8 M16 17H8 M10 9H8',
        filter: 'M22 3H2l8 9.46V19l4 2v-8.54L22 3z',
        flag: 'M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z M4 22v-7',
        folder: 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z',
        gift: 'M20 7h-4a2 2 0 0 0-2 2v1a2 2 0 0 0 2 2h4v1h-4a2 2 0 0 0-2 2v1a2 2 0 0 0 2 2h4 M12 8v13 M15 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 1 0 0-5z M9 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 1 0 0-5z',
        github: 'M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22',
        globe: 'M21 12a9 9 0 0 1-9 9m9-9a9 9 0 0 0-9-9m9 9H3m9 9a9 9 0 0 1-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 0 1 9-9',
        grid: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
        hardDrive: 'M22 12H2M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z M6 16h.01 M10 16h.01',
        hash: 'M4 8h16M4 16h16M10 3L8 21M16 3l-2 18',
        headphones: 'M3 18v-6a9 9 0 0 1 18 0v6 M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3z M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z',
        inbox: 'M22 12h-6l-2 3h-4l-2-3H2 M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z',
        info: 'M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z M12 16v-4 M12 8h.01',
        instagram: 'M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z M17.5 6.5h.01',
        key: 'M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4',
        layers: 'M12 2L2 7l10 5 10-5-10-5z M2 17l10 5 10-5M2 12l10 5 10-5',
        lifeBuoy: 'M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M4.93 4.93l4.24 4.24M14.83 14.83l4.24 4.24M4.93 19.07l4.24-4.24M14.83 9.17l4.24-4.24',
        link: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71 M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
        linkedin: 'M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z M2 9h4v12H2z M4 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
        list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
        lock: 'M18 11h-1a4 4 0 0 0-4 4v5a4 4 0 0 0 4 4h1a4 4 0 0 0 4-4v-5a4 4 0 0 0-4-4z M7 11V7a5 5 0 0 1 10 0v4',
        logIn: 'M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4 M10 17l5-5-5-5 M15 12H3',
        logOut: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4 M16 17l5-5-5-5 M21 12H9',
        map: 'M1 6v16l7-4 8 4 7-4V2l-7 4-8-4-7 4z M8 2v16M16 6v16',
        menu: 'M3 12h18M3 6h18M3 18h18',
        messageCircle: 'M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z',
        messageSquare: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
        mic: 'M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z M19 10v2a7 7 0 0 1-14 0v-2 M12 19v4 M8 23h8',
        monitor: 'M5 3h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z M12 17v4 M8 21h8',
        moon: 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z',
        moreHorizontal: 'M12 12h.01M19 12h.01M5 12h.01',
        moreVertical: 'M12 12h.01M12 19h.01M12 5h.01',
        mousePointer: 'M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z M13 13l6 6',
        music: 'M9 18V5l12-2v13 M6 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6z M18 13a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
        navigation: 'M3 11l19-9-9 19-2-8-8-2z',
        package: 'M12.89 1.45l8 4A2 2 0 0 1 22 7.24v9.53a2 2 0 0 1-1.11 1.79l-8 4a2 2 0 0 1-1.78 0l-8-4a2 2 0 0 1-1.1-1.8V7.24a2 2 0 0 1 1.11-1.81l8-4a2 2 0 0 1 1.78 0z M2.32 6.16L12 11l9.68-4.84 M12 22.76V11',
        paperclip: 'M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48',
        pause: 'M6 4h4v16H6z M14 4h4v16h-4z',
        penTool: 'M12 19l7-7 3 3-7 7-3-3z M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z M2 2l7.586 7.586 M13 11l7 7',
        play: 'M5 3l14 9-14 9V3z',
        power: 'M18.36 6.64a9 9 0 1 1-12.73 0 M12 2v10',
        printer: 'M6 9V2h12v7 M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2 M6 14h12v8H6z',
        qrCode: 'M3 3h8v8H3z M13 3h8v8h-8z M3 13h8v8H3z M16 13h3 M16 16h3 M19 13v3 M19 16v3',
        repeat: 'M17 1l4 4-4 4 M21 5H11a4 4 0 0 0-4 4v14 M7 23l-4-4 4-4 M3 19h10a4 4 0 0 0 4-4V1',
        rss: 'M4 11a9 9 0 0 1 9 9 M4 4a16 16 0 0 1 16 16 M5 20.01h.01',
        scissors: 'M6 9a3 3 0 0 1 3-3h5a3 3 0 0 1 3 3v.01M6 9a3 3 0 0 0 3 3h5a3 3 0 0 0 3-3v.01 M6 20l4.01-4.01M10 14l-4.01 4.01',
        send: 'M22 2L11 13 M22 2l-7 20-4-9-9-4 20-7z',
        share: 'M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8 M16 6l-4-4-4 4 M12 2v13',
        shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
        shoppingBag: 'M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z M3 6h18 M16 10a4 4 0 0 1-8 0',
        shoppingCart: 'M9 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M19 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6',
        sun: 'M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41',
        tag: 'M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z M7 7h.01',
        target: 'M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41 M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z',
        terminal: 'M4 7l6 6-6 6 M12 19h8',
        thumbsDown: 'M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17',
        thumbsUp: 'M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3',
        toggleLeft: 'M16 5H9a4 4 0 0 0 0 8h7 M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
        toggleRight: 'M16 5H9a4 4 0 0 0 0 8h7 M15 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
        trendingDown: 'M23 18l-9.5-9.5-5 5L1 6 M17 18h6v-6',
        trendingUp: 'M23 6l-9.5 9.5-5-5L1 18 M17 6h6v6',
        truck: 'M1 3h15v13H1z M16 8h4l3 3v5h-7V8z M5 18a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M15 18a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
        tv: 'M21 3H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h5l-1 4h2l-1-4h8c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z',
        twitter: 'M23 3a10.9 10.9 0 0 1-3.14 1.53 4.48 4.48 0 0 0-7.86 3v1A10.66 10.66 0 0 1 3 4s-4 9 5 13a11.64 11.64 0 0 1-7 2c9 5 20 0 20-11.5a4.5 4.5 0 0 0-.08-.83A7.72 7.72 0 0 0 23 3z',
        umbrella: 'M23 12a11.05 11.05 0 0 0-22 0zm-5 7a3 3 0 0 1-6 0v-7',
        unlock: 'M7 11V7a5 5 0 0 1 9.9-1 M12 11h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z',
        upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M17 8l-5-5-5 5 M12 3v12',
        users: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M23 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75',
        video: 'M23 7l-7 5 7 5V7z M14 5H3a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2z',
        voicemail: 'M5.5 12a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0z M12 12h.01 M19 12h.01',
        volume1: 'M11 5L6 9H2v6h4l5 4V5z M15.54 8.46a5 5 0 0 1 0 7.07',
        volume2: 'M11 5L6 9H2v6h4l5 4V5z M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07',
        volumeX: 'M11 5L6 9H2v6h4l5 4V5z M23 9l-6 6M17 9l6 6',
        wallet: 'M21 12V7H5a2 2 0 0 1 2-2h12v4 M3 5v14a2 2 0 0 0 2 2h16v-5 M18 12a2 2 0 0 0 0 4',
        watch: 'M12 18h.01 M8 21h8a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2z',
        wifi: 'M5 12.55a11 11 0 0 1 5.17-2.39 M1.42 9a16 16 0 0 1 21.16 0 M8.53 16.11a6 6 0 0 1 6.95 0 M12 20h.01',
        youtube: 'M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.42a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19c1.72.42 8.6.42 8.6.42s6.88 0 8.6-.42a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.33z M9.75 15.02V8.98l6.22 3.02-6.22 3.02z',
        zoomIn: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M21 21l-4.35-4.35 M11 8v6 M8 11h6',
        zoomOut: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M21 21l-4.35-4.35 M8 11h6',
      };

      // Si tenemos el path del icono, usarlo; si no, usar un icono genérico (círculo)
      return iconPaths[iconName] || 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z';
    }

    // Función para cargar e inyectar un icono SVG
    function loadAndInjectIcon(container: HTMLElement, iconName: string, size: number, color: string) {
      try {
        // Verificar si ya hay un SVG en el contenedor - si existe, actualizarlo en lugar de recrearlo
        const existingSvg = container.querySelector('svg');
        if (existingSvg) {
          // Actualizar el SVG existente con nuevo tamaño y color
          existingSvg.setAttribute('width', String(size));
          existingSvg.setAttribute('height', String(size));
          existingSvg.setAttribute('stroke', color);
          const existingPath = existingSvg.querySelector('path');
          if (existingPath) {
            existingPath.setAttribute('stroke', color);
            // Si el nombre del icono cambió, actualizar el path
            const currentPathData = getIconPath(iconName);
            const currentPath = existingPath.getAttribute('d');
            if (currentPath !== currentPathData) {
              existingPath.setAttribute('d', currentPathData);
              console.log(`[component-selector-helper] Updated icon path from "${currentPath?.substring(0, 20)}..." to "${currentPathData.substring(0, 20)}..."`);
            }
          }
          // Icon updated successfully
          return;
        }

        // Si no hay SVG existente, crear uno nuevo
        // Limpiar el contenedor primero
        container.innerHTML = '';

        // Crear un elemento SVG
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', String(size));
        svg.setAttribute('height', String(size));
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', color);
        svg.setAttribute('stroke-width', '2');
        svg.setAttribute('stroke-linecap', 'round');
        svg.setAttribute('stroke-linejoin', 'round');
        svg.style.display = 'inline-block';
        svg.style.verticalAlign = 'middle';
        svg.style.flexShrink = '0';

        // Obtener el path del icono
        const pathData = getIconPath(iconName);

        // Crear el elemento path
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', pathData);
        path.setAttribute('stroke', color);
        svg.appendChild(path);

        // Agregar el SVG al contenedor
        container.appendChild(svg);

        // Icon injected successfully
      } catch (error) {
        console.error(`[component-selector-helper] Error loading icon ${iconName}:`, error);
        // Si hay error, mostrar un icono placeholder
        container.innerHTML = `<span style="color: ${color}; font-size: ${size}px; display: inline-block;">●</span>`;
      }
    }

    // Función para aplicar estilos CSS - aplicar a TODOS los componentes
    function applyComponentStyles(css: string, targetComponentId?: string) {
      // Remover estilos anteriores
      const existingStyle = document.getElementById('zeus-component-styles');
      if (existingStyle) {
        existingStyle.remove();
      }

      // Extraer todos los componentIds del CSS para aplicar IDs primero
      const componentIdMatches = css.matchAll(/\[data-component-id="([^"]+)"\]/g);
      const componentIdsInCSS = Array.from(componentIdMatches, m => m[1]);

      // PRIMERO: Aplicar los IDs a los elementos antes de aplicar los estilos
      componentIdsInCSS.forEach(componentId => {
        let element = document.querySelector(`[data-component-id="${componentId}"]`) as HTMLElement;

        if (!element) {
          // Intentar encontrar el elemento basándose en el ID
          let foundElement: HTMLElement | null = null;

          // Extraer clase y path del ID
          const { classPart, pathPart } = parseComponentId(componentId);

          if (classPart) {
            // Intentar encontrar por clase
            const classSelectors = [
              `.${classPart}`,
              `[class*="${classPart}"]`,
              `[class*="${classPart.replace(/-/g, '')}"]`
            ];

            // Buscar todos los elementos con esa clase
            const candidates: HTMLElement[] = [];
            for (const selector of classSelectors) {
              try {
                const found = document.querySelectorAll(selector);
                found.forEach((el) => {
                  const htmlEl = el as HTMLElement;
                  if (!htmlEl.hasAttribute('data-component-id')) {
                    candidates.push(htmlEl);
                  }
                });
              } catch (e) {
                // Ignorar errores de selector
              }
            }

            // Si hay candidatos, verificar el path para encontrar el correcto
            if (candidates.length > 0 && pathPart) {
              // Reconstruir el path esperado del ID (normalizar)
              const pathFromId = pathPart.replace(/--+/g, '-').replace(/^-|-$/g, '').toLowerCase();

              // Para cada candidato, verificar si el path coincide
              for (const candidate of candidates) {
                // Generar pathHash igual que en handleClick
                const candidatePath = generatePathHash(candidate);

                // Normalizar ambos paths para comparar
                const normalizedCandidatePath = candidatePath.replace(/--+/g, '-').replace(/^-|-$/g, '');
                const normalizedPathFromId = pathFromId.replace(/--+/g, '-').replace(/^-|-$/g, '');

                // Si el path coincide (o si solo hay un candidato), usar este elemento
                if (candidates.length === 1 ||
                  normalizedCandidatePath === normalizedPathFromId ||
                  normalizedPathFromId.includes(normalizedCandidatePath) ||
                  normalizedCandidatePath.includes(normalizedPathFromId)) {
                  foundElement = candidate;
                  break;
                }
              }

              // Si no se encontró por path pero hay candidatos, usar el primero sin ID
              if (!foundElement && candidates.length > 0) {
                foundElement = candidates.find(c => !c.hasAttribute('data-component-id')) || candidates[0];
              }
            } else if (candidates.length > 0 && !pathPart) {
              // Si no hay path pero hay candidatos, usar el primero sin ID
              foundElement = candidates.find(c => !c.hasAttribute('data-component-id')) || candidates[0];
            }
          }

          // Si se encontró un elemento, aplicar el ID
          if (foundElement) {
            applyComponentId(foundElement, componentId);
            console.log(`[component-selector-helper] ✅ ID "${componentId}" aplicado automáticamente a elemento encontrado por clase "${classPart}"`);
          }
        }
      });

      // SEGUNDO: Aplicar los estilos CSS después de que los IDs estén aplicados
      // Usar un pequeño delay para asegurar que los IDs se hayan aplicado
      setTimeout(() => {
        // Crear y agregar nuevo estilo (el CSS contiene estilos para TODOS los componentes)
        const style = document.createElement('style');
        style.id = 'zeus-component-styles';
        style.textContent = css;
        document.head.appendChild(style);

        console.log('[component-selector-helper] Component styles applied via postMessage', {
          cssLength: css.length,
          componentIdsInCSS: componentIdsInCSS,
          cssPreview: css.substring(0, 300)
        });

        // Verificar que el estilo se aplicó correctamente
        const appliedStyle = document.getElementById('zeus-component-styles');
        if (appliedStyle) {
          console.log('[component-selector-helper] Style element found in DOM, length:', appliedStyle.textContent.length);

          // Verificar que los elementos tienen los estilos aplicados
          componentIdsInCSS.forEach(componentId => {
            const element = document.querySelector(`[data-component-id="${componentId}"]`) as HTMLElement;
            if (element) {
              const computedStyle = window.getComputedStyle(element);
              console.log(`[component-selector-helper] ✅ Element "${componentId}" found, computed background:`, computedStyle.backgroundColor, computedStyle.background);
            } else {
              console.warn(`[component-selector-helper] ⚠️ Element with componentId "${componentId}" not found after applying styles`);
            }
          });
        } else {
          console.error('[component-selector-helper] Style element NOT found in DOM!');
        }
      }, 10);
    }

    // Escuchar mensajes del editor
    const handleMessage = (event: MessageEvent) => {
      // DEBUG: Log todos los mensajes que llegan
      console.log('[component-selector-helper] 📨 Mensaje recibido:', {
        type: event.data?.type,
        // Solo loggear datos seguros para evitar errores de cross-origin
        data: (() => {
          try {
            return typeof event.data === 'object' ? { ...event.data } : event.data;
          } catch (_e) {
            return '[unserializable]';
          }
        })(),
        isIframe: window.self !== window.top,
        origin: event.origin
      });

      // Aceptar mensajes de cualquier origen (puedes restringir esto si es necesario)
      if (event.data && event.data.type === 'enableSelection') {
        setSelectionMode(true);
        setupEventListeners();

        // Notificar que el script está listo
        window.parent.postMessage({
          type: 'selectionReady'
        }, '*');
      } else if (event.data && event.data.type === 'disableSelection') {
        setSelectionMode(false);
      } else if (event.data && event.data.type === 'applyComponentStyles') {
        // PRIMERO: Apply component IDs if provided - aplicar a todos los elementos correspondientes
        // Esto debe hacerse ANTES de aplicar el CSS para que los selectores funcionen
        if (event.data.componentProperties) {
          Object.keys(event.data.componentProperties).forEach((componentId) => {
            // Buscar elemento por data-component-id (ya aplicado previamente)
            let element: HTMLElement | null = document.querySelector(`[data-component-id="${componentId}"]`) as HTMLElement;

            // Si no se encuentra, intentar buscar por otros selectores (fallback)
            if (!element && event.data.componentProperties[componentId]) {
              const props = event.data.componentProperties[componentId];

              // PRIMERO: Intentar usar la lógica mejorada de parseComponentId para IDs con formato {class}-{path}
              const { classPart, pathPart } = parseComponentId(componentId);

              if (classPart) {
                // Buscar por clase
                const classSelectors = [
                  `.${classPart}`,
                  `[class*="${classPart}"]`,
                  `[class*="${classPart.replace(/-/g, '')}"]`
                ];

                const candidates: HTMLElement[] = [];
                for (const selector of classSelectors) {
                  try {
                    const found = document.querySelectorAll(selector);
                    found.forEach((el) => {
                      const htmlEl = el as HTMLElement;
                      if (!htmlEl.hasAttribute('data-component-id')) {
                        candidates.push(htmlEl);
                      }
                    });
                  } catch (e) {
                    // Ignorar errores de selector
                  }
                }

                // Si hay candidatos, verificar el path para encontrar el correcto
                if (candidates.length > 0 && pathPart) {
                  const pathFromId = pathPart.replace(/--+/g, '-').replace(/^-|-$/g, '').toLowerCase();

                  for (const candidate of candidates) {
                    const candidatePath = generatePathHash(candidate);
                    const normalizedCandidatePath = candidatePath.replace(/--+/g, '-').replace(/^-|-$/g, '');
                    const normalizedPathFromId = pathFromId.replace(/--+/g, '-').replace(/^-|-$/g, '');

                    if (candidates.length === 1 ||
                      normalizedCandidatePath === normalizedPathFromId ||
                      normalizedPathFromId.includes(normalizedCandidatePath) ||
                      normalizedCandidatePath.includes(normalizedPathFromId)) {
                      element = candidate;
                      break;
                    }
                  }

                  // Si no se encontró por path pero hay candidatos, usar el primero SIN ID (nunca forzar)
                  if (!element && candidates.length > 0) {
                    element = candidates.find(c => !c.hasAttribute('data-component-id')) || null;
                  }
                } else if (candidates.length > 0 && !pathPart) {
                  // Si no hay path pero hay candidatos, usar el primero sin ID
                  element = candidates.find(c => !c.hasAttribute('data-component-id')) || null;
                }
              }

              // SEGUNDO: Si aún no se encontró, intentar encontrar por el ID del componente (si está en el nombre del componente)
              // Los IDs de componentes suelen tener el formato "component-xxx" o "page-xxx"
              if (!element && (componentId.startsWith('component-') || componentId.startsWith('page-'))) {
                // Extraer el nombre del componente del ID
                const componentName = componentId.replace(/^(component-|page-)/, '');

                // Buscar por ID del elemento que coincida con el nombre del componente
                const possibleIds = [
                  componentName,
                  componentId,
                  componentName.replace(/-/g, ''),
                  componentName.replace(/-/g, '_'),
                  `#${componentName}`,
                  `#${componentId}`
                ];

                for (const possibleId of possibleIds) {
                  // Remover # si está presente para getElementById
                  const idToTry = possibleId.replace(/^#/, '');
                  element = document.getElementById(idToTry) as HTMLElement;
                  if (element) {
                    console.log(`[component-selector-helper] Found element by ID "${idToTry}" for componentId "${componentId}"`);
                    break;
                  }
                }

                // Si no se encuentra por ID, buscar por clase que contenga el nombre
                if (!element) {
                  const classSelectors = [
                    `.${componentName}`,
                    `[class*="${componentName}"]`,
                    `[class*="${componentId}"]`,
                    `[class*="${componentName.replace(/-/g, '')}"]`
                  ];

                  for (const selector of classSelectors) {
                    try {
                      const found = document.querySelector(selector) as HTMLElement;
                      if (found) {
                        element = found;
                        console.log(`[component-selector-helper] Found element by class selector "${selector}" for componentId "${componentId}"`);
                        break;
                      }
                    } catch (e) {
                      // Ignorar errores de selector inválido
                    }
                  }
                }
              }

              // TERCERO: Fallback: intentar encontrar por propiedades del componente
              if (!element && props.id) {
                element = document.getElementById(props.id) as HTMLElement;
                if (element) {
                  console.log(`[component-selector-helper] Found element by props.id "${props.id}" for componentId "${componentId}"`);
                }
              }
              if (!element && props.className) {
                const classes = props.className.split(' ').filter((c: string) => c && c.trim());
                for (const cls of classes) {
                  try {
                    const found = document.querySelector(`.${cls}`) as HTMLElement;
                    if (found) {
                      element = found;
                      console.log(`[component-selector-helper] Found element by props.className "${cls}" for componentId "${componentId}"`);
                      break;
                    }
                  } catch (e) {
                    // Ignorar errores
                  }
                }
              }
            }

            // Si se encuentra el elemento, aplicar el component ID
            if (element) {
              applyComponentId(element, componentId);
              console.log(`[component-selector-helper] Applied componentId "${componentId}" to element:`, element.tagName, element.className || element.id || 'no-id');
            } else {
              // Solo mostrar warning si realmente no se encontró (no es crítico si el elemento no existe)
              console.warn(`[component-selector-helper] Could not find element for componentId: ${componentId}. CSS will still be generated but may not apply.`);
            }
          });
        }

        // SEGUNDO: Aplicar estilos CSS recibidos del editor - para TODOS los componentes
        // Esto se hace DESPUÉS de asignar los data-component-id para que los selectores funcionen
        // Usar setTimeout para asegurar que los data-component-id se hayan aplicado primero
        if (event.data.css) {
          console.log('[component-selector-helper] Received CSS:', event.data.css.substring(0, 500)); // Log primeros 500 caracteres
          // Aplicar estilos inmediatamente - applyComponentStyles ya aplica los IDs primero
          applyComponentStyles(event.data.css);

          // 🔥 NUEVO: Forzar actualización de background-image para evitar caché
          setTimeout(() => {
            if (event.data.componentProperties) {
              Object.entries(event.data.componentProperties).forEach(([componentId, props]) => {
                const typedProps = props as any;
                if (typedProps?.background?.image) {
                  // Usar selector simple (consistente con el CSS generado)
                  let element = document.querySelector('[data-component-id="' + componentId + '"]') as HTMLElement;

                  if (element) {
                    console.log('[component-selector-helper] 🔄 Forzando actualización de background-image:', componentId);
                    console.log('[component-selector-helper] 🎯 Elemento encontrado con selector:', element.tagName, element.className);
                    console.log('[component-selector-helper] 🏷️ data-component-id del elemento:', element.getAttribute('data-component-id'));

                    // 🔥 NUEVO: Manejar diferentes tipos de elementos
                    if (element.tagName.toLowerCase() === 'img') {
                      // Para etiquetas <img>, actualizar el atributo src
                      console.log('[component-selector-helper] 🖼️ Elemento es IMG, actualizando src');
                      const imgElement = element as HTMLImageElement;
                      const currentSrc = imgElement.src;
                      console.log('[component-selector-helper] 📸 Src actual:', currentSrc);

                      // Forzar actualización del src para evitar caché
                      const newImageUrl = typedProps.background.image;
                      if (newImageUrl && newImageUrl.includes('localhost:8741')) {
                        // Agregar timestamp para forzar actualización de caché
                        const timestampedUrl = newImageUrl.includes('?')
                          ? newImageUrl + '&_t=' + Date.now()
                          : newImageUrl + '?_t=' + Date.now();
                        imgElement.src = timestampedUrl;
                        console.log('[component-selector-helper] ✅ Src actualizado con timestamp:', timestampedUrl);
                      } else {
                        imgElement.src = newImageUrl;
                        console.log('[component-selector-helper] ✅ Src actualizado:', newImageUrl);
                      }
                    } else {
                      // Para otros elementos (div, etc.), actualizar background-image
                      console.log('[component-selector-helper] 🎨 Elemento no es IMG, actualizando background-image');
                      const currentBg = element.style.backgroundImage;
                      console.log('[component-selector-helper] 📸 Background-image actual:', currentBg);
                      element.style.backgroundImage = 'none';
                      // Forzar un reflow
                      element.offsetHeight; // Trigger reflow

                      // Método 2: Agregar timestamp a la URL para evitar caché
                      setTimeout(() => {
                        const newImageUrl = typedProps.background.image;
                        if (newImageUrl && newImageUrl.includes('localhost:8741')) {
                          // Agregar timestamp para forzar actualización de caché
                          const timestampedUrl = newImageUrl.includes('?')
                            ? newImageUrl + '&_t=' + Date.now()
                            : newImageUrl + '?_t=' + Date.now();
                          element.style.backgroundImage = `url(${timestampedUrl})`;
                          console.log('[component-selector-helper] ✅ Background-image actualizado con timestamp:', timestampedUrl);
                        } else {
                          element.style.backgroundImage = currentBg;
                          console.log('[component-selector-helper] ✅ Background-image restaurado:', currentBg);
                        }
                      }, 10);
                    }
                  }
                }
              });
            }
          }, 100);
        }

        // TERCERO: Aplicar actualizaciones de texto si hay en componentProperties
        // SOLO en el editor (iframe), no fuera del editor
        if (event.data.componentProperties && window.self !== window.top) {
          const textUpdates: Array<{ componentId: string, textContent: string }> = [];
          const imgUpdates: Array<{ componentId: string, src: string }> = [];

          Object.entries(event.data.componentProperties).forEach(([componentId, props]) => {
            const typedProps = props as any; // Cast a any para acceder a las propiedades
            if (typedProps?.typography?.textContent) {
              console.log('[component-selector-helper] 📝 Procesando textContent para', componentId, ':', typedProps.typography.textContent);
              textUpdates.push({
                componentId,
                textContent: typedProps.typography.textContent
              });
            }
            // 🔥 NUEVO: Manejar actualizaciones de img.src
            if (typedProps?.img?.src !== undefined) {
              console.log('[component-selector-helper] 🖼️ Procesando img.src para', componentId, ':', typedProps.img.src);
              imgUpdates.push({
                componentId,
                src: typedProps.img.src
              });
            }
          });

          // Aplicar actualizaciones de imagen (solo en el editor)
          if (imgUpdates.length > 0) {
            console.log('[component-selector-helper] 🖼️ Aplicando', imgUpdates.length, 'actualizaciones de imagen (solo en editor)');
            imgUpdates.forEach(function (update: { componentId: string; src: string }) {
              const element = document.querySelector('[data-component-id="' + update.componentId + '"]');
              if (element && element.tagName.toLowerCase() === 'img') {
                const imgElement = element as HTMLImageElement;
                if (update.src === '') {
                  console.log('[component-selector-helper] 🗑️ Vacíando src de imagen:', update.componentId);
                  imgElement.removeAttribute('src');
                  imgElement.style.display = 'none'; // Ocultar temporalmente mientras no hay src
                } else {
                  console.log('[component-selector-helper] ✅ Actualizando src de imagen:', update.componentId, 'con:', update.src);
                  imgElement.src = update.src;
                  imgElement.style.display = ''; // Mostrar la imagen
                }
              } else {
                console.warn('[component-selector-helper] ❌ Elemento img no encontrado para actualización de src:', update.componentId);
              }
            });
          }

          // Aplicar actualizaciones de texto (solo en el editor)
          if (textUpdates.length > 0) {
            console.log('[component-selector-helper] 📝 Aplicando', textUpdates.length, 'actualizaciones de texto (solo en editor)');
            textUpdates.forEach(function (update: { componentId: string; textContent: string }) {
              const element = document.querySelector('[data-component-id="' + update.componentId + '"]');
              if (element) {
                if ((element as HTMLInputElement).tagName.toLowerCase() === 'input' || (element as HTMLInputElement).tagName.toLowerCase() === 'textarea') {
                  (element as HTMLInputElement).value = update.textContent;
                  console.log('[component-selector-helper] ✅ Input/textarea actualizado:', update.componentId);
                } else {
                  (element as HTMLElement).innerText = update.textContent;
                  console.log('[component-selector-helper] ✅ Elemento actualizado:', update.componentId, 'con texto:', update.textContent);
                }
              } else {
                console.warn('[component-selector-helper] ❌ Elemento no encontrado para actualización de texto:', update.componentId);
              }
            });
          }
        } else if (event.data.componentProperties && window.self === window.top) {
          console.log('[component-selector-helper] 📝 Fuera del editor: omitiendo actualizaciones de texto, CSS con ::before se encarga');
        }
      } else if (event.data && event.data.type === 'updateTextContents' && Array.isArray(event.data.updates)) {
        // SOLO procesar mensajes updateTextContents en el editor (iframe)
        if (window.self !== window.top) {
          console.log('[component-selector-helper] 📨 Recibido mensaje updateTextContents (solo en editor):', event.data.updates);

          event.data.updates.forEach(function (update: { componentId: string; textContent: string }) {
            console.log('[component-selector-helper] 🔍 Procesando actualización:', update);
            const element = document.querySelector('[data-component-id="' + update.componentId + '"]');
            console.log('[component-selector-helper] 🎯 Elemento encontrado:', !!element, 'para ID:', update.componentId);

            if (element) {
              if ((element as HTMLInputElement).tagName.toLowerCase() === 'input' || (element as HTMLInputElement).tagName.toLowerCase() === 'textarea') {
                (element as HTMLInputElement).value = update.textContent;
                console.log('[component-selector-helper] ✅ Input/textarea actualizado:', update.componentId, 'con valor:', update.textContent);
              } else {
                const oldText = (element as HTMLElement).innerText;
                (element as HTMLElement).innerText = update.textContent;
                console.log('[component-selector-helper] ✅ Elemento actualizado:', {
                  componentId: update.componentId,
                  oldText: oldText,
                  newText: update.textContent,
                  tagName: element.tagName,
                  element: element
                });
              }
            } else {
              console.warn('[component-selector-helper] ❌ Elemento no encontrado para actualización de texto:', update.componentId);

              // Debug: mostrar todos los elementos con data-component-id
              const allElements = document.querySelectorAll('[data-component-id]');
              console.log('[component-selector-helper] 📋 Todos los elementos con data-component-id:', Array.from(allElements).map(el => ({
                id: el.getAttribute('data-component-id'),
                tag: el.tagName,
                text: (el as HTMLElement).innerText?.substring(0, 50)
              })));
            }
          });
        } else {
          console.log('[component-selector-helper] 📝 Fuera del editor: omitiendo updateTextContents, CSS con ::before se encarga');
        }
      } else if (event.data && event.data.type === 'deleteComponentFromDOM' && event.data.componentId) {
        // Handler para eliminar componentes del DOM
        console.log('[component-selector-helper] 🗑️ Recibido mensaje deleteComponentFromDOM:', event.data.componentId);

        const componentId = event.data.componentId;
        const element = document.querySelector(`[data-component-id="${componentId}"]`) as HTMLElement;

        if (element) {
          console.log('[component-selector-helper] ✅ Elemento encontrado, eliminando...', {
            tagName: element.tagName,
            className: element.className,
            text: element.innerText?.substring(0, 50)
          });

          // Eliminar el elemento del DOM
          element.remove();

          console.log('[component-selector-helper] ✅ Elemento eliminado exitosamente');

          // Enviar confirmación al editor
          window.parent.postMessage({
            type: 'componentDeleted',
            componentId: componentId,
            success: true
          }, '*');

        } else {
          console.warn('[component-selector-helper] ❌ Elemento no encontrado para eliminar:', componentId);

          // Enviar error al editor
          window.parent.postMessage({
            type: 'componentDeleted',
            componentId: componentId,
            success: false,
            error: 'Element not found'
          }, '*');
        }
      } else if (event.data && event.data.type === 'applyComponentIcons') {
        // Crear un hash del mensaje para evitar procesar el mismo mensaje múltiples veces
        const messageHash = JSON.stringify(event.data.iconProperties);

        // Si ya estamos procesando este mensaje o ya lo procesamos, ignorar
        if (processedIconMessages.has(messageHash) || iconProcessingTimeout !== null) {
          return;
        }

        // Marcar el mensaje como procesado
        processedIconMessages.add(messageHash);

        // Limpiar mensajes antiguos después de 2 segundos
        setTimeout(() => {
          processedIconMessages.delete(messageHash);
        }, 2000);

        // Aplicar iconos a los componentes con debounce para evitar múltiples aplicaciones
        const iconProperties = event.data.iconProperties || {};

        // Cancelar cualquier procesamiento anterior
        if (iconProcessingTimeout) {
          clearTimeout(iconProcessingTimeout);
        }

        // Procesar los iconos con un pequeño delay
        iconProcessingTimeout = setTimeout(() => {
          Object.entries(iconProperties).forEach(([componentId, props]: [string, any]) => {
            if (!props || !props.icon || !props.icon.name) {
              return;
            }

            // Buscar el elemento - usar la misma lógica que para aplicar estilos
            let element = document.querySelector(`[data-component-id="${componentId}"]`) as HTMLElement;

            // Si no se encuentra directamente, intentar buscar por clase/path
            if (!element) {
              const { classPart, pathPart } = parseComponentId(componentId);
              if (classPart) {
                const classSelectors = [`.${classPart}`, `[class*="${classPart}"]`];
                for (const selector of classSelectors) {
                  try {
                    const candidates = document.querySelectorAll(selector);
                    for (const candidate of Array.from(candidates)) {
                      const candidateEl = candidate as HTMLElement;
                      if (!candidateEl.hasAttribute('data-component-id')) {
                        const candidatePath = generatePathHash(candidateEl);
                        const normalizedPath = pathPart.replace(/--+/g, '-').replace(/^-|-$/g, '').toLowerCase();
                        const normalizedCandidatePath = candidatePath.replace(/--+/g, '-').replace(/^-|-$/g, '');
                        if (normalizedCandidatePath === normalizedPath || normalizedPath.includes(normalizedCandidatePath)) {
                          element = candidateEl;
                          applyComponentId(element, componentId);
                          break;
                        }
                      }
                    }
                    if (element) break;
                  } catch (e) {
                    // Ignorar errores
                  }
                }
              }
            }

            if (!element) {
              return;
            }

            // Verificar si el icono ya está aplicado correctamente
            const iconName = props.icon.name || 'home';
            const iconSize = props.icon.size || 20;
            const iconColor = props.icon.color || '#000000';

            // Buscar SVG original de lucide-react (no inyectado)
            const originalSvg = element.querySelector('svg:not([data-zeus-injected])') as SVGElement | null;
            const existingInjected = element.querySelector('.zeus-injected-icon') as HTMLElement | null;

            // Detectar si solo cambia color/tamaño o también el nombre del icono
            const originalIconName = originalSvg?.getAttribute('class')?.match(/lucide-([a-z0-9-]+)/)?.[1]
              ?.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
            const isSameIcon = originalIconName === iconName;

            if (originalSvg && isSameIcon) {
              // Solo cambia color o tamaño - modificar SVG existente
              console.log(`[component-selector-helper] 🎨 Actualizando SVG existente: ${iconName}, size: ${iconSize}, color: ${iconColor}`);
              originalSvg.setAttribute('width', String(iconSize));
              originalSvg.setAttribute('height', String(iconSize));
              originalSvg.setAttribute('stroke', iconColor);
              originalSvg.style.color = iconColor;
              // Actualizar también el path stroke
              const paths = originalSvg.querySelectorAll('path, circle, line, polyline, polygon, rect');
              paths.forEach(p => {
                p.setAttribute('stroke', iconColor);
              });
              // Ocultar cualquier icono inyectado previo
              if (existingInjected) {
                existingInjected.style.display = 'none';
              }
              return;
            }

            // Si cambia el nombre del icono o no hay SVG original, usar inyección
            // Solo eliminar iconos inyectados previos, NO los SVGs originales de React
            if (existingInjected) {
              existingInjected.remove();
            }

            // Ocultar todos los SVGs originales si existen
            const allOriginalSvgs = element.querySelectorAll('svg:not([data-zeus-injected])');
            allOriginalSvgs.forEach(svg => {
              (svg as HTMLElement).style.display = 'none';
            });

            // Crear contenedor para el icono inyectado
            const iconContainer = document.createElement('span');
            iconContainer.className = 'zeus-injected-icon';
            iconContainer.style.display = 'inline-flex';
            iconContainer.style.alignItems = 'center';
            iconContainer.style.justifyContent = 'center';
            iconContainer.style.verticalAlign = 'middle';
            iconContainer.style.marginRight = '6px';
            iconContainer.style.flexShrink = '0';
            iconContainer.setAttribute('data-icon-name', iconName);

            // Insertar el icono al inicio del elemento
            if (element.firstChild) {
              element.insertBefore(iconContainer, element.firstChild);
            } else {
              element.appendChild(iconContainer);
            }

            // Cargar e inyectar el SVG del icono inmediatamente
            loadAndInjectIcon(iconContainer, iconName, iconSize, iconColor);
          });

          iconProcessingTimeout = null;
        }, 100);
      } else if (event.data && event.data.type === 'setComponentId') {
        // Set component ID for a specific element - prefer the currently selected element
        const selectedElement = document.querySelector('.component-selector-selected') as HTMLElement;

        if (event.data.componentId) {
          // Si el selector es un data-component-id directo, usarlo primero
          if (event.data.selector && event.data.selector.startsWith('[data-component-id=')) {
            const element = document.querySelector(event.data.selector) as HTMLElement;
            if (element) {
              // Verificar que el ID coincida
              const currentId = element.getAttribute('data-component-id');
              if (currentId !== event.data.componentId) {
                applyComponentId(element, event.data.componentId);
                console.log(`[component-selector-helper] Updated componentId from "${currentId}" to "${event.data.componentId}"`);
              }
              currentSelectedComponentId = event.data.componentId;
              return;
            }
          }

          // If there's a selected element, use it (most accurate)
          if (selectedElement) {
            const currentId = selectedElement.getAttribute('data-component-id');
            if (currentId !== event.data.componentId) {
              applyComponentId(selectedElement, event.data.componentId);
              console.log(`[component-selector-helper] Applied componentId "${event.data.componentId}" to selected element (was: "${currentId}")`);
            }
            currentSelectedComponentId = event.data.componentId;
          } else if (event.data.selector) {
            // Fallback to selector if no element is selected
            const element = document.querySelector(event.data.selector) as HTMLElement;
            if (element) {
              const currentId = element.getAttribute('data-component-id');
              if (currentId !== event.data.componentId) {
                applyComponentId(element, event.data.componentId);
                console.log(`[component-selector-helper] Applied componentId "${event.data.componentId}" via selector (was: "${currentId}")`);
              }
              currentSelectedComponentId = event.data.componentId;
            } else {
              console.warn(`[component-selector-helper] Could not find element with selector: ${event.data.selector}`);
            }
          }
        }
      } else if (event.data && event.data.type === 'ensureComponentId') {
        // Asegurar que un componente tiene un data-component-id cuando se detecta una modificación
        const requestedComponentId = event.data.componentId;

        if (!requestedComponentId) {
          console.warn('[component-selector-helper] ensureComponentId: No se proporcionó componentId');
          return;
        }

        // IMPORTANTE: Buscar el elemento seleccionado actualmente (el que se está modificando)
        // Este es el elemento que el usuario acaba de hacer clic
        const selectedElement = document.querySelector('.component-selector-selected') as HTMLElement;

        if (!selectedElement) {
          console.warn(`[component-selector-helper] ensureComponentId: No se encontró elemento seleccionado para ${requestedComponentId}`);
          return;
        }

        // Verificar si el elemento ya tiene un ID
        const currentId = selectedElement.getAttribute('data-component-id');

        // Si el elemento ya tiene un ID y es diferente al solicitado, usar el ID existente
        // Esto evita cambiar IDs de elementos que ya tienen uno asignado
        if (currentId && currentId !== requestedComponentId) {
          console.log(`[component-selector-helper] ⚠️ El elemento ya tiene un ID diferente: "${currentId}" (solicitado: "${requestedComponentId}"). Usando el ID existente.`);

          // Notificar al padre con el ID existente
          window.parent.postMessage({
            type: 'componentIdEnsured',
            requestedId: requestedComponentId,
            generatedId: currentId
          }, '*');
          return;
        }

        // Si el elemento ya tiene el ID correcto, no hacer nada
        if (currentId === requestedComponentId) {
          console.log(`[component-selector-helper] ✅ El elemento ya tiene el ID correcto: ${requestedComponentId}`);

          // Notificar al padre que el ID ya existe
          window.parent.postMessage({
            type: 'componentIdEnsured',
            requestedId: requestedComponentId,
            generatedId: requestedComponentId
          }, '*');
          return;
        }

        // Si el elemento no tiene ID, generar uno estable basado en características del elemento
        // Generar un ID estable basado en características del elemento
        const tagName = selectedElement.tagName.toLowerCase();
        const id = selectedElement.id || '';
        const className = typeof selectedElement.className === 'string' ? selectedElement.className : '';
        const text = selectedElement.innerText?.substring(0, 50) || '';

        // Helper function to check if element is a text element
        const isTextElement = (tag: string): boolean => {
          const textTags = ['p', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'label', 'button', 'a', 'li', 'td', 'th'];
          return textTags.includes(tag.toLowerCase());
        };

        // Helper function to create a text hash from content
        const createTextHash = (textContent: string): string => {
          if (!textContent || textContent.trim().length === 0) return '';
          // Take first 25 characters, clean and make it URL-safe
          const cleaned = textContent.trim().substring(0, 25)
            .replace(/[^a-zA-Z0-9\s]/g, '') // Remove special chars
            .replace(/\s+/g, '-') // Replace spaces with hyphens
            .toLowerCase();
          return cleaned.length > 0 ? `-${cleaned}` : '';
        };

        // Crear path para estabilidad
        const path: string[] = [];
        let element: HTMLElement | null = selectedElement;
        while (element && element !== document.body) {
          const parent: HTMLElement | null = element.parentElement;
          if (parent) {
            const index = Array.from(parent.children).indexOf(element);
            path.unshift(`${element.tagName.toLowerCase()}:nth-child(${index + 1})`);
          }
          element = parent;
        }

        // For text elements, include text content in the ID for better uniqueness
        const textHash = isTextElement(tagName) ? createTextHash(text) : '';

        // Generar ID estable (igual que en handleClick)
        let stableComponentId = '';
        if (id) {
          stableComponentId = id + textHash;
        } else {
          const specificClass = getSpecificClass(className);
          if (specificClass) {
            const cleanClass = specificClass.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
            const pathHash = path.slice(-2).join('-').replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase();
            stableComponentId = `${cleanClass}${pathHash ? '-' + pathHash : ''}${textHash}`;
          } else {
            const pathHash = path.slice(-2).join('-').replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase();
            stableComponentId = `${tagName}${pathHash ? '-' + pathHash : ''}${textHash}`;
          }
        }

        // Limpiar y limitar longitud
        stableComponentId = stableComponentId.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase();
        // Remove multiple consecutive hyphens
        stableComponentId = stableComponentId.replace(/-+/g, '-');
        // Remove leading/trailing hyphens
        stableComponentId = stableComponentId.replace(/^-+|-+$/g, '');
        if (stableComponentId.length > 100) {
          stableComponentId = stableComponentId.substring(0, 100);
        }

        // Asegurar unicidad - verificar que no exista otro elemento con este ID
        let uniqueId = stableComponentId;
        let counter = 0;
        const existingElement = document.querySelector(`[data-component-id="${uniqueId}"]`) as HTMLElement;
        // Solo cambiar el ID si existe otro elemento diferente con ese ID
        if (existingElement && existingElement !== selectedElement) {
          console.log(`[component-selector-helper] ⚠️ ID "${uniqueId}" ya existe en otro elemento, generando ID único...`);
          while (document.querySelector(`[data-component-id="${uniqueId}"]`) && uniqueId !== requestedComponentId) {
            counter++;
            uniqueId = `${stableComponentId}-${counter}`;
          }
        }

        // Aplicar el ID al elemento seleccionado (el que el usuario acaba de hacer clic)
        applyComponentId(selectedElement, uniqueId);
        console.log(`[component-selector-helper] ✅ ID generado automáticamente para elemento seleccionado: ${uniqueId}`, {
          tag: tagName,
          className: className,
          path: path.slice(-2).join(' > '),
          element: selectedElement
        });

        // Actualizar el currentSelectedComponentId
        currentSelectedComponentId = uniqueId;

        // Notificar al padre con el ID generado (este es el ID real del elemento seleccionado)
        window.parent.postMessage({
          type: 'componentIdEnsured',
          requestedId: requestedComponentId,
          generatedId: uniqueId,
          elementInfo: {
            tag: tagName,
            className: className,
            text: selectedElement.innerText?.substring(0, 50) || ''
          }
        }, '*');
      } else if (event.data && event.data.type === 'generateComponentIds') {
        // Debounce check to prevent rapid repeated calls
        const currentTime = Date.now();
        if (currentTime - lastGenerationTime < GENERATION_COOLDOWN) {
          console.log(`[component-selector-helper] ⏱️ Cooldown active, skipping ID generation (${GENERATION_COOLDOWN}ms cooldown)`);
          return;
        }
        lastGenerationTime = currentTime;

        // PROTECCIÓN ADICIONAL: Verificar que estamos en un iframe antes de generar IDs
        if (window.self === window.top) {
          console.error('[component-selector-helper] ERROR: Intento de generar IDs fuera de un iframe. Operación cancelada.');
          return; // No generar IDs si no estamos en un iframe
        }

        // Verificar que NO estamos en la ventana del editor
        // El editor puede tener identificadores específicos en el DOM
        const isEditorWindow = document.body?.classList.contains('zeus-editor') ||
          document.getElementById('zeus-studio-root') ||
          document.querySelector('[data-zeus-editor]') ||
          (window.location.href.includes('zeus') && window.self === window.top);

        if (isEditorWindow) {
          console.error('[component-selector-helper] ERROR: Intento de generar IDs en la ventana del editor. Operación cancelada.');
          return;
        }

        // Verificar que tenemos acceso a window.parent (confirmación de que estamos en iframe)
        try {
          if (!window.parent || window.parent === window) {
            console.error('[component-selector-helper] ERROR: No hay ventana padre (no estamos en iframe). Operación cancelada.');
            return;
          }
        } catch (e) {
          // Si hay error de CORS al acceder a window.parent, es normal en algunos casos
          // pero aún así verificamos window.self !== window.top arriba
        }

        // Generate data-component-id for all elements in the page
        console.log('[component-selector-helper] Generating component IDs for all elements in iframe...');
        console.log('[component-selector-helper] Document ready state:', document.readyState);
        console.log('[component-selector-helper] Body exists:', !!document.body);
        console.log('[component-selector-helper] Body children count:', document.body?.children.length || 0);

        // Wait a bit if DOM is not ready
        if (document.readyState === 'loading') {
          console.log('[component-selector-helper] DOM is still loading, waiting...');
          document.addEventListener('DOMContentLoaded', () => {
            // Retry after DOM is loaded
            setTimeout(() => {
              window.parent.postMessage({ type: 'generateComponentIds' }, '*');
            }, 100);
          });
          return;
        }

        // IMPORTANTE: Obtener los IDs existentes desde componentProperties si están disponibles
        // Esto permite respetar los IDs que ya existen en lugar de generar nuevos
        const existingComponentIds: string[] = [];
        if (event.data && event.data.componentProperties) {
          existingComponentIds.push(...Object.keys(event.data.componentProperties));
          console.log('[component-selector-helper] 🔍 IDs existentes detectados desde componentProperties:', existingComponentIds.length);
        }

        // También buscar IDs existentes en el CSS inyectado
        const styleElement = document.getElementById('zeus-component-styles');
        if (styleElement && styleElement.textContent) {
          const cssContent = styleElement.textContent;
          const cssIdMatches = cssContent.matchAll(/\[data-component-id="([^"]+)"\]/g);
          const cssIds = Array.from(cssIdMatches, m => m[1]);
          cssIds.forEach(id => {
            if (!existingComponentIds.includes(id)) {
              existingComponentIds.push(id);
            }
          });
          console.log('[component-selector-helper] 🔍 IDs encontrados en CSS:', cssIds.length);
        }

        console.log('[component-selector-helper] 📊 Total de IDs existentes a respetar:', existingComponentIds.length);

        let generatedCount = 0;
        let skippedExcludedTags = 0;
        let skippedAlreadyHasId = 0;
        let skippedExcludedSelectors = 0;
        let reusedExistingId = 0;
        const excludedTags = ['SCRIPT', 'STYLE', 'HTML', 'HEAD', 'BODY', 'META', 'LINK', 'TITLE', 'NOSCRIPT'];
        const excludedSelectors = ['.resize-handle', '.component-selector-hover', '.component-selector-selected'];

        // Get only meaningful elements - exclude SVG elements and their children
        const allElements = document.querySelectorAll('div, span, p, h1, h2, h3, h4, h5, h6, button, input, img, section, article, aside, main, header, footer, nav, ul, ol, li, form, label, textarea, select, option, table, tr, td, th, thead, tbody, tfoot, a, strong, em, code, pre, blockquote, hr, br, iframe, canvas, video, audio, source, track, details, summary, dialog, menu, menuitem, figure, figcaption, time, data, mark, ruby, rt, rp, bdi, bdo, sub, sup, small, var, samp, kbd, abbr, address, cite, dfn, q, s, u, del, ins');
        console.log(`[component-selector-helper] Total meaningful elements found: ${allElements.length}`);

        // Limit processing to prevent performance issues
        const maxElementsToProcess = 500;
        const elementsToProcess = Array.from(allElements).slice(0, maxElementsToProcess);
        if (allElements.length > maxElementsToProcess) {
          console.log(`[component-selector-helper] ⚠️ Limiting processing to first ${maxElementsToProcess} elements out of ${allElements.length} for performance`);
        }

        // Also check body children specifically (reduced logging)
        if (document.body) {
          const bodyChildren = Array.from(document.body.children);
          console.log(`[component-selector-helper] Body direct children: ${bodyChildren.length}`);
        }

        elementsToProcess.forEach((element) => {
          const el = element as HTMLElement;

          // Skip excluded tags
          if (excludedTags.includes(el.tagName)) {
            skippedExcludedTags++;
            return;
          }

          // Skip if already has data-component-id - RESPETAR IDs EXISTENTES
          if (el.hasAttribute('data-component-id')) {
            const existingId = el.getAttribute('data-component-id');
            // Si el ID existe en componentProperties, mantenerlo
            if (existingId && existingComponentIds.includes(existingId)) {
              console.log(`[component-selector-helper] ✅ Respetando ID existente: ${existingId}`);
              reusedExistingId++;
            }
            skippedAlreadyHasId++;
            return;
          }

          // Skip excluded selectors
          let shouldSkip = false;
          for (const selector of excludedSelectors) {
            try {
              if (el.matches && el.matches(selector)) {
                shouldSkip = true;
                break;
              }
            } catch (e) {
              // Ignore selector errors
            }
          }
          if (shouldSkip) {
            skippedExcludedSelectors++;
            return;
          }

          // ANTES de generar un nuevo ID, verificar si hay un ID existente que pueda coincidir con este elemento
          // Esto permite reutilizar IDs existentes en lugar de crear nuevos
          let componentIdToUse: string | null = null;

          // Intentar encontrar un ID existente que coincida con este elemento
          // Buscar por características del elemento (tag, class, id, path)
          const tagName = el.tagName.toLowerCase();
          const id = el.id || '';
          const className = typeof el.className === 'string'
            ? el.className
            : (('baseVal' in el.className && (el.className as { baseVal?: string }).baseVal) || el.getAttribute('class') || '');
          const specificClass = getSpecificClass(className);

          // Crear path para comparación
          const path: string[] = [];
          let currentElement: HTMLElement | null = el;
          while (currentElement && currentElement !== document.body && currentElement !== document.documentElement) {
            const parent: HTMLElement | null = currentElement.parentElement;
            if (parent) {
              const index = Array.from(parent.children).indexOf(currentElement);
              path.unshift(`${currentElement.tagName.toLowerCase()}:nth-child(${index + 1})`);
            }
            currentElement = parent;
          }
          const pathHash = path.slice(-3).join('-').replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase();

          // Buscar un ID existente que coincida con este elemento
          for (const existingId of existingComponentIds) {
            // Verificar si el ID existente coincide con este elemento
            // Extraer características del ID existente
            const { classPart, pathPart } = parseComponentId(existingId);

            // Verificar coincidencia por ID HTML
            if (id && existingId.includes(id)) {
              componentIdToUse = existingId;
              console.log(`[component-selector-helper] ✅ Reutilizando ID existente "${existingId}" por ID HTML: ${id}`);
              break;
            }

            // Verificar coincidencia por clase específica
            if (specificClass && classPart && (existingId.includes(specificClass) || classPart.includes(specificClass.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()))) {
              // Verificar también el path si está disponible
              if (pathPart && pathHash && (pathPart.includes(pathHash) || pathHash.includes(pathPart))) {
                componentIdToUse = existingId;
                console.log(`[component-selector-helper] ✅ Reutilizando ID existente "${existingId}" por clase y path: ${specificClass}`);
                break;
              } else if (!pathPart) {
                // Si no hay path en el ID existente, usar el ID si la clase coincide
                componentIdToUse = existingId;
                console.log(`[component-selector-helper] ✅ Reutilizando ID existente "${existingId}" por clase: ${specificClass}`);
                break;
              }
            }

            // Verificar coincidencia por tag y path
            if (!specificClass && tagName && existingId.includes(tagName)) {
              if (pathPart && pathHash && (pathPart.includes(pathHash) || pathHash.includes(pathPart))) {
                componentIdToUse = existingId;
                console.log(`[component-selector-helper] ✅ Reutilizando ID existente "${existingId}" por tag y path: ${tagName}`);
                break;
              }
            }
          }

          // Si no se encontró un ID existente, generar uno nuevo
          if (!componentIdToUse) {
            // Generate a unique component ID
            let componentId = '';

            // Priority 1: Use HTML id attribute if available
            if (id) {
              componentId = `component-${id}`;
            }
            // Priority 2: Use specific class name + path for stability
            else if (specificClass) {
              const cleanClass = specificClass.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
              // Use path hash for stability instead of timestamp
              componentId = `component-${cleanClass}${pathHash ? '-' + pathHash : ''}`;
            }
            // Priority 3: Use tag name + path
            else {
              componentId = `component-${tagName}${pathHash ? '-' + pathHash : ''}`;
            }

            // Clean up the component ID (remove invalid characters, limit length)
            componentId = componentId.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase();
            // Limit length to avoid issues
            if (componentId.length > 100) {
              componentId = componentId.substring(0, 100);
            }

            // Ensure uniqueness by checking if it already exists
            let uniqueId = componentId;
            let counter = 0;
            while (document.querySelector(`[data-component-id="${uniqueId}"]`) || existingComponentIds.includes(uniqueId)) {
              counter++;
              uniqueId = `${componentId}-${counter}`;
            }

            componentIdToUse = uniqueId;
            if (generatedCount <= 10) { // Only log first 10 generations
              console.log(`[component-selector-helper] 🆕 Generando nuevo ID: ${componentIdToUse}`);
            }
          } else {
            reusedExistingId++;
          }

          // Apply the component ID
          applyComponentId(el, componentIdToUse);
          generatedCount++;
        });

        // Collect information about generated IDs for reporting
        const generatedIdsInfo: Array<{ id: string, tag: string, selector: string }> = [];
        if (generatedCount > 0) {
          // Get a sample of generated IDs (first 10)
          const elementsWithIds = document.querySelectorAll('[data-component-id]');
          let sampleCount = 0;
          elementsWithIds.forEach((el) => {
            if (sampleCount < 10) {
              const element = el as HTMLElement;
              const componentId = element.getAttribute('data-component-id');
              if (componentId) {
                // Check if this ID was just generated (not in the original count)
                const tag = element.tagName.toLowerCase();
                const id = element.id || '';
                const className = typeof element.className === 'string' ? element.className : '';
                const selector = id ? `#${id}` : (className ? `.${className.split(' ')[0]}` : tag);
                generatedIdsInfo.push({
                  id: componentId,
                  tag: tag,
                  selector: selector
                });
                sampleCount++;
              }
            }
          });
        }

        console.log(`[component-selector-helper] Generated ${generatedCount} component IDs`);
        console.log(`[component-selector-helper] Reused ${reusedExistingId} existing IDs`);
        console.log(`[component-selector-helper] Skipped: ${skippedExcludedTags} excluded tags, ${skippedAlreadyHasId} already have ID, ${skippedExcludedSelectors} excluded selectors`);

        if (generatedIdsInfo.length > 0) {
          console.log('[component-selector-helper] Sample of generated IDs:', generatedIdsInfo);
        }

        // Create a summary of all IDs for export
        const allIds: Array<{ id: string, tag: string, selector: string, html: string }> = [];
        document.querySelectorAll('[data-component-id]').forEach((el) => {
          const element = el as HTMLElement;
          const componentId = element.getAttribute('data-component-id');
          if (componentId) {
            const tag = element.tagName.toLowerCase();
            const id = element.id || '';
            const className = typeof element.className === 'string' ? element.className : '';
            const selector = id ? `#${id}` : (className ? `.${className.split(' ')[0]}` : tag);
            const html = element.outerHTML.substring(0, 100); // First 100 chars
            allIds.push({
              id: componentId,
              tag: tag,
              selector: selector,
              html: html
            });
          }
        });

        // Notify parent about completion with detailed info
        window.parent.postMessage({
          type: 'componentIdsGenerated',
          count: generatedCount,
          reused: reusedExistingId,
          skipped: {
            excludedTags: skippedExcludedTags,
            alreadyHasId: skippedAlreadyHasId,
            excludedSelectors: skippedExcludedSelectors
          },
          sample: generatedIdsInfo,
          total: allIds.length,
          allIds: allIds // Send all IDs for potential export
        }, '*');
      } else if (event.data && event.data.type === 'regenerateComponentId') {
        // 🔥 NUEVO: Manejador para regenerar data-id de componentes específicos
        // Esto se usa cuando un componente tiene propiedades pero perdió su data-id
        const { componentId, properties } = event.data;

        console.log(`[component-selector-helper] 🔄 Regenerando data-id para componente: ${componentId}`, properties);

        try {
          // Buscar elementos que puedan corresponder a este componente
          // Basándonos en las propiedades guardadas
          let targetElement: HTMLElement | null = null;

          if (properties) {
            // Estrategia 1: Buscar por características visuales de las propiedades
            const background = properties.background;
            const typography = properties.typography;
            const size = properties.size;

            // Buscar elementos con características similares
            const allElements = Array.from(document.querySelectorAll('*')) as HTMLElement[];

            // Filtrar elementos candidatos
            const candidates = allElements.filter(el => {
              if (el.hasAttribute('data-component-id')) return false; // Ya tiene ID
              if (['SCRIPT', 'STYLE', 'HTML', 'HEAD', 'META', 'LINK'].includes(el.tagName)) return false;

              // Si hay información de background, buscar elementos con ese background
              if (background && background.image) {
                const computedStyle = window.getComputedStyle(el);
                if (computedStyle.backgroundImage.includes(background.image)) {
                  return true;
                }
              }

              // Si hay información de tipografía, buscar elementos con texto similar
              if (typography && typography.textContent) {
                const elementText = el.textContent?.trim().toLowerCase() || '';
                const searchText = typography.textContent.toLowerCase();
                if (elementText.includes(searchText) || searchText.includes(elementText)) {
                  return true;
                }
              }

              // Si hay información de tamaño, comparar dimensiones
              if (size && (size.width || size.height)) {
                const rect = el.getBoundingClientRect();
                if (size.width && rect.width.toString().includes(size.width.toString().replace('px', ''))) {
                  return true;
                }
                if (size.height && rect.height.toString().includes(size.height.toString().replace('px', ''))) {
                  return true;
                }
              }

              return false;
            });

            console.log(`[component-selector-helper] 🔍 Candidatos encontrados para ${componentId}:`, candidates.length);

            if (candidates.length > 0) {
              // Usar el primer candidato encontrado
              targetElement = candidates[0];
              console.log(`[component-selector-helper] ✅ Candidato seleccionado:`, {
                tag: targetElement.tagName,
                className: targetElement.className,
                id: targetElement.id
              });
            }
          }

          // Estrategia 2: Si no se encontró por propiedades, buscar por estructura del DOM
          if (!targetElement) {
            // Extraer información del ID para reconstruir la ruta
            const idParts = componentId.replace('component-', '').split('-');
            if (idParts.length >= 2) {
              const className = idParts[0];
              const tagName = idParts[1];

              // Buscar elementos con esa clase y tag
              const selector = `.${className}`;
              const elements = Array.from(document.querySelectorAll(selector)) as HTMLElement[];

              // Filtrar por tag si está disponible
              const filteredElements = elements.filter(el =>
                el.tagName.toLowerCase() === tagName &&
                !el.hasAttribute('data-component-id')
              );

              if (filteredElements.length > 0) {
                targetElement = filteredElements[0];
                console.log(`[component-selector-helper] ✅ Elemento encontrado por clase/tag: ${className}.${tagName}`);
              }
            }
          }

          // Si encontramos un elemento, aplicarle el data-id
          if (targetElement) {
            targetElement.setAttribute('data-component-id', componentId);
            console.log(`[component-selector-helper] ✅ Data-id regenerado: ${componentId}`);

            // Notificar éxito al editor
            window.parent.postMessage({
              type: 'componentIdRegenerated',
              componentId: componentId,
              success: true,
              element: {
                tag: targetElement.tagName,
                className: targetElement.className,
                id: targetElement.id
              }
            }, '*');
          } else {
            console.warn(`[component-selector-helper] ❌ No se pudo encontrar elemento para regenerar ID: ${componentId}`);

            // Notificar fallo al editor
            window.parent.postMessage({
              type: 'componentIdRegenerated',
              componentId: componentId,
              success: false,
              error: 'Element not found'
            }, '*');
          }
        } catch (error) {
          console.error(`[component-selector-helper] Error al regenerar data-id para ${componentId}:`, error);

          // Notificar error al editor
          window.parent.postMessage({
            type: 'componentIdRegenerated',
            componentId: componentId,
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          }, '*');
        }
      } else if (event.data && event.data.type === 'requestValidComponentIds') {
        // Handle request to validate component IDs
        const requestedIds: string[] = event.data.componentIds || [];
        const validComponentIds: string[] = [];

        requestedIds.forEach(id => {
          const element = document.querySelector(`[data-component-id="${id}"]`);
          if (element) {
            validComponentIds.push(id);
          }
        });

        window.parent.postMessage({
          type: 'cleanedComponentPropertiesResponse',
          messageId: event.data.messageId,
          validComponentIds: validComponentIds
        }, '*');

        console.log(`[component-selector-helper] Responded to requestValidComponentIds. Found ${validComponentIds.length} valid IDs out of ${requestedIds.length} requested.`);
      } else if (event.data && event.data.type === 'updateComponentProperties') {
        const { componentId, properties } = event.data;
        if (!componentId || !properties?.icon?.name) {
          return;
        }

        // Buscar el elemento por data-component-id
        let element = document.querySelector(`[data-component-id="${componentId}"]`) as HTMLElement;

        // Fallback: buscar por clase/path si no se encuentra directamente
        if (!element) {
          const { classPart, pathPart } = parseComponentId(componentId);
          if (classPart) {
            const classSelectors = [`.${classPart}`, `[class*="${classPart}"]`];
            for (const selector of classSelectors) {
              try {
                const candidates = document.querySelectorAll(selector);
                for (const candidate of Array.from(candidates)) {
                  const candidateEl = candidate as HTMLElement;
                  if (!candidateEl.hasAttribute('data-component-id')) {
                    if (pathPart) {
                      const candidatePath = generatePathHash(candidateEl);
                      const normalizedPath = pathPart.replace(/--+/g, '-').replace(/^-|-$/g, '').toLowerCase();
                      const normalizedCandidatePath = candidatePath.replace(/--+/g, '-').replace(/^-|-$/g, '');
                      if (normalizedCandidatePath === normalizedPath || normalizedPath.includes(normalizedCandidatePath)) {
                        element = candidateEl;
                        applyComponentId(element, componentId);
                        break;
                      }
                    } else {
                      element = candidateEl;
                      applyComponentId(element, componentId);
                      break;
                    }
                  }
                }
                if (element) break;
              } catch (e) {
                // Ignorar errores
              }
            }
          }
        }

        if (!element) {
          console.warn(`[component-selector-helper] updateComponentProperties: elemento no encontrado para ${componentId}`);
          return;
        }

        const iconName = properties.icon.name;
        const iconSize = properties.icon.size || 20;
        const iconColor = properties.icon.color || '#000000';

        // Limpiar iconos existentes
        element.querySelectorAll('.zeus-injected-icon').forEach((icon) => icon.remove());
        element.querySelectorAll('[data-icon-name]').forEach((icon) => icon.remove());
        element.querySelectorAll('svg').forEach((svg) => {
          const parent = svg.parentElement;
          if (parent) {
            if (parent.classList.contains('zeus-injected-icon') || parent.hasAttribute('data-icon-name')) {
              parent.remove();
            } else if (svg.parentElement === element && svg.getAttribute('viewBox') === '0 0 24 24') {
              svg.remove();
            }
          }
        });

        // Crear contenedor para el icono
        const iconContainer = document.createElement('span');
        iconContainer.className = 'zeus-injected-icon';
        iconContainer.style.display = 'inline-flex';
        iconContainer.style.alignItems = 'center';
        iconContainer.style.justifyContent = 'center';
        iconContainer.style.verticalAlign = 'middle';
        iconContainer.style.marginRight = '6px';
        iconContainer.style.flexShrink = '0';
        iconContainer.setAttribute('data-icon-name', iconName);

        // Insertar el icono al inicio del elemento
        if (element.firstChild) {
          element.insertBefore(iconContainer, element.firstChild);
        } else {
          element.appendChild(iconContainer);
        }

        // Cargar e inyectar el SVG del icono
        loadAndInjectIcon(iconContainer, iconName, iconSize, iconColor);

        console.log(`[component-selector-helper] ✅ Icono actualizado en tiempo real para ${componentId}: ${iconName}`);
      }
    };

    // Función para aplicar IDs desde el CSS importado cuando se carga la página
    // Esta función funciona tanto en iframe como fuera de él
    function applyIdsFromImportedCSS() {
      // Buscar el CSS importado en los elementos <style> o leerlo desde el archivo
      let cssContent = '';

      // Primero, buscar en elementos <style> existentes
      const styleElement = document.getElementById('zeus-component-styles');
      if (styleElement && styleElement.textContent) {
        cssContent = styleElement.textContent;
      } else {
        // Buscar en todos los elementos <style> del documento (Next.js inyecta CSS aquí)
        const allStyles = Array.from(document.querySelectorAll('style'));
        for (const style of allStyles) {
          if (style.textContent &&
            (style.textContent.includes('data-component-id') ||
              style.textContent.includes('zeus'))) {
            cssContent = style.textContent;
            console.log('[component-selector-helper] CSS encontrado en elemento <style>');
            break;
          }
        }
      }

      // Si no se encuentra en <style>, intentar leer desde el archivo CSS importado
      if (!cssContent) {
        // Buscar el link al archivo CSS
        const cssLink = document.querySelector('link[href*="zeus-styles.css"]') as HTMLLinkElement;
        if (cssLink && cssLink.sheet) {
          try {
            // Intentar leer las reglas CSS del archivo importado
            const rules = cssLink.sheet.cssRules || cssLink.sheet.rules;
            if (rules) {
              for (let i = 0; i < rules.length; i++) {
                const rule = rules[i] as CSSStyleRule;
                if (rule.selectorText && rule.selectorText.includes('data-component-id')) {
                  // Reconstruir el CSS desde las reglas
                  cssContent += rule.selectorText + ' {\n';
                  for (let j = 0; j < rule.style.length; j++) {
                    const prop = rule.style[j];
                    cssContent += `  ${prop}: ${rule.style.getPropertyValue(prop)} !important;\n`;
                  }
                  cssContent += '}\n\n';
                }
              }
            }
            if (cssContent) {
              console.log('[component-selector-helper] CSS reconstruido desde link stylesheet');
            }
          } catch (e) {
            console.warn('[component-selector-helper] No se pudo leer CSS desde link (CORS):', e);
          }
        }
      }

      // Si aún no se encuentra, buscar en TODOS los stylesheets (incluyendo los inyectados por Next.js)
      if (!cssContent) {
        try {
          for (let sheetIndex = 0; sheetIndex < document.styleSheets.length; sheetIndex++) {
            try {
              const sheet = document.styleSheets[sheetIndex];
              const rules = sheet.cssRules || sheet.rules;
              if (rules) {
                for (let i = 0; i < rules.length; i++) {
                  const rule = rules[i] as CSSStyleRule;
                  if (rule.selectorText && rule.selectorText.includes('data-component-id')) {
                    // Reconstruir el CSS desde las reglas
                    cssContent += rule.selectorText + ' {\n';
                    for (let j = 0; j < rule.style.length; j++) {
                      const prop = rule.style[j];
                      cssContent += `  ${prop}: ${rule.style.getPropertyValue(prop)} !important;\n`;
                    }
                    cssContent += '}\n\n';
                  }
                }
              }
            } catch (e) {
              // Ignorar errores de CORS en algunos stylesheets
              continue;
            }
          }
          if (cssContent) {
            console.log('[component-selector-helper] CSS reconstruido desde todos los stylesheets');
          }
        } catch (e) {
          console.warn('[component-selector-helper] No se pudo leer CSS desde stylesheets:', e);
        }
      }

      if (cssContent) {
        console.log('[component-selector-helper] CSS encontrado, aplicando IDs automáticamente...');
        // Extraer todos los componentIds del CSS
        const componentIdMatches = cssContent.matchAll(/\[data-component-id="([^"]+)"\]/g);
        const componentIdsInCSS = Array.from(componentIdMatches, m => m[1]);

        console.log(`[component-selector-helper] Encontrados ${componentIdsInCSS.length} IDs en el CSS importado`);

        // Aplicar IDs a los elementos correspondientes
        componentIdsInCSS.forEach(componentId => {
          let element = document.querySelector(`[data-component-id="${componentId}"]`) as HTMLElement;

          if (!element) {
            // Intentar encontrar el elemento basándose en el ID
            const { classPart, pathPart } = parseComponentId(componentId);

            if (classPart) {
              // Buscar por clase
              const classSelectors = [
                `.${classPart}`,
                `[class*="${classPart}"]`,
                `[class*="${classPart.replace(/-/g, '')}"]`
              ];

              const candidates: HTMLElement[] = [];
              for (const selector of classSelectors) {
                try {
                  const found = document.querySelectorAll(selector);
                  found.forEach((el) => {
                    const htmlEl = el as HTMLElement;
                    if (!htmlEl.hasAttribute('data-component-id')) {
                      candidates.push(htmlEl);
                    }
                  });
                } catch (e) {
                  // Ignorar errores
                }
              }

              // Si hay candidatos, verificar el path para encontrar el correcto
              let foundElement: HTMLElement | null = null;
              if (candidates.length > 0 && pathPart) {
                const pathFromId = pathPart.replace(/--+/g, '-').replace(/^-|-$/g, '').toLowerCase();

                for (const candidate of candidates) {
                  const candidatePath = generatePathHash(candidate);
                  const normalizedCandidatePath = candidatePath.replace(/--+/g, '-').replace(/^-|-$/g, '');
                  const normalizedPathFromId = pathFromId.replace(/--+/g, '-').replace(/^-|-$/g, '');

                  if (candidates.length === 1 ||
                    normalizedCandidatePath === normalizedPathFromId ||
                    normalizedPathFromId.includes(normalizedCandidatePath) ||
                    normalizedCandidatePath.includes(normalizedPathFromId)) {
                    foundElement = candidate;
                    break;
                  }
                }
              }

              // Si no se encontró por path pero hay candidatos, usar el primero sin ID
              if (!foundElement && candidates.length > 0) {
                foundElement = candidates.find(c => !c.hasAttribute('data-component-id')) || candidates[0];
              }

              if (foundElement) {
                applyComponentId(foundElement, componentId);
                console.log(`[component-selector-helper] ✅ ID "${componentId}" aplicado desde CSS importado a elemento con clase "${classPart}"`);
              }
            }
          }
        });
      } else {
        console.log('[component-selector-helper] No se encontró CSS importado en la página');
      }
    }

    // Aplicar IDs desde CSS importado cuando se carga la página (funciona siempre, iframe o no)
    // Intentar varias veces con delays para asegurar que el CSS esté cargado (Next.js puede tardar)
    function tryApplyIdsFromCSS() {
      applyIdsFromImportedCSS();
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        setTimeout(tryApplyIdsFromCSS, 200);
        setTimeout(tryApplyIdsFromCSS, 500);
        setTimeout(tryApplyIdsFromCSS, 1000);
        setTimeout(tryApplyIdsFromCSS, 2000);
        setTimeout(tryApplyIdsFromCSS, 3000);
      });
    } else {
      setTimeout(tryApplyIdsFromCSS, 200);
      setTimeout(tryApplyIdsFromCSS, 500);
      setTimeout(tryApplyIdsFromCSS, 1000);
      setTimeout(tryApplyIdsFromCSS, 2000);
      setTimeout(tryApplyIdsFromCSS, 3000);
    }

    // Registrar listener de mensajes siempre (iframe o standalone) para permitir enableSelection desde UI
    window.addEventListener('message', handleMessage);

    // Configurar listeners de selección siempre; selectionEnabled controla si actúa.
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', setupEventListeners);
    } else {
      setupEventListeners();
    }

    // Notificar al editor que el script está cargado
    window.parent.postMessage({
      type: 'selectorScriptLoaded'
    }, '*');

    console.log('Component Selector Helper loaded');

    // Cleanup
    return () => {
      window.removeEventListener('message', handleMessage);
      document.body.removeEventListener('mouseover', handleMouseOver, true);
      document.body.removeEventListener('mouseout', handleMouseOut, true);
      document.body.removeEventListener('click', handleClick, true);
    };
  }, []);

  return null; // Este componente no renderiza nada
}