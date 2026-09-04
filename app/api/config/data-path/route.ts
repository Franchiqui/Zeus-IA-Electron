import { NextResponse } from 'next/server';
import { getBaseDataPath } from '@/lib/env';
import { readEnvFile } from '@/lib/env';

// El anclaje global DATA_PATH quedó obsoleto: el cwd lo define la sesión activa
// (header X-Zeus-Session, elegido vía ProjectPicker). Este endpoint se mantiene
// por compatibilidad con componentes que aún leen el cwd actual (terminal, studio).
export async function GET() {
  try {
    // Prioridad: cwd de la sesión activa (resuelto vía Express).
    let dataPath = '';
    try {
      dataPath = await getBaseDataPath();
    } catch {
      // Fallback heredado (migración): DATA_PATH del .env
      const vars = readEnvFile();
      dataPath = vars.DATA_PATH || process.env.DATA_PATH || '';
    }
    return NextResponse.json({ success: true, dataPath });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// POST deprecado: la carpeta de proyecto ahora se elige con ProjectPicker
// (crea/activa una sesión). Ya no se escribe DATA_PATH en .env.
export async function POST() {
  return NextResponse.json(
    {
      success: false,
      error: 'DATA_PATH global deprecado. Selecciona la carpeta de proyecto con ProjectPicker (sesión por carpeta).',
    },
    { status: 410 }
  );
}