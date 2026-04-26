const CACHE = new Map();
const KEY_LS = 'iap_flickr_key';

export function getFlickrKey() {
  return localStorage.getItem(KEY_LS) || '';
}

export function setFlickrKey(key) {
  const k = key.trim();
  k ? localStorage.setItem(KEY_LS, k) : localStorage.removeItem(KEY_LS);
}

export async function fetchVenuePhotos(venueName) {
  if (!venueName) return [];
  if (CACHE.has(venueName)) return CACHE.get(venueName);

  const apiKey = getFlickrKey();
  if (!apiKey) { CACHE.set(venueName, []); return []; }

  const text = encodeURIComponent(`"${venueName}" Chicago`);
  const url = `https://www.flickr.com/services/rest/?method=flickr.photos.search` +
    `&api_key=${apiKey}&text=${text}&sort=relevance&per_page=5` +
    `&format=json&nojsoncallback=1&content_type=1&media=photos`;

  try {
    const data = await fetch(url).then(r => r.json());
    const photos = data.photos?.photo || [];
    const urls = photos.map(p =>
      `https://live.staticflickr.com/${p.server}/${p.id}_${p.secret}_z.jpg`
    );
    CACHE.set(venueName, urls);
    return urls;
  } catch {
    CACHE.set(venueName, []);
    return [];
  }
}
