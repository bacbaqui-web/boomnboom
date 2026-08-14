"use client";

import { GameControls } from "./game/GameControls";
import { GameHeader, GameHud, GameLegend } from "./game/GameHud";
import { DeathOverlay, JoinOverlay } from "./game/GameOverlay";
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
      queuedAction={game.queuedAction}
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
    <main>
      <GameHeader status={game.snapshot.connection} />
      <section className="gameShell">
        <GameHud snapshot={game.snapshot} />
        {board}
        <GameControls
          player={game.localPlayer}
          startMoving={game.startMoving}
          stopMoving={game.stopMoving}
          bomb={game.bomb}
        />
        <GameLegend volumeLevel={game.volumeLevel} cycleVolume={game.cycleVolume} />
      </section>
    </main>
  );
}
