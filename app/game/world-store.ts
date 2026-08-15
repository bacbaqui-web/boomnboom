import type { ConnectionStatus, ServerMessage } from "./protocol.ts";
import { applyWorldMessage, type ApplyResult } from "./world-message-applier.ts";
import { canEnterWorldCell, knownChunkRevisions } from "./world-selectors.ts";
import {
  createWorldRuntimeState,
  updateWorldSnapshot,
} from "./world-state.ts";

export type {
  ChunkState,
  EntitySnapshot,
  WorldMetadata,
  WorldSnapshot,
} from "./world-state.ts";
export type { ApplyResult } from "./world-message-applier.ts";

type Listener = () => void;

export class ClientWorldStore {
  #state = createWorldRuntimeState();
  #listeners = new Set<Listener>();
  #chunkListeners = new Map<string, Set<Listener>>();
  #entityListeners = new Set<Listener>();

  subscribe = (listener: Listener) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  subscribeEntities = (listener: Listener) => {
    this.#entityListeners.add(listener);
    return () => this.#entityListeners.delete(listener);
  };

  subscribeChunk(chunkKey: string, listener: Listener) {
    const listeners = this.#chunkListeners.get(chunkKey) ?? new Set<Listener>();
    listeners.add(listener);
    this.#chunkListeners.set(chunkKey, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.#chunkListeners.delete(chunkKey);
    };
  }

  getSnapshot = () => this.#state.snapshot;
  getServerSnapshot = () => this.#state.snapshot;
  getEntitySnapshot = () => this.#state.entitySnapshot;
  getChunk = (chunkKey: string) => this.#state.chunks.get(chunkKey) ?? null;

  canEnterCell(x: number, y: number, localPlayerId = this.#state.snapshot.localPlayerId) {
    return canEnterWorldCell(this.#state, x, y, localPlayerId);
  }

  getKnownChunkRevisions() {
    return knownChunkRevisions(this.#state);
  }

  setConnection(connection: ConnectionStatus) {
    if (this.#state.snapshot.connection === connection) return;
    updateWorldSnapshot(this.#state, { connection });
    this.#emitGlobal();
  }

  apply(message: ServerMessage): ApplyResult {
    const effects = applyWorldMessage(this.#state, message);
    if (!effects.result.applied) return effects.result;
    for (const chunkKey of effects.changedChunks) this.#emitChunk(chunkKey);
    if (effects.globalChanged) this.#emitGlobal();
    if (effects.entitiesChanged) this.#emitEntities();
    return effects.result;
  }

  #emitGlobal() {
    for (const listener of this.#listeners) listener();
  }

  #emitChunk(chunkKey: string) {
    for (const listener of this.#chunkListeners.get(chunkKey) ?? []) listener();
  }

  #emitEntities() {
    for (const listener of this.#entityListeners) listener();
  }
}
