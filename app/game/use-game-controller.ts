"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AudioRuntime } from "./audio-runtime";
import { GameSocket } from "./game-socket";
import { MovementPrediction } from "./movement-prediction";
import type { Action, MoveAction, PlayerEntity } from "./protocol";
import { useGameInput } from "./use-game-input";
import { ClientWorldStore } from "./world-store";

export function useGameController() {
  const store = useMemo(() => new ClientWorldStore(), []);
  const socketRef = useRef<GameSocket | null>(null);
  const audioRef = useRef<AudioRuntime | null>(null);
  const predictionRef = useRef(new MovementPrediction());
  const [nickname, setNickname] = useState("");
  const [joined, setJoined] = useState(false);
  const [queuedAction, setQueuedAction] = useState<Action>("wait");
  const [volumeLevel, setVolumeLevel] = useState(1);
  const [localVisualPosition, setLocalVisualPosition] = useState<{ x: number; y: number } | null>(null);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  const entitySnapshot = useSyncExternalStore(
    store.subscribeEntities,
    store.getEntitySnapshot,
    store.getEntitySnapshot,
  );
  const localPlayer = entitySnapshot.entities.find(
    (entity): entity is PlayerEntity =>
      entity.kind === "player" && entity.id === snapshot.localPlayerId,
  );

  useEffect(() => {
    const socket = new GameSocket({ store });
    const audio = new AudioRuntime();
    socketRef.current = socket;
    audioRef.current = audio;
    socket.connect();
    return () => {
      socket.disconnect();
      audio.dispose();
    };
  }, [store]);

  useEffect(() => {
    if (snapshot.metadata && joined) audioRef.current?.sync(snapshot.metadata, snapshot);
  }, [joined, snapshot]);

  useEffect(() => {
    if (!localPlayer) return;
    const target = predictionRef.current.reconcile(snapshot.ackClientSeq, localPlayer);
    setLocalVisualPosition(target);
  }, [localPlayer, snapshot.ackClientSeq]);

  const sendAction = useCallback((action: Action) => {
    setQueuedAction(action === "stop" ? "wait" : action);
    const seq = socketRef.current?.sendInput(action) ?? -1;
    if (["up", "down", "left", "right"].includes(action)) {
      const target = predictionRef.current.enqueue(seq, action as MoveAction);
      setLocalVisualPosition(target);
    }
  }, []);
  const input = useGameInput(
    sendAction,
    joined && snapshot.initialized && snapshot.connection === "online" && Boolean(localPlayer?.alive),
  );

  const enterWorld = useCallback(
    (rawNickname: string) => {
      const clean = rawNickname.trim().slice(0, 12);
      if (!clean) return false;
      setNickname(clean);
      setJoined(true);
      predictionRef.current = new MovementPrediction();
      setLocalVisualPosition(null);
      socketRef.current?.join(clean);
      audioRef.current?.start(snapshot.metadata, snapshot);
      return true;
    },
    [snapshot],
  );

  const respawn = useCallback(() => socketRef.current?.respawn(), []);
  const cycleVolume = useCallback(() => {
    const level = audioRef.current?.cycle(snapshot.metadata, snapshot) ?? 1;
    setVolumeLevel(level);
  }, [snapshot]);

  return {
    store,
    snapshot,
    entitySnapshot,
    localPlayer,
    localVisualPosition,
    nickname,
    joined,
    queuedAction,
    volumeLevel,
    enterWorld,
    respawn,
    cycleVolume,
    ...input,
  };
}
