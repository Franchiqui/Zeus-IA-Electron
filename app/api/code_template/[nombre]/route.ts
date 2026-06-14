// app/api/code_template/[nombre]/route.ts
import { NextRequest, NextResponse } from 'next/server';

// Prevent Next.js from trying to analyze this route during build
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Configuración de PocketBase
const PB_API_URL = process.env.NEXT_PUBLIC_POCKETBASE_URL || process.env.PB_API_URL || 'https://zeus-basedatos.fly.dev';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ nombre: string }> }
) {
  try {
    const { nombre } = await params;
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    
    // Require ID parameter
    if (!id) {
      return NextResponse.json(
        { error: 'El ID del template es requerido' },
        { status: 400 }
      );
    }

    // Always fetch from PocketBase - no generation by default
    let record: any = null;
    const idCodificado = encodeURIComponent(id);
    console.log(`[Template API] Buscando template por ID: ${idCodificado}`);
    
    try {
      let response: Response | null = null;
      let lastError: string | null = null;
      
      // Si el ID es z5823wh05plqku0, buscar directamente en component_templates
      // porque sabemos que ese ID pertenece a esa colección
      const isComponentTemplateId = id === 'z5823wh05plqku0';
      
      if (isComponentTemplateId) {
        // Buscar directamente en component_templates (requiere autenticación de superusuario)
        console.log(`[Template API] ID de component_templates detectado (${id}), buscando directamente en component_templates...`);
        const superuserToken = process.env.PB_SUPERUSER_TOKEN;
        const headers: HeadersInit = {
          'Content-Type': 'application/json'
        };
        
        if (superuserToken) {
          headers['Authorization'] = `Bearer ${superuserToken}`;
          console.log(`[Template API] ✅ Token de superusuario configurado (longitud: ${superuserToken.length})`);
        } else {
          console.warn(`[Template API] ⚠️ PB_SUPERUSER_TOKEN no configurado, intentando sin autenticación...`);
        }
        
        const componentTemplatesUrl = `${PB_API_URL}/api/collections/component_templates/records/${idCodificado}`;
        console.log(`[Template API] Intentando obtener desde: ${componentTemplatesUrl}`);
        
        try {
          response = await fetch(componentTemplatesUrl, { headers });
          
          if (!response.ok) {
            const errorText = await response.text();
            lastError = errorText;
            console.error(`[Template API] ❌ Error al obtener de component_templates (${response.status}):`, errorText);
          } else {
            console.log(`[Template API] ✅ Encontrado en component_templates`);
          }
        } catch (fetchError: any) {
          console.error(`[Template API] ❌ Excepción al hacer fetch a component_templates:`, fetchError);
          lastError = fetchError.message || String(fetchError);
          throw fetchError;
        }
      } else {
        // Para otros IDs, seguir el flujo normal:
        // 1. templates_floating_chat
        // 2. code_templates  
        // 3. component_templates (con autenticación de superusuario)
        
        try {
          response = await fetch(
            `${PB_API_URL}/api/collections/templates_floating_chat/records/${idCodificado}`
          );

          if (!response.ok) {
            // If not found in templates_floating_chat, try the original code_templates
            console.log(`[Template API] No encontrado en templates_floating_chat, buscando en code_templates...`);
            response = await fetch(
              `${PB_API_URL}/api/collections/code_templates/records/${idCodificado}`
            );
          }

          if (!response.ok) {
            // If not found in code_templates, try component_templates
            // component_templates requiere autenticación de superusuario
            console.log(`[Template API] No encontrado en code_templates, buscando en component_templates...`);
            const superuserToken = process.env.PB_SUPERUSER_TOKEN;
            const headers: HeadersInit = {
              'Content-Type': 'application/json'
            };
            
            if (superuserToken) {
              headers['Authorization'] = `Bearer ${superuserToken}`;
              console.log(`[Template API] ✅ Token de superusuario configurado (longitud: ${superuserToken.length})`);
            } else {
              console.warn(`[Template API] ⚠️ PB_SUPERUSER_TOKEN no configurado, intentando sin autenticación...`);
            }
            
            const componentTemplatesUrl = `${PB_API_URL}/api/collections/component_templates/records/${idCodificado}`;
            console.log(`[Template API] Intentando obtener desde: ${componentTemplatesUrl}`);
            
            response = await fetch(componentTemplatesUrl, { headers });
            
            if (!response.ok) {
              const errorText = await response.text();
              lastError = errorText;
              console.error(`[Template API] ❌ Error al obtener de component_templates (${response.status}):`, errorText);
            } else {
              console.log(`[Template API] ✅ Encontrado en component_templates`);
            }
          }
        } catch (fetchError: any) {
          console.error(`[Template API] ❌ Excepción al hacer fetch:`, fetchError);
          lastError = fetchError.message || String(fetchError);
          throw fetchError;
        }
      }

      if (response && response.ok) {
        record = await response.json();
        console.log(`[Template API] ✅ Encontrado template usando ID: ${id}`);
        console.log(`[Template API] Campos disponibles en el registro:`, Object.keys(record));
      } else if (response) {
        const errorText = lastError || await response.text();
        console.error(`[Template API] ❌ Template con ID '${id}' no encontrado. Status: ${response.status}, Error: ${errorText}`);
        return NextResponse.json(
          { error: `Template con ID '${id}' no encontrado`, details: errorText },
          { status: 404 }
        );
      } else {
        console.error(`[Template API] ❌ Response es null después de todos los intentos`);
        return NextResponse.json(
          { error: `No se pudo obtener respuesta de PocketBase`, details: lastError || 'Response es null' },
          { status: 500 }
        );
      }
    } catch (pbError: any) {
      console.error(`[Template API] ❌ Error al conectar con PocketBase:`, pbError);
      console.error(`[Template API] Stack trace:`, pbError.stack);
      return NextResponse.json(
        { 
          error: 'Error al conectar con PocketBase', 
          details: pbError.message || String(pbError),
          stack: process.env.NODE_ENV === 'development' ? pbError.stack : undefined
        },
        { status: 500 }
      );
    }

    // If found in PocketBase, return the content
    console.log('[Template API] 📋 Registro encontrado. Campos:', Object.keys(record));
    console.log('[Template API] 📋 Primeros 200 caracteres del registro:', JSON.stringify(record).substring(0, 200));
    
    // Intentar varios nombres de campos posibles para el contenido
    // Nota: En code_templates el campo suele ser 'codigo', en component_templates podría ser 'content', etc.
    const possibleContentFields = ['codigo', 'content', 'contenido', 'key', 'body', 'template', 'code', 'text', 'texto', 'file_content', 'fileContent', 'value', 'valor'];
    let content = '';
    let foundField = '';
    
    for (const field of possibleContentFields) {
      if (record[field] !== undefined && record[field] !== null && record[field] !== '') {
        content = String(record[field]);
        foundField = field;
        console.log(`[Template API] ✅ Contenido encontrado en campo '${field}' (longitud: ${content.length} caracteres)`);
        break;
      }
    }
    
    if (content === '') {
      console.error('[Template API] ❌ Registro encontrado pero no se encontró campo de contenido válido.');
      console.error('[Template API] Campos disponibles:', Object.keys(record));
      console.error('[Template API] Valores de campos:', Object.entries(record).map(([k, v]) => [k, typeof v, v ? String(v).substring(0, 50) : 'null/empty']));
      return NextResponse.json(
        { 
          error: 'Template encontrado pero sin contenido válido',
          availableFields: Object.keys(record),
          fieldValues: Object.entries(record).reduce((acc, [k, v]) => {
            acc[k] = typeof v === 'string' ? v.substring(0, 100) : String(v);
            return acc;
          }, {} as Record<string, string>)
        },
        { status: 404 }
      );
    }

    // Always return JSON for consistency
    return NextResponse.json({ contenido: content });
  } catch (error: any) {
    console.error('[Template API] Error al obtener plantilla:', error);
    return NextResponse.json(
      { error: error.message || 'Error al obtener plantilla' },
      { status: 500 }
    );
  }
}