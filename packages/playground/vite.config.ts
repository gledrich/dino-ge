import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cp } from 'node:fs/promises';
import { basename } from 'node:path';

const api = `http://127.0.0.1:${process.env.PORT ?? '3000'}`;

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'bundle-amber-ruins',
      apply: 'build',
      async closeBundle() {
        await cp(new URL('../example/amber-ruins/', import.meta.url),
          new URL('./dist/templates/amber-ruins/', import.meta.url), {
            recursive: true,
            filter: source => !['README.md', 'generate-audio.py', 'explorer.png'].includes(basename(source)),
          });
      },
    },
    {
      name: 'resolve-dino-ge',
      resolveId(id) {
        if (id === 'dino-ge') {
          // This tells Vite that 'dino-ge' should be treated as a native browser import.
          // The browser will then use the importmap to resolve it to /built/index.js.
          return { id: 'dino-ge', external: true };
        }
      }
    }
  ],
  optimizeDeps: {
    exclude: ['dino-ge']
  },
  resolve: {
    dedupe: ['react', 'react-dom'],
    // Monaco vendors a fixed sanitizer copy. Use the patched package in the bundle.
    alias: [{ find: /^\.\/dompurify\/dompurify\.js$/, replacement: 'dompurify' }],
  },
  server: {
    proxy: {
      '/api': api,
      '/files': api,
      '/scripts': api,
      '/project-runs': api,
      '/built': api
    }
  },
  build: {
    rollupOptions: {
      external: ['dino-ge'],
      output: {
        globals: {
          'dino-ge': 'Dino'
        }
      }
    }
  }
});
