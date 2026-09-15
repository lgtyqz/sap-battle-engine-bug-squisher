"""Local SIFT matching against supplied assets; stdin JSON-lines -> stdout JSON-lines."""
import cv2, numpy as np, json, sys
from functools import lru_cache
from collections import OrderedDict
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
cv2.setNumThreads(1)
sift=cv2.SIFT_create(nfeatures=300,contrastThreshold=.02,edgeThreshold=15)
matcher=cv2.BFMatcher()
import hashlib
cache=ROOT/'.scratch'/'sift-index.npz'
signature=hashlib.sha256((Path(__file__).read_text()+cv2.__version__+(ROOT/'pets.json').read_text()+(ROOT/'perks.json').read_text()+str([(str(p),p.stat().st_size,p.stat().st_mtime_ns) for p in sorted((ROOT/'Sprite').rglob('*.png'))])).encode()).hexdigest()
index=[]
if cache.exists():
    with np.load(cache,allow_pickle=False) as saved:
        if str(saved['signature'])==signature:
            points=saved['points'];descriptors=saved['descriptors']
            for kind,name,flip,start,end in saved['rows']:
                index.append((kind,name,flip=='True',points[int(start):int(end)],descriptors[int(start):int(end)]))
if not index:
    index=[]
    rows=[(kind,row) for kind in ['pets','perks'] for row in json.loads((ROOT/(kind+'.json')).read_text())]
    for kind,row in rows:
        path=ROOT/'Sprite'/('Pets' if kind=='pets' else 'Food')/(row['NameId']+'.png')
        raw=cv2.imread(str(path),cv2.IMREAD_UNCHANGED) if path.exists() else None
        if raw is None: continue
        # Match both directions; index descriptors are independent of battle input/engine output.
        for flip in [False,True]:
            art=cv2.flip(raw,1) if flip else raw
            gray=cv2.cvtColor(art[:,:,:3],cv2.COLOR_BGR2GRAY)
            kp,desc=sift.detectAndCompute(gray,art[:,:,3] if art.shape[2]==4 else None)
            if desc is not None:index.append((kind,row['Name'],flip,np.float32([p.pt for p in kp]),desc))
    meta=[];points=[];descriptors=[];offset=0
    for kind,name,flip,kp,desc in index:
        meta.append([kind,name,str(flip),str(offset),str(offset+len(desc))]);offset+=len(desc);points.append(kp);descriptors.append(desc)
    cache.parent.mkdir(exist_ok=True)
    np.savez_compressed(cache,signature=signature,rows=np.array(meta),points=np.vstack(points),descriptors=np.vstack(descriptors))

# Global nearest-neighbor lookup shortlists assets before expensive geometric verification.
banks={}
for flip in [False,True]:
    for kind in ['pets','perks']:
        entries=[entry for entry in index if entry[0]==kind and entry[2]==flip]
        flann=cv2.FlannBasedMatcher(dict(algorithm=1,trees=4),dict(checks=64))
        flann.add([entry[4] for entry in entries]);flann.train()
        banks[(flip,kind)]=(entries,flann)

seen_names=set()
crop_cache=OrderedDict()
perk_paths={r['Name']:str(ROOT/'Sprite'/'Food'/(r['NameId']+'.png')) for r in json.loads((ROOT/'perks.json').read_text()) if (ROOT/'Sprite'/'Food'/(r['NameId']+'.png')).exists()}
perk_rows=json.loads((ROOT/'perks.json').read_text())
pet_rows=json.loads((ROOT/'pets.json').read_text())
@lru_cache(maxsize=1024)
def load_art(path):
    return cv2.imread(path,cv2.IMREAD_UNCHANGED)


# Template masks omit hats at the top and the lower central mana badge.
# Keep the same excluded proportions in coarse and full-resolution scans.
@lru_cache(maxsize=2048)
def coarse_art(path,flip):
    raw=load_art(path)
    if flip:raw=cv2.flip(raw,1)
    art=cv2.resize(raw,(60,60))
    mask=(art[:,:,3]>220).astype(np.uint8)*255;mask[:18]=0;mask[42:,22:42]=0
    return art[:,:,:3],mask

def template_fallback(crop,slot,hints):
    # Cheap half-resolution scan shortlists assets before five-scale/rotation matching.
    small=cv2.resize(crop,None,fx=.5,fy=.5)
    coarse=[]
    for row in pet_rows:
        path=ROOT/'Sprite'/'Pets'/(row['NameId']+'.png')
        if not path.exists():continue
        art,mask=coarse_art(str(path),slot<5)
        score=float(np.nanmin(cv2.matchTemplate(small,art,cv2.TM_SQDIFF_NORMED,mask=mask)))
        coarse.append((score,row))
    coarse.sort(key=lambda item:item[0])
    names=set(hints)|seen_names|{row['Name'] for _,row in coarse[:24]}
    candidates=[]
    for row in pet_rows:
        if row['Name'] not in names:continue
        path=ROOT/'Sprite'/'Pets'/(row['NameId']+'.png')
        if not path.exists():continue
        raw=load_art(str(path))
        if slot<5:raw=cv2.flip(raw,1)
        best=10.0
        for size in [112,116,120,124,128]:
            art=cv2.resize(raw,(size,size));mask=(art[:,:,3]>220).astype(np.uint8)*255;mask[:int(size*.3)]=0;mask[int(size*.7):,int(size*.36):int(size*.7)]=0
            if art.shape[0]>crop.shape[0] or art.shape[1]>crop.shape[1]:continue
            scores=cv2.matchTemplate(crop,art[:,:,:3],cv2.TM_SQDIFF_NORMED,mask=mask)
            best=min(best,float(np.nanmin(scores)))
        candidates.append({'name':row['Name'],'method':'template','error':best})
    candidates.sort(key=lambda c:c['error'])
    if candidates[0]['error']>.13:
        names=seen_names|set(hints+[c['name'] for c in candidates[:5]])
        rows={r['Name']:r for r in pet_rows}
        for candidate in candidates:
            if candidate['name'] not in names:continue
            raw=load_art(str(ROOT/'Sprite'/'Pets'/(rows[candidate['name']]['NameId']+'.png')))
            if slot<5:raw=cv2.flip(raw,1)
            for angle in [-20,-15,-10,10,15,20]:
                rotated=cv2.warpAffine(raw,cv2.getRotationMatrix2D((128,128),angle,1),(256,256))
                for size in [112,116,120,124,128]:
                    art=cv2.resize(rotated,(size,size));mask=(art[:,:,3]>220).astype(np.uint8)*255;mask[:int(size*.3)]=0;mask[int(size*.7):,int(size*.36):int(size*.7)]=0
                    scores=cv2.matchTemplate(crop,art[:,:,:3],cv2.TM_SQDIFF_NORMED,mask=mask)
                    candidate['error']=min(candidate['error'],float(np.nanmin(scores)))
    return sorted(candidates,key=lambda c:c['error'])[:3]

def perk_color_error(name,flip,matrix,crop):
    art=load_art(perk_paths[name])
    if flip:art=cv2.flip(art,1)
    hsv=cv2.cvtColor(art[:,:,:3],cv2.COLOR_BGR2HSV)
    y,x=np.where((art[:,:,3]>220)&(hsv[:,:,1]>80)&(hsv[:,:,2]>60))
    if len(x)<10:return None
    # Compare colored interior samples at the location established by SIFT geometry.
    x=x[::4];y=y[::4]
    projected=np.column_stack((x,y,np.ones(len(x))))@matrix.T
    target=cv2.cvtColor(cv2.resize(crop,None,fx=2,fy=2),cv2.COLOR_BGR2HSV)
    px=np.rint(projected[:,0]).astype(int);py=np.rint(projected[:,1]).astype(int)
    valid=(px>=0)&(px<target.shape[1])&(py>=0)&(py<target.shape[0])
    px=px[valid];py=py[valid];x=x[valid];y=y[valid]
    valid=target[py,px,1]>60
    if valid.sum()<10:return None
    diff=np.abs(hsv[y[valid],x[valid],0].astype(float)-target[py[valid],px[valid],0])
    return float(np.median(np.minimum(diff,180-diff)))

@lru_cache(maxsize=1024)
def static_perk_art(path,size):
    raw=load_art(path)
    art=cv2.resize(raw,(size,size))
    return art[:,:,:3],(art[:,:,3]>220).astype(np.uint8)*255

def static_perk_candidates(crop):
    # With "Static held food" enabled, a 55px copy of the food sprite is drawn
    # in a clear band above the pet. A coarse half-size pass makes every perk
    # eligible without doing full-resolution template matching 100+ times.
    small=cv2.resize(crop,None,fx=.5,fy=.5)
    coarse=[]
    for row in perk_rows:
        path=perk_paths.get(row['Name'])
        if not path:continue
        art,mask=static_perk_art(path,28)
        score=float(np.nanmin(cv2.matchTemplate(small,art,cv2.TM_SQDIFF_NORMED,mask=mask)))
        if np.isfinite(score):coarse.append((score,row['Name']))
    candidates=[]
    for _,name in sorted(coarse)[:8]:
        best=10.0
        for size in [54,55,56]:
            art,mask=static_perk_art(perk_paths[name],size)
            score=float(np.nanmin(cv2.matchTemplate(crop,art,cv2.TM_SQDIFF_NORMED,mask=mask)))
            if np.isfinite(score):best=min(best,score)
        candidates.append({'kind':'perks','name':name,'method':'template','error':best})
    return sorted(candidates,key=lambda c:c['error'])[:3]

def recognize(path,active_slots=None):
    image=cv2.imread(path)
    if image is None:raise ValueError('Cannot read screenshot')
    if image.shape[:2]!=(720,1280):raise ValueError('Expected 1280x720 canvas image')
    result=[]
    for slot in range(10):
        if active_slots is not None and slot not in active_slots:
            result.append({'pets':[], 'perks':[]});continue
        center=80+120*slot+(40 if slot>=5 else 0)
        left=max(0,center-72)
        right=min(1280,center+72)
        crop=image[358:492,left:right]
        static_perk_crop=image[305:390,left:right]
        # A perk can change while the pet pixels remain identical.
        cache_key=(slot<5,hashlib.sha256(crop.tobytes()+static_perk_crop.tobytes()).digest())
        if cache_key in crop_cache:
            crop_cache.move_to_end(cache_key)
            result.append(crop_cache[cache_key]);continue
        gray=cv2.cvtColor(cv2.resize(crop,None,fx=2,fy=2),cv2.COLOR_BGR2GRAY)
        kp,desc=sift.detectAndCompute(gray,None)
        candidates=[]
        if desc is not None:
            shortlist=[]
            # Keep pets and tiny held-food icons from crowding each other out of
            # the global nearest-neighbor shortlist.
            for kind in ['pets','perks']:
                for direction in [slot<5,not(slot<5)]:
                    entries,flann=banks[(direction,kind)];votes={}
                    for pair in flann.knnMatch(desc,k=2):
                        for hit in pair:
                            votes[hit.imgIdx]=votes.get(hit.imgIdx,0)+1
                    shortlist.extend(entries[i] for i in sorted(votes,key=votes.get,reverse=True)[:30])
            for kind,name,flip,tkp,tdesc in shortlist:
                if kind=='pets' and flip != (slot<5):continue
                matches=matcher.knnMatch(tdesc,desc,k=2)
                good=[a for pair in matches if len(pair)==2 for a,b in [pair] if a.distance<.72*b.distance]
                if len(good)<4:continue
                src=np.float32([tkp[m.queryIdx] for m in good])
                dst=np.float32([kp[m.trainIdx].pt for m in good])
                matrix,inliers=cv2.estimateAffinePartial2D(src,dst,method=cv2.RANSAC,ransacReprojThreshold=5)
                if matrix is None:continue
                # Reject matches projected into an adjacent pet's overlap with this crop.
                projected_center=matrix@np.array([128.,128.,1.])
                if kind=='pets' and abs(projected_center[0]-crop.shape[1])>65:continue
                n=int(inliers.sum())
                scale=float(np.linalg.norm(matrix[:,0]))
                if n<4 or (kind=='pets' and not .75<scale<1.15) or (kind=='perks' and not .12<scale<.6):continue
                color_error=perk_color_error(name,flip,matrix,crop) if kind=='perks' else None
                if kind=='perks' and (color_error is None or color_error>15):continue
                candidates.append({'colorError':color_error,'kind':kind,'name':name,'inliers':n,'matches':len(good),'scale':scale,'ratio':n/len(good)})
        candidates.sort(key=lambda c:(-c['inliers'],-c['ratio']))
        pets=[c for c in candidates if c['kind']=='pets'][:3]
        if not pets or pets[0]['inliers']<6 or pets[0]['ratio']<.7 or (len(pets)>1 and pets[0]['inliers']-pets[1]['inliers']<2):
            pets=template_fallback(crop,slot,[p['name'] for p in pets])
        if pets and ((pets[0].get('method')=='template' and pets[0]['error']<.18) or pets[0].get('inliers',0)>=6):seen_names.add(pets[0]['name'])
        sift_perks=[c for c in candidates if c['kind']=='perks'][:3]
        static_perks=static_perk_candidates(static_perk_crop)
        # The template score has a wide separation when a static icon is present;
        # otherwise retain the body-overlay SIFT result used by the normal mode.
        perks=static_perks if static_perks and static_perks[0]['error']<.25 else sift_perks
        result.append({'pets':pets, 'perks':perks})
        crop_cache[cache_key]=result[-1]
        if len(crop_cache)>128:crop_cache.popitem(last=False)
    return result
for line in sys.stdin:
    try:
        request=json.loads(line)
        print(json.dumps({'path':request['path'],'slots':recognize(request['path'],request.get('activeSlots'))}),flush=True)
    except Exception as error:
        print(json.dumps({'error':str(error)}),flush=True)
