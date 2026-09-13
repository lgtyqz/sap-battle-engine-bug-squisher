import { readFileSync } from 'node:fs';
import { runSimulation, UPSTREAM_REVISION } from 'sap-battle-engine';
const root = new URL('../node_modules/sap-battle-engine/',import.meta.url);
export function engineRevision() {
  const lock = JSON.parse(readFileSync(new URL('../package-lock.json',import.meta.url)));
  return {package:JSON.parse(readFileSync(new URL('package.json',root))).version,
    resolved:lock.packages['node_modules/sap-battle-engine'].resolved,upstream:UPSTREAM_REVISION};
}
export function simulate(config) {
  const input = {...config,simulationCount:1,logsEnabled:true,maxLoggedBattles:1,captureRandomDraws:true,captureRandomDecisions:true,optimizeDeterministicSimulations:false};
  const result = runSimulation(input);
  if (result.randomOverrideError) throw new Error(result.randomOverrideError);
  const battle = result.battles?.[0];
  if (!battle?.logs?.length) throw new Error('Engine returned no structured BattleEvents');
  return {config:input,result,events:battle.logs,winner:battle.winner,revision:engineRevision()};
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
