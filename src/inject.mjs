// Independent Playwright implementation of the battle/get response replacement described by
// https://github.com/RuihanCao/SAP-Library-Extension . No extension uploader is installed.
export const battleRoute = /^https:\/\/api\.teamwood\.games\/[^/]+\/api\/battle\/get\/([0-9a-f-]{36})(?:\?.*)?$/i;
export function injectionPayload(battle,url) {
  const match=url.match(battleRoute);
  if(!match) throw new Error('Not a Teamwood battle/get URL');
  return {...structuredClone(battle),Id:match[1]};
}
export async function installInjection(context,battle,onInjected=()=>{}) {
  let count=0;
  const handler=async route=>{
    if(route.request().method()!=='GET') return route.continue();
    const payload=injectionPayload(battle,route.request().url());
    await route.fulfill({status:200,contentType:'application/json; charset=utf-8',body:JSON.stringify(payload)});
    count++;
    await onInjected({requestedBattleId:payload.Id,count,time:new Date().toISOString()});
  };
  await context.route(battleRoute,handler);
  return {get count(){return count;},dispose:()=>context.unroute(battleRoute,handler)};
}

/** Current browser share-code playback embeds battles in serialized Actions[].Battle. */
export function replacePlaybackBattle(playback,battle,turn) {
 const payload=structuredClone(playback);let count=0;
 for(const action of payload.Actions ?? []) {
  if(action.Turn!==turn || !action.Battle)continue;
  const original=typeof action.Battle==='string'?JSON.parse(action.Battle):action.Battle;
  if(!original.UserBoard || !original.OpponentBoard)continue;
  const replacement={...structuredClone(battle),Id:original.Id};
  action.Battle=typeof action.Battle==='string'?JSON.stringify(replacement):replacement;
  count++;
 }
 if(count!==1)throw new Error(`Expected one embedded battle for turn ${turn}, found ${count}`);
 return {payload,count};
}
export async function installPlaybackInjection(context,battle,{replayId,turn},onInjected=()=>{}) {
 let count=0;
 const pattern=/^https:\/\/api\.teamwood\.games\/[^/]+\/api\/playback\/participation(?:\?.*)?$/;
 const handler=async route=>{
  const response=await route.fetch();
  if(!response.ok())return route.fulfill({response});
  const original=await response.json();
  if(original.ParticipationId!==replayId)return route.fulfill({response});
  const replaced=replacePlaybackBattle(original,battle,turn);
  await route.fulfill({response,json:replaced.payload});
  count+=replaced.count;await onInjected({count,kind:'embedded-playback-battle'});
 };
 await context.route(pattern,handler);
 return {get count(){return count;},dispose:()=>context.unroute(pattern,handler)};
}
