const sides = ['player','opponent'];
export const livingPets = pets => pets.filter(p=>p && (p.health===undefined || p.health>0));
export const observablePet = p => p == null ? null : ({name:p.name,attack:p.attack,health:p.health,exp:p.exp,mana:p.mana,equipment:p.equipment});
export const observableBoard = board => Object.fromEntries(sides.map(s=>[s,board[s].filter(Boolean).map(observablePet)]));
const fields = ['name','attack','health','exp','level','mana','equipment'];
export function boardDiff(observed, expected) {
  const diffs = [];
  for (const side of sides) {
    const actual = livingPets(observed[side]), wanted = livingPets(expected[side]);
    if(actual.length !== wanted.length) diffs.push({path:`${side}.length`,observed:actual.length,engine:wanted.length});
    for(let i=0;i<Math.min(actual.length,wanted.length);i++) for(const field of fields) {
      if(actual[i][field] === undefined) continue;
      const expectedValue = field==='level' ? wanted[i].exp>=5?3:wanted[i].exp>=2?2:1 : wanted[i][field];
      if(actual[i][field] !== expectedValue) diffs.push({path:`${side}[${i}].${field}`,observed:actual[i][field],engine:expectedValue});
    }
  }
  return diffs;
}
// A missing pet is not merely one differing field. Otherwise an empty terminal
// board beats a nearly matching full board and looks like a team deletion.
export function differenceCost(differences) {
 return differences.reduce((sum,d)=>sum+(d.path.endsWith('.length')?7*Math.abs(d.observed-d.engine):d.path.endsWith('.name')?3:1),0);
}
export function validateObservations(reference) {
  if(reference.schemaVersion !== 1 || !Array.isArray(reference.checkpoints) || !reference.checkpoints.length) throw new Error('Reference must contain schemaVersion:1 and nonempty checkpoints');
  if(!reference.inputHash) throw new Error('Reference must identify inputHash');
  let previous=-1;
  for(const cp of reference.checkpoints) {
    if(!Number.isFinite(cp.timeMs) || cp.timeMs<previous) throw new Error('Checkpoint timestamps must be monotonic');
    previous=cp.timeMs;
    if(!cp.evidence?.frame) throw new Error('Each checkpoint needs an evidence.frame');
    if(!Number.isFinite(cp.confidence) || cp.confidence<0 || cp.confidence>1) throw new Error('Each checkpoint needs confidence in [0,1]');
    for(const side of sides) {
      if(!Array.isArray(cp.board?.[side]) || cp.board[side].length>5) throw new Error(`Invalid ${side} observation`);
      for(const p of cp.board[side].filter(Boolean)) {
        if(typeof p.name!=='string' || !p.name || !Number.isFinite(p.attack) || !Number.isFinite(p.health)) throw new Error('Observed pets need name, attack, health; retain unreadable frames as gaps instead');
      }
    }
  }
}
/** Monotone prefix alignment. Keep all matching positions so duplicate boards do not force a premature choice.
 * Events are emission-time snapshots; do not pretend every message has a post-ability board.
 */
export function align(reference, events, {confidence=0.98}={}) {
  validateObservations(reference);
  let frontier = [-1];
  const matches=[];
  for(let index=0;index<reference.checkpoints.length;index++) {
    const cp=reference.checkpoints[index];
    if(cp.confidence<confidence) return {status:'inconclusive',reason:'low-confidence observation',checkpoint:index,matches};
    const start=Math.min(...frontier)+1;
    // Repeated stable observations may refer to the same engine snapshot.
    const candidates=[];
    for(let i=Math.max(0,start-1);i<events.length;i++) {
      if(cp.phase==='after-start' && !/Phase 3: After Start of Battle/.test(events[i].message)) continue;
      if(cp.engineSequence != null && events[i].sequence!==cp.engineSequence) continue;
      if(!boardDiff(cp.board,events[i].board).length) candidates.push(i);
    }
    if(!candidates.length) {
      const nearby=events.slice(Math.max(0,start-1));
      const ranked=nearby.map((e,j)=>({sequence:e.sequence,index:Math.max(0,start-1)+j,differences:boardDiff(cp.board,e.board)}))
        .sort((a,b)=>differenceCost(a.differences)-differenceCost(b.differences)||a.index-b.index);
      let rejoin=null;
      for(let later=index+1;later<reference.checkpoints.length;later++){
        if(reference.checkpoints[later].confidence<confidence)continue;
        const event=nearby.find(e=>!boardDiff(reference.checkpoints[later].board,e.board).length);
        if(event){rejoin={checkpoint:later,frame:reference.checkpoints[later].evidence.frame,eventSequence:event.sequence};break;}
      }
      return {status:'divergence-candidate',checkpoint:index,lastMatched:matches.at(-1)??null,
        earliestUnmatchedSequence:events[start]?.sequence??null,closest:ranked.slice(0,3),rejoin,matches};
    }
    frontier=candidates;
    matches.push({checkpoint:index,eventSequences:candidates.map(i=>events[i].sequence)});
  }
  return {status:reference.complete?'observed-checkpoints-match':'inconclusive',
    reason:reference.complete?undefined:'capture is incomplete',matches};
}
