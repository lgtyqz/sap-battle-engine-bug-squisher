#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { normalizeBattle } from './normalize.mjs';
import { diagnose } from './report.mjs';
import { captureBattle } from './browser.mjs';
import { observeCapture } from './observe.mjs';
import { simulate } from './engine.mjs';
import { compareReference } from './search.mjs';
const {values:opts,positionals}=parseArgs({allowPositionals:true,options:{
 out:{type:'string',default:'artifacts/latest'},replay:{type:'string'},capture:{type:'string'},reference:{type:'string'},
 trials:{type:'string',default:'64'},headed:{type:'boolean'},help:{type:'boolean'}}});
const [command,input]=positionals;
const json=async path=>JSON.parse(await readFile(path,'utf8'));
try{
 if(opts.help||!command){console.log(`Usage: node src/cli.mjs <command> <battle.json> [options]

normalize   Save SimulationConfig and provenance
capture     Log in, inject replay, and record browser checkpoints (--replay UUID)
observe     Recognize captured frames (--capture DIRECTORY)
diagnose    Compare engine events (--reference observations.json)
run         Capture, recognize, and diagnose (--replay UUID)
regress     Replay a generated regression.fixture.json and assert observed checkpoints

Options: --out DIRECTORY --trials 64 --headed
Credentials: node --env-file=.env src/cli.mjs run ...`);}
 else if(command==='regress'){
  const fixture=await json(input);if(!fixture.reference)throw new Error('Fixture has no browser observations');
  const run=simulate(fixture.config),result=compareReference(fixture.reference,run);
  console.log(JSON.stringify(result,null,2));
  if(!result.targetMatched)process.exitCode=1;
  else if(!fixture.reference.complete)process.exitCode=2;
 }
 else{
  if(!['normalize','capture','observe','diagnose','run'].includes(command))throw new Error(`Unknown command ${command}`);
  if(!input)throw new Error('A battle JSON path is required');
  const battle=await json(input),normalized=normalizeBattle(battle,{replayId:opts.replay??null});
  const maxTrials=Number(opts.trials);
  if(!Number.isInteger(maxTrials)||maxTrials<1||maxTrials>10000)throw new Error('--trials must be an integer from 1 to 10000');
  await mkdir(opts.out,{recursive:true});
  await writeFile(`${opts.out}/normalized.json`,JSON.stringify(normalized,null,2));
  if(command==='normalize')console.log(`${opts.out}/normalized.json`);
  if(['capture','run'].includes(command)){
   if(!opts.replay)throw new Error('--replay participation UUID is required for browser playback');
   await captureBattle(battle,normalized,opts.out,{headless:!opts.headed,onProgress:console.log});
  }
  let reference=opts.reference?await json(opts.reference):null;
  if(['observe','run'].includes(command)) reference=await observeCapture(normalized,opts.capture??opts.out,{onProgress:console.log});
  if(['diagnose','run'].includes(command)){
   const report=await diagnose(normalized,reference,opts.out,{maxTrials});
   console.log(`${report.status}: ${opts.out}/report.md`);
  }
 }
}catch(error){console.error(error.message);process.exitCode=1;}
