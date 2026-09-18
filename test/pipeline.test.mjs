import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeBattle,digest} from '../src/normalize.mjs';
import {injectionPayload,replacePlaybackBattle} from '../src/inject.mjs';
import {align,boardDiff} from '../src/align.mjs';
import {simulate,sourceCandidates,stabilizeEventSnapshotIdentities,stabilizeEventSnapshotPerks,restorePlainCopyIdentities,addProvenPostMutationSnapshots} from '../src/engine.mjs';
const pet=(Enu,x,extra={})=>({Enu,Poi:{x},At:{Perm:3},Hp:{Perm:4},Lvl:1,...extra});
const board=items=>({Tur:6,Pack:2,Mins:{Size:{x:5},Items:items},Rel:{Items:[null,null]}});
const battle=(items=[pet(165,4),pet(145,3)])=>({Id:'222fdc55-d090-4b40-bf7c-8079acee685e',Seed:992223094,UserBoard:board(items),OpponentBoard:board([pet(105,4)])});
const p=(health=4)=>({name:'Leech',attack:3,health});
const state=(health=4)=>({player:[p(health)],opponent:[]});
const cp=(health,timeMs=0)=>({timeMs,confidence:1,board:state(health),evidence:{frame:'frame.png'}});
const ref=checkpoints=>({schemaVersion:1,inputHash:'example',complete:true,checkpoints});
const events=values=>values.map((v,sequence)=>({sequence,type:'board',message:'',board:state(v)}));
test('normalization uses coordinates, reverses sides, preserves temp stats, exp and consumed triggers',()=>{
 const raw=battle([pet(165,4,{At:{Perm:3,Temp:2},Lvl:2,Abil:[{TrCo:1,AcCo:9}]}),pet(145,0)]),original=structuredClone(raw);
 const n=normalizeBattle(raw);assert.equal(n.config.playerPets[0].name,'Leech');assert.equal(n.config.playerPets[0].attack,5);
 assert.equal(n.config.playerPets[0].exp,2);assert.equal(n.config.playerPets[0].triggersConsumed,1);assert.equal(n.config.playerPets[4].name,'Pug');assert.deepEqual(raw,original);
});
test('Slime and Eagle Owl power counters become battles fought without an unsupported-memory warning',()=>{
 const raw=battle([
  pet(375,4,{Pow:{SlimeAbility:4}}),
  pet(781,3,{Pow:{EagleOwlAbility:1}}),
 ]);
 const n=normalizeBattle(raw);
 assert.equal(n.config.playerPets[0].battlesFought,4);
 assert.equal(n.config.playerPets[1].battlesFought,1);
 assert.deepEqual(n.warnings,[]);
});
test('ability-disabled shop copies use an ability-less engine pet and retain their visible identity',()=>{
 const raw=battle([pet(803,4,{Abil:[],AbDi:true,At:{Perm:2},Hp:{Perm:2}})]);
 const n=normalizeBattle(raw),configured=n.config.playerPets[0];
 assert.equal(configured.name,'Shima Enaga');assert.equal(configured.benchmark,true);assert.equal(configured.plainCopy,true);
 const run=simulate(n.config);
 assert.equal(run.events[0].board.player[0].name,'Shima Enaga');
 assert.ok(!run.events.some(event=>/Shima Enaga summoned/.test(event.message)));
});
test('omitted Poi is the Unity zero default; rejects duplicate slots and unknown catalogs',()=>{
 const raw=battle([pet(145,0,{Poi:undefined})]);assert.equal(normalizeBattle(raw).config.playerPets[4].name,'Pug');
 assert.throws(()=>normalizeBattle(battle([pet(145,0),pet(165,0)])),/duplicate/);
 assert.throws(()=>normalizeBattle(battle([pet(999999,0)])),/unknown/);
 assert.throws(()=>normalizeBattle(battle([pet(145,1,{Exp:1,Lvl:2})])),/inconsistent/);
});
test('battle injection changes only requested Id and rejects unrelated hosts',()=>{
 const raw=battle();const id='01a097ff-4e4b-76f4-9c92-e167d358184c';
 const replaced=injectionPayload(raw,`https://api.teamwood.games/0.48/api/battle/get/${id}`);
 assert.equal(replaced.Id,id);assert.equal(raw.Id,battle().Id);
 assert.throws(()=>injectionPayload(raw,`https://example.org/0.48/api/battle/get/${id}`));
});
test('embedded playback injection selects one turn, preserves serialization, fails closed on ambiguity',()=>{
 const raw=battle(),playback={Actions:[{Turn:5,Battle:JSON.stringify(raw)},{Turn:6,Battle:JSON.stringify({...raw,Seed:10})}]};
 const {payload}=replacePlaybackBattle(playback,raw,6);
 assert.equal(JSON.parse(payload.Actions[1].Battle).Seed,raw.Seed);assert.equal(JSON.parse(playback.Actions[1].Battle).Seed,10);
 assert.deepEqual(payload.Actions[0],playback.Actions[0]);assert.throws(()=>replacePlaybackBattle(playback,raw,9),/found 0/);
});
test('alignment retains repeated snapshots, skips intermediate engine emissions, finds observed mismatch',()=>{
 assert.equal(align(ref([cp(4),cp(4,1),cp(2,2)]),events([4,3,2])).status,'observed-checkpoints-match');
 const mismatch=align(ref([cp(4),cp(6,1)]),events([4,3,2]));assert.equal(mismatch.checkpoint,1);assert.equal(mismatch.status,'divergence-candidate');
});
test('alignment never substitutes missing or low-confidence evidence for matches',()=>{
 assert.equal(align(ref([{...cp(4),confidence:.5}]),events([4])).status,'inconclusive');
 assert.throws(()=>align(ref([{...cp(4),evidence:{}}]),events([4])),/evidence/);
 assert.throws(()=>align(ref([cp(4,2),cp(3,1)]),events([4,3])),/monotonic/);
 assert.equal(align({...ref([cp(4)]),complete:false},events([4])).status,'inconclusive');
});
test('identity IDs are ignored, explicitly observed perks are compared, unknown perks stay unknown',()=>{
 assert.deepEqual(boardDiff(state(),{player:[{...p(),id:'runtime',equipment:'Weak'}],opponent:[]}),[]);
 assert.equal(boardDiff({player:[{...p(),equipment:null}],opponent:[]},{player:[{...p(),equipment:'Weak'}],opponent:[]}).length,1);
});
test('copied-ability event snapshots retain the owner identity while genuine transformations persist',()=>{
 const pet=(name,id='p1')=>({id,name,attack:1,health:1});
 const event=(sequence,name,message='')=>({sequence,message,board:{player:[pet(name)],opponent:[]},source:pet(name)});
 const raw=[event(0,'Parrot'),event(1,"Parrot's Boar","Parrot's Boar gained stats"),event(2,'Parrot'),event(3,'Butterfly')];
 const stable=stabilizeEventSnapshotIdentities(raw);
 assert.equal(stable[1].board.player[0].name,'Parrot');assert.equal(stable[1].source.name,'Parrot');
 assert.equal(stable[1].message,"Parrot's Boar gained stats");assert.equal(stable[3].board.player[0].name,'Butterfly');
 assert.equal(raw[1].board.player[0].name,"Parrot's Boar");
});
test('plain-copy identity restoration follows engine ids after pets move',()=>{
 const config={playerPets:[{name:'Shima Enaga',plainCopy:true}],opponentPets:[]};
 const events=[{message:'Benchmark Pet attacks Ant.',board:{player:[{id:'copy',name:'Benchmark Pet'}],opponent:[]},source:{id:'copy',name:'Benchmark Pet'}},
  {message:'',board:{player:[{id:'other',name:'Ant'},{id:'copy',name:'Benchmark Pet'}],opponent:[]}}];
 const restored=restorePlainCopyIdentities(events,config);
 assert.equal(restored[0].board.player[0].name,'Shima Enaga');assert.equal(restored[0].source.name,'Shima Enaga');
 assert.equal(restored[0].message,'Shima Enaga (plain copy) attacks Ant.');assert.equal(restored[1].board.player[1].name,'Shima Enaga');
});
test('a proven post-mutation snapshot isolates a logged buff from the following ability',()=>{
 const pet=(id,name,attack,health)=>({id,name,attack,health});
 const first={sequence:14,type:'ability',message:'Ant gave Snail 2 attack and 2 health.',target:pet('snail','Snail',3,9),
  board:{player:[pet('ox','Ox',4,8),pet('snail','Snail',3,9)],opponent:[]}};
 const second={sequence:15,type:'ability',message:'Ox gave Ox +1 attack.',target:pet('ox','Ox',5,8),
  board:{player:[pet('ox','Ox',5,8),pet('snail','Snail',5,11)],opponent:[]}};
 const expanded=addProvenPostMutationSnapshots([first,second]);
 assert.equal(expanded.length,3);assert.equal(expanded[1].sequence,14.5);
 assert.equal(expanded[1].synthetic,'proven-post-mutation');
 assert.deepEqual(expanded[1].board.player.map(p=>[p.attack,p.health]),[[4,8],[5,11]]);
 assert.equal(first.board.player[1].attack,3);
});
test('post-mutation snapshots require the next board to prove the exact logged delta',()=>{
 const target={id:'snail',name:'Snail',attack:7,health:6};
 const first={sequence:10,type:'ability',message:'Ibex removed 4 health from Snail (70%)',target,
  board:{player:[target],opponent:[]}};
 const next={sequence:11,type:'ability',message:'Toad gave Snail Weak.',board:{player:[{...target,health:1}],opponent:[]}};
 assert.equal(addProvenPostMutationSnapshots([first,next]).length,2);
});
test('a unique equipment-stat delta proves a missing target field',()=>{
 const before={sequence:4,type:'equipment',message:'Pheasant (Strawberry) gave Shima Enaga +1 attack and +1 health.',
  board:{player:[],opponent:[{id:'natural',name:'Shima Enaga',attack:6,health:7},{id:'copy',name:'Shima Enaga',attack:2,health:2}]}};
 const after={sequence:5,type:'ability',message:'Shima Enaga summoned a friend',board:{player:[],opponent:[
  {id:'summon',name:'Shima Enaga',attack:2,health:2},{id:'natural',name:'Shima Enaga',attack:6,health:7},{id:'copy',name:'Shima Enaga',attack:3,health:3}]}};
 const expanded=addProvenPostMutationSnapshots([before,after]);
 assert.equal(expanded.length,3);assert.deepEqual(expanded[1].board.opponent.map(p=>[p.id,p.attack,p.health]),[
  ['natural',6,7],['copy',3,3]]);
});
test('explicit perk-giving events expose their stated post-ability equipment',()=>{
 const target={id:'boar',name:'Boar',equipment:null};
 const raw=[{type:'ability',message:'Turtle gave Boar Melon.',target:{...target},board:{player:[{...target}],opponent:[]}}];
 const stable=stabilizeEventSnapshotPerks(raw);
 assert.equal(stable[0].target.equipment,'Melon');assert.equal(stable[0].board.player[0].equipment,'Melon');
 assert.equal(raw[0].target.equipment,null);
});
test('real engine random tape reproduces event snapshots; source map attribution resolves file paths',()=>{
 const n=normalizeBattle(battle()),first=simulate(n.config),replayed=simulate({...n.config,randomDrawOverrides:first.result.randomDraws});
 assert.deepEqual(replayed.events,first.events);assert.equal(digest(replayed.events),digest(first.events));
 assert.strictEqual(first.result.battles[0].logs,first.events);
 assert.ok(sourceCandidates(first.events).some(s=>s.name==='Pug'&&s.file.endsWith('/pug.class.ts')));
});
test('dying sprites are evidence but do not count as living pets in either snapshot',()=>{
 assert.deepEqual(boardDiff({player:[p(-3)],opponent:[]},{player:[],opponent:[]}),[]);
 assert.deepEqual(boardDiff({player:[],opponent:[]},{player:[p(0)],opponent:[]}),[]);
});
