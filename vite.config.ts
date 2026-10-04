/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

// Routing uses the URL hash, so a relative base works at the root of a domain
// (Vercel), from a sub-path and from any static host.
export default defineConfig({
  base: './',
  plugins: [
    react(),
    tailwindcss(),
    // Offline support: a service worker precaches the whole app (including
    // the PDF fonts and workers), so invoices can be created and exported
    // without a connection. Updates wait for the user (see src/app/pwa.ts).
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      // Icons and the favicon are already matched by globPatterns below.
      includeManifestIcons: false,
      manifest: {
        id: './',
        name: 'AlmailBooks',
        short_name: 'AlmailBooks',
        description:
          'Free accounting and invoicing for Kuwaiti businesses, in Arabic and English. محاسبة وفوترة مجانية للأعمال في الكويت.',
        lang: 'ar',
        start_url: './',
        scope: './',
        display: 'standalone',
        theme_color: '#4f46e5',
        background_color: '#f8fafc',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,jpg,ttf,woff2}'],
        // The PDF engine and pdf.js worker are each ~1.3 MB.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2500,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
  },
});
