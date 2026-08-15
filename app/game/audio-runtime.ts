import type { WorldMetadata, WorldSnapshot } from "./world-store";

const BGM_URL = "/midnight-tile-loop.mp3";
export const VOLUME_LEVELS = [0, 0.3, 0.58, 0.9] as const;

type AudioContextFactory = () => AudioContext | null;

export class AudioRuntime {
  #audio: HTMLAudioElement | null = null;
  #context: AudioContext | null = null;
  #volumeLevel = 1;
  #createAudio: (url: string) => HTMLAudioElement;
  #createContext: AudioContextFactory;

  constructor(
    createAudio: (url: string) => HTMLAudioElement = (url) => new Audio(url),
    createContext: AudioContextFactory = () => {
      if (typeof window === "undefined") return null;
      return new window.AudioContext();
    },
  ) {
    this.#createAudio = createAudio;
    this.#createContext = createContext;
  }

  get volumeLevel() {
    return this.#volumeLevel;
  }

  start(metadata: WorldMetadata | null, clock: WorldSnapshot | null) {
    const audio = this.#ensureAudio();
    this.#ensureContext()?.resume().catch(() => undefined);
    if (metadata && clock) this.sync(metadata, clock, true);
    if (this.#volumeLevel > 0) audio.play().catch(() => undefined);
  }

  cycle(metadata: WorldMetadata | null, clock: WorldSnapshot | null) {
    this.#volumeLevel = this.#volumeLevel === 3 ? 0 : this.#volumeLevel + 1;
    const audio = this.#ensureAudio();
    if (this.#volumeLevel === 0) audio.pause();
    else {
      audio.volume = VOLUME_LEVELS[this.#volumeLevel];
      this.start(metadata, clock);
    }
    return this.#volumeLevel;
  }

  sync(metadata: WorldMetadata, clock: WorldSnapshot, force = false) {
    const audio = this.#audio;
    if (!audio) return;
    const duration = metadata.bgmDurationMs / 1000;
    const expected =
      ((((clock.serverTime - metadata.worldEpochMs) / 1000 +
        metadata.bgmSnareOffsetMs / 1000) %
        duration) +
        duration) %
      duration;
    const apply = () => {
      const delta = ((audio.currentTime - expected + duration * 1.5) % duration) - duration / 2;
      const drift = Math.abs(delta);
      if (force || drift > 0.35) audio.currentTime = expected;
      else audio.playbackRate = drift > 0.04 ? (delta > 0 ? 0.985 : 1.015) : 1;
      if (this.#volumeLevel > 0 && audio.paused) audio.play().catch(() => undefined);
    };
    if (audio.readyState >= 1) apply();
    else audio.addEventListener("loadedmetadata", apply, { once: true });
  }

  playMove() {
    const context = this.#readyContext();
    if (!context) return false;
    const startAt = context.currentTime;
    this.#playTone(context, startAt, 0.045, 470, 680, "sine", 0.16);
    this.#playTone(context, startAt + 0.055, 0.05, 720, 520, "sine", 0.13);
    return true;
  }

  playExplosion() {
    const context = this.#readyContext();
    if (!context) return false;
    this.#playTone(
      context,
      context.currentTime,
      0.26,
      150,
      42,
      "sawtooth",
      0.28,
    );
    return true;
  }

  dispose() {
    this.#audio?.pause();
    this.#audio = null;
    this.#context?.close().catch(() => undefined);
    this.#context = null;
  }

  #ensureAudio() {
    if (!this.#audio) {
      this.#audio = this.#createAudio(BGM_URL);
      this.#audio.loop = true;
      this.#audio.preload = "auto";
      this.#audio.volume = VOLUME_LEVELS[this.#volumeLevel];
    }
    return this.#audio;
  }

  #ensureContext() {
    if (!this.#context) this.#context = this.#createContext();
    return this.#context;
  }

  #readyContext() {
    if (this.#volumeLevel === 0) return null;
    const context = this.#ensureContext();
    if (!context) return null;
    context.resume().catch(() => undefined);
    return context;
  }

  #playTone(
    context: AudioContext,
    startAt: number,
    duration: number,
    startFrequency: number,
    endFrequency: number,
    type: OscillatorType,
    gainAmount: number,
  ) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const endAt = startAt + duration;
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(startFrequency, startAt);
    oscillator.frequency.exponentialRampToValueAtTime(endFrequency, endAt);
    gain.gain.setValueAtTime(
      gainAmount * VOLUME_LEVELS[this.#volumeLevel],
      startAt,
    );
    gain.gain.exponentialRampToValueAtTime(0.0001, endAt);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(startAt);
    oscillator.stop(endAt);
  }
}
