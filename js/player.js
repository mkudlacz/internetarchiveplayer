// Singleton audio player with queue and Media Session API support

class Player {
  constructor() {
    this.audio = new Audio();
    this.audio.preload = 'metadata';
    this.queue = [];       // array of track objects
    this.currentIndex = -1;
    this._listeners = {};

    this.audio.addEventListener('ended', () => this._onEnded());
    this.audio.addEventListener('timeupdate', () => this._emit('timeupdate'));
    this.audio.addEventListener('durationchange', () => this._emit('durationchange'));
    this.audio.addEventListener('play', () => this._emit('statechange'));
    this.audio.addEventListener('pause', () => this._emit('statechange'));
    this.audio.addEventListener('error', (e) => this._emit('error', e));
    this.audio.addEventListener('waiting', () => this._emit('buffering', true));
    this.audio.addEventListener('canplay', () => this._emit('buffering', false));

    this._setupMediaSession();
  }

  // --- Playback control ---

  playNow(track) {
    this.queue = [track];
    this.currentIndex = 0;
    this._load();
  }

  replaceQueue(tracks, startIndex = 0) {
    this.queue = [...tracks];
    this.currentIndex = startIndex;
    this._load();
  }

  addNext(track) {
    const insertAt = this.currentIndex + 1;
    this.queue.splice(insertAt, 0, track);
    this._emit('queuechange');
    if (this.currentIndex === -1) { this.currentIndex = 0; this._load(); }
  }

  addToEnd(track) {
    this.queue.push(track);
    this._emit('queuechange');
    if (this.currentIndex === -1) { this.currentIndex = 0; this._load(); }
  }

  play()   { this.audio.play().catch(() => {}); }
  pause()  { this.audio.pause(); }
  toggle() { this.audio.paused ? this.play() : this.pause(); }

  next() {
    if (this.currentIndex < this.queue.length - 1) {
      this.currentIndex++;
      this._load();
    }
  }

  prev() {
    if (this.currentTime > 3) {
      this.audio.currentTime = 0;
    } else if (this.currentIndex > 0) {
      this.currentIndex--;
      this._load();
    }
  }

  seek(fraction) {
    if (this.audio.duration) {
      this.audio.currentTime = fraction * this.audio.duration;
    }
  }

  removeFromQueue(index) {
    if (index === this.currentIndex) return; // don't remove currently playing
    this.queue.splice(index, 1);
    if (index < this.currentIndex) this.currentIndex--;
    this._emit('queuechange');
  }

  // --- State getters ---

  get currentTrack()  { return this.queue[this.currentIndex] ?? null; }
  get paused()        { return this.audio.paused; }
  get duration()      { return this.audio.duration || 0; }
  get currentTime()   { return this.audio.currentTime; }
  get hasNext()       { return this.currentIndex < this.queue.length - 1; }
  get hasPrev()       { return this.currentIndex > 0; }
  get active()        { return this.currentIndex >= 0; }

  // --- Events ---

  on(event, fn) {
    (this._listeners[event] ??= []).push(fn);
    return () => this.off(event, fn); // returns unsubscribe fn
  }

  off(event, fn) {
    this._listeners[event] = (this._listeners[event] ?? []).filter(f => f !== fn);
  }

  _emit(event, data) {
    (this._listeners[event] ?? []).forEach(fn => fn(data));
  }

  // --- Internal ---

  _load() {
    const track = this.currentTrack;
    if (!track) return;
    this.audio.src = track.url;
    this.audio.play().catch(() => {});
    this._updateMediaSession(track);
    this._emit('trackchange', track);
    this._emit('queuechange');
  }

  _onEnded() {
    if (this.hasNext) {
      this.next();
    } else {
      this._emit('queueend');
    }
  }

  _setupMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    ms.setActionHandler('play',          () => this.play());
    ms.setActionHandler('pause',         () => this.pause());
    ms.setActionHandler('nexttrack',     () => this.next());
    ms.setActionHandler('previoustrack', () => this.prev());
    ms.setActionHandler('seekto',        (d) => { this.audio.currentTime = d.seekTime; });
  }

  _updateMediaSession(track) {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title:  track.title  || track.name  || 'Unknown Track',
      artist: track.artist || '',
      album:  track.album  || '',
    });
  }
}

export default new Player();
