describe('Sound', () => {
  const audioDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
  const fetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch');

  const expose = (name: string, value: unknown) => {
    Object.defineProperty(globalThis, name, { configurable: true, value });
  };

  const restore = (name: string, descriptor?: PropertyDescriptor) => {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  };

  beforeEach(() => jest.resetModules());
  afterEach(() => {
    restore('AudioContext', audioDescriptor);
    restore('fetch', fetchDescriptor);
  });

  const createBackend = () => {
    const gains = Array.from({ length: 3 }, () => ({ gain: { value: 1 }, connect: jest.fn() }));
    const makeSource = () => ({
      buffer: null, loop: false, onended: null as (() => void) | null,
      start: jest.fn(), stop: jest.fn(), connect: jest.fn(), disconnect: jest.fn(),
    });
    const sources = [makeSource(), makeSource(), makeSource()];
    const buffer = {};
    let gainIndex = 0;
    let sourceIndex = 0;
    const audio = {
      state: 'suspended',
      destination: {},
      resume: jest.fn(async () => { audio.state = 'running'; }),
      createGain: jest.fn(() => gains[gainIndex++]),
      createBufferSource: jest.fn(() => sources[sourceIndex++]),
      decodeAudioData: jest.fn().mockResolvedValue(buffer),
    };
    expose('AudioContext', jest.fn(() => audio));
    expose('fetch', jest.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) }));
    return { audio, buffer, gains, sources };
  };

  it('routes music and effects through independent gains and plays each shot on a fresh source', async () => {
    const { audio, buffer, gains, sources } = createBackend();
    const { default: Sound } = await import('./Sound.js');
    Sound.setVolume('music', 0.25);
    expect(await Sound.unlock()).toBe(true);
    const sound = await Sound.load('/sound.wav');

    sound.play();
    sound.play();
    const stopLoop = sound.play({ loop: true, channel: 'music' });
    Sound.setVolume('master', 0.5);
    Sound.setVolume('effects', 0);
    expect(audio.createBufferSource).toHaveBeenCalledTimes(3);
    const master = gains.find(gain => gain.connect.mock.calls[0]?.[0] === audio.destination);
    const music = gains.find(gain => gain.gain.value === 0.25);
    const effects = gains.find(gain => gain.gain.value === 0);
    expect(master?.gain.value).toBe(0.5);
    expect(music?.connect).toHaveBeenCalledWith(master);
    expect(effects?.connect).toHaveBeenCalledWith(master);
    expect(sources[0].connect).toHaveBeenCalledWith(effects);
    expect(sources[1].start).toHaveBeenCalledTimes(1);
    expect(sources[2].connect).toHaveBeenCalledWith(music);
    expect(sources[2].buffer).toBe(buffer);
    expect(sources[2].loop).toBe(true);
    stopLoop();
    stopLoop();
    expect(sources[2].stop).toHaveBeenCalledTimes(1);
    expect(sources[2].disconnect).toHaveBeenCalledTimes(1);
  });

  it('returns false without Web Audio and does not play while the context is suspended', async () => {
    const { default: Sound } = await import('./Sound.js');
    expose('AudioContext', undefined);
    expect(await Sound.unlock()).toBe(false);
    const { audio } = createBackend();
    audio.resume.mockRejectedValueOnce(new Error('Gesture required'));
    expect(await Sound.unlock()).toBe(false);
    const sound = await Sound.load('/sound.wav');
    sound.play()();
    expect(audio.createBufferSource).not.toHaveBeenCalled();
  });

  it('reports decode failure without starting playback', async () => {
    const { audio } = createBackend();
    const { default: Sound } = await import('./Sound.js');
    audio.decodeAudioData.mockRejectedValueOnce(new Error('Invalid audio'));
    await expect(Sound.load('/bad.wav')).rejects.toThrow('Invalid audio');
    expect(audio.createBufferSource).not.toHaveBeenCalled();
  });
});
