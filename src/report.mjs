import { checkpointHistory, renderCheckpointHistory } from './checkpoint-report.mjs';
import { resolve } from 'node:path';
import { writeFile, mkdir } from 'node:fs/promises';
import { searchBranches } from './search.mjs';
import { sourceCandidates, simulate } from './engine.mjs';
export async function diagnose(normalized, reference, outDir, {maxTrials=64}={}) {
  if(reference && reference.inputHash !== normalized.metadata.inputHash) throw new Error('Reference inputHash does not match this battle');
  const searched=reference?searchBranches(normalized.config,reference,{maxTrials}):null;
  const run=searched?.run??simulate(normalized.config);
  const alignment=searched?.alignment??{status:'inconclusive',reason:'No browser checkpoints captured yet'};
  const sequence=alignment.closest?.[0]?.sequence ?? alignment.earliestUnmatchedSequence;
  // Include the full ambiguous interval. A pre-mutation ability log can precede
  // the nearest differing snapshot by more than a few emissions.
  const intervalStart=alignment.lastMatched?.eventSequences?.[0] ?? Math.max(0,(sequence??0)-3);
  const context=sequence==null?[]:run.events.filter(e=>e.sequence>=intervalStart&&e.sequence<=sequence+2);
  const checkpoint=reference?.checkpoints[alignment.checkpoint];
  const evidence=checkpoint?{frame:resolve(reference.source??'.',checkpoint.evidence.frame),timeMs:checkpoint.timeMs,board:checkpoint.board}:null;
  const history=checkpointHistory(reference,alignment,run.events);
  const report={schemaVersion:1,checkpointHistory:history,metadata:normalized.metadata,engine:run.revision,status:alignment.status,
    warnings:normalized.warnings,evidence,coverage:reference?{accepted:reference.checkpoints.length,gaps:reference.gaps?.length??0,complete:reference.complete}:null,search:searched?.search??null,alignment,implicated:sourceCandidates(context),eventContext:context,
    outcome:{reported:normalized.metadata.reportedOutcome,observed:reference?.outcome??null,engine:run.winner,matchesObserved:alignment.outcomeMatch??null},
    caveats:['SAP Seed is preserved as metadata and used as an engine trial seed; RNG equivalence is unverified.',
      'BattleEvent boards represent event emission, which may precede the described mutation.',
      'Implicated sources are candidates, not a proven cause.']};
  if(normalized.warnings.length) report.status='inconclusive';
  if(alignment.status==='divergence-candidate') report.caveats.push('Resolve random target/order differences before treating this candidate as an engine bug.');
  const fixture={schemaVersion:1,status:reference?'candidate':'awaiting-browser-observations',
    metadata:normalized.metadata,engine:run.revision,
    config:{...run.config,randomDrawOverrides:run.result.randomDraws},
    reference:reference??null,search:searched?.search??null,observedDivergence:alignment.checkpoint??null};
  await mkdir(outDir,{recursive:true});
  for(const [file,value] of Object.entries({'normalized.json':normalized,'engine.json':run,'random-trials.json':searched?.trials??[],'report.json':report,'regression.fixture.json':fixture})) {
    await writeFile(`${outDir}/${file}`,JSON.stringify(value,null,2)+'\n');
  }
  const diffLines=(alignment.closest?.[0]?.differences??[]).map(d=>`| ${d.path} | ${JSON.stringify(d.observed)} | ${JSON.stringify(d.engine)} |`).join('\n');
  const evidenceText=evidence?`[Browser evidence](<${evidence.frame}>) at ${evidence.timeMs} ms.\n\n| Field | Browser | Closest engine snapshot |\n| --- | --- | --- |\n${diffLines}`:'';
  const sourceLines=report.implicated.map(s=>`- ${s.ability??s.name}: \`${s.file}:${s.line}\` (${s.reason})`).join('\n');
  await writeFile(`${outDir}/report.md`, `# SAP battle diagnosis\n\nStatus: **${report.status}**\n\nBattle: ${normalized.metadata.battleId}; turn ${normalized.metadata.turn}.\n\nReported outcome (input metadata): ${report.outcome.reported}; browser observed winner: ${report.outcome.observed?.winner??'unverified'}; engine trial: ${run.winner}.\n\n${alignment.reason??`First unmatched observed checkpoint: ${alignment.checkpoint ?? 'none'}.`}\n\n${evidenceText}\n\n${renderCheckpointHistory(history,context,reference?.gaps,reference?.source)}\n\n## Implicated sources\n\n${sourceLines}\n\n${searched?`Tried ${searched.search.attempted} choice branches (budget ${maxTrials}); search is not exhaustive.`:''}\n\n${report.coverage?`Accepted ${report.coverage.accepted} checkpoints; retained ${report.coverage.gaps} unreadable frames as gaps.`:''}\n\n${report.caveats.map(s=>'- '+s).join('\n')}\n${normalized.warnings.map(s=>'- '+s).join('\n')}\n`);
  return report;
}
