import { simulate } from './engine.mjs';
import { align, differenceCost } from './align.mjs';

// A winner alone does not establish that the same sequence of abilities occurred.
export function compareReference(reference, run) {
 const alignment=align(reference,run.events);
 const target=reference.outcome;
 if(target && (!['player','opponent','draw'].includes(target.winner)||!target.evidence?.frame))
  throw new Error('Observed outcome requires winner player/opponent/draw and evidence.frame');
 const checkpointsMatch=alignment.matches.length===reference.checkpoints.length;
 const outcomeMatch=target?target.winner===run.winner:null;
 return {...alignment,checkpointsMatch,outcomeMatch,
  targetMatched:checkpointsMatch&&outcomeMatch!==false,
  status:outcomeMatch===false&&checkpointsMatch?'divergence-candidate':alignment.status,
  ...(outcomeMatch===false&&checkpointsMatch?{reason:'Observed checkpoints match, but the browser winner differs'}:{})};
}
const override = (d,optionId=d.selectedOptionId) => ({index:d.index,key:d.key,label:d.label,optionId});

/** Bounded search against independent browser evidence. Every trial retains its random tape. */
export function searchBranches(config,reference,{maxTrials=64}={}) {
 if(!Number.isInteger(maxTrials)||maxTrials<1)throw new Error('maxTrials must be a positive integer');
 const hints=[...(reference.randomChoices??[])];
 // Only an explicitly identified immediate post-Pandora frame is safe here:
 // equipment visible later may have been consumed or replaced.
 const pandora=reference.checkpoints.find(cp=>cp.phase==='after-pandoras-box'&&cp.confidence>=.98);
 if(pandora)for(const side of ['player','opponent']){
  if(pandora.board[side].length!==5)continue; // Compact boards cannot identify empty original slots.
  pandora.board[side].forEach((pet,i)=>{
   if(typeof pet?.equipment==='string')hints.push({key:'toy.pandoras-box.item',
    label:`(${side==='player'?'P':'O'}${i+1}) Pandoras Box item`,optionId:pet.equipment,evidence:pandora.evidence});
  });
 }
 for(const h of hints)if(!h.key||!h.label||!h.optionId||!h.evidence?.frame)
  throw new Error('Observed random choices require key, label, optionId and evidence.frame');
 const queue=[{overrides:config.randomDecisionOverrides??[],priority:0}],seen=new Set(),trials=[];
 let best;
 while(queue.length&&trials.length<maxTrials){
  queue.sort((a,b)=>b.priority-a.priority);
  const {overrides}=queue.shift(),signature=JSON.stringify(overrides);
  if(seen.has(signature))continue;seen.add(signature);
  // Draw tapes belong to one trajectory; alternative branches consume different draws.
  const input={...config,randomDecisionOverrides:overrides,strictRandomOverrideValidation:true};
  if(trials.length)delete input.randomDrawOverrides;
  let run;
  try{run=simulate(input);}catch(error){
   // A branch can change an uninstrumented ordering and invalidate a later target.
   // Reject that trial rather than aborting the whole batch or accepting its partial log.
   if(!best||!/random override invalid/i.test(error.message))throw error;
   trials.push({trial:trials.length,overrides,rejected:true,error:error.message});
   continue;
  }
  const alignment=compareReference(reference,run);
  const decisions=run.result.randomDecisions??[];
  const score=alignment.matches.length*1000-differenceCost(alignment.closest?.[0]?.differences??[])+(alignment.outcomeMatch===true?100:0);
  trials.push({trial:trials.length,winner:run.winner,alignment,overrides,
   randomDecisions:decisions,randomDraws:run.result.randomDraws});
  if(!best||score>best.score||alignment.targetMatched)best={run,alignment,score,selectedTrial:trials.length-1};
  if(alignment.targetMatched)break;
  // Fix the earliest observed choice first, preserving actual earlier choices. This
  // discovers conditional option sets instead of assuming all choices exist at once.
  for(let i=0;i<decisions.length;i++){
   const d=decisions[i],h=hints.find(h=>h.key===d.key&&h.label===d.label&&(h.index==null||h.index===d.index));
   if(!h||h.optionId===d.selectedOptionId)continue;
   if(d.options.some(o=>o.id===h.optionId)){
    queue.push({overrides:[...decisions.slice(0,i).map(d=>override(d)),override(d,h.optionId)],priority:1e9+i});
   }else if(d.key==='toy.pandoras-box.item'&&decisions[i-1]?.key==='toy.pandoras-box.pool'){
    // Pandora chooses an equipment/ailment pool before choosing the actual item.
    const pool=decisions[i-1];
    for(const option of pool.options)if(option.id!==pool.selectedOptionId)
     queue.push({overrides:[...decisions.slice(0,i-1).map(d=>override(d)),override(pool,option.id)],priority:1e9+i});
   }
   break;
  }
  // Generic fallback: branch on each captured decision. Drop its suffix because
  // summons, transformations and conditional pools can change subsequent decisions.
  for(let i=0;i<decisions.length;i++)for(const option of decisions[i].options){
   if(option.id===decisions[i].selectedOptionId)continue;
   queue.push({overrides:[...decisions.slice(0,i).map(d=>override(d)),override(decisions[i],option.id)],priority:score-i/1000});
  }
 }
 return {...best,trials,search:{attempted:trials.length,budget:maxTrials,pending:queue.length,
  selectedTrial:best.selectedTrial,targetMatched:best.alignment.targetMatched,
  termination:best.alignment.targetMatched?'observed-target-matched':queue.length?'budget-exhausted':'no-more-captured-choices',
  exhaustive:false,reason:'Only instrumented choices are searched. Budget exhaustion does not prove an engine bug; matching observations does not establish unobserved behavior.'}};
}
