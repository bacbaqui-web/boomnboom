import http from "node:http";
import { WebSocketServer, WebSocket } from "ws";

const PORT = Number(process.env.PORT || 3300);
const TICK_MS = Number(process.env.TICK_MS || 1000);
const WIDTH = 15, HEIGHT = 11;
const CRATE_RESPAWN_TICKS = 8, BOMB_FUSE_TICKS = 3;
const ACTIONS = new Set(["up", "down", "left", "right", "bomb", "wait"]);
const DIRS = { up:[0,-1], down:[0,1], left:[-1,0], right:[1,0], wait:[0,0] };

let tick=0, nextPlayerNumber=1, nextBombNumber=1, nextTickAt=Date.now()+TICK_MS;
let flames=[];
const players=new Map(), bombs=new Map(), destroyed=new Map(), cleared=new Set();
const key=(x,y)=>`${x},${y}`;
const permanent=(x,y)=>x%2===0&&y%2===0;
function hash(x,y){let n=Math.imul(x,374761393)+Math.imul(y,668265263)+0x9e3779b9;n=Math.imul(n^(n>>>13),1274126177);return(n^(n>>>16))>>>0}
function naturalCrate(x,y){return !permanent(x,y)&&!cleared.has(key(x,y))&&hash(x,y)%100<43}
function hasCrate(x,y){return naturalCrate(x,y)&&!destroyed.has(key(x,y))}
function tileState(x,y){
  if(permanent(x,y))return"wall";
  if(hasCrate(x,y))return"crate";
  const respawnTick=destroyed.get(key(x,y));
  return respawnTick!==undefined&&respawnTick-tick<=2?"warning":"floor";
}
function blocked(x,y){return permanent(x,y)||hasCrate(x,y)||[...bombs.values()].some(b=>b.x===x&&b.y===y)}
function clearSpawn(x,y){for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if(Math.abs(dx)+Math.abs(dy)<=1)cleared.add(key(x+dx,y+dy))}

function freeSpawn(isAI=false){
  if(isAI&&!players.size)return[1,1];
  const anchor=[...players.values()][0]||{x:1,y:1};
  for(let attempt=0;attempt<20;attempt++){
    const distance=14+((nextPlayerNumber*7+attempt*5)%15);
    const angle=(nextPlayerNumber*2.399+attempt*.73);
    let x=Math.round(anchor.x+Math.cos(angle)*distance),y=Math.round(anchor.y+Math.sin(angle)*distance);
    if(x%2===0)x++;if(y%2===0)y++;
    if(![...players.values()].some(p=>Math.abs(p.x-x)+Math.abs(p.y-y)<10))return[x,y];
  }
  return[anchor.x+15+nextPlayerNumber*4,anchor.y+11+nextPlayerNumber*2];
}
function addPlayer({socket=null,isAI=false}={}){
  const id=isAI?"BOT-1":`P${nextPlayerNumber++}`,[x,y]=freeSpawn(isAI);
  clearSpawn(x,y);const player={id,x,y,prevX:x,prevY:y,isAI,action:"wait",socket,score:0,nickname:isAI?"BOOM AI":"",joined:isAI,alive:isAI};players.set(id,player);return player;
}
addPlayer({isAI:true});

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
  for(const[dx,dy]of[[1,0],[-1,0],[0,1],[0,-1]])for(let n=1;n<=2;n++){
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
  for(const cell of flames)if(hasCrate(cell.x,cell.y))destroyed.set(key(cell.x,cell.y),tick+CRATE_RESPAWN_TICKS);
  for(const player of players.values())if(player.alive&&unique.has(key(player.x,player.y))){
    player.action="wait";
    if(!player.isAI){player.alive=false;continue}
    const[x,y]=freeSpawn(true);clearSpawn(x,y);player.x=x;player.y=y;player.prevX=x;player.prevY=y;
  }
}
function resolveActions(){
  const active=[...players.values()].filter(p=>p.alive);
  for(const player of active){player.prevX=player.x;player.prevY=player.y;if(player.isAI)player.action=chooseBotAction(player)}
  for(const player of active)if(player.action==="bomb"){
    const occupied=[...bombs.values()].some(b=>b.x===player.x&&b.y===player.y),owns=[...bombs.values()].some(b=>b.owner===player.id);
    if(!occupied&&!owns)bombs.set(nextBombNumber,{id:nextBombNumber++,x:player.x,y:player.y,owner:player.id,fuse:BOMB_FUSE_TICKS,bornTick:tick});player.action="wait";
  }
  const intents=new Map();
  for(const player of active){const[dx,dy]=DIRS[player.action]||DIRS.wait,x=player.x+dx,y=player.y+dy;intents.set(player.id,blocked(x,y)?{x:player.x,y:player.y}:{x,y})}
  const counts=new Map();for(const pos of intents.values())counts.set(key(pos.x,pos.y),(counts.get(key(pos.x,pos.y))||0)+1);
  for(const player of active){const pos=intents.get(player.id);if(counts.get(key(pos.x,pos.y))===1){player.x=pos.x;player.y=pos.y}}
}
function stateFor(viewer){
  const originX=viewer.x-Math.floor(WIDTH/2),originY=viewer.y-Math.floor(HEIGHT/2);
  const visible=(x,y)=>x>=originX&&x<originX+WIDTH&&y>=originY&&y<originY+HEIGHT;
  return{type:"state",tick,nextTickAt,width:WIDTH,height:HEIGHT,originX,originY,worldX:viewer.x,worldY:viewer.y,cameraDx:viewer.x-viewer.prevX,cameraDy:viewer.y-viewer.prevY,
    tiles:Array.from({length:HEIGHT},(_,sy)=>Array.from({length:WIDTH},(_,sx)=>tileState(originX+sx,originY+sy))),
    players:[...players.values()].filter(p=>p===viewer||(p.alive&&visible(p.x,p.y))).map(({id,x,y,isAI,action,score,nickname,joined,alive})=>({id,x:x-originX,y:y-originY,isAI,action,score,nickname,joined,alive})),
    bombs:[...bombs.values()].filter(b=>visible(b.x,b.y)).map(b=>({...b,x:b.x-originX,y:b.y-originY})),flames:flames.filter(f=>visible(f.x,f.y)).map(f=>({x:f.x-originX,y:f.y-originY}))};
}
function broadcast(){for(const player of players.values())if(player.socket?.readyState===WebSocket.OPEN)player.socket.send(JSON.stringify(stateFor(player)))}
function runTick(){
  tick++;
  for(const[k,respawnTick]of destroyed)if(respawnTick<=tick){
    const occupied=[...players.values()].some(p=>p.alive&&key(p.x,p.y)===k)||[...bombs.values()].some(b=>key(b.x,b.y)===k);
    if(occupied)destroyed.set(k,tick+1);else destroyed.delete(k);
  }
  resolveActions();explodeBombs();nextTickAt=Date.now()+TICK_MS;broadcast();
}

const server=http.createServer((req,res)=>{if(req.url==="/health"){res.writeHead(200,{"content-type":"application/json"});return res.end(JSON.stringify({ok:true,tick,players:players.size,destroyed:destroyed.size,uptime:Math.round(process.uptime())}))}res.writeHead(404).end()});
const wss=new WebSocketServer({noServer:true});
server.on("upgrade",(req,socket,head)=>{if(req.url!=="/boom-ws"&&req.url!=="/")return socket.destroy();wss.handleUpgrade(req,socket,head,ws=>wss.emit("connection",ws))});
wss.on("connection",ws=>{const player=addPlayer({socket:ws});ws.send(JSON.stringify({type:"welcome",id:player.id,tickMs:TICK_MS}));ws.send(JSON.stringify(stateFor(player)));ws.on("message",raw=>{try{const msg=JSON.parse(raw.toString());if(msg.type==="join"&&!player.joined){player.nickname=String(msg.nickname||"").trim().slice(0,12)||`플레이어${player.id.slice(1)}`;player.joined=true;player.alive=true;player.action="wait";broadcast()}else if(msg.type==="respawn"&&player.joined&&!player.alive){const[x,y]=freeSpawn();clearSpawn(x,y);player.x=x;player.y=y;player.prevX=x;player.prevY=y;player.alive=true;player.action="wait";broadcast()}else if(msg.type==="action"&&player.alive&&ACTIONS.has(msg.action))player.action=msg.action}catch{/* ignore malformed input */}});ws.on("close",()=>players.delete(player.id))});
const timer=setInterval(runTick,TICK_MS);timer.unref();server.listen(PORT,"127.0.0.1",()=>console.log(`BOOMnBOOM infinite tick server listening on 127.0.0.1:${PORT}`));
for(const signal of["SIGINT","SIGTERM"])process.on(signal,()=>{for(const client of wss.clients)client.terminate();server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),1000).unref()});
