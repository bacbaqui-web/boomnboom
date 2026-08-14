"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const W = 13, H = 11;
type Pos = { x: number; y: number };
type Bomb = Pos & { owner: "p" | "b"; at: number; range: number };
type Tile = "floor" | "wall" | "crate" | "power" | "range";
type Game = {
  tiles: Tile[][]; player: Pos; bot: Pos; bombs: Bomb[]; flames: Pos[];
  power: number; range: number; score: number; status: "playing" | "win" | "lose";
};

function key(x: number, y: number) { return `${x},${y}`; }
function hash(x:number,y:number,seed=1){let n=Math.imul(x,374761393)+Math.imul(y,668265263)+seed*69069;n=(n^(n>>>13))*1274126177;return(n^(n>>>16))>>>0}
function fresh(): Game {
  const safe = new Set(["1,1","1,2","2,1",`${W-2},${H-2}`,`${W-3},${H-2}`,`${W-2},${H-3}`]);
  const tiles: Tile[][] = Array.from({ length: H }, (_, y) => Array.from({ length: W }, (_, x) => {
    if (x === 0 || y === 0 || x === W-1 || y === H-1 || (x % 2 === 0 && y % 2 === 0)) return "wall";
    return !safe.has(key(x,y)) && ((x * 17 + y * 31 + x*y) % 10 < 6) ? "crate" : "floor";
  }));
  return { tiles, player:{x:1,y:1}, bot:{x:W-2,y:H-2}, bombs:[], flames:[], power:1, range:2, score:0, status:"playing" };
}

const dirs = [{x:0,y:-1},{x:1,y:0},{x:0,y:1},{x:-1,y:0}];
function smooth(fn:()=>void){const d=document as Document&{startViewTransition?:(cb:()=>void)=>void};if(d.startViewTransition)d.startViewTransition(fn);else fn()}

export default function Home() {
  const [g, setG] = useState<Game>(fresh);
  const [sound, setSound] = useState(true);
  const [room, setRoom] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [role, setRole] = useState<"p1"|"p2"|null>(null);
  const [waiting, setWaiting] = useState(false);
  const [lobby, setLobby] = useState(true);
  const [friendMode, setFriendMode] = useState(false);
  const [matching, setMatching] = useState(false);
  const [endless, setEndless] = useState(false);
  const onlineRef = useRef<{room:string;role:"p1"|"p2"}|null>(null);
  const loop = useRef<ReturnType<typeof setInterval> | null>(null);
  const beep = useCallback((freq=160, length=.08) => {
    if (!sound) return;
    try { const A = window.AudioContext || (window as unknown as {webkitAudioContext: typeof AudioContext}).webkitAudioContext; const a=new A(),o=a.createOscillator(),v=a.createGain();o.frequency.value=freq;o.type="square";v.gain.setValueAtTime(.035,a.currentTime);v.gain.exponentialRampToValueAtTime(.001,a.currentTime+length);o.connect(v);v.connect(a.destination);o.start();o.stop(a.currentTime+length); } catch {}
  },[sound]);

  const send = useCallback((action:string, extra:Record<string,number>={})=>{const o=onlineRef.current;if(o)fetch(`/api/rooms/${o.room}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({role:o.role,action,...extra})}).catch(()=>{})},[]);

  const move = useCallback((dx:number,dy:number) => {if(onlineRef.current){send("move",{dx,dy});return}smooth(()=>setG(old => {
    if(old.status!=="playing") return old;
    const x=old.player.x+dx,y=old.player.y+dy,t=old.tiles[y]?.[x];
    if(!t || t==="wall" || t==="crate" || old.bombs.some(b=>b.x===x&&b.y===y)) return old;
    const tiles=old.tiles.map(r=>[...r]); let power=old.power, range=old.range, score=old.score;
    if(t==="power"){power++;score+=100;tiles[y][x]="floor";beep(520)}
    if(t==="range"){range++;score+=100;tiles[y][x]="floor";beep(660)}
    return {...old,player:{x,y},tiles,power,range,score};
  }))},[beep,send]);

  const bomb = useCallback(() => {if(onlineRef.current){send("bomb");beep(110);return}setG(old => {
    if(old.status!=="playing" || old.bombs.filter(b=>b.owner==="p").length>=old.power || old.bombs.some(b=>b.x===old.player.x&&b.y===old.player.y)) return old;
    beep(110); return {...old,bombs:[...old.bombs,{...old.player,owner:"p",at:Date.now()+1800,range:old.range}]};
  })},[beep,send]);

  const applyOnline=useCallback((s:any,r:"p1"|"p2")=>{const me=s.players[r],other=s.players[r==="p1"?"p2":"p1"],isEndless=s.mode==="random";setEndless(isEndless);setWaiting(s.status==="waiting");setMatching(s.status==="waiting"&&isEndless);let tiles=s.tiles,player={x:me.x,y:me.y},bot={x:other.x,y:other.y},bombs=s.bombs,flames=s.flames;if(isEndless){const ox=me.x-Math.floor(W/2),oy=me.y-Math.floor(H/2),destroyed=s.destroyed||{};tiles=Array.from({length:H},(_,y)=>Array.from({length:W},(_,x)=>{const wx=ox+x,wy=oy+y;if(wx%2===0&&wy%2===0)return"wall";if(destroyed[`${wx},${wy}`])return"floor";return hash(wx,wy,s.seed)%100<58?"crate":"floor"}));player={x:Math.floor(W/2),y:Math.floor(H/2)};bot={x:other.x-ox,y:other.y-oy};bombs=s.bombs.map((b:any)=>({...b,x:b.x-ox,y:b.y-oy}));flames=s.flames.map((f:any)=>({x:f.x-ox,y:f.y-oy}))}smooth(()=>setG(old=>({...old,tiles,player,bot,power:me.power,range:me.range,bombs:bombs.map((b:any)=>({...b,owner:b.owner===r?"p":"b"})),flames,status:s.status==="ended"?(me.alive?"win":"lose"):"playing"})))},[]);
  const enter=useCallback(async(c:string,r:"p1"|"p2",join=false)=>{const code=c.toUpperCase();onlineRef.current={room:code,role:r};setRoom(code);setRole(r);setLobby(false);if(join)await fetch(`/api/rooms/${code}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({role:r,action:"join"})});},[]);
  const createRoom=async()=>{const res=await fetch("/api/rooms",{method:"POST"}),data=await res.json();if(data.code)enter(data.code,"p1")};
  const randomMatch=async()=>{setMatching(true);setLobby(false);setEndless(true);const res=await fetch("/api/match",{method:"POST"}),data=await res.json();if(data.code)enter(data.code,data.role);else{setLobby(true);setMatching(false)}};
  const joinRoom=()=>{if(joinCode.trim().length===4)enter(joinCode.trim(),"p2",true)};
  const solo=()=>{onlineRef.current=null;setRole(null);setRoom("");setLobby(false);setWaiting(false);setG(fresh())};

  useEffect(()=>{if(!room||!role)return;const poll=async()=>{try{const res=await fetch(`/api/rooms/${room}`,{cache:"no-store"}),data=await res.json();if(data.state)applyOnline(data.state,role)}catch{}};poll();const id=setInterval(poll,280);return()=>clearInterval(id)},[room,role,applyOnline]);

  useEffect(()=>{
    const down=(e:KeyboardEvent)=>{ const k=e.key.toLowerCase(); if(["arrowup","arrowdown","arrowleft","arrowright"," ","w","a","s","d"].includes(k))e.preventDefault(); if(k==="arrowup"||k==="w")move(0,-1);if(k==="arrowdown"||k==="s")move(0,1);if(k==="arrowleft"||k==="a")move(-1,0);if(k==="arrowright"||k==="d")move(1,0);if(k===" ")bomb(); };
    addEventListener("keydown",down); return()=>removeEventListener("keydown",down);
  },[move,bomb]);

  useEffect(()=>{
    loop.current=setInterval(()=>setG(old=>{
      if(old.status!=="playing" || onlineRef.current) return old;
      let n={...old, tiles:old.tiles.map(r=>[...r]), bombs:[...old.bombs], flames:[]} as Game;
      const now=Date.now(), exploding=n.bombs.filter(b=>b.at<=now); n.bombs=n.bombs.filter(b=>b.at>now);
      const flames:Pos[]=[];
      for(const b of exploding){ flames.push({x:b.x,y:b.y}); for(const d of dirs){for(let i=1;i<=b.range;i++){const x=b.x+d.x*i,y=b.y+d.y*i,t=n.tiles[y]?.[x];if(!t||t==="wall")break;flames.push({x,y});if(t==="crate"){n.tiles[y][x]=((x*7+y*13+now)%5===0)?"power":((x*11+y*5+now)%6===0)?"range":"floor";n.score+=25;break}}}}
      n.flames=flames;
      const hit=(p:Pos)=>flames.some(f=>f.x===p.x&&f.y===p.y);
      if(hit(n.player)){n.status="lose";beep(70,.25);return n} if(hit(n.bot)){n.status="win";n.score+=1000;beep(760,.25);return n}
      if(Math.random()<.38){const options=dirs.map(d=>({x:n.bot.x+d.x,y:n.bot.y+d.y})).filter(p=>n.tiles[p.y]?.[p.x]==="floor"&&!n.bombs.some(b=>b.x===p.x&&b.y===p.y));if(options.length)n.bot=options[Math.floor(Math.random()*options.length)]}
      if(Math.random()<.045&&!n.bombs.some(b=>b.owner==="b")){n.bombs.push({...n.bot,owner:"b",at:now+2100,range:2})}
      return n;
    }),180); return()=>{if(loop.current)clearInterval(loop.current)};
  },[beep]);

  return <main>
    <header><div className="brand"><span className="logoBomb">●</span><div><b>BUBBLE <i>BOOM!</i></b><small>터뜨리고, 피하고, 끝까지 살아남아!</small></div></div><div className="topBtns"><button onClick={()=>setSound(!sound)} aria-label="소리 켜기 끄기">{sound?"♪ SOUND":"× MUTE"}</button><button onClick={()=>{onlineRef.current=null;setLobby(true);setRoom("");setG(fresh())}}>대전 메뉴</button></div></header>
    <section className="gameShell">
      {room&&<div className="roomBar"><span>{endless?"ENDLESS RANDOM":"FRIEND MATCH"}</span>{!endless&&<b>방 코드 {room}</b>}<small>{waiting?(endless?"상대를 찾는 중…":"친구가 들어오길 기다리는 중…"):"상대와 연결됨 ●"}</small></div>}
      <div className="hud"><div><span>SCORE</span><strong>{String(g.score).padStart(6,"0")}</strong></div><div className="round">ROUND <b>01</b></div><div><span>RIVAL</span><strong className="hearts">{g.status==="win"?"♡":"♥"}</strong></div></div>
      <div className="board" style={{gridTemplateColumns:`repeat(${W},1fr)`}}>
        {g.tiles.flatMap((row,y)=>row.map((t,x)=>{
          const p=g.player.x===x&&g.player.y===y,b=g.bot.x===x&&g.bot.y===y,bombHere=g.bombs.find(q=>q.x===x&&q.y===y),fire=g.flames.some(f=>f.x===x&&f.y===y);
          return <div className={`tile ${t}`} key={key(x,y)}>{t==="crate"&&<span className="box">×</span>}{t==="power"&&<span className="item">B+</span>}{t==="range"&&<span className="item rangeIcon">↔</span>}{bombHere&&<span className={`bomb ${bombHere.owner}`}>●<i>✦</i></span>}{p&&<span className="hero"><i>◉</i></span>}{b&&<span className="bot"><i>▼</i></span>}{fire&&<span className="flame">✦</span>}</div>
        }))}
        {lobby&&<div className="overlay lobby"><div><small>ENDLESS ONLINE BATTLE</small><h2>{friendMode?"친구와 대전":"바로 랜덤 대전!"}</h2>{!friendMode?<><p>상대를 자동으로 찾아 끝없이 펼쳐지는 맵에 입장합니다.</p><button className="randomBtn" onClick={randomMatch}>⚡ 랜덤 대전 시작</button><button className="friendBtn" onClick={()=>setFriendMode(true)}>친구와 대전</button></>:<><p>한 명은 방을 만들고, 다른 한 명은 같은 코드를 입력하세요.</p><button onClick={createRoom}>새 친구방 만들기</button><div className="join"><input value={joinCode} maxLength={4} onChange={e=>setJoinCode(e.target.value.toUpperCase())} placeholder="방 코드" aria-label="방 코드"/><button onClick={joinRoom}>입장</button></div><button className="friendBtn" onClick={()=>setFriendMode(false)}>← 랜덤 대전으로</button></>}<button className="solo" onClick={solo}>혼자 연습하기</button></div></div>}
        {!lobby&&matching&&waiting&&<div className="matching"><span className="spinner">●</span><b>상대를 찾고 있어요</b><small>매칭되면 자동으로 시작합니다</small></div>}
        {!lobby&&g.status!=="playing"&&<div className="overlay"><div><small>{g.status==="win"?"CLEAR!":"OH NO!"}</small><h2>{g.status==="win"?"폭발의 승자!":"물방울에 갇혔어요"}</h2><p>{room?"대전 종료":`점수 ${g.score.toLocaleString()}점`}</p><button onClick={()=>{onlineRef.current=null;setLobby(true);setRoom("");setG(fresh())}}>대전 메뉴</button></div></div>}
      </div>
      <div className="mobileControls"><div className="dpad"><button onPointerDown={()=>move(0,-1)}>▲</button><button onPointerDown={()=>move(-1,0)}>◀</button><button onPointerDown={()=>move(0,1)}>▼</button><button onPointerDown={()=>move(1,0)}>▶</button></div><button className="boomBtn" onPointerDown={bomb}>BOMB!<small>폭탄 놓기</small></button></div>
      <div className="tips"><div><kbd>WASD</kbd><span>또는</span><kbd>방향키</kbd><b>이동</b></div><div><kbd>SPACE</kbd><b>폭탄 놓기</b></div><div className="stats"><span>폭탄 <b>{g.power}</b></span><span>화력 <b>{g.range}</b></span></div></div>
    </section>
    <footer><span>친구와 실시간 온라인 대전</span><b>⚡ 설치 없이 바로 플레이</b><span>PC · 모바일</span></footer>
  </main>;
}
