import http from "node:http";
import { WebSocketServer, WebSocket } from "ws";

const PORT = Number(process.env.PORT || 3300);
const TICK_MS = Number(process.env.TICK_MS || 1000);
// One permanent world clock. It keeps advancing across restarts and even while
// nobody is connected. At every whole second the track is on a snare.
const WORLD_EPOCH_MS = Number(process.env.WORLD_EPOCH_MS || Date.UTC(2026, 7, 14, 0, 0, 0));
const BGM_DURATION_MS = 209995.5;
const BGM_SNARE_OFFSET_MS = 255;
const WIDTH = 15, HEIGHT = 11;
const BOT_COUNT = 6;
const CRATE_RESPAWN_TICKS = 8, BOMB_FUSE_TICKS = 3;
const ITEM_TYPES = ["bomb","shield","flame"];
const ACTIONS = new Set(["up", "down", "left", "right", "bomb", "wait"]);
const DIRS = { up:[0,-1], down:[0,1], left:[-1,0], right:[1,0], wait:[0,0] };

const timelineAt=(now=Date.now())=>{
  const elapsed=Math.max(0,now-WORLD_EPOCH_MS),tick=Math.floor(elapsed/TICK_MS);
  return{tick,nextTickAt:WORLD_EPOCH_MS+(tick+1)*TICK_MS};
};
let {tick,nextTickAt}=timelineAt(), nextPlayerNumber=1, nextBotNumber=1, nextBombNumber=1;
let flames=[];
const players=new Map(), bombs=new Map(), items=new Map(), destroyed=new Map(), cleared=new Set(), respawnHeld=new Set();
const chunkCache=new Map();
const key=(x,y)=>`${x},${y}`;
const permanent=(x,y)=>x%2===0&&y%2===0;
function hash(x,y){let n=Math.imul(x,374761393)+Math.imul(y,668265263)+0x9e3779b9;n=Math.imul(n^(n>>>13),1274126177);return(n^(n>>>16))>>>0}
function chunkCrates(chunkX,chunkY){
  const chunkKey=key(chunkX,chunkY);if(chunkCache.has(chunkKey))return chunkCache.get(chunkKey);
  const candidates=[];
  for(let localY=0;localY<9;localY++)for(let localX=0;localX<9;localX++){
    const x=chunkX*9+localX,y=chunkY*9+localY;
    if(!permanent(x,y))candidates.push({x,y,order:hash(x,y)});
  }
  candidates.sort((a,b)=>a.order-b.order);const crates=new Set();
  const occupied=(x,y)=>crates.has(key(x,y));
  const makesLine=(x,y)=>[[[-2,0],[-1,0]],[[ -1,0],[1,0]],[[1,0],[2,0]],[[0,-2],[0,-1]],[[0,-1],[0,1]],[[0,1],[0,2]]].some(pair=>pair.every(([dx,dy])=>occupied(x+dx,y+dy)));
  for(const cell of candidates){
    if(crates.size>=26)break;
    let nearby=0;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if(occupied(cell.x+dx,cell.y+dy))nearby++;
    if(nearby<4&&!makesLine(cell.x,cell.y))crates.add(key(cell.x,cell.y));
  }
  chunkCache.set(chunkKey,crates);if(chunkCache.size>512)chunkCache.delete(chunkCache.keys().next().value);return crates;
}
function naturalCrate(x,y){return !cleared.has(key(x,y))&&chunkCrates(Math.floor(x/9),Math.floor(y/9)).has(key(x,y))}
function hasCrate(x,y){return naturalCrate(x,y)&&!destroyed.has(key(x,y))}
function tileState(x,y){
  if(permanent(x,y))return"wall";
  if(hasCrate(x,y))return"crate";
  const respawnTick=destroyed.get(key(x,y));
  const playerNearby=[...players.values()].some(p=>p.alive&&Math.abs(p.x-x)<=2&&Math.abs(p.y-y)<=2);
  return respawnTick!==undefined&&respawnTick-tick<=2&&!playerNearby?"warning":"floor";
}
function blocked(x,y){return permanent(x,y)||hasCrate(x,y)||[...bombs.values()].some(b=>b.x===x&&b.y===y)}
function clearSpawn(x,y){for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if(Math.abs(dx)+Math.abs(dy)<=1)cleared.add(key(x+dx,y+dy))}

function freeSpawn(isAI=false){
  if(isAI&&!players.size)return[1,1];
  const anchor=[...players.values()][0]||{x:1,y:1};
  const spawnNumber=isAI?nextBotNumber:nextPlayerNumber;
  for(let attempt=0;attempt<20;attempt++){
    const distance=14+((spawnNumber*7+attempt*5)%15);
    const angle=(spawnNumber*2.399+attempt*.73);
    let x=Math.round(anchor.x+Math.cos(angle)*distance),y=Math.round(anchor.y+Math.sin(angle)*distance);
    if(x%2===0)x++;if(y%2===0)y++;
    if(![...players.values()].some(p=>Math.abs(p.x-x)+Math.abs(p.y-y)<10))return[x,y];
  }
  return[anchor.x+15+spawnNumber*4,anchor.y+11+spawnNumber*2];
}
function addPlayer({socket=null,isAI=false}={}){
  const botNumber=isAI?nextBotNumber:null,id=isAI?`BOT-${nextBotNumber++}`:`P${nextPlayerNumber++}`,[x,y]=freeSpawn(isAI);
  clearSpawn(x,y);const player={id,x,y,prevX:x,prevY:y,isAI,action:"wait",socket,score:0,power:1,range:2,shield:0,nickname:isAI?`BOOM AI ${botNumber}`:"",joined:isAI,alive:isAI};players.set(id,player);return player;
}
for(let i=0;i<BOT_COUNT;i++)addPlayer({isAI:true});

function chooseBotAction(bot){
  const humans=[...players.values()].filter(p=>!p.isAI&&p.alive);if(!humans.length)return"wait";
  const target=humans.reduce((a,b)=>Math.abs(a.x-bot.x)+Math.abs(a.y-bot.y)<Math.abs(b.x-bot.x)+Math.abs(b.y-bot.y)?a:b);
  const distance=Math.abs(target.x-bot.x)+Math.abs(target.y-bot.y);
  if(distance<=2&&![...bombs.values()].some(b=>b.owner===bot.id))return"bomb";
  const choices=Math.abs(target.x-bot.x)>=Math.abs(target.y-bot.y)?[target.x<bot.x?"left":"right",target.y<bot.y?"up":"down"]:[target.y<bot.y?"up":"down",target.x<bot.x?"left":"right"];
  return choices.find(a=>{const[dX,dY]=DIRS[a];return!blocked(bot.x+dX,bot.y+dY)})||["up","right","down","left"].find(a=>{const[dX,dY]=DIRS[a];return!blocked(bot.x+dX,bot.y+dY)})||"wait";
}
function blastCells(bomb){
  const cells=[{x:bomb.x,y:bomb.y}];
  for(const[dx,dy]of[[1,0],[-1,0],[0,1],[0,-1]])for(let n=1;n<=bomb.range;n++){
    const x=bomb.x+dx*n,y=bomb.y+dy*n;if(permanent(x,y))break;cells.push({x,y});if(hasCrate(x,y))break;
  }
  return cells;
}
function explodeBombs(){
  const exploding=[];
  for(const bomb of bombs.values()){
    if(bomb.bornTick===tick)continue;
    if(--bomb.fuse<=0)exploding.push(bomb);
  }
  const cells=[];
  for(const bomb of exploding){bombs.delete(bomb.id);cells.push(...blastCells(bomb))}
  const unique=new Map(cells.map(c=>[key(c.x,c.y),c]));flames=[...unique.values()];
  for(const cell of flames)if(hasCrate(cell.x,cell.y)){const cellKey=key(cell.x,cell.y);respawnHeld.delete(cellKey);destroyed.set(cellKey,tick+CRATE_RESPAWN_TICKS)}
  for(const player of players.values())if(player.alive&&unique.has(key(player.x,player.y))){
    player.action="wait";
    if(player.shield>0){player.shield--;continue}
    if(!player.isAI){player.alive=false;continue}
    const dropKey=key(player.x,player.y),type=ITEM_TYPES[hash(player.x+tick,player.y-tick)%ITEM_TYPES.length];
    items.set(dropKey,{x:player.x,y:player.y,type});
    const[x,y]=freeSpawn(true);clearSpawn(x,y);player.x=x;player.y=y;player.prevX=x;player.prevY=y;
  }
}
function collectItems(){
  for(const player of players.values())if(player.alive){
    const itemKey=key(player.x,player.y),item=items.get(itemKey);if(!item)continue;
    if(item.type==="bomb")player.power++;
    else if(item.type==="shield")player.shield++;
    else if(item.type==="flame")player.range++;
    items.delete(itemKey);
  }
}
function resolveActions(){
  const active=[...players.values()].filter(p=>p.alive);
  for(const player of active){player.prevX=player.x;player.prevY=player.y;if(player.isAI)player.action=chooseBotAction(player)}
  for(const player of active)if(player.action==="bomb"){
    const occupied=[...bombs.values()].some(b=>b.x===player.x&&b.y===player.y),owned=[...bombs.values()].filter(b=>b.owner===player.id).length;
    if(!occupied&&owned<player.power)bombs.set(nextBombNumber,{id:nextBombNumber++,x:player.x,y:player.y,owner:player.id,fuse:BOMB_FUSE_TICKS,bornTick:tick,range:player.range});player.action="wait";
  }
  const intents=new Map();
  for(const player of active){const[dx,dy]=DIRS[player.action]||DIRS.wait,x=player.x+dx,y=player.y+dy;intents.set(player.id,blocked(x,y)?{x:player.x,y:player.y}:{x,y})}
  const counts=new Map();for(const pos of intents.values())counts.set(key(pos.x,pos.y),(counts.get(key(pos.x,pos.y))||0)+1);
  for(const player of active){const pos=intents.get(player.id);if(counts.get(key(pos.x,pos.y))===1){player.x=pos.x;player.y=pos.y}}
  collectItems();
}
function stateFor(viewer){
  const serverNow=Date.now();
  const originX=viewer.x-Math.floor(WIDTH/2),originY=viewer.y-Math.floor(HEIGHT/2);
  const visible=(x,y)=>x>=originX&&x<originX+WIDTH&&y>=originY&&y<originY+HEIGHT;
  return{type:"state",tick,nextTickAt,serverNow,nextTickInMs:Math.max(0,nextTickAt-serverNow),worldEpochMs:WORLD_EPOCH_MS,bgmDurationMs:BGM_DURATION_MS,bgmSnareOffsetMs:BGM_SNARE_OFFSET_MS,width:WIDTH,height:HEIGHT,originX,originY,worldX:viewer.x,worldY:viewer.y,cameraDx:viewer.x-viewer.prevX,cameraDy:viewer.y-viewer.prevY,
    tiles:Array.from({length:HEIGHT},(_,sy)=>Array.from({length:WIDTH},(_,sx)=>tileState(originX+sx,originY+sy))),
    players:[...players.values()].filter(p=>p===viewer||(p.alive&&visible(p.x,p.y))).map(({id,x,y,prevX,prevY,isAI,action,score,power,range,shield,nickname,joined,alive})=>({id,x:x-originX,y:y-originY,isAI,action,score,power,range,shield,nickname,joined,alive,moved:x!==prevX||y!==prevY})),
    enemyDirections:[...players.values()].filter(p=>p!==viewer&&p.alive&&!visible(p.x,p.y)).map(p=>({id:p.id,dx:p.x-viewer.x,dy:p.y-viewer.y,distance:Math.abs(p.x-viewer.x)+Math.abs(p.y-viewer.y),nickname:p.nickname,isAI:p.isAI})),
    bombs:[...bombs.values()].filter(b=>visible(b.x,b.y)).map(b=>({...b,x:b.x-originX,y:b.y-originY})),items:[...items.values()].filter(i=>visible(i.x,i.y)).map(i=>({...i,x:i.x-originX,y:i.y-originY})),flames:flames.filter(f=>visible(f.x,f.y)).map(f=>({x:f.x-originX,y:f.y-originY}))};
}
function broadcast(){for(const player of players.values())if(player.socket?.readyState===WebSocket.OPEN)player.socket.send(JSON.stringify(stateFor(player)))}
function runTick(){
  const timeline=timelineAt();
  if(timeline.tick<=tick){nextTickAt=timeline.nextTickAt;return}
  tick=timeline.tick;
  for(const[k,respawnTick]of destroyed)if(respawnTick<=tick){
    const[x,y]=k.split(",").map(Number);
    const nearPlayer=[...players.values()].some(p=>p.alive&&Math.abs(p.x-x)<=2&&Math.abs(p.y-y)<=2);
    const bombHere=[...bombs.values()].some(b=>b.x===x&&b.y===y);
    if(nearPlayer||bombHere){respawnHeld.add(k);destroyed.set(k,tick+1)}
    else if(respawnHeld.delete(k))destroyed.set(k,tick+2);
    else destroyed.delete(k);
  }
  resolveActions();explodeBombs();nextTickAt=timeline.nextTickAt;broadcast();
}

const server=http.createServer((req,res)=>{if(req.url==="/health"){res.writeHead(200,{"content-type":"application/json"});return res.end(JSON.stringify({ok:true,tick,players:players.size,destroyed:destroyed.size,uptime:Math.round(process.uptime())}))}res.writeHead(404).end()});
const wss=new WebSocketServer({noServer:true});
server.on("upgrade",(req,socket,head)=>{if(req.url!=="/boom-ws"&&req.url!=="/")return socket.destroy();wss.handleUpgrade(req,socket,head,ws=>wss.emit("connection",ws))});
wss.on("connection",ws=>{const player=addPlayer({socket:ws});ws.send(JSON.stringify({type:"welcome",id:player.id,tickMs:TICK_MS}));ws.send(JSON.stringify(stateFor(player)));ws.on("message",raw=>{try{const msg=JSON.parse(raw.toString());if(msg.type==="join"&&!player.joined){player.nickname=String(msg.nickname||"").trim().slice(0,12)||`플레이어${player.id.slice(1)}`;player.joined=true;player.alive=true;player.action="wait";broadcast()}else if(msg.type==="respawn"&&player.joined&&!player.alive){const[x,y]=freeSpawn();clearSpawn(x,y);player.x=x;player.y=y;player.prevX=x;player.prevY=y;player.alive=true;player.action="wait";broadcast()}else if(msg.type==="action"&&player.alive&&ACTIONS.has(msg.action))player.action=msg.action}catch{/* ignore malformed input */}});ws.on("close",()=>players.delete(player.id))});
let timer;
function scheduleTick(){timer=setTimeout(()=>{runTick();scheduleTick()},Math.max(1,nextTickAt-Date.now()));timer.unref()}
scheduleTick();server.listen(PORT,"127.0.0.1",()=>console.log(`BOOMnBOOM infinite tick server listening on 127.0.0.1:${PORT}`));
for(const signal of["SIGINT","SIGTERM"])process.on(signal,()=>{for(const client of wss.clients)client.terminate();server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),1000).unref()});
