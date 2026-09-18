import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,copyFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {checkpointHistory,renderCheckpointHistory} from '../src/checkpoint-report.mjs';
import {captureSteps} from '../src/browser.mjs';
import {diagnose} from '../src/report.mjs';

const board=n=>({player:[{name:'Ant',attack:n,health:3,exp:0,mana:0,equipment:null}],opponent:[]});
test('browser history retains later observations and gaps without claiming new divergences',()=>{
 const reference={checkpoints:[1,2,3,4].map((n,i)=>({timeMs:i,board:board(n),evidence:{frame:`${i}.png`}}))};
 const alignment={status:'divergence-candidate',checkpoint:1,matches:[{checkpoint:0,eventSequences:[0]}],rejoin:{checkpoint:2,eventSequence:1}};
 const history=checkpointHistory(reference,alignment,[{sequence:0,board:board(1)}]);
 assert.deepEqual(history.map(c=>c.status),['matched','unmatched','rejoined','not-aligned']);
 const md=renderCheckpointHistory(history,[],[{timeMs:10,frame:'late.png',reason:'late gap'}]);
 assert.match(md,/Checkpoint 3/);assert.match(md,/late gap/);
 assert.match(renderCheckpointHistory([],[],[{timeMs:1,frame:'gap.png'}]),/gap.png/);
});

test('final screenshot failure retains checkpoints and writes an incomplete manifest',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'sap-partial-'));
 let screens=0;
 const canvas={count:async()=>1,boundingBox:async()=>({x:0,y:0,width:1280,height:720}),screenshot:async()=>{throw new Error('final screenshot failed');}};
 const page={frames:()=>[{locator:()=>canvas}],mouse:{move:async()=>{},click:async()=>{}},waitForTimeout:async()=>{}};
 try{
  const result=await captureSteps(page,dir,{io:{
   screenText:async()=>{await copyFile('fixtures/vision/initial-stats.png','.scratch/ui.png');return screens++<2?['PLAY','SKIP'].map(text=>({text,y:0})):[];},
   recognizeText:async()=>[],outcomeFromImage:async()=>({winner:'player'})
  }});
  assert.equal(result.frames.length,1);assert.equal(result.complete,false);assert.equal(result.outcome,null);
  assert.match(result.errors[0].message,/final screenshot failed/);
  assert.deepEqual(JSON.parse(await readFile(join(dir,'capture.json'),'utf8')),result);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('diagnosis includes every engine event and portable image without browser checkpoints',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'sap-full-report-'));
 try{
  const n={metadata:{inputHash:'test'},warnings:[],config:{playerPets:board(2).player,opponentPets:board(2).player}};
  await diagnose(n,{inputHash:'test',checkpoints:[],complete:false,captureComplete:false,captureErrors:[{stage:'checkpoint-capture',message:'final screenshot failed'}]},dir,{maxTrials:1});
  const md=await readFile(join(dir,'report.md'),'utf8'),run=JSON.parse(await readFile(join(dir,'engine.json'),'utf8'));
  assert.equal([...md.matchAll(/### Engine checkpoint /g)].length,run.events.length);
  assert.match(md,/final screenshot failed/);
  for(const [,path] of md.matchAll(/!\[Engine checkpoint [^\]]*\]\(([^)]+)\)/g))assert.ok((await readFile(join(dir,path))).length>100);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('capture still fails when no checkpoint was saved',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'sap-no-frames-'));
 try{
  const page={mouse:{move:async()=>{}}};
  await assert.rejects(captureSteps(page,dir,{io:{screenText:async()=>{throw new Error('browser closed');}}}),/browser closed/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
