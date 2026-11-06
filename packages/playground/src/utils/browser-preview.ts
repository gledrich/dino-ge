import { playgroundLogs, type LogLevel } from './LogManager';
import { isScreenUIBounds, isScreenUIFrame, screenUIPreview } from './screen-ui-preview';
import { findScreenUICall, resolveScreenUISource } from './screen-ui-source';
import type { HostedCanvasBounds, HostedPlacementConnection, PreparedHostedPlacement } from './hosted-placement';

type Snapshot = { entry: string; files: Map<string, Blob> };
type Controls = { paused: boolean; debug: boolean };
const timeout = 12_000;
const logLevels = new Set<unknown>(['log', 'info', 'warn', 'error']);

export type PreviewTransform = 'x' | 'y' | 'scaleX' | 'scaleY' | 'rotation';
type PreviewObject = Record<PreviewTransform, number> & { id: string; tag: string };
type SceneSnapshot = { objects: PreviewObject[]; selectedId: string | null };
type SceneCommand =
  | { action: 'select'; id: string }
  | { action: 'transform'; id: string; field: PreviewTransform; value: number };

const emptyScene: SceneSnapshot = { objects: [], selectedId: null };
let scene = emptyScene;
let sendSceneCommand: ((command: SceneCommand) => void) | undefined;
const listeners = new Set<() => void>();
const placementListeners = new Set<() => void>();
let placementView: { run?: HostedPlacementConnection; canvas?: HostedCanvasBounds } = {};

function publishPlacement(next: typeof placementView) {
  placementView = next;
  placementListeners.forEach(listener => listener());
}

export const browserPreviewPlacement = {
  subscribe(listener: () => void) {
    placementListeners.add(listener);
    return () => { placementListeners.delete(listener); };
  },
  getSnapshot: () => placementView,
};

function publishScene(next: SceneSnapshot) {
  scene = next;
  listeners.forEach(listener => listener());
}

export const browserPreviewScene = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
  getSnapshot: () => scene,
  select(id: string) { sendSceneCommand?.({ action: 'select', id }); },
  transform(id: string, field: PreviewTransform, value: number) {
    if (Number.isFinite(value)) sendSceneCommand?.({ action: 'transform', id, field, value });
  },
};

function isPreviewObject(value: unknown): value is PreviewObject {
  if (!value || typeof value !== 'object') return false;
  const object = value as Partial<PreviewObject>;
  return typeof object.id === 'string' && object.id.length <= 100 &&
    typeof object.tag === 'string' && object.tag.length <= 200 &&
    [object.x, object.y, object.scaleX, object.scaleY, object.rotation].every(Number.isFinite);
}


function previewOrigin(address: string) {
  const url = new URL(address);
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) ||
      url.origin === location.origin || url.username || url.password ||
      url.search || url.hash || !url.pathname.endsWith('/broker.html')) {
    throw new Error('The game preview needs a separate origin and a valid broker URL.');
  }
  return url;
}

export function startBrowserPreview(
  container: HTMLElement,
  address: string,
  snapshot: Snapshot,
  initialControls: Controls,
  reportError: (message: string) => void,
  scriptId?: string,
  entrySource?: { original: string; runtime: string },
) {
  const brokerUrl = previewOrigin(address);
  const origin = brokerUrl.origin;
  const runBase = new URL('./run/', brokerUrl);
  const broker = document.createElement('iframe');
  broker.hidden = true;
  broker.title = 'Prepare game preview';
  broker.referrerPolicy = 'no-referrer';
  // A browser may retain a 404 from a previous deployment of the preview.
  brokerUrl.searchParams.set('run', crypto.randomUUID());
  broker.src = brokerUrl.href;
  broker.addEventListener('load', () => {
    broker.contentWindow?.postMessage({ type: 'preview-connect' }, origin);
  });

  const channel = new MessageChannel();
  let frame: HTMLIFrameElement | undefined;
  let disposed = false;
  let controls = initialControls;
  let prepared = false;
  let startupStage = 'connecting to the isolated preview';
  let sourceRequest = 0;
  let placementRequest = 0;
  const placementReplies = new Map<number, {
    timer: number; resolve(value: unknown): void; reject(error: Error): void;
  }>();
  const sendPlacement = (action: string, fields: object) => {
    frame?.contentWindow?.postMessage({ type: 'preview-placement-command', request: ++placementRequest, action, ...fields }, origin);
    return placementRequest;
  };
  const requestPlacement = (action: string, fields: object) => new Promise<unknown>((resolve, reject) => {
    if (!frame?.contentWindow || disposed) {
      reject(new Error('The hosted game has been replaced.'));
      return;
    }
    const request = sendPlacement(action, fields);
    const timer = window.setTimeout(() => {
      placementReplies.delete(request);
      reject(new Error('The hosted game did not confirm the placement.'));
    }, 8_000);
    placementReplies.set(request, { timer, resolve, reject });
  });
  const placement: HostedPlacementConnection | undefined = scriptId && entrySource ? {
    scriptId,
    source: entrySource.original,
    active: () => !disposed && placementView.run === placement,
    async prepare(point) {
      const result = await requestPlacement('prepare', { point }) as Partial<PreparedHostedPlacement> | undefined;
      if (!result || typeof result.handle !== 'string' || result.handle.length > 100 ||
          typeof result.x !== 'number' || typeof result.y !== 'number' ||
          !Number.isFinite(result.x) || !Number.isFinite(result.y) ||
          (result.scene !== undefined && (result.scene?.scriptId !== scriptId ||
            typeof result.scene.className !== 'string' || result.scene.className.length > 200))) {
        throw new Error('The hosted game returned an invalid placement position.');
      }
      return { handle: result.handle, x: result.x, y: result.y, scene: result.scene };
    },
    async create(handle, object) {
      const result = await requestPlacement('create', { handle, object }) as { id?: unknown } | undefined;
      if (!result || typeof result.id !== 'string' || result.id.length > 100) {
        throw new Error('The hosted game returned an invalid object identity.');
      }
      return { id: result.id };
    },
    async finalise(handle) { await requestPlacement('finalise', { handle }); },
    cancel(handle) { if (!disposed) sendPlacement('cancel', { handle }); },
    setVisible(handle, visible) { if (!disposed) sendPlacement('visibility', { handle, visible }); },
  } : undefined;
  publishPlacement({ run: placement });
  const screenUI = screenUIPreview.start(index =>
    frame?.contentWindow?.postMessage({ type: 'preview-screen-ui-source', index, request: ++sourceRequest }, origin),
  editing => frame?.contentWindow?.postMessage({ type: 'preview-screen-ui-editing', editing }, origin));
  const sendCommand = (command: SceneCommand) => frame?.contentWindow?.postMessage({
    type: 'preview-scene-command', ...command
  }, origin);
  sendSceneCommand = sendCommand;
  publishScene(emptyScene);
  const sendControls = () => frame?.contentWindow?.postMessage({ type: 'preview-controls', ...controls }, origin);

  const timer = window.setTimeout(() => {
    dispose();
    reportError(`The game preview timed out while ${startupStage}.`);
  }, timeout);

  function dispose() {
    disposed = true;
    clearTimeout(timer);
    window.removeEventListener('message', receiveMessage);
    channel.port1.close();
    screenUI.dispose();
    for (const { timer, reject } of placementReplies.values()) {
      clearTimeout(timer);
      reject(new Error('The hosted game has been replaced.'));
    }
    placementReplies.clear();
    if (placementView.run === placement) publishPlacement({});
    if (!prepared) channel.port2.close();
    broker.remove();
    frame?.remove();
    if (sendSceneCommand === sendCommand) {
      sendSceneCommand = undefined;
      publishScene(emptyScene);
    }
  }

  function receiveMessage(event: MessageEvent) {
    if (event.origin !== origin || !event.data || typeof event.data !== 'object') return;
    if (event.source === broker.contentWindow && event.data.type === 'preview-broker-loaded') {
      startupStage = 'starting its service worker';
      return;
    }
    if (event.source === broker.contentWindow && event.data.type === 'preview-denied') {
      dispose();
      reportError('The preview is configured for a different website address.');
      return;
    }
    if (event.source === broker.contentWindow && event.data.type === 'preview-ready' && !prepared) {
      prepared = true;
      startupStage = 'preparing the project files';
      const files = new Map(snapshot.files);
      if (entrySource && entrySource.runtime !== entrySource.original) {
        files.set(snapshot.entry, new Blob([entrySource.runtime], { type: 'text/javascript' }));
      }
      broker.contentWindow?.postMessage({ type: 'prepare-run', entry: snapshot.entry, files }, origin, [channel.port2]);
      return;
    }
    if (event.source === broker.contentWindow && event.data.type === 'preview-error') {
      dispose();
      const message = typeof event.data.message === 'string' ? event.data.message.slice(0, 300) : '';
      reportError(`The browser could not start the preview service worker.${message ? ' ' + message : ''}`);
      return;
    }
    if (!frame || event.source !== frame.contentWindow) return;

    const { type, message, level } = event.data;
    if (type === 'preview-started') {
      clearTimeout(timer);
      sendControls();
    } else if (type === 'preview-placement-result') {
      const { request, error, result } = event.data;
      const reply = placementReplies.get(request);
      if (!reply) return;
      placementReplies.delete(request);
      clearTimeout(reply.timer);
      if (typeof error === 'string') reply.reject(new Error(error.slice(0, 300)));
      else reply.resolve(result);
    } else if (type === 'preview-canvas' && placementView.run === placement) {
      const next = event.data.canvas;
      const canvas = isScreenUIBounds(next) && next.width > 0 && next.height > 0 ? next : undefined;
      const before = placementView.canvas;
      if (before?.x !== canvas?.x || before?.y !== canvas?.y ||
          before?.width !== canvas?.width || before?.height !== canvas?.height) publishPlacement({ run: placement, canvas });
    } else if (type === 'preview-error' && typeof message === 'string') {
      clearTimeout(timer);
      reportError(message.slice(0, 2_000));
    } else if (type === 'preview-scene') {
      const { objects, selectedId } = event.data;
      if (Array.isArray(objects) && objects.length <= 200 && objects.every(isPreviewObject) &&
          (selectedId === null || (typeof selectedId === 'string' && selectedId.length <= 100))) {
        publishScene({ objects, selectedId });
      }
    } else if (type === 'preview-screen-ui' && isScreenUIFrame(event.data.frame) && isScreenUIBounds(event.data.canvas)) {
      screenUI.publish(event.data.frame, event.data.canvas);
    } else if (type === 'preview-screen-ui-source') {
      const { index, stack, request } = event.data;
      const control = Number.isInteger(index) ? screenUIPreview.getSnapshot().frame?.controls[index] : undefined;
      if (!scriptId || request !== sourceRequest || !control || typeof stack !== 'string' || stack.length > 4_000) return;
      const location = resolveScreenUISource(stack, new URL(frame.src));
      const file = location && snapshot.files.get(location.path);
      if (!location || !file || !location.path.endsWith('.js')) return;
      void file.text().then(source => {
        const call = findScreenUICall(source, control.kind, location,
          location.path === snapshot.entry ? entrySource?.runtime : undefined);
        if (call && request === sourceRequest) {
          screenUI.setSource(index, { ...location, ...call, source, kind: control.kind, scriptId,
            entry: location.path === snapshot.entry, writeVerified: true });
        }
      }).catch(() => {});
    } else if (type === 'preview-console' && logLevels.has(level) && typeof message === 'string') {
      playgroundLogs.add(level as LogLevel, message.slice(0, 8_000));
    }
  }

  channel.port1.onmessage = event => {
    if (disposed || typeof event.data !== 'string') return;
    const runPath = event.data.slice(runBase.href.length);
    if (!event.data.startsWith(runBase.href) || !/^[a-f0-9-]{36}\/$/.test(runPath)) return;
    channel.port1.close();
    broker.remove();
    frame = document.createElement('iframe');
    frame.title = 'Isolated game preview';
    frame.className = 'browser-game-preview';
    frame.referrerPolicy = 'origin';
    frame.sandbox.add('allow-scripts', 'allow-same-origin');
    frame.allow = 'gamepad';
    Object.assign(frame.style, { width: '100%', height: '100%', border: '0' });
    frame.src = event.data;
    startupStage = 'loading the game in its frame';
    container.append(frame);
  };
  window.addEventListener('message', receiveMessage);
  container.append(broker);
  return {
    dispose,
    setControls(next: Controls) {
      controls = next;
      sendControls();
    },
  };
}
