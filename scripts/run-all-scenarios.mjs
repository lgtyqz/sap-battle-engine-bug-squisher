#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { launchSAP } from '../src/browser.mjs';
import { runPipeline } from '../src/pipeline.mjs';

const scenariosDir = resolve('bug-scenarios');
const outputRoot = resolve('artifacts/bug-scenarios');
const uuidPattern = /[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/i;
const {values: options} = parseArgs({options:{
  trials:{type:'string',default:'64'},
  headed:{type:'boolean',default:false},
}});
const maxTrials=Number(options.trials);
if(!Number.isInteger(maxTrials)||maxTrials<1||maxTrials>10000)throw new Error('--trials must be an integer from 1 to 10000');

const entries = await readdir(scenariosDir, {withFileTypes: true});
const scenarios = entries
  .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
  .map(entry => entry.name)
  .sort((a, b) => a.localeCompare(b));

if (scenarios.length === 0) {
  console.log(`No JSON scenarios found in ${scenariosDir}`);
  process.exit(0);
}

const failures = scenarios.filter(filename=>!filename.match(uuidPattern));
const runnable = scenarios.filter(filename=>filename.match(uuidPattern));
for(const filename of failures)console.error(`Skipping ${filename}: its filename does not contain a replay UUID`);

if(runnable.length===0){
 console.error('No scenarios with replay UUIDs were found');
 process.exitCode=1;
}else{
 const session=await launchSAP({headless:!options.headed});
 try{
  for (const [index, filename] of runnable.entries()) {
   const replayId = filename.match(uuidPattern)?.[0];
   const scenarioName = filename.slice(0, -'.json'.length);
   const inputPath = join(scenariosDir, filename);
   const outputPath = join(outputRoot, scenarioName);
   console.log(`\n[${index + 1}/${runnable.length}] ${filename}`);
   console.log(`Output: ${outputPath}`);

   try{
    const battle=JSON.parse(await readFile(inputPath,'utf8'));
    const {report}=await runPipeline(battle,{replayId,outDir:outputPath,maxTrials,session,onProgress:console.log});
    console.log(`${report.status}: ${join(outputPath,'report.md')}`);
   }catch(error){
    console.error(`${filename} failed: ${error.message}`);
    failures.push(filename);
   }
  }
 }finally{session.spriteWorker?.close();await session.browser.close();}
}

if (failures.length > 0) {
  console.error(`\n${failures.length} of ${scenarios.length} scenarios failed or were skipped:`);
  for (const filename of failures) console.error(`- ${filename}`);
  process.exitCode = 1;
} else {
  console.log(`\nCompleted ${runnable.length} scenarios. Outputs: ${outputRoot}`);
}
