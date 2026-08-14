"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Tile = "floor" | "wall" | "crate" | "warning";
type Player = { id:string; x:number; y:number; isAI:boolean; action:Action; power:number; range:number; shield:number; nickname:string; joined:boolean; alive:boolean };
type Bomb = { id:number; x:number; y:number; fuse:number };
type Item = { x:number; y:number; type:"bomb"|"shield"|"flame" };
type EnemyDirection = { id:string; dx:number; dy:number; distance:number; nickname:string; isAI:boolean };
type State = { tick:number; nextTickAt:number; serverNow:number; nextTickInMs:number; worldEpochMs:number; bgmDurationMs:number; bgmSnareOffsetMs:number; width:number; height:number; originX:number; originY:number; worldX:number; worldY:number; cameraDx:number; cameraDy:number; tiles:Tile[][]; players:Player[]; enemyDirections:EnemyDirection[]; bombs:Bomb[]; items:Item[]; flames:{x:number;y:number}[] };
type Action = "up" | "down" | "left" | "right" | "bomb" | "wait";

const WS_URL = "wss://insight.magamiscom.ing/boom-ws";
const BGM_URL = "/midnight-tile-loop.mp3";
const actionLabel:Record<Action,string> = { up:"위로", down:"아래로", left:"왼쪽", right:"오른쪽", bomb:"폭탄 설치", wait:"대기" };

export default function Home() {
  const [game, setGame] = useState<State | null>(null);
  const [myId, setMyId] = useState("");
  const [status, setStatus] = useState<"connecting"|"online"|"offline">("connecting");
  const [queued, setQueued] = useState<Action>("wait");
  const [sound, setSound] = useState(true);
  const [nickname, setNickname] = useState("");
  const [joined, setJoined] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const myIdRef = useRef("");
  const bgmRef = useRef<HTMLAudioElement | null>(null);
  const soundRef = useRef(true);
  const joinedRef = useRef(false);
  const nicknameRef = useRef("");

  const syncBgm=useCallback((state:State,force=false)=>{
    const track=bgmRef.current;if(!track)return;
    const duration=(state.bgmDurationMs||209995.5)/1000;
    const serverNow=state.serverNow||Date.now();
    const epoch=state.worldEpochMs||serverNow-state.tick*1000;
    const snareOffset=(state.bgmSnareOffsetMs??255)/1000;
    const expected=((((serverNow-epoch)/1000+snareOffset)%duration)+duration)%duration;
    const apply=()=>{
      const delta=((track.currentTime-expected+duration*1.5)%duration)-duration/2,drift=Math.abs(delta);
      if(force||drift>.35)track.currentTime=expected;
      else track.playbackRate=drift>.04?(delta>0?0.985:1.015):1;
      if(soundRef.current&&track.paused)track.play().catch(()=>{});
    };
    if(track.readyState>=1)apply();else track.addEventListener("loadedmetadata",apply,{once:true});
  },[]);
  const startBgm=useCallback((state:State|null)=>{
    if(!bgmRef.current){const track=new Audio(BGM_URL);track.loop=true;track.preload="auto";track.volume=.3;bgmRef.current=track}
    if(state)syncBgm(state,true);
  },[syncBgm]);

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
          syncBgm(msg);
          const me=msg.players.find((p:Player)=>p.id===myIdRef.current);
          if(me) setQueued(me.action);
        }
      };
      ws.onclose=()=>{setStatus("offline");if(!stopped)retry=setTimeout(connect,1500)};
    };
    connect(); return()=>{stopped=true;clearTimeout(retry);wsRef.current?.close()};
  },[syncBgm]);

  const send=useCallback((action:Action)=>{
    setQueued(action);
    if(wsRef.current?.readyState===WebSocket.OPEN) wsRef.current.send(JSON.stringify({type:"action",action}));
  },[]);

  const enterWorld=(e:React.FormEvent)=>{
    e.preventDefault();const clean=nickname.trim().slice(0,12);if(!clean)return;startBgm(game);
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
        <div key={`meter-${game?.tick??0}`} className="tickMeter" aria-label="다음 턴까지 1초 게이지"/>
        <div className="queue"><small>다음 행동</small><strong>{actionLabel[queued]}</strong></div>
      </div>
      {game ? <div className="board" style={{aspectRatio:`${game.width}/${game.height}`}}>
        <div key={game.tick} className="worldLayer" style={{gridTemplateColumns:`repeat(${game.width},1fr)`,"--camera-dx":game.cameraDx,"--camera-dy":game.cameraDy,"--cols":game.width,"--rows":game.height} as React.CSSProperties}>
        {game.tiles.flatMap((row,y)=>row.map((tile,x)=>{
          const people=game.players.filter(p=>p.x===x&&p.y===y);
          const bomb=game.bombs.find(b=>b.x===x&&b.y===y);
          const item=game.items?.find(i=>i.x===x&&i.y===y);
          const flame=game.flames.some(f=>f.x===x&&f.y===y);
          return <div className={`tile ${tile}`} key={`${x},${y}`}>
            {tile==="crate"&&<span className="box"/>}
            {bomb&&<span className="bomb"><span>✦</span><i>{bomb.fuse}</i></span>}
            {item&&<span className={`item item-${item.type}`} title={item.type==="bomb"?"폭탄 수 증가":item.type==="shield"?"폭발 1회 방어":"폭탄 화력 증가"}>{item.type==="bomb"?"●":item.type==="shield"?"◆":"🔥"}</span>}
            {people.filter(p=>p.id!==myId).map(p=><span key={p.id} className={`fighter ${p.isAI?"ai":"rival"} ${p.shield>0?"shielded":""}`} title={p.nickname}><em>{p.nickname}</em>{p.isAI?"AI":"◉"}</span>)}
            {flame&&<span className="flame">✦</span>}
          </div>
        }))}</div>
        {me?.alive&&<span className={`fighter me centerPlayer ${me.shield>0?"shielded":""}`}><em>{me.nickname}</em>◉</span>}
        {centerBomb&&<span className="bomb centerBomb"><span>✦</span><i>{centerBomb.fuse}</i></span>}
        {game.enemyDirections?.map(enemy=>{const maxX=game.width/2-.8,maxY=game.height/2-.8,scale=Math.min(maxX/Math.max(Math.abs(enemy.dx),.001),maxY/Math.max(Math.abs(enemy.dy),.001)),left=50+enemy.dx*scale/game.width*100,top=50+enemy.dy*scale/game.height*100,angle=Math.atan2(enemy.dy,enemy.dx)*180/Math.PI+90;return <span key={enemy.id} className={`enemyPointer ${enemy.isAI?"ai":"rival"}`} style={{left:`${left}%`,top:`${top}%`}} title={`${enemy.nickname} · 약 ${enemy.distance}칸`}><i style={{transform:`rotate(${angle}deg)`}}>▲</i><small>{enemy.distance}</small></span>})}
        <span className="coordinates">{game.worldX}, {game.worldY}</span>
        {!joined&&<div className="gameOverlay"><form onSubmit={enterWorld}><small>ENTER THE WORLD</small><h2>닉네임을 정해주세요</h2><p>캐릭터 머리 위에 표시됩니다.</p><input autoFocus maxLength={12} value={nickname} onChange={e=>setNickname(e.target.value)} placeholder="닉네임 (최대 12자)" aria-label="닉네임"/><button disabled={!nickname.trim()}>게임 시작</button></form></div>}
        {joined&&me&&!me.alive&&<div className="gameOverlay death"><div><small>BOOM!</small><h2>폭탄에 맞았어요</h2><p>새로운 위치에서 다시 시작할 수 있어요.</p><button onClick={respawn}>다시 접속하기</button></div></div>}
      </div> : <div className="loading"><span>●</span><b>Oracle 게임 서버에 접속하는 중…</b></div>}
      <div className="controls">
        <div className="dpad"><button onClick={()=>send("up")}>▲</button><button onClick={()=>send("left")}>◀</button><button onClick={()=>send("down")}>▼</button><button onClick={()=>send("right")}>▶</button></div>
        <div className="rules"><b>{me?.nickname?`${me.nickname}으로 참가 중`:"참가 준비 중"}</b><span>1초 게이지가 차면 선택한 행동이 실행됩니다.</span><span>{me?`폭탄 ${me.power}개 · 화력 ${me.range}칸 · 방어막 ${me.shield}회`:"AI를 쓰러뜨리고 아이템을 획득하세요."}</span></div>
        <button className="boomBtn" onClick={()=>send("bomb")}>BOMB<small>한 틱 사용</small></button>
      </div>
      <div className="legend"><span><i className="warning"/>2초 뒤 재생성</span><span><i className="itemIcon bombUp">●</i>폭탄 수</span><span><i className="itemIcon shieldUp">◆</i>방어막</span><span><i className="itemIcon flameUp">🔥</i>화력</span><span className="bgmTitle">♫ Midnight Tile Loop</span><button onClick={()=>setSound(v=>{const next=!v;soundRef.current=next;if(next)startBgm(game);else bgmRef.current?.pause();return next})}>{sound?"♪ BGM 켜짐":"× 소리 꺼짐"}</button></div>
    </section>
  </main>;
}
