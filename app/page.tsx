"use client";

import { GameControls } from "./game/GameControls";
import { DeathOverlay } from "./game/DeathOverlay";
import { GameLegend } from "./game/GameLegend";
import { JoinOverlay } from "./game/JoinOverlay";
import { PlayerStatus } from "./game/PlayerStatus";
import { useGameController } from "./game/use-game-controller";
import { WorldViewport } from "./game/WorldViewport";

export default function Home() {
  const game = useGameController();
  const board = game.snapshot.initialized ? (
    <WorldViewport
      store={game.store}
      snapshot={game.snapshot}
      entitySnapshot={game.entitySnapshot}
      localPlayer={game.localPlayer}
      localVisualPosition={game.localVisualPosition}
      localPositionSource={game.localPositionSource}
      remotePositionSource={game.remotePositionSource}
      pendingBombs={game.pendingBombs}
      explosionFlames={game.explosionFlames}
      onLocalStep={game.playLocalStep}
    >
      {game.joined && game.localPlayer && !game.localPlayer.alive ? (
        <DeathOverlay onRespawn={game.respawn} />
      ) : null}
    </WorldViewport>
  ) : (
    <div className="loading">
      <span>●</span><b>Oracle 게임 서버에 접속하는 중…</b>
      {!game.joined ? <JoinOverlay onJoin={game.enterWorld} /> : null}
    </div>
  );

  return (
    <main className={game.joined ? "gameActive" : undefined}>
      <section className="gameShell">
        {board}
        <GameControls
          startMoving={game.startMoving}
          stopMoving={game.stopMoving}
          bomb={game.bomb}
        >
          <PlayerStatus player={game.localPlayer} />
        </GameControls>
        <GameLegend volumeLevel={game.volumeLevel} cycleVolume={game.cycleVolume} />
      </section>
    </main>
  );
}
