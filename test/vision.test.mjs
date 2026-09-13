import test from 'node:test';
import assert from 'node:assert/strict';
import {loadGlyphs,readStats} from '../src/vision.mjs';
const glyphs=await loadGlyphs('fixtures/vision/glyphs');
test('Lapsus templates read all twenty stats from an actual SAP initial board',async()=>{
 const {slots}=await readStats('fixtures/vision/initial-stats.png',glyphs);
 assert.deepEqual(slots.map(s=>[s.attack?.value,s.health?.value]),[[6,4],[3,9],[3,9],[5,2],[5,8],[3,3],[5,5],[7,9],[4,4],[5,5]]);
 assert.ok(slots.every(s=>s.attack.margin>.035&&s.health.margin>.035));
});
test('a faint marker does not turn negative health into positive health',async()=>{
 const {slots}=await readStats('fixtures/vision/faint-stats.png',glyphs);
 assert.equal(slots[5].health.value,-3);
 assert.equal(slots[4].health.value,6);
});
