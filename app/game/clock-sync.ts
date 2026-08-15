import { isNetTickAfter } from "../../shared/net-tick.mjs";

const UINT32_SIZE = 0x1_0000_0000;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export class ClockSync {
  #stepMs: number;
  #serverTick = 0;
  #receivedAt = 0;
  #ready = false;
  #rttMs = 200;
  #jitterMs = 0;
  #bestRttMs = Number.POSITIVE_INFINITY;
  #serverOffsetMs = 0;
  #slackTicks = 2;
  #interpolationDelayMs = 100;

  constructor({ tickRate = 30, slackTicks = 2 } = {}) {
    this.#stepMs = 1000 / tickRate;
    this.#slackTicks = slackTicks;
  }

  reset() {
    this.#serverTick = 0;
    this.#receivedAt = 0;
    this.#ready = false;
    this.#rttMs = 200;
    this.#jitterMs = 0;
    this.#bestRttMs = Number.POSITIVE_INFINITY;
    this.#serverOffsetMs = 0;
    this.#interpolationDelayMs = 100;
  }

  recordEnvelope(serverTick: number, serverTimeMs: number, receivedAt = Date.now()) {
    if (!Number.isInteger(serverTick) || !Number.isFinite(serverTimeMs)) return;
    const normalizedTick = serverTick >>> 0;
    if (
      this.#ready &&
      normalizedTick !== this.#serverTick &&
      !isNetTickAfter(normalizedTick, this.#serverTick)
    ) {
      return;
    }
    this.#serverTick = normalizedTick;
    this.#receivedAt = receivedAt;
    this.#ready = true;
  }

  recordPong({
    clientTimeMs,
    serverTimeMs,
    serverTick,
    receivedAt = Date.now(),
  }: {
    clientTimeMs: number;
    serverTimeMs: number;
    serverTick: number;
    receivedAt?: number;
  }) {
    const sampleRtt = receivedAt - clientTimeMs;
    if (!Number.isFinite(sampleRtt) || sampleRtt < 0 || sampleRtt > 2000) return;
    const previousRtt = this.#rttMs;
    this.#rttMs += (sampleRtt - this.#rttMs) * 0.2;
    this.#jitterMs += (Math.abs(sampleRtt - previousRtt) - this.#jitterMs) * 0.2;
    const targetDelay = clamp(100 + this.#jitterMs * 1.5, 80, 150);
    this.#interpolationDelayMs += (targetDelay - this.#interpolationDelayMs) * 0.1;
    if (sampleRtt <= this.#bestRttMs) {
      this.#bestRttMs = sampleRtt;
      this.#serverOffsetMs = serverTimeMs - (clientTimeMs + receivedAt) / 2;
    }
    this.recordEnvelope(serverTick, serverTimeMs, receivedAt);
  }

  estimatedServerTick(now = Date.now()) {
    if (!this.#ready) return this.#serverTick;
    const elapsedTicks = Math.max(0, Math.floor((now - this.#receivedAt) / this.#stepMs));
    return (this.#serverTick + elapsedTicks) % UINT32_SIZE;
  }

  estimatedServerTickFloat(now = Date.now()) {
    if (!this.#ready) return this.#serverTick;
    const elapsedTicks = Math.max(0, now - this.#receivedAt) / this.#stepMs;
    return this.#serverTick + elapsedTicks + (this.#rttMs / 2) / this.#stepMs;
  }

  commandLeadTicks() {
    const jitterSlack = Math.ceil(this.#jitterMs / this.#stepMs);
    return clamp(
      Math.ceil((this.#rttMs / 2) / this.#stepMs) + this.#slackTicks + jitterSlack,
      1,
      12,
    );
  }

  targetTick(now: number, predictedTick: number) {
    const networkTarget = this.predictionTargetTick(now);
    const nextPredicted = (predictedTick + 1) >>> 0;
    const forward = (networkTarget - predictedTick) >>> 0;
    return forward > 0 && forward < 0x8000_0000 ? networkTarget : nextPredicted;
  }

  predictionTargetTick(now = Date.now()) {
    return (this.estimatedServerTick(now) + this.commandLeadTicks()) >>> 0;
  }

  get rttMs() {
    return this.#rttMs;
  }

  get jitterMs() {
    return this.#jitterMs;
  }

  get serverOffsetMs() {
    return this.#serverOffsetMs;
  }

  get interpolationDelayMs() {
    return this.#interpolationDelayMs;
  }
}
