import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const publicDir = fileURLToPath(new URL('./public', import.meta.url));

const installAssetPaths = [
  'icons/timekeeper.svg',
  'icons/icon-16x16.png',
  'icons/icon-32x32.png',
  'icons/icon-192x192.png',
  'icons/icon-512x512.png',
  'icons/maskable-192x192.png',
  'icons/maskable-512x512.png',
  'icons/notification-badge.svg',
  'icons/favicon.ico',
  'icons/apple-touch-icon.png',
  'icons/safari-pinned-tab.svg',
] as const;

function withFingerprint(assetPath: string): string {
  const absolutePath = resolve(publicDir, assetPath);
  const extension = extname(assetPath);
  const basename = assetPath.slice(0, -extension.length);
  const hash = createHash('sha256')
    .update(readFileSync(absolutePath))
    .digest('hex')
    .slice(0, 8);
  return `${basename}.${hash}${extension}`;
}

const fingerprintedAssets = Object.fromEntries(
  installAssetPaths.map((assetPath) => [assetPath, withFingerprint(assetPath)])
) as Record<(typeof installAssetPaths)[number], string>;

function installAssetUrl(assetPath: (typeof installAssetPaths)[number]): string {
  return `/${fingerprintedAssets[assetPath]}`;
}

const installAssetHtmlReplacements = [
  '/icons/timekeeper.svg',
  '/icons/icon-32x32.png',
  '/icons/icon-16x16.png',
  '/icons/favicon.ico',
  '/icons/apple-touch-icon.png',
  '/icons/safari-pinned-tab.svg',
] as const;

export default defineConfig({
  define: {
    __INSTALL_NOTIFICATION_ICON_URL__: JSON.stringify(installAssetUrl('icons/icon-192x192.png')),
    __INSTALL_NOTIFICATION_BADGE_URL__: JSON.stringify(installAssetUrl('icons/notification-badge.svg')),
  },
  plugins: [
    react(),
    {
      name: 'fingerprint-install-assets',
      buildStart() {
        for (const [assetPath, fileName] of Object.entries(fingerprintedAssets)) {
          this.emitFile({
            type: 'asset',
            fileName,
            source: readFileSync(resolve(publicDir, assetPath)),
          });
        }
      },
      transformIndexHtml(html) {
        return installAssetHtmlReplacements.reduce(
          (output, assetPath) => output.replace(assetPath, installAssetUrl(assetPath.slice(1) as (typeof installAssetPaths)[number])),
          html
        );
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
          { src: installAssetUrl('icons/icon-192x192.png'), sizes: '192x192', type: 'image/png' },
          { src: installAssetUrl('icons/icon-512x512.png'), sizes: '512x512', type: 'image/png' },
          { src: installAssetUrl('icons/maskable-192x192.png'), sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: installAssetUrl('icons/maskable-512x512.png'), sizes: '512x512', type: 'image/png', purpose: 'maskable' },
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
