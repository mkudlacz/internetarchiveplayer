import { DEFAULT_COLLECTION, loadFullIndex, getItemMetadata, getStreamUrl, getAudioFiles, formatDuration } from './api.js';
import player from './player.js';
import { isFav, toggleFav, getFavIds, importFavIds, encodeFavsHash, decodeFavsHash } from './favorites.js';

// ── Chicago history ────────────────────────────────────────────────
let HISTORY = {};
fetch('./js/chicago-history.json').then(r => r.json()).then(d => { HISTORY = d; }).catch(() => {});

// ── Artist context ─────────────────────────────────────────────────
let ARTIST_CONTEXT = {};
fetch('./js/artist-context.json').then(r => r.json()).then(d => { ARTIST_CONTEXT = d; }).catch(() => {});

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
  selectedArtist:   null,   // { name, docs[] } or null = all
  selectedFavArtist: null,  // artist name string
  selectedYear:     null,   // year string e.g. "1995"
  selectedVenue:    null,   // venue string
  currentConcert:   null,
};

const PAGE_SIZE = 50;

// ── DOM refs ───────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const el = {
  backBtn:        $('back-btn'),
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
  artistList:     $('artist-list'),
  artistConcerts: $('artist-concerts'),
  viewDiscover:       $('view-discover'),
  viewYear:           $('view-year'),
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
    } else {
      const uniqueVenues = new Set(index.map(d => extractVenueName(d)).filter(Boolean)).size;
      el.statBanner.textContent = `${uniqueVenues} venues · ${index.length} shows`;
    }
    return;
  }
  if (mode === 'year') {
    if (selectedYear) {
      const docs = index.filter(d => (d.date || '').slice(0, 4) === selectedYear);
      el.statBanner.textContent = `${docs.length} show${docs.length !== 1 ? 's' : ''} · ${selectedYear}`;
    } else {
      const uniqueYears = new Set(index.map(d => (d.date || '').slice(0, 4)).filter(Boolean)).size;
      el.statBanner.textContent = `${uniqueYears} years · ${index.length} shows`;
    }
    return;
  }
  if (mode === 'favorites') {
    const ids = new Set(getFavIds());
    const total = ids.size;
    if (selectedFavArtist) {
      const count = index.filter(d => ids.has(d.identifier) && d.creator === selectedFavArtist).length;
      el.statBanner.textContent = `${count} show${count !== 1 ? 's' : ''} · ${selectedFavArtist}`;
    } else {
      el.statBanner.textContent = `${total} favorited show${total !== 1 ? 's' : ''}`;
    }
    return;
  }
  const uniqueArtists = new Set(index.map(d => d.creator).filter(Boolean)).size;
  const uniqueVenues  = new Set(index.map(d => extractVenueName(d)).filter(Boolean)).size;
  const uniqueYears   = new Set(index.map(d => (d.date || '').slice(0, 4)).filter(Boolean)).size;
  el.statBanner.textContent = `${index.length.toLocaleString()} shows · ${uniqueArtists} artists · ${uniqueVenues} venues · ${uniqueYears} years`;
}

function collectionName() {
  return state.collectionId === DEFAULT_COLLECTION ? 'No Tape Left Behind Collection' : state.collectionId;
}

// ── Index loading ──────────────────────────────────────────────────
async function loadIndex() {
  el.viewDiscover.innerHTML = '<div class="spinner"></div>';
  try {
    state.index = await loadFullIndex(state.collectionId);
    state.displayPage = 1;
    updateStatBanner();
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
    li.innerHTML = `
      <div class="concert-info">
        <div class="concert-date">${formatDate(doc.date)}</div>
        <div class="concert-title">${esc(doc.title || doc.identifier)}</div>
        <div class="concert-creator">${esc(doc.creator || '')}</div>
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
  let groups = groupByArtist(state.index);

  if (state.searching && state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    groups = groups.filter(([name]) => name.toLowerCase().includes(q));
    // Clear selected artist if it was filtered away
    if (state.selectedArtist && !groups.find(([name]) => name === state.selectedArtist.name)) {
      state.selectedArtist = null;
    }
  }

  const totalVisible = groups.reduce((sum, [, docs]) => sum + docs.length, 0);

  // Left column: artist list
  el.artistList.innerHTML = '';
  const frag = document.createDocumentFragment();

  const allArtistItem = makeArtistItem('All', totalVisible, state.selectedArtist === null);
  allArtistItem.addEventListener('click', () => selectArtist(null));
  frag.appendChild(allArtistItem);

  groups.forEach(([name, docs]) => {
    const item = makeArtistItem(name, docs.length, state.selectedArtist?.name === name);
    item.addEventListener('click', () => selectArtist({ name, docs }));
    frag.appendChild(item);
  });
  el.artistList.appendChild(frag);

  // Right column
  renderArtistConcerts(groups.flatMap(([, docs]) => docs));
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

  const frag = document.createDocumentFragment();
  docs.forEach(doc => {
    const li = document.createElement('li');
    li.className = 'artist-concert-item';
    li.innerHTML = `
      <div class="artist-concert-info">
        <div class="artist-concert-date">${formatDate(doc.date)}</div>
        <div class="artist-concert-title">${esc(doc.title || doc.identifier)}</div>
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
    li.addEventListener('click', () => openConcert(doc));
    frag.appendChild(li);
  });
  el.artistConcerts.appendChild(frag);
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

  let groups = groupByArtist(favDocs).sort((a, b) => a[0].localeCompare(b[0]));

  if (state.searching && state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    groups = groups.filter(([name]) => name.toLowerCase().includes(q));
    if (state.selectedFavArtist && !groups.find(([name]) => name === state.selectedFavArtist)) {
      state.selectedFavArtist = null;
    }
  }

  el.favArtistList.innerHTML = '';
  if (!groups.length) {
    el.favArtistList.innerHTML = `<li class="empty-msg">${
      state.searching && state.searchQuery ? 'No matches.' : 'No favorites yet.<br>Tap ♥ on any concert.'
    }</li>`;
    el.favConcerts.innerHTML = '';
    return;
  }

  const frag = document.createDocumentFragment();

  const allFavItem = makeArtistItem('All', favDocs.length, state.selectedFavArtist === null);
  allFavItem.addEventListener('click', () => selectFavArtist(null, favDocs));
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
    renderFavConcerts(dateAsc(favDocs));
  }
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
        ${venueName ? `<div class="concert-header-venue">${esc(venueName)}</div>` : ''}
        <div class="concert-archive-mini"><a href="https://archive.org/details/${esc(m.identifier)}" target="_blank" rel="noopener">${esc(m.title || m.identifier)}</a></div>
        ${m.addeddate ? `<div class="concert-upload-date">uploaded ${formatUploadDate(m.addeddate)}</div>` : ''}
      </div>
    </div>
    <div id="concert-context-section"></div>
    <div id="concert-snippets-section"></div>
    <div id="concert-also-date"></div>
    <div class="concert-info-block">
      <div class="concert-actions">
        <button class="btn-primary" id="play-all">Play All</button>
        <button class="btn-secondary" id="queue-all">Add to Queue</button>
        <button class="btn-fav${faved ? ' active' : ''}" id="concert-fav" title="Favorite">♥</button>
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

  // From the Artist section
  const concertYear = dateKey ? dateKey.slice(0, 4) : null;
  const artistData = m.creator && concertYear && ARTIST_CONTEXT[m.creator]?.[concertYear];
  if (artistData) {
    const sec = $('concert-snippets-section');
    if (sec) {
      sec.className = 'concert-also';
      let html = `<div class="concert-section-header">From the Artist</div>`;
      if (artistData.blurb) {
        html += `<p class="concert-artist-blurb">${esc(artistData.blurb)}</p>`;
      }
      (artistData.quotes || []).forEach(q => {
        html += `
          <div class="concert-snippet">
            <div class="concert-snippet-quote">“${esc(q.text)}”</div>
            ${q.attr ? `<div class="concert-snippet-attr">— ${esc(q.attr)}</div>` : ''}
          </div>`;
      });
      sec.innerHTML = html;
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

  // ── 2. Popular in the Archive ──
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

    const popularSec = discoverSection('Popular in the Archive', '', () => {
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
        if (countEl) countEl.textContent = popularDocs.length ? `${popularDocs.length} shows` : '';
        if (popularDocs.length) popularSec.appendChild(buildPopularStrip());
      })
      .catch(() => {});
  }

  // ── 3. Time Travel to a Show (multi-artist bills) ──
  {
    if (allBills.length) {
      const buildBillStrip = () => {
        const bills = [...allBills].sort(() => Math.random() - 0.5).slice(0, billLimit);
        const strip = document.createElement('div');
        strip.className = 'discover-h-scroll';
        bills.forEach(([key, docs]) => {
          const [date, venue] = key.split('|');
          const artists = [...new Set(docs.map(d => d.creator))];
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
              const metas     = await Promise.all(docs.map(d => getItemMetadata(d.identifier)));
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

      const sec = discoverSection('Time Travel to a Show', `${allBills.length} multi-artist shows`, () => {
        const old = sec.querySelector('.discover-h-scroll');
        const neo = buildBillStrip();
        if (old) sec.replaceChild(neo, old); else sec.appendChild(neo);
      });
      sec.appendChild(buildBillStrip());
      el.viewDiscover.appendChild(sec);
    }
  }

  // ── 4. New to the Archive ──
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
function renderYear() {
  const index = state.index;
  let byYear = groupBy(index, d => (d.date || d.year || '').toString().slice(0, 4))
    .filter(([y]) => y && y.length === 4)
    .sort((a, b) => a[0] - b[0]); // ascending

  if (state.searching && state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    byYear = byYear.filter(([y]) => y.includes(q));
    if (state.selectedYear && !byYear.find(([y]) => y === state.selectedYear)) {
      state.selectedYear = null;
    }
  }

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
  let byVenue = groupBy(index, d => extractVenueName(d) || '__none__')
    .filter(([v]) => v !== '__none__')
    .sort((a, b) => a[0].localeCompare(b[0]));

  if (state.searching && state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    byVenue = byVenue.filter(([v]) => v.toLowerCase().includes(q));
    if (state.selectedVenue && !byVenue.find(([v]) => v === state.selectedVenue)) {
      state.selectedVenue = null;
    }
  }

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
  const m = title.match(/(?:live\s+)?at\s+([^,\d\(\[]+?)(?:\s+\d{4}|\s*[,\(\[\-]|$)/i);
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
