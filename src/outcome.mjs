/** Only explicit result text counts; an empty board during fade-out proves nothing. */
export function observedOutcome(rows,frame) {
 const labels=new Map([['VICTORY','player'],['YOU WIN','player'],['GAME WON!','player'],['GAME WON','player'],['DEFEAT','opponent'],['YOU LOSE','opponent'],['DRAW','draw']]);
 const matches=rows.filter(r=>r.confidence>=.98&&labels.has(r.text.trim().toUpperCase()));
 const winners=new Set(matches.map(r=>labels.get(r.text.trim().toUpperCase())));
 return winners.size===1?{winner:[...winners][0],evidence:{frame},method:'explicit-result-text',text:matches.map(r=>r.text)}:null;
}
