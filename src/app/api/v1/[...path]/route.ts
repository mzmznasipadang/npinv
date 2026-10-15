import { handleMobileRequest } from '@/lib/mobile-api';
export async function GET(request: Request) { return handleMobileRequest(request); }
export const POST = GET;
export const DELETE = GET;
export const PUT = GET;
export const PATCH = GET;
