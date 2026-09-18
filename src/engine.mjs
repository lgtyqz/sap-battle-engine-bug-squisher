import { readFileSync } from 'node:fs';
import { runSimulation, UPSTREAM_REVISION } from 'sap-battle-engine';
const root = new URL('../node_modules/sap-battle-engine/',import.meta.url);
const perkNames=JSON.parse(readFileSync(new URL('../perks.json',import.meta.url))).map(p=>p.Name).sort((a,b)=>b.length-a.length);
export function engineRevision() {
  const lock = JSON.parse(readFileSync(new URL('../package-lock.json',import.meta.url)));
  return {package:JSON.parse(readFileSync(new URL('package.json',root))).version,
    resolved:lock.packages['node_modules/sap-battle-engine'].resolved,upstream:UPSTREAM_REVISION};
}
export function stabilizeEventSnapshotIdentities(events) {
  const stableNames=new Map();
  return structuredClone(events).map(event=>{
    const eventNames=new Map();
    const stabilize=pet=>{
      if(!pet?.id||typeof pet.name!=='string')return;
      const previous=stableNames.get(pet.id);
      // The engine temporarily calls copied-ability owners names such as
      // "Parrot's Boar". That is useful in the message, but it is not a pet
      // transformation and must not leak into identity-bearing snapshots.
      if(previous&&pet.name.startsWith(`${previous}'s `))pet.name=previous;
      else stableNames.set(pet.id,pet.name);
      eventNames.set(pet.id,pet.name);
    };
    for(const side of ['player','opponent'])for(const pet of event.board?.[side]??[])stabilize(pet);
    for(const key of ['source','target']){
      const pet=event[key];
      if(!pet?.id)continue;
      if(eventNames.has(pet.id))pet.name=eventNames.get(pet.id);
      else stabilize(pet);
    }
    return event;
  });
}
export function restorePlainCopyIdentities(events,config) {
  const aliases=new Map(),first=events.find(event=>event.board);
  if(!first)return structuredClone(events);
  for(const side of ['player','opponent']){
    const configured=(config[`${side}Pets`]??[]).filter(Boolean);
    const snapshot=(first.board[side]??[]).filter(Boolean);
    for(let i=0;i<Math.min(configured.length,snapshot.length);i++){
      if(configured[i].plainCopy&&snapshot[i]?.id)aliases.set(snapshot[i].id,configured[i].name);
    }
  }
  return structuredClone(events).map(event=>{
    const rename=pet=>{const name=pet?.id&&aliases.get(pet.id);if(name)pet.name=name;};
    for(const side of ['player','opponent'])for(const pet of event.board?.[side]??[])rename(pet);
    for(const key of ['source','target'])rename(event[key]);
    const names=[...new Set(aliases.values())],label=names.length===1?`${names[0]} (plain copy)`:'plain copy';
    if(aliases.size&&typeof event.message==='string')event.message=event.message.replaceAll('Benchmark Pet',label);
    return event;
  });
}
const findSnapshotPet=(board,id)=>{
  for(const side of ['player','opponent']){
    const index=board?.[side]?.findIndex(p=>p?.id===id)??-1;
    if(index>=0)return {side,index,pet:board[side][index]};
  }
  return null;
};
/**
 * Some engine abilities log immediately before changing their target. If the
 * next event proves the exact delta named by that log, retain the otherwise
 * missing intermediate board without borrowing any unrelated next-event
 * changes. This is intentionally narrower than treating every next board as
 * the previous event's post-state.
 */
export function addProvenPostMutationSnapshots(events) {
  const expanded=[];
  for(let i=0;i<events.length;i++){
    const event=structuredClone(events[i]);
    expanded.push(event);
    if(!['ability','equipment'].includes(event.type)||!events[i+1]?.board)continue;
    const match=event.message.match(/\bgave .+? \+?(\d+) attack and \+?(\d+) health\b/i);
    if(!match)continue;
    const ids=event.target?.id?[event.target.id]:['player','opponent'].flatMap(side=>(event.board?.[side]??[]).filter(Boolean).map(p=>p.id));
    const proven=ids.map(id=>[findSnapshotPet(event.board,id),findSnapshotPet(events[i+1].board,id)])
      .filter(([current,next])=>current&&next&&next.pet.attack===current.pet.attack+Number(match[1])&&next.pet.health===current.pet.health+Number(match[2]));
    // Equipment effects do not always populate targetPet. In that case an
    // exact, unique board delta still independently identifies the target.
    if(proven.length!==1)continue;
    const [current,next]=proven[0],attack=next.pet.attack,health=next.pet.health;
    const post=structuredClone(event),pet=post.board[current.side][current.index];
    pet.attack=attack;pet.health=health;
    if(post.target?.id===pet.id){post.target.attack=attack;post.target.health=health;}
    post.sequence=Number.isFinite(event.sequence)?event.sequence+.5:event.sequence;
    post.synthetic='proven-post-mutation';
    expanded.push(post);
  }
  return expanded;
}
export function stabilizeEventSnapshotPerks(events) {
  return structuredClone(events).map(event=>{
    if(event.type!=='ability'||!event.target?.id)return event;
    const perk=perkNames.find(name=>event.message.endsWith(` ${name}.`)||event.message.endsWith(` ${name} perk.`));
    if(!perk)return event;
    for(const side of ['player','opponent']){
      const target=event.board?.[side]?.find(p=>p?.id===event.target.id);
      if(target)target.equipment=perk;
    }
    event.target.equipment=perk;
    return event;
  });
}
export function simulate(config) {
  const input = {...config,simulationCount:1,logsEnabled:true,maxLoggedBattles:1,captureRandomDraws:true,captureRandomDecisions:true,optimizeDeterministicSimulations:false};
  const result = runSimulation(input);
  if (result.randomOverrideError) throw new Error(result.randomOverrideError);
  const battle = result.battles?.[0];
  if (!battle?.logs?.length) throw new Error('Engine returned no structured BattleEvents');
  const events=stabilizeEventSnapshotPerks(stabilizeEventSnapshotIdentities(
    restorePlainCopyIdentities(addProvenPostMutationSnapshots(battle.logs),input)));
  battle.logs=events;
  return {config:input,result,events,winner:battle.winner,revision:engineRevision()};
}
export function sourceCandidates(events) {
  const map = JSON.parse(readFileSync(new URL('dist/index.js.map',root)));
  const names = new Set(events.flatMap(e=>[e.source?.name,e.target?.name]).filter(Boolean));
  const messages = events.map(e=>e.message).join('\n');
  const found = [];
  for (let i=0;i<map.sources.length;i++) {
    const path = map.sources[i].replace(/^\.\.\//,'');
    if (!/catalog\/(pets|equipment|toys)\//.test(path)) continue;
    const content = map.sourcesContent[i];
    const match = content.match(/\bname\s*=\s*['"]([^'"]+)/);
    if (!match || (!names.has(match[1]) && !messages.includes(match[1]))) continue;
    const ability=content.match(/export class (\w+Ability)\b/);
    const implementation=content.indexOf('private executeAbility(');
    found.push({name:match[1],ability:ability?.[1]??null,file:path,
      line:content.slice(0,implementation>=0?implementation:match.index).split('\n').length,
      reason:names.has(match[1])?'event source/target':'mentioned in event message'});
  }
  return found;
}
