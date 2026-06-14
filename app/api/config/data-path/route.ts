import { NextResponse } from 'next/server';
import { readEnvFile, writeEnvFile } from '@/lib/env';

export async function GET() {
  try {
    const vars = readEnvFile();
    const dataPath = vars.DATA_PATH || process.env.DATA_PATH || '';
    return NextResponse.json({ success: true, dataPath });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { dataPath } = body;

    if (!dataPath || typeof dataPath !== 'string') {
      return NextResponse.json({ success: false, error: 'DATA_PATH requerido' }, { status: 400 });
    }

    const vars = readEnvFile();
    vars.DATA_PATH = dataPath;
    writeEnvFile(vars);

    return NextResponse.json({ success: true, dataPath });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
