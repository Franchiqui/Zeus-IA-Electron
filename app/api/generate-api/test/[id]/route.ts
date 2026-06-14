import { NextRequest } from 'next/server';
import {
  GET as testGET,
  POST as testPOST,
  PUT as testPUT,
  DELETE as testDELETE,
  PATCH as testPATCH,
  HEAD as testHEAD
} from '../../../../../api/generate-api/test/[id]/route';

export const runtime = 'nodejs';

export async function GET(request: NextRequest, context: any) {
  return testGET(request as any, context);
}

export async function POST(request: NextRequest, context: any) {
  return testPOST(request as any, context);
}

export async function PUT(request: NextRequest, context: any) {
  return testPUT(request as any, context);
}

export async function DELETE(request: NextRequest, context: any) {
  return testDELETE(request as any, context);
}

export async function PATCH(request: NextRequest, context: any) {
  return testPATCH(request as any, context);
}

export async function HEAD(request: NextRequest, context: any) {
  return testHEAD(request as any, context);
}
