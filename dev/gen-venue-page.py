#!/usr/bin/env python3
"""
Run from project root:  python3 dev/gen-venue-page.py
Opens dev/validate-venues.html with current venues.json data embedded.
"""
import json, pathlib, webbrowser

root = pathlib.Path(__file__).parent.parent
venues = json.loads((root / 'js/venues.json').read_text())

# Deduplicate: each unique URL gets one row; aliases listed below
seen = {}
for name, url in venues.items():
    if url not in seen:
        seen[url] = {'primary': name, 'aliases': []}
    else:
        seen[url]['aliases'].append(name)

rows_html = ''
for url, info in seen.items():
    alias_html = f'<div class="alias">also: {", ".join(info["aliases"])}</div>' if info['aliases'] else ''
    filename = url.split('/')[-1]
    try:
        from urllib.parse import unquote
        filename = unquote(filename)
    except Exception:
        pass
    rows_html += f'''
    <div class="row">
      <a href="{url}" target="_blank"><img src="{url}" alt="" onerror="this.closest('.row').classList.add('broken')"></a>
      <div class="info">
        <div class="name">{info["primary"]}</div>
        {alias_html}
        <a class="file-link" href="{url}" target="_blank">{filename}</a>
      </div>
    </div>'''

count = len(seen)
total = len(venues)

API = 'https://commons.wikimedia.org/w/api.php'

html = f'''<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Venue Photo Validation</title>
  <style>
    * {{ box-sizing: border-box; }}
    body {{ font-family: -apple-system, sans-serif; background: #111; color: #eee; margin: 0; padding: 16px; }}
    h1 {{ font-size: 18px; margin-bottom: 4px; color: #aaa; font-weight: 400; }}
    .note {{ font-size: 12px; color: #555; margin-bottom: 20px; }}
    .lookup {{
      background: #1c1c1c; border: 1px solid #333; border-radius: 10px;
      padding: 14px 16px; margin-bottom: 24px; max-width: 680px;
    }}
    .lookup h2 {{ font-size: 13px; color: #888; font-weight: 400; margin-bottom: 10px; }}
    .lookup-row {{ display: flex; gap: 8px; }}
    .lookup input {{
      flex: 1; background: #2a2a2a; border: 1px solid #444; border-radius: 8px;
      color: #eee; font-size: 14px; padding: 8px 12px; outline: none;
    }}
    .lookup input::placeholder {{ color: #555; }}
    .lookup button {{
      background: #e8a020; color: #000; font-size: 14px; font-weight: 600;
      border-radius: 8px; padding: 8px 14px; cursor: pointer; white-space: nowrap;
    }}
    .lookup button:active {{ opacity: 0.75; }}
    .lookup-results {{ margin-top: 12px; display: flex; flex-wrap: wrap; gap: 10px; }}
    .result-card {{
      background: #222; border: 1px solid #333; border-radius: 8px;
      overflow: hidden; width: 160px; cursor: pointer; transition: border-color 0.15s;
    }}
    .result-card:hover {{ border-color: #e8a020; }}
    .result-card img {{ width: 160px; height: 120px; object-fit: cover; display: block; background: #2a2a2a; }}
    .result-card-url {{ font-size: 10px; color: #888; padding: 6px 8px; word-break: break-all; line-height: 1.3; }}
    .copied {{ font-size: 12px; color: #4caf50; padding: 6px 8px; }}
    .lookup-msg {{ font-size: 13px; color: #888; margin-top: 8px; }}
    .count {{ font-size: 13px; color: #555; margin-bottom: 12px; }}
    .grid {{ display: flex; flex-direction: column; max-width: 680px; }}
    .row {{ display: flex; align-items: center; gap: 14px; padding: 12px 0; border-bottom: 1px solid #2a2a2a; }}
    .row:last-child {{ border-bottom: none; }}
    .row a img {{ width: 80px; height: 80px; object-fit: cover; border-radius: 8px; display: block; background: #222; }}
    .info {{ min-width: 0; flex: 1; }}
    .name {{ font-size: 15px; font-weight: 600; margin-bottom: 4px; }}
    .alias {{ font-size: 11px; color: #555; margin-bottom: 6px; }}
    .file-link {{ font-size: 11px; color: #e8a020; word-break: break-all; }}
    .broken {{ opacity: 0.35; }}
    .broken .name::after {{ content: " ✗ broken"; color: #f55; font-weight: 400; font-size: 11px; }}
  </style>
</head>
<body>
<h1>Venue photos — venues.json</h1>
<p class="note">Click any image to open full-size · Search to find replacements · Click a result to copy its URL</p>

<div class="lookup">
  <h2>Find a replacement image on Wikimedia Commons</h2>
  <div class="lookup-row">
    <input id="lookup-input" type="text" placeholder="e.g. Schubas Tavern Chicago">
    <button id="lookup-btn">Search</button>
  </div>
  <div class="lookup-msg" id="lookup-msg"></div>
  <div class="lookup-results" id="lookup-results"></div>
</div>

<div class="count">{count} unique photos covering {total} venue name variants</div>
<div class="grid">{rows_html}</div>

<script>
const API = '{API}';
const IMAGE_EXT = /\\.(jpe?g|png|gif|webp)$/i;

async function searchWikimedia(query) {{
  const searchUrl = API + '?action=query&list=search&srnamespace=6&srsearch=' +
    encodeURIComponent(query) + '&srlimit=12&format=json&origin=*';
  const data = await fetch(searchUrl).then(r => r.json());
  const titles = (data.query?.search || []).map(r => r.title).filter(t => IMAGE_EXT.test(t));
  if (!titles.length) return [];
  const infoUrl = API + '?action=query&prop=imageinfo&iiprop=url&iiurlwidth=600&titles=' +
    titles.map(encodeURIComponent).join('|') + '&format=json&origin=*';
  const info = await fetch(infoUrl).then(r => r.json());
  return Object.values(info.query?.pages || {{}})
    .filter(p => p.imageinfo?.[0]?.thumburl)
    .map(p => ({{ thumb: p.imageinfo[0].thumburl, title: p.title }}));
}}

document.getElementById('lookup-btn').addEventListener('click', async () => {{
  const q = document.getElementById('lookup-input').value.trim();
  if (!q) return;
  const msg = document.getElementById('lookup-msg');
  const results = document.getElementById('lookup-results');
  msg.textContent = 'Searching…';
  results.innerHTML = '';
  try {{
    const imgs = await searchWikimedia(q);
    msg.textContent = imgs.length ? imgs.length + ' results — click any to copy its URL' : 'No image results found.';
    imgs.forEach(({{ thumb, title }}) => {{
      const card = document.createElement('div');
      card.className = 'result-card';
      card.innerHTML = '<img src="' + thumb + '" alt=""><div class="result-card-url">' +
        decodeURIComponent(title.replace('File:', '')) + '</div>';
      card.addEventListener('click', () => {{
        navigator.clipboard.writeText(thumb).then(() => {{
          card.innerHTML = '<img src="' + thumb + '" alt=""><div class="copied">✓ URL copied!</div>';
        }});
      }});
      results.appendChild(card);
    }});
  }} catch {{ msg.textContent = 'Search failed.'; }}
}});
document.getElementById('lookup-input').addEventListener('keydown', e => {{
  if (e.key === 'Enter') document.getElementById('lookup-btn').click();
}});
</script>
</body>
</html>'''

out = root / 'dev/validate-venues.html'
out.write_text(html)
print(f'Written {out}  ({count} unique venues, {total} keys)')
webbrowser.open(str(out))
