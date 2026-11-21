from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import urllib.request, zipfile, json
ROOT=Path(__file__).resolve().parent
FILES={
 'bell-preview.mp3':'https://cdn.freesound.org/previews/494/494565_3489769-hq.mp3',
 'backpack-preview.mp3':'https://cdn.freesound.org/previews/444/444915_7472177-hq.mp3',
 'curtain-preview.mp3':'https://cdn.freesound.org/previews/142/142301_2557292-hq.mp3',
 'fanfarehappy.ogg':'https://opengameart.org/sites/default/files/fanfarehappy_0.ogg',
 'victory.wav':'https://opengameart.org/sites/default/files/victory_0.wav',
 'chest.wav':'https://opengameart.org/sites/default/files/open%20chest_0.wav',
 'shield.zip':'https://opengameart.org/sites/default/files/space%20shield%20sounds.zip',
 **{f'pop{i}.wav':f'https://opengameart.org/sites/default/files/pop{i}.wav' for i in range(1,10)},
}
def get(item):
 name,url=item
 target=ROOT/'sources'/'extra'/name; target.parent.mkdir(parents=True,exist_ok=True)
 if not target.exists():
  with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0'}),timeout=40) as r: target.write_bytes(r.read())
 if target.suffix=='.zip':
  out=target.parent/target.stem; out.mkdir(exist_ok=True)
  with zipfile.ZipFile(target) as z:
   for e in z.infolist():
    if not (out/e.filename).resolve().is_relative_to(out.resolve()): raise ValueError('Unsafe path')
   z.extractall(out)
  return {'file':name,'contents':[str(p.relative_to(out)) for p in out.rglob('*') if p.is_file()]}
 return {'file':name,'bytes':target.stat().st_size}
if __name__=='__main__':
 with ThreadPoolExecutor(max_workers=4) as pool:
  for r in pool.map(get,FILES.items()): print(json.dumps(r))
 (ROOT/'evidence'/'downloads.json').write_text(json.dumps(FILES,indent=2),encoding='utf-8')
