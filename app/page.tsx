"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

type Tile = "floor" | "wall" | "crate" | "warning";
type Player = { id:string; x:number; y:number; isAI:boolean; action:Action; power:number; range:number; shield:number; moved:boolean; nickname:string; joined:boolean; alive:boolean };
type Bomb = { id:number; x:number; y:number; fuse:number };
type Item = { x:number; y:number; type:"bomb"|"shield"|"flame" };
type EnemyDirection = { id:string; dx:number; dy:number; distance:number; nickname:string; isAI:boolean };
type State = { tick:number; frame:number; nextTickAt:number; serverNow:number; nextTickInMs:number; worldEpochMs:number; bgmDurationMs:number; bgmSnareOffsetMs:number; width:number; height:number; viewWidth:number; viewHeight:number; originX:number; originY:number; worldX:number; worldY:number; cameraDx:number; cameraDy:number; cameraOffsetX:number; cameraOffsetY:number; tiles:Tile[][]; players:Player[]; enemyDirections:EnemyDirection[]; bombs:Bomb[]; items:Item[]; flames:{x:number;y:number}[] };
type Action = "up" | "down" | "left" | "right" | "bomb" | "wait";

const WS_URL = "wss://insight.magamiscom.ing/boom-ws";
const BGM_URL = "/midnight-tile-loop.mp3";
const VOLUME_LEVELS = [0,.3,.58,.9];
const actionIcon:Record<Action,string> = { up:"↑", down:"↓", left:"←", right:"→", bomb:"●", wait:"Ⅱ" };

export default function Home() {
  const [game, setGame] = useState<State | null>(null);
  const [myId, setMyId] = useState("");
  const [status, setStatus] = useState<"connecting"|"online"|"offline">("connecting");
  const [queued, setQueued] = useState<Action>("wait");
  const [volumeLevel, setVolumeLevel] = useState(1);
  const [nickname, setNickname] = useState("");
  const [joined, setJoined] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const myIdRef = useRef("");
  const bgmRef = useRef<HTMLAudioElement | null>(null);
  const volumeRef = useRef(1);
  const soundRef = useRef(true);
  const joinedRef = useRef(false);
  const nicknameRef = useRef("");
  const moveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastBgmTickRef = useRef(-1);
  const worldLayerRef = useRef<HTMLDivElement | null>(null);
  const cameraRef = useRef({ready:false,visualX:0,visualY:0,startX:0,startY:0,targetX:0,targetY:0,startAt:0,duration:150,originX:0,originY:0,width:17,height:13});

  const paintCamera=useCallback(()=>{
    const layer=worldLayerRef.current,camera=cameraRef.current;if(!layer||!camera.ready)return;
    const offsetX=camera.visualX-(camera.originX+Math.floor(camera.width/2));
    const offsetY=camera.visualY-(camera.originY+Math.floor(camera.height/2));
    layer.style.transform=`translate(${-offsetX*100/camera.width}%,${-offsetY*100/camera.height}%)`;
  },[]);

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
    if(!bgmRef.current){const track=new Audio(BGM_URL);track.loop=true;track.preload="auto";track.volume=VOLUME_LEVELS[volumeRef.current];bgmRef.current=track}
    if(state)syncBgm(state,true);
  },[syncBgm]);
  const cycleVolume=()=>setVolumeLevel(current=>{const next=current===3?0:current+1;volumeRef.current=next;soundRef.current=next>0;const track=bgmRef.current;if(next===0)track?.pause();else{if(track)track.volume=VOLUME_LEVELS[next];startBgm(game)}return next});

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
          const camera=cameraRef.current;
          const teleported=!camera.ready||Math.hypot(msg.worldX-camera.visualX,msg.worldY-camera.visualY)>2;
          if(teleported){camera.ready=true;camera.visualX=msg.worldX;camera.visualY=msg.worldY;camera.startX=msg.worldX;camera.startY=msg.worldY;camera.targetX=msg.worldX;camera.targetY=msg.worldY}
          else if(msg.worldX!==camera.targetX||msg.worldY!==camera.targetY){camera.startX=camera.visualX;camera.startY=camera.visualY;camera.targetX=msg.worldX;camera.targetY=msg.worldY;camera.startAt=performance.now()}
          camera.originX=msg.originX;camera.originY=msg.originY;camera.width=msg.width;camera.height=msg.height;
          setGame(msg);
          if(msg.tick!==lastBgmTickRef.current){lastBgmTickRef.current=msg.tick;syncBgm(msg)}
          const me=msg.players.find((p:Player)=>p.id===myIdRef.current);
          if(me) setQueued(me.action);
        }
      };
      ws.onclose=()=>{setStatus("offline");if(!stopped)retry=setTimeout(connect,1500)};
    };
    connect(); return()=>{stopped=true;clearTimeout(retry);wsRef.current?.close()};
  },[syncBgm]);

  useEffect(()=>{
    let animationFrame=0;
    const animate=(now:number)=>{
      const camera=cameraRef.current;
      if(camera.ready){
        const progress=Math.min(1,Math.max(0,(now-camera.startAt)/camera.duration));
        camera.visualX=camera.startX+(camera.targetX-camera.startX)*progress;
        camera.visualY=camera.startY+(camera.targetY-camera.startY)*progress;
        paintCamera();
      }
      animationFrame=requestAnimationFrame(animate);
    };
    animationFrame=requestAnimationFrame(animate);return()=>cancelAnimationFrame(animationFrame);
  },[paintCamera]);

  const send=useCallback((action:Action)=>{
    setQueued(action);
    if(wsRef.current?.readyState===WebSocket.OPEN) wsRef.current.send(JSON.stringify({type:"action",action}));
  },[]);
  const stopMoving=useCallback(()=>{if(!moveTimerRef.current)return;clearInterval(moveTimerRef.current);moveTimerRef.current=null;send("wait")},[send]);
  const startMoving=useCallback((action:Extract<Action,"up"|"down"|"left"|"right">)=>{if(moveTimerRef.current)clearInterval(moveTimerRef.current);send(action);moveTimerRef.current=setInterval(()=>send(action),145)},[send]);

  const enterWorld=(e:React.FormEvent)=>{
    e.preventDefault();const clean=nickname.trim().slice(0,12);if(!clean)return;startBgm(game);
    nicknameRef.current=clean;joinedRef.current=true;setJoined(true);
    wsRef.current?.send(JSON.stringify({type:"join",nickname:clean}));
  };
  const respawn=()=>wsRef.current?.send(JSON.stringify({type:"respawn"}));

  useEffect(()=>{
    const onKey=(e:KeyboardEvent)=>{
      const map:Record<string,Extract<Action,"up"|"down"|"left"|"right">>={arrowup:"up",w:"up",arrowdown:"down",s:"down",arrowleft:"left",a:"left",arrowright:"right",d:"right"};
      const action=map[e.key.toLowerCase()];if(action){e.preventDefault();if(!e.repeat)startMoving(action)}else if(e.key===" "){e.preventDefault();if(!e.repeat)send("bomb")}
    };
    const onKeyUp=(e:KeyboardEvent)=>{if(["arrowup","w","arrowdown","s","arrowleft","a","arrowright","d"].includes(e.key.toLowerCase()))stopMoving()};
    const stop=()=>stopMoving();addEventListener("keydown",onKey);addEventListener("keyup",onKeyUp);addEventListener("pointerup",stop);addEventListener("blur",stop);return()=>{removeEventListener("keydown",onKey);removeEventListener("keyup",onKeyUp);removeEventListener("pointerup",stop);removeEventListener("blur",stop);if(moveTimerRef.current)clearInterval(moveTimerRef.current)};
  },[send,startMoving,stopMoving]);

  const me=game?.players.find(p=>p.id===myId);
  const centerBomb=game?.bombs.find(b=>b.x===Math.floor(game.width/2)&&b.y===Math.floor(game.height/2));
  useLayoutEffect(()=>{if(game){const camera=cameraRef.current;camera.originX=game.originX;camera.originY=game.originY;camera.width=game.width;camera.height=game.height;paintCamera()}},[game?.originX,game?.originY,game?.width,game?.height,paintCamera]);
  return <main>
    <header>
      <div className="brand"><span className="logoBomb">●</span><div><b>BOOM <i>n</i> BOOM</b><small>1초마다 모두가 동시에 움직이는 폭탄 수싸움</small></div></div>
      <div className={`connection ${status}`}><span/> {status==="online"?"서버 연결됨":status==="connecting"?"연결 중":"재연결 중"}</div>
    </header>
    <section className="gameShell">
      <div className="tickHud">
        <div><small>LIVE WORLD</small><strong>접속 즉시 같은 맵에 스폰</strong></div>
        <div key={`meter-${game?.tick??0}`} className="tickMeter" aria-label="다음 턴까지 1초 게이지"/>
      </div>
      {game ? <div className="board" style={{aspectRatio:`${game.viewWidth}/${game.viewHeight}`}}>
        <div ref={worldLayerRef} className="worldLayer" style={{gridTemplateColumns:`repeat(${game.width},1fr)`,width:`${game.width/game.viewWidth*100}%`,height:`${game.height/game.viewHeight*100}%`,left:`${-(game.width-game.viewWidth)/2/game.viewWidth*100}%`,top:`${-(game.height-game.viewHeight)/2/game.viewHeight*100}%`,right:"auto",bottom:"auto","--cols":game.width,"--rows":game.height} as React.CSSProperties}>
        {game.tiles.flatMap((row,y)=>row.map((tile,x)=>{
          const people=game.players.filter(p=>p.x===x&&p.y===y);
          const bomb=game.bombs.find(b=>b.x===x&&b.y===y);
          const item=game.items?.find(i=>i.x===x&&i.y===y);
          const flame=game.flames.some(f=>f.x===x&&f.y===y);
          const floorAlt=((game.originX+x+game.originY+y)&1)!==0;
          return <div className={`tile ${tile} ${floorAlt?"floorAlt":""}`} key={`${x},${y}`} style={{"--depth-x":`${Math.sign(x-Math.floor(game.width/2))*4}px`,"--depth-y":`${Math.sign(y-Math.floor(game.height/2))*4}px`} as React.CSSProperties}>
            {tile==="crate"&&<span className="box"/>}
            {bomb&&<span className="bomb"><span>✦</span><i>{bomb.fuse}</i></span>}
            {item&&<span className={`item item-${item.type}`} title={item.type==="bomb"?"폭탄 수 증가":item.type==="shield"?"폭발 1회 방어":"폭탄 화력 증가"}>{item.type==="bomb"?"●":item.type==="shield"?"◆":"🔥"}</span>}
            {people.filter(p=>p.id!==myId).map(p=><span key={p.id} className={`fighter ${p.isAI?"ai":"rival"} ${p.shield>0?"shielded":""} ${p.moved?"moving":""}`} title={p.nickname}><em>{p.nickname}</em>{p.isAI?"AI":"◉"}</span>)}
            {flame&&<span className="flame">✦</span>}
          </div>
        }))}</div>
        {me?.alive&&<span className={`fighter me centerPlayer ${me.shield>0?"shielded":""}`}><em>{me.nickname}</em>◉<i className={`actionCue cue-${queued}`} title="내 현재 행동">{actionIcon[queued]}</i></span>}
        {centerBomb&&<span className="bomb centerBomb"><span>✦</span><i>{centerBomb.fuse}</i></span>}
        {game.enemyDirections?.map(enemy=>{const maxX=game.width/2-.8,maxY=game.height/2-.8,scale=Math.min(maxX/Math.max(Math.abs(enemy.dx),.001),maxY/Math.max(Math.abs(enemy.dy),.001)),left=50+enemy.dx*scale/game.width*100,top=50+enemy.dy*scale/game.height*100,angle=Math.atan2(enemy.dy,enemy.dx)*180/Math.PI+90;return <span key={enemy.id} className={`enemyPointer ${enemy.isAI?"ai":"rival"}`} style={{left:`${left}%`,top:`${top}%`}} title={`${enemy.nickname} · 약 ${enemy.distance}칸`}><i style={{transform:`rotate(${angle}deg)`}}>▲</i><small>{enemy.distance}</small></span>})}
        <span className="coordinates">{game.worldX.toFixed(1)}, {game.worldY.toFixed(1)}</span>
        {!joined&&<div className="gameOverlay"><form onSubmit={enterWorld}><small>ENTER THE WORLD</small><h2>닉네임을 정해주세요</h2><p>캐릭터 머리 위에 표시됩니다.</p><input autoFocus maxLength={12} value={nickname} onChange={e=>setNickname(e.target.value)} placeholder="닉네임 (최대 12자)" aria-label="닉네임"/><button disabled={!nickname.trim()}>게임 시작</button></form></div>}
        {joined&&me&&!me.alive&&<div className="gameOverlay death"><div><small>BOOM!</small><h2>폭탄에 맞았어요</h2><p>새로운 위치에서 다시 시작할 수 있어요.</p><button onClick={respawn}>다시 접속하기</button></div></div>}
      </div> : <div className="loading"><span>●</span><b>Oracle 게임 서버에 접속하는 중…</b></div>}
      <div className="controls">
        <div className="dpad"><button onPointerDown={e=>{e.preventDefault();startMoving("up")}}>▲</button><button onPointerDown={e=>{e.preventDefault();startMoving("left")}}>◀</button><button onPointerDown={e=>{e.preventDefault();startMoving("down")}}>▼</button><button onPointerDown={e=>{e.preventDefault();startMoving("right")}}>▶</button></div>
        <div className="rules"><b>{me?.nickname?`${me.nickname}으로 참가 중`:"참가 준비 중"}</b><span>이동과 폭탄 설치는 즉시, 폭발과 상자 재생성은 음악 박자에 실행됩니다.</span><span>{me?`폭탄 ${me.power}개 · 화력 ${me.range}칸 · 방어막 ${me.shield}회`:"AI를 쓰러뜨리고 아이템을 획득하세요."}</span></div>
        <button className="boomBtn" onClick={()=>send("bomb")}>BOMB<small>즉시 설치</small></button>
      </div>
      <div className="legend"><span><i className="warning"/>2초 뒤 재생성</span><span><i className="itemIcon bombUp">●</i>폭탄 수</span><span><i className="itemIcon shieldUp">◆</i>방어막</span><span><i className="itemIcon flameUp">🔥</i>화력</span><span className="bgmTitle">♫ Midnight Tile Loop</span><button className={`volumeButton level-${volumeLevel}`} onClick={cycleVolume} aria-label={volumeLevel===0?"BGM 음소거됨, 눌러서 작게 재생":`BGM 음량 ${volumeLevel}단계, 눌러서 변경`} title="BGM 음량"><span className="speakerBody"/><span className="volumeWaves">{[1,2,3].map(level=><i key={level} className={level<=volumeLevel?"on":""}/>)}</span>{volumeLevel===0&&<b>×</b>}</button></div>
    </section>
  </main>;
}
