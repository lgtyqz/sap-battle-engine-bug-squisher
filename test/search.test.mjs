import test from 'node:test';
import assert from 'node:assert/strict';
import {simulate} from '../src/engine.mjs';
import {searchBranches,compareReference} from '../src/search.mjs';
import {observableBoard} from '../src/align.mjs';
const config={playerPack:'Turtle',opponentPack:'Turtle',turn:11,playerToy:'Pandoras Box',playerToyLevel:1,
 playerPets:Array.from({length:5},()=>({name:'Pig',attack:5,health:7})),
 opponentPets:Array.from({length:5},()=>({name:'Pig',attack:5,health:7})),seed:42};
// Controlled engine oracle tests override mechanics, NOT browser ground truth.
function oracle(){
 const randomDecisionOverrides=Array.from({length:20},(_,index)=>({index,optionId:index%2?'Garlic':'equipment'}));
 const run=simulate({...config,randomDecisionOverrides,strictRandomOverrideValidation:true});
 const event=run.events.filter(e=>e.message.includes('Pandoras Box gave')).at(-1);
 const reference={schemaVersion:1,inputHash:'synthetic-test-only',complete:true,
  outcome:{winner:run.winner,evidence:{frame:'synthetic-terminal.png'}},
  checkpoints:[{timeMs:1,confidence:1,phase:'after-pandoras-box',board:observableBoard(event.board),evidence:{frame:'synthetic-pandora.png'}}]};
 return {run,reference};
}
test('Pandora: twenty conditional choices match in a bounded guided search and replay exactly',()=>{
 const {reference}=oracle();
 const found=searchBranches(config,reference,{maxTrials:32});
 assert.equal(found.alignment.targetMatched,true);
 assert.ok(found.search.attempted>1&&found.search.attempted<=21);
 assert.equal(found.trials[0].alignment.checkpointsMatch,false);
 assert.equal(found.trials.length,found.search.attempted);
 assert.ok(found.run.result.randomDecisions.filter(d=>d.forced).length>=18);
 const replay=simulate({...found.run.config,randomDrawOverrides:found.run.result.randomDraws});
 assert.deepEqual(replay.events,found.run.events);
 assert.equal(compareReference(reference,replay).targetMatched,true);
});
test('matching winner does not excuse a checkpoint mismatch; budget exhaustion is unresolved',()=>{
 const {reference}=oracle(),found=searchBranches(config,reference,{maxTrials:1});
 assert.equal(found.alignment.targetMatched,false);
 assert.equal(found.search.termination,'budget-exhausted');
 assert.equal(found.search.exhaustive,false);
});
test('matching checkpoints cannot hide a different observed winner',()=>{
 const {run,reference}=oracle();reference.outcome.winner=run.winner==='player'?'opponent':'player';
 const result=compareReference(reference,run);
 assert.equal(result.checkpointsMatch,true);assert.equal(result.outcomeMatch,false);assert.equal(result.targetMatched,false);
 reference.outcome.evidence={};assert.throws(()=>compareReference(reference,run),/evidence/);
});

test('browser winner requires explicit confident text and rejects ambiguous results',async()=>{
 const {observedOutcome}=await import('../src/outcome.mjs');
 assert.equal(observedOutcome([{text:'Draw',confidence:.99}],'terminal.png').winner,'draw');
 assert.equal(observedOutcome([{text:'Draw',confidence:.5}],'terminal.png'),null);
 assert.equal(observedOutcome([{text:'Victory',confidence:1},{text:'Defeat',confidence:1}],'terminal.png'),null);
 assert.equal(observedOutcome([{text:'Wins 4',confidence:1}],'terminal.png'),null);
});
