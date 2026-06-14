import { NextRequest, NextResponse } from 'next/server';
import { writeApiConfig, getProjectRoot } from '@/api/utils';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { apiConfig, projectRoot } = body;

    if (!apiConfig) {
      return NextResponse.json(
        { error: 'apiConfig es requerido' },
        { status: 400 }
      );
    }

    const root = await getProjectRoot(undefined, projectRoot || '');
    const configData = typeof apiConfig === 'string' ? apiConfig : JSON.stringify(apiConfig, null, 2);

    await writeApiConfig(configData, root);
    console.log('✅ API config guardada correctamente desde APP Generator');

    return NextResponse.json({ success: true, message: 'API config guardada correctamente' });
  } catch (error) {
    console.error('❌ Error al guardar API config:', error);
    return NextResponse.json(
      { error: 'Error al guardar la configuración de API: ' + (error instanceof Error ? error.message : 'Unknown error') },
      { status: 500 }
    );
  }
}
