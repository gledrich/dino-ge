import ResourceLoader from './Loader.js';

describe('ResourceLoader', () => {
  const getPrivateState = () => (ResourceLoader as unknown as { _state: { totalToLoad: number, loadingQueue: Map<string, string>, assets: Map<string, HTMLImageElement>, loadedCount: number } })._state;

  beforeEach(() => {
    ResourceLoader.clear();
    jest.clearAllMocks();
  });

  it('queues images correctly', () => {
    ResourceLoader.queueImage('test', 'test.png');
    expect(getPrivateState().totalToLoad).toBe(1);
    expect(getPrivateState().loadingQueue.size).toBe(1);
    expect(getPrivateState().loadingQueue.get('test')).toBe('test.png');
  });

  it('prevents duplicate queuing of the same tag', () => {
    ResourceLoader.queueImage('test', 'test.png');
    ResourceLoader.queueImage('test', 'other.png');
    expect(getPrivateState().totalToLoad).toBe(1);
  });

  it('loads queued assets and triggers callback', async () => {
    // Mock Image and its onload behaviour
    const mockImageInstance = {
      set src(_val: string) {
        setTimeout(() => {
          if (this.onload) this.onload();
        }, 0);
      },
      onload: null as (() => void) | null
    };
    
    const originalImage = global.Image;
    global.Image = jest.fn(() => mockImageInstance) as unknown as typeof Image;

    ResourceLoader.queueImage('dino', 'dino.png');
    
    const onProgress = jest.fn();
    await ResourceLoader.loadAll(onProgress);

    expect(onProgress).toHaveBeenCalledWith(100);
    expect(ResourceLoader.getImage('dino')).toBeDefined();

    global.Image = originalImage;
  });

  it('handles image loading errors', async () => {
    // Mock Image and its onerror behaviour
    const mockImageInstance = {
      set src(_val: string) {
        setTimeout(() => {
          if (this.onerror) this.onerror();
        }, 0);
      },
      onerror: null as (() => void) | null
    };
    
    const originalImage = global.Image;
    global.Image = jest.fn(() => mockImageInstance) as unknown as typeof Image;
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    ResourceLoader.queueImage('fail', 'fail.png');
    
    await expect(ResourceLoader.loadAll()).rejects.toBeUndefined();
    expect(consoleSpy).toHaveBeenCalledWith('Failed to load asset: fail.png');

    global.Image = originalImage;
    consoleSpy.mockRestore();
  });

  it('loads queued assets without progress callback', async () => {
    // Mock Image and its onload behaviour
    const mockImageInstance = {
      set src(_val: string) {
        setTimeout(() => {
          if (this.onload) this.onload();
        }, 0);
      },
      onload: null as (() => void) | null
    };
    
    const originalImage = global.Image;
    global.Image = jest.fn(() => mockImageInstance) as unknown as typeof Image;

    ResourceLoader.queueImage('dino2', 'dino2.png');
    
    await ResourceLoader.loadAll(); // No onProgress passed

    expect(ResourceLoader.getImage('dino2')).toBeDefined();

    global.Image = originalImage;
  });

  it('returns immediately from loadAll if queue is empty', async () => {
    const onProgress = jest.fn();
    await ResourceLoader.loadAll(onProgress);
    expect(onProgress).not.toHaveBeenCalled();
  });

  it('prevents queuing if asset already exists in assets map', () => {
    const mockImg = {} as HTMLImageElement;
    getPrivateState().assets.set('existing', mockImg);
    
    ResourceLoader.queueImage('existing', 'test.png');
    expect(getPrivateState().totalToLoad).toBe(0);
  });

  it('throws error if asset not found', () => {
    expect(() => ResourceLoader.getImage('missing')).toThrow();
  });

  it('returns all loaded assets', () => {
    const mockImg = { src: 'dino.png' } as HTMLImageElement;
    getPrivateState().assets.set('dino', mockImg);
    
    const loaded = ResourceLoader.getLoadedAssets();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toEqual({ tag: 'dino', image: mockImg });
  });

  it('clears all assets and queue', () => {
    ResourceLoader.queueImage('test', 'test.png');
    getPrivateState().assets.set('loaded', {} as HTMLImageElement);
    
    ResourceLoader.clear();
    
    expect(getPrivateState().assets.size).toBe(0);
    expect(getPrivateState().loadingQueue.size).toBe(0);
    expect(getPrivateState().totalToLoad).toBe(0);
    expect(getPrivateState().loadedCount).toBe(0);
  });

  it('does not let a stopped game replace an asset loaded by the next game', async () => {
    const originalImage = global.Image;
    const images: { src?: string; onload?: () => void }[] = [];
    global.Image = jest.fn(() => {
      const image = {};
      images.push(image);
      return image;
    }) as unknown as typeof Image;

    try {
      ResourceLoader.queueImage('player', 'old-player.png');
      const cancelled = expect(ResourceLoader.loadAll()).rejects.toMatchObject({ name: 'AbortError' });
      ResourceLoader.clear();
      ResourceLoader.queueImage('player', 'new-player.png');
      const active = ResourceLoader.loadAll();
      images[1].onload?.();
      await active;
      images[0].onload?.();
      await cancelled;
      expect(ResourceLoader.getImage('player').src).toBe('new-player.png');
    } finally {
      global.Image = originalImage;
    }
  });
});
