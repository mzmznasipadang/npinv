import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, verifySession } from './auth';

export async function requireSession(): Promise<void> {
  if (!verifySession((await cookies()).get(SESSION_COOKIE)?.value)) redirect('/login');
}
