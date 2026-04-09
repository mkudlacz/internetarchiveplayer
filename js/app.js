import { DEFAULT_COLLECTION, loadFullIndex, getItemMetadata, getStreamUrl, getAudioFiles, formatDuration } from './api.js';
import player from './player.js';
import { isFav, toggleFav, getFavIds } from './favorites.js';
import { getAll as getAllPlaylists, getById, create as createPlaylist, addTracks, removeTrack as removePlTrack, remove as removePlaylist, encodeShareUrl, decodeShareHash, shareText } from './playlists.js';

// ── State ──────────────────────────────────────────────────────────
const state = {
  collectionId: localStorage.getItem('collectionId') || DEFAULT_COLLECTION,
  index:        null,   // full item array loaded once
  mode:         'library',   // 'library' | 'artists' | 'playlists' | 'favorites'
  prevMode:     'library',   // where to go back from concert/playlist-detail view
  inConcert:    false,
  sort:         'date desc',
  displayPage:  1,
  searching:    false,
  searchQuery:  '',
  selectedArtist:   null,   // { name, docs[] } or null = all
  currentConcert:   null,
  currentPlaylist:  null,   // playlist object being viewed
  pendingTracks:    null,   // tracks waiting to be added to a playlist
};

const PAGE_SIZE = 50;

// ── DOM refs ───────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const el = {
  headerTitle:    $('header-title'),
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
  viewConcert:    $('view-concert'),
  concertList:    $('concert-list'),
  loadMore:       $('load-more'),
  artistList:     $('artist-list'),
  artistConcerts: $('artist-concerts'),
  viewPlaylists:      $('view-playlists'),
  viewPlaylistDetail: $('view-playlist-detail'),
  playlistsList:      $('playlists-list'),
  addplSheet:         $('addpl-sheet'),
  addplClose:         $('addpl-close'),
  addplNew:           $('addpl-new'),
  addplList:          $('addpl-list'),
  favoritesList:  $('favorites-list'),
  nowBar:         $('now-playing-bar'),
  barTitle:       $('bar-title'),
  barArtist:      $('bar-artist'),
  barPlay:        $('bar-play'),
  barPrev:        $('bar-prev'),
  barNext:        $('bar-next'),
  barProgress:    $('bar-progress'),
  barFill:        $('bar-progress-fill'),
  barInfo:        $('bar-info'),
  barQueue:       $('bar-queue'),
  queueSheet:     $('queue-sheet'),
  queueList:      $('queue-list'),
  queueClose:     $('queue-close'),
  settingsSheet:  $('settings-sheet'),
  settingsClose:  $('settings-close'),
  collectionInput: $('collection-input'),
  settingsSave:   $('settings-save'),
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
  el.viewLibrary.style.display        = name === 'library'         ? 'block' : 'none';
  el.viewArtists.style.display        = name === 'artists'         ? 'flex'  : 'none';
  el.viewPlaylists.style.display      = name === 'playlists'       ? 'block' : 'none';
  el.viewPlaylistDetail.style.display = name === 'playlist-detail' ? 'block' : 'none';
  el.viewFavorites.style.display      = name === 'favorites'       ? 'block' : 'none';
  el.viewConcert.style.display        = name === 'concert'         ? 'block' : 'none';
}

function setMode(mode) {
  state.mode = mode;
  state.inConcert = false;

  // Header
  el.backBtn.classList.remove('visible');
  el.headerTitle.textContent = collectionName();

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
  } else if (mode === 'playlists') {
    showView('playlists');
    renderPlaylists();
  } else if (mode === 'favorites') {
    showView('favorites');
    if (state.index) renderFavorites();
  }
}

function collectionName() {
  return state.collectionId === DEFAULT_COLLECTION ? 'AJC Archive' : state.collectionId;
}

// ── Index loading ──────────────────────────────────────────────────
async function loadIndex() {
  el.concertList.innerHTML = '<div class="spinner"></div>';
  el.loadMore.style.display = 'none';
  try {
    state.index = await loadFullIndex(state.collectionId);
    state.displayPage = 1;
    if (state.mode === 'library') renderLibrary();
  } catch (err) {
    el.concertList.innerHTML = `<li class="error-msg">Failed to load: ${err.message}</li>`;
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

function openSearch() {
  state.searching = true;
  state.searchQuery = '';
  state.displayPage = 1;
  el.searchBar.classList.add('visible');
  el.modeBar.classList.add('hidden');
  el.sortBar.classList.add('hidden');
  el.backBtn.classList.remove('visible');
  showView('library');
  renderLibrary();
  requestAnimationFrame(() => el.searchInput.focus());
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
    renderLibrary();
  }, 250);
}

function filterIndex(query) {
  const q = query.toLowerCase();
  return state.index.filter(doc =>
    (doc.creator || '').toLowerCase().includes(q) ||
    (doc.title   || '').toLowerCase().includes(q) ||
    (doc.date    || '').includes(q)
  );
}

// ── Artist column view ─────────────────────────────────────────────
function renderArtistView() {
  const groups = groupByArtist(state.index);

  // Left column: artist list
  el.artistList.innerHTML = '';
  const frag = document.createDocumentFragment();

  // "All" entry at top
  const allItem = makeArtistItem('All Artists', state.index.length, !state.selectedArtist);
  allItem.addEventListener('click', () => selectArtist(null));
  frag.appendChild(allItem);

  groups.forEach(([name, docs]) => {
    const item = makeArtistItem(name, docs.length, state.selectedArtist?.name === name);
    item.addEventListener('click', () => selectArtist({ name, docs }));
    frag.appendChild(item);
  });
  el.artistList.appendChild(frag);

  // Right column
  renderArtistConcerts();
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

function renderArtistConcerts() {
  const docs = state.selectedArtist
    ? sortDocs(state.selectedArtist.docs)
    : sortDocs(state.index);

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
  const favDocs = sortDocs(state.index.filter(d => ids.has(d.identifier)));

  el.favoritesList.innerHTML = '';
  if (!favDocs.length) {
    el.favoritesList.innerHTML = '<li class="empty-msg">No favorites yet. Tap ♥ on any concert.</li>';
    return;
  }
  appendConcertRows(el.favoritesList, favDocs, doc => openConcert(doc));
}

// ── Concert detail view ────────────────────────────────────────────
async function openConcert(doc) {
  state.prevMode = state.mode;
  state.inConcert = true;

  el.backBtn.classList.add('visible');
  el.headerTitle.textContent = '';
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
      <div class="concert-actions">
        <button class="btn-primary" id="play-all">Play All</button>
        <button class="btn-secondary" id="queue-all">Add to Queue</button>
        <button class="btn-addpl" id="add-to-pl">+ Playlist</button>
        <button class="btn-fav${faved ? ' active' : ''}" id="concert-fav" title="Favorite">♥</button>
      </div>
    </div>
    <ul class="track-list" id="track-list"></ul>
  `;

  $('concert-fav').addEventListener('click', e => {
    const active = toggleFav(m.identifier);
    e.currentTarget.classList.toggle('active', active);
  });

  $('play-all').addEventListener('click', () => player.replaceQueue(tracks, 0));
  $('queue-all').addEventListener('click', () => tracks.forEach(t => player.addToEnd(t)));
  $('add-to-pl').addEventListener('click', () => openAddToPlaylist(tracks));

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
      <button class="track-add" title="Add to queue">+</button>
    `;
    li.querySelector('.track-add').addEventListener('click', e => {
      e.stopPropagation();
      player.addToEnd(track);
      flashBtn(e.currentTarget);
    });
    li.addEventListener('click', () => player.playNow(track));
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
    duration:   formatDuration(f.length),
    identifier: m.identifier,   // needed for playlist share URLs
    filename:   f.name,
  }));
}

// ── Playlists ──────────────────────────────────────────────────────
function renderPlaylists() {
  const lists = getAllPlaylists();
  el.playlistsList.innerHTML = '';
  if (!lists.length) {
    el.playlistsList.innerHTML = '<li class="empty-msg">No playlists yet.<br>Open a concert and tap "Add to Playlist."</li>';
    return;
  }
  lists.forEach(pl => {
    const li = document.createElement('li');
    li.className = 'playlist-item';
    li.innerHTML = `
      <div class="playlist-info">
        <div class="playlist-name">${esc(pl.name)}</div>
        <div class="playlist-meta">${pl.tracks.length} track${pl.tracks.length !== 1 ? 's' : ''}</div>
      </div>
      <div class="playlist-actions">
        <button class="pl-action-btn" data-action="share" title="Share">⬆</button>
        <button class="pl-action-btn danger" data-action="delete" title="Delete">×</button>
      </div>
    `;
    li.querySelector('[data-action="share"]').addEventListener('click', e => {
      e.stopPropagation();
      sharePlaylist(pl);
    });
    li.querySelector('[data-action="delete"]').addEventListener('click', e => {
      e.stopPropagation();
      if (confirm(`Delete "${pl.name}"?`)) {
        removePlaylist(pl.id);
        renderPlaylists();
      }
    });
    li.addEventListener('click', () => openPlaylistDetail(pl));
    el.playlistsList.appendChild(li);
  });
}

function openPlaylistDetail(pl) {
  state.prevMode = state.mode;
  state.currentPlaylist = pl;
  state.inConcert = true;
  el.backBtn.classList.add('visible');
  el.headerTitle.textContent = '';
  el.modeBar.classList.add('hidden');
  el.sortBar.classList.add('hidden');
  showView('playlist-detail');
  renderPlaylistDetail(pl);
}

function renderPlaylistDetail(pl) {
  const fresh = getById(pl.id) || pl; // re-read from storage
  state.currentPlaylist = fresh;
  el.viewPlaylistDetail.innerHTML = `
    <div class="pl-detail-header">
      <div class="pl-detail-name">${esc(fresh.name)}</div>
      <div class="pl-detail-meta">${fresh.tracks.length} track${fresh.tracks.length !== 1 ? 's' : ''}</div>
      <div class="pl-detail-actions">
        <button class="btn-primary" id="pl-play-all">Play All</button>
        <button class="btn-secondary" id="pl-queue-all">Add to Queue</button>
        <button class="pl-action-btn" id="pl-share" title="Share">⬆ Share</button>
      </div>
    </div>
    <ul class="track-list" id="pl-track-list"></ul>
  `;

  $('pl-play-all').addEventListener('click', () => player.replaceQueue(fresh.tracks, 0));
  $('pl-queue-all').addEventListener('click', () => fresh.tracks.forEach(t => player.addToEnd(t)));
  $('pl-share').addEventListener('click', () => sharePlaylist(fresh));

  const list = $('pl-track-list');
  fresh.tracks.forEach((track, i) => {
    const li = document.createElement('li');
    li.className = 'track-item' + (player.currentTrack?.url === track.url ? ' playing' : '');
    li.dataset.url = track.url;
    li.innerHTML = `
      <span class="track-num">${i + 1}</span>
      <div class="track-info">
        <div class="track-title">${esc(track.title)}</div>
        <div class="track-duration">${esc(track.artist || track.album || '')}</div>
      </div>
      <button class="track-add" data-i="${i}" title="Remove">×</button>
    `;
    li.querySelector('.track-add').addEventListener('click', e => {
      e.stopPropagation();
      removePlTrack(fresh.id, i);
      renderPlaylistDetail(fresh); // re-render
    });
    li.addEventListener('click', () => player.playNow(track));
    list.appendChild(li);
  });
}

function sharePlaylist(pl) {
  const url = encodeShareUrl(pl);
  const text = shareText(pl);
  if (navigator.share) {
    navigator.share({ title: pl.name, text, url }).catch(() => copyToClipboard(url));
  } else {
    copyToClipboard(url);
    alert(`Share link copied!\n\n${url}\n\n---\n${text}`);
  }
}

function copyToClipboard(text) {
  navigator.clipboard?.writeText(text).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  });
}

// ── Add-to-playlist sheet ──────────────────────────────────────────
function openAddToPlaylist(tracks) {
  state.pendingTracks = tracks;
  const lists = getAllPlaylists();
  el.addplList.innerHTML = '';
  lists.forEach(pl => {
    const li = document.createElement('li');
    li.className = 'addpl-option';
    li.innerHTML = `
      <div>${esc(pl.name)}</div>
      <div class="addpl-option-meta">${pl.tracks.length} track${pl.tracks.length !== 1 ? 's' : ''}</div>
    `;
    li.addEventListener('click', () => {
      addTracks(pl.id, tracks);
      closeAddToPlaylist();
      flashConfirm(`Added to "${pl.name}"`);
    });
    el.addplList.appendChild(li);
  });
  el.addplSheet.classList.add('visible');
}

function closeAddToPlaylist() {
  el.addplSheet.classList.remove('visible');
  state.pendingTracks = null;
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
  state.inConcert = false;
  if (state.searching) {
    openSearch();
    el.backBtn.classList.remove('visible');
    return;
  }
  // If returning to playlists and we were in playlist detail, re-render the list
  setMode(state.prevMode);
}

// ── Now Playing Bar ────────────────────────────────────────────────
function updateBar() {
  const t = player.currentTrack;
  if (!t) { el.nowBar.classList.remove('visible'); return; }
  el.nowBar.classList.add('visible');
  el.barTitle.textContent  = t.title;
  el.barArtist.textContent = t.artist || t.album || '';
  el.barPlay.innerHTML     = player.paused ? svgPlay() : svgPause();
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
    el.queueList.appendChild(li);
  });
  el.queueList.querySelectorAll('.queue-remove').forEach(btn => {
    btn.addEventListener('click', () => {
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
      el.headerTitle.textContent = '';
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

  // Add-to-playlist sheet
  el.addplClose.addEventListener('click', closeAddToPlaylist);
  el.addplNew.addEventListener('click', () => {
    const name = prompt('Playlist name:');
    if (!name?.trim()) return;
    const pl = createPlaylist(name.trim());
    if (state.pendingTracks) addTracks(pl.id, state.pendingTracks);
    closeAddToPlaylist();
    flashConfirm(`Added to "${pl.name}"`);
  });

  // Queue
  el.queueClose.addEventListener('click', () => el.queueSheet.classList.remove('visible'));

  // Settings
  el.settingsBtn.addEventListener('click', openSettings);
  el.settingsClose.addEventListener('click', () => el.settingsSheet.classList.remove('visible'));
  el.settingsSave.addEventListener('click', () => {
    const val = el.collectionInput.value.trim();
    if (!val) return;
    state.collectionId = val;
    localStorage.setItem('collectionId', val);
    el.settingsSheet.classList.remove('visible');
    state.index = null;
    state.selectedArtist = null;
    state.displayPage = 1;
    setMode('library');
    loadIndex();
  });

  // Player events
  player.on('trackchange', () => { updateBar(); updateTrackHighlight(); });
  player.on('statechange', updateBar);
  player.on('timeupdate',  updateProgress);
  player.on('queuechange', () => {
    if (el.queueSheet.classList.contains('visible')) renderQueue();
  });

  // Check for shared playlist in URL hash
  const sharedPl = decodeShareHash();
  if (sharedPl) {
    history.replaceState(null, '', location.pathname); // clean the URL
    if (confirm(`Load shared playlist "${sharedPl.name}" (${sharedPl.tracks.length} tracks)?`)) {
      const pl = createPlaylist(sharedPl.name);
      addTracks(pl.id, sharedPl.tracks);
      setMode('playlists');
      loadIndex().then(() => openPlaylistDetail(pl));
      return;
    }
  }

  // Boot
  setMode('library');
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
