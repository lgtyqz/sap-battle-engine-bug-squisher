import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeBattle,digest} from '../src/normalize.mjs';
import {injectionPayload,replacePlaybackBattle} from '../src/inject.mjs';
import {align,boardDiff} from '../src/align.mjs';
import {simulate,sourceCandidates,stabilizeEventSnapshotIdentities,stabilizeEventSnapshotPerks} from '../src/engine.mjs';
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
