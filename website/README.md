# Dino GE website

The free website includes the project overview, a guided first game, the generated API reference and the browser Playground. The public build uses static hosting and keeps projects in the browser.

## Run locally

From the repository root, using the Node version in `.nvmrc`:

```sh
npm ci
npm run website:build
npm run website:preview
```

Open [the local website](http://127.0.0.1:4173). The game preview runs on port 4174, a separate origin. The build generates TypeDoc and Monaco declarations from the same engine source as the editor. For the existing Express-backed Playground, use `npm run playground` after building the workspaces.

If those ports are in use, set `DINO_SITE_PORT` and `DINO_PREVIEW_PORT` when starting the servers, and set `VITE_DINO_PREVIEW_URL` to the matching loopback broker URL when building.

## Browser projects

The first visit opens an editable copy of Amber Ruins. Saves and imported files stay in the current browser. Use **Export saved project** to download a backup or **Restore backup** to bring it into another browser. Pause the game before editing an object in the Inspector. Inspector changes apply to the current run, and saved code is used on the next run.

On iPhone, open the Playground in Safari. If a link opens in an app's built-in browser and the preview times out, use **Open in Safari**. The standalone game link is also available if you only want to play Amber Ruins.

## Static hosting layout

Set `VITE_DINO_PREVIEW_URL` to the HTTPS address of `/broker.html` on the preview origin when building. Serve `website/dist/site` and `website/dist/preview` at the roots of two distinct origins. Keep the preview origin dedicated to game previews and configure your host to serve directory indexes for `/docs/` and `/playground/`. Preserve the paths to the engine modules and service worker. Both outputs come from the same build.

## Deployment checklist

The Website GitHub Actions workflow builds and checks a loopback copy on relevant pull requests. The HTTPS release check below uses the actual deployment origins.

1. Choose the public site and dedicated preview HTTPS origins. If you have a domain, use sibling subdomains so the preview is a different origin on the same site. Keep credentials and authenticated services off the preview origin.
2. From the website worktree, run `npm ci` and `npm run lint`. Build with `DINO_SITE_URL=https://site.example.com VITE_DINO_PREVIEW_URL=https://preview.example.com/broker.html npm run website:build -- --release`, substituting the two real addresses. The release build rejects missing URLs, loopback addresses and a shared origin.
3. Upload `website/dist/preview` first, then `website/dist/site`. Serve JavaScript as JavaScript and allow the preview origin to be framed by the site. Keep `/broker.html` and `/worker.js` revalidatable. Serve missing files as 404s so a stale or missing asset is visible. The release broker accepts the configured website origin. Rebuild before changing the website address.
4. With Playwright Chromium and WebKit installed, run `DINO_SITE_URL=https://site.example.com VITE_DINO_PREVIEW_URL=https://preview.example.com/broker.html node website/check-release.mjs`. This checks navigation, documentation, edit and reload in the isolated editor, touch movement, access to the standalone game if the preview origin fails, and rejection of an unrelated website by the release broker. It uses fresh browser profiles.
5. On a physical iPhone in Safari, open Playground, start Amber Ruins and move with the arrows. Confirm an edit still runs after reloading the editor. A timeout reports the stage that failed. **Play Amber Ruins directly** is available without browser workspace storage or a service worker. It plays the bundled game and does not open project edits.

### Cloudflare Workers static assets

Use `website/wrangler.preview.toml` and `website/wrangler.site.toml` for two static asset Workers. Change the names if needed to match your account. The preview config disables HTML redirects because the service worker expects its broker at exactly `/broker.html`. The site config enables directory indexes. Both configs preserve missing files as 404s. The build emits Cloudflare `_headers` files to keep the broker and worker revalidatable and discourage indexing of the preview origin.

After choosing the two HTTPS addresses and building for them, use Wrangler with `--config website/wrangler.preview.toml` for the preview and `--config website/wrangler.site.toml` for the site. Run `wrangler deploy --dry-run` with each config to validate them before publishing.

[Cloudflare HTML handling](https://developers.cloudflare.com/workers/static-assets/routing/advanced/html-handling/) · [Static asset headers](https://developers.cloudflare.com/workers/static-assets/headers/)
