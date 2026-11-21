from pathlib import Path
import json, hashlib, html, zipfile
root=Path(__file__).resolve().parent
manifest=json.loads((root/'manifest.json').read_text(encoding='utf-8'))
selected=set()
for c in manifest['cards']:
 for v in c['variants']:
  v['sha256']=hashlib.sha256((root/v['file']).read_bytes()).hexdigest()
  for layer in v['layers']:
   selected.add(layer['file'])
manifest['originals']=[{'file':f,'sha256':hashlib.sha256((root/f).read_bytes()).hexdigest()} for f in sorted(selected)]
(root/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
(root/'data.js').write_text('window.AUDITION = '+json.dumps(manifest,ensure_ascii=False)+';',encoding='utf-8')
lines=['ЗВУКИ ДЛЯ ПРОСЛУШИВАНИЯ — 27 октября 2026','',
 'Статус: кандидаты для оценки владельцем. В игру не внедрены.',
 'Все использованные исходники опубликованы авторами под CC0 1.0 Universal.',
 'Покупка лицензии, отдельное разрешение и обязательная атрибуция не требуются.',
 'https://creativecommons.org/publicdomain/zero/1.0/',
 'Проверка: страницы каждого автора и license.txt для Kenney. Копии страниц находятся в evidence/ рабочей папки.',
 'Три Freesound-записи — HQ MP3 previews; это не исходные lossless WAV. Превью перекодированы в WAV для совместимости.',
 'Обработка: нормализация, обрезка, плавные короткие края. Часть вариантов смонтирована из нескольких CC0-сэмплов.',
 'Точные интервалы, высота тона, уровни, пути источников и контрольные суммы находятся в manifest.json.',
 '', 'Авторы и первоисточники:']
for key,s in manifest['sources'].items(): lines += [f"{s['title']} — {s['author']}",s['url'],'CC0-1.0; commercial use: yes; attribution required: no','']
lines += ['Следующий этап после оценки: выбрать звуки и согласовать подключение.', 'Новое звание: предусмотреть окно «Поделиться» / «Отлично»; интеграция публикации VK позже.']
(root/'LICENSES-AND-NOTES.txt').write_text('\n'.join(lines),encoding='utf-8')
rows=[]
for c in manifest['cards']:
 for v in c['variants']:
  sources='<br>'.join(f'<a href="{manifest["sources"][s]["url"]}">{html.escape(manifest["sources"][s]["title"])}</a> — {html.escape(manifest["sources"][s]["author"])}' for s in v['sources'])
  originals='<br>'.join(html.escape(x['file']) for x in v['layers'])
  rows.append(f'<tr><td>{v["id"]}</td><td>{html.escape(c["title"])}</td><td>{sources}</td><td>CC0</td><td>{html.escape(v["note"] or "Нормализация уровня и короткие края.")}<details><summary>Файлы</summary>{originals}</details></td></tr>')
(root/'sources.html').write_text('''<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Источники звуков</title><style>body{font:15px/1.5 Segoe UI,Arial;background:#142321;color:#ecede0;margin:24px}a{color:#efd286}table{border-collapse:collapse;width:100%}td,th{border:1px solid #46564b;padding:12px;text-align:left;vertical-align:top}h1{color:#efd286}details{font-size:11px;overflow-wrap:anywhere;margin-top:10px}@media(max-width:700px){table,tbody,tr,td{display:block}thead{display:none}tr{margin-bottom:18px}td{border-bottom:0}td:last-child{border-bottom:1px solid #46564b}}</style><a href="index.html">← К прослушиванию</a><h1>Источники и лицензии</h1><p>Все использованные звуки — CC0. Без оплаты, отдельного разрешения и обязательной атрибуции. Проверено по страницам авторов 27 октября 2026 года. Мастеринг и монтаж вариантов выполнены для этой подборки.</p><p>Полная ведомость с параметрами обработки и SHA-256: <a href="manifest.json">manifest.json</a>. <a href="LICENSES-AND-NOTES.txt">Примечания</a>. <a href="https://creativecommons.org/publicdomain/zero/1.0/">Условия CC0</a>.</p><table><thead><tr><th>Код</th><th>Действие</th><th>Источник и автор</th><th>Лицензия</th><th>Обработка</th></tr></thead><tbody>'''+''.join(rows)+'</tbody></table></html>',encoding='utf-8')
with zipfile.ZipFile(root/'sound-audition.zip','w',zipfile.ZIP_DEFLATED) as z:
 for name in ['index.html','sources.html','data.js','manifest.json','LICENSES-AND-NOTES.txt']:
  z.write(root/name,name)
 for file in sorted((root/'audio').glob('*.wav')): z.write(file,str(file.relative_to(root)))
 for name in sorted(selected): z.write(root/name,name)
 for name in ['rpg','interface','jingles']: z.write(root/'sources'/name/'License.txt',f'sources/{name}/License.txt')
print(json.dumps({'sounds':32,'selected_originals':len(selected),'zip_bytes':(root/'sound-audition.zip').stat().st_size}))
