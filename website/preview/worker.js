const scope = new URL(self.registration.scope);
const broker = new URL("broker.html", scope).href;
const runs = new Map();

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));

self.addEventListener("message", event => {
  if (event.data?.type === "take-snapshot") {
    const run = Array.from(runs.entries()).find(([, value]) => value.clientId === event.source?.id);
    if (!run || !event.ports[0]) return;
    runs.delete(run[0]);
    event.ports[0].postMessage({ files: run[1].files, entry: run[1].entry });
    return;
  }
  if (event.source?.url !== broker || event.data?.type !== "prepare-run") return;
  const { files, entry, editorOrigin } = event.data;
  if (!event.ports[0] || typeof editorOrigin !== "string" || typeof entry !== "string" ||
      !(files instanceof Map) || !files.has(entry) || files.size > 512) return;
  let bytes = 0;
  for (const [path, file] of files) {
    if (typeof path !== "string" || path.length > 512 ||
        path.split("/").some(part => !part || part.startsWith(".") || part.includes(String.fromCharCode(92))) ||
        !(file instanceof Blob)) return;
    bytes += file.size;
    if (bytes > 16 * 1024 * 1024) return;
  }
  const id = crypto.randomUUID();
  runs.set(id, { files, entry, editorOrigin, created: Date.now(), clientId: null });
  for (const [key, run] of runs) {
    if (Date.now() - run.created > 10 * 60_000) runs.delete(key);
  }
  event.ports[0].postMessage(new URL("run/" + id + "/", scope).href);
});

self.addEventListener("fetch", event => {
  const prefix = new URL("run/", scope);
  if (!event.request.url.startsWith(prefix.href)) return;
  const request = new URL(event.request.url);
  const [id, ...segments] = request.pathname.slice(prefix.pathname.length).split("/");
  const run = runs.get(id);
  const referrer = event.request.referrer;
  const requester = referrer.startsWith("http") ? new URL(referrer).origin : null;
  if (event.request.mode === "navigate" && segments.join("/") === "" &&
      run && requester === run.editorOrigin && !run.clientId && event.resultingClientId) {
    run.clientId = event.resultingClientId;
    const html = '<!doctype html><html lang="en"><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1"><title>Game preview</title>' +
      '<style>html,body,#playground-canvas-container{margin:0;width:100%;height:100%;overflow:hidden}canvas{display:block}' +
      // Leave room for the collapsed 44px drawer rail and its 18px resize handle.
      ':root{--touch-bottom:64px;--touch-height:52px}' +
      '.touch-arrows{position:absolute;inset:auto 0 var(--touch-bottom);box-sizing:border-box;height:var(--touch-height);display:flex;justify-content:center;gap:3px;padding:4px;background:#17282a}' +
      '.touch-arrows,.touch-arrows button{-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}' +
      'body:has(.touch-arrows) #playground-canvas-container{height:calc(100% - var(--touch-bottom) - var(--touch-height))}' +
      '.touch-arrows button{flex:1;max-width:56px;min-height:44px;touch-action:none;background:#203234;color:#ffc46f;border:1px solid #586863;border-radius:4px;font:24px system-ui}' +
      '.touch-arrows button:active{background:#ffc46f;color:#20180e}</style>' +
      '<div id="playground-canvas-container"></div>' +
      '<script type="importmap">{"imports":{"dino-ge":"/built/index.js"}}</script>' +
      '<script type="module" src="' + new URL("runner.js", scope).pathname + '"></script>';
    event.respondWith(Promise.resolve(new Response(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Security-Policy": "default-src 'none'; script-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' blob: data:; style-src 'unsafe-inline'; media-src 'self' blob:; frame-src 'none'; worker-src 'none'"
      }
    })));
    return;
  }

  event.respondWith(serveFile(event, new URL(id + "/", prefix).href, segments));
});

async function serveFile(event, runUrl, segments) {
  const missing = () => new Response(null, { status: 404 });
  if (event.request.method !== "GET" || event.request.mode === "navigate") return missing();
  const client = await self.clients.get(event.clientId);
  if (client?.url !== runUrl) return missing();

  let path;
  try {
    path = segments.map(decodeURIComponent).join("/");
  } catch {
    return missing();
  }

  const channel = new MessageChannel();
  const file = await new Promise(resolve => {
    const timer = setTimeout(() => resolve(null), 2000);
    channel.port1.onmessage = message => {
      clearTimeout(timer);
      resolve(message.data);
    };
    client.postMessage({ type: "get-file", path }, [channel.port2]);
  });
  channel.port1.close();
  if (!(file instanceof Blob)) return missing();
  const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  if (path.endsWith(".js") || path.endsWith(".mjs")) headers["Content-Type"] = "text/javascript";
  return new Response(file, { headers });
}
