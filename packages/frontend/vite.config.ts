import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';

const midwayReal = path.resolve(__dirname, 'src/services/midway.ts');
const midwayStub = path.resolve(__dirname, 'src/services/midway-stub.ts');

export default defineConfig({
  plugins: [react()],
  envDir: path.resolve(__dirname, '../..'),
  resolve: {
    alias: {
      '@idp/shared': path.resolve(__dirname, '../shared/src/index.ts'),
      '@idp/midway': fs.existsSync(midwayReal) ? midwayReal : midwayStub,
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-cloudscape': [
            '@cloudscape-design/components',
            '@cloudscape-design/global-styles',
            '@cloudscape-design/design-tokens',
            '@cloudscape-design/chat-components',
          ],
          'vendor-reactflow': ['@xyflow/react'],
          'vendor-marked': ['marked'],
        },
      },
    },
  },
  server: {
    port: 5180,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      // Forward /docs/* to the backend, which serves the Fumadocs static
      // export (packages/docs/out) via express.static. Keeps `localhost:5180/docs`
      // working alongside the SPA during dev.
      '/docs': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
