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
  const events=stabilizeEventSnapshotPerks(stabilizeEventSnapshotIdentities(battle.logs));
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
