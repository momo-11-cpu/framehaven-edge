import { defineConfig } from 'vite';
import { resolve } from 'node:path';
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist', emptyOutDir: true,
    rollupOptions: { input: {
      popup: resolve('popup.html'), options: resolve('options.html'), demo: resolve('demo.html'),modelLab:resolve('model-lab.html')
    } }
  },
  test: { include: ['tests/**/*.test.ts'] }
});
