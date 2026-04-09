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
