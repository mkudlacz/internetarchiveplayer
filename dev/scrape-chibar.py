#!/usr/bin/env python3
"""
Scrape chibarproject.com/whole-chicago-bars-list/ to build a venue→neighborhood
lookup table. Output: js/chibar-venues.json

Keys are normalized venue names (lowercase, no leading "the", no punctuation).
Run once; commit the JSON. No ongoing dependency on chibarproject.
"""

import json
import re
import urllib.request
from html.parser import HTMLParser

URL = 'https://chibarproject.com/whole-chicago-bars-list/'
OUT = 'js/chibar-venues.json'


def normalize(name):
    name = name.lower().strip()
    name = re.sub(r"^the\s+", '', name)
    name = re.sub(r"['''\".,:!&\-]", '', name)
    name = re.sub(r'\s+', ' ', name).strip()
    return name


class BarListParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.venues = {}
        self._neighborhood = None
        self._in_h2 = False
        self._h2_buf = ''
        self._in_h3 = False
        self._h3_buf = ''
        self._in_li = False
        self._in_a = False
        self._a_href = ''
        self._a_buf = ''

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'h2':
            self._in_h2 = True
            self._h2_buf = ''
        elif tag == 'h3':
            self._in_h3 = True
            self._h3_buf = ''
        elif tag == 'li':
            self._in_li = True
        elif tag == 'a' and self._in_li:
            self._in_a = True
            self._a_buf = ''
            self._a_href = attrs.get('href', '')

    def handle_endtag(self, tag):
        if tag == 'h2':
            self._in_h2 = False
            name = self._h2_buf.strip()
            if name:
                # New major section — reset to H2 name as fallback neighborhood
                # Strip anchor IDs embedded in text if any
                self._neighborhood = re.sub(r'\s*\(.*?\)', '', name).strip()
        elif tag == 'h3':
            self._in_h3 = False
            # H3 overrides H2 fallback with a specific neighborhood name
            nbhd = re.sub(r'\s*\(.*?\)', '', self._h3_buf).strip()
            if nbhd:
                self._neighborhood = nbhd
        elif tag == 'a' and self._in_a:
            self._in_a = False
            name = self._a_buf.strip()
            href = self._a_href
            # Only count links to actual bar review pages
            if name and self._neighborhood and '/reviews/' in href:
                if href and not href.startswith('http'):
                    href = 'https://chibarproject.com' + href
                key = normalize(name)
                if key:
                    self.venues[key] = {
                        'name': name,
                        'neighborhood': self._neighborhood,
                        'chibarUrl': href,
                    }
        elif tag == 'li':
            self._in_li = False

    def handle_data(self, data):
        if self._in_h2:
            self._h2_buf += data
        elif self._in_h3:
            self._h3_buf += data
        elif self._in_a:
            self._a_buf += data


req = urllib.request.Request(URL, headers={
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
})
with urllib.request.urlopen(req) as resp:
    html = resp.read().decode('utf-8', errors='replace')

parser = BarListParser()
parser.feed(html)

# Sort by key for readable diffs
sorted_venues = dict(sorted(parser.venues.items()))

with open(OUT, 'w', encoding='utf-8') as f:
    json.dump(sorted_venues, f, indent=2, ensure_ascii=False)

print(f"Wrote {len(sorted_venues)} venues to {OUT}")

# Show neighborhood distribution
from collections import Counter
nbhds = Counter(v['neighborhood'] for v in sorted_venues.values())
print(f"\nTop neighborhoods ({len(nbhds)} total):")
for nbhd, count in nbhds.most_common(15):
    print(f"  {count:3d}  {nbhd}")
