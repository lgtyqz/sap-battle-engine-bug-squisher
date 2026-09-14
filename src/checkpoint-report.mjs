import { resolve } from 'node:path';
import { livingPets } from './align.mjs';
const cell=value=>String(value??'unknown').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('|','&#124;').replaceAll('\n',' ');
const petText=p=>!p?'—':`${cell(p.name)} · ${cell(p.attack)}/${cell(p.health)} · perk: ${p.equipment===null?'none':cell(p.equipment)} · XP: ${cell(p.exp)} · mana: ${cell(p.mana)}`;
function boardTable(browser,engine) {
 const rows=[];
 for(const side of ['player','opponent']){
  const a=livingPets(browser[side]),b=livingPets(engine?.[side]??[]);
  for(let i=0;i<Math.max(a.length,b.length,1);i++)rows.push(`| ${side} ${i+1} | ${petText(a[i])} | ${engine?petText(b[i]):'unavailable'} |`);
 }
 return '| Side / living position | Browser | Engine |\n| --- | --- | --- |\n'+rows.join('\n');
}
export function checkpointHistory(reference,alignment,events) {
 if(!reference)return [];
 const end=alignment.checkpoint??reference.checkpoints.length-1;
 return reference.checkpoints.slice(0,end+1).map((cp,index)=>{
  const match=alignment.matches?.find(m=>m.checkpoint===index);
  const sequences=match?.eventSequences??(index===alignment.checkpoint?alignment.closest?.map(c=>c.sequence):[])??[];
  return {index,status:match?'matched':alignment.status==='divergence-candidate'?'unmatched':'inconclusive',
   timeMs:cp.timeMs,frame:resolve(reference.source??'.',cp.evidence.frame),board:cp.board,
   phase:cp.phase??null,kinds:cp.kinds??[],upcomingAbility:cp.upcomingAbility??null,dying:cp.dying??[],
   engineCandidates:sequences.map(sequence=>events.find(e=>e.sequence===sequence)).filter(Boolean)};
 });
}
export function renderCheckpointHistory(history,context,gaps=[],source='.',images=new Map()) {
 if(!history.length)return '';
 const render=cp=>{
  const candidates=cp.engineCandidates;
  let text=`### Checkpoint ${cp.index} — ${cp.status}\n\n${images.has(cp.frame)?`![Browser checkpoint ${cp.index}](${images.get(cp.frame)})`:'Screenshot unavailable'} · ${cp.timeMs} ms · visible changes: ${cell(cp.kinds.join(', ')||'not classified')}.\n\n`;
  if(cp.upcomingAbility)text+=`Upcoming ability tooltip (not necessarily the effect just completed): ${cell(cp.upcomingAbility)}.\n\n`;
  if(!candidates.length)text+=boardTable(cp.board,null)+'\n\n';
  for(const [i,e] of candidates.entries()){
   const content=`Engine event **${e.sequence}** (${cell(e.type)}): ${cell(e.message)}\n\n${boardTable(cp.board,e.board)}\n\n`;
   text+=i===0?content:`<details>\n<summary>Alternative engine candidate ${e.sequence}</summary>\n\n${content}</details>\n\n`;
  }
  if(cp.dying.length)text+=`Dying sprites retained as evidence: ${cell(JSON.stringify(cp.dying))}.\n\n`;
  return text;
 };
 const current=history.at(-1);
 let text='## Checkpoint comparison\n\nCheckpoint numbers are zero-based accepted observations, not screenshot numbers. Positions are living pets from front to back; stats are attack/health. Unknown fields were not observed and do not count as differences. Engine candidates are emission-time snapshots, not guaranteed post-ability states. Multiple candidates preserve alignment ambiguity; the first is shown expanded.\n\n';
 text+='## Current checkpoint\n\n'+render(current);
 text+='## Previous checkpoints\n\n'+(history.length>1?history.slice(0,-1).map(render).join('\n'):'No preceding accepted checkpoints.\n\n');
 if(context.length)text+='## Engine events around the divergence\n\nThe browser column repeats the current checkpoint as a fixed comparison target. These earlier engine events are context, not additional claimed mismatches.\n\n'+context.map(e=>`### Event ${e.sequence}: ${cell(e.message)}\n\n${boardTable(current.board,e.board)}\n\n`).join('');
 const priorGaps=gaps.filter(g=>g.timeMs<=current.timeMs);
 if(priorGaps.length)text+='## Unreadable browser frames before this checkpoint\n\n'+priorGaps.map(g=>`- ${images.has(resolve(source,g.frame))?`![${cell(g.frame)}](${images.get(resolve(source,g.frame))})`:cell(g.frame)} at ${g.timeMs} ms: ${cell(JSON.stringify(g.issues??g.reason??'Recognition gap; inspect observations.json'))}`).join('\n')+'\n';
 return text;
}
