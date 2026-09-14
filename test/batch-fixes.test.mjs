import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir,copyFile,access,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {normalizeBattle} from '../src/normalize.mjs';
import {simulate} from '../src/engine.mjs';
import {observeCapture} from '../src/observe.mjs';
import {loadGlyphs} from '../src/vision.mjs';
import {diagnose} from '../src/report.mjs';

test('Unity omitted pet enum means Ant, and pack 4 supplies an empty custom pack',()=>{
 const board={Pack:4,Tur:2,Mins:{Items:[{Hp:{Perm:3},At:{Perm:2}}]}};
 const n=normalizeBattle({UserBoard:board,OpponentBoard:board});
 assert.equal(n.config.playerPets[4].name,'Ant');assert.equal(n.identities.player[4].enum,0);
 assert.equal(n.config.playerPack,'Custom');assert.deepEqual(n.config.customPacks[0].tier1Pets,[]);
 assert.equal(n.metadata.assumptions.length,2);assert.doesNotThrow(()=>simulate(n.config));
});

test('unreadable initial frame preserves later evidence, reports inconclusive and embeds portable images',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'sap-report-'));
 try{
  await mkdir(join(dir,'frames'));
  for(const name of ['0.png','1.png'])await copyFile('fixtures/vision/initial-stats.png',join(dir,'frames',name));
  const n={metadata:{inputHash:'test',battleId:'test',turn:1},warnings:[],config:{playerPack:'Turtle',opponentPack:'Turtle',turn:1,playerPets:[{name:'Ant',attack:2,health:3}],opponentPets:[{name:'Ant',attack:2,health:3}]}};
  await writeFile(join(dir,'capture.json'),JSON.stringify({inputHash:'test',injectionCount:1,complete:true,frames:[0,1].map(i=>({frame:`frames/${i}.png`,timeMs:i}))}));
  let reads=0;
  const worker={read:async()=>Array.from({length:10},()=>({pets:reads++<10?[]:[{name:'Ant',inliers:10,ratio:1}],perks:[]}))};
  const reference=await observeCapture(n,dir,{worker,glyphs:await loadGlyphs('fixtures/vision/glyphs')});
  assert.equal(reference.initialVerified,false);assert.equal(reference.complete,false);
  assert.equal(reference.gaps.length,1);assert.equal(reference.checkpoints.length,1);
  assert.ok(reference.initialChecks[0].differences.length);
  const out=join(dir,'report with spaces');
  const report=await diagnose(n,reference,out,{maxTrials:1});
  assert.equal(report.status,'inconclusive');
  const md=await readFile(join(out,'report.md'),'utf8');
  const images=[...md.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)];assert.ok(images.length>=2);
  for(const [,path] of images){assert.ok(path.startsWith('evidence/'));await access(resolve(out,decodeURIComponent(path)));}
 }finally{await rm(dir,{recursive:true,force:true});}
});


test('paused replay is recognized when OCR misses the tiny AUTOPLAY label',async()=>{
 const {replayControls}=await import('../src/browser.mjs');
 // Labels read from the actual turn-5 timeout screenshot; AUTOPLAY was absent.
 const rows=['REWIND','PLAY','FAST','SKIP'].map(text=>({text,y:.016,confidence:1}));
 assert.deepEqual(replayControls(rows),{paused:true,visible:true});
 assert.equal(replayControls(rows.map(r=>({...r,text:r.text==='PLAY'?'PAUSE':r.text}))).paused,false);
 assert.deepEqual(replayControls(rows.map(r=>({...r,y:.5}))),{paused:false,visible:false});
});
