import {
  h, frag, render, clear, icon, fmtTime, fmtDate, fmtDateTime, toast, modal, confirmDialog, dragReorder,
} from './dom.js';
import { api, qs } from './api.js';
import { player } from './player.js';

const state = {
  user: null,
  stations: [],
  filters: { q: '', genre: '', kind: '', sort: 'recent' },
};

const main = () => document.getElementById('main');

/* --------------------------------------------------------------- routing */

const ROUTES = [
  [/^\/$/, () => viewHome()],
  [/^\/station\/([A-Za-z0-9_-]+)$/, (slug) => viewStation(slug)],
  [/^\/titres$/, () => viewTracks()],
  [/^\/playlists$/, () => viewPlaylists()],
  [/^\/playlist\/(\d+)$/, (id) => viewPlaylist(Number(id))],
  [/^\/compte$/, () => viewAccount()],
  [/^\/connexion$/, () => viewAuth('login')],
  [/^\/inscription$/, () => viewAuth('register')],
];

function navigate(path, { replace = false } = {}) {
  if (replace) history.replaceState({}, '', path);
  else history.pushState({}, '', path);
  route();
}

async function route() {
  const path = location.pathname.replace(/\/+$/, '') || '/';

  for (const [pattern, handler] of ROUTES) {
    const match = path.match(pattern);
    if (match) {
      window.scrollTo(0, 0);
      paintNav();
      try {
        await handler(...match.slice(1));
      } catch (err) {
        render(main(), h('div', { class: 'wrap page' }, h('div', { class: 'notice', text: err.message })));
      }
      return;
    }
  }

  render(main(), h('div', { class: 'wrap page' },
    h('span', { class: 'label', text: 'Erreur 404' }),
    h('div', { class: 'page__head' }, h('h1', { text: 'Hors antenne' })),
    h('p', { class: 'muted', text: 'Cette adresse ne correspond à aucune page.' }),
    h('p', {}, link('/', 'Retour à la grille', 'btn')),
  ));
}

function link(href, label, cls = '') {
  return h('a', { href, class: cls, 'data-link': '', text: label });
}

document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-link]');
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  e.preventDefault();
  navigate(a.getAttribute('href'));
});

window.addEventListener('popstate', route);

/* ------------------------------------------------------------------- nav */

function paintNav() {
  const path = location.pathname;
  const isOn = (href) => (path === href || (href !== '/' && path.startsWith(href)) ? 'is-active' : '');

  const nav = h('nav', { class: 'nav' },
    h('a', { href: '/', class: isOn('/'), 'data-link': '', text: 'Grille' }),
    h('a', { href: '/titres', class: isOn('/titres'), 'data-link': '', text: 'Titres' }),
    h('a', { href: '/playlists', class: isOn('/playlists'), 'data-link': '', text: 'Playlists' }),
    state.user
      ? h('a', { href: '/compte', class: isOn('/compte'), 'data-link': '', text: state.user.username })
      : h('a', { href: '/connexion', class: isOn('/connexion'), 'data-link': '', text: 'Se connecter' }),
    state.user?.role === 'admin' ? h('a', { href: '/studio', text: 'Studio', class: 'accent' }) : null,
  );

  render(document.getElementById('nav'),
    h('a', { href: '/', class: 'brand', 'data-link': '' }, 'Onde', h('em', { text: 'radio en continu' })),
    nav,
    h('button', {
      class: 'icon-btn', type: 'button', 'aria-label': 'Changer de thème', onclick: toggleTheme,
    }, icon('theme', 13)),
  );
}

function toggleTheme() {
  const root = document.documentElement;
  const current = root.dataset.theme
    || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const next = current === 'dark' ? 'light' : 'dark';
  root.dataset.theme = next;
  try { localStorage.setItem('onde.theme', next); } catch { /* ignore */ }
}

/* ------------------------------------------------------------- home view */

async function viewHome() {
  const [{ stations }, { genres }] = await Promise.all([
    api.get(`/api/stations${qs(state.filters)}`),
    api.get('/api/stations/genres'),
  ]);
  state.stations = stations;

  const list = h('div', { class: 'index' });
  const search = h('input', {
    type: 'search', value: state.filters.q, placeholder: 'chercher une station, un genre…', 'aria-label': 'Recherche',
  });

  let timer = null;
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      state.filters.q = search.value.trim();
      const data = await api.get(`/api/stations${qs(state.filters)}`);
      state.stations = data.stations;
      paintIndex(list, data.stations);
    }, 220);
  });

  const reload = async () => {
    const data = await api.get(`/api/stations${qs(state.filters)}`);
    state.stations = data.stations;
    paintIndex(list, data.stations);
    paintChips();
  };

  const chipRow = h('div', { class: 'chips' });
  const paintChips = () => {
    render(chipRow,
      chip('Tout', !state.filters.genre && !state.filters.kind, () => {
        state.filters.genre = ''; state.filters.kind = ''; reload();
      }),
      chip('Direct', state.filters.kind === 'live', () => {
        state.filters.kind = state.filters.kind === 'live' ? '' : 'live'; reload();
      }),
      chip('Mixtape', state.filters.kind === 'mixtape', () => {
        state.filters.kind = state.filters.kind === 'mixtape' ? '' : 'mixtape'; reload();
      }),
      genres.map(({ genre }) => chip(genre, state.filters.genre === genre, () => {
        state.filters.genre = state.filters.genre === genre ? '' : genre; reload();
      })),
    );
  };
  paintChips();

  const sort = h('select', { class: 'select', 'aria-label': 'Trier' },
    ...[['recent', 'récentes'], ['rating', 'mieux notées'], ['popular', 'plus écoutées'], ['name', 'a → z']]
      .map(([value, label]) => h('option', { value, text: label, selected: state.filters.sort === value })),
  );
  sort.addEventListener('change', () => { state.filters.sort = sort.value; reload(); });

  const today = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  const trackTotal = stations.reduce((sum, s) => sum + s.track_count, 0);

  render(main(),
    h('div', { class: 'wrap' },
      h('section', { class: 'hero' },
        h('div', { class: 'hero__meta' },
          h('span', { class: 'label', text: `Grille du ${today}` }),
          h('span', { class: 'label', text: `${stations.length} stations` }),
          h('span', { class: 'label', text: `${trackTotal} titres programmés` }),
        ),
        h('h1', { text: 'La grille' }),
        h('p', { text: 'Des flux en direct et des mixtapes montées à la main. La lecture ne s’interrompt pas quand vous changez de page.' }),
      ),
      h('section', { class: 'filters' },
        h('div', { class: 'search' }, icon('search', 13), search),
        chipRow,
        sort,
      ),
      list,
    ),
  );

  paintIndex(list, stations);
}

function chip(label, active, onclick) {
  return h('button', { class: `chip ${active ? 'is-on' : ''}`, type: 'button', text: label, onclick });
}

function paintIndex(container, stations) {
  clear(container);

  if (!stations.length) {
    container.append(h('div', { class: 'empty', text: 'Aucune station ne correspond à cette recherche.' }));
    return;
  }

  stations.forEach((station, i) => container.append(stationRow(station, i + 1)));
  syncPlayingRows();
}

function stationRow(station, position) {
  const playBtn = h('button', {
    class: 'row__play', type: 'button', 'aria-label': `Écouter ${station.name}`,
    onclick: (e) => { e.stopPropagation(); playStation(station); },
  }, icon('play', 11));

  return h('div', {
    class: 'row', dataset: { station: station.id },
    onclick: () => navigate(`/station/${station.slug}`),
  },
    h('span', { class: 'row__num', text: String(position).padStart(2, '0') }),
    h('div', { class: 'row__main' },
      h('div', { class: 'row__name', text: station.name }),
      h('div', { class: 'row__sub', text: station.tagline || '—' }),
    ),
    h('span', { class: 'row__genre', text: station.genre || '' }),
    h('span', { class: 'row__kind', text: station.kind === 'live' ? 'Direct' : `Mixtape · ${station.track_count}` }),
    h('span', { class: 'row__score' },
      station.rating_avg ? String(station.rating_avg.toFixed(1)) : h('span', { text: '—' }),
    ),
    playBtn,
  );
}

function syncPlayingRows() {
  const stationId = player.current?.stationId ?? null;
  document.querySelectorAll('.row[data-station]').forEach((row) => {
    row.classList.toggle('is-playing', Number(row.dataset.station) === stationId && player.playing);
  });
  document.querySelectorAll('.track[data-track]').forEach((row) => {
    row.classList.toggle('is-playing', Number(row.dataset.track) === (player.current?.trackId ?? null));
  });
}

async function playStation(station) {
  if (station.kind === 'mixtape') {
    const data = await api.get(`/api/stations/${station.slug}`);
    player.playStation(data.station, data.tracks);
  } else {
    player.playStation(station);
  }
}

/* ---------------------------------------------------------- station view */

async function viewStation(slug) {
  const { station, tracks, breakdown } = await api.get(`/api/stations/${slug}`);

  const ratingBox = h('div');
  const paintRating = (summary) => {
    render(ratingBox, ratingWidget(station, summary));
  };
  paintRating({ rating_avg: station.rating_avg, rating_count: station.rating_count, my_rating: station.my_rating });

  const followBtn = h('button', {
    class: `btn ${station.is_favorite ? 'btn--ghost' : ''}`, type: 'button',
    text: station.is_favorite ? 'Suivi' : 'Suivre',
    onclick: async () => {
      if (!requireAccount()) return;
      const next = !followBtn.classList.contains('btn--ghost');
      const call = next ? api.put(`/api/stations/${station.id}/favorite`) : api.del(`/api/stations/${station.id}/favorite`);
      try {
        await call;
        followBtn.classList.toggle('btn--ghost', next);
        followBtn.textContent = next ? 'Suivi' : 'Suivre';
      } catch (err) { toast(err.message, 'error'); }
    },
  });

  const tracksBox = h('div', { class: 'tracks' });
  tracks.forEach((track, i) => tracksBox.append(trackRow(track, i + 1, { station, tracks })));

  render(main(),
    h('div', { class: 'wrap' },
      h('div', { class: 'station' },
        h('div', {},
          h('a', { href: '/', 'data-link': '', class: 'label', text: '← la grille' }),
          h('h1', { text: station.name }),
          station.tagline ? h('p', { class: 'station__tagline', text: station.tagline }) : null,

          h('div', { class: 'station__actions' },
            h('button', {
              class: 'btn btn--solid', type: 'button', onclick: () => player.playStation(station, tracks),
            }, icon('play', 12), station.kind === 'live' ? 'Écouter le direct' : 'Lancer la mixtape'),
            followBtn,
            h('button', {
              class: 'btn btn--ghost', type: 'button', text: 'Ajouter à une playlist',
              onclick: () => addToPlaylist('station', station.id, station.name),
            }),
          ),

          ratingBox,
          station.description ? h('p', { class: 'station__desc', text: station.description }) : null,

          tracks.length
            ? frag(
                h('h2', { class: 'label', style: { marginTop: '40px' }, text: `Programme — ${tracks.length} titres` }),
                tracksBox,
              )
            : station.kind === 'mixtape'
              ? h('div', { class: 'empty', text: 'Programme en cours de montage.' })
              : null,
        ),

        h('aside', {},
          station.cover_url
            ? h('img', { class: 'cover', src: station.cover_url, alt: `Pochette de ${station.name}` })
            : h('div', { class: 'cover cover--none', text: station.kind === 'live' ? 'direct' : 'mixtape' }),

          h('dl', { class: 'deflist' },
            def('Type', station.kind === 'live' ? 'Flux en direct' : 'Mixtape'),
            station.genre ? def('Genre', station.genre) : null,
            station.kind === 'mixtape' ? def('Titres', String(station.track_count)) : null,
            def('Écoutes', String(station.play_count)),
            def('Abonnés', String(station.favorite_count)),
            def('En ligne depuis', fmtDate(station.created_at)),
          ),

          breakdown.length ? ratingBars(breakdown, station.rating_count) : null,
        ),
      ),
    ),
  );

  syncPlayingRows();
}

const def = (term, value) => h('div', {}, h('dt', { text: term }), h('dd', { text: value }));

function ratingWidget(station, summary) {
  const wrap = h('div', { class: 'rating' });

  const setStars = (score, mine) => {
    const list = h('div', { class: `stars ${mine ? 'is-set' : ''}` });
    for (let i = 1; i <= 5; i += 1) {
      const btn = h('button', {
        type: 'button', text: '★', 'aria-label': `Noter ${i} sur 5`,
        class: (mine ? mine >= i : Math.round(score) >= i) ? 'on' : '',
        onclick: async () => {
          if (!requireAccount()) return;
          try {
            const next = mine === i
              ? await api.del(`/api/stations/${station.id}/rating`)
              : await api.put(`/api/stations/${station.id}/rating`, { score: i });
            render(wrap.parentElement, ratingWidget(station, next));
          } catch (err) { toast(err.message, 'error'); }
        },
      });
      btn.addEventListener('mouseenter', () => {
        [...list.children].forEach((el, idx) => el.classList.toggle('hot', idx < i));
      });
      list.append(btn);
    }
    list.addEventListener('mouseleave', () => [...list.children].forEach((el) => el.classList.remove('hot')));
    return list;
  };

  wrap.append(
    setStars(summary.rating_avg ?? 0, summary.my_rating),
    h('span', { class: 'rating__score' },
      summary.rating_avg
        ? frag(h('b', { text: Number(summary.rating_avg).toFixed(1) }), ` / 5 · ${summary.rating_count} avis`)
        : 'pas encore noté',
    ),
    summary.my_rating ? h('span', { class: 'label', text: `votre note : ${summary.my_rating}` }) : null,
  );

  return wrap;
}

function ratingBars(breakdown, total) {
  const byScore = Object.fromEntries(breakdown.map((b) => [b.score, b.n]));
  const box = h('div', { class: 'bars' });

  for (let score = 5; score >= 1; score -= 1) {
    const n = byScore[score] ?? 0;
    box.append(h('div', {},
      h('span', { text: `${score} ★` }),
      h('i', {}, h('b', { style: { width: total ? `${(n / total) * 100}%` : '0' } })),
      h('span', { class: 'tnum', text: String(n) }),
    ));
  }
  return box;
}

function trackRow(track, position, context = {}) {
  return h('div', {
    class: 'track', dataset: { track: track.id },
    ondblclick: () => player.playTracks(context.tracks ?? [track], position - 1, context.station ?? null),
  },
    h('button', {
      class: 'track__num', type: 'button', 'aria-label': `Écouter ${track.title}`, style: { border: 0, cursor: 'pointer', background: 'none' },
      onclick: () => player.playTracks(context.tracks ?? [track], (context.tracks ? position - 1 : 0), context.station ?? null),
    }, String(position).padStart(2, '0')),
    h('div', { style: { minWidth: 0 } },
      h('div', { class: 'track__title', text: track.title }),
      h('div', { class: 'track__artist', text: [track.artist, track.album].filter(Boolean).join(' · ') || '—' }),
    ),
    h('span', { class: 'track__time', text: track.duration ? fmtTime(track.duration) : '' }),
    h('button', {
      class: 'btn btn--ghost btn--sm', type: 'button', title: 'Ajouter à une playlist',
      onclick: () => addToPlaylist('track', track.id, track.title),
    }, icon('plus', 11)),
  );
}

/* ----------------------------------------------------------- track index */

async function viewTracks() {
  const search = h('input', { type: 'search', placeholder: 'chercher un titre, un artiste…', 'aria-label': 'Recherche' });
  const list = h('div', { class: 'tracks' });

  const load = async (q = '') => {
    const { tracks } = await api.get(`/api/tracks${qs({ q })}`);
    clear(list);
    if (!tracks.length) {
      list.append(h('div', { class: 'empty', text: 'Aucun titre en ligne pour l’instant.' }));
      return;
    }
    tracks.forEach((track, i) => list.append(trackRow(track, i + 1, { tracks })));
    syncPlayingRows();
  };

  let timer = null;
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => load(search.value.trim()), 220);
  });

  render(main(),
    h('div', { class: 'wrap page' },
      h('div', { class: 'page__head' },
        h('span', { class: 'label', text: 'Discothèque' }),
        h('h1', { text: 'Les titres' }),
      ),
      h('section', { class: 'filters' }, h('div', { class: 'search' }, icon('search', 13), search)),
      list,
    ),
  );

  await load();
}

/* ------------------------------------------------------------- playlists */

async function viewPlaylists() {
  const [mine, publics] = await Promise.all([
    state.user ? api.get('/api/playlists') : Promise.resolve({ playlists: [] }),
    api.get('/api/playlists/public'),
  ]);

  render(main(),
    h('div', { class: 'wrap page' },
      h('div', { class: 'page__head' },
        h('span', { class: 'label', text: 'Sélections' }),
        h('h1', { text: 'Playlists' }),
      ),

      h('section', { class: 'section' },
        h('h2', { text: 'Les vôtres' }),
        state.user
          ? frag(
              h('button', {
                class: 'btn btn--solid', type: 'button', style: { marginBottom: '18px' },
                onclick: () => newPlaylistDialog(),
              }, icon('plus', 12), 'Nouvelle playlist'),
              mine.playlists.length
                ? frag(...mine.playlists.map(playlistRow))
                : h('div', { class: 'empty', text: 'Vous n’avez pas encore de playlist.' }),
            )
          : h('p', { class: 'muted' }, 'Connectez-vous pour créer vos playlists. ', link('/connexion', 'Se connecter', 'accent')),
      ),

      h('section', { class: 'section' },
        h('h2', { text: 'Publiques' }),
        publics.playlists.length
          ? frag(...publics.playlists.map(playlistRow))
          : h('div', { class: 'empty', text: 'Aucune playlist publique pour l’instant.' }),
      ),
    ),
  );
}

function playlistRow(pl) {
  return h('div', { class: 'list-row' },
    h('div', { class: 'list-row__main' },
      h('a', { class: 'list-row__title', href: `/playlist/${pl.id}`, 'data-link': '', text: pl.name }),
      h('div', {
        class: 'list-row__sub',
        text: `${pl.item_count} élément${pl.item_count > 1 ? 's' : ''} · ${pl.owner} · ${pl.is_public ? 'publique' : 'privée'}`,
      }),
    ),
    link(`/playlist/${pl.id}`, 'Ouvrir', 'btn btn--ghost btn--sm'),
  );
}

function newPlaylistDialog() {
  modal('Nouvelle playlist', (close) => {
    const name = h('input', { class: 'input', required: true, maxlength: '80' });
    const description = h('textarea', { class: 'textarea', maxlength: '400' });
    const isPublic = h('input', { type: 'checkbox' });

    const form = h('form', { class: 'form' },
      h('label', { class: 'field' }, h('span', { class: 'label', text: 'Nom' }), name),
      h('label', { class: 'field' }, h('span', { class: 'label', text: 'Description' }), description),
      h('label', { class: 'checkbox' }, isPublic, 'Rendre publique'),
      h('div', { class: 'modal__actions' },
        h('button', { class: 'btn btn--ghost', type: 'button', text: 'Annuler', onclick: close }),
        h('button', { class: 'btn btn--solid', type: 'submit', text: 'Créer' }),
      ),
    );

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const { playlist } = await api.post('/api/playlists', {
          name: name.value, description: description.value, is_public: isPublic.checked,
        });
        close();
        navigate(`/playlist/${playlist.id}`);
      } catch (err) { toast(err.message, 'error'); }
    });

    return form;
  });
}

async function viewPlaylist(id) {
  const { playlist, items } = await api.get(`/api/playlists/${id}`);

  const list = h('div', { class: 'tracks' });
  const paintItems = (rows) => {
    clear(list);
    if (!rows.length) {
      list.append(h('div', { class: 'empty', text: 'Playlist vide. Ajoutez des stations ou des titres depuis la grille.' }));
      return;
    }

    rows.forEach((item, i) => {
      const isTrack = item.kind === 'track';
      const title = isTrack ? item.track.title : item.station.name;
      const sub = isTrack
        ? [item.track.artist, item.track.album].filter(Boolean).join(' · ') || '—'
        : `Station · ${item.station.genre || 'sans genre'}`;

      list.append(h('div', {
        class: 'track', draggable: playlist.is_mine ? 'true' : null, dataset: { id: item.item_id },
      },
        h('button', {
          class: 'track__num', type: 'button', style: { border: 0, background: 'none', cursor: 'pointer' },
          'aria-label': `Écouter ${title}`,
          onclick: () => playFrom(rows, i),
        }, String(i + 1).padStart(2, '0')),
        h('div', { style: { minWidth: 0 } },
          isTrack
            ? h('div', { class: 'track__title', text: title })
            : h('a', { class: 'track__title', href: `/station/${item.station.slug}`, 'data-link': '', text: title }),
          h('div', { class: 'track__artist', text: sub }),
        ),
        h('span', { class: 'track__time', text: isTrack && item.track.duration ? fmtTime(item.track.duration) : '' }),
        playlist.is_mine
          ? h('button', {
              class: 'btn btn--ghost btn--sm', type: 'button', 'aria-label': 'Retirer',
              onclick: async () => {
                const data = await api.del(`/api/playlists/${id}/items/${item.item_id}`);
                paintItems(data.items);
              },
            }, icon('close', 11))
          : null,
      ));
    });

    if (playlist.is_mine) {
      dragReorder(list, async (order) => {
        try { await api.put(`/api/playlists/${id}/order`, { item_ids: order }); }
        catch (err) { toast(err.message, 'error'); }
      });
    }
  };

  const playFrom = async (rows, index) => {
    const item = rows[index];
    if (item.kind === 'station') {
      const data = await api.get(`/api/stations/${item.station.slug}`);
      return player.playStation(data.station, data.tracks);
    }
    const tracks = rows.filter((r) => r.kind === 'track').map((r) => r.track);
    const position = tracks.findIndex((t) => t.id === item.track.id);
    player.playTracks(tracks, Math.max(position, 0));
  };

  render(main(),
    h('div', { class: 'wrap page' },
      h('div', { class: 'page__head' },
        h('a', { href: '/playlists', 'data-link': '', class: 'label', text: '← playlists' }),
        h('h1', { text: playlist.name }),
        h('p', { class: 'muted', style: { marginTop: '12px' } },
          `${playlist.item_count} élément${playlist.item_count > 1 ? 's' : ''} · par ${playlist.owner} · `,
          playlist.is_public ? 'publique' : 'privée',
        ),
        playlist.description ? h('p', { class: 'muted', style: { maxWidth: '60ch' }, text: playlist.description }) : null,
      ),

      h('div', { class: 'station__actions' },
        h('button', {
          class: 'btn btn--solid', type: 'button', onclick: () => items.length && playFrom(items, 0),
        }, icon('play', 12), 'Tout écouter'),

        playlist.is_mine
          ? h('button', { class: 'btn btn--ghost', type: 'button', text: 'Renommer', onclick: () => editPlaylistDialog(playlist) })
          : null,
        playlist.is_mine
          ? h('button', {
              class: 'btn btn--ghost btn--danger', type: 'button', text: 'Supprimer',
              onclick: async () => {
                if (!(await confirmDialog('Supprimer la playlist', `« ${playlist.name} » sera définitivement supprimée.`))) return;
                await api.del(`/api/playlists/${playlist.id}`);
                navigate('/playlists');
              },
            })
          : null,
      ),

      playlist.is_mine ? h('p', { class: 'label', text: 'glissez les lignes pour réordonner' }) : null,
      list,
    ),
  );

  paintItems(items);
}

function editPlaylistDialog(playlist) {
  modal('Modifier la playlist', (close) => {
    const name = h('input', { class: 'input', value: playlist.name, maxlength: '80' });
    const description = h('textarea', { class: 'textarea', maxlength: '400' }, playlist.description);
    const isPublic = h('input', { type: 'checkbox', checked: playlist.is_public });

    const form = h('form', {},
      h('label', { class: 'field' }, h('span', { class: 'label', text: 'Nom' }), name),
      h('label', { class: 'field' }, h('span', { class: 'label', text: 'Description' }), description),
      h('label', { class: 'checkbox' }, isPublic, 'Publique'),
      h('div', { class: 'modal__actions' },
        h('button', { class: 'btn btn--ghost', type: 'button', text: 'Annuler', onclick: close }),
        h('button', { class: 'btn btn--solid', type: 'submit', text: 'Enregistrer' }),
      ),
    );

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api.patch(`/api/playlists/${playlist.id}`, {
          name: name.value, description: description.value, is_public: isPublic.checked,
        });
        close();
        route();
      } catch (err) { toast(err.message, 'error'); }
    });

    return form;
  });
}

async function addToPlaylist(kind, refId, label) {
  if (!requireAccount()) return;

  const { playlists } = await api.get('/api/playlists');

  modal(`Ajouter « ${label} »`, (close) => {
    const box = h('div');

    const add = async (playlistId) => {
      try {
        await api.post(`/api/playlists/${playlistId}/items`, { kind, ref_id: refId });
        close();
        toast('Ajouté à la playlist.');
      } catch (err) { toast(err.message, 'error'); }
    };

    box.append(
      playlists.length
        ? frag(...playlists.map((pl) => h('button', {
            class: 'list-row', type: 'button',
            style: { width: '100%', textAlign: 'left', background: 'none', border: 0, borderBottom: '1px solid var(--rule-soft)', cursor: 'pointer' },
            onclick: () => add(pl.id),
          },
            h('div', { class: 'list-row__main' },
              h('div', { class: 'list-row__title', text: pl.name }),
              h('div', { class: 'list-row__sub', text: `${pl.item_count} élément${pl.item_count > 1 ? 's' : ''}` }),
            ),
            icon('plus', 12),
          )))
        : h('p', { class: 'muted', text: 'Aucune playlist pour l’instant.' }),
    );

    const name = h('input', { class: 'input', placeholder: 'nom de la nouvelle playlist', maxlength: '80' });
    const create = h('form', { style: { marginTop: '22px' } },
      h('label', { class: 'field' }, h('span', { class: 'label', text: 'Créer et ajouter' }), name),
      h('div', { class: 'modal__actions' },
        h('button', { class: 'btn btn--ghost', type: 'button', text: 'Fermer', onclick: close }),
        h('button', { class: 'btn btn--solid', type: 'submit', text: 'Créer' }),
      ),
    );

    create.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!name.value.trim()) return;
      try {
        const { playlist } = await api.post('/api/playlists', { name: name.value });
        await add(playlist.id);
      } catch (err) { toast(err.message, 'error'); }
    });

    box.append(create);
    return box;
  });
}

/* ---------------------------------------------------------- account view */

async function viewAccount() {
  if (!state.user) return navigate('/connexion', { replace: true });

  const [{ stations }, { history }, { playlists }] = await Promise.all([
    api.get('/api/favorites'),
    api.get('/api/history'),
    api.get('/api/playlists'),
  ]);

  const bio = h('textarea', { class: 'textarea', maxlength: '280' }, state.user.bio);
  const bioForm = h('form', {},
    h('label', { class: 'field' }, h('span', { class: 'label', text: 'Présentation' }), bio),
    h('button', { class: 'btn', type: 'submit', text: 'Enregistrer' }),
  );
  bioForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const { user } = await api.patch('/api/auth/me', { bio: bio.value });
      state.user = user;
      toast('Profil mis à jour.');
    } catch (err) { toast(err.message, 'error'); }
  });

  const current = h('input', { class: 'input', type: 'password', autocomplete: 'current-password' });
  const next = h('input', { class: 'input', type: 'password', autocomplete: 'new-password', minlength: '8' });
  const pwForm = h('form', {},
    h('label', { class: 'field' }, h('span', { class: 'label', text: 'Mot de passe actuel' }), current),
    h('label', { class: 'field' }, h('span', { class: 'label', text: 'Nouveau mot de passe' }), next),
    h('button', { class: 'btn', type: 'submit', text: 'Changer' }),
  );
  pwForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api.post('/api/auth/me/password', { current: current.value, next: next.value });
      current.value = ''; next.value = '';
      toast('Mot de passe modifié.');
    } catch (err) { toast(err.message, 'error'); }
  });

  render(main(),
    h('div', { class: 'wrap page' },
      h('div', { class: 'page__head' },
        h('span', { class: 'label', text: state.user.role === 'admin' ? 'Compte · studio' : 'Compte' }),
        h('h1', { text: state.user.username }),
        h('p', { class: 'muted mono', style: { marginTop: '12px' }, text: `${state.user.email} · inscrit le ${fmtDate(state.user.created_at)}` }),
      ),

      h('div', { class: 'station__actions' },
        state.user.role === 'admin' ? h('a', { class: 'btn btn--solid', href: '/studio', text: 'Ouvrir le studio' }) : null,
        h('button', {
          class: 'btn btn--ghost', type: 'button', text: 'Se déconnecter',
          onclick: async () => {
            await api.post('/api/auth/logout');
            state.user = null;
            navigate('/');
          },
        }),
      ),

      h('div', { class: 'cards cards--3', style: { marginTop: '10px' } },
        h('div', {}, h('span', { class: 'label', text: 'Stations suivies' }), h('b', { text: String(stations.length) })),
        h('div', {}, h('span', { class: 'label', text: 'Playlists' }), h('b', { text: String(playlists.length) })),
        h('div', {}, h('span', { class: 'label', text: 'Écoutes' }), h('b', { text: String(history.length) })),
      ),

      h('section', { class: 'section' },
        h('h2', { text: 'Stations suivies' }),
        stations.length
          ? h('div', { class: 'index' }, ...stations.map((s, i) => stationRow(s, i + 1)))
          : h('div', { class: 'empty', text: 'Aucune station suivie.' }),
      ),

      h('section', { class: 'section' },
        h('h2', { text: 'Dernières écoutes' }),
        history.length
          ? h('div', { class: 'tracks' }, ...history.map((row) => h('div', { class: 'track', style: { gridTemplateColumns: '1fr auto' } },
              h('div', {},
                h('div', { class: 'track__title', text: row.track_title || row.name || 'Élément supprimé' }),
                h('div', { class: 'track__artist', text: row.track_artist || row.genre || '' }),
              ),
              h('span', { class: 'track__time', text: fmtDateTime(row.played_at) }),
            )))
          : h('div', { class: 'empty', text: 'Rien encore écouté.' }),
      ),

      h('section', { class: 'section' }, h('h2', { text: 'Profil' }), bioForm),
      h('section', { class: 'section' }, h('h2', { text: 'Sécurité' }), pwForm),
    ),
  );
}

/* ------------------------------------------------------------- auth view */

function viewAuth(mode) {
  if (state.user) return navigate('/compte', { replace: true });

  const isLogin = mode === 'login';
  const notice = h('div', { class: 'notice', hidden: true });

  const identifier = h('input', { class: 'input', autocomplete: 'username', required: true });
  const email = h('input', { class: 'input', type: 'email', autocomplete: 'email', required: true });
  const username = h('input', { class: 'input', autocomplete: 'username', required: true, minlength: '3', maxlength: '32' });
  const password = h('input', {
    class: 'input', type: 'password', required: true, minlength: isLogin ? '1' : '8',
    autocomplete: isLogin ? 'current-password' : 'new-password',
  });

  const form = h('form', {},
    isLogin
      ? h('label', { class: 'field' }, h('span', { class: 'label', text: 'E-mail ou pseudo' }), identifier)
      : frag(
          h('label', { class: 'field' }, h('span', { class: 'label', text: 'E-mail' }), email),
          h('label', { class: 'field' }, h('span', { class: 'label', text: 'Pseudo' }), username),
        ),
    h('label', { class: 'field' }, h('span', { class: 'label', text: 'Mot de passe' }), password),
    h('button', { class: 'btn btn--solid', type: 'submit', style: { width: '100%', justifyContent: 'center' }, text: isLogin ? 'Entrer' : 'Créer le compte' }),
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    notice.hidden = true;
    try {
      const { user } = isLogin
        ? await api.post('/api/auth/login', { identifier: identifier.value, password: password.value })
        : await api.post('/api/auth/register', { email: email.value, username: username.value, password: password.value });

      state.user = user;
      toast(`Bonjour ${user.username}.`);
      navigate('/');
    } catch (err) {
      notice.textContent = err.message;
      notice.hidden = false;
    }
  });

  render(main(),
    h('div', { class: 'wrap' },
      h('div', { class: 'auth' },
        h('span', { class: 'label', text: isLogin ? 'Accès auditeur' : 'Nouveau compte' }),
        h('h1', { text: isLogin ? 'Se connecter' : 'S’inscrire' }),
        notice,
        form,
        h('p', { class: 'auth__alt' },
          isLogin ? 'Pas encore de compte ? ' : 'Déjà inscrit ? ',
          link(isLogin ? '/inscription' : '/connexion', isLogin ? 'Créer un compte' : 'Se connecter'),
        ),
        h('p', { class: 'auth__alt muted', text: 'Un compte sert à noter les stations, les suivre et monter des playlists. Rien de plus.' }),
      ),
    ),
  );
}

function requireAccount() {
  if (state.user) return true;
  toast('Connectez-vous pour faire ça.', 'error');
  navigate('/connexion');
  return false;
}

/* ------------------------------------------------------------------ boot */

player.subscribe((_p, isTick) => { if (!isTick) syncPlayingRows(); });

api.get('/api/auth/me')
  .then(({ user }) => { state.user = user; })
  .catch(() => {})
  .finally(() => { paintNav(); route(); });
