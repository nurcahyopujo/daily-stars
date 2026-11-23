import { cloudflare } from '@cloudflare/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { localParent } from './tools/local-parent.ts';

const databasePath = process.env.DAILY_STARS_D1_PATH;

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  plugins: [
    tailwindcss(),
    localParent(databasePath),
    react(),
    cloudflare({ persistState: databasePath ? { path: databasePath } : undefined }),
  ],
});
