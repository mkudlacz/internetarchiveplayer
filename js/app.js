import { DEFAULT_COLLECTION, loadFullIndex, getItemMetadata, getStreamUrl, getAudioFiles, formatDuration } from './api.js';
import player from './player.js';
import { isFav, toggleFav, getFavIds, importFavIds, encodeFavsHash, decodeFavsHash, isDismissed, toggleDismiss } from './favorites.js';
// ── Redcontroldeck curated favs ────────────────────────────────────
let RCD_FAVS = [];
fetch('./js/rcd-favs.json').then(r => r.json()).then(d => { RCD_FAVS = Array.isArray(d) ? d : []; }).catch(() => {});

// ── Chicago history ────────────────────────────────────────────────
let HISTORY = {};
fetch('./js/chicago-history.json').then(r => r.json()).then(d => { HISTORY = d; }).catch(() => {});

// ── Artist context ─────────────────────────────────────────────────
let ARTIST_CONTEXT = {};
fetch('./js/artist-context.json').then(r => r.json()).then(d => { ARTIST_CONTEXT = d; }).catch(() => {});

// ── Chicago community area → chibarproject neighborhood mapping ────
// ── Venue neighborhood data ────────────────────────────────────────
let CHIBAR = {};
let CHIBAR_OVERRIDES = {};
Promise.all([
  fetch('./js/chibar-venues.json').then(r => r.json()).catch(() => ({})),
  fetch('./js/venue-overrides.json').then(r => r.json()).catch(() => ({})),
]).then(([chibar, overrides]) => {
  // Exclude non-neighborhood buckets from scraped data
  const SKIP = new Set(['Gone But Not Forgotten', 'South Side', 'Suburbs', 'Beyond']);
  CHIBAR = Object.fromEntries(Object.entries(chibar).filter(([, v]) => !SKIP.has(v.neighborhood)));
  CHIBAR_OVERRIDES = overrides;
});

function normalizeVenueName(name) {
  return (name || '').toLowerCase()
    .replace(/^the\s+/, '')
    .replace(/['''".,:;!&\-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getVenueNeighborhood(venueName) {
  const key = normalizeVenueName(venueName);
  if (!key) return null;
  // Hand-curated overrides take precedence
  if (CHIBAR_OVERRIDES[key]) return CHIBAR_OVERRIDES[key].neighborhood;
  // Exact match in scraped data
  if (CHIBAR[key]) return CHIBAR[key].neighborhood;
  // Starts-with fuzzy match (handles "Schubas" → "Schubas Tavern")
  if (key.length >= 5) {
    for (const [k, v] of Object.entries(CHIBAR_OVERRIDES)) {
      if (k.startsWith(key) || key.startsWith(k)) return v.neighborhood;
    }
    for (const [k, v] of Object.entries(CHIBAR)) {
      if (k.startsWith(key) || key.startsWith(k)) return v.neighborhood;
    }
  }
  return null;
}

// ── State ──────────────────────────────────────────────────────────
const state = {
  collectionId: localStorage.getItem('collectionId') || DEFAULT_COLLECTION,
  index:        null,   // full item array loaded once
  mode:         'discover',  // 'discover'|'artists'|'favorites'
  prevMode:     'discover',
  inConcert:    false,
  inFiltered:   false,   // drilling into a filtered list from Discover
  sort:         'date desc',
  displayPage:  1,
  searching:    false,
  searchQuery:  '',
  selectedArtist:     null,   // { name, docs[] } or null = all
  artistLetterFilter:     null,   // 'A'–'Z' or null = all
  artistDiscoverOpen:     false,
  artistDiscoverEra:      null,   // 5-yr start or null
  artistDiscoverShowBin:  null,   // bin min (1,2,5,10,20) or null
  venueLetterFilter:         null,   // 'A'–'Z' or null = all
  venueDiscoverOpen:         false,
  venueDiscoverNeighborhood: null,   // neighborhood filter in venue tab
  venueDiscoverEra:          null,   // 5-yr era start (e.g. 1990) filter in venue tab
  favLetterFilter:           null,   // 'A'–'Z' or null = all
  nbhdEraNeighborhood:       null,   // persisted neighborhood selection in Discover era strip
  nbhdEraYear:               null,   // persisted year selection in Discover era strip
  selectedFavArtist: null,  // artist name string
  selectedYear:      null,   // year string e.g. "1995"
  yearEraFilter:     null,   // 5-yr range start e.g. 1990, or null = all
  yearDiscoverOpen:  false,
  yearMonthFilter:   null,   // 1-12 or null
  yearDayFilter:     null,   // 1-31 or null
  yearDowFilter:     null,   // 0-6 (Sun=0) or null
  favDiscoverOpen:         false,
  favDiscoverShowBin:      null,   // bin min (1,2,3,4,5,10) or null
  favDiscoverEra:          null,   // 5-yr era start or null
  favDiscoverNeighborhood: null,   // neighborhood string or null
  selectedVenue:    null,   // venue string
  currentConcert:   null,
};

const PAGE_SIZE = 50;

const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DOW_LABELS   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const DOW_FULL     = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

function dateParts(dateStr) {
  const s = (dateStr || '').slice(0, 10);
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return null;
  return { y, m, d, dow: new Date(y, m - 1, d).getDay() };
}

const SHOW_BINS = [
  { min: 1,  max: 1,  label: '1' },
  { min: 2,  max: 2,  label: '2' },
  { min: 3,  max: 3,  label: '3' },
  { min: 4,  max: 4,  label: '4' },
  { min: 5,  max: 9,  label: '5–9' },
  { min: 10, max: 19, label: '10–19' },
];

// ── DOM refs ───────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const el = {
  backBtn:        $('back-btn'),
  helpBtn:        $('help-btn'),
  helpSheet:      $('help-sheet'),
  helpClose:      $('help-close'),
  settingsBtn:    $('settings-btn'),
  searchInput:    $('search-input'),
  searchClear:    $('search-clear'),
  searchHistory:  $('search-history'),
  modeBar:        $('mode-bar'),
  sortBar:        $('sort-bar'),
  statBanner:     $('stat-banner'),
  main:           $('main'),
  viewLibrary:    $('view-library'),
  viewArtists:    $('view-artists'),
  viewFavorites:  $('view-favorites'),
  favArtistList:  $('fav-artist-list'),
  favConcerts:    $('fav-concerts'),
  viewConcert:    $('view-concert'),
  concertList:    $('concert-list'),
  loadMore:       $('load-more'),
  artistDiscoverSection: $('artist-discover-section'),
  artistDiscoverToggle:  $('artist-discover-toggle'),
  artistEraPills:        $('artist-era-pills'),
  artistShowPills:       $('artist-show-pills'),
  artistAlphaBar: $('artist-alpha-bar'),
  venueAlphaBar:        $('venue-alpha-bar'),
  venueDiscoverSection: $('venue-discover-section'),
  venueDiscoverToggle:  $('venue-discover-toggle'),
  venueNbhdPills:       $('venue-nbhd-pills'),
  venueEraPills:        $('venue-era-pills'),
  favAlphaBar:         $('fav-alpha-bar'),
  favDiscoverSection:  $('fav-discover-section'),
  favDiscoverToggle:   $('fav-discover-toggle'),
  favShowPills:        $('fav-show-pills'),
  favEraPills:         $('fav-era-pills'),
  favNbhdPills:        $('fav-nbhd-pills'),
  archiveBtn:          $('archive-btn'),
  archiveSheet:        $('archive-sheet'),
  archiveClose:        $('archive-close'),
  archiveBody:         $('archive-body'),
  artistList:     $('artist-list'),
  artistConcerts: $('artist-concerts'),
  viewDiscover:       $('view-discover'),
  viewYear:           $('view-year'),
  yearEraBar:         $('year-era-bar'),
  yearDiscoverSection: $('year-discover-section'),
  yearDiscoverToggle:  $('year-discover-toggle'),
  yearMonthPills:      $('year-month-pills'),
  yearDayPills:        $('year-day-pills'),
  yearDowPills:        $('year-dow-pills'),
  yearList:           $('year-list'),
  yearConcerts:       $('year-concerts'),
  viewVenue:          $('view-venue'),
  venueList:          $('venue-list'),
  venueConcerts:      $('venue-concerts'),
  viewFiltered:       $('view-filtered'),
  filteredList:       $('filtered-list'),
  trackActionSheet:   $('track-action-sheet'),
  trackActionTitle:   $('track-action-title'),
  trackActionPlay:    $('track-action-play'),
  trackActionQueue:   $('track-action-queue'),
  trackActionArtist:  $('track-action-artist'),
  trackActionCancel:  $('track-action-cancel'),
  nowBar:         $('now-playing-bar'),
  barArt:         $('bar-art'),
  barTitle:       $('bar-title'),
  barArtist:      $('bar-artist'),
  barDiscover:    $('bar-discover'),
  barPlay:        $('bar-play'),
  barPrev:        $('bar-prev'),
  barNext:        $('bar-next'),
  barProgress:    $('bar-progress'),
  barFill:        $('bar-progress-fill'),
  barElapsed:     $('bar-elapsed'),
  barRemaining:   $('bar-remaining'),
  barInfo:        $('bar-info'),
  barQueue:       $('bar-queue'),
  queueSheet:     $('queue-sheet'),
  queueList:      $('queue-list'),
  queueClear:       $('queue-clear'),
  queueClose:     $('queue-close'),
  settingsSheet:  $('settings-sheet'),
  settingsClose:  $('settings-close'),
  collectionInput: $('collection-input'),
  settingsSave:   $('settings-save'),
  favsExport:     $('favs-export'),
  favsExportJson: $('favs-export-json'),
  favsExportCsv:  $('favs-export-csv'),
  favsImportInput: $('favs-import-input'),
  favsImport:     $('favs-import'),
  queueItemSheet:  $('queue-item-sheet'),
  queueItemTitle:  $('queue-item-title'),
  queueItemShow:   $('queue-item-show'),
  queueItemArtist: $('queue-item-artist'),
  queueItemRemove: $('queue-item-remove'),
  queueItemCancel: $('queue-item-cancel'),
};

// ── Sorting ────────────────────────────────────────────────────────
const SORTS = [
  { label: 'Date',   value: 'date desc' },
  { label: 'Artist', value: 'creator asc' },
  { label: 'Title',  value: 'title asc' },
  { label: 'Year',   value: 'year desc' },
];

const dateAsc = docs => [...docs].sort((a, b) => (a.date || '').localeCompare(b.date || ''));

function sortDocs(docs) {
  const d = [...docs];
  switch (state.sort) {
    case 'date desc':   return d.sort((a,b) => (b.date||'').localeCompare(a.date||''));
    case 'creator asc': return d.sort((a,b) => (a.creator||'').localeCompare(b.creator||''));
    case 'title asc':   return d.sort((a,b) => (a.title||'').localeCompare(b.title||''));
    case 'year desc':   return d.sort((a,b) => (b.year||0) - (a.year||0));
    default: return d;
  }
}

function buildSortBar() {
  el.sortBar.innerHTML = '';
  SORTS.forEach(s => {
    const btn = document.createElement('button');
    btn.className = 'sort-btn' + (state.sort === s.value ? ' active' : '');
    btn.textContent = s.label;
    btn.addEventListener('click', () => {
      if (state.sort === s.value) return;
      state.sort = s.value;
      state.displayPage = 1;
      buildSortBar();
      renderLibrary();
    });
    el.sortBar.appendChild(btn);
  });
}

// ── View management ────────────────────────────────────────────────
function showView(name) {
  el.viewLibrary.style.display   = name === 'library'   ? 'block' : 'none';
  el.viewArtists.style.display   = name === 'artists'   ? 'flex'  : 'none';
  el.viewDiscover.style.display  = name === 'discover'  ? 'block' : 'none';
  el.viewYear.style.display      = name === 'year'      ? 'flex'  : 'none';
  el.viewVenue.style.display     = name === 'venue'     ? 'flex'  : 'none';
  el.viewFiltered.style.display  = name === 'filtered'  ? 'block' : 'none';
  el.viewFavorites.style.display = name === 'favorites' ? 'flex'  : 'none';
  el.viewConcert.style.display   = name === 'concert'   ? 'block' : 'none';
}

function setMode(mode) {
  state.mode = mode;
  state.inConcert = false;

  // Header
  el.backBtn.classList.remove('visible');

  // Mode bar tabs
  el.modeBar.classList.remove('hidden');
  el.modeBar.querySelectorAll('.mode-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });

  // Sort bar — only in library mode (and not searching)
  el.sortBar.classList.toggle('hidden', mode !== 'library');

  state.searching = false;
  state.searchQuery = '';
  el.searchInput.value = '';
  if (mode !== 'artists') {
    state.artistLetterFilter = null;
    state.artistDiscoverOpen = false;
    state.artistDiscoverEra = null;
    state.artistDiscoverShowBin = null;
  }
  if (mode !== 'venue') {
    state.venueLetterFilter = null;
    state.venueDiscoverOpen = false;
    state.venueDiscoverNeighborhood = null;
    state.venueDiscoverEra = null;
  }
  if (mode !== 'year') {
    state.yearEraFilter = null;
    state.yearDiscoverOpen = false;
    state.yearMonthFilter = null;
    state.yearDayFilter = null;
    state.yearDowFilter = null;
  }
  if (mode !== 'favorites') {
    state.favLetterFilter        = null;
    state.favDiscoverOpen        = false;
    state.favDiscoverShowBin     = null;
    state.favDiscoverEra         = null;
    state.favDiscoverNeighborhood = null;
  }

  if (mode === 'library') {
    showView('library');
    if (state.index) renderLibrary();
  } else if (mode === 'artists') {
    showView('artists');
    if (state.index) renderArtistView();
  } else if (mode === 'discover') {
    showView('discover');
    if (state.index) renderDiscover();
  } else if (mode === 'year') {
    showView('year');
    if (state.index) renderYear();
  } else if (mode === 'venue') {
    showView('venue');
    if (state.index) renderVenue();
  } else if (mode === 'favorites') {
    showView('favorites');
    if (state.index) renderFavorites();
  }
  updateStatBanner();
}

function updateStatBanner() {
  const index = state.index;
  if (!index) { el.statBanner.style.display = 'none'; return; }
  el.statBanner.style.display = '';
  const { mode, searching, searchQuery, selectedArtist, selectedVenue, selectedYear, selectedFavArtist } = state;
  if (searching && searchQuery) {
    const count = filterIndex(searchQuery).length;
    el.statBanner.textContent = `${count.toLocaleString()} result${count !== 1 ? 's' : ''}`;
    return;
  }
  if (mode === 'artists') {
    if (selectedArtist) {
      const count = selectedArtist.docs.length;
      el.statBanner.textContent = `${count} show${count !== 1 ? 's' : ''} · ${selectedArtist.name}`;
    } else if (state.artistDiscoverEra !== null || state.artistDiscoverShowBin !== null) {
      let fg = groupByArtist(index);
      if (state.artistDiscoverEra !== null) {
        const s = state.artistDiscoverEra;
        fg = fg.filter(([, docs]) => docs.some(d => { const yr = parseInt((d.date||'').slice(0,4)); return yr >= s && yr < s + 5; }));
      }
      if (state.artistDiscoverShowBin !== null) {
        const bin = SHOW_BINS.find(b => b.min === state.artistDiscoverShowBin);
        if (bin) fg = fg.filter(([, docs]) => docs.length >= bin.min && (bin.max === null || docs.length <= bin.max));
      }
      if (state.artistLetterFilter) {
        const L = state.artistLetterFilter;
        fg = fg.filter(([name]) => name.replace(/^the\s+/i, '').charAt(0).toUpperCase() === L);
      }
      const ua = fg.length;
      const shows = fg.reduce((sum, [, docs]) => sum + docs.length, 0);
      const parts = [];
      if (state.artistDiscoverEra !== null) { const s = state.artistDiscoverEra; parts.push(`${s}-${String(s+4).slice(2)}`); }
      if (state.artistDiscoverShowBin !== null) { const bin = SHOW_BINS.find(b => b.min === state.artistDiscoverShowBin); if (bin) parts.push(`${bin.label} shows`); }
      el.statBanner.textContent = `${ua} artist${ua !== 1 ? 's' : ''} · ${shows} show${shows !== 1 ? 's' : ''} · ${parts.join(' · ')}`;
    } else if (state.artistLetterFilter) {
      const L = state.artistLetterFilter;
      const filtered = index.filter(d => (d.creator || '').replace(/^the\s+/i, '').charAt(0).toUpperCase() === L);
      const ua = new Set(filtered.map(d => d.creator).filter(Boolean)).size;
      el.statBanner.textContent = `${ua} artist${ua !== 1 ? 's' : ''} · ${filtered.length} show${filtered.length !== 1 ? 's' : ''} · ${L}`;
    } else {
      const uniqueArtists = new Set(index.map(d => d.creator).filter(Boolean)).size;
      el.statBanner.textContent = `${uniqueArtists} artists · ${index.length} shows`;
    }
    return;
  }
  if (mode === 'venue') {
    if (selectedVenue) {
      const docs = index.filter(d => extractVenueName(d) === selectedVenue);
      el.statBanner.textContent = `${docs.length} show${docs.length !== 1 ? 's' : ''} · ${selectedVenue}`;
    } else if (state.venueDiscoverNeighborhood || state.venueDiscoverEra !== null) {
      let fv = groupBy(index, d => extractVenueName(d) || '__none__').filter(([v]) => v !== '__none__');
      if (state.venueDiscoverNeighborhood) {
        fv = fv.filter(([v]) => getVenueNeighborhood(v) === state.venueDiscoverNeighborhood);
      }
      if (state.venueDiscoverEra !== null) {
        const s = state.venueDiscoverEra;
        fv = fv.map(([v, docs]) => [v, docs.filter(d => { const yr = parseInt((d.date||'').slice(0,4)); return yr >= s && yr < s + 5; })])
               .filter(([, docs]) => docs.length > 0);
      }
      if (state.venueLetterFilter) {
        const L = state.venueLetterFilter;
        fv = fv.filter(([v]) => v.replace(/^the\s+/i, '').charAt(0).toUpperCase() === L);
      }
      const uv = fv.length;
      const shows = fv.reduce((sum, [, docs]) => sum + docs.length, 0);
      let label = state.venueDiscoverNeighborhood || '';
      if (state.venueDiscoverEra !== null) {
        const s = state.venueDiscoverEra;
        label += (label ? ' · ' : '') + `${s}-${String(s + 4).slice(2)}`;
      }
      el.statBanner.textContent = `${uv} venue${uv !== 1 ? 's' : ''} · ${shows} show${shows !== 1 ? 's' : ''} · ${label}`;
    } else if (state.venueLetterFilter) {
      const L = state.venueLetterFilter;
      const filtered = index.filter(d => (extractVenueName(d) || '').replace(/^the\s+/i, '').charAt(0).toUpperCase() === L);
      const uv = new Set(filtered.map(d => extractVenueName(d)).filter(Boolean)).size;
      el.statBanner.textContent = `${uv} venue${uv !== 1 ? 's' : ''} · ${filtered.length} show${filtered.length !== 1 ? 's' : ''} · ${L}`;
    } else {
      const uniqueVenues = new Set(index.map(d => extractVenueName(d)).filter(Boolean)).size;
      el.statBanner.textContent = `${uniqueVenues} venues · ${index.length} shows`;
    }
    return;
  }
  if (mode === 'year') {
    const hasDiscover = state.yearMonthFilter !== null || state.yearDayFilter !== null || state.yearDowFilter !== null;
    // Build base docs applying era filter first
    let yearBase = index;
    if (state.yearEraFilter !== null) {
      const s = state.yearEraFilter;
      yearBase = yearBase.filter(d => { const yr = parseInt((d.date||'').slice(0,4)); return yr >= s && yr < s + 5; });
    }
    // Apply discover filters
    const yearFiltered = hasDiscover ? yearBase.filter(d => {
      const p = dateParts(d.date);
      if (!p) return false;
      if (state.yearMonthFilter !== null && p.m !== state.yearMonthFilter) return false;
      if (state.yearDayFilter   !== null && p.d !== state.yearDayFilter)   return false;
      if (state.yearDowFilter   !== null && p.dow !== state.yearDowFilter) return false;
      return true;
    }) : yearBase;
    // Label parts for discover filters
    const dParts = [];
    if (state.yearMonthFilter !== null) dParts.push(MONTH_LABELS[state.yearMonthFilter - 1]);
    if (state.yearDayFilter   !== null) dParts.push(String(state.yearDayFilter));
    if (state.yearDowFilter   !== null) dParts.push(DOW_LABELS[state.yearDowFilter]);
    if (selectedYear) {
      const docs = yearFiltered.filter(d => (d.date||'').slice(0,4) === selectedYear);
      const parts = [selectedYear, ...dParts];
      el.statBanner.textContent = `${docs.length} show${docs.length !== 1 ? 's' : ''} · ${parts.join(' · ')}`;
    } else if (state.yearEraFilter !== null || hasDiscover) {
      const uniqueYears = new Set(yearFiltered.map(d => (d.date||'').slice(0,4)).filter(Boolean)).size;
      const eraPart = state.yearEraFilter !== null ? `${state.yearEraFilter}–${state.yearEraFilter + 4}` : null;
      const parts = [eraPart, ...dParts].filter(Boolean);
      el.statBanner.textContent = `${yearFiltered.length} show${yearFiltered.length !== 1 ? 's' : ''} · ${uniqueYears} year${uniqueYears !== 1 ? 's' : ''}${parts.length ? ' · ' + parts.join(' · ') : ''}`;
    } else {
      const uniqueYears = new Set(index.map(d => (d.date || '').slice(0, 4)).filter(Boolean)).size;
      el.statBanner.textContent = `${uniqueYears} years · ${index.length} shows`;
    }
    return;
  }
  if (mode === 'favorites') {
    const ids = new Set(getFavIds());
    let favDocs = index.filter(d => ids.has(d.identifier));
    const hasDiscover = state.favDiscoverShowBin !== null || state.favDiscoverEra !== null || state.favDiscoverNeighborhood;
    if (selectedFavArtist) {
      let base = favDocs;
      if (state.favDiscoverEra !== null) { const s = state.favDiscoverEra; base = base.filter(d => { const yr = parseInt((d.date||'').slice(0,4)); return yr >= s && yr < s + 5; }); }
      if (state.favDiscoverNeighborhood) { base = base.filter(d => { const v = extractVenueName(d); return v && getVenueNeighborhood(v) === state.favDiscoverNeighborhood; }); }
      const count = base.filter(d => d.creator === selectedFavArtist).length;
      el.statBanner.textContent = `${count} show${count !== 1 ? 's' : ''} · ${selectedFavArtist}`;
    } else if (hasDiscover) {
      if (state.favDiscoverEra !== null) { const s = state.favDiscoverEra; favDocs = favDocs.filter(d => { const yr = parseInt((d.date||'').slice(0,4)); return yr >= s && yr < s + 5; }); }
      if (state.favDiscoverNeighborhood) { favDocs = favDocs.filter(d => { const v = extractVenueName(d); return v && getVenueNeighborhood(v) === state.favDiscoverNeighborhood; }); }
      let groups = groupByArtist(favDocs);
      if (state.favDiscoverShowBin !== null) { const bin = SHOW_BINS.find(b => b.min === state.favDiscoverShowBin); if (bin) groups = groups.filter(([, docs]) => docs.length >= bin.min && (bin.max === null || docs.length <= bin.max)); }
      const displayDocs = groups.flatMap(([, docs]) => docs);
      const ua = groups.length;
      const parts = [];
      if (state.favDiscoverEra !== null) { const s = state.favDiscoverEra; parts.push(`${s}-${String(s+4).slice(2)}`); }
      if (state.favDiscoverNeighborhood) parts.push(state.favDiscoverNeighborhood);
      if (state.favDiscoverShowBin !== null) { const bin = SHOW_BINS.find(b => b.min === state.favDiscoverShowBin); if (bin) parts.push(`${bin.label} shows`); }
      el.statBanner.textContent = `${ua} artist${ua !== 1 ? 's' : ''} · ${displayDocs.length} show${displayDocs.length !== 1 ? 's' : ''}${parts.length ? ' · ' + parts.join(' · ') : ''}`;
    } else if (state.favLetterFilter) {
      const L = state.favLetterFilter;
      const filtered = favDocs.filter(d => (d.creator || '').replace(/^the\s+/i, '').charAt(0).toUpperCase() === L);
      const ua = new Set(filtered.map(d => d.creator).filter(Boolean)).size;
      el.statBanner.textContent = `${ua} artist${ua !== 1 ? 's' : ''} · ${filtered.length} show${filtered.length !== 1 ? 's' : ''} · ${L}`;
    } else {
      const ua = new Set(favDocs.map(d => d.creator).filter(Boolean)).size;
      const uv = new Set(favDocs.map(d => extractVenueName(d)).filter(Boolean)).size;
      const uy = new Set(favDocs.map(d => (d.date || '').slice(0, 4)).filter(Boolean)).size;
      el.statBanner.textContent = `${favDocs.length} show${favDocs.length !== 1 ? 's' : ''} · ${ua} artist${ua !== 1 ? 's' : ''} · ${uv} venue${uv !== 1 ? 's' : ''} · ${uy} year${uy !== 1 ? 's' : ''}`;
    }
    return;
  }
  const uniqueArtists = new Set(index.map(d => d.creator).filter(Boolean)).size;
  const uniqueVenues  = new Set(index.map(d => extractVenueName(d)).filter(Boolean)).size;
  const uniqueYears   = new Set(index.map(d => (d.date || '').slice(0, 4)).filter(Boolean)).size;
  el.statBanner.textContent = `${index.length.toLocaleString()} shows · ${uniqueArtists} artists · ${uniqueVenues} venues · ${uniqueYears} years`;
}

function collectionName() {
  if (state.collectionId === DEFAULT_COLLECTION) return 'No Tape Left Behind Collection';
  const pretty = state.collectionId.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  return pretty + ' Collection';
}

async function updatePageTitle() {
  if (state.collectionId === DEFAULT_COLLECTION) {
    document.title = 'No Tape Left Behind Collection';
    return;
  }
  try {
    const meta = await getItemMetadata(state.collectionId);
    let name = meta.metadata?.title;
    if (name) {
      if (!name.toLowerCase().includes('collection')) name += ' Collection';
    } else {
      name = collectionName();
    }
    document.title = name;
  } catch {
    document.title = collectionName();
  }
}

// ── Index loading ──────────────────────────────────────────────────
async function loadIndex() {
  el.viewDiscover.innerHTML = '<div class="spinner"></div>';
  try {
    state.index = await loadFullIndex(state.collectionId);
    state.displayPage = 1;
    const uniqueArtistCount = new Set(state.index.map(d => d.creator).filter(Boolean)).size;
    const discoverBtn = el.modeBar.querySelector('[data-mode="discover"]');
    if (discoverBtn) {
      const hide = uniqueArtistCount < 5;
      discoverBtn.style.display = hide ? 'none' : '';
      if (hide && state.mode === 'discover') setMode('artists');
    }
    updateStatBanner();
    updatePageTitle();
    if (state.mode === 'discover') renderDiscover();
    else if (state.mode === 'artists') renderArtistView();
    else if (state.mode === 'year') renderYear();
    else if (state.mode === 'venue') renderVenue();
    else if (state.mode === 'favorites') renderFavorites();
  } catch (err) {
    el.viewDiscover.innerHTML = `<p class="error-msg">Failed to load: ${err.message}</p>`;
  }
}

// ── Library view ───────────────────────────────────────────────────
function renderLibrary() {
  const source = state.searching && state.searchQuery
    ? filterIndex(state.searchQuery)
    : state.index;

  const sorted  = sortDocs(source);
  const visible = sorted.slice(0, state.displayPage * PAGE_SIZE);
  const remaining = sorted.length - visible.length;

  el.concertList.innerHTML = '';

  if (!visible.length) {
    el.concertList.innerHTML = `<li class="empty-msg">${
      state.searching ? 'No results.' : 'No concerts found.'
    }</li>`;
    el.loadMore.style.display = 'none';
    return;
  }

  appendConcertRows(el.concertList, visible, doc => openConcert(doc));

  if (remaining > 0) {
    el.loadMore.style.display = 'block';
    el.loadMore.disabled = false;
    el.loadMore.textContent = `Load more (${remaining} remaining)`;
  } else {
    el.loadMore.style.display = 'none';
  }
}

function appendConcertRows(listEl, docs, onTap) {
  const frag = document.createDocumentFragment();
  docs.forEach(doc => {
    const li = document.createElement('li');
    li.className = 'concert-item';
    const venueStr = extractVenueName(doc) || '';
    li.innerHTML = `
      <div class="concert-info">
        <div class="concert-date">${formatDate(doc.date)}</div>
        <div class="concert-title">${esc(doc.creator || doc.title || '')}</div>
        <div class="concert-creator">${esc(venueStr)}</div>
      </div>
      <button class="concert-fav${isFav(doc.identifier) ? ' active' : ''}"
              data-id="${esc(doc.identifier)}" title="Favorite">♥</button>
      <span class="concert-chevron">${svgChevron()}</span>
    `;
    li.querySelector('.concert-fav').addEventListener('click', e => {
      e.stopPropagation();
      const active = toggleFav(doc.identifier);
      e.currentTarget.classList.toggle('active', active);
    });
    li.addEventListener('click', () => onTap(doc));
    frag.appendChild(li);
  });
  listEl.appendChild(frag);
}

// ── Search ─────────────────────────────────────────────────────────
let searchTimer = null;

const SEARCH_PLACEHOLDERS = {
  library:   'Artists, titles, dates…',
  artists:   'Filter artists…',
  discover:  'Search all shows…',
  venue:     'Filter venues…',
  year:      'Filter years…',
  favorites: 'Filter artists…',
};

function openSearch() {
  state.searching = true;
  state.searchQuery = '';
  state.displayPage = 1;
  el.searchInput.placeholder = SEARCH_PLACEHOLDERS[state.mode] || 'Search…';
  renderForSearch();
}

function renderForSearch() {
  const mode = state.mode;
  const q    = state.searchQuery;
  if (mode === 'library') {
    showView('library');
    renderLibrary();
  } else if (mode === 'artists') {
    showView('artists');
    renderArtistView();
  } else if (mode === 'venue') {
    showView('venue');
    renderVenue();
  } else if (mode === 'year') {
    showView('year');
    renderYear();
  } else if (mode === 'favorites') {
    showView('favorites');
    renderFavorites();
  } else if (mode === 'discover') {
    showView('discover');
    if (q) {
      const results = sortDocs(filterIndex(q));
      el.viewDiscover.innerHTML = '';
      if (!results.length) {
        el.viewDiscover.innerHTML = '<div class="empty-msg">No shows found.</div>';
      } else {
        const ul = document.createElement('ul');
        ul.className = 'concert-list';
        el.viewDiscover.appendChild(ul);
        appendConcertRows(ul, results, doc => openConcert(doc));
      }
    } else {
      renderDiscover();
    }
  }
  updateStatBanner();
}

function closeSearch() {
  clearTimeout(searchTimer);
  state.searching = false;
  state.searchQuery = '';
  el.searchInput.value = '';
  el.searchClear.style.display = 'none';
  hideSearchHistory();
  setMode(state.mode);
}

function onSearchInput() {
  const val = el.searchInput.value;
  el.searchClear.style.display = val ? '' : 'none';
  if (!val) { showSearchHistory(); return; }
  hideSearchHistory();
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.searchQuery = val.trim();
    state.searching   = state.searchQuery.length > 0;
    state.displayPage = 1;
    if (state.searching) {
      renderForSearch();
    } else {
      setMode(state.mode);
    }
  }, 250);
}

function filterDocs(docs, query) {
  const q = query.toLowerCase();
  return docs.filter(doc =>
    (doc.creator || '').toLowerCase().includes(q) ||
    (doc.title   || '').toLowerCase().includes(q) ||
    (doc.date    || '').includes(q)
  );
}

function filterIndex(query) {
  return filterDocs(state.index, query);
}

// ── Search history ─────────────────────────────────────────────────
const SEARCH_HISTORY_KEY = 'searchHistory';

function getSearchHistory() {
  try { return JSON.parse(localStorage.getItem(SEARCH_HISTORY_KEY) || '[]'); }
  catch { return []; }
}

function addToSearchHistory(q) {
  if (!q || q.length < 2) return;
  let h = getSearchHistory().filter(s => s !== q);
  h.unshift(q);
  localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(h.slice(0, 10)));
}

function showSearchHistory() {
  const h = getSearchHistory();
  if (!h.length) { el.searchHistory.style.display = 'none'; return; }
  el.searchHistory.innerHTML = '';
  h.forEach(q => {
    const item = document.createElement('div');
    item.className = 'search-history-item';
    item.innerHTML = `<span class="search-history-icon">↩</span><span>${esc(q)}</span>`;
    item.addEventListener('click', () => {
      el.searchInput.value = q;
      el.searchClear.style.display = '';
      hideSearchHistory();
      state.searchQuery = q;
      state.searching = true;
      state.displayPage = 1;
      renderForSearch();
      updateStatBanner();
    });
    el.searchHistory.appendChild(item);
  });
  const clearBtn = document.createElement('div');
  clearBtn.className = 'search-history-clear';
  clearBtn.textContent = 'Clear recent searches';
  clearBtn.addEventListener('click', () => {
    localStorage.removeItem(SEARCH_HISTORY_KEY);
    hideSearchHistory();
  });
  el.searchHistory.appendChild(clearBtn);
  el.searchHistory.style.display = 'block';
}

function hideSearchHistory() {
  el.searchHistory.style.display = 'none';
}

// ── Artist column view ─────────────────────────────────────────────
function renderArtistView() {
  const allGroups = groupByArtist(state.index);
  let groups = allGroups;

  if (state.searching && state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    groups = groups.filter(([name]) => name.toLowerCase().includes(q));
    if (state.selectedArtist && !groups.find(([name]) => name === state.selectedArtist.name)) {
      state.selectedArtist = null;
    }
  }

  // Discover era filter
  if (state.artistDiscoverEra !== null) {
    const s = state.artistDiscoverEra;
    groups = groups.filter(([, docs]) =>
      docs.some(d => { const yr = parseInt((d.date||'').slice(0,4)); return yr >= s && yr < s + 5; })
    );
    if (state.selectedArtist && !groups.find(([name]) => name === state.selectedArtist.name)) state.selectedArtist = null;
  }

  // Discover show count filter
  if (state.artistDiscoverShowBin !== null) {
    const bin = SHOW_BINS.find(b => b.min === state.artistDiscoverShowBin);
    if (bin) {
      groups = groups.filter(([, docs]) => docs.length >= bin.min && (bin.max === null || docs.length <= bin.max));
      if (state.selectedArtist && !groups.find(([name]) => name === state.selectedArtist.name)) state.selectedArtist = null;
    }
  }

  if (state.artistLetterFilter) {
    const letter = state.artistLetterFilter;
    groups = groups.filter(([name]) =>
      name.replace(/^the\s+/i, '').charAt(0).toUpperCase() === letter
    );
    if (state.selectedArtist && !groups.find(([name]) => name === state.selectedArtist.name)) {
      state.selectedArtist = null;
    }
  }

  renderAlphaPills(allGroups);
  renderArtistDiscoverTray(allGroups);

  const totalVisible = groups.reduce((sum, [, docs]) => sum + docs.length, 0);

  // Left column: artist list
  el.artistList.innerHTML = '';
  const frag = document.createDocumentFragment();

  const allArtistItem = makeArtistItem('All', totalVisible, state.selectedArtist === null);
  allArtistItem.addEventListener('click', () => selectArtist(null));
  frag.appendChild(allArtistItem);

  groups.forEach(([name, docs]) => {
    const item = makeArtistItem(name, docs.length, state.selectedArtist?.name === name);
    const years = docs.map(d => (d.date || '').slice(0, 4)).filter(Boolean).sort();
    if (years.length) {
      item.querySelector('.artist-count').textContent =
        `${years[0]}${years[0] !== years[years.length - 1] ? ` – ${years[years.length - 1]}` : ''} • ${docs.length} show${docs.length !== 1 ? 's' : ''}`;
    }
    item.addEventListener('click', () => selectArtist({ name, docs }));
    frag.appendChild(item);
  });
  el.artistList.appendChild(frag);

  // Right column
  renderArtistConcerts(groups.flatMap(([, docs]) => docs));
}

function renderAlphaPills(allGroups) {
  const letters = new Set();
  allGroups.forEach(([name]) => {
    const ch = name.replace(/^the\s+/i, '').charAt(0).toUpperCase();
    if (ch >= 'A' && ch <= 'Z') letters.add(ch);
  });
  const sorted = [...letters].sort();

  el.artistAlphaBar.innerHTML = '';
  const frag = document.createDocumentFragment();

  const allPill = makeAlphaPill('All', state.artistLetterFilter === null);
  allPill.addEventListener('click', () => {
    state.artistLetterFilter = null;
    state.selectedArtist = null;
    renderArtistView();
    updateStatBanner();
  });
  frag.appendChild(allPill);

  sorted.forEach(letter => {
    const pill = makeAlphaPill(letter, state.artistLetterFilter === letter);
    pill.addEventListener('click', () => {
      state.artistLetterFilter = letter;
      state.selectedArtist = null;
      renderArtistView();
      updateStatBanner();
    });
    frag.appendChild(pill);
  });

  el.artistAlphaBar.appendChild(frag);
}

function renderArtistDiscoverTray(allGroups) {
  el.artistDiscoverSection.classList.toggle('open', state.artistDiscoverOpen);

  // Show count bin pills (row 1) — only bins with at least one artist
  el.artistShowPills.innerHTML = '';
  const showFrag = document.createDocumentFragment();
  const allShows = makeAlphaPill('All', state.artistDiscoverShowBin === null);
  allShows.addEventListener('click', () => {
    state.artistDiscoverShowBin = null;
    state.selectedArtist = null;
    renderArtistView(); updateStatBanner();
  });
  showFrag.appendChild(allShows);
  SHOW_BINS.forEach(bin => {
    if (!allGroups.some(([, docs]) => docs.length >= bin.min && (bin.max === null || docs.length <= bin.max))) return;
    const pill = makeAlphaPill(bin.label, state.artistDiscoverShowBin === bin.min);
    pill.addEventListener('click', () => {
      state.artistDiscoverShowBin = bin.min;
      state.selectedArtist = null;
      renderArtistView(); updateStatBanner();
    });
    showFrag.appendChild(pill);
  });
  el.artistShowPills.appendChild(showFrag);

  // Era pills (row 2)
  const presentYears = new Set(
    allGroups.flatMap(([, docs]) => docs.map(d => parseInt((d.date||'').slice(0,4)))).filter(n => !isNaN(n))
  );
  const eraStarts = [...new Set([...presentYears].map(y => Math.floor(y / 5) * 5))].sort((a, b) => a - b);

  el.artistEraPills.innerHTML = '';
  const eraFrag = document.createDocumentFragment();
  const allEra = makeAlphaPill('All', state.artistDiscoverEra === null);
  allEra.addEventListener('click', () => {
    state.artistDiscoverEra = null;
    state.selectedArtist = null;
    renderArtistView(); updateStatBanner();
  });
  eraFrag.appendChild(allEra);
  eraStarts.forEach(start => {
    const label = `${start}-${String(start + 4).slice(2)}`;
    const pill = makeAlphaPill(label, state.artistDiscoverEra === start);
    pill.addEventListener('click', () => {
      state.artistDiscoverEra = start;
      state.selectedArtist = null;
      renderArtistView(); updateStatBanner();
    });
    eraFrag.appendChild(pill);
  });
  el.artistEraPills.appendChild(eraFrag);
}

function makeAlphaPill(label, active) {
  const btn = document.createElement('button');
  btn.className = 'alpha-pill' + (active ? ' active' : '');
  btn.textContent = label;
  return btn;
}

function makeArtistItem(name, count, selected) {
  const li = document.createElement('li');
  li.className = 'artist-item' + (selected ? ' selected' : '');
  li.innerHTML = `
    <div class="artist-name">${esc(name)}</div>
    <div class="artist-count">${count} show${count !== 1 ? 's' : ''}</div>
  `;
  return li;
}

function selectArtist(artistObj) {
  state.selectedArtist = artistObj;
  // Update selected highlight
  el.artistList.querySelectorAll('.artist-item').forEach((item, i) => {
    const isAll = i === 0;
    item.classList.toggle('selected', artistObj === null ? isAll : item.querySelector('.artist-name').textContent === artistObj.name);
  });
  renderArtistConcerts();
  updateStatBanner();
}

function renderArtistConcerts(fallbackDocs) {
  const docs = state.selectedArtist
    ? dateAsc(state.selectedArtist.docs)
    : dateAsc(fallbackDocs || state.index);

  el.artistConcerts.innerHTML = '';
  if (!docs.length) {
    el.artistConcerts.innerHTML = '<li class="empty-msg">No concerts.</li>';
    return;
  }

  appendConcertRows(el.artistConcerts, docs, doc => openConcert(doc));
}

function groupByArtist(docs) {
  const map = new Map();
  docs.forEach(doc => {
    const name = doc.creator || '(Unknown)';
    if (!map.has(name)) map.set(name, []);
    map.get(name).push(doc);
  });
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

// ── Favorites view ─────────────────────────────────────────────────
function renderFavorites() {
  const ids = new Set(getFavIds());
  const favDocs = state.index.filter(d => ids.has(d.identifier));

  // Apply discover filters
  let filteredFavDocs = favDocs;
  if (state.favDiscoverEra !== null) {
    const s = state.favDiscoverEra;
    filteredFavDocs = filteredFavDocs.filter(d => { const yr = parseInt((d.date||'').slice(0,4)); return yr >= s && yr < s + 5; });
  }
  if (state.favDiscoverNeighborhood) {
    filteredFavDocs = filteredFavDocs.filter(d => { const v = extractVenueName(d); return v && getVenueNeighborhood(v) === state.favDiscoverNeighborhood; });
  }

  let allGroups = groupByArtist(filteredFavDocs).sort((a, b) => a[0].localeCompare(b[0]));

  if (state.favDiscoverShowBin !== null) {
    const bin = SHOW_BINS.find(b => b.min === state.favDiscoverShowBin);
    if (bin) {
      allGroups = allGroups.filter(([, docs]) => docs.length >= bin.min && (bin.max === null || docs.length <= bin.max));
      if (state.selectedFavArtist && !allGroups.find(([name]) => name === state.selectedFavArtist)) state.selectedFavArtist = null;
    }
  }

  let groups = allGroups;

  if (state.searching && state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    groups = groups.filter(([name]) => name.toLowerCase().includes(q));
    if (state.selectedFavArtist && !groups.find(([name]) => name === state.selectedFavArtist)) {
      state.selectedFavArtist = null;
    }
  }

  if (state.favLetterFilter) {
    const letter = state.favLetterFilter;
    groups = groups.filter(([name]) =>
      name.replace(/^the\s+/i, '').charAt(0).toUpperCase() === letter
    );
    if (state.selectedFavArtist && !groups.find(([name]) => name === state.selectedFavArtist)) {
      state.selectedFavArtist = null;
    }
  }

  renderFavDiscoverTray(favDocs);

  // Only show pill bar when collection is large enough to warrant it
  if (allGroups.length > 40) {
    renderFavAlphaPills(allGroups);
    el.favAlphaBar.style.display = '';
  } else {
    el.favAlphaBar.style.display = 'none';
    state.favLetterFilter = null;
  }

  const displayDocs = allGroups.flatMap(([, docs]) => docs);

  el.favArtistList.innerHTML = '';
  if (!groups.length) {
    el.favArtistList.innerHTML = `<li class="empty-msg">${
      state.searching && state.searchQuery ? 'No matches.' : 'No favorites yet.<br>Tap ♥ on any concert.'
    }</li>`;
    el.favConcerts.innerHTML = '';
    return;
  }

  const frag = document.createDocumentFragment();

  const allFavItem = makeArtistItem('All', displayDocs.length, state.selectedFavArtist === null);
  allFavItem.addEventListener('click', () => selectFavArtist(null, displayDocs));
  frag.appendChild(allFavItem);

  groups.forEach(([name, docs]) => {
    const item = makeArtistItem(name, docs.length, state.selectedFavArtist === name);
    item.addEventListener('click', () => selectFavArtist(name, docs));
    frag.appendChild(item);
  });
  el.favArtistList.appendChild(frag);

  if (state.selectedFavArtist) {
    const entry = groups.find(([n]) => n === state.selectedFavArtist);
    renderFavConcerts(dateAsc(entry?.[1] || []));
  } else {
    renderFavConcerts(dateAsc(displayDocs));
  }
}

function renderFavAlphaPills(allGroups) {
  const letters = new Set();
  allGroups.forEach(([name]) => {
    const ch = name.replace(/^the\s+/i, '').charAt(0).toUpperCase();
    if (ch >= 'A' && ch <= 'Z') letters.add(ch);
  });
  const sorted = [...letters].sort();

  el.favAlphaBar.innerHTML = '';
  const frag = document.createDocumentFragment();

  const allPill = makeAlphaPill('All', state.favLetterFilter === null);
  allPill.addEventListener('click', () => {
    state.favLetterFilter = null;
    state.selectedFavArtist = null;
    renderFavorites();
    updateStatBanner();
  });
  frag.appendChild(allPill);

  sorted.forEach(letter => {
    const pill = makeAlphaPill(letter, state.favLetterFilter === letter);
    pill.addEventListener('click', () => {
      state.favLetterFilter = letter;
      state.selectedFavArtist = null;
      renderFavorites();
      updateStatBanner();
    });
    frag.appendChild(pill);
  });

  el.favAlphaBar.appendChild(frag);
}

function selectFavArtist(name, docs) {
  state.selectedFavArtist = name;
  el.favArtistList.querySelectorAll('.artist-item').forEach((item, i) => {
    const isAll = i === 0;
    item.classList.toggle('selected', name === null ? isAll : item.querySelector('.artist-name').textContent === name);
  });
  renderFavConcerts(dateAsc(docs));
  updateStatBanner();
}

function renderFavConcerts(docs) {
  el.favConcerts.innerHTML = '';
  if (!docs.length) {
    el.favConcerts.innerHTML = '<li class="empty-msg">No concerts.</li>';
    return;
  }
  appendConcertRows(el.favConcerts, docs, doc => openConcert(doc));
}

function renderFavDiscoverTray(favDocs) {
  el.favDiscoverSection.classList.toggle('open', state.favDiscoverOpen);

  const allArtistGroups = groupByArtist(favDocs);

  // Row 1: Show count bins
  el.favShowPills.innerHTML = '';
  const showFrag = document.createDocumentFragment();
  const allShows = makeAlphaPill('All', state.favDiscoverShowBin === null);
  allShows.addEventListener('click', () => { state.favDiscoverShowBin = null; state.selectedFavArtist = null; renderFavorites(); updateStatBanner(); });
  showFrag.appendChild(allShows);
  SHOW_BINS.forEach(bin => {
    if (!allArtistGroups.some(([, docs]) => docs.length >= bin.min && (bin.max === null || docs.length <= bin.max))) return;
    const pill = makeAlphaPill(bin.label, state.favDiscoverShowBin === bin.min);
    pill.addEventListener('click', () => { state.favDiscoverShowBin = bin.min; state.selectedFavArtist = null; renderFavorites(); updateStatBanner(); });
    showFrag.appendChild(pill);
  });
  el.favShowPills.appendChild(showFrag);

  // Row 2: Era pills
  const presentYears = new Set(favDocs.map(d => parseInt((d.date||'').slice(0,4))).filter(n => !isNaN(n)));
  const eraStarts = [...new Set([...presentYears].map(y => Math.floor(y / 5) * 5))].sort((a, b) => a - b);
  el.favEraPills.innerHTML = '';
  const eraFrag = document.createDocumentFragment();
  const allEra = makeAlphaPill('All', state.favDiscoverEra === null);
  allEra.addEventListener('click', () => { state.favDiscoverEra = null; state.selectedFavArtist = null; renderFavorites(); updateStatBanner(); });
  eraFrag.appendChild(allEra);
  eraStarts.forEach(start => {
    const label = `${start}-${String(start + 4).slice(2)}`;
    const pill = makeAlphaPill(label, state.favDiscoverEra === start);
    pill.addEventListener('click', () => { state.favDiscoverEra = start; state.selectedFavArtist = null; renderFavorites(); updateStatBanner(); });
    eraFrag.appendChild(pill);
  });
  el.favEraPills.appendChild(eraFrag);

  // Row 3: Neighborhood pills
  const nbhdCounts = {};
  favDocs.forEach(d => { const v = extractVenueName(d); const n = v ? getVenueNeighborhood(v) : null; if (n) nbhdCounts[n] = (nbhdCounts[n]||0) + 1; });
  const neighborhoods = Object.keys(nbhdCounts).sort();
  el.favNbhdPills.innerHTML = '';
  const nbhdFrag = document.createDocumentFragment();
  const allNbhd = makeAlphaPill('All', !state.favDiscoverNeighborhood);
  allNbhd.addEventListener('click', () => { state.favDiscoverNeighborhood = null; state.selectedFavArtist = null; renderFavorites(); updateStatBanner(); });
  nbhdFrag.appendChild(allNbhd);
  neighborhoods.forEach(n => {
    const pill = makeAlphaPill(n, state.favDiscoverNeighborhood === n);
    pill.addEventListener('click', () => { state.favDiscoverNeighborhood = n; state.selectedFavArtist = null; renderFavorites(); updateStatBanner(); });
    nbhdFrag.appendChild(pill);
  });
  el.favNbhdPills.appendChild(nbhdFrag);
}

function buildArchivePortrait(favDocs) {
  // Top decade
  const decadeCounts = {};
  favDocs.forEach(d => { const yr = parseInt((d.date||'').slice(0,4)); if (!isNaN(yr)) { const dec = Math.floor(yr/10)*10; decadeCounts[dec] = (decadeCounts[dec]||0)+1; } });
  const topDecade = Object.entries(decadeCounts).sort((a,b)=>b[1]-a[1])[0];
  const decadeLabel = topDecade ? `${topDecade[0]}s` : null;

  // Top neighborhood
  const nbhdCounts = {};
  favDocs.forEach(d => { const v = extractVenueName(d); const n = v ? getVenueNeighborhood(v) : null; if (n) nbhdCounts[n] = (nbhdCounts[n]||0)+1; });
  const topNbhd = Object.entries(nbhdCounts).sort((a,b)=>b[1]-a[1])[0]?.[0] || null;

  // Top 2 venues
  const venueCounts = {};
  favDocs.forEach(d => { const v = extractVenueName(d); if (v) venueCounts[v] = (venueCounts[v]||0)+1; });
  const topVenues = Object.entries(venueCounts).sort((a,b)=>b[1]-a[1]).slice(0,2).map(([v])=>v);

  // Most common weekday
  const dowCounts = new Array(7).fill(0);
  favDocs.forEach(d => { const p = dateParts(d.date); if (p) dowCounts[p.dow]++; });
  const maxDow = Math.max(...dowCounts);
  const topDow = maxDow > 0 ? DOW_FULL[dowCounts.indexOf(maxDow)] : null;

  const locationParts = [decadeLabel, topNbhd].filter(Boolean).join(' ');
  const prefix = locationParts ? `Mostly ${locationParts}` : null;
  const venues = topVenues.length >= 2 ? `heavy on ${topVenues[0]} and ${topVenues[1]}`
               : topVenues.length === 1 ? `heavy on ${topVenues[0]}` : null;
  const day = topDow ? `${topDow} nights` : null;
  return [prefix, venues, day].filter(Boolean).join(', ') + '.';
}

function buildArchiveSheet(favDocs) {
  const body = el.archiveBody;
  body.innerHTML = '';
  const n = favDocs.length;

  const makeInfoBlock = () => {
    const block = document.createElement('div');
    block.className = 'archive-info-block';
    block.innerHTML = `
      <p>This page provides a summary of your favorite shows in the archive.</p>
      <p>As you explore the collection, tap ♥ to add a show to your Favs. With each new addition, you'll unlock features on this page — artist and venue word clouds, charts by era, an image gallery and more.</p>
    `;
    return block;
  };

  const makeGoFavsSticker = () => {
    const btn = document.createElement('button');
    btn.className = 'archive-info-go-btn';
    btn.textContent = 'Go to Favs →';
    btn.addEventListener('click', () => {
      el.archiveSheet.classList.remove('visible');
      setMode('favorites');
    });
    return btn;
  };

  // Empty state
  if (!n) {
    const empty = document.createElement('div');
    empty.className = 'archive-empty';
    empty.innerHTML = `
      <div class="archive-empty-icon">♥</div>
      <div class="archive-empty-title">No favorites yet</div>
    `;
    body.appendChild(empty);
    body.appendChild(makeInfoBlock());
    body.appendChild(makeGoFavsSticker());
    return;
  }

  // Precompute all counts up front (reused across thresholds)
  const artistCounts = {};
  favDocs.forEach(d => { if (d.creator) artistCounts[d.creator] = (artistCounts[d.creator]||0)+1; });
  const venueCounts = {};
  favDocs.forEach(d => { const v = extractVenueName(d); if (v) venueCounts[v] = (venueCounts[v]||0)+1; });
  const nbhdCounts = {};
  favDocs.forEach(d => { const v = extractVenueName(d); const nh = v ? getVenueNeighborhood(v) : null; if (nh) nbhdCounts[nh] = (nbhdCounts[nh]||0)+1; });
  const eraCounts = {};
  favDocs.forEach(d => { const yr = parseInt((d.date||'').slice(0,4)); if (!isNaN(yr)) { const era = Math.floor(yr/5)*5; eraCounts[era] = (eraCounts[era]||0)+1; } });
  const dowCounts = new Array(7).fill(0);
  favDocs.forEach(d => { const p = dateParts(d.date); if (p) dowCounts[p.dow]++; });

  // Stat header
  const ua = Object.keys(artistCounts).length;
  const uv = Object.keys(venueCounts).length;
  const uy = new Set(favDocs.map(d => (d.date||'').slice(0,4)).filter(Boolean)).size;
  const statsEl = document.createElement('div');
  statsEl.className = 'archive-stat-header';
  [{ value: n, label: 'Shows' }, { value: ua, label: 'Artists' }, { value: uv, label: 'Venues' }, { value: uy, label: 'Years' }].forEach(s => {
    const item = document.createElement('div');
    item.className = 'archive-stat-item';
    item.innerHTML = `<div class="archive-stat-value">${s.value}</div><div class="archive-stat-label">${s.label}</div>`;
    statsEl.appendChild(item);
  });

  // < 5: info block + sticker + stats + nudge only
  if (n < 5) {
    body.appendChild(makeInfoBlock());
    body.appendChild(makeGoFavsSticker());
    body.appendChild(statsEl);
    const need = 5 - n;
    const nudge = document.createElement('p');
    nudge.className = 'archive-nudge';
    nudge.textContent = `Save ${need} more show${need !== 1 ? 's' : ''} to start unlocking your archive — portrait, photo mosaic, and top charts.`;
    body.appendChild(nudge);
    return;
  }

  // 5+: stats → portrait → photo grid
  body.appendChild(statsEl);
  const portraitEl = document.createElement('p');
  portraitEl.className = 'archive-portrait';
  portraitEl.textContent = buildArchivePortrait(favDocs);
  body.appendChild(portraitEl);
  buildPhotoGrid(body, favDocs);

  // 5–19: simple ranked lists + nudge to unlock full viz
  if (n < 20) {
    const simpleList = (title, countObj, max = 5) => {
      const entries = Object.entries(countObj).sort((a,b)=>b[1]-a[1]).slice(0, max);
      if (!entries.length) return;
      const sec = document.createElement('div');
      sec.className = 'archive-section';
      const t = document.createElement('div');
      t.className = 'archive-section-title';
      t.textContent = title;
      sec.appendChild(t);
      const ul = document.createElement('ul');
      ul.className = 'archive-simple-list';
      entries.forEach(([name, count], i) => {
        const li = document.createElement('li');
        li.className = 'archive-simple-item';
        li.innerHTML = `<span class="archive-simple-rank">${i+1}</span><span class="archive-simple-name">${esc(name)}</span><span class="archive-simple-count">${count}</span>`;
        ul.appendChild(li);
      });
      sec.appendChild(ul);
      body.appendChild(sec);
    };
    simpleList('Top Artists', artistCounts);
    simpleList('Top Venues', venueCounts);
    if (Object.keys(nbhdCounts).length >= 2) simpleList('Neighborhoods', nbhdCounts);
    const need = 20 - n;
    const nudge = document.createElement('p');
    nudge.className = 'archive-nudge';
    nudge.textContent = `Save ${need} more show${need !== 1 ? 's' : ''} to unlock era charts, weeknight analysis, and artist clouds.`;
    body.appendChild(nudge);
    return;
  }

  // Full experience (20+): tag clouds + era chart + weekday chart
  // Order: Top Artists → Eras → Top Venues → Neighborhoods → Weeknights
  const makeTagCloud = (title, entries, maxItems = 30) => {
    const top = entries.slice(0, maxItems);
    if (!top.length) return;
    const maxC = top[0][1], minC = top[top.length - 1][1], range = maxC - minC || 1;
    const section = document.createElement('div');
    section.className = 'archive-section';
    const titleEl = document.createElement('div');
    titleEl.className = 'archive-section-title';
    titleEl.textContent = title;
    section.appendChild(titleEl);
    const cloud = document.createElement('div');
    cloud.className = 'archive-tag-cloud';
    [...top].sort(() => Math.random() - 0.5).forEach(([name, count]) => {
      const span = document.createElement('span');
      span.className = 'archive-cloud-tag';
      const t = (count - minC) / range;
      span.style.fontSize = `${Math.round(11 + t * 15)}px`;
      span.style.opacity = (0.5 + t * 0.5).toFixed(2);
      span.textContent = name;
      cloud.appendChild(span);
    });
    section.appendChild(cloud);
    body.appendChild(section);
  };

  makeTagCloud('Top Artists', Object.entries(artistCounts).sort((a,b)=>b[1]-a[1]));

  // Era horizontal bar chart — after Top Artists
  const eraEntries = Object.entries(eraCounts).sort((a,b)=>Number(a[0])-Number(b[0]));
  if (eraEntries.length > 1) {
    const maxC = Math.max(...eraEntries.map(([,c])=>c));
    const barH = 18, gap = 4, labelW = 56, chartW = 200, totalH = eraEntries.length * (barH + gap) - gap;
    const bars = eraEntries.map(([era, count], i) => {
      const y = i * (barH + gap);
      const label = `${era}-${String(Number(era)+4).slice(2)}`;
      const bw = (count / maxC) * chartW;
      const op = (0.35 + 0.65 * count / maxC).toFixed(2);
      return `<text x="${labelW - 4}" y="${y + barH/2 + 3.5}" text-anchor="end" class="archive-chart-label">${label}</text><rect x="${labelW}" y="${y}" width="${bw.toFixed(1)}" height="${barH}" rx="3" class="archive-chart-bar" opacity="${op}"/><text x="${(labelW + bw + 4).toFixed(1)}" y="${y + barH/2 + 3.5}" class="archive-chart-label">${count}</text>`;
    }).join('');
    const section = document.createElement('div');
    section.className = 'archive-section';
    const t1 = document.createElement('div');
    t1.className = 'archive-section-title';
    t1.textContent = 'Eras';
    section.appendChild(t1);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${labelW + chartW + 32} ${totalH}`);
    svg.setAttribute('class', 'archive-chart-svg');
    svg.innerHTML = bars;
    section.appendChild(svg);
    body.appendChild(section);
  }

  makeTagCloud('Top Venues', Object.entries(venueCounts).sort((a,b)=>b[1]-a[1]));
  const nbhdEntries = Object.entries(nbhdCounts).sort((a,b)=>b[1]-a[1]);
  if (nbhdEntries.length >= 3) makeTagCloud('Neighborhoods', nbhdEntries);

  // Weekday vertical bar chart
  const maxDow = Math.max(...dowCounts);
  if (maxDow > 0) {
    const VH = 56, barW = 32, gap = 5, totalW = 7 * (barW + gap) - gap;
    const bars = DOW_LABELS.map((label, i) => {
      const count = dowCounts[i];
      const h = count > 0 ? Math.max(3, (count / maxDow) * VH) : 3;
      const x = i * (barW + gap);
      const op = (0.25 + 0.75 * count / maxDow).toFixed(2);
      const cLabel = count > 0 ? `<text x="${(x + barW/2).toFixed(1)}" y="${(VH - h - 3).toFixed(1)}" text-anchor="middle" class="archive-chart-label">${count}</text>` : '';
      return `<rect x="${x}" y="${(VH - h).toFixed(1)}" width="${barW}" height="${h.toFixed(1)}" rx="3" class="archive-chart-bar" opacity="${op}"/>${cLabel}<text x="${(x + barW/2).toFixed(1)}" y="${VH + 12}" text-anchor="middle" class="archive-chart-label">${label}</text>`;
    }).join('');
    const section = document.createElement('div');
    section.className = 'archive-section';
    const t2 = document.createElement('div');
    t2.className = 'archive-section-title';
    t2.textContent = 'Weeknights';
    section.appendChild(t2);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${totalW} ${VH + 16}`);
    svg.setAttribute('class', 'archive-chart-svg');
    svg.innerHTML = bars;
    section.appendChild(svg);
    body.appendChild(section);
  }
}

function buildPhotoGrid(body, favDocs) {
  const sorted = [...favDocs].sort((a, b) => (Number(b.downloads)||0) - (Number(a.downloads)||0));
  const candidates = sorted.slice(0, 20);
  if (!candidates.length) return;
  const COLS = 3;

  const section = document.createElement('div');
  section.className = 'archive-section';

  const hdr = document.createElement('div');
  hdr.className = 'archive-section-hdr';
  const titleEl = document.createElement('div');
  titleEl.className = 'archive-section-title';
  titleEl.textContent = 'From Your Shows';
  const refreshBtn = document.createElement('button');
  refreshBtn.className = 'discover-refresh-btn';
  refreshBtn.setAttribute('aria-label', 'Shuffle photos');
  refreshBtn.textContent = '↺';
  hdr.appendChild(titleEl);
  hdr.appendChild(refreshBtn);
  section.appendChild(hdr);

  const grid = document.createElement('div');
  grid.className = 'archive-photo-grid';
  section.appendChild(grid);
  body.appendChild(section);

  const loadGrid = (pool) => {
    grid.innerHTML = '';
    // Track naturalWidth×naturalHeight to detect default collection thumbnails.
    // Keep at most 2 images of any given pixel size.
    const sizeCounts = {};
    const entries = [];
    let settledCount = 0;

    const onSettle = () => {
      settledCount++;
      if (settledCount < pool.length) return;
      const good = entries.filter(e => e.ok);
      const keep = Math.floor(good.length / COLS) * COLS;
      if (keep === 0) { section.remove(); return; }
      good.slice(0, keep).forEach(e => { e.item.style.display = ''; });
      good.slice(keep).forEach(e => e.item.remove());
      entries.filter(e => !e.ok).forEach(e => e.item.remove());
    };

    pool.forEach(doc => {
      const e = { item: null, ok: false };
      entries.push(e);
      const item = document.createElement('div');
      item.className = 'archive-photo-item';
      item.style.display = 'none';
      e.item = item;
      const img = document.createElement('img');
      img.src = `https://archive.org/services/img/${esc(doc.identifier)}`;
      img.alt = esc(doc.creator || '');
      img.onload = function() {
        const key = `${this.naturalWidth}x${this.naturalHeight}`;
        sizeCounts[key] = (sizeCounts[key] || 0) + 1;
        e.ok = sizeCounts[key] <= 2;
        onSettle();
      };
      img.onerror = () => onSettle();
      img.addEventListener('click', () => {
        el.archiveSheet.classList.remove('visible');
        openConcert(doc);
      });
      item.appendChild(img);
      grid.appendChild(item);
    });
  };

  loadGrid(candidates);
  refreshBtn.addEventListener('click', () => {
    loadGrid([...candidates].sort(() => Math.random() - 0.5));
  });
}

// ── Concert detail view ────────────────────────────────────────────
async function openConcert(doc) {
  if (!state.inFiltered) state.prevMode = state.mode;
  state.inConcert = true;
  state.inFiltered = false;

  el.backBtn.classList.add('visible');
  el.modeBar.classList.add('hidden');
  el.sortBar.classList.add('hidden');
  el.statBanner.style.display = 'none';
  el.searchInput.classList.add('search-hidden');
  el.searchClear.style.display = 'none';
  showView('concert');
  el.viewConcert.innerHTML = '<div class="spinner"></div>';
  el.viewConcert.scrollTop = 0;

  try {
    const meta = await getItemMetadata(doc.identifier);
    state.currentConcert = meta;
    renderConcert(meta);
  } catch (err) {
    el.viewConcert.innerHTML = `<p class="error-msg">Failed to load: ${err.message}</p>`;
  }
}

function renderConcert(meta) {
  const m = meta.metadata;
  const tracks = buildTracks(meta);
  const faved = isFav(m.identifier);
  const dismissed = isDismissed(m.creator);
  const venueName = extractVenueName({ title: m.title, coverage: m.coverage });
  const artUrl = `https://archive.org/services/img/${esc(m.identifier)}`;
  const dateKey = m.date ? m.date.slice(0, 10) : null;

  el.viewConcert.innerHTML = `
    <div class="concert-hero">
      <img class="concert-hero-art" id="concert-hero-art"
           src="${artUrl}" alt="${esc(m.creator || '')}">
      <div class="concert-hero-meta">
        <div class="concert-header-date">${formatDateWithDay(m.date)}</div>
        <div class="concert-header-creator${m.creator ? ' concert-artist-link' : ''}" id="concert-artist-link">${esc(m.creator || '')}</div>
        ${venueName ? `<div class="concert-header-venue">${esc(venueName)}${(n => n ? `<span class="concert-venue-nbhd"> · ${esc(n)}</span>` : '')(getVenueNeighborhood(venueName))}</div>` : ''}
        <div class="concert-archive-mini"><a href="https://archive.org/details/${esc(m.identifier)}" target="_blank" rel="noopener">${esc(m.title || m.identifier)}</a></div>
        ${m.addeddate ? `<div class="concert-upload-date">uploaded ${formatUploadDate(m.addeddate)}</div>` : ''}
        ${(()=>{ const d = state.index?.find(x=>x.identifier===m.identifier); const n = d?.downloads || m.downloads; return n ? `<div class="concert-upload-date">${Number(n).toLocaleString()} plays</div>` : ''; })()}
      </div>
      <div class="concert-hero-actions">
        <button class="btn-dismiss${dismissed ? ' active' : ''}" id="concert-dismiss" title="Don't Recommend This Artist">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><line x1="5.5" y1="18.5" x2="18.5" y2="5.5"/></svg>
        </button>
        <button class="btn-fav${faved ? ' active' : ''}" id="concert-fav" title="Favorite">♥</button>
      </div>
    </div>
    <div id="concert-context-section"></div>
    <div id="concert-snippets-section"></div>
    <div id="concert-also-date"></div>
    <div class="concert-info-block">
      <div class="concert-actions">
        <button class="btn-primary" id="play-all">Play All</button>
        <button class="btn-secondary" id="queue-all">Add to Queue</button>
      </div>
    </div>
    <ul class="track-list" id="track-list"></ul>
  `;

  // Lightbox: tap art to see hi-res original; fall back to thumbnail
  $('concert-hero-art').addEventListener('click', () => {
    const orig = findHiResArt(meta.files);
    const src = orig
      ? `https://archive.org/download/${esc(m.identifier)}/${encodeURIComponent(orig.name)}`
      : artUrl;
    const lb = document.createElement('div');
    lb.id = 'concert-lightbox';
    lb.innerHTML = `<img src="${src}" alt="">`;
    lb.addEventListener('click', () => lb.remove());
    document.body.appendChild(lb);
  });

  // Artist name → navigate to Artists view for that artist
  if (m.creator) {
    $('concert-artist-link').addEventListener('click', () => {
      const groups = groupByArtist(state.index);
      const entry = groups.find(([name]) => name === m.creator);
      if (entry) state.selectedArtist = { name: m.creator, docs: entry[1] };
      setMode('artists');
    });
  }

  // "On This Date" section: weather + Chicago history
  if (dateKey) {
    const histEntry = HISTORY[dateKey];
    fetchDayContext(dateKey).then(wx => {
      const parts = [];
      if (wx) {
        parts.push(`${wx.condition} · ${wx.hi}°`);
        if (wx.sunset) parts.push(`sunset ${wx.sunset}`);
      }
      if (histEntry) {
        const entries = Array.isArray(histEntry) ? histEntry : [histEntry];
        entries.forEach(e => parts.push(e.replace(/^\d{4}\s*·\s*/, '')));
      }
      if (parts.length) {
        const sec = $('concert-context-section');
        if (!sec) return;
        sec.className = 'concert-date-context';
        sec.innerHTML = `<span class="concert-date-label">On this date</span>${esc(parts.join(' · '))}`;
      }
    });
  }

  // Tour-Spiel section
  const concertYear = dateKey ? dateKey.slice(0, 4) : null;
  const artistData = m.creator && concertYear && ARTIST_CONTEXT[m.creator]?.[concertYear];
  if (artistData) {
    const sec = $('concert-snippets-section');
    if (sec) {
      sec.className = 'concert-also open';

      // Header
      const header = document.createElement('div');
      header.className = 'concert-section-header concert-also-toggle';
      const lbl = document.createElement('span');
      lbl.textContent = 'Tour-Spiel';
      header.appendChild(lbl);
      const ns = 'http://www.w3.org/2000/svg';
      const chevSvg = document.createElementNS(ns, 'svg');
      chevSvg.setAttribute('viewBox', '0 0 24 24');
      chevSvg.setAttribute('fill', 'none');
      chevSvg.setAttribute('stroke', 'currentColor');
      chevSvg.setAttribute('stroke-width', '2');
      chevSvg.setAttribute('width', '16');
      chevSvg.setAttribute('height', '16');
      chevSvg.classList.add('concert-also-chevron-toggle');
      const poly = document.createElementNS(ns, 'polyline');
      poly.setAttribute('points', '6,9 12,15 18,9');
      chevSvg.appendChild(poly);
      header.appendChild(chevSvg);

      // Body — inline display:block so CSS cache state can't hide it
      const bodyEl = document.createElement('div');
      bodyEl.className = 'concert-artist-body';
      bodyEl.style.display = 'block';
      let bodyHtml = '';
      if (artistData.blurb) {
        bodyHtml += `<p class="concert-artist-blurb">${renderMd(artistData.blurb)}</p>`;
      }
      (artistData.quotes || []).forEach(q => {
        bodyHtml += `<div class="concert-snippet"><div class="concert-snippet-quote">"${esc(q.text)}"</div>${q.attr ? `<div class="concert-snippet-attr">— ${renderMd(q.attr)}</div>` : ''}</div>`;
      });
      bodyEl.innerHTML = bodyHtml;

      header.addEventListener('click', () => {
        const open = sec.classList.toggle('open');
        bodyEl.style.display = open ? 'block' : 'none';
      });

      sec.appendChild(header);
      sec.appendChild(bodyEl);
    }
  }

  // Also in the archive on this date
  if (dateKey && state.index) {
    const sameDate = state.index
      .filter(d => d.date && d.date.slice(0, 10) === dateKey && d.identifier !== m.identifier)
      .sort((a, b) => (a.creator || '').localeCompare(b.creator || ''));
    if (sameDate.length) {
      const alsoEl = $('concert-also-date');
      alsoEl.className = 'concert-also';

      const header = document.createElement('div');
      header.className = 'concert-section-header concert-also-toggle';
      header.innerHTML = `
        <span>Also in the archive on ${esc(formatDateWithDay(m.date))}</span>
        <span class="concert-also-toggle-right">
          <span class="concert-also-count">${sameDate.length}</span>
          <svg class="concert-also-chevron-toggle" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="6,9 12,15 18,9"/>
          </svg>
        </span>
      `;
      alsoEl.appendChild(header);

      const list = document.createElement('div');
      list.className = 'concert-also-list';
      sameDate.forEach(doc => {
        const row = document.createElement('div');
        row.className = 'concert-also-item';
        row.innerHTML = `
          <div class="concert-also-info">
            <div class="concert-also-creator">${esc(doc.creator || doc.title || '')}</div>
            <div class="concert-also-title">${esc(doc.title || '')}</div>
          </div>
          <svg class="concert-also-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="9,18 15,12 9,6"/>
          </svg>
        `;
        row.addEventListener('click', () => openConcert(doc));
        list.appendChild(row);
      });
      alsoEl.appendChild(list);

      header.addEventListener('click', () => alsoEl.classList.toggle('open'));
    }
  }

  $('concert-fav').addEventListener('click', e => {
    const active = toggleFav(m.identifier);
    e.currentTarget.classList.toggle('active', active);
  });

  if (m.creator) {
    $('concert-dismiss').addEventListener('click', e => {
      const active = toggleDismiss(m.creator);
      e.currentTarget.classList.toggle('active', active);
      flashConfirm(active ? `Won't recommend ${m.creator} anymore` : `${m.creator} recommendations restored`);
    });
  }

  $('play-all').addEventListener('click', () => { player.replaceQueue(tracks, 0); openQueue(); });
  $('queue-all').addEventListener('click', () => tracks.forEach(t => player.addToEnd(t)));

  const trackList = $('track-list');
  tracks.forEach((track, i) => {
    const li = document.createElement('li');
    li.className = 'track-item' + (player.currentTrack?.url === track.url ? ' playing' : '');
    li.dataset.url = track.url;
    li.innerHTML = `
      <span class="track-num">${i + 1}</span>
      <div class="track-info">
        <div class="track-title">${esc(track.title)}</div>
        ${track.duration ? `<div class="track-duration">${track.duration}</div>` : ''}
      </div>
      <button class="track-add" title="More options">…</button>
    `;
    li.querySelector('.track-add').addEventListener('click', e => {
      e.stopPropagation();
      openTrackAction(track);
    });
    li.addEventListener('click', () => player.replaceQueue(tracks, i));
    trackList.appendChild(li);
  });
}

function buildTracks(meta) {
  const m = meta.metadata;
  return getAudioFiles(meta.files || []).map(f => ({
    url:        getStreamUrl(m.identifier, f.name),
    title:      f.title || stripExt(f.name),
    artist:     m.creator || '',
    album:      m.title || m.identifier,
    date:       (m.date || '').slice(0, 10),
    duration:   formatDuration(f.length),
    identifier: m.identifier,
    filename:   f.name,
  }));
}

// ── Track action sheet ─────────────────────────────────────────────
let _actionTrack = null;

function openTrackAction(track) {
  _actionTrack = track;
  el.trackActionTitle.textContent = track.title;
  el.trackActionSheet.classList.add('visible');
}

function closeTrackAction() {
  el.trackActionSheet.classList.remove('visible');
  _actionTrack = null;
}

// ── Discover ───────────────────────────────────────────────────────
function renderDiscover() {
  const index = state.index;
  const today = new Date();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  const todaySlice = `${mm}-${dd}`;
  const todayShows = index.filter(d => (d.date || '').slice(5, 10) === todaySlice)
                          .sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const recentShows = index
    .filter(d => d.addeddate && d.addeddate.slice(0, 10) >= cutoffStr)
    .sort((a, b) => b.addeddate.localeCompare(a.addeddate));

  el.viewDiscover.innerHTML = '';
  updateStatBanner();

  // ── Donate bar ──
  const donateBar = document.createElement('div');
  donateBar.className = 'ia-donate-bar';
  const _dtxt = `All content from the <a class="ia-donate-collection" href="https://archive.org/details/${esc(state.collectionId)}" target="_blank" rel="noopener">${esc(state.collectionId)}</a> collection on the <strong>Internet Archive</strong>. Help keep it free.&emsp;&emsp;&emsp;`;
  donateBar.innerHTML = `
    <div class="ia-donate-scroll-wrap"><span class="ia-donate-ticker">${_dtxt}${_dtxt}</span></div>
    <a class="ia-donate-cta" href="https://archive.org/donate" target="_blank" rel="noopener">Donate</a>
  `;
  el.viewDiscover.appendChild(donateBar);

  // ── 1. Today in the Archive ──
  const todayLabel = today.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  if (todayShows.length) {
    const sec = discoverSection(`Today in the Archive — ${todayLabel}`, `${todayShows.length} show${todayShows.length !== 1 ? 's' : ''}`);
    const strip = document.createElement('div');
    strip.className = 'discover-h-scroll';
    todayShows.forEach(doc => {
      const card = document.createElement('div');
      card.className = 'today-card';
      const venueStr = extractVenueName(doc) || '';
      card.innerHTML = `
        <div class="today-card-year">${(doc.date || '').slice(0, 4)}</div>
        <div class="today-card-title">${esc(doc.creator || doc.title || '')}</div>
        ${venueStr ? `<div class="today-card-artist">${esc(venueStr)}</div>` : ''}
      `;
      if (doc.date) {
        fetchDayContext(doc.date.slice(0, 10)).then(wx => {
          if (!wx) return;
          const wxEl = document.createElement('div');
          wxEl.className = 'today-card-weather';
          wxEl.textContent = `${wx.hi}°F · ${wx.condition}`;
          card.insertBefore(wxEl, card.querySelector('.card-fav') || null);
        }).catch(() => {});
      }
      const todayFav = document.createElement('button');
      todayFav.className = `card-fav${isFav(doc.identifier) ? ' active' : ''}`;
      todayFav.title = 'Favorite';
      todayFav.textContent = '♥';
      todayFav.addEventListener('click', e => {
        e.stopPropagation();
        const active = toggleFav(doc.identifier);
        todayFav.classList.toggle('active', active);
        updateStatBanner();
      });
      card.appendChild(todayFav);
      card.addEventListener('click', () => openConcert(doc));
      strip.appendChild(card);
    });
    sec.appendChild(strip);
    el.viewDiscover.appendChild(sec);
  }

  // Pre-compute multi-artist bill data so Popular can match the tile count
  const billMap = {};
  index.forEach(doc => {
    const date  = (doc.date || '').slice(0, 10);
    const venue = extractVenueName(doc);
    if (!date || !venue || !doc.creator) return;
    const key = `${date}|${venue}`;
    if (!billMap[key]) billMap[key] = [];
    billMap[key].push(doc);
  });
  const allBills = Object.entries(billMap)
    .filter(([, docs]) => new Set(docs.map(d => d.creator)).size >= 2);
  const billLimit = Math.min(Math.max(todayShows.length, 5), 8);

  // ── Based on Your Favs ──
  {
    const favIds = new Set(getFavIds());
    if (favIds.size > 10) {
      const favDocs = index.filter(d => favIds.has(d.identifier));
      const favArtists    = new Set(favDocs.map(d => (d.creator || '').trim().toLowerCase()).filter(Boolean));
      const favDateVenues = new Set(favDocs.map(d => {
        const date  = (d.date || '').slice(0, 10);
        const venue = extractVenueName(d);
        return date && venue ? `${date}|${venue.toLowerCase()}` : null;
      }).filter(Boolean));

      const favMatches = index.filter(d => {
        if (favIds.has(d.identifier)) return false;
        const artist = (d.creator || '').trim().toLowerCase();
        if (artist && isDismissed(artist)) return false;
        if (artist && favArtists.has(artist)) return true;
        const date  = (d.date || '').slice(0, 10);
        const venue = extractVenueName(d);
        return !!(date && venue && favDateVenues.has(`${date}|${venue.toLowerCase()}`));
      });

      if (favMatches.length >= 5) {
        const byArtist = new Map();
        favMatches.forEach(doc => {
          const name = (doc.creator || doc.title || '').trim();
          if (!name) return;
          if (!byArtist.has(name)) byArtist.set(name, []);
          byArtist.get(name).push(doc);
        });
        const artistGroups = [...byArtist.entries()].map(([name, docs]) => {
          const count = docs.length;
          const seen = new Set();
          const entries = [];
          dateAsc(docs).forEach(doc => {
            const venue = extractVenueName(doc);
            const yr2 = (doc.date || '').slice(2, 4);
            if (!venue || !yr2) return;
            const key = `${venue.toLowerCase()}|${yr2}`;
            if (seen.has(key)) return;
            seen.add(key);
            entries.push(`${venue} · '${yr2}`);
          });
          const label = entries.length ? entries.join(' · ') : `${count} Show${count !== 1 ? 's' : ''}`;
          return { name, count, label };
        });

        const buildFavBandStrip = () => {
          const strip = document.createElement('div');
          strip.className = 'discover-h-scroll';
          const picks = [...artistGroups].sort(() => Math.random() - 0.5).slice(0, billLimit);
          picks.forEach(({ name, label }) => {
            const card = document.createElement('div');
            card.className = 'favband-card';
            card.innerHTML = `
              <div class="favband-card-name">${esc(name)}</div>
              <div class="favband-card-count"><span class="favband-card-count-inner">${esc(label)}</span></div>
            `;
            card.addEventListener('click', () => {
              const groups = groupByArtist(state.index);
              const entry = groups.find(([n]) => n === name);
              state.selectedArtist = { name, docs: entry ? entry[1] : [] };
              setMode('artists');
            });
            strip.appendChild(card);
          });
          requestAnimationFrame(() => {
            strip.querySelectorAll('.favband-card-count').forEach(wrap => {
              const inner = wrap.querySelector('.favband-card-count-inner');
              const text = inner.textContent;
              if (inner.offsetWidth > wrap.clientWidth) {
                inner.textContent = text + '      ' + text;
                inner.classList.add('scrolling');
              }
            });
          });
          return strip;
        };

        const favSec = discoverSection('Based on Your Favs', `${Math.min(billLimit, artistGroups.length)} of ${artistGroups.length}`, () => {
          const old = favSec.querySelector('.discover-h-scroll');
          const neo = buildFavBandStrip();
          if (old) favSec.replaceChild(neo, old); else favSec.appendChild(neo);
        });
        favSec.appendChild(buildFavBandStrip());
        el.viewDiscover.appendChild(favSec);
      }
    }
  }

  // ── 2. Redcontroldeck Favs ──
  {
    const indexById = new Map(index.map(d => [d.identifier, d]));
    const rcdPool = RCD_FAVS.map(id => indexById.get(id)).filter(Boolean);
    if (rcdPool.length) {
      const buildRcdStrip = () => {
        const strip = document.createElement('div');
        strip.className = 'discover-h-scroll';
        const picks = [...rcdPool].sort(() => Math.random() - 0.5).slice(0, billLimit);
        picks.forEach(doc => {
          const card = document.createElement('div');
          card.className = 'popular-card';
          const artUrl = `https://archive.org/services/img/${doc.identifier}`;
          const city   = doc.coverage || '';
          card.innerHTML = `
            <img class="popular-card-img" src="${esc(artUrl)}" alt="" loading="lazy">
            <div class="popular-card-info">
              <div class="popular-card-artist">${esc(doc.creator || doc.title || '')}</div>
              ${city ? `<div class="popular-card-city">${esc(city)}</div>` : ''}
              <div class="popular-card-date">${formatDate(doc.date)}</div>
            </div>
          `;
          const rcdFav = document.createElement('button');
          rcdFav.className = `card-fav${isFav(doc.identifier) ? ' active' : ''}`;
          rcdFav.title = 'Favorite';
          rcdFav.textContent = '♥';
          rcdFav.addEventListener('click', e => {
            e.stopPropagation();
            const active = toggleFav(doc.identifier);
            rcdFav.classList.toggle('active', active);
            updateStatBanner();
          });
          card.appendChild(rcdFav);
          card.addEventListener('click', () => openConcert(doc));
          strip.appendChild(card);
        });
        return strip;
      };
      const rcdSec = discoverSection('Redcontroldeck Favs', `${Math.min(billLimit, rcdPool.length)} of ${rcdPool.length}`, () => {
        const old = rcdSec.querySelector('.discover-h-scroll');
        const neo = buildRcdStrip();
        if (old) rcdSec.replaceChild(neo, old); else rcdSec.appendChild(neo);
      });
      rcdSec.appendChild(buildRcdStrip());
      el.viewDiscover.appendChild(rcdSec);
    }
  }

  // ── 3. Explore Space-Time (shelved) ──
  if (false) // eslint-disable-line no-constant-condition
  {
    const nbhdMap = {};
    index.forEach(d => {
      const v = extractVenueName(d);
      const n = v ? getVenueNeighborhood(v) : null;
      if (!n) return;
      (nbhdMap[n] = nbhdMap[n] || []).push(d);
    });
    const neighborhoods = Object.entries(nbhdMap)
      .sort((a, b) => b[1].length - a[1].length)
      .map(([n]) => n);

    if (neighborhoods.length >= 2) {
      const getYears = nbhd => [...new Set(
        (nbhdMap[nbhd] || []).map(d => (d.date || '').slice(0, 4)).filter(Boolean)
      )].sort().reverse();

      // Random initial selection
      if (!state.nbhdEraNeighborhood || !nbhdMap[state.nbhdEraNeighborhood]) {
        state.nbhdEraNeighborhood = neighborhoods[Math.floor(Math.random() * neighborhoods.length)];
        const ys = getYears(state.nbhdEraNeighborhood);
        state.nbhdEraYear = ys[Math.floor(Math.random() * ys.length)] || null;
      } else {
        const ys = getYears(state.nbhdEraNeighborhood);
        if (!state.nbhdEraYear || !ys.includes(state.nbhdEraYear))
          state.nbhdEraYear = ys[Math.floor(Math.random() * ys.length)] || null;
      }

      const getMatching = () => (nbhdMap[state.nbhdEraNeighborhood] || [])
        .filter(d => (d.date || '').slice(0, 4) === state.nbhdEraYear);

      const sec = discoverSection('Explore Space-Time', '…', () => rebuildStrip());

      const rebuildStrip = () => {
        const matching = getMatching();
        const picks = [...matching].sort(() => Math.random() - 0.5).slice(0, billLimit);

        const countEl = sec.querySelector('.discover-section-count');
        if (countEl) countEl.textContent = `${picks.length} of ${matching.length}`;

        const strip = document.createElement('div');
        strip.className = 'discover-h-scroll';

        // Selector card — far left with native <select> dropdowns
        const selectorCard = document.createElement('div');
        selectorCard.className = 'nbhd-era-selector-card';

        const nbhdSelect = document.createElement('select');
        nbhdSelect.className = 'nbhd-era-selector-btn';
        neighborhoods.forEach(n => {
          const opt = document.createElement('option');
          opt.value = n;
          opt.textContent = n;
          if (n === state.nbhdEraNeighborhood) opt.selected = true;
          nbhdSelect.appendChild(opt);
        });
        nbhdSelect.addEventListener('change', () => {
          state.nbhdEraNeighborhood = nbhdSelect.value;
          const ys = getYears(state.nbhdEraNeighborhood);
          state.nbhdEraYear = ys[Math.floor(Math.random() * ys.length)] || null;
          rebuildStrip();
        });

        const yearSelect = document.createElement('select');
        yearSelect.className = 'nbhd-era-selector-btn';
        getYears(state.nbhdEraNeighborhood).forEach(y => {
          const opt = document.createElement('option');
          opt.value = y;
          opt.textContent = y;
          if (y === state.nbhdEraYear) opt.selected = true;
          yearSelect.appendChild(opt);
        });
        yearSelect.addEventListener('change', () => {
          state.nbhdEraYear = yearSelect.value;
          rebuildStrip();
        });

        selectorCard.append(nbhdSelect, yearSelect);
        strip.appendChild(selectorCard);

        // Show cards — reuse bill-card style for consistent formatting
        picks.forEach(doc => {
          const card = document.createElement('div');
          card.className = 'bill-card';
          const venue = extractVenueName(doc) || '';
          card.innerHTML = `
            <div class="bill-date-full">${esc(formatDateBill(doc.date?.slice(0, 10) || ''))}</div>
            <div class="bill-artists">${esc(doc.creator || doc.title || '')}</div>
            ${venue ? `<div class="bill-venue">${esc(venue)}</div>` : ''}
          `;
          card.addEventListener('click', () => openConcert(doc));
          strip.appendChild(card);
        });

        requestAnimationFrame(() => {
          strip.querySelectorAll('.bill-artists').forEach(a => {
            a.style.fontSize = '15px';
            while (a.scrollHeight > a.clientHeight && parseFloat(a.style.fontSize) > 9)
              a.style.fontSize = (parseFloat(a.style.fontSize) - 0.5) + 'px';
          });
        });

        const old = sec.querySelector('.discover-h-scroll');
        if (old) sec.replaceChild(strip, old); else sec.appendChild(strip);
      };

      rebuildStrip();
      el.viewDiscover.appendChild(sec);
    }
  }

  // ── 5. Time Travel to a Show (multi-artist bills) ──
  {
    if (allBills.length) {
      const buildBillStrip = () => {
        const bills = [...allBills].sort(() => Math.random() - 0.5).slice(0, billLimit);
        const strip = document.createElement('div');
        strip.className = 'discover-h-scroll';
        bills.forEach(([key, docs]) => {
          const [date, venue] = key.split('|');
          // headliner (highest plays) first on card, last in queue
          const byPlaysDesc = [...docs].sort((a, b) => (Number(b.downloads) || 0) - (Number(a.downloads) || 0));
          const byPlaysAsc  = [...docs].sort((a, b) => (Number(a.downloads) || 0) - (Number(b.downloads) || 0));
          const artists = [...new Set(byPlaysDesc.map(d => d.creator))];
          const card = document.createElement('div');
          card.className = 'bill-card';
          card.innerHTML = `
            <div class="bill-date-full">${esc(formatDateBill(date))}</div>
            <div class="bill-artists">${esc(artists.join(' · '))}</div>
            <div class="bill-venue">${esc(venue)}</div>
          `;
          card.addEventListener('click', async () => {
            card.style.opacity = '0.45';
            card.style.pointerEvents = 'none';
            try {
              const metas     = await Promise.all(byPlaysAsc.map(d => getItemMetadata(d.identifier)));
              const allTracks = metas.flatMap(meta => buildTracks(meta));
              if (allTracks.length) { player.replaceQueue(allTracks, 0); openQueue(); }
            } catch (e) { console.error('Time Travel to a Show:', e); }
            finally {
              card.style.opacity = '';
              card.style.pointerEvents = '';
            }
          });
          strip.appendChild(card);
        });
        requestAnimationFrame(() => {
          strip.querySelectorAll('.bill-artists').forEach(el => {
            el.style.fontSize = '15px';
            while (el.scrollHeight > el.clientHeight && parseFloat(el.style.fontSize) > 9) {
              el.style.fontSize = (parseFloat(el.style.fontSize) - 0.5) + 'px';
            }
          });
        });
        return strip;
      };

      const sec = discoverSection('Time Travel to a Rando Show', `${billLimit} of ${allBills.length}`, () => {
        const old = sec.querySelector('.discover-h-scroll');
        const neo = buildBillStrip();
        if (old) sec.replaceChild(neo, old); else sec.appendChild(neo);
      });
      sec.appendChild(buildBillStrip());
      el.viewDiscover.appendChild(sec);
    }
  }

  // ── 4. Popular in the Archive ──
  {
    let popularDocs = [];
    const buildPopularStrip = () => {
      const strip = document.createElement('div');
      strip.className = 'discover-h-scroll';
      const picks = [...popularDocs].sort(() => Math.random() - 0.5).slice(0, billLimit);
      picks.forEach(doc => {
        const card = document.createElement('div');
        card.className = 'popular-card';
        const artUrl = `https://archive.org/services/img/${doc.identifier}`;
        const city   = doc.coverage || '';
        const plays  = doc.downloads ? `${Number(doc.downloads).toLocaleString()} plays` : '';
        card.innerHTML = `
          <img class="popular-card-img" src="${esc(artUrl)}" alt="" loading="lazy">
          <div class="popular-card-info">
            <div class="popular-card-artist">${esc(doc.creator || doc.title || '')}</div>
            ${city ? `<div class="popular-card-city">${esc(city)}</div>` : ''}
            <div class="popular-card-date">${formatDate(doc.date)}</div>
            ${plays ? `<div class="popular-card-plays">${esc(plays)}</div>` : ''}
          </div>
        `;
        const popFav = document.createElement('button');
        popFav.className = `card-fav${isFav(doc.identifier) ? ' active' : ''}`;
        popFav.title = 'Favorite';
        popFav.textContent = '♥';
        popFav.addEventListener('click', e => {
          e.stopPropagation();
          const active = toggleFav(doc.identifier);
          popFav.classList.toggle('active', active);
          updateStatBanner();
        });
        card.appendChild(popFav);
        card.addEventListener('click', () => openConcert(doc));
        strip.appendChild(card);
      });
      return strip;
    };

    const popularSec = discoverSection('Popular in the Archive', '…', () => {
      const old = popularSec.querySelector('.discover-h-scroll');
      const neo = buildPopularStrip();
      if (old) popularSec.replaceChild(neo, old); else popularSec.appendChild(neo);
    });
    el.viewDiscover.appendChild(popularSec);

    fetch(`https://archive.org/advancedsearch.php?q=collection%3A${encodeURIComponent(state.collectionId)}+AND+mediatype%3Aaudio&fl[]=identifier&fl[]=creator&fl[]=date&fl[]=title&fl[]=coverage&fl[]=downloads&sort[]=downloads+desc&rows=50&output=json`)
      .then(r => r.json())
      .then(data => {
        popularDocs = (data.response?.docs ?? []).filter(d => (d.downloads || 0) >= 400);
        const countEl = popularSec.querySelector('.discover-section-count');
        if (countEl) countEl.textContent = `${Math.min(billLimit, popularDocs.length)} of ${popularDocs.length}`;
        if (popularDocs.length) popularSec.appendChild(buildPopularStrip());
      })
      .catch(() => {});
  }

  // ── 5. Uploads by Year chart ──
  {
    const monthCounts = {};
    index.forEach(d => {
      const mo = d.addeddate?.slice(0, 7);
      if (mo) monthCounts[mo] = (monthCounts[mo] || 0) + 1;
    });
    const months = Object.keys(monthCounts).sort();
    if (months.length >= 2) {
      const counts = months.map(m => monthCounts[m]);
      const maxC = Math.max(...counts);
      const VW = 400, VH = 56, gap = 1;
      const barW = (VW - gap * (months.length - 1)) / months.length;
      const bars = months.map((mo, i) => {
        const h = Math.max(2, (counts[i] / maxC) * VH);
        const x = i * (barW + gap);
        const opacity = (0.28 + 0.72 * (counts[i] / maxC)).toFixed(2);
        return `<rect x="${x.toFixed(1)}" y="${(VH - h).toFixed(1)}" width="${Math.max(1, barW).toFixed(1)}" height="${h.toFixed(1)}" fill="var(--accent)" opacity="${opacity}" rx="1"/>`;
      }).join('');
      // Year labels: find first month index for each year
      const yearStarts = {};
      months.forEach((mo, i) => {
        const yr = mo.slice(0, 4);
        if (!(yr in yearStarts)) yearStarts[yr] = i;
      });
      const n = months.length;
      const yearLabels = Object.entries(yearStarts).map(([yr, idx], j) => {
        const pct = (idx / n * 100).toFixed(1);
        const transform = j === 0 ? '' : 'transform:translateX(-50%)';
        return `<span class="upload-chart-year-label" style="left:${pct}%;${transform}">${yr}</span>`;
      }).join('');

      const sec = discoverSection('Uploads by Month', '');
      const wrap = document.createElement('div');
      wrap.className = 'upload-chart-wrap';
      wrap.innerHTML = `
        <svg viewBox="0 0 ${VW} ${VH}" preserveAspectRatio="none" class="upload-chart-svg">${bars}</svg>
        <div class="upload-chart-labels">${yearLabels}</div>
      `;
      sec.appendChild(wrap);
      el.viewDiscover.appendChild(sec);
    }
  }

  // ── 5. New to the Archive ──
  if (recentShows.length) {
    const sec = discoverSection('New to the Archive', `${recentShows.length} show${recentShows.length !== 1 ? 's' : ''} in last 30 days`);
    const list = document.createElement('ul');
    list.className = 'recent-list';
    recentShows.forEach(doc => {
      const li = document.createElement('li');
      li.className = 'recent-item';
      const venue   = extractVenueName(doc) || '';
      const subline = [venue, formatDate(doc.date)].filter(Boolean).join(' · ');
      li.innerHTML = `
        <div class="recent-date">${formatUploadDate(doc.addeddate)}</div>
        <div class="recent-info">
          <div class="recent-title">${esc(doc.creator || doc.title || '')}</div>
          ${subline ? `<div class="recent-artist">${esc(subline)}</div>` : ''}
        </div>
        <button class="concert-fav recent-fav${isFav(doc.identifier) ? ' active' : ''}" title="Favorite">♥</button>
      `;
      li.querySelector('.recent-fav').addEventListener('click', e => {
        e.stopPropagation();
        const active = toggleFav(doc.identifier);
        e.currentTarget.classList.toggle('active', active);
        updateStatBanner();
      });
      li.addEventListener('click', () => openConcert(doc));
      list.appendChild(li);
    });
    sec.appendChild(list);
    el.viewDiscover.appendChild(sec);
  }

}

// ── Year tab ───────────────────────────────────────────────────────
function renderYearEraPills(allByYear) {
  const presentYears = new Set(allByYear.map(([y]) => parseInt(y)));
  const eraStarts = new Set([...presentYears].map(y => Math.floor(y / 5) * 5));
  const sorted = [...eraStarts].sort((a, b) => a - b);

  el.yearEraBar.innerHTML = '';
  if (sorted.length <= 1) { el.yearEraBar.style.display = 'none'; return; }
  el.yearEraBar.style.display = '';

  const frag = document.createDocumentFragment();

  const allPill = makeAlphaPill('All', state.yearEraFilter === null);
  allPill.addEventListener('click', () => {
    state.yearEraFilter = null;
    state.selectedYear = null;
    renderYear();
    updateStatBanner();
  });
  frag.appendChild(allPill);

  sorted.forEach(start => {
    const end = start + 4;
    const label = `${start}-${String(end).slice(2)}`;
    const pill = makeAlphaPill(label, state.yearEraFilter === start);
    pill.addEventListener('click', () => {
      state.yearEraFilter = start;
      state.selectedYear = null;
      renderYear();
      updateStatBanner();
    });
    frag.appendChild(pill);
  });

  el.yearEraBar.appendChild(frag);
}

function renderYearDiscoverTray(eraFilteredDocs) {
  el.yearDiscoverSection.classList.toggle('open', state.yearDiscoverOpen);

  // Month pills (row 1) — calendar order, only months with shows
  const presentMonths = new Set(eraFilteredDocs.map(d => dateParts(d.date)?.m).filter(Boolean));
  el.yearMonthPills.innerHTML = '';
  const mFrag = document.createDocumentFragment();
  const allMonth = makeAlphaPill('All', state.yearMonthFilter === null);
  allMonth.addEventListener('click', () => {
    state.yearMonthFilter = null; state.yearDayFilter = null; state.selectedYear = null;
    renderYear(); updateStatBanner();
  });
  mFrag.appendChild(allMonth);
  for (let m = 1; m <= 12; m++) {
    if (!presentMonths.has(m)) continue;
    const pill = makeAlphaPill(MONTH_LABELS[m - 1], state.yearMonthFilter === m);
    pill.addEventListener('click', () => {
      state.yearMonthFilter = m; state.yearDayFilter = null; state.selectedYear = null;
      renderYear(); updateStatBanner();
    });
    mFrag.appendChild(pill);
  }
  el.yearMonthPills.appendChild(mFrag);

  // Day-of-month pills (row 2) — rescoped by selected month
  const daySource = state.yearMonthFilter !== null
    ? eraFilteredDocs.filter(d => dateParts(d.date)?.m === state.yearMonthFilter)
    : eraFilteredDocs;
  const presentDays = new Set(daySource.map(d => dateParts(d.date)?.d).filter(Boolean));
  el.yearDayPills.innerHTML = '';
  const dFrag = document.createDocumentFragment();
  const allDay = makeAlphaPill('All', state.yearDayFilter === null);
  allDay.addEventListener('click', () => {
    state.yearDayFilter = null; state.selectedYear = null;
    renderYear(); updateStatBanner();
  });
  dFrag.appendChild(allDay);
  for (let d = 1; d <= 31; d++) {
    if (!presentDays.has(d)) continue;
    const pill = makeAlphaPill(String(d), state.yearDayFilter === d);
    pill.addEventListener('click', () => {
      state.yearDayFilter = d; state.selectedYear = null;
      renderYear(); updateStatBanner();
    });
    dFrag.appendChild(pill);
  }
  el.yearDayPills.appendChild(dFrag);

  // Day-of-week pills (row 3) — Sun→Sat, rescoped by month+day selection
  const dowSource = daySource.filter(d => state.yearDayFilter === null || dateParts(d.date)?.d === state.yearDayFilter);
  const presentDows = new Set(dowSource.map(d => dateParts(d.date)?.dow).filter(n => n !== null && n !== undefined));
  el.yearDowPills.innerHTML = '';
  const wFrag = document.createDocumentFragment();
  const allDow = makeAlphaPill('All', state.yearDowFilter === null);
  allDow.addEventListener('click', () => {
    state.yearDowFilter = null; state.selectedYear = null;
    renderYear(); updateStatBanner();
  });
  wFrag.appendChild(allDow);
  for (let w = 0; w <= 6; w++) {
    if (!presentDows.has(w)) continue;
    const pill = makeAlphaPill(DOW_LABELS[w], state.yearDowFilter === w);
    pill.addEventListener('click', () => {
      state.yearDowFilter = w; state.selectedYear = null;
      renderYear(); updateStatBanner();
    });
    wFrag.appendChild(pill);
  }
  el.yearDowPills.appendChild(wFrag);
}

function renderYear() {
  const index = state.index;
  const allByYear = groupBy(index, d => (d.date || d.year || '').toString().slice(0, 4))
    .filter(([y]) => y && y.length === 4)
    .sort((a, b) => a[0] - b[0]); // ascending

  let byYear = allByYear;

  if (state.searching && state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    byYear = byYear.filter(([y]) => y.includes(q));
    if (state.selectedYear && !byYear.find(([y]) => y === state.selectedYear)) {
      state.selectedYear = null;
    }
  }

  if (state.yearEraFilter !== null) {
    const start = state.yearEraFilter;
    byYear = byYear.filter(([y]) => { const yr = parseInt(y); return yr >= start && yr < start + 5; });
    if (state.selectedYear && !byYear.find(([y]) => y === state.selectedYear)) {
      state.selectedYear = null;
    }
  }

  // Snapshot era-filtered docs for the discover tray (before month/day/dow)
  const eraFilteredDocs = byYear.flatMap(([, docs]) => docs);

  // Month / day-of-month / day-of-week filters
  if (state.yearMonthFilter !== null || state.yearDayFilter !== null || state.yearDowFilter !== null) {
    byYear = byYear.map(([y, docs]) => [
      y,
      docs.filter(d => {
        const p = dateParts(d.date);
        if (!p) return false;
        if (state.yearMonthFilter !== null && p.m !== state.yearMonthFilter) return false;
        if (state.yearDayFilter   !== null && p.d !== state.yearDayFilter)   return false;
        if (state.yearDowFilter   !== null && p.dow !== state.yearDowFilter) return false;
        return true;
      })
    ]).filter(([, docs]) => docs.length > 0);
    if (state.selectedYear && !byYear.find(([y]) => y === state.selectedYear)) state.selectedYear = null;
  }

  renderYearEraPills(allByYear);
  renderYearDiscoverTray(eraFilteredDocs);

  const allYearDocs = byYear.flatMap(([, docs]) => docs);

  el.yearList.innerHTML = '';
  const frag = document.createDocumentFragment();

  const allYearItem = makeArtistItem('All', allYearDocs.length, state.selectedYear === null);
  allYearItem.addEventListener('click', () => selectYear(null, allYearDocs));
  frag.appendChild(allYearItem);

  byYear.forEach(([year, docs]) => {
    const item = makeArtistItem(year, docs.length, state.selectedYear === year);
    item.addEventListener('click', () => selectYear(year, docs));
    frag.appendChild(item);
  });
  el.yearList.appendChild(frag);

  if (state.selectedYear) {
    const entry = byYear.find(([y]) => y === state.selectedYear);
    renderYearConcerts(dateAsc(entry?.[1] || []));
  } else {
    renderYearConcerts(dateAsc(allYearDocs));
  }
}

function selectYear(year, docs) {
  state.selectedYear = year;
  el.yearList.querySelectorAll('.artist-item').forEach((item, i) => {
    const isAll = i === 0;
    item.classList.toggle('selected', year === null ? isAll : item.querySelector('.artist-name').textContent === year);
  });
  renderYearConcerts(dateAsc(docs));
  updateStatBanner();
}

function renderYearConcerts(docs) {
  el.yearConcerts.innerHTML = '';
  if (!docs.length) {
    el.yearConcerts.innerHTML = '<li class="empty-msg">No concerts.</li>';
    return;
  }
  appendConcertRows(el.yearConcerts, docs, doc => openConcert(doc));
}

// ── Venue tab ──────────────────────────────────────────────────────
function renderVenue() {
  const index = state.index;
  const allByVenue = groupBy(index, d => extractVenueName(d) || '__none__')
    .filter(([v]) => v !== '__none__')
    .sort((a, b) => a[0].localeCompare(b[0]));

  // Build neighborhood map from unique venues (for discover tray)
  const nbhdMap = {};
  allByVenue.forEach(([venueName, docs]) => {
    const n = getVenueNeighborhood(venueName);
    if (!n) return;
    (nbhdMap[n] = nbhdMap[n] || []).push(...docs);
  });
  const neighborhoods = Object.keys(nbhdMap).sort();

  let byVenue = allByVenue;

  if (state.searching && state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    byVenue = byVenue.filter(([v]) => v.toLowerCase().includes(q));
    if (state.selectedVenue && !byVenue.find(([v]) => v === state.selectedVenue)) {
      state.selectedVenue = null;
    }
  }

  // Discover neighborhood + era filters
  if (state.venueDiscoverNeighborhood) {
    byVenue = byVenue.filter(([v]) => getVenueNeighborhood(v) === state.venueDiscoverNeighborhood);
  }
  if (state.venueDiscoverEra !== null) {
    const s = state.venueDiscoverEra;
    byVenue = byVenue
      .map(([v, docs]) => [v, docs.filter(d => { const yr = parseInt((d.date||'').slice(0,4)); return yr >= s && yr < s + 5; })])
      .filter(([, docs]) => docs.length > 0);
  }
  if ((state.venueDiscoverNeighborhood || state.venueDiscoverEra !== null) &&
      state.selectedVenue && !byVenue.find(([v]) => v === state.selectedVenue)) {
    state.selectedVenue = null;
  }

  if (state.venueLetterFilter) {
    const letter = state.venueLetterFilter;
    byVenue = byVenue.filter(([v]) =>
      v.replace(/^the\s+/i, '').charAt(0).toUpperCase() === letter
    );
    if (state.selectedVenue && !byVenue.find(([v]) => v === state.selectedVenue)) {
      state.selectedVenue = null;
    }
  }

  renderVenueAlphaPills(allByVenue);
  renderVenueDiscoverTray(neighborhoods, nbhdMap);

  el.venueList.innerHTML = '';
  if (!byVenue.length) {
    el.venueList.innerHTML = '<li class="empty-msg">No venues found.</li>';
    return;
  }

  const allVenueDocs = byVenue.flatMap(([, docs]) => docs);
  const frag = document.createDocumentFragment();

  const allVenueItem = makeArtistItem('All', allVenueDocs.length, state.selectedVenue === null);
  allVenueItem.addEventListener('click', () => selectVenue(null, allVenueDocs));
  frag.appendChild(allVenueItem);

  byVenue.forEach(([venue, docs]) => {
    const item = makeArtistItem(venue, docs.length, state.selectedVenue === venue);
    const years = docs.map(d => (d.date || '').slice(0, 4)).filter(Boolean).sort();
    if (years.length) {
      item.querySelector('.artist-count').textContent =
        `${years[0]}${years[0] !== years[years.length - 1] ? ` – ${years[years.length - 1]}` : ''} • ${docs.length} show${docs.length !== 1 ? 's' : ''}`;
    }
    item.addEventListener('click', () => selectVenue(venue, docs));
    frag.appendChild(item);
  });
  el.venueList.appendChild(frag);

  if (state.selectedVenue) {
    const entry = byVenue.find(([v]) => v === state.selectedVenue);
    renderVenueConcerts(dateAsc(entry?.[1] || []));
  } else {
    renderVenueConcerts(dateAsc(allVenueDocs));
  }
}

function selectVenue(venue, docs) {
  state.selectedVenue = venue;
  el.venueList.querySelectorAll('.artist-item').forEach((item, i) => {
    const isAll = i === 0;
    item.classList.toggle('selected', venue === null ? isAll : item.querySelector('.artist-name').textContent === venue);
  });
  renderVenueConcerts(dateAsc(docs));
  updateStatBanner();
}

function renderVenueAlphaPills(allByVenue) {
  const letters = new Set();
  allByVenue.forEach(([v]) => {
    const ch = v.replace(/^the\s+/i, '').charAt(0).toUpperCase();
    if (ch >= 'A' && ch <= 'Z') letters.add(ch);
  });
  const sorted = [...letters].sort();

  el.venueAlphaBar.innerHTML = '';
  const frag = document.createDocumentFragment();

  const allPill = makeAlphaPill('All', state.venueLetterFilter === null);
  allPill.addEventListener('click', () => {
    state.venueLetterFilter = null;
    state.selectedVenue = null;
    renderVenue();
    updateStatBanner();
  });
  frag.appendChild(allPill);

  sorted.forEach(letter => {
    const pill = makeAlphaPill(letter, state.venueLetterFilter === letter);
    pill.addEventListener('click', () => {
      state.venueLetterFilter = letter;
      state.selectedVenue = null;
      renderVenue();
      updateStatBanner();
    });
    frag.appendChild(pill);
  });

  el.venueAlphaBar.appendChild(frag);
}

function renderVenueDiscoverTray(neighborhoods, nbhdMap) {
  el.venueDiscoverSection.classList.toggle('open', state.venueDiscoverOpen);

  // Neighborhood pills
  el.venueNbhdPills.innerHTML = '';
  const nbhdFrag = document.createDocumentFragment();
  const allNbhd = makeAlphaPill('All', !state.venueDiscoverNeighborhood);
  allNbhd.addEventListener('click', () => {
    state.venueDiscoverNeighborhood = null;
    state.venueDiscoverEra = null;
    state.selectedVenue = null;
    renderVenue(); updateStatBanner();
  });
  nbhdFrag.appendChild(allNbhd);
  neighborhoods.forEach(n => {
    const pill = makeAlphaPill(n, state.venueDiscoverNeighborhood === n);
    pill.addEventListener('click', () => {
      state.venueDiscoverNeighborhood = n;
      state.venueDiscoverEra = null;
      state.selectedVenue = null;
      renderVenue(); updateStatBanner();
    });
    nbhdFrag.appendChild(pill);
  });
  el.venueNbhdPills.appendChild(nbhdFrag);

  // Era pills — 5-year increments present in selected neighborhood (or all)
  const eraSource = state.venueDiscoverNeighborhood
    ? nbhdMap[state.venueDiscoverNeighborhood] || []
    : Object.values(nbhdMap).flat();
  const presentYears = new Set(eraSource.map(d => parseInt((d.date||'').slice(0,4))).filter(n => !isNaN(n)));
  const eraStarts = [...new Set([...presentYears].map(y => Math.floor(y / 5) * 5))].sort((a, b) => a - b);

  el.venueEraPills.innerHTML = '';
  const eraFrag = document.createDocumentFragment();
  const allEra = makeAlphaPill('All', state.venueDiscoverEra === null);
  allEra.addEventListener('click', () => {
    state.venueDiscoverEra = null;
    state.selectedVenue = null;
    renderVenue(); updateStatBanner();
  });
  eraFrag.appendChild(allEra);
  eraStarts.forEach(start => {
    const label = `${start}-${String(start + 4).slice(2)}`;
    const pill = makeAlphaPill(label, state.venueDiscoverEra === start);
    pill.addEventListener('click', () => {
      state.venueDiscoverEra = start;
      state.selectedVenue = null;
      renderVenue(); updateStatBanner();
    });
    eraFrag.appendChild(pill);
  });
  el.venueEraPills.appendChild(eraFrag);
}

function renderVenueConcerts(docs) {
  el.venueConcerts.innerHTML = '';
  if (!docs.length) {
    el.venueConcerts.innerHTML = '<li class="empty-msg">No concerts.</li>';
    return;
  }
  appendConcertRows(el.venueConcerts, docs, doc => openConcert(doc));
}

function discoverSection(title, count, onRefresh) {
  const sec = document.createElement('div');
  sec.className = 'discover-section';
  const rightParts = [
    count     ? `<span class="discover-section-count">${esc(count)}</span>` : '',
    onRefresh ? `<button class="discover-refresh-btn" aria-label="Refresh">↺</button>` : '',
  ].filter(Boolean).join('');
  sec.innerHTML = `
    <div class="discover-section-header">
      <div class="discover-section-title">${esc(title)}</div>
      ${rightParts ? `<div class="discover-section-header-right">${rightParts}</div>` : ''}
    </div>
  `;
  if (onRefresh) sec.querySelector('.discover-refresh-btn').addEventListener('click', onRefresh);
  return sec;
}

function openFilteredList(label, docs) {
  state.prevMode  = state.mode;
  state.inFiltered = true;
  el.backBtn.classList.add('visible');
  el.modeBar.classList.add('hidden');
  el.sortBar.classList.add('hidden');
  el.searchInput.classList.add('search-hidden');
  el.searchClear.style.display = 'none';
  showView('filtered');
  el.viewFiltered.scrollTop = 0;

  el.filteredList.innerHTML = '';
  const labelEl = document.createElement('div');
  labelEl.className = 'filtered-list-label';
  labelEl.textContent = `${docs.length} show${docs.length !== 1 ? 's' : ''}`;
  el.filteredList.appendChild(labelEl);
  appendConcertRows(el.filteredList, docs, doc => openConcert(doc));
}

function findHiResArt(files) {
  // services/img serves a JPEG Thumb derivative; its 'original' field is the hi-res source
  const thumb = (files || []).find(f => f.format === 'JPEG Thumb');
  if (thumb?.original) {
    return (files || []).find(f => f.name === thumb.original) || null;
  }
  return null;
}

function groupBy(arr, keyFn) {
  const map = new Map();
  arr.forEach(item => {
    const k = keyFn(item);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(item);
  });
  return [...map.entries()];
}

function extractVenueName(doc) {
  // Try coverage field first, then parse from title
  if (doc.coverage && doc.coverage.trim()) return doc.coverage.trim();
  const title = doc.title || '';
  const m = title.match(/(?:live\s+)?at\s+([^,\d\(\[]+?)(?:\s+on\s+|\s+\d{4}|\s*[,\(\[\-]|$)/i);
  return m ? m[1].trim() : null;
}

function extractVenues(index) {
  return [...new Set(index.map(d => extractVenueName(d)).filter(Boolean))];
}

function flashConfirm(msg) {
  const toast = document.createElement('div');
  toast.textContent = msg;
  Object.assign(toast.style, {
    position: 'fixed', bottom: '90px', left: '50%', transform: 'translateX(-50%)',
    background: 'var(--bg3)', color: 'var(--text)', padding: '10px 18px',
    borderRadius: '20px', fontSize: '14px', zIndex: '200',
    border: '1px solid var(--border)', pointerEvents: 'none',
  });
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2000);
}

// ── Back navigation ────────────────────────────────────────────────
function goBack() {
  el.searchInput.classList.remove('search-hidden');
  if (state.inFiltered) {
    state.inFiltered = false;
    state.inConcert = false;
    setMode(state.prevMode);
    return;
  }
  state.inConcert = false;
  setMode(state.prevMode);
}

// ── Now Playing Bar ────────────────────────────────────────────────
// ── Day context (weather + Wikipedia) ─────────────────────────────

const _contextCache = new Map();

const WMO = {
  0:'clear', 1:'mostly clear', 2:'partly cloudy', 3:'overcast',
  45:'foggy', 48:'icy fog',
  51:'light drizzle', 53:'drizzle', 55:'heavy drizzle',
  61:'light rain', 63:'rain', 65:'heavy rain',
  71:'light snow', 73:'snow', 75:'heavy snow',
  80:'showers', 81:'showers', 82:'heavy showers',
  95:'thunderstorms',
};
function wmoDesc(c) { return WMO[c] || WMO[Math.floor(c/10)*10] || 'variable'; }

async function fetchDayContext(dateStr) {
  if (_contextCache.has(dateStr)) return _contextCache.get(dateStr);
  let result = null;
  try {
    const url = `https://archive-api.open-meteo.com/v1/archive?latitude=41.8781&longitude=-87.6298&start_date=${dateStr}&end_date=${dateStr}&daily=temperature_2m_max,temperature_2m_min,weathercode,sunset&timezone=America%2FChicago&temperature_unit=fahrenheit`;
    const d = await fetch(url).then(r => r.json());
    if (d.daily?.temperature_2m_max?.[0] != null) {
      const hi = Math.round(d.daily.temperature_2m_max[0]);
      let sunset = null;
      const sunsetRaw = d.daily.sunset?.[0];
      if (sunsetRaw) {
        const [h, mn] = sunsetRaw.split('T')[1].split(':').map(Number);
        sunset = `${h % 12 || 12}:${String(mn).padStart(2, '0')}`;
      }
      result = { condition: wmoDesc(d.daily.weathercode[0]), hi, sunset };
    }
  } catch {}
  _contextCache.set(dateStr, result);
  return result;
}

function updateBar() {
  const t = player.currentTrack;
  if (!t) { el.nowBar.classList.remove('visible'); return; }
  el.nowBar.classList.add('visible');
  el.barArt.src = `https://archive.org/services/img/${t.identifier}`;
  el.barTitle.textContent = t.title;
  const datePart   = t.date ? formatDate(t.date) : '';
  const artistPart = t.artist || '';
  const doc        = state.index?.find(d => d.identifier === t.identifier);
  const venuePart  = doc ? (extractVenueName(doc) || '') : '';
  const subtext    = [artistPart, datePart, venuePart].filter(Boolean).join(' · ');
  const inner      = document.createElement('span');
  inner.className  = 'bar-artist-inner';
  inner.textContent = subtext;
  el.barArtist.innerHTML = '';
  el.barArtist.appendChild(inner);
  requestAnimationFrame(() => {
    if (inner.offsetWidth > el.barArtist.clientWidth) {
      inner.textContent = subtext + '      ' + subtext;
      inner.classList.add('scrolling');
    }
  });
  el.barPlay.innerHTML = player.paused ? svgPlay() : svgPause();
}

function updateProgress() {
  const { currentTime, duration } = player;
  const pct = duration > 0 ? (currentTime / duration) * 100 : 0;
  el.barFill.style.width = `${pct}%`;
  el.barElapsed.textContent = formatDuration(currentTime);
  if (duration > 0) {
    el.barRemaining.textContent = `-${formatDuration(duration - currentTime)}`;
  }
}

function updateTrackHighlight() {
  document.querySelectorAll('.track-item').forEach(li => {
    li.classList.toggle('playing', li.dataset.url === player.currentTrack?.url);
  });
}

// ── Queue sheet ────────────────────────────────────────────────────
function openQueue() {
  renderQueue();
  el.queueSheet.classList.add('visible');
  requestAnimationFrame(() => {
    const cur = el.queueList.querySelector('.queue-item.current');
    if (cur) cur.scrollIntoView({ block: 'center' });
  });
}

function renderQueue() {
  const { queue, currentIndex } = player;

  if (!queue.length) {
    el.queueList.innerHTML = '<li class="empty-msg">Queue is empty.</li>';
    return;
  }
  el.queueList.innerHTML = '';
  queue.forEach((track, i) => {
    const li = document.createElement('li');
    li.className = 'queue-item' + (i === currentIndex ? ' current' : '');
    li.innerHTML = `
      <div class="queue-track-info">
        <div class="queue-track-title">${esc(track.title)}</div>
        <div class="queue-track-meta">${esc(track.artist || '')}</div>
      </div>
      <button class="queue-menu-btn" data-i="${i}" aria-label="Options">···</button>
    `;
    if (i !== currentIndex) {
      li.style.cursor = 'pointer';
      li.addEventListener('click', e => {
        if (e.target.classList.contains('queue-menu-btn')) return;
        player.replaceQueue(player.queue, i);
        renderQueue();
      });
    }
    el.queueList.appendChild(li);
  });
  el.queueList.querySelectorAll('.queue-menu-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      openQueueItemMenu(player.queue[Number(btn.dataset.i)], Number(btn.dataset.i));
    });
  });
}

// ── Queue item menu ────────────────────────────────────────────────
let _queueMenuTrack = null;
let _queueMenuIndex = -1;

function openQueueItemMenu(track, index) {
  _queueMenuTrack = track;
  _queueMenuIndex = index;
  el.queueItemTitle.textContent = track.title;
  el.queueItemSheet.classList.add('visible');
}

function closeQueueItemMenu() {
  el.queueItemSheet.classList.remove('visible');
  _queueMenuTrack = null;
  _queueMenuIndex = -1;
}

// ── Settings ───────────────────────────────────────────────────────
function openSettings() {
  el.collectionInput.value = state.collectionId;
  const count = getFavIds().length;
  $('favs-hint').textContent = `You have saved ${count} favorite${count !== 1 ? 's' : ''}. This app stores all data locally. To backup or to migrate your favorites to another browser, use the "Export Favorites Link" above and copy the provided URL.`;
  el.settingsSheet.classList.add('visible');
}

// ── Init ───────────────────────────────────────────────────────────
function init() {
  // Back
  el.backBtn.addEventListener('click', goBack);

  // Mode tabs
  el.modeBar.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => setMode(btn.dataset.mode));
  });

  // Sort
  buildSortBar();

  // Load more (client-side pagination)
  el.loadMore.addEventListener('click', () => {
    state.displayPage++;
    renderLibrary();
    // Scroll to where we were
  });

  // Year "Months and Days" tray toggle
  el.yearDiscoverToggle.addEventListener('click', () => {
    state.yearDiscoverOpen = !state.yearDiscoverOpen;
    if (state.index) renderYear();
  });

  // Artist "Shows and Eras" tray toggle
  el.artistDiscoverToggle.addEventListener('click', () => {
    state.artistDiscoverOpen = !state.artistDiscoverOpen;
    if (state.index) renderArtistView();
  });

  // Venue "Neighborhoods and Eras" tray toggle
  el.venueDiscoverToggle.addEventListener('click', () => {
    state.venueDiscoverOpen = !state.venueDiscoverOpen;
    if (state.index) renderVenue();
  });

  // Favs "Shows, Eras and Neighborhoods" tray toggle
  el.favDiscoverToggle.addEventListener('click', () => {
    state.favDiscoverOpen = !state.favDiscoverOpen;
    if (state.index) renderFavorites();
  });

  // Your Archive sheet (header heart button)
  el.archiveBtn.addEventListener('click', () => {
    const ids = new Set(getFavIds());
    const favDocs = state.index ? state.index.filter(d => ids.has(d.identifier)) : [];
    buildArchiveSheet(favDocs);
    el.archiveSheet.classList.add('visible');
  });
  el.archiveClose.addEventListener('click', () => el.archiveSheet.classList.remove('visible'));

  // Search (persistent input — no toggle)
  el.searchInput.addEventListener('focus', () => {
    el.searchInput.placeholder = SEARCH_PLACEHOLDERS[state.mode] || 'Search…';
    if (!el.searchInput.value) showSearchHistory();
  });
  el.searchInput.addEventListener('blur', () => {
    if (state.searchQuery) addToSearchHistory(state.searchQuery);
    setTimeout(hideSearchHistory, 200);
  });
  el.searchInput.addEventListener('input', onSearchInput);
  el.searchInput.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeSearch(); return; }
    if (e.key === 'Enter' && state.searchQuery) addToSearchHistory(state.searchQuery);
  });

  el.searchClear.addEventListener('click', () => {
    el.searchInput.value = '';
    el.searchClear.style.display = 'none';
    hideSearchHistory();
    closeSearch();
  });

  // Player bar
  el.barDiscover.addEventListener('click', () => {
    el.queueSheet.classList.remove('visible');
    setMode('discover');
  });
  el.barPlay.addEventListener('click', () => { player.toggle(); updateBar(); });
  el.barPrev.addEventListener('click', () => player.prev());
  el.barNext.addEventListener('click', () => player.next());
  el.barQueue.addEventListener('click', openQueue);
  el.barInfo.addEventListener('click', () => {
    const t = player.currentTrack;
    if (!t) return;
    const doc = state.index?.find(d => d.identifier === t.identifier);
    if (doc) {
      el.queueSheet.classList.remove('visible');
      openConcert(doc);
    }
  });

  el.barProgress.addEventListener('click', e => {
    const r = el.barProgress.getBoundingClientRect();
    player.seek((e.clientX - r.left) / r.width);
  });

  // Track action sheet
  el.trackActionPlay.addEventListener('click', () => { if (_actionTrack) { player.addNext(_actionTrack); flashConfirm('Playing next'); } closeTrackAction(); });
  el.trackActionQueue.addEventListener('click', () => { if (_actionTrack) { player.addToEnd(_actionTrack); flashConfirm('Added to queue'); } closeTrackAction(); });
  el.trackActionArtist.addEventListener('click', () => {
    if (!_actionTrack) return;
    const artistName = _actionTrack.artist;
    const docs = state.index?.filter(d => d.creator === artistName) || [];
    closeTrackAction();
    setMode('artists');
    state.selectedArtist = { name: artistName, docs };
    renderArtistView();
  });
  el.trackActionCancel.addEventListener('click', closeTrackAction);
  el.trackActionSheet.addEventListener('click', e => { if (e.target === el.trackActionSheet) closeTrackAction(); });

  // Queue
  el.queueClear.addEventListener('click', () => { player.clearQueue(); el.queueSheet.classList.remove('visible'); });
  el.queueClose.addEventListener('click', () => el.queueSheet.classList.remove('visible'));

  // Settings
  el.helpBtn.addEventListener('click', () => el.helpSheet.classList.add('visible'));
  el.helpClose.addEventListener('click', () => el.helpSheet.classList.remove('visible'));
  el.settingsBtn.addEventListener('click', openSettings);
  el.settingsClose.addEventListener('click', () => el.settingsSheet.classList.remove('visible'));
  el.favsExport.addEventListener('click', () => {
    const ids = getFavIds();
    if (!ids.length) { flashConfirm('No favorites yet.'); return; }
    const url = encodeFavsHash();
    navigator.clipboard?.writeText(url).then(() => {
      flashConfirm(`Copied! (${ids.length} favorites)`);
    }).catch(() => flashConfirm('Could not copy — try again'));
  });

  el.favsExportJson.addEventListener('click', () => {
    const ids = getFavIds();
    if (!ids.length) { flashConfirm('No favorites yet.'); return; }
    const json = JSON.stringify(ids, null, 2);
    navigator.clipboard?.writeText(json).then(() => {
      flashConfirm(`Copied! (${ids.length} favorites)`);
    }).catch(() => flashConfirm('Could not copy — try again'));
  });

  el.favsExportCsv.addEventListener('click', () => {
    const ids = new Set(getFavIds());
    if (!ids.size) { flashConfirm('No favorites yet.'); return; }
    const favDocs = (state.index || []).filter(d => ids.has(d.identifier));
    const csvCell = s => `"${(s || '').replace(/"/g, '""')}"`;
    const rows = [['Title', 'Artist', 'Date', 'Year', 'Venue', 'Archive Link']];
    for (const d of favDocs) {
      rows.push([
        csvCell(d.title),
        csvCell(d.creator),
        d.date || '',
        (d.date || '').slice(0, 4),
        csvCell(extractVenueName(d)),
        `https://archive.org/details/${d.identifier}`,
      ]);
    }
    if (rows.length <= 1) { flashConfirm('No data found.'); return; }
    const csv = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'favorites.csv';
    a.click();
    URL.revokeObjectURL(url);
    flashConfirm(`Downloaded ${rows.length - 1} shows`);
  });

  // Queue item action sheet
  el.queueItemShow.addEventListener('click', () => {
    if (!_queueMenuTrack) return;
    const doc = state.index?.find(d => d.identifier === _queueMenuTrack.identifier);
    closeQueueItemMenu();
    el.queueSheet.classList.remove('visible');
    if (doc) openConcert(doc);
  });
  el.queueItemArtist.addEventListener('click', () => {
    if (!_queueMenuTrack) return;
    const artistName = _queueMenuTrack.artist;
    const docs = state.index?.filter(d => d.creator === artistName) || [];
    closeQueueItemMenu();
    el.queueSheet.classList.remove('visible');
    setMode('artists');
    state.selectedArtist = { name: artistName, docs };
    renderArtistView();
  });
  el.queueItemRemove.addEventListener('click', () => {
    if (_queueMenuIndex < 0) return;
    player.removeFromQueue(_queueMenuIndex);
    closeQueueItemMenu();
    renderQueue();
  });
  el.queueItemCancel.addEventListener('click', closeQueueItemMenu);
  el.queueItemSheet.addEventListener('click', e => { if (e.target === el.queueItemSheet) closeQueueItemMenu(); });

  el.favsImport.addEventListener('click', () => {
    const pasted = el.favsImportInput.value.trim();
    const match = pasted.match(/#favs=(.+)$/);
    if (!match) { flashConfirm('No favorites found in that link.'); return; }
    const ids = match[1].split(',').map(decodeURIComponent).filter(Boolean);
    if (!ids.length) { flashConfirm('No favorites found in that link.'); return; }
    importFavIds(ids);
    el.favsImportInput.value = '';
    el.settingsSheet.classList.remove('visible');
    flashConfirm(`Restored ${ids.length} favorite${ids.length !== 1 ? 's' : ''}`);
  });

  el.settingsSave.addEventListener('click', () => {
    const val = el.collectionInput.value.trim();
    if (!val) return;
    state.collectionId = val;
    localStorage.setItem('collectionId', val);
    el.settingsSheet.classList.remove('visible');
    state.index = null;
    state.selectedArtist = null;
    state.displayPage = 1;
    setMode('discover');
    loadIndex();
  });

  // Player events
  player.on('trackchange', () => { updateBar(); updateTrackHighlight(); });
  player.on('statechange', updateBar);
  player.on('timeupdate',  updateProgress);
  player.on('queuechange', () => {
    if (el.queueSheet.classList.contains('visible')) renderQueue();
  });

  // Restore favorites from share link
  const favsToImport = decodeFavsHash();
  if (favsToImport?.length) {
    importFavIds(favsToImport);
    history.replaceState(null, '', location.pathname);
    flashConfirm(`Restored ${favsToImport.length} favorite${favsToImport.length !== 1 ? 's' : ''}`);
  }

  // Boot
  setMode('discover');
  loadIndex();
}

// ── Helpers ────────────────────────────────────────────────────────
function formatUploadDate(dateStr) {
  if (!dateStr || dateStr.length < 10) return '';
  const [y, m, d] = dateStr.slice(0, 10).split('-');
  return `${m}-${d}-${y.slice(2)}`;
}

function formatDate(s) {
  if (!s) return '';
  const d = s.slice(0, 10);
  const [y, m, day] = d.split('-');
  if (!y || !m || !day) return d;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[+m - 1]} ${+day}, ${y}`;
}

function formatDateWithDay(s) {
  if (!s) return '';
  const d = s.slice(0, 10);
  const [y, m, day] = d.split('-');
  if (!y || !m || !day) return d;
  const dt = new Date(`${d}T12:00:00Z`);
  const dow = dt.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${dow}, ${months[+m - 1]} ${+day}, ${y}`;
}

function formatDateBill(s) {
  if (!s || s.length < 10) return '';
  const d = s.slice(0, 10);
  const [y, m, day] = d.split('-');
  if (!y || !m || !day) return d;
  const dt = new Date(`${d}T12:00:00Z`);
  const dow = dt.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${dow} · ${months[+m - 1]} ${+day}, ${y}`;
}

function stripExt(name) { return name.replace(/\.[^.]+$/, ''); }

function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Minimal markdown → HTML: **bold**, *italic*, no other transformations.
function renderMd(s) {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>');
}

function flashBtn(btn) {
  const orig = btn.textContent;
  btn.textContent = '✓';
  btn.style.color = 'var(--accent)';
  setTimeout(() => { btn.textContent = orig; btn.style.color = ''; }, 800);
}

// ── SVG icons ──────────────────────────────────────────────────────
function svgPlay()    { return `<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>`; }
function svgPause()   { return `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`; }
function svgChevron() { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9,18 15,12 9,6"/></svg>`; }

init();

// ── Add to Home Screen prompt ──────────────────────────────────────
if (/iPhone|iPad|iPod/.test(navigator.userAgent) &&
    !window.navigator.standalone &&
    !localStorage.getItem('ntlb-a2hs')) {
  setTimeout(() => {
    const overlay = document.getElementById('a2hs-overlay');
    if (!overlay) return;
    overlay.classList.add('visible');
    document.getElementById('a2hs-dismiss').addEventListener('click', () => {
      localStorage.setItem('ntlb-a2hs', '1');
      overlay.classList.remove('visible');
    });
  }, 2000);
}
