import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const appVersion = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8')
) as { version: string };

const assetVersion = appVersion.version;

function withAssetVersion(assetPath: string): string {
  return `${assetPath}?v=${assetVersion}`;
}

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'version-install-assets',
      transformIndexHtml(html) {
        return html
          .replace('/icons/timekeeper.svg', withAssetVersion('/icons/timekeeper.svg'))
          .replace('/icons/icon-32x32.png', withAssetVersion('/icons/icon-32x32.png'))
          .replace('/icons/icon-16x16.png', withAssetVersion('/icons/icon-16x16.png'))
          .replace('/icons/favicon.ico', withAssetVersion('/icons/favicon.ico'))
          .replace('/icons/apple-touch-icon.png', withAssetVersion('/icons/apple-touch-icon.png'))
          .replace('/icons/safari-pinned-tab.svg', withAssetVersion('/icons/safari-pinned-tab.svg'));
      },
    },
    VitePWA({
      registerType: 'autoUpdate',
      // Use our custom SW entry point so we can handle notificationclick
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      includeAssets: [
        'icons/timekeeper.svg',
        'icons/icon-16x16.png',
        'icons/icon-32x32.png',
        'icons/favicon.ico',
        'icons/apple-touch-icon.png',
        'icons/safari-pinned-tab.svg',
      ],
      manifest: {
        name: 'Time Keeper',
        short_name: 'TimeKeeper',
        description: 'Track work time by category for Workday',
        // Install surfaces use the new icon brand colours.
        // The <meta name="theme-color"> tags in index.html handle per-scheme
        // browser chrome colour while browsing (media query aware).
        theme_color: '#207D9B',
        background_color: '#1A202C',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          { src: withAssetVersion('icons/icon-192x192.png'), sizes: '192x192', type: 'image/png' },
          { src: withAssetVersion('icons/icon-512x512.png'), sizes: '512x512', type: 'image/png' },
          { src: withAssetVersion('icons/maskable-192x192.png'), sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: withAssetVersion('icons/maskable-512x512.png'), sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL ?? 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
