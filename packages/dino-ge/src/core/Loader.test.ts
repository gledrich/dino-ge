import ResourceLoader from './Loader.js';
import Sound from './Sound.js';

describe('ResourceLoader', () => {
  const originalImage = globalThis.Image;
  const originalFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');

  beforeEach(() => ResourceLoader.clear());
  afterEach(() => {
    globalThis.Image = originalImage;
    if (originalFetch) Object.defineProperty(globalThis, 'fetch', originalFetch);
    else Reflect.deleteProperty(globalThis, 'fetch');
    jest.restoreAllMocks();
  });

  function controlImages() {
    const images: { src?: string; onload?: () => void; onerror?: () => void }[] = [];
    globalThis.Image = jest.fn(() => {
      const image = {};
      images.push(image);
      return image;
    }) as unknown as typeof Image;
    return images;
  }

  function mockFetch(fetch: unknown) {
    Object.defineProperty(globalThis, 'fetch', { configurable: true, value: fetch });
  }

  it('keeps the first queued image for a tag and never reloads it after success', async () => {
    const images = controlImages();
    ResourceLoader.queueImage('dino', 'first.png');
    ResourceLoader.queueImage('dino', 'second.png');
    const loading = ResourceLoader.loadAll();
    images[0].onload?.();
    await loading;
    ResourceLoader.queueImage('dino', 'third.png');
    await ResourceLoader.loadAll();
    expect(images).toHaveLength(1);
    expect(ResourceLoader.getImage('dino').src).toBe('first.png');
    expect(ResourceLoader.getLoadedAssets()).toEqual([{ tag: 'dino', image: images[0] }]);
  });

  it('reports image failures and retries the same source', async () => {
    const images = controlImages();
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    ResourceLoader.queueImage('fail', 'fail.png');
    const first = ResourceLoader.loadAll();
    images[0].onerror?.();
    await expect(first).rejects.toBeUndefined();
    expect(consoleSpy).toHaveBeenCalledWith('Failed to load asset: fail.png');

    const retry = ResourceLoader.loadAll();
    expect(images[1].src).toBe('fail.png');
    images[1].onload?.();
    await retry;
    expect(ResourceLoader.getImage('fail')).toBe(images[1]);
  });

  it('returns immediately from loadAll if queue is empty', async () => {
    const onProgress = jest.fn();
    await ResourceLoader.loadAll(onProgress);
    expect(onProgress).not.toHaveBeenCalled();
  });

  it('throws if an image has not been loaded', () => {
    expect(() => ResourceLoader.getImage('missing')).toThrow();
  });

  it('loads JSON and sound alongside images with one progress stream', async () => {
    const images = controlImages();
    const sound = Object.create(Sound.prototype) as Sound;
    const loadSound = jest.spyOn(Sound, 'load').mockResolvedValue(sound);
    const fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ width: 12 }) });
    mockFetch(fetch);

    ResourceLoader.queueImage('room', 'atlas.png');
    ResourceLoader.queueJson('room', 'room.json');
    ResourceLoader.queueSound('effect', 'chime.wav');
    const progress: number[] = [];
    const loading = ResourceLoader.loadAll(percent => progress.push(percent));
    images[0].onload?.();
    await loading;

    expect(progress.map(Math.round)).toEqual([33, 67, 100]);
    expect(ResourceLoader.getJson<{ width: number }>('room').width).toBe(12);
    expect(ResourceLoader.getSound('effect')).toBe(sound);
    expect(loadSound).toHaveBeenCalledWith('chime.wav');
    expect(ResourceLoader.getLoadedAssets()).toEqual([{ tag: 'room', image: images[0] }]);
  });

  it('shares in-flight assets while retaining each caller’s queue snapshot', async () => {
    const images = controlImages();
    ResourceLoader.queueImage('first', 'first.png');
    const firstProgress = jest.fn();
    const first = ResourceLoader.loadAll(firstProgress);
    ResourceLoader.queueImage('second', 'second.png');
    const secondProgress = jest.fn();
    const second = ResourceLoader.loadAll(secondProgress);
    expect(images).toHaveLength(2);
    images[0].onload?.();
    await first;
    expect(firstProgress.mock.calls).toEqual([[100]]);
    expect(secondProgress.mock.calls).toEqual([[50]]);
    expect(() => ResourceLoader.getImage('second')).toThrow();
    images[1].onload?.();
    await second;
    expect(secondProgress.mock.calls).toEqual([[50], [100]]);
  });

  it('leaves assets queued during a load for the next batch', async () => {
    const images = controlImages();
    ResourceLoader.queueImage('first', 'first.png');
    const first = ResourceLoader.loadAll();
    ResourceLoader.queueImage('later', 'later.png');
    images[0].onload?.();
    await first;
    const second = ResourceLoader.loadAll();
    expect(images.map(image => image.src)).toEqual(['first.png', 'later.png']);
    images[1].onload?.();
    await second;
  });

  it('keeps successes and retries failed assets without queueing them again', async () => {
    const images = controlImages();
    const fetch = jest.fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: true, json: async () => null });
    mockFetch(fetch);
    ResourceLoader.queueImage('atlas', 'atlas.png');
    ResourceLoader.queueJson('room', 'room.json');
    const first = ResourceLoader.loadAll();
    images[0].onload?.();
    await expect(first).rejects.toThrow(/503/);
    expect(ResourceLoader.getImage('atlas')).toBe(images[0]);
    expect(() => ResourceLoader.getJson('room')).toThrow();
    await ResourceLoader.loadAll();
    expect(ResourceLoader.getJson('room')).toBeNull();
    expect(images).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('clears queued and loaded assets of every kind', async () => {
    const images = controlImages();
    mockFetch(jest.fn().mockResolvedValue({ ok: true, json: async () => true }));
    jest.spyOn(Sound, 'load').mockResolvedValue(Object.create(Sound.prototype) as Sound);
    ResourceLoader.queueImage('atlas', 'atlas.png');
    ResourceLoader.queueJson('room', 'room.json');
    ResourceLoader.queueSound('chime', 'chime.wav');
    const loading = ResourceLoader.loadAll();
    images[0].onload?.();
    await loading;
    ResourceLoader.queueImage('later', 'later.png');
    ResourceLoader.clear();
    await ResourceLoader.loadAll();
    expect(ResourceLoader.getLoadedAssets()).toEqual([]);
    expect(() => ResourceLoader.getJson('room')).toThrow();
    expect(() => ResourceLoader.getSound('chime')).toThrow();
    expect(images).toHaveLength(1);
  });

  it('does not let a stopped game replace an image loaded by the next game', async () => {
    const images = controlImages();
    ResourceLoader.queueImage('player', 'old-player.png');
    const cancelled = expect(ResourceLoader.loadAll()).rejects.toMatchObject({ name: 'AbortError' });
    ResourceLoader.clear();
    await cancelled;

    ResourceLoader.queueImage('player', 'new-player.png');
    const active = ResourceLoader.loadAll();
    images[1].onload?.();
    await active;
    images[0].onload?.();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(ResourceLoader.getImage('player').src).toBe('new-player.png');
  });

  it('ignores a late audio decode after clearing a mixed batch', async () => {
    const oldSound = Object.create(Sound.prototype) as Sound;
    const newSound = Object.create(Sound.prototype) as Sound;
    let finishOldSound!: (sound: Sound) => void;
    const oldDecode = new Promise<Sound>(resolve => { finishOldSound = resolve; });
    jest.spyOn(Sound, 'load').mockReturnValueOnce(oldDecode).mockResolvedValueOnce(newSound);
    const fetch = jest.fn(() => new Promise(() => {}));
    mockFetch(fetch);
    ResourceLoader.queueJson('room', 'room.json');
    ResourceLoader.queueSound('effect', 'old.wav');
    const progress = jest.fn();
    const cancelled = expect(ResourceLoader.loadAll(progress)).rejects.toMatchObject({ name: 'AbortError' });
    ResourceLoader.clear();
    await cancelled;
    expect(fetch).toHaveBeenCalledWith('room.json', { signal: expect.objectContaining({ aborted: true }) });

    ResourceLoader.queueSound('effect', 'new.wav');
    await ResourceLoader.loadAll();
    finishOldSound(oldSound);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(ResourceLoader.getSound('effect')).toBe(newSound);
    expect(progress).not.toHaveBeenCalled();
  });
});
