const CACHE = new Map();
const API = 'https://commons.wikimedia.org/w/api.php';

export async function fetchWikimediaImages(query, limit = 3) {
  const key = `${query}|${limit}`;
  if (CACHE.has(key)) return CACHE.get(key);

  try {
    const searchUrl = `${API}?action=query&list=search&srnamespace=6` +
      `&srsearch=${encodeURIComponent(query)}&srlimit=${limit}` +
      `&format=json&origin=*`;
    const searchData = await fetch(searchUrl).then(r => r.json());
    const titles = (searchData.query?.search || []).map(r => r.title);
    if (!titles.length) { CACHE.set(key, []); return []; }

    const infoUrl = `${API}?action=query&prop=imageinfo&iiprop=url&iiurlwidth=600` +
      `&titles=${titles.map(encodeURIComponent).join('|')}&format=json&origin=*`;
    const infoData = await fetch(infoUrl).then(r => r.json());
    const results = Object.values(infoData.query?.pages || {})
      .filter(p => p.imageinfo?.[0]?.thumburl)
      .map(p => ({ url: p.imageinfo[0].thumburl, title: p.title }));

    CACHE.set(key, results);
    return results;
  } catch {
    CACHE.set(key, []);
    return [];
  }
}
