const editorOrigin = document.referrer ? new URL(document.referrer).origin : null;
const allowedOrigin = document.querySelector('meta[name="dino-editor-origin"]')?.content;

if (editorOrigin && allowedOrigin && editorOrigin !== allowedOrigin && parent !== window) {
  parent.postMessage({ type: "preview-denied" }, editorOrigin);
} else if (editorOrigin && parent !== window) {
  parent.postMessage({ type: "preview-broker-loaded" }, editorOrigin);
  try {
    await navigator.serviceWorker.register("./worker.js");
    const { active: worker } = await navigator.serviceWorker.ready;
    window.addEventListener("message", event => {
      if (event.source !== parent || event.origin !== editorOrigin ||
          event.data?.type !== "prepare-run" || !event.ports[0]) return;
      worker.postMessage({ ...event.data, editorOrigin }, [event.ports[0]]);
    });
    parent.postMessage({ type: "preview-ready" }, editorOrigin);
  } catch (error) {
    parent.postMessage({ type: "preview-error", message: error instanceof Error ? error.message : String(error) }, editorOrigin);
  }
}
