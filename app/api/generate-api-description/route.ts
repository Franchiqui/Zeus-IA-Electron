import { NextRequest } from 'next/server';
import { POST as descriptionPOST } from '../../../api/generate-api-description/route';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  return descriptionPOST(request);
}
