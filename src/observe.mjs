import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadGlyphs, readStats } from './vision.mjs';
import { boardDiff } from './align.mjs';
export function spriteWorker() {
 const child=spawn(resolve('.venv/bin/python'),[resolve('scripts/recognize_sprites.py')],{stdio:['pipe','pipe','pipe']});
 const pending=[];let errorText='';let failure;
 child.stderr.on('data',b=>{errorText=(errorText+b).slice(-2000);});
 const fail=error=>{failure=error;for(const p of pending.splice(0))p.reject(error);};
 child.on('error',fail);child.on('exit',code=>{if(code!==0)fail(new Error(`Sprite worker exited ${code}: ${errorText}`));});
 createInterface({input:child.stdout}).on('line',line=>{
  const p=pending.shift();if(!p)return;
  try{const result=JSON.parse(line);if(result.error)throw new Error(result.error);p.resolve(result.slots);}catch(error){p.reject(error);}
 });
 return {read:(path,activeSlots)=>new Promise((resolve,reject)=>{if(failure)return reject(failure);pending.push({resolve,reject});child.stdin.write(JSON.stringify({path,activeSlots})+'\n');}),close:()=>child.stdin.end()};
}
export async function observeCapture(normalized,dir,{onProgress=()=>{},worker:sharedWorker,glyphs:sharedGlyphs}={}) {
 const capture=JSON.parse(await readFile(`${dir}/capture.json`));
 if(capture.inputHash!==normalized.metadata.inputHash)throw new Error('Capture does not belong to this input');
 if(capture.injectionCount<1)throw new Error('Capture did not verify replay injection');
 const worker=sharedWorker??spriteWorker(),glyphs=sharedGlyphs??await loadGlyphs(),checkpoints=[],gaps=[];
 let initialVerified=false;const initialChecks=[];
 try{
  for(const [index,frame] of capture.frames.entries()){
   const path=resolve(dir,frame.frame),stats=await readStats(path,glyphs),sprites=await worker.read(path,stats.slots.map((s,i)=>s.attack||s.health?i:null).filter(i=>i!==null));
   await writeFile(`${dir}/frames/${index}.recognition.json`,JSON.stringify({stats,sprites},null,2));
   const board={player:[],opponent:[]},issues=[],dying=[];
   for(let slot=0;slot<10;slot++){
    const stat=stats.slots[slot];
    if(!stat.attack&&!stat.health){
     if(stat.badges)issues.push(`slot ${slot}: visible stat badge has unreadable digits`);
     continue;
    }
    if(stat.health&&stat.health.value<=0&&stat.health.error<=.31&&stat.health.margin>=.035){dying.push({slot,health:stat.health.value});continue;}
    const best=sprites[slot].pets[0],next=sprites[slot].pets[1];
    if(!stat.attack||!stat.health||stat.attack.error>.31||stat.health.error>.31||stat.attack.margin<.035||stat.health.margin<.035){issues.push(`slot ${slot}: unreadable stats`);continue;}
    if(!best || (best.method==='template' ? best.error>.18 || (next&&next.error-best.error<.12) : best.inliers<6||best.ratio<.7||(next&&best.inliers-next.inliers<2))){issues.push(`slot ${slot}: ambiguous pet`);continue;}
    const pet={name:best.name,attack:stat.attack.value,health:stat.health.value};
    const [bestPerk,nextPerk]=sprites[slot].perks;
    const perk=bestPerk&&(bestPerk.method==='template'
     ? bestPerk.error<.18&&(!nextPerk||nextPerk.error-bestPerk.error>=.08)
     : bestPerk.inliers>=6&&bestPerk.ratio>=.75&&(!nextPerk||bestPerk.inliers-nextPerk.inliers>=2))?bestPerk:null;
    // No feature match does not prove absence of a small/occluded perk. Leave it unobserved.
    if(perk)pet.equipment=perk.name;
    board[slot<5?'player':'opponent'].push(pet);
   }
   board.player.reverse();
   if(issues.length||!board.player.length&&!board.opponent.length){gaps.push({index,...frame,issues:issues.length?issues:['no board visible']});onProgress(`Frame ${index}: retained for review`);continue;}
   if(!initialVerified){
    const expected={player:normalized.config.playerPets,opponent:normalized.config.opponentPets};
    const differences=boardDiff(board,expected);
    initialChecks.push({frame:frame.frame,timeMs:frame.timeMs,differences});
    if(!differences.length)initialVerified=true;
   }
   const tooltip=(frame.text??[]).find(r=>r.y>.12&&r.y<.4&&r.text===r.text.toUpperCase()&&/[A-Z]{3}/.test(r.text));
   const checkpoint={timeMs:frame.timeMs,confidence:1,board,evidence:{frame:frame.frame},
    dying,visualMetrics:{stats:stats.slots,sprites},upcomingAbility:tooltip?.text??null};
   // Heuristic tags describe visible board changes; simultaneous effects remain grouped.
   checkpoint.kinds=checkpoints.length?classifyChanges(checkpoints.at(-1).board,board):[initialVerified?'initial':'first-readable'];
   checkpoints.push(checkpoint);
   onProgress(`Frame ${index}: recognized ${board.player.length+board.opponent.length} pets`);
  }
 }finally{if(!sharedWorker)worker.close();}
 const reference={schemaVersion:1,inputHash:normalized.metadata.inputHash,complete:capture.complete&&gaps.length===0&&initialVerified,
  outcome:capture.outcome??null,captureComplete:capture.complete,coverage:capture.coverage,initialVerified,initialChecks,checkpoints,gaps,
  recognition:'Local SIFT sprite geometry and Lapsus Pro digit masks; confidence is an acceptance flag, not a calibrated probability.',
  unobservedFields:['experience','mana','equipment absence','equipment uses','internal identities'],source:dir};
 await writeFile(`${dir}/observations.json`,JSON.stringify(reference,null,2));
 return reference;
}
export function classifyChanges(before,after) {
 if(!before)return ['initial'];const kinds=new Set();
 for(const side of ['player','opponent']){
  const a=before[side],b=after[side];
  if(a.length>b.length)kinds.add('faint');
  if(a.length<b.length)kinds.add('summon');
  if(a.length===b.length)for(let i=0;i<a.length;i++){
   if(a[i].name!==b[i].name)kinds.add('transformation-or-movement');
   if(a[i].health!==b[i].health)kinds.add('damage-or-health-ability');
   if(a[i].attack!==b[i].attack)kinds.add('stat-ability');
   if(a[i].equipment!==b[i].equipment)kinds.add('equipment-observation-change');
  }
 }
 return [...kinds];
}
