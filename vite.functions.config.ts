import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

/**
 * Builds the email-alerts Supabase Edge Function (src/alerts/edge.ts) with
 * the app code it uses into supabase/functions/email-alerts/index.js, one
 * file Deno runs as is. The Postgres driver stays an npm: import that
 * Supabase resolves. The deploy workflow runs this before deploying.
 */
export default defineConfig({
  publicDir: false,
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      postgres: 'npm:postgres@3.4.9',
    },
  },
  ssr: {
    noExternal: true,
    target: 'webworker',
  },
  build: {
    ssr: 'src/alerts/edge.ts',
    outDir: 'supabase/functions/email-alerts',
    emptyOutDir: true,
    target: 'es2022',
    minify: false,
    copyPublicDir: false,
    rollupOptions: {
      external: [/^npm:/],
      output: {
        format: 'es',
        entryFileNames: 'index.js',
      },
    },
  },
});
