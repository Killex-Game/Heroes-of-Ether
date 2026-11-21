from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import urllib.request, zipfile, json, re

ROOT = Path(__file__).resolve().parent
SOURCES = {
 'rpg': 'https://kenney.nl/media/pages/assets/rpg-audio/8e99002d76-1677590336/kenney_rpg-audio.zip',
 'interface': 'https://kenney.nl/media/pages/assets/interface-sounds/fa43c1dd4d-1677589452/kenney_interface-sounds.zip',
 'casino': 'https://kenney.nl/media/pages/assets/casino-audio/2472606a04-1721639069/kenney_casino-audio.zip',
 'jingles': 'https://kenney.nl/media/pages/assets/music-jingles/f37e530b9e-1677590399/kenney_music-jingles.zip',
}

def fetch(item):
 name, url = item
 target = ROOT / 'sources' / name
 target.mkdir(parents=True, exist_ok=True)
 archive = target / 'original.zip'
 if not archive.exists():
  req = urllib.request.Request(url, headers={'User-Agent':'Mozilla/5.0'})
  with urllib.request.urlopen(req, timeout=45) as response:
   archive.write_bytes(response.read())
 with zipfile.ZipFile(archive) as z:
  for entry in z.infolist():
   resolved = (target / entry.filename).resolve()
   if not resolved.is_relative_to(target.resolve()): raise ValueError('Unsafe archive path')
  z.extractall(target)
 return {'pack':name, 'files':[str(p.relative_to(target)) for p in target.rglob('*') if p.suffix.lower() in ('.ogg','.wav','.mp3','.txt')]}

if __name__ == '__main__':
 with ThreadPoolExecutor(max_workers=4) as pool:
  for result in pool.map(fetch, SOURCES.items()): print(json.dumps(result))
