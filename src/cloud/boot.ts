import { cloudConfigured } from './config';
import { readAuthRedirect } from './client';

/**
 * Runs before the router starts (imported first by main.tsx): a page opened
 * from a link in an email gets its route straightened out, so the router
 * opens the callback screen.
 */
export const authRedirect = cloudConfigured && typeof window !== 'undefined' && readAuthRedirect();
