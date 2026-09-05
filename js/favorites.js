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

const DISMISS_KEY = 'iap_dismissed_artists';

function loadDismissed() {
  try { return new Set(JSON.parse(localStorage.getItem(DISMISS_KEY) || '[]')); }
  catch { return new Set(); }
}

function saveDismissed(s) {
  localStorage.setItem(DISMISS_KEY, JSON.stringify([...s]));
}

export function isDismissed(artistName)   { return loadDismissed().has((artistName || '').trim().toLowerCase()); }
export function getDismissedArtists()     { return [...loadDismissed()]; }

export function toggleDismiss(artistName) {
  const key = (artistName || '').trim().toLowerCase();
  const s = loadDismissed();
  s.has(key) ? s.delete(key) : s.add(key);
  saveDismissed(s);
  return s.has(key); // returns new state
}
