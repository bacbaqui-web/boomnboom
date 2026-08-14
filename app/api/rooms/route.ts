import { env } from "cloudflare:workers";

const W=13,H=11;
function makeState(){const safe=new Set(["1,1","1,2","2,1","11,9","10,9","11,8"]);const tiles=Array.from({length:H},(_,y)=>Array.from({length:W},(_,x)=>x===0||y===0||x===W-1||y===H-1||(x%2===0&&y%2===0)?"wall":!safe.has(`${x},${y}`)&&((x*17+y*31+x*y)%10<6)?"crate":"floor"));return{tiles,players:{p1:{x:1,y:1,alive:true,power:1,range:2},p2:{x:11,y:9,alive:true,power:1,range:2}},bombs:[],flames:[],status:"waiting",updatedAt:Date.now()}}
function code(){return Math.random().toString(36).slice(2,6).toUpperCase()}
export async function POST(){for(let i=0;i<5;i++){const c=code();try{await env.DB.prepare("INSERT INTO game_rooms (code,state,version,updated_at) VALUES (?,?,0,?)").bind(c,JSON.stringify(makeState()),Date.now()).run();return Response.json({code:c,role:"p1"},{status:201})}catch{}}return Response.json({error:"방을 만들지 못했어요"},{status:500})}
