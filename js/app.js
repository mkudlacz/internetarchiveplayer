import { DEFAULT_COLLECTION, loadFullIndex, getItemMetadata, getStreamUrl, getAudioFiles, formatDuration } from './api.js';
import player from './player.js';
import { isFav, toggleFav, getFavIds, importFavIds, encodeFavsHash, decodeFavsHash } from './favorites.js';

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
  searchToggle:   $('search-toggle'),
  settingsBtn:    $('settings-btn'),
  searchBar:      $('search-bar'),
  searchInput:    $('search-input'),
  searchCancel:   $('search-cancel'),
  modeBar:        $('mode-bar'),
  sortBar:        $('sort-bar'),
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
  trackActionCancel:  $('track-action-cancel'),
  nowBar:         $('now-playing-bar'),
  barTitle:       $('bar-title'),
  barArtist:      $('bar-artist'),
  barContext:     $('bar-context'),
  barPlay:        $('bar-play'),
  barPrev:        $('bar-prev'),
  barNext:        $('bar-next'),
  barProgress:    $('bar-progress'),
  barFill:        $('bar-progress-fill'),
  barInfo:        $('bar-info'),
  barQueue:       $('bar-queue'),
  queueSheet:     $('queue-sheet'),
  queueList:      $('queue-list'),
  queueClear:     $('queue-clear'),
  queueClose:     $('queue-close'),
  settingsSheet:  $('settings-sheet'),
  settingsClose:  $('settings-close'),
  collectionInput: $('collection-input'),
  settingsSave:   $('settings-save'),
  favsExport:     $('favs-export'),
  favsImportInput: $('favs-import-input'),
  favsImport:     $('favs-import'),
};

// ── Sorting ────────────────────────────────────────────────────────
const SORTS = [
  { label: 'Date',   value: 'date desc' },
  { label: 'Artist', value: 'creator asc' },
  { label: 'Title',  value: 'title asc' },
  { label: 'Year',   value: 'year desc' },
];

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

  // Search bar off
  el.searchBar.classList.remove('visible');
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
  el.searchBar.classList.add('visible');
  el.modeBar.classList.add('hidden');
  el.sortBar.classList.add('hidden');
  el.backBtn.classList.remove('visible');
  el.searchInput.placeholder = SEARCH_PLACEHOLDERS[state.mode] || 'Search…';
  renderForSearch();
  requestAnimationFrame(() => el.searchInput.focus());
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
}

function closeSearch() {
  clearTimeout(searchTimer);
  state.searching = false;
  state.searchQuery = '';
  el.searchInput.value = '';
  el.searchBar.classList.remove('visible');
  setMode(state.mode);
}

function onSearchInput() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.searchQuery = el.searchInput.value.trim();
    state.displayPage = 1;
    renderForSearch();
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
}

function renderArtistConcerts(fallbackDocs) {
  const docs = state.selectedArtist
    ? sortDocs(state.selectedArtist.docs)
    : sortDocs(fallbackDocs || state.index);

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
  groups.forEach(([name, docs]) => {
    const item = makeArtistItem(name, docs.length, state.selectedFavArtist === name);
    item.addEventListener('click', () => selectFavArtist(name, docs));
    frag.appendChild(item);
  });
  el.favArtistList.appendChild(frag);

  if (!state.selectedFavArtist && groups.length) {
    const [name, docs] = groups[0];
    state.selectedFavArtist = name;
    el.favArtistList.querySelector('.artist-item')?.classList.add('selected');
    renderFavConcerts(sortDocs(docs));
  } else if (state.selectedFavArtist) {
    const entry = groups.find(([n]) => n === state.selectedFavArtist);
    renderFavConcerts(sortDocs(entry?.[1] || []));
  }
}

function selectFavArtist(name, docs) {
  state.selectedFavArtist = name;
  el.favArtistList.querySelectorAll('.artist-item').forEach(item => {
    item.classList.toggle('selected', item.querySelector('.artist-name').textContent === name);
  });
  renderFavConcerts(sortDocs(docs));
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
  el.searchBar.classList.remove('visible');
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

  el.viewConcert.innerHTML = `
    <div class="concert-header">
      <div class="concert-header-date">${formatDate(m.date)}</div>
      <div class="concert-header-title">${esc(m.title || m.identifier)}</div>
      <div class="concert-header-creator">${esc(m.creator || '')}</div>
      <div class="concert-context" id="concert-context"></div>
      <div class="concert-actions">
        <button class="btn-primary" id="play-all">Play All</button>
        <button class="btn-secondary" id="queue-all">Add to Queue</button>
        <button class="btn-fav${faved ? ' active' : ''}" id="concert-fav" title="Favorite">♥</button>
      </div>
    </div>
    <ul class="track-list" id="track-list"></ul>
  `;

  if (m.date) {
    fetchDayContext(m.date.slice(0, 10)).then(text => {
      const el = $('concert-context');
      if (el && text) el.textContent = text;
    });
  }

  $('concert-fav').addEventListener('click', e => {
    const active = toggleFav(m.identifier);
    e.currentTarget.classList.toggle('active', active);
  });

  $('play-all').addEventListener('click', () => player.replaceQueue(tracks, 0));
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

  const byYear = groupBy(index, d => (d.date || d.year || '').toString().slice(0, 4))
    .filter(([y]) => y && y.length === 4)
    .sort((a, b) => a[0] - b[0]);

  const uniqueArtists = new Set(index.map(d => d.creator).filter(Boolean)).size;
  const years = index.map(d => +(d.date || '').slice(0, 4)).filter(Boolean);
  const minYear = Math.min(...years), maxYear = Math.max(...years);
  const topYear = [...byYear].sort((a, b) => b[1].length - a[1].length)[0];

  // ── Recently Uploaded ──
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const recentShows = index
    .filter(d => d.addeddate && d.addeddate.slice(0, 10) >= cutoffStr)
    .sort((a, b) => b.addeddate.localeCompare(a.addeddate));

  el.viewDiscover.innerHTML = '';

  // ── Surprises from the Archive ──
  {
    const sec = discoverSection('Surprises from the Archive', '');
    const btn = document.createElement('button');
    btn.className = 'surprise-btn';
    btn.textContent = '▶ Play a Random Show';
    btn.addEventListener('click', () => {
      const doc = index[Math.floor(Math.random() * index.length)];
      openConcert(doc);
    });
    sec.appendChild(btn);
    el.viewDiscover.appendChild(sec);
  }

  // ── Today in Archive ──
  const todayLabel = today.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  if (todayShows.length) {
    const sec = discoverSection(`Today in the Archive — ${todayLabel}`, `${todayShows.length} show${todayShows.length !== 1 ? 's' : ''}`);
    const strip = document.createElement('div');
    strip.className = 'discover-h-scroll';
    todayShows.forEach(doc => {
      const card = document.createElement('div');
      card.className = 'today-card';
      card.innerHTML = `
        <div class="today-card-year">${(doc.date || '').slice(0, 4)}</div>
        <div class="today-card-title">${esc(doc.title || doc.identifier)}</div>
        <div class="today-card-artist">${esc(doc.creator || '')}</div>
      `;
      card.addEventListener('click', () => openConcert(doc));
      strip.appendChild(card);
    });
    sec.appendChild(strip);
    el.viewDiscover.appendChild(sec);
  }

  // ── Recently Uploaded ──
  if (recentShows.length) {
    const sec = discoverSection('Recently Added to the Archive', `${recentShows.length} show${recentShows.length !== 1 ? 's' : ''} in last 30 days`);
    const list = document.createElement('ul');
    list.className = 'recent-list';
    recentShows.forEach(doc => {
      const li = document.createElement('li');
      li.className = 'recent-item';
      const added = doc.addeddate.slice(0, 10);
      li.innerHTML = `
        <div class="recent-date">${added}</div>
        <div class="recent-info">
          <div class="recent-title">${esc(doc.title || doc.identifier)}</div>
          <div class="recent-artist">${esc(doc.creator || '')}</div>
        </div>
      `;
      li.addEventListener('click', () => openConcert(doc));
      list.appendChild(li);
    });
    sec.appendChild(list);
    el.viewDiscover.appendChild(sec);
  }
}

function buildUploadChart(index) {
  const counts = new Map();
  index.forEach(doc => {
    const d = doc.addeddate;
    if (!d) return;
    const month = d.slice(0, 7); // "2024-12"
    counts.set(month, (counts.get(month) || 0) + 1);
  });
  const months = [...counts.keys()].sort().filter(m => m >= '2024-01');
  if (months.length < 2) return null;

  const values = months.map(m => counts.get(m));
  const max = Math.max(...values);
  const W = 320, H = 90;
  const pad = { top: 8, right: 4, bottom: 22, left: 4 };
  const cW = W - pad.left - pad.right;
  const cH = H - pad.top - pad.bottom;
  const barW = Math.max(2, (cW / months.length) * 0.7);
  const gap   = cW / months.length;
  const xS = i => pad.left + i * gap + gap / 2;
  const yS = v => pad.top + cH - (v / max) * cH;

  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const labelEvery = Math.ceil(months.length / 5);

  const bars = months.map((m, i) => {
    const bh = (values[i] / max) * cH;
    return `<rect x="${(xS(i) - barW / 2).toFixed(1)}" y="${yS(values[i]).toFixed(1)}" width="${barW.toFixed(1)}" height="${bh.toFixed(1)}" class="chart-bar"/>`;
  }).join('');

  const labels = months.map((m, i) => {
    if (i % labelEvery !== 0 && i !== months.length - 1) return '';
    const [y, mo] = m.split('-');
    return `<text x="${xS(i).toFixed(1)}" y="${H - 4}" text-anchor="middle" class="chart-label">${monthNames[+mo - 1]} '${y.slice(2)}</text>`;
  }).join('');

  return `<svg viewBox="0 0 ${W} ${H}" class="upload-chart" preserveAspectRatio="none">
    ${bars}
    ${labels}
  </svg>`;
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

  el.yearList.innerHTML = '';
  const frag = document.createDocumentFragment();
  byYear.forEach(([year, docs]) => {
    const item = makeArtistItem(year, docs.length, state.selectedYear === year);
    item.addEventListener('click', () => selectYear(year, docs));
    frag.appendChild(item);
  });
  el.yearList.appendChild(frag);

  if (!state.selectedYear && byYear.length) {
    const [year, docs] = byYear[0];
    state.selectedYear = year;
    el.yearList.querySelector('.artist-item')?.classList.add('selected');
    renderYearConcerts(sortDocs(docs));
  } else if (state.selectedYear) {
    const entry = byYear.find(([y]) => y === state.selectedYear);
    renderYearConcerts(sortDocs(entry?.[1] || []));
  }
}

function selectYear(year, docs) {
  state.selectedYear = year;
  el.yearList.querySelectorAll('.artist-item').forEach(item => {
    item.classList.toggle('selected', item.querySelector('.artist-name').textContent === year);
  });
  renderYearConcerts(sortDocs(docs));
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
  const frag = document.createDocumentFragment();
  byVenue.forEach(([venue, docs]) => {
    const item = makeArtistItem(venue, docs.length, state.selectedVenue === venue);
    item.addEventListener('click', () => selectVenue(venue, docs));
    frag.appendChild(item);
  });
  el.venueList.appendChild(frag);

  if (!state.selectedVenue && byVenue.length) {
    const [venue, docs] = byVenue[0];
    state.selectedVenue = venue;
    el.venueList.querySelector('.artist-item')?.classList.add('selected');
    renderVenueConcerts(sortDocs(docs));
  } else if (state.selectedVenue) {
    const entry = byVenue.find(([v]) => v === state.selectedVenue);
    renderVenueConcerts(sortDocs(entry?.[1] || []));
  }
}

function selectVenue(venue, docs) {
  state.selectedVenue = venue;
  el.venueList.querySelectorAll('.artist-item').forEach(item => {
    item.classList.toggle('selected', item.querySelector('.artist-name').textContent === venue);
  });
  renderVenueConcerts(sortDocs(docs));
}

function renderVenueConcerts(docs) {
  el.venueConcerts.innerHTML = '';
  if (!docs.length) {
    el.venueConcerts.innerHTML = '<li class="empty-msg">No concerts.</li>';
    return;
  }
  appendConcertRows(el.venueConcerts, docs, doc => openConcert(doc));
}

function discoverSection(title, count) {
  const sec = document.createElement('div');
  sec.className = 'discover-section';
  sec.innerHTML = `
    <div class="discover-section-header">
      <div class="discover-section-title">${esc(title)}</div>
      ${count ? `<div class="discover-section-count">${esc(count)}</div>` : ''}
    </div>
  `;
  return sec;
}

function openFilteredList(label, docs) {
  state.prevMode  = state.mode;
  state.inFiltered = true;
  el.backBtn.classList.add('visible');
  el.modeBar.classList.add('hidden');
  el.sortBar.classList.add('hidden');
  showView('filtered');
  el.viewFiltered.scrollTop = 0;

  el.filteredList.innerHTML = '';
  const labelEl = document.createElement('div');
  labelEl.className = 'filtered-list-label';
  labelEl.textContent = `${docs.length} show${docs.length !== 1 ? 's' : ''}`;
  el.filteredList.appendChild(labelEl);
  appendConcertRows(el.filteredList, docs, doc => openConcert(doc));
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
  if (state.searching && state.inConcert) {
    // came from search → concert, go back to search results
    state.inConcert = false;
    el.backBtn.classList.remove('visible');
    openSearch();
    return;
  }
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
let _contextDate = '';

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
  const [year, month, day] = dateStr.split('-').map(Number);
  const parts = [];

  await Promise.allSettled([
    fetch(`https://archive-api.open-meteo.com/v1/archive?latitude=41.8781&longitude=-87.6298&start_date=${dateStr}&end_date=${dateStr}&daily=temperature_2m_max,temperature_2m_min,weathercode&timezone=America%2FChicago&temperature_unit=fahrenheit`)
      .then(r => r.json())
      .then(d => {
        if (d.daily?.temperature_2m_max?.[0] != null) {
          const hi = Math.round(d.daily.temperature_2m_max[0]);
          const lo = Math.round(d.daily.temperature_2m_min[0]);
          parts.push(`Chicago that day: ${wmoDesc(d.daily.weathercode[0])}, high ${hi}°F / low ${lo}°F`);
        }
      }),
    fetch(`https://en.wikipedia.org/api/rest_v1/feed/onthisday/events/${month}/${day}`)
      .then(r => r.json())
      .then(d => {
        (d.events || [])
          .filter(e => e.year == year)
          .slice(0, 2)
          .forEach(e => parts.push(`${e.year}: ${e.text}`));
      }),
  ]);

  const text = parts.join('   ·   ');
  _contextCache.set(dateStr, text);
  return text;
}

function setBarContext(text) {
  const span = el.barContext.querySelector('span');
  el.barContext.style.display = text ? 'block' : 'none';
  span.textContent = text;
  span.style.animation = 'none';
  span.offsetHeight; // force reflow to restart animation
  span.style.animation = '';
}

function updateBar() {
  const t = player.currentTrack;
  if (!t) { el.nowBar.classList.remove('visible'); return; }
  el.nowBar.classList.add('visible');
  el.barTitle.textContent  = t.title;
  const datePart = t.date ? formatDate(t.date) : '';
  const artistPart = t.artist || '';
  el.barArtist.textContent = [artistPart, datePart].filter(Boolean).join(' · ');
  el.barPlay.innerHTML     = player.paused ? svgPlay() : svgPause();

  if (t.date && t.date !== _contextDate) {
    _contextDate = t.date;
    setBarContext('');
    fetchDayContext(t.date).then(text => {
      if (t.date === _contextDate) setBarContext(text);
    });
  }
}

function updateProgress() {
  const pct = player.duration > 0 ? (player.currentTime / player.duration) * 100 : 0;
  el.barFill.style.width = `${pct}%`;
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
        <div class="queue-track-meta">${esc(track.album || track.artist || '')}</div>
      </div>
      ${i !== currentIndex ? `<button class="queue-remove" data-i="${i}">×</button>` : ''}
    `;
    if (i !== currentIndex) {
      li.style.cursor = 'pointer';
      li.addEventListener('click', e => {
        if (e.target.classList.contains('queue-remove')) return;
        player.replaceQueue(player.queue, i);
        renderQueue();
      });
    }
    el.queueList.appendChild(li);
  });
  el.queueList.querySelectorAll('.queue-remove').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      player.removeFromQueue(Number(btn.dataset.i));
      renderQueue();
    });
  });
}

// ── Settings ───────────────────────────────────────────────────────
function openSettings() {
  el.collectionInput.value = state.collectionId;
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

  // Search
  el.searchToggle.addEventListener('click', openSearch);
  el.searchCancel.addEventListener('click', closeSearch);
  el.searchInput.addEventListener('input', onSearchInput);
  el.searchInput.addEventListener('keydown', e => { if (e.key === 'Escape') closeSearch(); });

  // Player bar
  el.barPlay.addEventListener('click', () => { player.toggle(); updateBar(); });
  el.barPrev.addEventListener('click', () => player.prev());
  el.barNext.addEventListener('click', () => player.next());
  el.barQueue.addEventListener('click', openQueue);
  el.barInfo.addEventListener('click', () => {
    if (state.currentConcert && !state.inConcert) {
      state.prevMode = state.mode;
      state.inConcert = true;
      el.backBtn.classList.add('visible');
      el.modeBar.classList.add('hidden');
      el.sortBar.classList.add('hidden');
      showView('concert');
      renderConcert(state.currentConcert);
    }
  });

  el.barProgress.addEventListener('click', e => {
    const r = el.barProgress.getBoundingClientRect();
    player.seek((e.clientX - r.left) / r.width);
  });

  // Track action sheet
  el.trackActionPlay.addEventListener('click', () => { if (_actionTrack) { player.addNext(_actionTrack); flashConfirm('Playing next'); } closeTrackAction(); });
  el.trackActionQueue.addEventListener('click', () => { if (_actionTrack) { player.addToEnd(_actionTrack); flashConfirm('Added to queue'); } closeTrackAction(); });
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
function formatDate(s) {
  if (!s) return '';
  const d = s.slice(0, 10);
  const [y, m, day] = d.split('-');
  if (!y || !m || !day) return d;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[+m - 1]} ${+day}, ${y}`;
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
