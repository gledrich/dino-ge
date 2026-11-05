import { Engine, isScreenUIStyle } from "dino-ge";
import { addTouchArrows } from "./touch-arrows.js";
import { createPlacementController, readPlacementCanvas } from "./placement.js";

const editorOrigin = new URL(document.referrer).origin;
const tellEditor = (type, fields = {}) => parent.postMessage({ type, ...fields }, editorOrigin);
const messageOf = error => error instanceof Error ? error.message : String(error);
const report = error => tellEditor("preview-error", { message: messageOf(error).slice(0, 2000) });

const sceneObjects = () => Engine.currentScene?.objects ?? Engine.objects;
const gameCanvas = () => document.querySelector("#playground-canvas-container canvas");
const placement = createPlacementController(gameCanvas, publishScene);
let lastScene = "";
let lastCanvas = "";
let observedCanvas;
let screenUISourceRequest;
let screenUIEditing;
let latestScreenUI = [];
let latestPreviewControls = [];

function isScreenUIProperties(properties) {
  if (properties === undefined) return true;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) return false;
  return Object.entries(properties).every(([key, value]) => {
    if (key === "width" || key === "height") return Number.isFinite(value) && Math.abs(value) <= 65_536;
    if (key === "enabled") return typeof value === "boolean";
    if (typeof value !== "string" || value.length > 500) return false;
    if (key === "colour" || key === "background" || key === "font") return isScreenUIStyle(key, value);
    return key === "text";
  });
}

document.addEventListener("keydown", event => {
  if (screenUIEditing && event.key.toLowerCase() === "p") event.stopPropagation();
}, true);

const canvasObserver = new ResizeObserver(publishCanvas);

function publishCanvas() {
  const element = gameCanvas();
  if (element !== observedCanvas) {
    canvasObserver.disconnect();
    observedCanvas = element;
    if (element) canvasObserver.observe(element);
  }
  const canvas = readPlacementCanvas(element);
  const serialised = JSON.stringify(canvas);
  if (serialised !== lastCanvas) {
    lastCanvas = serialised;
    tellEditor("preview-canvas", { canvas });
  }
}

window.addEventListener("resize", publishCanvas);

function publishScene() {
  publishCanvas();
  const collection = sceneObjects();
  const selected = Engine.selectedObject;
  const objects = [];
  const snapshotObject = object => {
    const { position, scale, rotation } = object.transform;
    const { id, metadata } = object;
    const [x, y, scaleX, scaleY] = [position.x, position.y, scale.x, scale.y];
    if ([x, y, scaleX, scaleY, rotation].every(Number.isFinite)) {
      return { id, tag: String(metadata.tag).slice(0, 200), x, y, scaleX, scaleY, rotation };
    }
  };
  for (const object of collection) {
    if (objects.length >= 200) break;
    const item = snapshotObject(object);
    if (item) objects.push(item);
  }
  if (selected && collection.has(selected) && !objects.some(object => object.id === selected.id)) {
    const item = snapshotObject(selected);
    if (item) {
      if (objects.length === 200) objects.pop();
      objects.push(item);
    }
  }
  const snapshot = { objects, selectedId: selected?.id ?? null };
  const serialised = JSON.stringify(snapshot);
  if (serialised === lastScene) return;
  lastScene = serialised;
  tellEditor("preview-scene", snapshot);
}

window.addEventListener("message", event => {
  if (event.origin !== editorOrigin || event.source !== parent) return;
  const data = event.data;
  if (data?.type === "preview-controls" && typeof data.paused === "boolean" && typeof data.debug === "boolean") {
    Engine.paused = data.paused;
    Engine.debug = data.debug;
  } else if (data?.type === "preview-placement-command" && Number.isSafeInteger(data.request) && data.request > 0) {
    placement.command(data).then(
      result => tellEditor("preview-placement-result", { request: data.request, result }),
      error => tellEditor("preview-placement-result", { request: data.request, error: messageOf(error).slice(0, 300) }),
    );
  } else if (data?.type === "preview-screen-ui-source" && Number.isInteger(data.index) &&
      data.index >= 0 && data.index < 250 && Number.isInteger(data.request)) {
    screenUISourceRequest = { index: data.index, request: data.request };
  } else if (data?.type === "preview-screen-ui-editing") {
    if (data.editing === undefined) {
      screenUIEditing = undefined;
    } else if (Array.isArray(data.editing?.positions) && data.editing.positions.length <= 250) {
      screenUIEditing = { positions: data.editing.positions.flatMap(move => {
        if (!move || !Number.isInteger(move.index) || !move.control || !Number.isFinite(move.x) ||
            !Number.isFinite(move.y) || Math.abs(move.x) > 65_536 || Math.abs(move.y) > 65_536 ||
            !isScreenUIProperties(move.properties)) return [];
        const current = latestPreviewControls[move.index];
        if (!current || current.kind !== move.control.kind) return [];
        const matches = current.id ? current.id === move.control.id
          : ["id", "text", "font", "colour", "background", "x", "y", "width", "height", "reversedX", "reversedY"]
            .every(key => current[key] === move.control[key]);
        return matches ? [{ index: move.index, control: latestScreenUI[move.index],
          x: move.x, y: move.y, properties: move.properties }] : [];
      }) };
    }
  } else if (data?.type === "preview-scene-command" && typeof data.id === "string") {
    const object = [...sceneObjects()].find(candidate => candidate.id === data.id);
    if (!object) return;
    if (data.action === "select") {
      Engine.selectedObject = object;
    } else if (data.action === "transform" && Engine.paused && Engine.selectedObject === object &&
        Number.isFinite(data.value)) {
      const transform = object.transform;
      switch (data.field) {
        case "x": transform.position.x = data.value; break;
        case "y": transform.position.y = data.value; break;
        case "scaleX": transform.scale.x = data.value; break;
        case "scaleY": transform.scale.y = data.value; break;
        case "rotation": transform.rotation = data.value; break;
      }
    }
    publishScene();
  }
});

Engine.observeScreenUI(({ width, height, controls, source }) => {
  const surface = document.querySelector("#playground-canvas-container canvas");
  if (!surface || width <= 0 || height <= 0) return;
  const { x, y, width: cssWidth, height: cssHeight } = surface.getBoundingClientRect();
  const previewControls = controls.slice(0, 250).map(control => {
    const bounded = { ...control };
    for (const key of ["id", "text", "colour", "background", "font"]) {
      if (bounded[key]?.length > 500) bounded[key] = bounded[key].slice(0, 500);
    }
    return bounded;
  });
  latestScreenUI = controls;
  latestPreviewControls = previewControls;
  tellEditor("preview-screen-ui", {
    frame: { width, height, controls: previewControls },
    canvas: { x, y, width: cssWidth, height: cssHeight },
  });
  if (source && source.index === screenUISourceRequest?.index) {
    tellEditor("preview-screen-ui-source", {
      index: source.index, request: screenUISourceRequest.request, stack: source.stack.slice(0, 4000),
    });
    screenUISourceRequest = undefined;
  }
}, () => screenUISourceRequest?.index, () => screenUIEditing);

Engine.on("gameRuntimeError", ({ detail }) => report(detail.error));
window.addEventListener("error", event => report(event.error ?? event.message));
window.addEventListener("unhandledrejection", event => report(event.reason));

for (const level of ["log", "info", "warn", "error"]) {
  const original = console[level].bind(console);
  console[level] = (...args) => {
    original(...args);
    const message = args.map(arg => {
      try {
        return typeof arg === "object" && !(arg instanceof Error) ? JSON.stringify(arg) : messageOf(arg);
      } catch {
        return "[unavailable]";
      }
    }).join(" ");
    tellEditor("preview-console", { level, message: message.slice(0, 8000) });
  };
}

async function run() {
  const worker = navigator.serviceWorker.controller;
  if (!worker) throw new Error("Browser storage could not start the game preview.");
  const channel = new MessageChannel();
  try {
    const snapshot = new Promise(resolve => {
      channel.port1.onmessage = event => resolve(event.data);
    });
    worker.postMessage({ type: "take-snapshot" }, [channel.port2]);
    const { files, entry } = await snapshot;
    const encoded = entry.split("/").map(encodeURIComponent).join("/");
    // Import a module with no exports so a project's exported `then` is
    // never interpreted as the dynamic import promise's `then` method.
    files.set("", new Blob([`import ${JSON.stringify("./" + encoded)};`], { type: "text/javascript" }));

    // The document owns the snapshot so a restarted worker can still load assets.
    navigator.serviceWorker.addEventListener("message", event => {
      if (event.source === navigator.serviceWorker.controller &&
          event.data?.type === "get-file" && event.ports[0]) {
        event.ports[0].postMessage(files.get(event.data.path) ?? null);
      }
    });
    addTouchArrows();
    await import(new URL("./", location.href));
    tellEditor("preview-started");
    publishScene();
    setInterval(publishScene, 250);
  } finally {
    channel.port1.close();
  }
}

await run().catch(report);
