import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, Plugin } from 'vite';
import express from 'express';
import {
  handleChatStream,
  handleGetChatContext,
  handleLensTranslateStream,
  handleLensVLMFallback,
  handleScienceLookup,
} from './src/server/apiHandler.ts';

function apiPlugin(): Plugin {
  return {
    name: 'api-endpoints',
    configureServer(server) {
      const app = express();
      app.use(express.json({ limit: '20mb' }));

      app.post('/api/chat/stream', handleChatStream);
      app.get('/api/chat/:sessionId/context', handleGetChatContext);
      app.post('/api/lens/translate/stream', handleLensTranslateStream);
      app.post('/api/lens/vlm-fallback', handleLensVLMFallback);
      app.get('/api/science/lookup', handleScienceLookup);

      server.middlewares.use(app);
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), apiPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    worker: {
      format: 'es' as const,
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
