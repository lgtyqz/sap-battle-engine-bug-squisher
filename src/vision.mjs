import sharp from 'sharp';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
export async function pixels(path) {
 const {data,info}=await sharp(path).removeAlpha().raw().toBuffer({resolveWithObject:true});
 return {data,width:info.width,height:info.height};
}
export function components(img, predicate=(r,g,b)=>r>210&&g>210&&b>210) {
 const {data,width:w,height:h}=img, visited=new Uint8Array(w*h), result=[];
 const yes=i=>predicate(data[3*i],data[3*i+1],data[3*i+2]);
 for(let i=0;i<w*h;i++) {
  if(visited[i]||!yes(i)) continue;
  const stack=[i],points=[];visited[i]=1;let left=w,top=h,right=0,bottom=0;
  while(stack.length){
   const j=stack.pop(),x=j%w,y=Math.floor(j/w);points.push(j);left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);
   for(const k of [x>0?j-1:-1,x<w-1?j+1:-1,y>0?j-w:-1,y<h-1?j+w:-1])if(k>=0&&!visited[k]&&yes(k)){visited[k]=1;stack.push(k);}
  }
  if(points.length>5)result.push({left,top,width:right-left+1,height:bottom-top+1,points});
 }
 return result;
}
async function mask(component,imgWidth) {
 const data=Buffer.alloc(component.width*component.height);
 for(const p of component.points)data[(Math.floor(p/imgWidth)-component.top)*component.width+p%imgWidth-component.left]=255;
 return sharp(data,{raw:{width:component.width,height:component.height,channels:1}}).resize(24,32,{fit:'fill'}).raw().toBuffer();
}
export async function loadGlyphs(dir='.scratch/glyphs') {
 return Promise.all([... '0123456789'].map(async digit=>{
  const img=await pixels(`${dir}/${digit}.png`), c=components(img).sort((a,b)=>b.points.length-a.points.length)[0];
  return {digit,mask:await mask(c,img.width),aspect:c.width/c.height};
 }));
}
export async function readStats(path,glyphs) {
 const img=await pixels(path),scale=img.width/1280;
 // Current browser battle layout. Verify against the initial board before using any subsequent frame.
 const all=components(img);
 const digits=all.filter(c=>c.top>485*scale&&c.top<530*scale&&c.height>17*scale&&c.height<38*scale&&c.width<38*scale);
 const recognized=[];
 for(const c of digits){
  const m=await mask(c,img.width);
  const ranked=glyphs.map(g=>({digit:g.digit,error:m.reduce((sum,v,i)=>sum+Math.abs(v-g.mask[i]),0)/(m.length*255)+Math.abs(c.width/c.height-g.aspect)*0.15})).sort((a,b)=>a.error-b.error);
  recognized.push({...c,points:undefined,digit:ranked[0].digit,error:ranked[0].error,margin:ranked[1].error-ranked[0].error});
 }
 const slots=[];
 for(let i=0;i<10;i++){
  const center=(80+i*120+(i>=5?40:0))*scale;
  const read=offset=>{
   const chars=recognized.filter(c=>Math.abs(c.left+c.width/2-center-offset*scale)<26*scale).sort((a,b)=>a.left-b.left);
   if(!chars.length)return null;
   const first=chars[0];
   const negative=all.some(c=>c.height>=2*scale&&c.height<8*scale&&c.width>=6*scale&&c.width<18*scale&&c.left+c.width<first.left&&first.left-c.left-c.width<9*scale&&Math.abs(c.top-first.top-12*scale)<8*scale);
   return {value:(negative?-1:1)*Number(chars.map(c=>c.digit).join('')),error:Math.max(...chars.map(c=>c.error)),margin:Math.min(...chars.map(c=>c.margin))};
  };
  const badges=all.filter(c=>c.top>480*scale&&c.top<510*scale&&c.height>=38*scale&&c.height<65*scale&&c.width>=35*scale&&c.width<75*scale&&Math.abs(c.left+c.width/2-center)<65*scale).length;
  slots.push({attack:read(-30),health:read(30),badges});
 }
 return {slots,digits:recognized};
}
export async function generateGlyphs(page,dir='.scratch/glyphs') {
 const font=(await readFile(new URL('../Lapsus Pro/LapsusPro-Bold.otf',import.meta.url))).toString('base64');
 const glyphs=await page.evaluate(async font=>{
  const f=new FontFace('SAPOCR',`url(data:font/otf;base64,${font})`);document.fonts.add(await f.load());
  return Object.fromEntries([... '0123456789'].map(d=>{
   const c=document.createElement('canvas');c.width=80;c.height=80;const x=c.getContext('2d');x.fillStyle='black';x.fillRect(0,0,80,80);x.font='48px SAPOCR';x.fillStyle='white';x.fillText(d,10,60);return [d,c.toDataURL().split(',')[1]];
  }));
 },font);
 await mkdir(dir,{recursive:true});
 for(const [d,png] of Object.entries(glyphs))await writeFile(`${dir}/${d}.png`,Buffer.from(png,'base64'));
}
