"""Local SIFT matching against supplied assets; stdin JSON-lines -> stdout JSON-lines."""
import cv2, numpy as np, json, sys
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
    entries=[entry for entry in index if entry[2]==flip]
    flann=cv2.FlannBasedMatcher(dict(algorithm=1,trees=4),dict(checks=64))
    flann.add([entry[4] for entry in entries]);flann.train()
    banks[flip]=(entries,flann)

seen_names=set()

def template_fallback(crop,slot,hints):
    candidates=[]
    for row in json.loads((ROOT/'pets.json').read_text()):
        path=ROOT/'Sprite'/'Pets'/(row['NameId']+'.png')
        if not path.exists():continue
        raw=cv2.imread(str(path),cv2.IMREAD_UNCHANGED)
        if slot<5:raw=cv2.flip(raw,1)
        best=10.0
        for size in [112,116,120,124,128]:
            art=cv2.resize(raw,(size,size));mask=(art[:,:,3]>220).astype(np.uint8)*255;mask[:int(size*.3)]=0
            if art.shape[0]>crop.shape[0] or art.shape[1]>crop.shape[1]:continue
            scores=cv2.matchTemplate(crop,art[:,:,:3],cv2.TM_SQDIFF_NORMED,mask=mask)
            best=min(best,float(np.nanmin(scores)))
        candidates.append({'name':row['Name'],'method':'template','error':best})
    candidates.sort(key=lambda c:c['error'])
    if candidates[0]['error']>.13:
        names=seen_names|set(hints+[c['name'] for c in candidates[:5]])
        rows={r['Name']:r for r in json.loads((ROOT/'pets.json').read_text())}
        for candidate in candidates:
            if candidate['name'] not in names:continue
            raw=cv2.imread(str(ROOT/'Sprite'/'Pets'/(rows[candidate['name']]['NameId']+'.png')),cv2.IMREAD_UNCHANGED)
            if slot<5:raw=cv2.flip(raw,1)
            for angle in [-20,-15,-10,10,15,20]:
                rotated=cv2.warpAffine(raw,cv2.getRotationMatrix2D((128,128),angle,1),(256,256))
                for size in [112,116,120,124,128]:
                    art=cv2.resize(rotated,(size,size));mask=(art[:,:,3]>220).astype(np.uint8)*255;mask[:int(size*.3)]=0
                    scores=cv2.matchTemplate(crop,art[:,:,:3],cv2.TM_SQDIFF_NORMED,mask=mask)
                    candidate['error']=min(candidate['error'],float(np.nanmin(scores)))
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
        crop=image[358:492,left:min(1280,center+72)]
        gray=cv2.cvtColor(cv2.resize(crop,None,fx=2,fy=2),cv2.COLOR_BGR2GRAY)
        kp,desc=sift.detectAndCompute(gray,None)
        candidates=[]
        if desc is not None:
            shortlist=[]
            for direction in [slot<5,not(slot<5)]:
                entries,flann=banks[direction];votes={}
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
                n=int(inliers.sum())
                scale=float(np.linalg.norm(matrix[:,0]))
                if n<4 or (kind=='pets' and not .75<scale<1.15) or (kind=='perks' and not .12<scale<.6):continue
                candidates.append({'kind':kind,'name':name,'inliers':n,'matches':len(good),'scale':scale,'ratio':n/len(good)})
        candidates.sort(key=lambda c:(-c['inliers'],-c['ratio']))
        pets=[c for c in candidates if c['kind']=='pets'][:3]
        if not pets or pets[0]['inliers']<6 or pets[0]['ratio']<.7 or (len(pets)>1 and pets[0]['inliers']-pets[1]['inliers']<2):
            pets=template_fallback(crop,slot,[p['name'] for p in pets])
        if pets and ((pets[0].get('method')=='template' and pets[0]['error']<.18) or pets[0].get('inliers',0)>=6):seen_names.add(pets[0]['name'])
        result.append({'pets':pets, 'perks':[c for c in candidates if c['kind']=='perks'][:3]})
    return result
for line in sys.stdin:
    try:
        request=json.loads(line)
        print(json.dumps({'path':request['path'],'slots':recognize(request['path'],request.get('activeSlots'))}),flush=True)
    except Exception as error:
        print(json.dumps({'error':str(error)}),flush=True)
