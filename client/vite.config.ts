import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { LOGO_CSS, loaderSvg } from './src/ui/logo/markup.ts';

const __dirname = import.meta.dirname;

/** The animated logo shown before the JavaScript loads. */
function inlineLoader(): Plugin {
  return {
    name: 'hyperfocus-inline-loader',
    transformIndexHtml(html) {
      return html
        .replace('<!--logo-css-->', `<style>${LOGO_CSS}</style>`)
        .replace('<!--loader-->', `<div class="boot-loader">${loaderSvg(150, 'Hyperfocus', 'Loading')}</div>`);
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, resolve(__dirname, '../server'), '');
  const api = `http://127.0.0.1:${env.API_PORT || 8787}`;
  return {
    plugins: [react(), inlineLoader()],
    server: {
      port: 5173,
      proxy: {
        '/api': { target: api },
        '/uploads': { target: api },
      },
    },
    build: {
      chunkSizeWarningLimit: 1500,
    },
  };
});
