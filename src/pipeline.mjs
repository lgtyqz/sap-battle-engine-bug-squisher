import { mkdir, writeFile } from 'node:fs/promises';
import { normalizeBattle } from './normalize.mjs';
import { captureBattle } from './browser.mjs';
import { loadGlyphs } from './vision.mjs';
import { performance } from 'node:perf_hooks';
import { observeCapture, spriteWorker } from './observe.mjs';
import { diagnose } from './report.mjs';

export async function runPipeline(battle,{replayId,outDir,maxTrials=64,headless=true,session,onProgress=()=>{}}) {
 if(!replayId)throw new Error('A replay participation UUID is required for browser playback');
 const started=performance.now(),timings={};
 const normalized=normalizeBattle(battle,{replayId});
 await mkdir(outDir,{recursive:true});
 await writeFile(`${outDir}/normalized.json`,JSON.stringify(normalized,null,2));
 if(session)session.spriteWorker??=spriteWorker(); // Build the asset index while SAP loads and captures.
 await captureBattle(battle,normalized,outDir,{headless,session,onProgress});
 timings.captureMs=performance.now()-started;
 if(session){session.spriteWorker??=spriteWorker();session.glyphs??=await loadGlyphs();}
 const observeStart=performance.now();
 const reference=await observeCapture(normalized,outDir,{onProgress,worker:session?.spriteWorker,glyphs:session?.glyphs});
 timings.observeMs=performance.now()-observeStart;
 const diagnoseStart=performance.now();
 const report=await diagnose(normalized,reference,outDir,{maxTrials});
 timings.diagnoseMs=performance.now()-diagnoseStart;
 timings.totalMs=performance.now()-started;
 await writeFile(`${outDir}/timings.json`,JSON.stringify(timings,null,2));
 onProgress(`Timing: capture ${(timings.captureMs/1000).toFixed(1)}s, recognition ${(timings.observeMs/1000).toFixed(1)}s, diagnosis ${(timings.diagnoseMs/1000).toFixed(1)}s`);
 return {normalized,reference,report};
}
