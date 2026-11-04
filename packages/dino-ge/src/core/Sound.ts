export type SoundChannel = 'music' | 'effects';
export type SoundVolumeChannel = 'master' | SoundChannel;

export interface SoundPlaybackOptions {
  loop?: boolean;
  channel?: SoundChannel;
}

/** A decoded sound that can be played repeatedly through the engine's audio mixer. */
export default class Sound {
  private static mixer?: { context: AudioContext; gains: Record<SoundVolumeChannel, GainNode> };
  private static paused = false;
  private static unlocked = false;
  private static readonly volume: Record<SoundVolumeChannel, number> = {
    master: 1,
    music: 1,
    effects: 1,
  };

  private constructor(private readonly buffer: AudioBuffer) {}

  private static getMixer() {
    if (Sound.mixer) return Sound.mixer;
    if (typeof AudioContext === 'undefined') return undefined;

    const context = new AudioContext();
    const master = context.createGain();
    const music = context.createGain();
    const effects = context.createGain();
    master.connect(context.destination);
    music.connect(master);
    effects.connect(master);

    const gains = { master, music, effects };
    master.gain.value = Sound.volume.master;
    music.gain.value = Sound.volume.music;
    effects.gain.value = Sound.volume.effects;
    Sound.mixer = { context, gains };
    return Sound.mixer;
  }

  /** Call from a user gesture. Returns false if playback is unavailable. */
  static async unlock(): Promise<boolean> {
    try {
      const context = Sound.getMixer()?.context;
      if (!context) return false;
      if (Sound.unlocked && Sound.paused) return true;
      if (context.state !== 'running') await context.resume();
      if (context.state !== 'running') return false;
      Sound.unlocked = true;
      if (Sound.paused) await context.suspend();
      return true;
    } catch {
      return false;
    }
  }

  /** Suspends or resumes the mixer without restarting any sources. */
  static async setPaused(paused: boolean): Promise<void> {
    Sound.paused = paused;
    const context = Sound.mixer?.context;
    if (!context || !Sound.unlocked || context.state === 'closed') return;
    try {
      if (paused) await context.suspend();
      else await context.resume();
    } catch {
      // Playback may remain unavailable until the next user gesture.
    }
  }

  /** Fetches and decodes an audio file using the browser's supported formats. */
  static async load(url: string): Promise<Sound> {
    const context = Sound.getMixer()?.context;
    if (!context) throw new Error('Web Audio is unavailable.');

    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not load sound (HTTP ${response.status}): ${url}`);
    return new Sound(await context.decodeAudioData(await response.arrayBuffer()));
  }

  /** Sets a gain level between zero and one. Zero mutes the channel. */
  static setVolume(channel: SoundVolumeChannel, level: number): void {
    if (!Number.isFinite(level)) return;
    const value = Math.max(0, Math.min(1, level));
    Sound.volume[channel] = value;
    if (Sound.mixer) Sound.mixer.gains[channel].gain.value = value;
  }

  /** Starts playback and returns a function that stops that playback. */
  play({ loop = false, channel = 'effects' }: SoundPlaybackOptions = {}): () => void {
    const mixer = Sound.mixer;
    if (!mixer || !Sound.unlocked ||
        (mixer.context.state !== 'running' && !Sound.paused)) return () => {};

    const source = mixer.context.createBufferSource();
    source.buffer = this.buffer;
    source.loop = loop;
    source.connect(mixer.gains[channel]);
    let ended = false;
    const cleanup = () => {
      if (ended) return;
      ended = true;
      source.onended = null;
      source.disconnect();
    };

    source.onended = cleanup;
    source.start();
    return () => {
      if (ended) return;
      source.stop();
      cleanup();
    };
  }
}
