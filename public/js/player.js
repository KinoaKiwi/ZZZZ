import { h, render, clear, icon, fmtTime, toast } from './dom.js';
import { api } from './api.js';

const VOLUME_KEY = 'onde.volume';

/**
 * One <audio> for the whole app: navigating between views never interrupts playback.
 * A queue entry is either a live stream (kind 'live') or an uploaded file (kind 'file').
 */
class Player {
  constructor() {
    this.audio = new Audio();
    this.audio.preload = 'none';
    this.audio.volume = Number(localStorage.getItem(VOLUME_KEY) ?? 0.85);

    this.queue = [];
    this.index = -1;
    this.listeners = new Set();
    this.logged = new Set();

    this.audio.addEventListener('play', () => this.emit());
    this.audio.addEventListener('pause', () => this.emit());
    this.audio.addEventListener('timeupdate', () => this.tick());
    this.audio.addEventListener('durationchange', () => this.emit());
    this.audio.addEventListener('ended', () => this.next());
    this.audio.addEventListener('error', () => this.onError());
    this.audio.addEventListener('waiting', () => this.setStatus('mise en mémoire…'));
    this.audio.addEventListener('playing', () => { this.setStatus(null); this.logPlay(); });

    this.status = null;
    this.buildBar();
    this.bindKeys();
  }

  /* -------------------------------------------------------------- playback */

  get current() { return this.queue[this.index] ?? null; }
  get isLive() { return this.current?.kind === 'live'; }
  get playing() { return !this.audio.paused && this.index >= 0; }

  load(queue, index = 0, autoplay = true) {
    this.queue = queue;
    this.index = queue.length ? Math.min(Math.max(index, 0), queue.length - 1) : -1;
    this.start(autoplay);
  }

  start(autoplay = true) {
    const item = this.current;
    if (!item) { this.audio.removeAttribute('src'); this.audio.load(); return this.emit(); }

    this.audio.src = item.src;
    this.audio.preload = 'auto';
    this.setStatus('connexion…');
    if (autoplay) this.audio.play().catch(() => this.setStatus('appuyez sur lecture'));
    this.updateMediaSession();
    this.emit();
  }

  playStation(station, tracks = []) {
    if (station.kind === 'live') {
      return this.load([{
        kind: 'live',
        src: station.stream_url,
        title: station.name,
        subtitle: station.genre || 'flux en direct',
        stationId: station.id,
        slug: station.slug,
        cover: station.cover_url,
      }]);
    }

    if (!tracks.length) return toast('Cette station n a pas encore de programme.', 'error');
    this.load(tracks.map((t) => trackItem(t, station)), 0);
  }

  playTracks(tracks, index = 0, station = null) {
    if (!tracks.length) return;
    this.load(tracks.map((t) => trackItem(t, station)), index);
  }

  toggle() {
    if (!this.current) return;
    if (this.audio.paused) {
      // A live stream that has been paused is stale — reconnect instead of resuming.
      if (this.isLive && this.audio.currentTime > 0) this.audio.src = this.current.src;
      this.audio.play().catch(() => toast('Lecture refusée par le navigateur.', 'error'));
    } else {
      this.audio.pause();
    }
  }

  next() {
    if (this.index < this.queue.length - 1) { this.index += 1; this.start(); }
    else { this.audio.pause(); this.emit(); }
  }

  prev() {
    if (this.audio.currentTime > 4 && !this.isLive) { this.audio.currentTime = 0; return; }
    if (this.index > 0) { this.index -= 1; this.start(); }
  }

  jump(index) {
    if (index < 0 || index >= this.queue.length) return;
    this.index = index;
    this.start();
  }

  seekRatio(ratio) {
    const duration = this.audio.duration;
    if (!Number.isFinite(duration) || this.isLive) return;
    this.audio.currentTime = Math.max(0, Math.min(1, ratio)) * duration;
  }

  setVolume(value) {
    this.audio.volume = Math.max(0, Math.min(1, value));
    localStorage.setItem(VOLUME_KEY, String(this.audio.volume));
  }

  setStatus(text) { this.status = text; this.emit(); }

  onError() {
    if (!this.current) return;
    this.setStatus('flux indisponible');
    toast(`Impossible de lire « ${this.current.title} ».`, 'error');
  }

  logPlay() {
    const item = this.current;
    if (!item) return;
    const key = `${item.stationId ?? ''}:${item.trackId ?? ''}:${this.index}`;
    if (this.logged.has(key)) return;
    this.logged.add(key);
    api.post('/api/plays', { station_id: item.stationId ?? null, track_id: item.trackId ?? null }).catch(() => {});
  }

  updateMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const item = this.current;
    if (!item) return;

    navigator.mediaSession.metadata = new MediaMetadata({
      title: item.title,
      artist: item.subtitle || 'Onde',
      album: item.stationName || 'Onde',
      artwork: item.cover ? [{ src: item.cover, sizes: '512x512' }] : [],
    });
    navigator.mediaSession.setActionHandler('play', () => this.toggle());
    navigator.mediaSession.setActionHandler('pause', () => this.toggle());
    navigator.mediaSession.setActionHandler('nexttrack', () => this.next());
    navigator.mediaSession.setActionHandler('previoustrack', () => this.prev());
  }

  /* ---------------------------------------------------------------- events */

  subscribe(fn) { this.listeners.add(fn); fn(this); return () => this.listeners.delete(fn); }
  emit() { this.paint(); this.listeners.forEach((fn) => fn(this)); }

  tick() {
    this.paintTime();
    this.listeners.forEach((fn) => fn(this, true));
  }

  bindKeys() {
    document.addEventListener('keydown', (e) => {
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) return;

      if (e.code === 'Space') { e.preventDefault(); this.toggle(); }
      else if (e.key === 'ArrowRight' && e.altKey) this.next();
      else if (e.key === 'ArrowLeft' && e.altKey) this.prev();
    });
  }

  /* ------------------------------------------------------------------- UI */

  buildBar() {
    this.el = {};

    this.el.line = h('i', { class: 'player__line' });
    this.el.seek = h('div', {
      class: 'player__seek',
      role: 'slider',
      'aria-label': 'Position de lecture',
      onclick: (e) => {
        const box = e.currentTarget.getBoundingClientRect();
        this.seekRatio((e.clientX - box.left) / box.width);
      },
    });

    this.el.toggle = h('button', {
      class: 'player__toggle', type: 'button', 'aria-label': 'Lecture', onclick: () => this.toggle(),
    }, icon('play'));

    this.el.prev = h('button', { class: 'player__skip', type: 'button', 'aria-label': 'Précédent', onclick: () => this.prev() }, icon('prev', 14));
    this.el.next = h('button', { class: 'player__skip', type: 'button', 'aria-label': 'Suivant', onclick: () => this.next() }, icon('next', 14));

    this.el.title = h('div', { class: 'player__title', text: 'Aucune station' });
    this.el.sub = h('div', { class: 'player__sub' });
    this.el.time = h('div', { class: 'player__time tnum', text: '--:-- / --:--' });

    this.el.volume = h('input', {
      type: 'range', min: '0', max: '1', step: '0.01', value: String(this.audio.volume),
      'aria-label': 'Volume', oninput: (e) => this.setVolume(Number(e.target.value)),
    });

    this.el.queueBtn = h('button', {
      class: 'icon-btn', type: 'button', 'aria-label': 'File de lecture', onclick: () => this.toggleQueue(),
    }, icon('list', 14));

    this.el.queue = h('aside', { class: 'queue', hidden: true, 'aria-label': 'File de lecture' });

    this.el.bar = h('div', { class: 'player is-idle' },
      this.el.line,
      this.el.seek,
      h('div', { class: 'wrap player__in' },
        this.el.toggle,
        h('div', { style: { display: 'flex', gap: '2px' } }, this.el.prev, this.el.next),
        h('div', { class: 'player__now' }, this.el.title, this.el.sub),
        this.el.time,
        h('div', { class: 'player__vol' }, this.el.volume),
        this.el.queueBtn,
      ),
    );

    const mount = () => {
      // Keeping the element in the document makes it visible to the browser's
      // own media controls (and to anything inspecting the page).
      this.audio.hidden = true;
      document.body.append(this.audio, this.el.queue, this.el.bar);
      this.paint();
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
    else mount();
  }

  toggleQueue() {
    const hidden = this.el.queue.hasAttribute('hidden');
    if (hidden) { this.paintQueue(); this.el.queue.removeAttribute('hidden'); }
    else this.el.queue.setAttribute('hidden', '');
  }

  paint() {
    const item = this.current;
    const bar = this.el.bar;

    bar.classList.toggle('is-idle', !item);
    bar.classList.toggle('is-live', Boolean(item && this.isLive));

    render(this.el.toggle, icon(this.playing ? 'pause' : 'play'));
    this.el.toggle.setAttribute('aria-label', this.playing ? 'Pause' : 'Lecture');
    this.el.toggle.disabled = !item;
    this.el.prev.disabled = this.index <= 0;
    this.el.next.disabled = this.index < 0 || this.index >= this.queue.length - 1;

    this.el.title.textContent = item ? item.title : 'Aucune station';

    clear(this.el.sub);
    if (!item) {
      this.el.sub.append('choisissez une fréquence dans la grille');
    } else if (this.isLive) {
      this.el.sub.append(
        h('span', { class: 'onair' }, h('i', { class: 'dot' }), 'En direct'),
        this.status ?? item.subtitle,
      );
    } else {
      this.el.sub.append(this.status ?? [item.subtitle, item.stationName].filter(Boolean).join(' — '));
    }

    this.paintTime();
    if (!this.el.queue.hasAttribute('hidden')) this.paintQueue();
  }

  paintTime() {
    const { currentTime, duration } = this.audio;

    if (this.isLive || !Number.isFinite(duration)) {
      this.el.time.textContent = this.index < 0 ? '--:--' : fmtTime(currentTime);
      return;
    }
    this.el.time.textContent = `${fmtTime(currentTime)} / ${fmtTime(duration)}`;
    this.el.line.style.width = duration ? `${(currentTime / duration) * 100}%` : '0';
  }

  paintQueue() {
    const list = this.el.queue;
    clear(list);

    list.append(h('header', { class: 'queue__head' },
      h('span', { class: 'label', text: `File — ${this.queue.length} élément${this.queue.length > 1 ? 's' : ''}` }),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Fermer', onclick: () => this.toggleQueue() }, icon('close', 12)),
    ));

    if (!this.queue.length) {
      list.append(h('div', { class: 'empty', text: 'File vide', style: { padding: '30px 0' } }));
      return;
    }

    this.queue.forEach((item, i) => {
      list.append(h('div', {
        class: `queue__item ${i === this.index ? 'is-current' : ''}`,
        onclick: () => this.jump(i),
      },
        h('span', { class: 'mono muted tnum', text: String(i + 1).padStart(2, '0') }),
        h('div', { style: { minWidth: 0 } },
          h('div', { class: 'queue__title', text: item.title }),
          h('div', { class: 'queue__sub', text: item.subtitle || '' }),
        ),
        h('span', { class: 'mono muted tnum', text: item.duration ? fmtTime(item.duration) : '' }),
      ));
    });
  }
}

function trackItem(track, station) {
  return {
    kind: 'file',
    src: track.audio_url,
    title: track.title,
    subtitle: track.artist || 'artiste inconnu',
    duration: track.duration,
    trackId: track.id,
    stationId: station?.id ?? null,
    stationName: station?.name ?? null,
    slug: station?.slug ?? null,
    cover: track.cover_url ?? station?.cover_url ?? null,
  };
}

export const player = new Player();
