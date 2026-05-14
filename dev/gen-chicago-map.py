#!/usr/bin/env python3
"""
Fetch Chicago community area GeoJSON and generate js/chicago-map.svg.
Run once; commit the SVG. No runtime dependency on external services.
"""
import json, math, urllib.request, re

URL = 'https://data.cityofchicago.org/resource/igwz-8jzy.json?$limit=77'
OUT = 'js/chicago-map.svg'

# Chicago bounding box
LAT_MIN, LAT_MAX = 41.6444, 42.0231
LNG_MIN, LNG_MAX = -87.9402, -87.5234
CENTER_LAT = (LAT_MIN + LAT_MAX) / 2

# Mercator correction: lng degrees are shorter than lat degrees at this latitude
COS_LAT = math.cos(math.radians(CENTER_LAT))

# Compute viewport dimensions preserving geographic proportions
LAT_RANGE = LAT_MAX - LAT_MIN                    # degrees
LNG_RANGE = (LNG_MAX - LNG_MIN) * COS_LAT        # effective degrees

SVG_H = 360
SVG_W = round(SVG_H * LNG_RANGE / LAT_RANGE)     # ~285

def project(lng, lat):
    x = (lng - LNG_MIN) * COS_LAT / LNG_RANGE * SVG_W
    y = (LAT_MAX - lat) / LAT_RANGE * SVG_H
    return round(x), round(y)   # integer precision is plenty at this scale

def simplify(pts, min_dist=1.0):
    """Remove points closer than min_dist px to the previous kept point."""
    if not pts:
        return pts
    out = [pts[0]]
    for p in pts[1:]:
        dx, dy = p[0] - out[-1][0], p[1] - out[-1][1]
        if (dx*dx + dy*dy) >= min_dist * min_dist:
            out.append(p)
    return out

def coords_to_path(ring):
    pts = simplify([project(c[0], c[1]) for c in ring])
    # Deduplicate consecutive identical points
    deduped = [pts[0]]
    for p in pts[1:]:
        if p != deduped[-1]:
            deduped.append(p)
    return 'M ' + ' L '.join(f'{x},{y}' for x, y in deduped) + ' Z'

def area_to_path(geom):
    """Handle both Polygon and MultiPolygon geometries."""
    paths = []
    if geom['type'] == 'Polygon':
        paths.append(coords_to_path(geom['coordinates'][0]))
    elif geom['type'] == 'MultiPolygon':
        for polygon in geom['coordinates']:
            paths.append(coords_to_path(polygon[0]))
    return ' '.join(paths)

def slug(name):
    return re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')

def centroid(geom):
    """Rough centroid for label placement."""
    coords = []
    if geom['type'] == 'Polygon':
        coords = geom['coordinates'][0]
    elif geom['type'] == 'MultiPolygon':
        coords = geom['coordinates'][0][0]
    xs = [c[0] for c in coords]
    ys = [c[1] for c in coords]
    return project(sum(xs)/len(xs), sum(ys)/len(ys))

# Fetch data
print('Fetching community areas...')
req = urllib.request.Request(URL, headers={
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
})
with urllib.request.urlopen(req) as resp:
    areas = json.load(resp)
print(f'  {len(areas)} areas loaded')

# Sort by area number for consistent output
areas.sort(key=lambda a: int(a['area_numbe']))

# Build SVG
paths_svg = []
for area in areas:
    name = area['community']
    geom = area['the_geom']
    d = area_to_path(geom)
    cx, cy = centroid(geom)
    s = slug(name)
    paths_svg.append(
        f'  <path id="area-{s}" data-community="{name}" d="{d}" />'
    )

svg = f'''<svg xmlns="http://www.w3.org/2000/svg"
     viewBox="0 0 {SVG_W} {SVG_H}"
     width="{SVG_W}" height="{SVG_H}"
     id="chicago-map">
{chr(10).join(paths_svg)}
</svg>'''

with open(OUT, 'w') as f:
    f.write(svg)

print(f'Wrote {OUT} ({SVG_W}x{SVG_H}px, {len(areas)} areas)')
