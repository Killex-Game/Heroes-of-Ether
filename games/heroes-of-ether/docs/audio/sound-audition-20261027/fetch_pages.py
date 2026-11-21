from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import urllib.request, json, re, html
ROOT = Path(__file__).resolve().parent
PAGES = {
 'bell':'https://freesound.org/people/775noise/sounds/494565/',
 'backpack':'https://freesound.org/people/veronicalyn/sounds/444915/',
 'curtain':'https://freesound.org/people/fryzu82/sounds/142301/',
 'fanfare':'https://opengameart.org/content/happy-and-sad-tuba-fanfare',
 'victory':'https://opengameart.org/content/victory-4',
 'chest':'https://opengameart.org/content/open-chest-sfx',
 'sfx2':'https://opengameart.org/content/100-cc0-sfx-2',
 'kenney-terms':'https://kenney.nl/support',
 'cc0':'https://creativecommons.org/publicdomain/zero/1.0/',
 'pops':'https://opengameart.org/content/pop-sounds-0',
 'shield':'https://opengameart.org/content/space-ship-shield-sounds',
 'kenney-rpg':'https://kenney.nl/assets/rpg-audio',
 'kenney-interface':'https://kenney.nl/assets/interface-sounds',
 'kenney-jingles':'https://kenney.nl/assets/music-jingles',
}
def get(item):
 key,url = item
 if (ROOT/'evidence'/(key+'.html')).exists():
  data=(ROOT/'evidence'/(key+'.html')).read_text(encoding='utf-8')
  return {'key':key,'cached':True}
 req=urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0'})
 try:
  with urllib.request.urlopen(req,timeout=30) as r: data=r.read().decode('utf-8')
  out=ROOT/'evidence'; out.mkdir(exist_ok=True)
  (out/(key+'.html')).write_text(data,encoding='utf-8')
  urls=set(html.unescape(u) for u in re.findall(r'(?:https?:)?//[^\s"<>]+',data) if re.search(r'\.(?:mp3|ogg|wav|zip)(?:\?|$)',u))
  return {'key':key,'files':sorted(urls)}
 except Exception as e: return {'key':key,'error':str(e)}
if __name__=='__main__':
 with ThreadPoolExecutor(max_workers=5) as pool:
  for x in pool.map(get,PAGES.items()): print(json.dumps(x))
