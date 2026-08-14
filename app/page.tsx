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
function fresh(): Game {
  const safe = new Set(["1,1","1,2","2,1",`${W-2},${H-2}`,`${W-3},${H-2}`,`${W-2},${H-3}`]);
  const tiles: Tile[][] = Array.from({ length: H }, (_, y) => Array.from({ length: W }, (_, x) => {
    if (x === 0 || y === 0 || x === W-1 || y === H-1 || (x % 2 === 0 && y % 2 === 0)) return "wall";
    return !safe.has(key(x,y)) && ((x * 17 + y * 31 + x*y) % 10 < 6) ? "crate" : "floor";
  }));
  return { tiles, player:{x:1,y:1}, bot:{x:W-2,y:H-2}, bombs:[], flames:[], power:1, range:2, score:0, status:"playing" };
}

const dirs = [{x:0,y:-1},{x:1,y:0},{x:0,y:1},{x:-1,y:0}];

export default function Home() {
  const [g, setG] = useState<Game>(fresh);
  const [sound, setSound] = useState(true);
  const loop = useRef<ReturnType<typeof setInterval> | null>(null);
  const beep = useCallback((freq=160, length=.08) => {
    if (!sound) return;
    try { const A = window.AudioContext || (window as unknown as {webkitAudioContext: typeof AudioContext}).webkitAudioContext; const a=new A(),o=a.createOscillator(),v=a.createGain();o.frequency.value=freq;o.type="square";v.gain.setValueAtTime(.035,a.currentTime);v.gain.exponentialRampToValueAtTime(.001,a.currentTime+length);o.connect(v);v.connect(a.destination);o.start();o.stop(a.currentTime+length); } catch {}
  },[sound]);

  const move = useCallback((dx:number,dy:number) => setG(old => {
    if(old.status!=="playing") return old;
    const x=old.player.x+dx,y=old.player.y+dy,t=old.tiles[y]?.[x];
    if(!t || t==="wall" || t==="crate" || old.bombs.some(b=>b.x===x&&b.y===y)) return old;
    const tiles=old.tiles.map(r=>[...r]); let power=old.power, range=old.range, score=old.score;
    if(t==="power"){power++;score+=100;tiles[y][x]="floor";beep(520)}
    if(t==="range"){range++;score+=100;tiles[y][x]="floor";beep(660)}
    return {...old,player:{x,y},tiles,power,range,score};
  }),[beep]);

  const bomb = useCallback(() => setG(old => {
    if(old.status!=="playing" || old.bombs.filter(b=>b.owner==="p").length>=old.power || old.bombs.some(b=>b.x===old.player.x&&b.y===old.player.y)) return old;
    beep(110); return {...old,bombs:[...old.bombs,{...old.player,owner:"p",at:Date.now()+1800,range:old.range}]};
  }),[beep]);

  useEffect(()=>{
    const down=(e:KeyboardEvent)=>{ const k=e.key.toLowerCase(); if(["arrowup","arrowdown","arrowleft","arrowright"," ","w","a","s","d"].includes(k))e.preventDefault(); if(k==="arrowup"||k==="w")move(0,-1);if(k==="arrowdown"||k==="s")move(0,1);if(k==="arrowleft"||k==="a")move(-1,0);if(k==="arrowright"||k==="d")move(1,0);if(k===" ")bomb(); };
    addEventListener("keydown",down); return()=>removeEventListener("keydown",down);
  },[move,bomb]);

  useEffect(()=>{
    loop.current=setInterval(()=>setG(old=>{
      if(old.status!=="playing") return old;
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
    <header><div className="brand"><span className="logoBomb">●</span><div><b>BUBBLE <i>BOOM!</i></b><small>터뜨리고, 피하고, 끝까지 살아남아!</small></div></div><div className="topBtns"><button onClick={()=>setSound(!sound)} aria-label="소리 켜기 끄기">{sound?"♪ SOUND":"× MUTE"}</button><button onClick={()=>setG(fresh())}>↻ 다시 시작</button></div></header>
    <section className="gameShell">
      <div className="hud"><div><span>SCORE</span><strong>{String(g.score).padStart(6,"0")}</strong></div><div className="round">ROUND <b>01</b></div><div><span>RIVAL</span><strong className="hearts">{g.status==="win"?"♡":"♥"}</strong></div></div>
      <div className="board" style={{gridTemplateColumns:`repeat(${W},1fr)`}}>
        {g.tiles.flatMap((row,y)=>row.map((t,x)=>{
          const p=g.player.x===x&&g.player.y===y,b=g.bot.x===x&&g.bot.y===y,bombHere=g.bombs.find(q=>q.x===x&&q.y===y),fire=g.flames.some(f=>f.x===x&&f.y===y);
          return <div className={`tile ${t}`} key={key(x,y)}>{t==="crate"&&<span className="box">×</span>}{t==="power"&&<span className="item">B+</span>}{t==="range"&&<span className="item rangeIcon">↔</span>}{bombHere&&<span className={`bomb ${bombHere.owner}`}>●<i>✦</i></span>}{p&&<span className="hero"><i>◉</i></span>}{b&&<span className="bot"><i>▼</i></span>}{fire&&<span className="flame">✦</span>}</div>
        }))}
        {g.status!=="playing"&&<div className="overlay"><div><small>{g.status==="win"?"CLEAR!":"OH NO!"}</small><h2>{g.status==="win"?"폭발의 승자!":"물방울에 갇혔어요"}</h2><p>점수 {g.score.toLocaleString()}점</p><button onClick={()=>setG(fresh())}>한 판 더!</button></div></div>}
      </div>
      <div className="mobileControls"><div className="dpad"><button onPointerDown={()=>move(0,-1)}>▲</button><button onPointerDown={()=>move(-1,0)}>◀</button><button onPointerDown={()=>move(0,1)}>▼</button><button onPointerDown={()=>move(1,0)}>▶</button></div><button className="boomBtn" onPointerDown={bomb}>BOMB!<small>폭탄 놓기</small></button></div>
      <div className="tips"><div><kbd>WASD</kbd><span>또는</span><kbd>방향키</kbd><b>이동</b></div><div><kbd>SPACE</kbd><b>폭탄 놓기</b></div><div className="stats"><span>폭탄 <b>{g.power}</b></span><span>화력 <b>{g.range}</b></span></div></div>
    </section>
    <footer><span>혼자 즐기는 빠른 한 판</span><b>⚡ 설치 없이 바로 플레이</b><span>PC · 모바일</span></footer>
  </main>;
}
