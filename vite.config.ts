import { cloudflare } from '@cloudflare/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { localParent } from './tools/local-parent';

export default defineConfig({
  plugins: [
    localParent(),
    react(),
    cloudflare(),
  ],
});
