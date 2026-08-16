"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AudioRuntime } from "./audio-runtime";
import { ClockSync } from "./clock-sync";
import { CommandTimeline } from "./command-timeline";
import { DeathEventPresenter, type DeathVisual } from "./death-event-presenter";
import {
  ExplosionEventPresenter,
  type ExplosionFlameVisual,
} from "./explosion-event-presenter";
import { GameSocket } from "./game-socket";
import { LocalMovementPredictor } from "./local-movement-predictor";
import { MovementPrediction } from "./movement-prediction";
import { resolveNetworkProtocol } from "./network-protocol";
import { PendingBombPresenter, type PendingBombVisual } from "./pending-bomb-presenter";
import type { PlayerColorId } from "./player-color";
import { PositionInterpolator } from "./position-interpolator";
import type {
  Action,
  BombEntity,
  FlameEntity,
  MoveAction,
  PlayerEntity,
} from "./protocol";
import type {
  V3ActionCommand,
  V3ActionResult,
  V3Direction,
  V3EntitySnapshot,
  V3OwnerSnapshot,
  V3WorldEvent,
} from "./protocol-v3";
import { RemoteSnapshotBuffer } from "./remote-snapshot-buffer";
import { useGameInput } from "./use-game-input";
import { ClientWorldStore } from "./world-store";

export function useGameController() {
  const store = useMemo(() => new ClientWorldStore(), []);
  const networkProtocol = useMemo<2 | 3>(() => {
    return resolveNetworkProtocol(typeof window === "undefined" ? "" : window.location.search);
  }, []);
  const socketRef = useRef<GameSocket | null>(null);
  const audioRef = useRef<AudioRuntime | null>(null);
  const predictionRef = useRef(new MovementPrediction());
  const predictionSessionRef = useRef({ playerId: "", ackClientSeq: -1, alive: false });
  const clockSyncRef = useRef(new ClockSync());
  const commandTimelineRef = useRef(new CommandTimeline());
  const localPredictorRef = useRef(new LocalMovementPredictor());
  const localRenderInterpolatorRef = useRef(new PositionInterpolator(1000 / 30));
  const remoteSnapshotBufferRef = useRef(new RemoteSnapshotBuffer());
  const pendingBombPresenterRef = useRef(new PendingBombPresenter());
  const explosionEventPresenterRef = useRef(new ExplosionEventPresenter());
  const deathEventPresenterRef = useRef(new DeathEventPresenter());
  const collisionReaderRef = useRef({
    isBlockedCell: (cellX: number, cellY: number) => !store.canEnterCell(cellX, cellY),
  });
  const [nickname, setNickname] = useState("");
  const [joined, setJoined] = useState(false);
  const [volumeLevel, setVolumeLevel] = useState(1);
  const [localVisualPosition, setLocalVisualPosition] = useState<{ x: number; y: number } | null>(null);
  const [pendingBombs, setPendingBombs] = useState<PendingBombVisual[]>([]);
  const [explosionFlames, setExplosionFlames] = useState<ExplosionFlameVisual[]>([]);
  const [deathVisuals, setDeathVisuals] = useState<DeathVisual[]>([]);
  const explosionSignatureRef = useRef("");
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
  const localPositionSource = useMemo(() => ({
    sample(now: number) {
      const predicted = localPredictorRef.current.position;
      return predicted
        ? localRenderInterpolatorRef.current.sample(now)
        : { x: 0, y: 0 };
    },
  }), []);
  const remotePositionSource = useMemo(() => ({
    sample(entityId: string) {
      return remoteSnapshotBufferRef.current.sample(
        entityId,
        clockSyncRef.current.estimatedServerTickFloat(Date.now()),
        clockSyncRef.current.interpolationDelayMs,
      );
    },
  }), []);

  const resetV3Runtime = useCallback(() => {
    commandTimelineRef.current.reset();
    localPredictorRef.current.clear();
    localRenderInterpolatorRef.current = new PositionInterpolator(1000 / 30);
    remoteSnapshotBufferRef.current.clear();
    pendingBombPresenterRef.current.reset();
    explosionEventPresenterRef.current.reset();
    deathEventPresenterRef.current.reset();
    setPendingBombs([]);
    setExplosionFlames([]);
    setDeathVisuals([]);
    explosionSignatureRef.current = "";
  }, []);

  const updateLocalRenderTarget = useCallback((now: number, teleport = false) => {
    const predictor = localPredictorRef.current;
    const current = predictor.position;
    if (!current) return null;
    const interpolator = localRenderInterpolatorRef.current;
    if (teleport) {
      interpolator.setTarget(current.x, current.y, now, { teleport: true });
    }
    const preview = predictor.previewNext(
      commandTimelineRef.current.pending,
      collisionReaderRef.current,
    ).position ?? current;
    interpolator.setTarget(preview.x, preview.y, now);
    return { current, preview };
  }, []);

  const refreshPendingBombs = useCallback(() => {
    setPendingBombs(pendingBombPresenterRef.current.visuals);
  }, []);

  const refreshExplosionFlames = useCallback(() => {
    const active = explosionEventPresenterRef.current.active(
      clockSyncRef.current.estimatedServerTickFloat(Date.now()),
    ).visuals;
    const signature = active.map((flame) => flame.id).join("|");
    if (signature === explosionSignatureRef.current) return;
    explosionSignatureRef.current = signature;
    setExplosionFlames(active);
  }, []);

  const handleV3EntitySnapshot = useCallback((entities: V3EntitySnapshot) => {
    remoteSnapshotBufferRef.current.ingest(entities, store.getSnapshot().localPlayerId);
    const bombs = store.getEntitySnapshot().entities.filter(
      (entity): entity is BombEntity => entity.kind === "bomb",
    );
    pendingBombPresenterRef.current.observeAuthoritative(bombs);
    const flames = store.getEntitySnapshot().entities.filter(
      (entity): entity is FlameEntity => entity.kind === "flame",
    );
    explosionEventPresenterRef.current.observeAuthoritative(flames);
    refreshPendingBombs();
    refreshExplosionFlames();
  }, [refreshExplosionFlames, refreshPendingBombs, store]);

  const handleV3WorldEvent = useCallback((event: V3WorldEvent) => {
    const accepted = explosionEventPresenterRef.current.ingest(
      event,
      clockSyncRef.current.estimatedServerTickFloat(Date.now()),
    );
    if (accepted) {
      if (event.eventType === "explosion") audioRef.current?.playExplosion();
      deathEventPresenterRef.current.ingest(event, performance.now());
      setDeathVisuals(deathEventPresenterRef.current.active(performance.now()));
    }
    refreshExplosionFlames();
  }, [refreshExplosionFlames]);

  useEffect(() => {
    if (deathVisuals.length === 0) return;
    const nextExpiry = Math.min(...deathVisuals.map((visual) => visual.expiresAt));
    const timer = window.setTimeout(() => {
      setDeathVisuals(deathEventPresenterRef.current.active(performance.now()));
    }, Math.max(0, nextExpiry - performance.now()) + 16);
    return () => window.clearTimeout(timer);
  }, [deathVisuals]);

  const handleV3ActionResult = useCallback((result: V3ActionResult) => {
    if (result.accepted) commandTimelineRef.current.acknowledge(result.commandSeq);
    else commandTimelineRef.current.reject(result.commandSeq);
    if (result.action === "bomb") {
      pendingBombPresenterRef.current.resolve(result);
      refreshPendingBombs();
    }
  }, [refreshPendingBombs]);

  const handleV3OwnerSnapshot = useCallback((owner: V3OwnerSnapshot) => {
    const predictor = localPredictorRef.current;
    if (!predictor.canApplySnapshot(owner)) return;
    const timeline = commandTimelineRef.current;
    const now = performance.now();
    const lifecycleReset =
      predictor.lifeId === null ||
      predictor.lifeId !== owner.player.lifeId ||
      owner.player.teleport;
    if (lifecycleReset) {
      timeline.reset();
      predictor.reset(owner);
      updateLocalRenderTarget(now, true);
      return;
    }
    timeline.acknowledge(owner.lastProcessedCommandSeq);
    predictor.observeOwnerSnapshot(owner);
  }, [updateLocalRenderTarget]);

  useEffect(() => {
    const socket = new GameSocket({
      store,
      protocol: networkProtocol,
      clockSync: networkProtocol === 3 ? clockSyncRef.current : null,
      onV3OwnerSnapshot: handleV3OwnerSnapshot,
      onV3EntitySnapshot: handleV3EntitySnapshot,
      onV3ActionResult: handleV3ActionResult,
      onV3WorldEvent: handleV3WorldEvent,
      onV3Reset: resetV3Runtime,
      onV3CommandRejected: (commandSeq) => {
        commandTimelineRef.current.reject(commandSeq);
        pendingBombPresenterRef.current.reject(commandSeq);
        refreshPendingBombs();
      },
    });
    const audio = new AudioRuntime();
    socketRef.current = socket;
    audioRef.current = audio;
    socket.connect();
    return () => {
      socket.disconnect();
      audio.dispose();
    };
  }, [
    handleV3EntitySnapshot,
    handleV3ActionResult,
    handleV3OwnerSnapshot,
    handleV3WorldEvent,
    networkProtocol,
    refreshPendingBombs,
    resetV3Runtime,
    store,
  ]);

  const advanceRenderFrame = useCallback((now: number) => {
    if (networkProtocol !== 3 || !joined || !snapshot.initialized) return;
    const predictor = localPredictorRef.current;
    if (!predictor.position) return;
    const result = predictor.advanceTo(
      clockSyncRef.current.predictionTargetTick(Date.now()),
      commandTimelineRef.current.pending,
      collisionReaderRef.current,
    );
    if (result.replayTicks > 0) updateLocalRenderTarget(now);
    refreshExplosionFlames();
  }, [joined, networkProtocol, refreshExplosionFlames, snapshot.initialized, updateLocalRenderTarget]);

  useEffect(() => {
    if (snapshot.metadata && joined) audioRef.current?.sync(snapshot.metadata, snapshot);
  }, [joined, snapshot]);

  const showPredictionTarget = useCallback((target: { x: number; y: number } | null) => {
    const authoritative = predictionRef.current.authoritative;
    if (
      target &&
      authoritative &&
      (target.x !== authoritative.x || target.y !== authoritative.y) &&
      !store.canEnterCell(target.x, target.y)
    ) {
      setLocalVisualPosition(authoritative);
      return;
    }
    setLocalVisualPosition(target);
  }, [store]);

  useEffect(() => {
    if (networkProtocol === 3) return;
    if (!localPlayer) return;
    const previous = predictionSessionRef.current;
    const reset =
      previous.playerId !== localPlayer.id ||
      snapshot.ackClientSeq < previous.ackClientSeq ||
      previous.alive !== localPlayer.alive;
    const target = reset
      ? predictionRef.current.reset(localPlayer)
      : predictionRef.current.reconcile(snapshot.ackClientSeq, localPlayer);
    predictionSessionRef.current = {
      playerId: localPlayer.id,
      ackClientSeq: snapshot.ackClientSeq,
      alive: localPlayer.alive,
    };
    showPredictionTarget(target);
  }, [localPlayer, networkProtocol, showPredictionTarget, snapshot.ackClientSeq]);

  const sendV3ActionCommand = useCallback((action: V3ActionCommand["action"]) => {
    const predictor = localPredictorRef.current;
    if (!predictor.position) return false;
    const targetTick = clockSyncRef.current.targetTick(Date.now(), predictor.predictedTick);
    const command = commandTimelineRef.current.prepareAction(action, targetTick);
    if (!command || !socketRef.current?.sendV3Input(command)) return false;
    if (!commandTimelineRef.current.commit(command)) return false;
    const movement = predictor.advanceTo(
      targetTick,
      commandTimelineRef.current.pending,
      collisionReaderRef.current,
    );
    if (movement.replayTicks > 0) updateLocalRenderTarget(performance.now());
    if (action === "bomb") {
      const bombCell = predictor.bombCell;
      if (bombCell) {
        pendingBombPresenterRef.current.begin(command.commandSeq, bombCell);
        refreshPendingBombs();
      }
    }
    return true;
  }, [refreshPendingBombs, updateLocalRenderTarget]);

  const sendAction = useCallback((action: Action) => {
    if (networkProtocol === 3) {
      if (action === "bomb") {
        sendV3ActionCommand("bomb");
        return;
      }
      if (action === "wait") return;
      const direction: V3Direction = action === "stop" ? "neutral" : action;
      const predictor = localPredictorRef.current;
      if (!predictor.position) return;
      const targetTick = clockSyncRef.current.targetTick(Date.now(), predictor.predictedTick);
      const command = commandTimelineRef.current.prepareDirection(direction, targetTick);
      if (!command || !socketRef.current?.sendV3Input(command)) return;
      if (!commandTimelineRef.current.commit(command)) return;
      const movement = predictor.advanceTo(
        targetTick,
        commandTimelineRef.current.pending,
        collisionReaderRef.current,
      );
      if (movement.replayTicks > 0) updateLocalRenderTarget(performance.now());
      return;
    }
    const seq = socketRef.current?.sendInput(action) ?? -1;
    if (["up", "down", "left", "right"].includes(action)) {
      const target = predictionRef.current.enqueue(seq, action as MoveAction);
      showPredictionTarget(target);
    }
  }, [networkProtocol, sendV3ActionCommand, showPredictionTarget, updateLocalRenderTarget]);
  const input = useGameInput(
    sendAction,
    joined && snapshot.initialized && snapshot.connection === "online" && Boolean(localPlayer?.alive),
    networkProtocol === 3 ? "v3" : "v2",
  );

  const enterWorld = useCallback(
    (rawNickname: string, color: PlayerColorId) => {
      const clean = rawNickname.trim().slice(0, 12);
      if (!clean) return false;
      setNickname(clean);
      setJoined(true);
      predictionRef.current = new MovementPrediction();
      predictionSessionRef.current = { playerId: "", ackClientSeq: -1, alive: false };
      setLocalVisualPosition(null);
      resetV3Runtime();
      socketRef.current?.join(clean, color);
      audioRef.current?.start(snapshot.metadata, snapshot);
      return true;
    },
    [resetV3Runtime, snapshot],
  );

  const respawn = useCallback(() => {
    if (networkProtocol === 2) socketRef.current?.respawn();
    else sendV3ActionCommand("respawn");
  }, [networkProtocol, sendV3ActionCommand]);
  const cycleVolume = useCallback(() => {
    const level = audioRef.current?.cycle(snapshot.metadata, snapshot) ?? 1;
    setVolumeLevel(level);
  }, [snapshot]);
  const playLocalStep = useCallback(() => {
    audioRef.current?.playMove();
  }, []);

  return {
    store,
    snapshot,
    entitySnapshot,
    localPlayer,
    localVisualPosition,
    localPositionSource: networkProtocol === 3 ? localPositionSource : null,
    remotePositionSource: networkProtocol === 3 ? remotePositionSource : null,
    pendingBombs: networkProtocol === 3 ? pendingBombs : [],
    explosionFlames: networkProtocol === 3 ? explosionFlames : [],
    deathVisuals: networkProtocol === 3 ? deathVisuals : [],
    localDeathAnimating:
      networkProtocol === 3 &&
      deathVisuals.some((visual) => visual.playerId === localPlayer?.id),
    networkProtocol,
    nickname,
    joined,
    volumeLevel,
    enterWorld,
    respawn,
    cycleVolume,
    playLocalStep,
    advanceRenderFrame,
    ...input,
  };
}
