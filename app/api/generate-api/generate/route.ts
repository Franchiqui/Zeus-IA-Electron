import { NextRequest } from 'next/server';
import { POST as generatePOST } from '../../../../api/generate-api/generate/route';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  return generatePOST(request);
}
