import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Plans live in the browser's storage for this exact address, so always use the same port.
  server: { port: 5199, strictPort: true },
  preview: { port: 5199, strictPort: true },
  build: { chunkSizeWarningLimit: 800 },
});
