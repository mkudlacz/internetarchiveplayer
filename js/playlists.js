const KEY = 'iap_playlists';

function load()        { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } }
function save(lists)   { localStorage.setItem(KEY, JSON.stringify(lists)); }

export function getAll()  { return load(); }
export function getById(id) { return load().find(p => p.id === id) || null; }

export function create(name) {
  const lists = load();
  const pl = { id: Date.now().toString(36) + Math.random().toString(36).slice(2,5), name, tracks: [], created: Date.now() };
  lists.push(pl);
  save(lists);
  return pl;
}

export function addTracks(id, tracks) {
  const lists = load();
  const pl = lists.find(p => p.id === id);
  if (!pl) return;
  const seen = new Set(pl.tracks.map(t => t.url));
  tracks.forEach(t => { if (!seen.has(t.url)) pl.tracks.push(t); });
  save(lists);
}

export function removeTrack(id, index) {
  const lists = load();
  const pl = lists.find(p => p.id === id);
  if (pl) { pl.tracks.splice(index, 1); save(lists); }
}

export function rename(id, name) {
  const lists = load();
  const pl = lists.find(p => p.id === id);
  if (pl) { pl.name = name; save(lists); }
}

export function remove(id) {
  save(load().filter(p => p.id !== id));
}

// ── Share URL ──────────────────────────────────────────────────────
// Format: #pl=Name~identifier:filename~identifier:filename~...
// Compact enough for clipboard, decodable by the app.

export function encodeShareUrl(playlist) {
  const base = location.origin + location.pathname;
  const tracks = playlist.tracks.map(t => `${t.identifier}:${t.filename}`).join('~');
  const payload = encodeURIComponent(`${playlist.name}~${tracks}`);
  return `${base}#pl=${payload}`;
}

export function decodeShareHash() {
  const hash = location.hash;
  const match = hash.match(/[#&]?pl=([^&]+)/);
  if (!match) return null;
  try {
    const raw = decodeURIComponent(match[1]);
    const parts = raw.split('~');
    const name = parts[0] || 'Shared Playlist';
    const tracks = parts.slice(1).flatMap(seg => {
      const colon = seg.indexOf(':');
      if (colon < 0) return [];
      const identifier = seg.slice(0, colon);
      const filename   = seg.slice(colon + 1);
      if (!identifier || !filename) return [];
      return [{
        identifier,
        filename,
        url:      `https://archive.org/download/${identifier}/${encodeURIComponent(filename)}`,
        title:    filename.replace(/\.[^.]+$/, ''),
        artist:   '',
        album:    identifier,
        duration: '',
      }];
    });
    return { id: 'shared', name, tracks };
  } catch { return null; }
}

// Human-readable share text with archive.org links
export function shareText(playlist) {
  const lines = [`Playlist: "${playlist.name}"`, ''];
  playlist.tracks.forEach((t, i) => {
    lines.push(`${i + 1}. ${t.title}`);
    if (t.artist) lines.push(`   ${t.artist} — ${t.album || ''}`);
    lines.push(`   https://archive.org/details/${t.identifier}`);
    lines.push('');
  });
  return lines.join('\n').trim();
}
