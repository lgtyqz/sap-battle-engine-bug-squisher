import sharp from 'sharp';
import { mkdir, readFile } from 'node:fs/promises';
import { catalogs } from './normalize.mjs';

const xml=value=>String(value??'?').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const root=new URL('../Sprite/',import.meta.url);
const names=Object.fromEntries(['pets','perks'].map(kind=>[kind,new Map(catalogs[kind].map(p=>[p.Name,p.NameId]))]));

// Replay-bot style: opposing sprite rows, held food, levels and colored stats.
// Render locally with existing assets and sharp so reports need no browser/server.
export async function renderEngineImages(events,outDir) {
 await mkdir(`${outDir}/evidence/engine-checkpoints`,{recursive:true});
 const images=new Map(),cache=new Map();
 async function sprite(kind,name,flip=false) {
  const id=names[kind].get(name);
  if(!id)return null;
  const key=`${kind}/${id}/${flip}`;
  if(!cache.has(key))cache.set(key,(async()=>{
   try{
    const data=await readFile(new URL(`${kind==='pets'?'Pets':'Food'}/${id}.png`,root));
    let img=sharp(data).resize(kind==='pets'?78:28,kind==='pets'?78:28,{fit:'contain'});
    if(flip)img=img.flop();
    return await img.png().toBuffer();
   }catch(error){if(error.code==='ENOENT')return null;throw error;}
  })());
  return cache.get(key);
 }
 for(const [index,event] of events.entries()){
  const count=Math.max(5,...['player','opponent'].map(side=>event.board?.[side]?.length??0));
  const width=count*116*2+80,height=245,layers=[];
  const text=(x,y,value,color='#253047',size=14)=>`<text x="${x}" y="${y}" fill="${color}" font-family="sans-serif" font-size="${size}" text-anchor="middle">${xml(value)}</text>`;
  let svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#f5f7fb"/>`;
  svg+=text(width/4,25,'PLAYER →')+text(width*3/4,25,'← OPPONENT');
  for(const [sideIndex,side] of ['player','opponent'].entries()){
   for(let i=0;i<count;i++){
    const pet=event.board?.[side]?.[i];
    const x=20+(sideIndex===0?count-1-i:count+i)*116+sideIndex*40;
    svg+=`<rect x="${x}" y="40" width="108" height="190" rx="10" fill="${pet?.health<=0?'#f5d8d8':'white'}" stroke="#cdd5e0"/>`;
    if(!pet){svg+=text(x+54,140,'empty','#8a94a5');continue;}
    svg+=text(x+54,60,`Lv ${pet.exp==null?'?':pet.exp>=5?3:pet.exp>=2?2:1} · XP ${pet.exp??'?'}`, '#986019',12);
    svg+=text(x+54,159,pet.name,'#253047',11);
    svg+=text(x+28,183,pet.attack,'#188544',20)+text(x+80,183,pet.health,'#c33443',20);
    svg+=text(x+54,203,`Mana ${pet.mana??'?'}`, '#5268b7',12);
    svg+=text(x+54,221,pet.equipment===null?'No perk':pet.equipment??'Perk unknown','#596579',10);
    const art=await sprite('pets',pet.name,side==='player');
    if(art)layers.push({input:art,left:x+15,top:68});
    else svg+=text(x+54,115,'?', '#8a94a5',32);
    const perk=await sprite('perks',pet.equipment);
    if(perk)layers.push({input:perk,left:x+78,top:66});
   }
  }
  svg+='</svg>';
  const path=`evidence/engine-checkpoints/${String(index).padStart(4,'0')}.png`;
  await sharp(Buffer.from(svg)).composite(layers).png().toFile(`${outDir}/${path}`);
  images.set(event.sequence,path);
 }
 return images;
}
