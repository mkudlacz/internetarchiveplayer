const IA_SEARCH   = 'https://archive.org/advancedsearch.php';
const IA_METADATA = 'https://archive.org/metadata';

export const DEFAULT_COLLECTION = 'aadamjacobs';

// Load the full item index for a collection in one shot (for client-side sort/filter/search).
// With ~2500 items × 5 fields this is ~200KB — acceptable for a personal app.
export async function loadFullIndex(collectionId) {
  const params = new URLSearchParams({
    q:      `collection:${collectionId}`,
    output: 'json',
    rows:   9999,
    fl:     'identifier,title,creator,date,year,coverage,addeddate,downloads',
    sort:   'date desc',
  });
  const res = await fetch(`${IA_SEARCH}?${params}`);
  if (!res.ok) throw new Error(`Index load failed: ${res.status}`);
  const data = await res.json();
  // Normalise: creator is sometimes an array
  return (data.response?.docs ?? []).map(normalise);
}

export async function getItemMetadata(identifier) {
  const res = await fetch(`${IA_METADATA}/${identifier}`);
  if (!res.ok) throw new Error(`Metadata failed: ${res.status}`);
  const data = await res.json();
  // Normalise creator on metadata too
  if (Array.isArray(data.metadata?.creator)) {
    data.metadata.creator = data.metadata.creator[0];
  }
  return data;
}

export function getStreamUrl(identifier, filename) {
  return `https://archive.org/download/${identifier}/${encodeURIComponent(filename)}`;
}

export function getAudioFiles(files) {
  const mp3 = files.filter(f => f.format === 'VBR MP3' && f.source === 'derivative');
  if (mp3.length) return mp3;
  return files.filter(f => f.format === 'Flac' && f.source === 'original');
}

export function formatDuration(seconds) {
  const s = Math.round(Number(seconds));
  if (!isFinite(s) || s <= 0) return '';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  return `${m}:${String(sec).padStart(2,'0')}`;
}

function normalise(doc) {
  return {
    ...doc,
    creator: Array.isArray(doc.creator) ? doc.creator[0] : (doc.creator || ''),
  };
}
