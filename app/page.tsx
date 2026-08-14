"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Tile = "floor" | "wall" | "crate" | "warning";
type Player = { id:string; x:number; y:number; isAI:boolean; action:Action; nickname:string; joined:boolean; alive:boolean };
type Bomb = { id:number; x:number; y:number; fuse:number };
type State = { tick:number; nextTickAt:number; width:number; height:number; originX:number; originY:number; worldX:number; worldY:number; cameraDx:number; cameraDy:number; tiles:Tile[][]; players:Player[]; bombs:Bomb[]; flames:{x:number;y:number}[] };
type Action = "up" | "down" | "left" | "right" | "bomb" | "wait";

const WS_URL = "wss://insight.magamiscom.ing/boom-ws";
const actionLabel:Record<Action,string> = { up:"위로", down:"아래로", left:"왼쪽", right:"오른쪽", bomb:"폭탄 설치", wait:"대기" };

export default function Home() {
  const [game, setGame] = useState<State | null>(null);
  const [myId, setMyId] = useState("");
  const [status, setStatus] = useState<"connecting"|"online"|"offline">("connecting");
  const [queued, setQueued] = useState<Action>("wait");
  const [sound, setSound] = useState(true);
  const [progress, setProgress] = useState(0);
  const [nickname, setNickname] = useState("");
  const [joined, setJoined] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const myIdRef = useRef("");
  const audioRef = useRef<AudioContext | null>(null);
  const soundRef = useRef(true);
  const lastTick = useRef(0);
  const joinedRef = useRef(false);
  const nicknameRef = useRef("");

  const tickSound = useCallback((tick:number) => {
    if (!soundRef.current || !audioRef.current) return;
    const a=audioRef.current, o=a.createOscillator(), gain=a.createGain();
    o.type="square"; o.frequency.value=tick%2 ? 410 : 300;
    gain.gain.setValueAtTime(.045,a.currentTime); gain.gain.exponentialRampToValueAtTime(.001,a.currentTime+.085);
    o.connect(gain); gain.connect(a.destination); o.start(); o.stop(a.currentTime+.09);
  },[]);

  useEffect(() => {
    let stopped=false, retry:ReturnType<typeof setTimeout>;
    const connect=()=>{
      setStatus("connecting");
      const ws=new WebSocket(WS_URL); wsRef.current=ws;
      ws.onopen=()=>setStatus("online");
      ws.onmessage=(event)=>{
        const msg=JSON.parse(event.data);
        if(msg.type==="welcome") { myIdRef.current=msg.id; setMyId(msg.id); if(joinedRef.current)ws.send(JSON.stringify({type:"join",nickname:nicknameRef.current})); }
        if(msg.type==="state") {
          setGame(msg);
          const me=msg.players.find((p:Player)=>p.id===myIdRef.current);
          if(me) setQueued(me.action);
          if(lastTick.current && msg.tick!==lastTick.current) tickSound(msg.tick);
          lastTick.current=msg.tick;
        }
      };
      ws.onclose=()=>{setStatus("offline");if(!stopped)retry=setTimeout(connect,1500)};
    };
    connect(); return()=>{stopped=true;clearTimeout(retry);wsRef.current?.close()};
  },[tickSound]);

  useEffect(()=>{
    let frame=0;
    const draw=()=>{if(game)setProgress(Math.max(0,Math.min(1,1-(game.nextTickAt-Date.now())/1000)));frame=requestAnimationFrame(draw)};
    frame=requestAnimationFrame(draw);return()=>cancelAnimationFrame(frame);
  },[game]);

  const send=useCallback((action:Action)=>{
    if(!audioRef.current) audioRef.current=new AudioContext();
    audioRef.current.resume(); setQueued(action);
    if(wsRef.current?.readyState===WebSocket.OPEN) wsRef.current.send(JSON.stringify({type:"action",action}));
  },[]);

  const enterWorld=(e:React.FormEvent)=>{
    e.preventDefault();const clean=nickname.trim().slice(0,12);if(!clean)return;
    nicknameRef.current=clean;joinedRef.current=true;setJoined(true);
    wsRef.current?.send(JSON.stringify({type:"join",nickname:clean}));
  };
  const respawn=()=>wsRef.current?.send(JSON.stringify({type:"respawn"}));

  useEffect(()=>{
    const onKey=(e:KeyboardEvent)=>{
      const map:Record<string,Action>={arrowup:"up",w:"up",arrowdown:"down",s:"down",arrowleft:"left",a:"left",arrowright:"right",d:"right"," ":"bomb"};
      const action=map[e.key.toLowerCase()];if(action){e.preventDefault();send(action)}
    };
    addEventListener("keydown",onKey);return()=>removeEventListener("keydown",onKey);
  },[send]);

  const me=game?.players.find(p=>p.id===myId);
  const centerBomb=game?.bombs.find(b=>b.x===Math.floor(game.width/2)&&b.y===Math.floor(game.height/2));
  return <main>
    <header>
      <div className="brand"><span className="logoBomb">●</span><div><b>BOOM <i>n</i> BOOM</b><small>1초마다 모두가 동시에 움직이는 폭탄 수싸움</small></div></div>
      <div className={`connection ${status}`}><span/> {status==="online"?"서버 연결됨":status==="connecting"?"연결 중":"재연결 중"}</div>
    </header>
    <section className="gameShell">
      <div className="tickHud">
        <div><small>LIVE WORLD</small><strong>접속 즉시 같은 맵에 스폰</strong></div>
        <div className="tickMeter" style={{"--tick":progress} as React.CSSProperties}><span>{(game?.tick??0)%2?"똑":"딱"}</span></div>
        <div className="queue"><small>다음 행동</small><strong>{actionLabel[queued]}</strong></div>
      </div>
      {game ? <div className="board" style={{aspectRatio:`${game.width}/${game.height}`}}>
        <div key={game.tick} className="worldLayer" style={{gridTemplateColumns:`repeat(${game.width},1fr)`,"--camera-dx":game.cameraDx,"--camera-dy":game.cameraDy,"--cols":game.width,"--rows":game.height} as React.CSSProperties}>
        {game.tiles.flatMap((row,y)=>row.map((tile,x)=>{
          const people=game.players.filter(p=>p.x===x&&p.y===y);
          const bomb=game.bombs.find(b=>b.x===x&&b.y===y);
          const flame=game.flames.some(f=>f.x===x&&f.y===y);
          return <div className={`tile ${tile}`} key={`${x},${y}`}>
            {tile==="crate"&&<span className="box"/>}
            {bomb&&<span className="bomb"><span>✦</span><i>{bomb.fuse}</i></span>}
            {people.filter(p=>p.id!==myId).map(p=><span key={p.id} className={`fighter ${p.isAI?"ai":"rival"}`} title={p.nickname}><em>{p.nickname}</em>{p.isAI?"AI":"◉"}</span>)}
            {flame&&<span className="flame">✦</span>}
          </div>
        }))}</div>
        {me?.alive&&<span key={`me-${game.tick}`} className="fighter me centerPlayer"><em>{me.nickname}</em>◉</span>}
        {centerBomb&&<span className="bomb centerBomb"><span>✦</span><i>{centerBomb.fuse}</i></span>}
        <span className="coordinates">{game.worldX}, {game.worldY}</span>
        {!joined&&<div className="gameOverlay"><form onSubmit={enterWorld}><small>ENTER THE WORLD</small><h2>닉네임을 정해주세요</h2><p>캐릭터 머리 위에 표시됩니다.</p><input autoFocus maxLength={12} value={nickname} onChange={e=>setNickname(e.target.value)} placeholder="닉네임 (최대 12자)" aria-label="닉네임"/><button disabled={!nickname.trim()}>게임 시작</button></form></div>}
        {joined&&me&&!me.alive&&<div className="gameOverlay death"><div><small>BOOM!</small><h2>폭탄에 맞았어요</h2><p>새로운 위치에서 다시 시작할 수 있어요.</p><button onClick={respawn}>다시 접속하기</button></div></div>}
      </div> : <div className="loading"><span>●</span><b>Oracle 게임 서버에 접속하는 중…</b></div>}
      <div className="controls">
        <div className="dpad"><button onClick={()=>send("up")}>▲</button><button onClick={()=>send("left")}>◀</button><button onClick={()=>send("down")}>▼</button><button onClick={()=>send("right")}>▶</button></div>
        <div className="rules"><b>{me?.nickname?`${me.nickname}으로 참가 중`:"참가 준비 중"}</b><span>누른 행동이 다음 똑딱에 실행됩니다.</span><span>방향은 계속 유지되고 폭탄은 한 번만 설치됩니다.</span></div>
        <button className="boomBtn" onClick={()=>send("bomb")}>BOMB<small>한 틱 사용</small></button>
      </div>
      <div className="legend"><span><i className="gray"/>고정 벽</span><span><i className="yellow"/>노란 상자</span><span><i className="warning"/>2초 뒤 재생성</span><span><i className="cyan"/>나</span><span><i className="coral"/>AI / 다른 플레이어</span><button onClick={()=>setSound(v=>{soundRef.current=!v;return !v})}>{sound?"♪ 똑딱 소리 켜짐":"× 소리 꺼짐"}</button></div>
    </section>
  </main>;
}
