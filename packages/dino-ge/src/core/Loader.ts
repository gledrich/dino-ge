import Sound from './Sound.js';

type LoadedAsset =
  | { kind: 'image'; tag: string; value: HTMLImageElement }
  | { kind: 'json'; tag: string; value: unknown }
  | { kind: 'sound'; tag: string; value: Sound };

type AssetKind = LoadedAsset['kind'];

interface QueuedAsset {
  kind: AssetKind;
  tag: string;
  src: string;
  inFlight?: Promise<void>;
}

interface LoaderState {
  assets: Map<string, LoadedAsset>;
  queue: Map<string, QueuedAsset>;
  controller: AbortController;
}

function newState(): LoaderState {
  return { assets: new Map(), queue: new Map(), controller: new AbortController() };
}

function assetKey(kind: AssetKind, tag: string): string {
  return `${kind}:${tag}`;
}

function assetNotFound(tag: string): Error {
  return new Error(`Asset not found: ${tag}. Make sure it is queued and loaded.`);
}

function cancelledLoad(): DOMException {
  return new DOMException('The asset load was cancelled.', 'AbortError');
}

/** Queues and loads images, JSON data and decoded sounds. */
export default class ResourceLoader {
  private static get _global() {
    return globalThis as unknown as { __DINO_LOADER_STATE__?: LoaderState };
  }

  private static get _state(): LoaderState {
    return this._global.__DINO_LOADER_STATE__ ??= newState();
  }

  /** Queues an image. Reusing an image tag keeps its existing source. */
  static queueImage(tag: string, src: string): void {
    this.queue('image', tag, src);
  }

  /** Queues a JSON file. Reusing a JSON tag keeps its existing source. */
  static queueJson(tag: string, src: string): void {
    this.queue('json', tag, src);
  }

  /** Queues a sound for decoding. Reusing a sound tag keeps its existing source. */
  static queueSound(tag: string, src: string): void {
    this.queue('sound', tag, src);
  }

  private static queue(kind: AssetKind, tag: string, src: string): void {
    const { assets, queue } = this._state;
    const key = assetKey(kind, tag);
    if (!assets.has(key) && !queue.has(key)) queue.set(key, { kind, tag, src });
  }

  /**
   * Loads the entries queued when called and reports their percentage loaded.
   * Overlapping calls share pending requests. Successful assets remain cached
   * and failed entries can be retried by calling this method again.
   */
  static async loadAll(onProgress?: (percent: number) => void): Promise<void> {
    const state = this._state;
    const snapshot = Array.from(state.queue.entries());
    if (!snapshot.length) return;

    const { signal } = state.controller;
    let cancel!: () => void;
    const cancellation = new Promise<never>((_, reject) => {
      cancel = () => reject(cancelledLoad());
      signal.addEventListener('abort', cancel, { once: true });
    });

    let active = true;
    let loaded = 0;
    try {
      const loading = snapshot.map(([key, entry]) => this.loadEntry(state, key, entry).then(() => {
        if (active && !signal.aborted) onProgress?.(++loaded / snapshot.length * 100);
      }));
      await Promise.race([Promise.all(loading), cancellation]);
    } finally {
      active = false;
      signal.removeEventListener('abort', cancel);
    }
  }

  private static loadEntry(state: LoaderState, key: string, entry: QueuedAsset): Promise<void> {
    const { signal } = state.controller;
    return entry.inFlight ??= this.readAsset(entry, signal).then(asset => {
      if (signal.aborted) return;
      state.assets.set(key, asset);
      state.queue.delete(key);
    }, error => {
      entry.inFlight = undefined;
      throw error;
    });
  }

  private static async readAsset({ kind, tag, src }: QueuedAsset, signal: AbortSignal): Promise<LoadedAsset> {
    switch (kind) {
      case 'image': {
        const value = await new Promise<HTMLImageElement>((resolve, reject) => {
          const image = new Image();
          const cleanUp = () => { image.onload = null; image.onerror = null; };
          image.onload = () => {
            cleanUp();
            resolve(image);
          };
          image.onerror = () => {
            cleanUp();
            if (!signal.aborted) console.error(`Failed to load asset: ${src}`);
            reject();
          };
          image.src = src;
        });
        return { kind, tag, value };
      }
      case 'json': {
        const response = await fetch(src, { signal });
        if (!response.ok) throw new Error(`Could not load JSON (HTTP ${response.status}): ${src}`);
        return { kind, tag, value: await response.json() };
      }
      case 'sound':
        return { kind, tag, value: await Sound.load(src) };
    }
  }

  /** Gets the loaded image for this tag. */
  static getImage(tag: string): HTMLImageElement {
    const asset = this._state.assets.get(assetKey('image', tag));
    if (asset?.kind !== 'image') throw assetNotFound(tag);
    return asset.value;
  }

  /** Gets the parsed JSON for this tag. The caller supplies its expected type. */
  static getJson<T = unknown>(tag: string): T {
    const asset = this._state.assets.get(assetKey('json', tag));
    if (asset?.kind !== 'json') throw assetNotFound(tag);
    return asset.value as T;
  }

  /** Gets the decoded sound for this tag. */
  static getSound(tag: string): Sound {
    const asset = this._state.assets.get(assetKey('sound', tag));
    if (asset?.kind !== 'sound') throw assetNotFound(tag);
    return asset.value;
  }

  /** Lists loaded images for the Playground asset panel and other image consumers. */
  static getLoadedAssets(): { tag: string; image: HTMLImageElement }[] {
    const images: { tag: string; image: HTMLImageElement }[] = [];
    for (const asset of this._state.assets.values()) {
      if (asset.kind === 'image') images.push({ tag: asset.tag, image: asset.value });
    }
    return images;
  }

  /** Clears all assets and queued work, cancelling outstanding batches. */
  static clear(): void {
    const previous = this._state;
    this._global.__DINO_LOADER_STATE__ = newState();
    previous.controller.abort();
    previous.assets.clear();
    previous.queue.clear();
  }
}
