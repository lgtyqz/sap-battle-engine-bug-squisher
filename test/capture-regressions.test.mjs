import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {playIconVisible,boardMotion,abilityCardScalePoint} from '../src/browser.mjs';
import {align} from '../src/align.mjs';
import {spriteWorker} from '../src/observe.mjs';

test('visible PLAY triangle survives missing OCR; blank and PAUSE icons are rejected',async()=>{
 assert.equal(await playIconVisible('fixtures/vision/paused-ant.png'),true);
 const blank=await sharp({create:{width:1280,height:720,channels:3,background:'black'}}).png().toBuffer();
 assert.equal(await playIconVisible(blank),false);
 const bar=await sharp({create:{width:7,height:26,channels:3,background:'white'}}).png().toBuffer();
 const pause=await sharp(blank).composite([{input:bar,left:550,top:30},{input:bar,left:565,top:30}]).png().toBuffer();
 assert.equal(await playIconVisible(pause),false);
});
test('settling check distinguishes stationary board from changed stats',async()=>{
 assert.equal(await boardMotion('fixtures/vision/initial-stats.png','fixtures/vision/initial-stats.png'),0);
 assert.ok(await boardMotion('fixtures/vision/initial-stats.png','fixtures/vision/faint-stats.png')>.002);
});
test('Ability Card Scale click maps 35% onto the 0%-200% settings slider',()=>{
 const point=abilityCardScalePoint({x:.216666669,height:.052777778,y:.473611111});
 assert.ok(Math.abs(point.x-.331916669)<1e-9);
 assert.ok(Math.abs(point.y-.529388889)<1e-9);
 assert.throws(()=>abilityCardScalePoint({x:0,y:0,height:0},201),/0% to 200%/);
});
test('closest comparison retains near-matching teams instead of selecting an empty terminal board',()=>{
 const pet={name:'Shark',attack:10,health:10};
 const board={player:[pet,pet],opponent:[pet,pet]};
 const reference={schemaVersion:1,inputHash:'test',complete:true,checkpoints:[{timeMs:0,confidence:1,evidence:{frame:'test.png'},board}]};
 const near={player:board.player.map(p=>({...p,attack:12,health:12})),opponent:board.opponent};
 const result=align(reference,[{sequence:0,board:near},{sequence:1,board:{player:[],opponent:[]}}]);
 assert.equal(result.closest[0].sequence,0);
 assert.equal(result.status,'divergence-candidate');
});
test('sprite geometry excludes adjacent Piranha and template tolerates Elephant Seal mana badge',async()=>{
 const worker=spriteWorker();
 try{
  const leech=(await worker.read('fixtures/vision/leech-neighbor.png',[3]))[3].pets;
  assert.equal(leech[0].name,'Leech');assert.ok(leech[0].error<.18);assert.ok(leech[1].error-leech[0].error>=.12);
  const seal=(await worker.read('fixtures/vision/elephant-seal-mana.png',[9]))[9].pets;
  assert.equal(seal[0].name,'Elephant Seal');assert.ok(seal[0].error<.18);assert.ok(seal[1].error-seal[0].error>=.12);
 }finally{worker.close();}
});

test('static held-food icons are recognized and participate in the sprite cache key',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'sap-static-perk-'));
 const worker=spriteWorker();
 try{
  const background=sharp({create:{width:1280,height:720,channels:4,background:'#733c2dff'}});
  for(const name of ['Mushroom','Melon']){
   const icon=await sharp(`Sprite/Food/${name}.png`).resize(55,55).png().toBuffer();
   await background.clone().composite([{input:icon,left:170,top:320}]).png().toFile(join(dir,`${name}.png`));
  }
  const mushroom=(await worker.read(join(dir,'Mushroom.png'),[1]))[1].perks;
  const melon=(await worker.read(join(dir,'Melon.png'),[1]))[1].perks;
  assert.equal(mushroom[0].name,'Mushroom');assert.ok(mushroom[0].error<.18);
  assert.equal(melon[0].name,'Melon');assert.ok(melon[0].error<.18);
 }finally{worker.close();await rm(dir,{recursive:true,force:true});}
});

test('an intermediate ordering divergence records reconvergence without claiming a match',()=>{
 const board=n=>({player:[{name:'Ant',attack:n,health:3}],opponent:[]});
 const reference={schemaVersion:1,inputHash:'test',complete:true,checkpoints:[1,2,3].map((n,i)=>({timeMs:i,confidence:1,evidence:{frame:`${i}.png`},board:board(n)}))};
 const result=align(reference,[{sequence:0,board:board(1)},{sequence:1,board:board(3)}]);
 assert.equal(result.status,'divergence-candidate');assert.equal(result.checkpoint,1);
 assert.deepEqual(result.rejoin,{checkpoint:2,frame:'2.png',eventSequence:1});
});

test('versus GAME WON result is explicit winner evidence',async()=>{
 const {observedOutcome}=await import('../src/outcome.mjs');
 assert.equal(observedOutcome([{text:'GAME WON!',confidence:1}],'terminal.png').winner,'player');
 assert.equal(observedOutcome([{text:'GAME WON!',confidence:.5}],'terminal.png'),null);
});

test('low-confidence versus result gets a thresholded crop without relaxing confidence',async()=>{
 const {outcomeFromImage}=await import('../src/browser.mjs');
 let calls=0;
 const result=await outcomeFromImage('fixtures/vision/versus-result.png','terminal.png',{ocr:async path=>{
  calls++;
  if(calls===1)return [{text:'GAME WON!',confidence:.5}];
  const info=await sharp(path).metadata();assert.equal(info.width,1080);assert.equal(info.height,580);
  // Recorded macOS Vision output for the thresholded saved result image.
  return [{text:'GAME WON!',confidence:1}];
 }});
 assert.equal(calls,2);assert.equal(result.winner,'player');assert.equal(result.preprocessing,'thresholded-result-crop');
 assert.equal(await outcomeFromImage('fixtures/vision/versus-result.png','terminal.png',{ocr:async()=>[{text:'GAME WON!',confidence:.5}]}),null);
});
