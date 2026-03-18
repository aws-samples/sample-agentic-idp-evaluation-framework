import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@idp/shared': path.resolve(__dirname, '../shared/src/index.ts'),
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
    },
  },
});
