import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Para desarrollo con recarga en caliente: corre "npx wrangler dev" en otra terminal y luego "npx vite"
  server: {
    proxy: { '/api': 'http://localhost:8787', '/media': 'http://localhost:8787' },
  },
});
