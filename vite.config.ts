import { cloudflare } from '@cloudflare/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { localParent } from './tools/local-parent';

const databasePath = process.env.DAILY_STARS_D1_PATH;

export default defineConfig({
  plugins: [
    localParent(databasePath),
    react(),
    cloudflare({ persistState: databasePath ? { path: databasePath } : undefined }),
  ],
});
