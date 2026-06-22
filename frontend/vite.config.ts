import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
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
      },
      plugins: [react()],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
