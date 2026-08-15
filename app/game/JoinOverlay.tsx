"use client";

import { useState } from "react";
import {
  DEFAULT_PLAYER_COLOR,
  PLAYER_COLOR_OPTIONS,
  playerColorStyle,
  type PlayerColorId,
} from "./player-color";

export function JoinOverlay({
  onJoin,
}: {
  onJoin: (nickname: string, color: PlayerColorId) => boolean;
}) {
  const [nickname, setNickname] = useState("");
  const [color, setColor] = useState<PlayerColorId>(DEFAULT_PLAYER_COLOR);
  return (
    <div className="gameOverlay joinOverlay">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onJoin(nickname, color);
        }}
      >
        <h2>닉네임을 정해주세요</h2>
        <input
          maxLength={12}
          value={nickname}
          onChange={(event) => setNickname(event.target.value)}
          placeholder="닉네임 (최대 12자)"
          aria-label="닉네임"
        />
        <button disabled={!nickname.trim()}>게임 시작</button>
        <fieldset className="playerColorPicker">
          <legend>플레이어 색상</legend>
          <div className="playerColorSamples">
            {PLAYER_COLOR_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                className={`playerColorSwatch ${color === option.id ? "selected" : ""}`}
                style={playerColorStyle(option.id)}
                aria-label={`${option.name}색 선택`}
                aria-pressed={color === option.id}
                onClick={() => setColor(option.id)}
              />
            ))}
          </div>
        </fieldset>
      </form>
    </div>
  );
}
