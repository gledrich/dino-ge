/**
 * Interface for the shared global state of the Loader.
 */
interface LoaderState {
  assets: Map<string, HTMLImageElement>;
  loadingQueue: Map<string, string>;
  totalToLoad: number;
  loadedCount: number;
}

/**
 * Initial state for the loader.
 */
const INITIAL_STATE: LoaderState = {
  assets: new Map(),
  loadingQueue: new Map(),
  totalToLoad: 0,
  loadedCount: 0
};

/**
 * Handles asynchronous loading of assets like images.
 */
export default class ResourceLoader {
  private static generation = 0;
  /** Internal helper to access the global shared state. */
  private static get _state(): LoaderState {
    const global = globalThis as unknown as { __DINO_LOADER_STATE__: LoaderState };
    if (!global.__DINO_LOADER_STATE__) {
      global.__DINO_LOADER_STATE__ = INITIAL_STATE;
    }
    return global.__DINO_LOADER_STATE__;
  }

  private static get assets() { return this._state.assets; }
  private static get loadingQueue() { return this._state.loadingQueue; }
  private static get totalToLoad() { return this._state.totalToLoad; }
  private static set totalToLoad(val: number) { this._state.totalToLoad = val; }
  private static get loadedCount() { return this._state.loadedCount; }
  private static set loadedCount(val: number) { this._state.loadedCount = val; }

  /**
   * Queue an image for loading.
   * @param tag Unique tag to reference the image later.
   * @param src Path to the image file.
   */
  static queueImage(tag: string, src: string) {
    if (this.assets.has(tag) || this.loadingQueue.has(tag)) return;
    
    this.loadingQueue.set(tag, src);
    this.totalToLoad++;
  }

  /**
   * Start loading all queued assets.
   * @param onProgress Optional callback for loading progress updates.
   */
  static async loadAll(onProgress?: (percent: number) => void): Promise<void> {
    if (this.loadingQueue.size === 0) return Promise.resolve();
    const generation = this.generation;

    const promises = Array.from(this.loadingQueue.entries()).map(([tag, src]) => {
      return new Promise<void>((resolve, reject) => {
        const img = new Image();
        img.src = src;
        img.onload = () => {
          if (generation !== this.generation) {
            resolve();
            return;
          }
          this.assets.set(tag, img);
          this.loadedCount++;
          if (onProgress) {
            onProgress((this.loadedCount / this.totalToLoad) * 100);
          }
          resolve();
        };
        img.onerror = () => {
          if (generation !== this.generation) {
            resolve();
            return;
          }
          console.error(`Failed to load asset: ${src}`);
          reject();
        };
      });
    });

    await Promise.all(promises);
    if (generation !== this.generation) {
      throw new DOMException('The asset load was cancelled.', 'AbortError');
    }
    this.loadingQueue.clear();
    this.totalToLoad = 0;
    this.loadedCount = 0;
  }

  /**
   * Get a loaded asset by its tag.
   * @param tag The tag used when queuing the asset.
   * @returns The loaded HTMLImageElement.
   */
  static getImage(tag: string): HTMLImageElement {
    const asset = this.assets.get(tag);
    if (!asset) {
      throw new Error(`Asset not found: ${tag}. Make sure it is queued and loaded.`);
    }
    return asset;
  }

  /**
   * Returns all loaded assets.
   * @returns An array of { tag, image } objects.
   */
  static getLoadedAssets(): { tag: string, image: HTMLImageElement }[] {
    return Array.from(this.assets.entries()).map(([tag, image]) => ({
      tag,
      image
    }));
  }

  /**
   * Clears all loaded assets and the loading queue.
   */
  static clear() {
    this.generation++;
    this.assets.clear();
    this.loadingQueue.clear();
    this.totalToLoad = 0;
    this.loadedCount = 0;
  }
}
