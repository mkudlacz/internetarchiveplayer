const KEY = 'iap_favorites';

function load() {
  try { return new Set(JSON.parse(localStorage.getItem(KEY) || '[]')); }
  catch { return new Set(); }
}

function save(s) {
  localStorage.setItem(KEY, JSON.stringify([...s]));
}

export function isFav(id)      { return load().has(id); }
export function getFavIds()    { return [...load()]; }

export function toggleFav(id) {
  const s = load();
  s.has(id) ? s.delete(id) : s.add(id);
  save(s);
  return s.has(id); // returns new state
}

export function importFavIds(ids) {
  const s = load();
  ids.forEach(id => { if (id) s.add(id); });
  save(s);
}

export function encodeFavsHash() {
  const ids = getFavIds();
  if (!ids.length) return '';
  return location.href.split('#')[0] + '#favs=' + ids.map(encodeURIComponent).join(',');
}

export function decodeFavsHash() {
  if (!location.hash.startsWith('#favs=')) return null;
  return location.hash.slice(6).split(',').map(decodeURIComponent).filter(Boolean);
}
