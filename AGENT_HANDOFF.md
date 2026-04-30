# No Tape Left Behind Collection — Agent Handoff

Technical reference for continuing development. Written for a Claude agent picking up this project cold.

---

## 1. Product Concept

**What it is:** A single-page PWA that turns any Internet Archive audio collection into a native-feeling music player. The default collection is `aadamjacobs` — the "No Tape Left Behind" archive of Chicago live music recordings. The app is named "No Tape Left Behind Collection" in the manifest; the short name is "No Tape Left."

**Who it is for:** Matt Kudlacz (~50), a Chicago live music enthusiast. This is a personal passion project — not a product for public deployment. Simplicity and iPhone usability matter more than anything else. Matt does not troubleshoot on his phone.

**Design philosophy:** SoundJam-era iTunes — dark, minimal, dense information, no frivolity. Every UI decision should ask: does this feel like a native iOS music app? The accent color is a warm amber (#c8902a), not a generic blue.

**Deployment:** GitHub Pages at `/internetarchiveplayer/`. No build step, no bundler, no framework. Vanilla ES modules loaded directly from the browser. The only server is GitHub Pages — there is no backend.

**Configurability:** The collection ID is user-configurable from Settings. Changing it reloads the entire index against the new collection. Any IA audio collection identifier works, not just `aadamjacobs`.

---

## 2. Architecture Overview

### File Structure

```
/
├── index.html              — Single HTML document; all UI skeleton is here
├── manifest.json           — PWA manifest (standalone display, dark theme)
├── favicon.jpg             — 16×16-ish favicon
├── icon.jpg                — Apple touch icon + PWA icons (192 and 512 listed)
├── icon-192.png            — Explicit 192×192 icon
├── icon-512.png            — Explicit 512×512 icon
├── apple-touch-icon.png    — Apple touch icon
├── css/
│   └── style.css           — All styles; no preprocessor; heavy use of CSS custom properties
└── js/
    ├── app.js              — Main application module; all UI logic and state
    ├── api.js              — Internet Archive API calls and data normalisation
    ├── player.js           — Singleton audio player class with queue and Media Session API
    ├── favorites.js        — LocalStorage persistence for favorited identifiers
    ├── chicago-history.json — Keyed "YYYY-MM-DD" → string[]; Chicago historical events
    ├── artist-context.json  — Keyed artist name → year → { blurb, quotes[] }
    ├── venues.json         — Keyed venue name → Wikimedia Commons image URL
    └── wikimedia.js        — Wikimedia Commons image search helper (exported function)
dev/
    ├── artist-editor.html  — In-browser editor for artist-context.json entries
    ├── gen-artist-form.py  — Python script that generates artist-editor.html
    ├── gen-venue-page.py   — Python script for venue tooling
    └── validate-venues.html — Dev tool for validating venue name coverage
```

### Data Flow

```
Boot
  └─ loadIndex() → api.loadFullIndex(collectionId)
       └─ advancedsearch.php (rows=9999, fl=[identifier,title,creator,date,year,coverage,addeddate])
            └─ state.index = normalised doc array
                 └─ renderDiscover() / renderArtistView() / etc.

Concert tap
  └─ openConcert(doc) → api.getItemMetadata(identifier)
       └─ /metadata/{identifier}  (full item metadata + files array)
            └─ renderConcert(meta)
                 └─ buildTracks(meta) → getAudioFiles(files) → track objects
                      └─ player.replaceQueue(tracks, i) on tap/Play All

Discover: Popular section
  └─ separate fetch: advancedsearch.php?fl[]=downloads&sort[]=downloads+desc&rows=50
       (downloads field is NOT included in the main index fetch)
```

### State Object (module-scoped in app.js)

```js
const state = {
  collectionId: string,        // from localStorage or DEFAULT_COLLECTION
  index:        doc[] | null,  // full index; null until loaded
  mode:         string,        // 'discover'|'artists'|'venue'|'year'|'favorites'
  prevMode:     string,        // used by back navigation
  inConcert:    bool,          // true when concert detail is shown
  inFiltered:   bool,          // true when drilled into a filtered list from Discover
  sort:         string,        // 'date desc'|'creator asc'|'title asc'|'year desc'
  displayPage:  int,           // client-side pagination (PAGE_SIZE = 50)
  searching:    bool,
  searchQuery:  string,
  selectedArtist:   { name, docs[] } | null,
  selectedFavArtist: string | null,  // artist name
  selectedYear:     string | null,   // e.g. "1995"
  selectedVenue:    string | null,
  currentConcert:   metadata object | null,
};
```

### Player Module (js/player.js)

`player` is a singleton exported as the default export of `player.js`. It is a class instance, not a store — it does not interact with the DOM at all.

**What player.js owns:** The `<audio>` element, the queue array, currentIndex, Media Session API registration, and the event emitter (`on/off/_emit`).

**What app.js owns:** All DOM updates. app.js listens to player events (`trackchange`, `statechange`, `timeupdate`, `queuechange`) and updates the bar, highlights, and queue sheet accordingly.

**Player API surface:**
- `player.replaceQueue(tracks, startIndex)` — replace queue and play from index
- `player.addNext(track)` — insert after current
- `player.addToEnd(track)` — push to end
- `player.removeFromQueue(index)` — removes; refuses to remove the current track
- `player.clearQueue()` — stops and empties everything
- `player.prev()` — if currentTime > 3s, seeks to 0; else goes to previous
- `player.next()` — advances; does nothing at end of queue
- `player.seek(fraction)` — 0.0–1.0
- `player.toggle()` — play/pause
- `player.currentTrack` — track object or null
- `player.queue`, `player.currentIndex`, `player.paused`, `player.duration`, `player.currentTime`

**Track object shape** (built by `buildTracks` in app.js):
```js
{
  url:        string,   // full stream URL from getStreamUrl()
  title:      string,   // f.title or filename without extension
  artist:     string,   // m.creator
  album:      string,   // m.title or m.identifier
  date:       string,   // "YYYY-MM-DD"
  duration:   string,   // formatted "M:SS" or "H:MM:SS" or ''
  identifier: string,   // IA identifier (used for artwork and back-navigation)
  filename:   string,   // original filename
}
```

---

## 3. Internet Archive API Details

### Search API — advancedsearch.php

Base URL: `https://archive.org/advancedsearch.php`

**Main index fetch** (api.js `loadFullIndex`):
```
q=collection:{id}
output=json
rows=9999
fl=identifier,title,creator,date,year,coverage,addeddate
sort=date desc
```
Note: `rows=9999` is effectively a single-page fetch. The comment in the original api.js about pagination (`rows=500, page=N`) refers to an earlier design; current code requests up to 9999 in one shot.

**Popular section fetch** (app.js `renderDiscover`):
```
q=collection:{id} AND mediatype:audio
fl[]=identifier,creator,date,title,coverage,downloads
sort[]=downloads desc
rows=50
output=json
```
`downloads` is intentionally excluded from the main index fetch (bandwidth). The Popular section fetches it separately, filters to `downloads >= 400`, then random-shuffles for display.

### Metadata API — /metadata/{identifier}

URL: `https://archive.org/metadata/{identifier}`

Returns a large object. Relevant fields:
- `data.metadata` — item-level metadata: `identifier`, `title`, `creator`, `date`, `coverage`, `addeddate`, etc.
- `data.files` — array of file objects: `{ name, format, source, length, title, original }`

`creator` may be a string or an array; `api.js` normalises it to the first element (string) on both the index docs and metadata.

### Image / Artwork

- Thumbnail (used everywhere): `https://archive.org/services/img/{identifier}` — returns a JPEG resized to ~300px
- Hi-res lightbox: find the file with `format === 'JPEG Thumb'`; its `original` field names the source file. Construct: `https://archive.org/download/{identifier}/{encodeURIComponent(originalName)}`
- If no JPEG Thumb is found, the lightbox falls back to the thumbnail URL

### Stream URL Construction

```js
`https://archive.org/download/${identifier}/${encodeURIComponent(filename)}`
```

`getAudioFiles(files)` in api.js prefers `VBR MP3` derivative files. Falls back to `Flac` originals if no MP3 derivatives exist.

### Weather API

Open-Meteo historical API for Chicago (lat 41.8781, lon -87.6298):
```
https://archive-api.open-meteo.com/v1/archive
  ?latitude=41.8781&longitude=-87.6298
  &start_date={YYYY-MM-DD}&end_date={YYYY-MM-DD}
  &daily=temperature_2m_max,temperature_2m_min,weathercode,sunset
  &timezone=America/Chicago&temperature_unit=fahrenheit
```
WMO weather codes are mapped to plain-English descriptions in a `WMO` object in app.js. Results are cached per date in `_contextCache` (Map, in-memory, per session).

---

## 4. Feature Inventory

### Navigation and Tabs

**Mode bar tabs:** Discover, Artists, Venues, Years, Favs. Implemented as `<button data-mode="...">`. Clicking calls `setMode(mode)`. The Discover tab is hidden (`display:none`) if the loaded collection has fewer than 5 unique artists — checked in `loadIndex()` after index loads. If the user was already on Discover when this triggers, `setMode('artists')` is called automatically.

**Back button:** Hidden (`display:none`) except when `state.inConcert` or `state.inFiltered` is true. `goBack()` pops to `state.prevMode`. Two levels: filtered list → previous tab, concert detail → previous tab (or filtered list if `inFiltered` was set before concert opened).

**View stack logic:** There is no true stack — only `prevMode` and two boolean flags (`inConcert`, `inFiltered`). The back button only ever goes back one logical level. Concert detail opened from a filtered list correctly returns to the filtered list first (the `inFiltered` flag is not cleared when entering a concert, then `goBack` from concert goes to `prevMode` which is still the original tab).

Actually: reviewing the code — `openConcert` sets `state.inFiltered = false` and saves `state.prevMode` only if `!state.inFiltered` at the point of call. Then `goBack` checks `state.inFiltered` (which is now false). The effect: concert → Back → returns to prevMode. There is no two-step back from concert-via-filtered-list. `openFilteredList` sets `inFiltered = true`; opening a concert from a filtered list clears it, so back from concert goes straight to prevMode.

**Search:** The search input is always visible in the header (not toggled). It is context-aware — placeholder text and filtering behavior change per active tab. When `state.inConcert` is true, the input is hidden via `.search-hidden` class.

Search dispatches with 250ms debounce. History is saved on blur and on Enter. History renders as a dropdown (`#search-history`) positioned fixed below the header.

Search history: `localStorage` key `'searchHistory'`, max 10 entries (oldest removed when full). Entries must be >= 2 characters.

### Discover Tab

Rendered by `renderDiscover()`. Four sections, each a `.discover-section` with a `.discover-h-scroll` strip or vertical list.

**1. Today in the Archive**
Filters `state.index` where `date.slice(5,10) === 'MM-DD'` (today's month-day). Shows horizontal scroll strip of `.today-card` cards. Each card: large year in accent color, creator name, venue, and a 4th line with weather (temp + condition from `fetchDayContext`). Weather is fetched async after card renders; card height is fixed at 120px to accommodate it. Fav button bottom-right. Sorted chronologically (earliest year first).

**2. Popular in the Archive**
Separate IA fetch (async, renders when data arrives). Filters to `downloads >= 400`. Randomly shuffles, shows up to `billLimit` cards (min 5, max 8, derived from todayShows.length). `.popular-card` includes a thumbnail image, artist, city, date, play count. Fav button. Has a refresh button (re-shuffles without re-fetching). Section count reads `"N of M shows with 400+ plays"` where N = displayed, M = total qualifying.

`billLimit = Math.min(Math.max(todayShows.length, 5), 8)` — this controls how many cards appear in both Popular and Time Travel sections.

**3. Time Travel to a Show**
Multi-artist bills: concerts that share the same date AND venue (extracted via `extractVenueName`), with at least 2 distinct creators. Built from the main index client-side. `billMap` is a `{date|venue}` → docs[] map. Filtered to entries with `>= 2 distinct creators`. Shows `.bill-card` cards with date, artist names (font-size auto-shrinks to fit), and venue. Section count reads `"N of M multi-artist shows"` where N = displayed (billLimit), M = total qualifying.

Tapping a bill card: fetches full metadata for ALL shows on that bill simultaneously (`Promise.all`), builds combined track list, loads into player, opens queue sheet. Card dims during load.

Artist name text in bill cards shrinks dynamically via `requestAnimationFrame` loop: starts at 15px, reduces by 0.5px until `scrollHeight <= clientHeight` or minimum 9px.

**4. New to the Archive**
Shows from `state.index` where `addeddate >= 30 days ago`. Sorted by `addeddate` descending. Rendered as a vertical `.recent-list`. Each item shows upload date (formatted MM-DD-YY), creator, venue, show date.

**Discover sections header pattern:** `discoverSection(title, count, onRefresh?)` builds a `.discover-section` wrapper with a formatted header row. If `onRefresh` is provided, a refresh button (↺) is added that calls the callback.

### Column Browser Tabs (Artists, Venues, Years, Favs)

All four use a two-column flex layout: left column (38% width, `.artist-col`) = filterable list; right column (flex: 1, `.concerts-col`) = concerts for selection.

Each tab has:
- An "All" item at the top of the left column (selected by default, `state.selectedX === null`)
- Alphabetical/chronological list of groups below
- Clicking an item highlights it (`.selected` class + accent left border) and re-renders the right column
- The right column always uses `dateAsc()` sort within the selection
- Search filters the left column only (not the right column directly); if the current selection is filtered away, it resets to null

**Artists:** Grouped by `doc.creator`, sorted alphabetically. Right column uses `appendConcertRows` (date, title, creator, fav button, chevron).

**Venues:** Grouped by `extractVenueName(doc)`, sorted alphabetically. Docs with no extractable venue are excluded entirely.

**Years:** Grouped by `doc.date.slice(0,4)` (falls back to `doc.year`), sorted numerically ascending.

**Favs:** Identical structure to Artists, but pre-filtered to `getFavIds()` set. Left column grouped by creator, right column uses `appendConcertRows`.

### Concert Detail

`openConcert(doc)` fetches full metadata, then calls `renderConcert(meta)`. The view is built by setting `el.viewConcert.innerHTML` to a hero block, then appending sections.

**Hero block:**
- Artwork: 120×120, tappable → lightbox. Hi-res lookup: `findHiResArt(meta.files)` finds the JPEG Thumb file and reads its `original` field for the source filename.
- Date (formatted with weekday via `formatDateWithDay`)
- Creator (tappable → navigates to Artists tab pre-filtered to this artist via `setMode('artists')` + `renderArtistView()`)
- Venue name
- archive.org link (opens in new tab)
- Upload date (`m.addeddate`, formatted)
- Play count (`m.downloads`, formatted with locale commas + "plays" label; both from the metadata API response)

**Action buttons:** Play All (replaces queue, opens queue sheet), Add to Queue (appends all tracks), Favorite (heart toggle).

**"On This Date" section** (`#concert-context-section`): async. Fetches Open-Meteo weather for `m.date`. Looks up `HISTORY[dateKey]` (exact "YYYY-MM-DD" key). Renders as a single line: `On this date · weather · historical events`. Silently skipped if both fetches return nothing.

**"From the Artist" section** (`#concert-snippets-section`): looks up `ARTIST_CONTEXT[m.creator]?.[concertYear]`. If found, renders blurb text and quote blocks. Both blurb and quotes are optional.

**"Also in the archive on this date" section** (`#concert-also-date`): finds other docs in `state.index` with the same full date string (YYYY-MM-DD), excluding the current identifier. Rendered as a collapsible list (collapsed by default, `.open` class toggle). Clicking any item opens that concert.

**Track list** (`#track-list`): numbered list. Tap row → `player.replaceQueue(tracks, i)` (starts from that track). Long-press / "···" button → track action sheet.

**Track action sheet:** modal overlay from bottom. Three actions: Play Next (`player.addNext`), Add to Queue (`player.addToEnd`), Go to Artist (sets `state.selectedArtist`, calls `setMode('artists')` + `renderArtistView()`).

### Now Playing Bar

`#now-playing-bar` is hidden by default; gets `.visible` class when `player.currentTrack` is non-null.

Three-row layout:
1. `.bar-body`: 52×52 artwork, title, artist/date/venue subtitle
2. `.bar-scrub-wrap`: progress rail + elapsed/remaining times
3. `.bar-controls`: prev, play/pause, next, queue — buttons are 52×52px touch targets; play SVG 32px, prev/next SVGs 26px

**Artist subtitle:** Combines artist, formatted date, and venue (looked up from `state.index` by identifier). If the combined text overflows `.bar-artist`, the `inner` span is duplicated with spaces and gets `.scrolling` class for a CSS marquee animation (16s linear infinite).

**Tap on `.bar-info`:** closes queue sheet if open, then opens concert detail for the current track's identifier (looked up from `state.index`).

**Progress scrub:** click anywhere on the rail → `player.seek(fraction)` where fraction = click position / rail width.

### Queue Sheet

`#queue-sheet` is a fixed full-screen sheet (not a real bottom sheet — it's fixed top:0 to bottom:calc(var(--bar-h) + safe-area-inset-bottom)). `.visible` class toggles display.

Items: each `.queue-item` shows title and artist. Currently playing item gets `.current` class (title in accent color). Clicking a non-current item calls `player.replaceQueue(player.queue, i)` and re-renders.

"···" button on each item → queue item action sheet: Go to Show (opens concert detail), Go to Artist (navigates to Artists tab), Delete from Queue (`player.removeFromQueue`).

Clear button: `player.clearQueue()` + close sheet.

**Scroll to current:** after render, `openQueue()` calls `scrollIntoView({block:'center'})` on the `.current` item.

### Settings Sheet

Full-screen fixed overlay. Three sections:

1. **Collection ID input:** text input pre-filled with `state.collectionId`. Save: writes to `localStorage('collectionId')`, resets state (null index, null selectedArtist, displayPage 1), calls `setMode('discover')` then `loadIndex()`.

2. **Favorites Export:** calls `encodeFavsHash()` which builds a URL with `#favs=id1,id2,...` (each ID is `encodeURIComponent`-encoded). Copies to clipboard via `navigator.clipboard.writeText`. Shows toast confirmation.

3. **Favorites Restore:** paste input. On "Restore", parses `#favs=...` fragment, calls `importFavIds(ids)`. Also handled automatically on page load: `decodeFavsHash()` checks `location.hash` at init, imports if present, then clears the hash via `history.replaceState`.

Favorites storage key: `'iap_favorites'` in `favorites.js` — this is collection-independent (all collections share one favorites store).

---

## 5. Key Implementation Patterns and Gotchas

### iOS PWA Specifics

- `viewport-fit=cover` in the meta viewport is required for content to extend under the notch/Dynamic Island.
- `env(safe-area-inset-top)` is used in the header height calculation. The header is `calc(52px + env(safe-area-inset-top, 0px))` tall and has `padding-top: env(safe-area-inset-top, 0px)`.
- `env(safe-area-inset-bottom)` is applied to the now-playing bar's `padding-bottom` and to the action sheet inner's bottom padding.
- `#app` uses `height: 100dvh` with `overflow: hidden`. This is critical — without `overflow: hidden`, body scroll activates in Safari browser mode (not PWA mode) and the bar floats off-screen.
- `--bar-h: 178px` is a CSS custom property set in `:root`. It is used ONLY to position the queue sheet's bottom edge (`bottom: calc(var(--bar-h) + env(safe-area-inset-bottom, 0px))`). It does not represent the actual rendered bar height dynamically — it's a static anchor. If the bar layout ever changes significantly, this value may need updating.
- `apple-mobile-web-app-status-bar-style: black-translucent` makes the iOS status bar transparent so content can extend under it (requires `viewport-fit=cover`).
- Media Session API: `previoustrack` and `nexttrack` handlers are registered in player.js. iOS WebKit shows skip-10s buttons in the lock screen UI regardless of these registrations — this is a known WebKit limitation and cannot be overridden.
- `-webkit-tap-highlight-color: transparent` on the root prevents the blue flash on iOS tap.
- `-webkit-overflow-scrolling: touch` on scrollable panels ensures momentum scrolling on iOS.
- `overscroll-behavior: none` on body prevents pull-to-refresh interference.

### State Management

- Single `state` object, module-scope in `app.js`. No reactivity framework — all DOM updates are manual, triggered by explicit calls.
- No global event bus — communication between player and UI goes through `player.on()` event listeners registered in `init()`.
- `state.mode` reflects the current tab. When concert detail is showing, `state.mode` still reflects the tab the user came from (not 'concert').

### Favorites

- `favorites.js` reads and writes from `localStorage` on every call (`load()` called in `isFav`, `getFavIds`, `toggleFav`, `importFavIds`). There is no in-memory cache within the module — each read deserialises JSON from localStorage.
- The storage key `'iap_favorites'` is hardcoded and collection-independent. If a user switches collection IDs, their favorites from the first collection remain in storage and will still show as favorited if the same identifier appears in another collection.
- `toggleFav` returns the new boolean state (true = now favorited).

### Venue Extraction

`extractVenueName(doc)` in app.js:
1. Returns `doc.coverage.trim()` if present and non-empty.
2. Falls back to regex: `/(?:live\s+)?at\s+([^,\d\(\[]+?)(?:\s+\d{4}|\s*[,\(\[\-]|$)/i` applied to `doc.title`.
3. Returns null if neither works.

Known limitations: The regex misses titles ending in " on" (e.g. "Artist Live at Venue on 1984-01-01" might fail). `coverage` is preferred and more reliable when present. Venues without either field are excluded from the Venue tab and appear as uncategorized.

`venues.json` maps venue name strings to Wikimedia Commons image URLs. This file is referenced nowhere in the current app.js or any other JS file — it appears to be an asset prepared for a planned venue-image feature that is not yet implemented.

`wikimedia.js` exports `fetchWikimediaImages(query, limit, fallbackQuery)` which searches Wikimedia Commons for images. It is also not currently called from app.js — another prepared-but-unused piece.

### Audio File Selection

`getAudioFiles(files)` priority:
1. VBR MP3 files where `source === 'derivative'`
2. Flac files where `source === 'original'` (only if no MP3 derivatives exist)

This means lossy MP3 derivatives are always preferred over lossless originals. The rationale is bandwidth.

### Date Formatting Functions (app.js)

| Function | Input | Output example |
|---|---|---|
| `formatDate(s)` | "1988-04-15" | "Apr 15, 1988" |
| `formatDateWithDay(s)` | "1988-04-15" | "Fri, Apr 15, 1988" |
| `formatDateBill(s)` | "1988-04-15" | "Fri · Apr 15, 1988" |
| `formatUploadDate(s)` | "2023-11-02T..." | "11-02-23" |

All date parsing is done by string slicing, not `new Date()` (avoids timezone bugs). `formatDateWithDay` and `formatDateBill` use `new Date(dateT12:00:00Z)` with `timeZone: 'UTC'` to safely get the weekday without local timezone offset shifting the day.

### HTML Escaping

`esc(s)` in app.js escapes `&`, `<`, `>`, `"`. All user-visible strings from IA data must go through `esc()` before being set as `innerHTML`. Strings set via `.textContent` do not need escaping.

### Client-Side Pagination (Library mode only)

`state.displayPage` starts at 1. Each "Load more" click increments it. Visible docs = `sorted.slice(0, displayPage * PAGE_SIZE)` where `PAGE_SIZE = 50`. Resetting `displayPage = 1` happens on mode change, search query change, and sort change. This pagination only applies to the library/search results view — the column browsers render all docs at once.

### groupBy vs groupByArtist

- `groupBy(arr, keyFn)` — generic, returns `[[key, docs[]], ...]` as Map entries (insertion order)
- `groupByArtist(docs)` — specialised, groups by `doc.creator || '(Unknown)'`, returns sorted by name

---

## 6. Known Limitations and Design Decisions

**Venue parsing is imperfect.** `doc.coverage` is the gold standard but is absent on some older items. The title regex handles common "Live at Venue Name" patterns but fails on edge cases. Items without a venue don't appear in the Venue tab. This is acceptable.

**Playcount = IA downloads.** IA's "downloads" counter increments on each stream. The app labels it "plays." It is not an accurate play count (partial listens count, bots count), but it's the best available signal.

**No offline playback.** Tracks stream directly from `archive.org/download/...`. There is no service worker, no caching of audio content. If archive.org is unreachable, nothing plays.

**Weather assumes Chicago.** The Open-Meteo call hardcodes lat/lon for Chicago. This is intentional — the collection is Chicago-centric. Any concert date in any other city will show Chicago weather, which is wrong but acceptable for this use case.

**No service worker.** The app has no service worker, which means no offline capability and no background push. This is a deliberate simplicity choice.

**venues.json and wikimedia.js are unused.** These files were built for a planned venue-image feature. They exist and are not referenced from app.js. They can be removed or the feature can be built on top of them.

**No drag-to-reorder in queue.** The queue sheet shows a menu button (···) per item but has no drag handle UI. The AGENT_HANDOFF brief mentions "drag-to-reorder" but the current code uses the `···` menu with a separate action sheet. This may be a planned feature not yet implemented.

**Favorites are collection-independent.** The `'iap_favorites'` localStorage key does not incorporate the collection ID. Switching collections does not clear favorites from the previous collection.

**Single-shot index load.** The comment in api.js mentions ~2500 items × 5 fields ≈ 200KB — acceptable for a personal app. `rows=9999` is the ceiling; IA may return fewer.

**`state.inFiltered` back navigation.** Concert opened from a filtered list does not stack — going back from the concert goes directly to `prevMode`, skipping the filtered list. This is a simplification noted in the code.

---

## 7. File Map

| File | Role |
|---|---|
| `index.html` | Full UI skeleton. All views, sheets, and the now-playing bar are declared here. One script tag loads `js/app.js` as a module. |
| `manifest.json` | PWA manifest: `start_url` and `scope` both set to `/internetarchiveplayer/` for GitHub Pages subdirectory deployment. `display: standalone`. Icons reference `icon.jpg` at both 192 and 512 sizes. |
| `css/style.css` | All styles. CSS custom properties in `:root`. No media queries for dark mode (app is always dark). Relies heavily on `env(safe-area-inset-*)` for iOS notch/home-indicator handling. |
| `js/app.js` | ~1666 lines. Module scope. Contains: state object, all DOM refs (`el`), all render functions, all event handlers, `init()`. Imports from api.js, player.js, favorites.js. |
| `js/api.js` | IA API abstraction: `loadFullIndex`, `getItemMetadata`, `getStreamUrl`, `getAudioFiles`, `formatDuration`, and the `normalise` helper. Exports `DEFAULT_COLLECTION = 'aadamjacobs'`. |
| `js/player.js` | `Player` class. Singleton exported as default. Owns `<Audio>` element, queue, currentIndex, Media Session registration. Pure logic — zero DOM access. |
| `js/favorites.js` | Read/write favorites to `localStorage('iap_favorites')`. `isFav`, `toggleFav`, `getFavIds`, `importFavIds`, `encodeFavsHash`, `decodeFavsHash`. Reads localStorage on every call. |
| `js/chicago-history.json` | Static JSON. Keys are `"YYYY-MM-DD"`, values are `string[]` of historical event descriptions. Covers Chicago sports results (Cubs, White Sox, Bears, Bulls, Blackhawks), CTA milestones, civic events. Loaded once on boot via `fetch`. |
| `js/artist-context.json` | Static JSON. Keys: artist name → year (string) → `{ blurb: string, quotes: [{text, attr}][] }`. Used on concert detail for "From the Artist" section. Curated manually. |
| `js/venues.json` | Static JSON. Keys: venue name string → Wikimedia Commons image URL. Currently not imported or used in app.js. Prepared for a venue-image feature. |
| `js/wikimedia.js` | `fetchWikimediaImages(query, limit, fallbackQuery)` — searches Wikimedia Commons by query, returns `{url, title}[]`. In-memory cache per query. Currently not called from app.js. |
| `dev/artist-editor.html` | Browser-based editor for `artist-context.json`. Generated by `gen-artist-form.py`. Dev-only. |
| `dev/gen-artist-form.py` | Python script to regenerate `artist-editor.html`. Takes `artist-context.json` and produces an HTML form interface for editing entries. |
| `dev/gen-venue-page.py` | Python script for venue tooling (exact function varies; see file). |
| `dev/validate-venues.html` | Dev tool for checking venue name extraction coverage across the index. |

---

## 8. CSS Architecture

All colours and spacing anchors are CSS custom properties in `:root`:

```css
--bg:          #0e0e0e   /* page background */
--bg2:         #1a1a1a   /* elevated surfaces: bar, cards, sheets */
--bg3:         #252525   /* input backgrounds, hover states */
--border:      #2e2e2e   /* all dividers */
--text:        #e8e8e8   /* primary text */
--text2:       #888      /* secondary text */
--text3:       #555      /* tertiary / placeholder text */
--accent:      #c8902a   /* amber; active states, dates, accent text */
--accent2:     #a07020   /* darker amber; border on active fav buttons */
--accent-dim:  rgba(200,144,42,0.12) /* accent tint for selected backgrounds */
--danger:      #c0392b   /* destructive actions */
--bar-h:       178px     /* used ONLY for queue sheet bottom positioning */
--header-h:    52px      /* logical header height before safe area */
--font:        -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif
```

Sheet visibility pattern: sheets (queue, settings, action sheets) use `display: none` by default; toggled via `.visible` class that sets `display: flex` or `display: block`. No CSS transitions on sheets — they snap in/out. Action sheets have `backdrop-filter: blur(4px)` with `-webkit-` prefix for Safari.

The `.action-sheet-inner` positions itself `bottom: 0` within the fixed overlay, with `padding-bottom: calc(8px + env(safe-area-inset-bottom))` to clear the home indicator.

---

## 9. Quick Reference: Common Tasks

**Add a new Discover section:** Follow the `discoverSection(title, count, onRefreshCallback?)` pattern in `renderDiscover()`. Returns a section element; append it to `el.viewDiscover`.

**Add a new field to the index doc:** Add the field name to the `fl` parameter in `api.js loadFullIndex`. Be aware this increases payload size.

**Add a new artist context entry:** Edit `js/artist-context.json` directly or use `dev/artist-editor.html`. Key is the artist name exactly as it appears in `doc.creator` from IA. Second key is the year string (e.g. "1988").

**Add a new Chicago history entry:** Edit `js/chicago-history.json`. Key format is `"YYYY-MM-DD"`. Value is an array of strings. Each string conventionally starts with `"YYYY · "`.

**Change the default collection:** Change `DEFAULT_COLLECTION` in `js/api.js`.

**Add a new localStorage key:** Be mindful of key collisions. Currently used keys: `'collectionId'`, `'iap_favorites'`, `'searchHistory'`.

**Player events to listen for:** `trackchange`, `statechange`, `timeupdate`, `durationchange`, `queuechange`, `queueend`, `error`, `buffering`.

**Trigger a toast notification:** `flashConfirm(msg)` creates a brief pop-up div at `bottom: 90px`. Auto-removes after 2 seconds.
