import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 4010,
    allowedHosts: ['craft.dev.dora.restry.cn', 'dev.dora.restry.cn'],
    proxy: {
      '/clawcraft': {
        target: 'http://localhost:18790',
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          pixi: ['pixi.js'],
          react: ['react', 'react-dom'],
        },
      },
    },
  },
});
