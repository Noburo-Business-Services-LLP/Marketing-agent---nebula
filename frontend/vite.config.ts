import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const rootDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, rootDir, '');
    const backendTarget = env.VITE_BACKEND_URL || 'http://localhost:5000';
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
        proxy: {
          // API calls (needed when dev host isn't literally "localhost")
          '/api': {
            target: backendTarget,
            changeOrigin: true,
          },
          // Tone preview loads `/audio/*.mp3` from the Express app (backend/tone-audio)
          '/audio': {
            target: backendTarget,
            changeOrigin: true,
          },
          // Allow dev UI to preview generated media paths
          '/generated-media': {
            target: backendTarget,
            changeOrigin: true,
          },
        },
      },
      build: {
        outDir: '../backend/public',
        emptyOutDir: true,
        // Libraries are grouped so that a page pulls in only the groups it uses, and so a release that changes
        // app code leaves the (large, rarely changing) library files cached in the visitor's browser.
        rollupOptions: {
          output: {
            manualChunks(id: string) {
              // Vite's own helpers (dynamic-import preloading) are needed by the first screen. Without this line they land in
              // whichever library group imports them first, which dragged the whole PDF group into the first load.
              if (id.includes('vite/preload-helper') || id.includes('vite/modulepreload-polyfill') || id.includes('commonjsHelpers')) return 'vendor-react';
              if (!id.includes('node_modules')) return undefined;
              if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'vendor-react';
              if (/node_modules\/(react-router|react-router-dom|@remix-run)\//.test(id)) return 'vendor-router';
              if (/node_modules\/(jspdf|html2canvas|canvg|dompurify|fflate|core-js|svg-pathdata|rgbcolor|stackblur-canvas|fast-png|iobuffer)\//.test(id)) return 'vendor-pdf';
              if (/node_modules\/(socket\.io-client|socket\.io-parser|engine\.io-client|engine\.io-parser|@socket\.io)\//.test(id)) return 'vendor-socket';
              return undefined;
            },
          },
        },
      },
      plugins: [react()],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
        alias: {
          '@': resolve(rootDir, '.'),
        }
      }
    };
});
