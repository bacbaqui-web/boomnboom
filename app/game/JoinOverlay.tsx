"use client";

import { useState } from "react";

export function JoinOverlay({ onJoin }: { onJoin: (nickname: string) => boolean }) {
  const [nickname, setNickname] = useState("");
  return (
    <div className="gameOverlay joinOverlay">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onJoin(nickname);
        }}
      >
        <small>ENTER THE WORLD</small>
        <h2>닉네임을 정해주세요</h2>
        <p>캐릭터 머리 위에 표시됩니다.</p>
        <input
          maxLength={12}
          value={nickname}
          onChange={(event) => setNickname(event.target.value)}
          placeholder="닉네임 (최대 12자)"
          aria-label="닉네임"
        />
        <button disabled={!nickname.trim()}>게임 시작</button>
      </form>
    </div>
  );
}
