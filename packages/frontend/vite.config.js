import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const appVersion = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const assetVersion = appVersion.version;
function withAssetVersion(assetPath) {
    return `${assetPath}?v=${assetVersion}`;
}
export default defineConfig({
    plugins: [
        react(),
        {
            name: 'version-install-assets',
            transformIndexHtml(html) {
                return html
                    .replace('/icons/favicon.ico', withAssetVersion('/icons/favicon.ico'))
                    .replace('/icons/timekeeper.svg', withAssetVersion('/icons/timekeeper.svg'))
                    .replace('/icons/apple-touch-icon.png', withAssetVersion('/icons/apple-touch-icon.png'));
            },
        },
        VitePWA({
            registerType: 'autoUpdate',
            // Use our custom SW entry point so we can handle notificationclick
            strategies: 'injectManifest',
            srcDir: 'src',
            filename: 'sw.ts',
            includeAssets: ['icons/favicon.ico', 'icons/timekeeper.svg', 'icons/apple-touch-icon.png'],
            manifest: {
                name: 'Time Keeper',
                short_name: 'TimeKeeper',
                description: 'Track work time by category for Workday',
                // Primary brand colour — works across both light and dark themes.
                // The <meta name="theme-color"> tags in index.html handle per-scheme
                // browser chrome colour while browsing (media query aware).
                theme_color: '#4f5aea',
                background_color: '#0B1220',
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
//# sourceMappingURL=vite.config.js.map