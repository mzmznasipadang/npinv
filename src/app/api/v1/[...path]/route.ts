import { revalidatePath } from 'next/cache';
import { handleMobileRequest } from '@/lib/mobile-api';
export async function GET(request: Request) {
  const response = await handleMobileRequest(request);
  // The same refresh the Server Actions do, so open dashboard pages show changes made from the app.
  if (request.method !== 'GET' && response.ok) revalidatePath('/', 'layout');
  return response;
}
export const POST = GET;
export const DELETE = GET;
export const PUT = GET;
export const PATCH = GET;
