import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const catalog = file => JSON.parse(readFileSync(new URL(`../${file}.json`, import.meta.url)));
export const catalogs = Object.fromEntries(['pets', 'perks', 'toys', 'food'].map(k => [k, catalog(k)]));
const byId = Object.fromEntries(Object.entries(catalogs).map(([k, rows]) => [k, new Map(rows.map(r => [String(r.Id), r]))]));
const packs = {0:'Turtle',1:'Puppy',2:'Star',3:"Weekly",4:'Custom',5:'Golden',6:'Unicorn',7:'Danger'};
// Ability enums (not pet enums), verified against native Abil entries in the
// supplied battle corpus. Keep unsupported/nested memories explicit.
const copiedAbilityPets = {371:'Drop Bear',379:'Brain Cramp'};
const battlesFoughtPowers = {375:'SlimeAbility',781:'EagleOwlAbility'};
export const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const number = (value, fallback, path) => {
  if (value == null) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${path}: expected finite number`);
  return value;
};
function lookup(kind, id, path) {
  const row = byId[kind].get(String(id));
  if (!row) throw new Error(`${path}: unknown ${kind} enum ${id}; update the catalog before diagnosing`);
  return row;
}
/** SAP coordinates are back-to-front; engine arrays are front-to-back. */
export function normalizeBattle(battle, {replayId = null} = {}) {
  if (!battle?.UserBoard?.Mins || !battle?.OpponentBoard?.Mins) throw new Error('Expected a full SAP battle with UserBoard and OpponentBoard');
  const warnings = [],assumptions=[];
  const config = {turn:number(battle.UserBoard.Tur,1,'UserBoard.Tur'),simulationCount:1,logsEnabled:true,maxLoggedBattles:1,
    captureRandomDraws:true,captureRandomDecisions:true,optimizeDeterministicSimulations:false,mana:true,
    seed:number(battle.Seed,0,'Seed')};
  const identities = {};
  for (const [side, board] of [['player',battle.UserBoard],['opponent',battle.OpponentBoard]]) {
    if (!Array.isArray(board.Mins.Items)) throw new Error(`${side}.Mins.Items must be an array`);
    if (board.Mins.Size?.x != null && board.Mins.Size.x !== 5) throw new Error(`${side}: only five-slot starting boards are supported`);
    if (!packs[board.Pack ?? 0]) throw new Error(`${side}: unsupported pack ${board.Pack}; custom decks require explicit mapping`);
    config[`${side}Pack`] = packs[board.Pack ?? 0];
    if(board.Pack===4){
      config.customPacks??=[{name:'Custom',...Object.fromEntries([1,2,3,4,5,6].map(t=>[`tier${t}Pets`,[]])),foods:[],perks:[],spells:[]}];
      assumptions.push(`${side}: pack 4 uses an empty custom deck as requested`);
    }
    if (board.Deck && board.Pack!==4) warnings.push(`${side}: custom deck metadata is not mapped; random summon pools may differ`);
    for (const [key, raw] of Object.entries({GoldSpent:'GoSp',RollAmount:'Rold',SummonedAmount:'MiSu',Level3Sold:'MSFL',TransformationAmount:'TrTT'})) {
      config[`${side}${key}`] = number(board[raw],0,`${side}.${raw}`);
    }
    config[`${side}LostLastBattle`] = board.PrOu === 2;
    const pets = Array(5).fill(null);
    identities[side] = Array(5).fill(null);
    for (const raw of board.Mins.Items) {
      if (raw == null) continue;
      // Unity omits default-valued fields: absent Poi.x means zero, not array index.
      const x = number(raw.Poi?.x,0,`${side}.Poi.x`);
      if (!Number.isInteger(x) || x<0 || x>4 || pets[4-x]) throw new Error(`${side}: duplicate or invalid slot ${x}`);
      const row = lookup('pets',raw.Enu??0,`${side}[${x}]`);
      const level = number(raw.Lvl,1,'Lvl');
      if (![1,2,3].includes(level)) throw new Error(`Invalid level ${level}`);
      const exp = number(raw.Exp,({1:0,2:2,3:5})[level],'Exp');
      if (exp < ({1:0,2:2,3:5})[level] || exp >= ({1:2,2:5,3:Infinity})[level]) throw new Error(`${side}[${x}]: inconsistent Lvl/Exp`);
      const stat = key => number(raw[key]?.Perm,0,key+'.Perm') + number(raw[key]?.Temp,0,key+'.Temp');
      const triggers = [raw.TrCo,...(raw.Abil ?? []).map(a=>a.TrCo)].filter(v=>v!=null).map(v=>number(v,0,'TrCo'));
      pets[4-x] = {name:row.Name,attack:stat('At'),health:stat('Hp'),exp,
        equipment:raw.Perk == null || raw.Perk===0 ? null : lookup('perks',raw.Perk,'Perk').Name,
        mana:number(raw.Mana,0,'Mana'),triggersConsumed:Math.max(0,...triggers)};
      const battlesFoughtKey=battlesFoughtPowers[raw.Enu];
      if(battlesFoughtKey)pets[4-x].battlesFought=number(raw.Pow?.[battlesFoughtKey],0,`Pow.${battlesFoughtKey}`);
      // SAP shop copies can retain a pet's art/name/stats while explicitly
      // disabling its native ability. The engine's internal benchmark pet is
      // the only supported ability-less combatant; engine.mjs restores the
      // original identity in logs so it remains observable as the copied pet.
      if(raw.AbDi===true && Array.isArray(raw.Abil) && raw.Abil.length===0){
        pets[4-x].benchmark=true;
        pets[4-x].plainCopy=true;
      }
      identities[side][4-x] = {enum:raw.Enu??0,name:row.Name,nameId:row.NameId,sapId:raw.Id ?? null,abilities:raw.Abil ?? []};
      const copied=(raw.Abil??[]).filter(a=>a.Nat!==true); // Unity omits false Nat.
      const mapped=row.Name==='Abomination' && copied.length<=level && copied.every(a=>copiedAbilityPets[a.Enu] && !a.TrCo && [1,2,3].includes(a.Lvl??1));
      if(mapped)copied.forEach((a,i)=>{
        pets[4-x][`abominationSwallowedPet${i+1}`]=copiedAbilityPets[a.Enu];
        pets[4-x][`abominationSwallowedPet${i+1}Level`]=a.Lvl??1;
      });
      const unmappedPower=raw.Pow&&(!battlesFoughtKey||Object.keys(raw.Pow).some(key=>key!==battlesFoughtKey));
      if (raw.MiMs || unmappedPower || (copied.length&&!mapped)) warnings.push(`${side}[${4-x}] ${row.Name}: ability memory/copied ability needs explicit mapping`);
    }
    if(board.Pack===4 && pets.some(p=>p?.name==='Harpy Eagle')) warnings.push(`${side}: Harpy Eagle cannot summon from the supplied empty custom deck; browser summon-pool evidence is required`);
    config[`${side}Pets`] = pets;
    const toys = (board.Rel?.Items ?? []).filter(Boolean);
    for (const raw of toys) {
      const toy = lookup('toys',raw.Enu,'Rel');
      const key = `${side}${toy.ToyType===1?'HardToy':'Toy'}`;
      if (config[key]) throw new Error(`${side}: multiple toys of the same type`);
      config[key] = toy.Name;
      config[`${key}Level`] = number(raw.Lvl,1,'toy.Lvl');
    }
  }
  return {schemaVersion:1,config,identities,warnings,metadata:{replayId,battleId:battle.Id ?? null,turn:config.turn,assumptions,
    sapSeed:battle.Seed ?? null,reportedOutcome:({1:'player',2:'opponent',3:'draw'})[battle.Outcome] ?? null,
    inputHash:digest(battle),rngCompatibility:'unverified'}};
}
