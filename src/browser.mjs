import sharp from 'sharp';
import { observedOutcome } from './outcome.mjs';
import { chromium } from 'playwright';
import { writeFile, mkdir, copyFile } from 'node:fs/promises';
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
export async function controlText(path) {
 const crop=resolve('.scratch/controls.png');
 await sharp(path).extract({left:440,top:0,width:400,height:80}).resize(1200,240).toFile(crop);
 return (await recognizeText(crop)).map(r=>({...r,x:(440+r.x*400)/1280,y:r.y*80/720,width:r.width*400/1280,height:r.height*80/720}));
}
export async function screenText(page,{controlsOnly=false}={}) {
 await mkdir('.scratch',{recursive:true});
 const path=resolve('.scratch/ui.png');
 await (await canvasOf(page)).screenshot({path});
 return controlsOnly?controlText(path):recognizeText(path);
}
export async function waitForText(page,label,{timeout=15000}={}) {
 const until=Date.now()+timeout;
 while(Date.now()<until){
  const rows=await screenText(page),row=rows.find(r=>r.text.toLowerCase()===label.toLowerCase());
  if(row)return row;
  await page.waitForTimeout(300);
 }
 throw new Error(`Browser screen did not show ${label}`);
}
export async function clickText(page,label,options) {
 const row=await waitForText(page,label,options);
 await canvasClick(page,row.x+row.width/2,row.y+row.height/2);
}
export async function returnToMainMenu(page,{timeout=15000}={}) {
 let rows=await screenText(page);
 const has=label=>rows.some(row=>row.text.toLowerCase()===label.toLowerCase());
 if(has('History'))return;
 if(!has('Return to menu')){
  await canvasClick(page,.98,.035);
  await page.waitForTimeout(300);
 }
 await clickText(page,'Return to menu',{timeout});
 const until=Date.now()+timeout;
 while(Date.now()<until){
  rows=await screenText(page);
  if(has('History'))return;
  await page.waitForTimeout(300);
 }
 throw new Error('Browser did not return to the main menu');
}
export async function configureCaptureSettings(page) {
 await returnToMainMenu(page);
 await canvasClick(page,.98,.035);
 await clickText(page,'Settings');
 await clickText(page,'Customize');
 for(let attempt=0;attempt<4;attempt++){
  const rows=await screenText(page),held=rows.find(r=>r.text.toLowerCase()==='held food');
  if(!held)throw new Error('Settings did not show Held Food');
  if(rows.some(r=>r.text.toLowerCase()==='static'&&Math.abs(r.y-held.y)<.04)){
   await canvasClick(page,.022,.032);
   await waitForText(page,'History');
   return {heldFood:'Static'};
  }
  await canvasClick(page,held.x+held.width/2,held.y+held.height/2);
  await page.waitForTimeout(200);
 }
 throw new Error('Could not verify Held Food = Static');
}
export async function openReplay(page,replayId,turn) {
 await returnToMainMenu(page);
 await clickText(page,'History');
 await clickText(page,'Replays');
 // The share field accepts SAP's JSON code, not a bare participation UUID.
 await waitForText(page,'Watch Replay'); // Inspect without replaying the previous share code.
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
   if(submitted){await page.waitForTimeout(500);continue;} // A pending login can leave the form visible for more than six seconds.
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
export function replayControls(rows) {
 const labels=new Set(rows.filter(r=>r.y<.12).map(r=>r.text.trim().toUpperCase()));
 return {paused:labels.has('PLAY')&&['REWIND','AUTOPLAY','SKIP'].some(t=>labels.has(t)),
  visible:['PLAY','PAUSE','REWIND','AUTOPLAY','SKIP','FAST'].some(t=>labels.has(t))};
}
/** Record stable pauses, including pre-ability tooltips, with screenshots as independent evidence. */
export async function captureSteps(page,outDir,{maxSteps=100,onProgress=()=>{}}={}) {
 await mkdir(`${outDir}/frames`,{recursive:true});
 const frames=[],start=Date.now();
 await page.mouse.move(1250,780);
 let complete=false,outcome=null;
 for(let step=0;step<maxSteps;step++){
  // Play is present only when paused. Do not click again while a previous animation is still running.
  const until=Date.now()+15000;
  let rows=[];
  while(Date.now()<until){
   rows=await screenText(page,{controlsOnly:true});
   if(replayControls(rows).paused || !replayControls(rows).visible)break;
   await page.waitForTimeout(200);
  }
  if(!replayControls(rows).paused){
   // Viewer exit is evidence of capture ending, not proof that every internal effect was visible.
   await page.waitForTimeout(1500);
   const terminal='terminal.png';await (await canvasOf(page)).screenshot({path:`${outDir}/${terminal}`});
   outcome=observedOutcome(await recognizeText(`${outDir}/${terminal}`),terminal);
   complete=frames.length>1 && !replayControls(rows).visible;
   if(!complete)throw new Error('Lost the paused battle controls; capture is incomplete');
   break;
  }
  await page.mouse.move(1250,780);
  const frame=`frames/${String(step).padStart(4,'0')}.png`;
  await copyFile(resolve('.scratch/ui.png'),`${outDir}/${frame}`); // Same pixels used for pause detection and tooltip OCR.
  frames.push({frame,timeMs:Date.now()-start,text:[...rows,...await recognizeText(`${outDir}/${frame}`)]});
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
 const ownsSession=!options.session;
 const session=options.session??await launchSAP(options);
 let injection,playback;
 try{
  injection=await installInjection(session.context,battle);
  playback=await installPlaybackInjection(session.context,battle,normalized.metadata);
  if(!session.captureReady){
   await login(session.page);
   session.captureSettings=await configureCaptureSettings(session.page);
   await generateGlyphs(session.page);
   session.captureReady=true;
  }
  await openReplay(session.page,normalized.metadata.replayId,normalized.config.turn);
  const until=Date.now()+120000;let ready=false;
  while(Date.now()<until){
   let rows=await screenText(session.page,{controlsOnly:true});
   if(!replayControls(rows).visible)rows=[...rows,...await recognizeText(resolve('.scratch/ui.png'))];
   if(rows.some(r=>r.text==='Play now!')){await clickText(session.page,'Play now!');continue;}
   if(replayControls(rows).paused){ready=true;break;}
   await session.page.waitForTimeout(500);
  }
  if(!ready)throw new Error(`Playback did not reach a paused battle (injected responses: ${injection.count+playback.count})`);
  if(injection.count+playback.count<1)throw new Error('No battle response was injected');
  const capture=await captureSteps(session.page,outDir,options);
  capture.settings=session.captureSettings;
  capture.inputHash=normalized.metadata.inputHash;capture.buildUrl=session.buildUrl;
  capture.injectionCount=injection.count+playback.count;
  capture.provenance=capture.injectionCount?'battle-response-override':'participation-replay-needs-input-verification';
  await writeFile(`${outDir}/capture.json`,JSON.stringify(capture,null,2));
  if(!ownsSession)await returnToMainMenu(session.page);
  return capture;
 }catch(error){
  await mkdir(outDir,{recursive:true});
  if(session.captureReady){
   await (await canvasOf(session.page)).screenshot({path:`${outDir}/failure.png`}).catch(()=>{});
   await writeFile(`${outDir}/failure.json`,JSON.stringify({error:error.message,injectionCount:(injection?.count??0)+(playback?.count??0)},null,2));
  }
  throw error;
 }finally{
  await Promise.allSettled([injection?.dispose(),playback?.dispose()]);
  if(ownsSession)await session.browser.close();
 }
}
