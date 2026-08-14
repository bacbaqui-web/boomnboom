import { parseServerMessage, type Action, withProtocolQuery } from "./protocol.ts";
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
  #clientSeq = 0;

  constructor({
    store,
    url = ORACLE_WS_URL,
    createSocket = (socketUrl, protocol) => new WebSocket(socketUrl, protocol),
  }: {
    store: ClientWorldStore;
    url?: string;
    createSocket?: SocketFactory;
  }) {
    this.#store = store;
    this.#url = url;
    this.#createSocket = createSocket;
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

  #open() {
    this.#store.setConnection("connecting");
    const socket = this.#createSocket(withProtocolQuery(this.#url), "boom-v2");
    this.#socket = socket;
    socket.onopen = () => undefined;
    socket.onmessage = (event) => this.#handleMessage(event.data);
    socket.onerror = () => undefined;
    socket.onclose = () => {
      if (this.#socket !== socket) return;
      this.#store.setConnection("offline");
      this.#socket = null;
      if (!this.#stopped) this.#retryTimer = setTimeout(() => this.#open(), 1500);
    };
  }

  #handleMessage(raw: unknown) {
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

  #sendJoin() {
    if (!this.#nickname || !this.#sessionId) return;
    this.#send({ protocol: 2, type: "join", nickname: this.#nickname });
  }

  #send(message: object) {
    if (this.#socket?.readyState === 1) {
      this.#socket.send(JSON.stringify(message));
      return true;
    }
    return false;
  }
}
