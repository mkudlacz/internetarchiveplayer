#!/usr/bin/env python3
"""
Generate the artist context editor form.
Fetches all artists + show years from the IA collection,
embeds existing artist-context.json, opens the editor in a browser.
"""
import json, os, sys, webbrowser, urllib.request, urllib.parse

COLLECTION = "aadamjacobs"
OUT  = os.path.join(os.path.dirname(__file__), 'artist-editor.html')
CTX  = os.path.join(os.path.dirname(__file__), '..', 'js', 'artist-context.json')

# ── Fetch collection index ────────────────────────────────────────────────────
def fetch_docs():
    docs, page = [], 1
    while True:
        qs = (
            f'q=collection%3A{COLLECTION}+AND+mediatype%3Aaudio'
            f'&fl[]=creator&fl[]=date&rows=500&page={page}&output=json'
        )
        url = f'https://archive.org/advancedsearch.php?{qs}'
        print(f'  Fetching page {page}…', end='', flush=True)
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'dev-tool/1.0'})
            with urllib.request.urlopen(req, timeout=30) as r:
                data = json.loads(r.read())
            batch = data.get('response', {}).get('docs', [])
            print(f' {len(batch)} items')
            docs.extend(batch)
            if len(batch) < 500:
                break
            page += 1
        except Exception as e:
            print(f' Error: {e}')
            break
    return docs

print('Fetching collection index…')
docs = fetch_docs()
print(f'Total: {len(docs)} items')

# ── Build artist → sorted years ───────────────────────────────────────────────
artist_years = {}
for doc in docs:
    creator = (doc.get('creator') or '').strip()
    date    = (doc.get('date')    or '')[:4]
    if creator and date and date.isdigit():
        artist_years.setdefault(creator, set()).add(date)
artist_years = {k: sorted(v) for k, v in sorted(artist_years.items())}

# ── Load existing context ─────────────────────────────────────────────────────
existing = {}
if os.path.exists(CTX):
    with open(CTX) as f:
        existing = json.load(f)

# ── Generate HTML ─────────────────────────────────────────────────────────────
artist_years_json = json.dumps(artist_years)
existing_json     = json.dumps(existing)

html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Artist Context Editor</title>
<style>
  *, *::before, *::after {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: #111; color: #eee; padding: 24px;
    min-height: 100vh;
  }}
  h1 {{ font-size: 18px; font-weight: 700; margin-bottom: 20px; color: #f5a623; }}
  h2 {{ font-size: 13px; font-weight: 600; text-transform: uppercase;
        letter-spacing: 0.5px; color: #888; margin-bottom: 10px; }}
  label {{ display: block; font-size: 12px; color: #999; margin-bottom: 4px; }}
  select, textarea, input[type=text] {{
    width: 100%; background: #1e1e1e; color: #eee;
    border: 1px solid #333; border-radius: 8px;
    padding: 9px 12px; font-size: 14px; font-family: inherit;
    margin-bottom: 14px;
  }}
  select:focus, textarea:focus, input:focus {{
    outline: none; border-color: #f5a623;
  }}
  textarea {{ resize: vertical; line-height: 1.5; }}
  .row {{ display: flex; gap: 12px; }}
  .row > * {{ flex: 1; }}
  .card {{
    background: #1a1a1a; border: 1px solid #2a2a2a;
    border-radius: 12px; padding: 20px; margin-bottom: 16px;
  }}
  .quote-block {{
    background: #222; border: 1px solid #333; border-radius: 8px;
    padding: 14px; margin-bottom: 10px; position: relative;
  }}
  .quote-block textarea {{ margin-bottom: 8px; }}
  .quote-block input {{ margin-bottom: 0; }}
  .remove-quote {{
    position: absolute; top: 10px; right: 10px;
    background: none; border: none; color: #666; font-size: 18px;
    cursor: pointer; line-height: 1; padding: 2px 6px;
  }}
  .remove-quote:hover {{ color: #e04; }}
  button {{
    cursor: pointer; border: none; border-radius: 8px;
    font-size: 14px; font-weight: 600; font-family: inherit;
    padding: 10px 18px;
  }}
  .btn-add {{ background: #2a2a2a; color: #eee; border: 1px solid #444; }}
  .btn-add:hover {{ background: #333; }}
  .btn-copy {{ background: #f5a623; color: #000; }}
  .btn-copy:hover {{ opacity: 0.85; }}
  .btn-copy.copied {{ background: #4caf50; }}
  .output {{
    background: #0d0d0d; border: 1px solid #2a2a2a; border-radius: 10px;
    padding: 16px; font-family: 'SF Mono', 'Fira Code', monospace;
    font-size: 12px; line-height: 1.6; white-space: pre-wrap;
    word-break: break-all; color: #c8e6c9; max-height: 420px;
    overflow-y: auto; margin-bottom: 12px;
  }}
  .existing-badge {{
    display: inline-block; font-size: 11px; font-weight: 600;
    background: #2a3a1a; color: #7cb97c; border: 1px solid #3a5a2a;
    border-radius: 6px; padding: 2px 8px; margin-left: 8px;
    vertical-align: middle;
  }}
  #existing-notice {{ font-size: 13px; color: #888; margin-bottom: 16px; min-height: 20px; }}
  hr {{ border: none; border-top: 1px solid #2a2a2a; margin: 16px 0; }}
  .hint {{ font-size: 12px; color: #666; margin-top: -10px; margin-bottom: 14px; line-height: 1.4; }}
</style>
</head>
<body>
<h1>Artist Context Editor</h1>

<div class="card">
  <h2>Select Show</h2>
  <div class="row">
    <div>
      <label for="artist-select">Artist</label>
      <select id="artist-select">
        <option value="">— pick an artist —</option>
      </select>
    </div>
    <div>
      <label for="year-select">Year</label>
      <select id="year-select" disabled>
        <option value="">— pick a year —</option>
      </select>
    </div>
  </div>
  <div id="existing-notice"></div>
</div>

<div class="card" id="editor-card" style="display:none">
  <h2>Context</h2>
  <label for="blurb-input">Blurb <span style="color:#555;font-weight:400">(short factual bio / era context, 1–2 sentences)</span></label>
  <textarea id="blurb-input" rows="3" placeholder="e.g. Nashville rock band at peak momentum in 2014, known for their four-guitar lineup and ferociously energetic live shows."></textarea>

  <hr>
  <h2 style="margin-bottom:14px">Quotes <span style="color:#555;font-weight:400;text-transform:none;font-size:12px">— what the artist said about touring / playing shows this year</span></h2>
  <div id="quotes-container"></div>
  <button class="btn-add" id="add-quote-btn">+ Add Quote</button>
</div>

<div class="card" id="output-card" style="display:none">
  <h2>JSON Output — paste into js/artist-context.json</h2>
  <div class="output" id="json-output"></div>
  <button class="btn-copy" id="copy-btn">Copy to Clipboard</button>
</div>

<script>
const ARTIST_YEARS = {artist_years_json};
const EXISTING     = {existing_json};

const artistSel  = document.getElementById('artist-select');
const yearSel    = document.getElementById('year-select');
const notice     = document.getElementById('existing-notice');
const editorCard = document.getElementById('editor-card');
const outputCard = document.getElementById('output-card');
const blurbEl    = document.getElementById('blurb-input');
const quotesEl   = document.getElementById('quotes-container');
const addQuoteBtn= document.getElementById('add-quote-btn');
const jsonOut    = document.getElementById('json-output');
const copyBtn    = document.getElementById('copy-btn');

// Populate artist dropdown
Object.keys(ARTIST_YEARS).forEach(artist => {{
  const opt = document.createElement('option');
  opt.value = opt.textContent = artist;
  artistSel.appendChild(opt);
}});

artistSel.addEventListener('change', () => {{
  const artist = artistSel.value;
  yearSel.innerHTML = '<option value="">— pick a year —</option>';
  yearSel.disabled = !artist;
  editorCard.style.display = 'none';
  outputCard.style.display = 'none';
  notice.textContent = '';
  if (!artist) return;
  (ARTIST_YEARS[artist] || []).forEach(year => {{
    const opt = document.createElement('option');
    opt.value = opt.textContent = year;
    yearSel.appendChild(opt);
  }});
}});

yearSel.addEventListener('change', () => {{
  const artist = artistSel.value;
  const year   = yearSel.value;
  if (!artist || !year) {{
    editorCard.style.display = 'none';
    outputCard.style.display = 'none';
    return;
  }}

  // Check for existing entry
  const existing = EXISTING[artist]?.[year];
  if (existing) {{
    notice.innerHTML = `Existing entry found <span class="existing-badge">loaded</span>`;
    blurbEl.value = existing.blurb || '';
    quotesEl.innerHTML = '';
    (existing.quotes || []).forEach(q => addQuoteBlock(q.text, q.attr));
  }} else {{
    notice.textContent = 'No entry yet for this artist + year.';
    blurbEl.value = '';
    quotesEl.innerHTML = '';
  }}

  editorCard.style.display = 'block';
  outputCard.style.display = 'block';
  updateOutput();
}});

function addQuoteBlock(text = '', attr = '') {{
  const div = document.createElement('div');
  div.className = 'quote-block';
  div.innerHTML = `
    <button class="remove-quote" title="Remove">×</button>
    <textarea rows="3" placeholder='"We were always looking for the most intense show we could play."' class="q-text">${{escHtml(text)}}</textarea>
    <input type="text" placeholder="Attribution — e.g. Jordan Smith, 2014" class="q-attr" value="${{escHtml(attr)}}">
  `;
  div.querySelector('.remove-quote').addEventListener('click', () => {{
    div.remove(); updateOutput();
  }});
  div.querySelector('.q-text').addEventListener('input', updateOutput);
  div.querySelector('.q-attr').addEventListener('input', updateOutput);
  quotesEl.appendChild(div);
  updateOutput();
}}

addQuoteBtn.addEventListener('click', () => addQuoteBlock());
blurbEl.addEventListener('input', updateOutput);

function gatherData() {{
  const artist = artistSel.value;
  const year   = yearSel.value;
  if (!artist || !year) return null;
  const blurb  = blurbEl.value.trim();
  const quotes = [];
  quotesEl.querySelectorAll('.quote-block').forEach(block => {{
    const text = block.querySelector('.q-text').value.trim();
    const attr = block.querySelector('.q-attr').value.trim();
    if (text) quotes.push(attr ? {{text, attr}} : {{text}});
  }});
  return {{ artist, year, blurb, quotes }};
}}

function updateOutput() {{
  const d = gatherData();
  if (!d) return;

  // Build the full merged context JSON for output
  const merged = JSON.parse(JSON.stringify(EXISTING));
  if (!merged[d.artist]) merged[d.artist] = {{}};
  merged[d.artist][d.year] = {{
    blurb: d.blurb,
    quotes: d.quotes
  }};

  jsonOut.textContent = JSON.stringify(merged, null, 2);
}}

copyBtn.addEventListener('click', () => {{
  navigator.clipboard.writeText(jsonOut.textContent).then(() => {{
    copyBtn.textContent = 'Copied!';
    copyBtn.classList.add('copied');
    setTimeout(() => {{
      copyBtn.textContent = 'Copy to Clipboard';
      copyBtn.classList.remove('copied');
    }}, 2000);
  }});
}});

function escHtml(s) {{
  return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}}
</script>
</body>
</html>"""

with open(OUT, 'w') as f:
    f.write(html)

print(f'Generated {OUT}')
webbrowser.open(f'file://{os.path.abspath(OUT)}')
