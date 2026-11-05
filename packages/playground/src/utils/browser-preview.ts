import { playgroundLogs, type LogLevel } from './LogManager';

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
) {
  const brokerUrl = previewOrigin(address);
  const origin = brokerUrl.origin;
  const runBase = new URL('./run/', brokerUrl);
  const broker = document.createElement('iframe');
  broker.hidden = true;
  broker.title = 'Prepare game preview';
  broker.referrerPolicy = 'no-referrer';
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
      broker.contentWindow?.postMessage({ type: 'prepare-run', ...snapshot }, origin, [channel.port2]);
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
    } else if (type === 'preview-error' && typeof message === 'string') {
      clearTimeout(timer);
      reportError(message.slice(0, 2_000));
    } else if (type === 'preview-scene') {
      const { objects, selectedId } = event.data;
      if (Array.isArray(objects) && objects.length <= 200 && objects.every(isPreviewObject) &&
          (selectedId === null || (typeof selectedId === 'string' && selectedId.length <= 100))) {
        publishScene({ objects, selectedId });
      }
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
