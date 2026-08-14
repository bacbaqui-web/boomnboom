import type { WorldMetadata, WorldSnapshot } from "./world-store";

const BGM_URL = "/midnight-tile-loop.mp3";
export const VOLUME_LEVELS = [0, 0.3, 0.58, 0.9] as const;

export class AudioRuntime {
  #audio: HTMLAudioElement | null = null;
  #volumeLevel = 1;
  #createAudio: (url: string) => HTMLAudioElement;

  constructor(createAudio: (url: string) => HTMLAudioElement = (url) => new Audio(url)) {
    this.#createAudio = createAudio;
  }

  get volumeLevel() {
    return this.#volumeLevel;
  }

  start(metadata: WorldMetadata | null, clock: WorldSnapshot | null) {
    const audio = this.#ensureAudio();
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

  dispose() {
    this.#audio?.pause();
    this.#audio = null;
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
}
