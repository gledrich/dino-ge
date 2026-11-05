import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import express from 'express';

const site = fileURLToPath(new URL('./dist/site/', import.meta.url));
const preview = fileURLToPath(new URL('./dist/preview/', import.meta.url));
const sitePort = Number(process.env.DINO_SITE_PORT ?? 4173);
const previewPort = Number(process.env.DINO_PREVIEW_PORT ?? 4174);
if ([sitePort, previewPort].some(port => !Number.isInteger(port) || port < 1 || port > 65535) ||
    sitePort === previewPort) {
  throw new Error('DINO_SITE_PORT and DINO_PREVIEW_PORT must be distinct TCP ports.');
}

await Promise.all([
  access(new URL('./dist/site/playground/index.html', import.meta.url)),
  access(new URL('./dist/preview/broker.html', import.meta.url)),
]).catch(() => {
  throw new Error('Build the site first with npm run website:build.');
});

function serve(directory, port) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.static(directory));
  return app.listen(port, '127.0.0.1', () => {
    console.log('Serving ' + directory + ' at http://127.0.0.1:' + port);
  });
}

serve(site, sitePort);
serve(preview, previewPort);
