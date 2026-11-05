import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cp, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';

const api = `http://127.0.0.1:${process.env.PORT ?? '3000'}`;
let outputDirectory: string;

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'bundle-amber-ruins',
      apply: 'build',
      configResolved(config) {
        outputDirectory = resolve(config.root, config.build.outDir);
      },
      async closeBundle() {
        const template = join(outputDirectory, 'templates', 'amber-ruins');
        await cp(new URL('../example/amber-ruins/', import.meta.url),
          template, {
            recursive: true,
            filter: source => !['README.md', 'generate-audio.py', 'explorer.png'].includes(basename(source)),
          });
        const files = (await readdir(template, { recursive: true, withFileTypes: true }))
          .filter(file => file.isFile())
          .map(file => relative(template, join(file.parentPath, file.name)).split(sep).join('/'))
          .sort();
        await writeFile(join(dirname(template), 'amber-ruins.workspace.json'), JSON.stringify({ entry: 'game.js', files }));
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
