import { parseServerMessage, type Action, withProtocolQuery } from "./protocol.ts";
import { isNetTickAfter } from "../../shared/net-tick.mjs";
import { ClockSync } from "./clock-sync.ts";
import {
  isV3ActionResult,
  isV3OwnerSnapshot,
  isV3EntitySnapshot,
  isV3WorldEvent,
  parseV3ServerMessage,
  projectV3StoreMessage,
  type V3ActionResult,
  type V3ClientCommand,
  type V3EntitySnapshot,
  type V3OwnerSnapshot,
  type V3WorldEvent,
} from "./protocol-v3.ts";
import { ClientWorldStore } from "./world-store.ts";

export const ORACLE_WS_URL = "wss://insight.magamiscom.ing/boom-ws";

type SocketLike = {
  readyState: number;
  onopen: WebSocket["onopen"];
  onmessage: WebSocket["onmessage"];
  onclose: WebSocket["onclose"];
  onerror: WebSocket["onerror"];
  send(data: string): void;
  close(): void;
};

type SocketFactory = (url: string, protocol: string) => SocketLike;

export class GameSocket {
  #store: ClientWorldStore;
  #url: string;
  #createSocket: SocketFactory;
  #socket: SocketLike | null = null;
  #retryTimer: ReturnType<typeof setTimeout> | null = null;
  #stopped = false;
  #nickname = "";
  #sessionId = "";
  #resumeToken = "";
  #clientSeq = 0;
  #protocol: 2 | 3;
  #clockSync: ClockSync | null;
  #onV3OwnerSnapshot: (snapshot: V3OwnerSnapshot) => void;
  #onV3EntitySnapshot: (snapshot: V3EntitySnapshot) => void;
  #onV3Reset: () => void;
  #onV3CommandRejected: (commandSeq: number) => void;
  #onV3ActionResult: (result: V3ActionResult) => void;
  #onV3WorldEvent: (event: V3WorldEvent) => void;
  #lastWorldEventSeq: number | null = null;
  #baselineTick = 0;
  #readySent = false;
  #pingTimer: ReturnType<typeof setInterval> | null = null;

  constructor({
    store,
    url = ORACLE_WS_URL,
    createSocket = (socketUrl, protocol) => new WebSocket(socketUrl, protocol),
    protocol = 2,
    clockSync = null,
    onV3OwnerSnapshot = () => undefined,
    onV3EntitySnapshot = () => undefined,
    onV3Reset = () => undefined,
    onV3CommandRejected = () => undefined,
    onV3ActionResult = () => undefined,
    onV3WorldEvent = () => undefined,
  }: {
    store: ClientWorldStore;
    url?: string;
    createSocket?: SocketFactory;
    protocol?: 2 | 3;
    clockSync?: ClockSync | null;
    onV3OwnerSnapshot?: (snapshot: V3OwnerSnapshot) => void;
    onV3EntitySnapshot?: (snapshot: V3EntitySnapshot) => void;
    onV3Reset?: () => void;
    onV3CommandRejected?: (commandSeq: number) => void;
    onV3ActionResult?: (result: V3ActionResult) => void;
    onV3WorldEvent?: (event: V3WorldEvent) => void;
  }) {
    this.#store = store;
    this.#url = url;
    this.#createSocket = createSocket;
    this.#protocol = protocol;
    this.#clockSync = clockSync;
    this.#onV3OwnerSnapshot = onV3OwnerSnapshot;
    this.#onV3EntitySnapshot = onV3EntitySnapshot;
    this.#onV3Reset = onV3Reset;
    this.#onV3CommandRejected = onV3CommandRejected;
    this.#onV3ActionResult = onV3ActionResult;
    this.#onV3WorldEvent = onV3WorldEvent;
  }

  connect() {
    this.#stopped = false;
    this.#open();
  }

  disconnect() {
    this.#stopped = true;
    if (this.#retryTimer) clearTimeout(this.#retryTimer);
    this.#retryTimer = null;
    this.#socket?.close();
    this.#socket = null;
    this.#store.setConnection("offline");
    this.#stopPing();
    if (this.#protocol === 3) this.#onV3Reset();
  }

  join(nickname: string) {
    this.#nickname = nickname.trim().slice(0, 12);
    this.#sendJoin();
  }

  sendInput(action: Action) {
    if (!this.#store.getSnapshot().initialized) return -1;
    const clientSeq = this.#clientSeq + 1;
    if (!this.#send({ protocol: 2, type: "input", clientSeq, action })) return -1;
    this.#clientSeq = clientSeq;
    return clientSeq;
  }

  respawn() {
    const clientSeq = this.#clientSeq + 1;
    if (!this.#send({ protocol: 2, type: "respawn", clientSeq })) return -1;
    this.#clientSeq = clientSeq;
    return clientSeq;
  }

  sendV3Input(command: V3ClientCommand) {
    if (
      this.#protocol !== 3 ||
      !this.#store.getSnapshot().initialized ||
      !this.#readySent
    ) return false;
    return this.#send(command);
  }

  #open() {
    this.#store.setConnection("connecting");
    const socket = this.#createSocket(
      withProtocolQuery(this.#url, this.#protocol),
      this.#protocol === 3 ? "boom-v3" : "boom-v2",
    );
    this.#socket = socket;
    socket.onopen = () => undefined;
    socket.onmessage = (event) => this.#handleMessage(event.data);
    socket.onerror = () => undefined;
    socket.onclose = () => {
      if (this.#socket !== socket) return;
      this.#store.setConnection("offline");
      this.#socket = null;
      this.#readySent = false;
      this.#stopPing();
      if (this.#protocol === 3) this.#onV3Reset();
      if (!this.#stopped) this.#retryTimer = setTimeout(() => this.#open(), 1500);
    };
  }

  #handleMessage(raw: unknown) {
    if (this.#protocol === 3) {
      this.#handleV3Message(raw);
      return;
    }
    const message = parseServerMessage(typeof raw === "string" ? raw : String(raw));
    if (!message) return;
    if (message.type === "hello") {
      this.#sessionId = typeof message.sessionId === "string" ? message.sessionId : "";
      this.#clientSeq = 0;
      this.#store.apply(message);
      this.#store.setConnection("online");
      this.#sendJoin();
      return;
    }
    const result = this.#store.apply(message);
    if (result.applied === false && result.reason === "chunk_gap") {
      this.#send({
        protocol: 2,
        type: "chunk_resync",
        chunkKey: result.chunkKey,
        revision: result.revision,
      });
      return;
    }
    if (message.type === "entity_snapshot") {
      this.#send({
        protocol: 2,
        type: "ready",
        knownChunkRevisions: this.#store.getKnownChunkRevisions(),
      });
    }
  }

  #handleV3Message(raw: unknown) {
    const message = parseV3ServerMessage(typeof raw === "string" ? raw : String(raw));
    if (!message) return;
    const receivedAt = Date.now();
    if (message.type === "hello" || message.type === "world_init") this.#clockSync?.reset();
    this.#clockSync?.recordEnvelope(message.serverTick, message.serverTimeMs, receivedAt);
    if (message.type === "pong") {
      this.#clockSync?.recordPong({
        clientTimeMs: Number(message.clientTimeMs) || receivedAt,
        serverTimeMs: message.serverTimeMs,
        serverTick: message.serverTick,
        receivedAt,
      });
    }
    if (message.type === "hello") {
      this.#sessionId = typeof message.sessionId === "string" ? message.sessionId : "";
      this.#readySent = false;
      this.#lastWorldEventSeq = null;
      const projected = projectV3StoreMessage(message);
      if (projected) this.#store.apply(projected);
      this.#store.setConnection("online");
      if (this.#resumeToken) {
        this.#send({ protocol: 3, type: "resume", resumeToken: this.#resumeToken });
      } else {
        this.#sendJoin();
      }
      return;
    }
    if (message.type === "join_result" && message.accepted === true) {
      this.#resumeToken = typeof message.resumeToken === "string" ? message.resumeToken : "";
    }
    if (message.type === "resume_result") {
      if (message.accepted === true) {
        this.#resumeToken = typeof message.resumeToken === "string" ? message.resumeToken : "";
      } else {
        this.#resumeToken = "";
        this.#sendJoin();
        return;
      }
    }
    const projected = projectV3StoreMessage(message);
    const result = projected ? this.#store.apply(projected) : { applied: true as const };
    if (result.applied === false && result.reason === "chunk_gap") {
      this.#send({
        protocol: 3,
        type: "chunk_resync",
        chunkKey: result.chunkKey,
        revision: result.revision,
      });
      return;
    }
    if (message.type === "world_init") {
      this.#baselineTick = Number(message.baselineTick) >>> 0;
      this.#sendPing();
      this.#startPing();
    }
    if (isV3OwnerSnapshot(message) && result.applied) this.#onV3OwnerSnapshot(message);
    if (isV3EntitySnapshot(message) && result.applied) this.#onV3EntitySnapshot(message);
    if (isV3ActionResult(message)) this.#onV3ActionResult(message);
    if (
      isV3WorldEvent(message) &&
      (this.#lastWorldEventSeq === null ||
        isNetTickAfter(message.eventSeq, this.#lastWorldEventSeq))
    ) {
      this.#lastWorldEventSeq = message.eventSeq;
      this.#onV3WorldEvent(message);
    }
    if (message.type === "entity_snapshot" && !this.#readySent) {
      this.#readySent = this.#send({
        protocol: 3,
        type: "ready",
        baselineTick: this.#baselineTick,
        knownChunkRevisions: this.#store.getKnownChunkRevisions(),
      });
    }
    if (
      Number.isInteger(message.commandSeq) &&
      message.type === "error"
    ) {
      this.#onV3CommandRejected(Number(message.commandSeq));
    }
  }

  #sendJoin() {
    if (!this.#nickname || !this.#sessionId) return;
    this.#send({ protocol: this.#protocol, type: "join", nickname: this.#nickname });
  }

  #sendPing() {
    this.#send({ protocol: 3, type: "ping", clientTimeMs: Date.now() });
  }

  #startPing() {
    if (this.#pingTimer || this.#protocol !== 3) return;
    this.#pingTimer = setInterval(() => this.#sendPing(), 1000);
  }

  #stopPing() {
    if (this.#pingTimer) clearInterval(this.#pingTimer);
    this.#pingTimer = null;
  }

  #send(message: object) {
    if (this.#socket?.readyState === 1) {
      this.#socket.send(JSON.stringify(message));
      return true;
    }
    return false;
  }
}
