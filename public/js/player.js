import { h, render, clear, icon, fmtTime, toast } from './dom.js';
import { api } from './api.js';

const VOLUME_KEY = 'onde.volume';
const SPEED_KEY = 'onde.speed';
const PROGRESS_KEY = 'onde.progress';
const SPEEDS = [1, 1.25, 1.5, 1.75, 2];
const SKIP = 15;

/** Positions for signed-out listeners live in the browser only. */
const localProgress = {
  read() {
    try { return JSON.parse(localStorage.getItem(PROGRESS_KEY) ?? '{}'); } catch { return {}; }
  },
  get(id) { return this.read()[id] ?? 0; },
  set(id, position) {
    try {
      const all = this.read();
      if (position > 30) all[id] = Math.round(position);
      else delete all[id];
      localStorage.setItem(PROGRESS_KEY, JSON.stringify(all));
    } catch { /* private mode */ }
  },
};

/**
 * One <audio> for the whole app, so moving between pages never cuts the sound.
 * The queue holds episodes; each one is a finished piece, nothing is streamed live.
 */
class Player {
  constructor() {
    this.audio = new Audio();
    this.audio.preload = 'metadata';
    this.audio.volume = Number(localStorage.getItem(VOLUME_KEY) ?? 0.9);
    this.speed = Number(localStorage.getItem(SPEED_KEY) ?? 1);
    this.audio.playbackRate = this.speed;

    this.queue = [];
    this.index = -1;
    this.user = null;
    this.listeners = new Set();
    this.logged = new Set();
    this.status = null;
    this.lastSaved = 0;
    this.resumeTo = 0;

    this.audio.addEventListener('play', () => this.emit());
    this.audio.addEventListener('pause', () => { this.saveProgress(true); this.emit(); });
    this.audio.addEventListener('timeupdate', () => this.tick());
    this.audio.addEventListener('durationchange', () => this.emit());
    this.audio.addEventListener('ended', () => this.onEnded());
    this.audio.addEventListener('error', () => this.onError());
    this.audio.addEventListener('waiting', () => this.setStatus('chargement…'));
    this.audio.addEventListener('loadedmetadata', () => this.applyResume());
    this.audio.addEventListener('playing', () => { this.setStatus(null); this.logPlay(); });

    this.buildBar();
    this.bindKeys();
  }

  setUser(user) { this.user = user; }

  /* -------------------------------------------------------------- playback */

  get current() { return this.queue[this.index] ?? null; }
  get playing() { return !this.audio.paused && this.index >= 0; }

  /** `episodes` is the queue; playback starts at `index`, resuming where it stopped. */
  play(episodes, index = 0) {
    const list = Array.isArray(episodes) ? episodes : [episodes];
    if (!list.length) return;
    this.queue = list;
    this.index = Math.min(Math.max(index, 0), list.length - 1);
    this.start();
  }

  /** Queue the rest of a series/playlist behind the one being played. */
  start(autoplay = true) {
    const episode = this.current;
    if (!episode) { this.audio.removeAttribute('src'); this.audio.load(); return this.emit(); }

    this.resumeTo = this.savedPosition(episode);
    this.audio.src = episode.audio_url;
    this.audio.playbackRate = this.speed;
    this.setStatus('chargement…');
    if (autoplay) this.audio.play().catch(() => this.setStatus('appuyez sur lecture'));
    this.updateMediaSession();
    this.emit();
  }

  savedPosition(episode) {
    const saved = this.user ? episode.progress?.position ?? 0 : localProgress.get(episode.id);
    if (this.user && episode.progress?.completed) return 0;
    // Never resume within a whisker of the end.
    return saved > 30 && (!episode.duration || saved < episode.duration - 20) ? saved : 0;
  }

  applyResume() {
    if (this.resumeTo > 0) {
      this.audio.currentTime = this.resumeTo;
      this.resumeTo = 0;
    }
    this.audio.playbackRate = this.speed;
    this.emit();
  }

  toggle() {
    if (!this.current) return;
    if (this.audio.paused) this.audio.play().catch(() => toast('Lecture refusée par le navigateur.', 'error'));
    else this.audio.pause();
  }

  skip(seconds) {
    if (!this.current || !Number.isFinite(this.audio.duration)) return;
    this.audio.currentTime = Math.max(0, Math.min(this.audio.duration, this.audio.currentTime + seconds));
  }

  next() {
    if (this.index < this.queue.length - 1) { this.index += 1; this.start(); }
    else { this.audio.pause(); this.emit(); }
  }

  prev() {
    if (this.audio.currentTime > 5) { this.audio.currentTime = 0; return; }
    if (this.index > 0) { this.index -= 1; this.start(); }
  }

  jump(index) {
    if (index < 0 || index >= this.queue.length) return;
    this.index = index;
    this.start();
  }

  seekRatio(ratio) {
    if (!Number.isFinite(this.audio.duration)) return;
    this.audio.currentTime = Math.max(0, Math.min(1, ratio)) * this.audio.duration;
  }

  setVolume(value) {
    this.audio.volume = Math.max(0, Math.min(1, value));
    localStorage.setItem(VOLUME_KEY, String(this.audio.volume));
  }

  cycleSpeed() {
    this.speed = SPEEDS[(SPEEDS.indexOf(this.speed) + 1) % SPEEDS.length] ?? 1;
    this.audio.playbackRate = this.speed;
    localStorage.setItem(SPEED_KEY, String(this.speed));
    this.emit();
  }

  setStatus(text) { this.status = text; this.emit(); }

  onEnded() {
    this.saveProgress(true, true);
    this.next();
  }

  onError() {
    if (!this.current) return;
    this.setStatus('fichier illisible');
    toast(`Impossible de lire « ${this.current.title} ».`, 'error');
  }

  /* -------------------------------------------------------------- progress */

  saveProgress(force = false, completed = false) {
    const episode = this.current;
    if (!episode) return;

    const position = completed ? 0 : this.audio.currentTime;
    if (!completed && !force && Math.abs(position - this.lastSaved) < 10) return;
    this.lastSaved = position;

    if (episode.progress) Object.assign(episode.progress, { position, completed });
    else episode.progress = { position, completed };

    if (this.user) {
      api.put(`/api/episodes/${episode.id}/progress`, { position, completed }).catch(() => {});
    } else {
      localProgress.set(episode.id, completed ? 0 : position);
    }
  }

  logPlay() {
    const episode = this.current;
    if (!episode || this.logged.has(episode.id)) return;
    this.logged.add(episode.id);
    api.post('/api/plays', { episode_id: episode.id }).catch(() => {});
  }

  updateMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const episode = this.current;
    if (!episode) return;

    navigator.mediaSession.metadata = new MediaMetadata({
      title: episode.title,
      artist: episode.authors || 'Onde',
      album: episode.series?.title ?? 'Onde',
      artwork: episode.cover_url ? [{ src: episode.cover_url, sizes: '512x512' }] : [],
    });
    const handlers = {
      play: () => this.toggle(),
      pause: () => this.toggle(),
      nexttrack: () => this.next(),
      previoustrack: () => this.prev(),
      seekbackward: () => this.skip(-SKIP),
      seekforward: () => this.skip(SKIP),
    };
    for (const [action, handler] of Object.entries(handlers)) {
      try { navigator.mediaSession.setActionHandler(action, handler); } catch { /* unsupported action */ }
    }
  }

  /* ---------------------------------------------------------------- events */

  subscribe(fn) { this.listeners.add(fn); fn(this); return () => this.listeners.delete(fn); }
  emit() { this.paint(); this.listeners.forEach((fn) => fn(this)); }

  tick() {
    this.paintTime();
    this.saveProgress();
    this.listeners.forEach((fn) => fn(this, true));
  }

  bindKeys() {
    document.addEventListener('keydown', (e) => {
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) return;

      if (e.code === 'Space') { e.preventDefault(); this.toggle(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); this.skip(SKIP); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); this.skip(-SKIP); }
      else if (e.key === 'j') this.skip(-30);
      else if (e.key === 'l') this.skip(30);
    });

    // A closing tab should not lose the last minutes of listening.
    addEventListener('pagehide', () => this.saveProgress(true));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.saveProgress(true);
    });
  }

  /* -------------------------------------------------------------------- UI */

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

    this.el.back = h('button', {
      class: 'player__skip', type: 'button', 'aria-label': 'Reculer de 15 secondes', onclick: () => this.skip(-SKIP),
    }, icon('back15', 19));

    this.el.toggle = h('button', {
      class: 'player__toggle', type: 'button', 'aria-label': 'Lecture', onclick: () => this.toggle(),
    }, icon('play'));

    this.el.fwd = h('button', {
      class: 'player__skip', type: 'button', 'aria-label': 'Avancer de 15 secondes', onclick: () => this.skip(SKIP),
    }, icon('fwd15', 19));

    this.el.title = h('div', { class: 'player__title', text: 'Rien en écoute' });
    this.el.sub = h('div', { class: 'player__sub' });
    this.el.time = h('div', { class: 'player__time tnum', text: '--:-- / --:--' });

    this.el.speed = h('button', {
      class: 'player__rate', type: 'button', 'aria-label': 'Vitesse de lecture', text: '1×', onclick: () => this.cycleSpeed(),
    });

    this.el.volume = h('input', {
      type: 'range', min: '0', max: '1', step: '0.01', value: String(this.audio.volume),
      'aria-label': 'Volume', oninput: (e) => this.setVolume(Number(e.target.value)),
    });

    this.el.queueBtn = h('button', {
      class: 'icon-btn', type: 'button', 'aria-label': 'File d’écoute', onclick: () => this.toggleQueue(),
    }, icon('list', 14));

    this.el.queue = h('aside', { class: 'queue', hidden: true, 'aria-label': 'File d’écoute' });

    this.el.bar = h('div', { class: 'player is-idle' },
      this.el.line,
      this.el.seek,
      h('div', { class: 'wrap player__in' },
        h('div', { class: 'player__transport' }, this.el.back, this.el.toggle, this.el.fwd),
        h('div', { class: 'player__now' }, this.el.title, this.el.sub),
        this.el.time,
        this.el.speed,
        h('div', { class: 'player__vol' }, this.el.volume),
        this.el.queueBtn,
      ),
    );

    const mount = () => {
      this.audio.hidden = true;
      document.body.append(this.audio, this.el.queue, this.el.bar);
      this.paint();
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
    else mount();
  }

  toggleQueue() {
    if (this.el.queue.hasAttribute('hidden')) {
      this.paintQueue();
      this.el.queue.removeAttribute('hidden');
    } else {
      this.el.queue.setAttribute('hidden', '');
    }
  }

  paint() {
    const episode = this.current;
    this.el.bar.classList.toggle('is-idle', !episode);

    render(this.el.toggle, icon(this.playing ? 'pause' : 'play'));
    this.el.toggle.setAttribute('aria-label', this.playing ? 'Pause' : 'Lecture');
    this.el.toggle.disabled = !episode;
    this.el.back.disabled = !episode;
    this.el.fwd.disabled = !episode;
    this.el.speed.textContent = `${String(this.speed).replace('.', ',')}×`;

    this.el.title.textContent = episode ? episode.title : 'Rien en écoute';

    clear(this.el.sub);
    if (!episode) {
      this.el.sub.append('choisissez une pièce dans le catalogue');
    } else {
      const parts = [episode.series?.title, episode.authors].filter(Boolean).join(' · ');
      this.el.sub.append(this.status ?? parts ?? '');
    }

    this.paintTime();
    if (!this.el.queue.hasAttribute('hidden')) this.paintQueue();
  }

  paintTime() {
    const { currentTime, duration } = this.audio;

    if (this.index < 0) {
      this.el.time.textContent = '--:-- / --:--';
      this.el.line.style.width = '0';
      return;
    }
    const total = Number.isFinite(duration) ? duration : this.current?.duration ?? 0;
    this.el.time.textContent = `${fmtTime(currentTime)} / ${total ? fmtTime(total) : '--:--'}`;
    this.el.line.style.width = total ? `${Math.min(100, (currentTime / total) * 100)}%` : '0';
  }

  paintQueue() {
    const list = this.el.queue;
    clear(list);

    list.append(h('header', { class: 'queue__head' },
      h('span', { class: 'label', text: `À suivre — ${this.queue.length} pièce${this.queue.length > 1 ? 's' : ''}` }),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Fermer', onclick: () => this.toggleQueue() }, icon('close', 12)),
    ));

    if (!this.queue.length) {
      list.append(h('div', { class: 'empty', text: 'File vide', style: { padding: '30px 0' } }));
      return;
    }

    this.queue.forEach((episode, i) => {
      list.append(h('div', {
        class: `queue__item ${i === this.index ? 'is-current' : ''}`,
        onclick: () => this.jump(i),
      },
        h('span', { class: 'mono muted tnum', text: String(i + 1).padStart(2, '0') }),
        h('div', { style: { minWidth: 0 } },
          h('div', { class: 'queue__title', text: episode.title }),
          h('div', { class: 'queue__sub', text: episode.series?.title ?? episode.authors ?? '' }),
        ),
        h('span', { class: 'mono muted tnum', text: episode.duration ? fmtTime(episode.duration) : '' }),
      ));
    });
  }
}

export const player = new Player();
