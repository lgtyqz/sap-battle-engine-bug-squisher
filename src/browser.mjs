import { observedOutcome } from './outcome.mjs';
import { chromium } from 'playwright';
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { recognizeText } from './ocr.mjs';
import { installInjection, installPlaybackInjection } from './inject.mjs';
import { generateGlyphs } from './vision.mjs';
export async function canvasOf(page) {
 for(const frame of page.frames())if(await frame.locator('#unity-canvas').count())return frame.locator('#unity-canvas');
 throw new Error('Unity canvas is not loaded');
}
export async function canvasClick(page,x,y) {
 const box=await (await canvasOf(page)).boundingBox();
 await page.mouse.click(box.x+x*box.width,box.y+y*box.height,{delay:150});
}
export async function screenText(page) {
 await mkdir('.scratch',{recursive:true});
 const path=resolve('.scratch/ui.png');
 await (await canvasOf(page)).screenshot({path});
 return recognizeText(path);
}
export async function clickText(page,label,{timeout=15000}={}) {
 const until=Date.now()+timeout;
 while(Date.now()<until){
  const rows=await screenText(page),row=rows.find(r=>r.text.toLowerCase()===label.toLowerCase());
  if(row){await canvasClick(page,row.x+row.width/2,row.y+row.height/2);return;}
  await page.waitForTimeout(300);
 }
 throw new Error(`Browser screen did not show ${label}`);
}
export async function openReplay(page,replayId,turn) {
 await clickText(page,'History');
 await clickText(page,'Replays');
 // The share field accepts SAP's JSON code, not a bare participation UUID.
 await clickText(page,'Watch Replay'); // establishes that this is the replay screen
 await canvasClick(page,.32,.187);
 await page.keyboard.press('ControlOrMeta+a');
 await page.keyboard.type(JSON.stringify({Pid:replayId,T:turn}),{delay:35});
 await clickText(page,'Watch Replay');
}
export async function login(page) {
 const email=process.env.SAP_EMAIL,password=process.env.SAP_PASSWORD;
 if(!email||!password)throw new Error('Set SAP_EMAIL and SAP_PASSWORD (node --env-file=.env)');
 const until=Date.now()+120000;let submitted=false;
 while(Date.now()<until){
  let rows;
  try{rows=await screenText(page);}catch{await page.waitForTimeout(500);continue;}
  const has=t=>rows.some(r=>r.text.toLowerCase()===t.toLowerCase());
  if(has('Accept')){await clickText(page,'Accept');continue;}
  if(has('History'))return;
  if(has('Log In')){
   if(submitted)throw new Error('SAP login failed or needs an additional verification step');
   submitted=true;
   await canvasClick(page,.47,.318);await page.keyboard.type(email,{delay:65});
   await canvasClick(page,.47,.432);await page.keyboard.type(password,{delay:65});
   await canvasClick(page,.5,.598);
   // Avoid screenshotting the credential entry screen while the login request is pending.
   await page.waitForTimeout(6000);continue;
  }
  if(rows.some(r=>/News announcement/i.test(r.text))){await canvasClick(page,.022,.032);continue;}
  await page.waitForTimeout(500);
 }
 throw new Error('SAP login did not reach the main menu');
}
export async function launchSAP({headless=true}={}) {
 const browser=await chromium.launch({channel:'chrome',headless,args:['--enable-unsafe-swiftshader']});
 const context=await browser.newContext({viewport:{width:1280,height:800},serviceWorkers:'block'});
 const page=await context.newPage();
 try{
  await page.goto('https://teamwood.itch.io/super-auto-pets');
  await page.locator('.load_iframe_btn').click();
  await page.waitForFunction(()=>!!document.querySelector('iframe'));
  for(let i=0;i<100&&!page.frames().some(f=>f.url().includes('itch.zone'));i++)await page.waitForTimeout(100);
  const iframe=page.frames().find(f=>f.url().includes('itch.zone'));
  if(!iframe)throw new Error('Could not discover the current browser build');
  const buildUrl=iframe.url();
  await page.goto(buildUrl);
  return {browser,context,page,buildUrl};
 }catch(error){await browser.close();throw error;}
}
/** Record stable pauses, including pre-ability tooltips, with screenshots as independent evidence. */
export async function captureSteps(page,outDir,{maxSteps=100,onProgress=()=>{}}={}) {
 await mkdir(`${outDir}/frames`,{recursive:true});
 const frames=[],start=Date.now();
 let complete=false,outcome=null;
 for(let step=0;step<maxSteps;step++){
  // Play is present only when paused. Do not click again while a previous animation is still running.
  const until=Date.now()+15000;
  let rows=[];
  while(Date.now()<until){
   rows=await screenText(page);
   if(rows.some(r=>r.text==='PLAY') || !rows.some(r=>/REWIND|AUTOPLAY|PAUSE/.test(r.text)))break;
   await page.waitForTimeout(200);
  }
  if(!rows.some(r=>r.text==='PLAY')){
   // Viewer exit is evidence of capture ending, not proof that every internal effect was visible.
   await page.waitForTimeout(1500);
   const terminal='terminal.png';await (await canvasOf(page)).screenshot({path:`${outDir}/${terminal}`});
   outcome=observedOutcome(await recognizeText(`${outDir}/${terminal}`),terminal);
   complete=frames.length>1 && !rows.some(r=>/REWIND|AUTOPLAY|PAUSE/.test(r.text));
   if(!complete)throw new Error('Lost the paused battle controls; capture is incomplete');
   break;
  }
  await page.mouse.move(1250,780);
  await page.waitForTimeout(300);
  const frame=`frames/${String(step).padStart(4,'0')}.png`;
  await (await canvasOf(page)).screenshot({path:`${outDir}/${frame}`});
  frames.push({frame,timeMs:Date.now()-start,text:rows});
  await writeFile(`${outDir}/capture.json`,JSON.stringify({schemaVersion:1,complete:false,frames},null,2));
  onProgress(`Captured checkpoint ${step}`);
  await canvasClick(page,.439,.06);
  await page.waitForTimeout(600);
 }
 const manifest={schemaVersion:1,complete,outcome,frames,coverage:'viewer-pauses',
  limitation:'A viewer pause can combine simultaneous attacks or multiple mutations; it is not an internal SAP event trace.'};
 await writeFile(`${outDir}/capture.json`,JSON.stringify(manifest,null,2));
 return manifest;
}
export async function captureBattle(battle,normalized,outDir,options={}) {
 const session=await launchSAP(options);
 try{
  const injection=await installInjection(session.context,battle);
  const playback=await installPlaybackInjection(session.context,battle,normalized.metadata);
  await login(session.page);
  await generateGlyphs(session.page);
  await openReplay(session.page,normalized.metadata.replayId,normalized.config.turn);
  const until=Date.now()+120000;let ready=false;
  while(Date.now()<until){
   const rows=await screenText(session.page);
   if(rows.some(r=>r.text==='Play now!')){await clickText(session.page,'Play now!');continue;}
   if(rows.some(r=>r.text==='AUTOPLAY') && rows.some(r=>r.text==='PLAY')){ready=true;break;}
   await session.page.waitForTimeout(500);
  }
  if(!ready)throw new Error('Playback did not reach a paused battle');
  if(injection.count+playback.count<1)throw new Error('No battle response was injected');
  const capture=await captureSteps(session.page,outDir,options);
  capture.inputHash=normalized.metadata.inputHash;capture.buildUrl=session.buildUrl;
  capture.injectionCount=injection.count+playback.count;
  capture.provenance=capture.injectionCount?'battle-response-override':'participation-replay-needs-input-verification';
  await writeFile(`${outDir}/capture.json`,JSON.stringify(capture,null,2));
  return capture;
 }finally{await session.browser.close();}
}
