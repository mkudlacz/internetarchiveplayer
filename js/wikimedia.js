const CACHE = new Map();
const API = 'https://commons.wikimedia.org/w/api.php';
const IMAGE_EXT = /\.(jpe?g|png|gif|webp|svg)$/i;

async function queryImages(query, limit) {
  const searchUrl = `${API}?action=query&list=search&srnamespace=6` +
    `&srsearch=${encodeURIComponent(query)}&srlimit=${limit * 3}` +
    `&format=json&origin=*`;
  const searchData = await fetch(searchUrl).then(r => r.json());
  const titles = (searchData.query?.search || [])
    .map(r => r.title)
    .filter(t => IMAGE_EXT.test(t))
    .slice(0, limit);
  if (!titles.length) return [];

  const infoUrl = `${API}?action=query&prop=imageinfo&iiprop=url&iiurlwidth=600` +
    `&titles=${titles.map(encodeURIComponent).join('|')}&format=json&origin=*`;
  const infoData = await fetch(infoUrl).then(r => r.json());
  return Object.values(infoData.query?.pages || {})
    .filter(p => p.imageinfo?.[0]?.thumburl)
    .map(p => ({ url: p.imageinfo[0].thumburl, title: p.title }));
}

export async function fetchWikimediaImages(query, limit = 3, fallbackQuery = null) {
  const key = `${query}|${limit}`;
  if (CACHE.has(key)) return CACHE.get(key);

  try {
    let results = await queryImages(query, limit);
    if (!results.length && fallbackQuery) {
      results = await queryImages(fallbackQuery, limit);
    }
    CACHE.set(key, results);
    return results;
  } catch {
    CACHE.set(key, []);
    return [];
  }
}
