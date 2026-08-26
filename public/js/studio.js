import {
  h, frag, render, clear, icon, fmtTime, fmtDate, fmtDateTime, fmtSize, toast, modal, confirmDialog, dragReorder,
} from './dom.js';
import { api, qs } from './api.js';
import { player } from './player.js';

const store = {
  user: null,
  stations: [],
  tracks: [],
  editorBox: null,
  editing: null,      // station being edited, or null for "new"
  programme: [],      // tracks of the station being edited
  tab: 'antenne',
};

const root = () => document.getElementById('studio');

const TABS = [
  ['antenne', 'Antenne', panelDashboard],
  ['stations', 'Stations', panelStations],
  ['titres', 'Titres', panelTracks],
  ['auditeurs', 'Auditeurs', panelUsers],
];

/* ------------------------------------------------------------------ chrome */

function paintNav() {
  const bar = document.getElementById('studio-nav');
  if (!store.user) {
    render(bar, h('a', { class: 'brand', href: '/' }, 'Onde', h('em', { text: 'studio' })));
    return;
  }

  render(bar,
    h('a', { class: 'brand', href: '/studio' }, 'Onde', h('em', { text: 'studio' })),
    h('nav', { class: 'nav nav--right' },
      h('a', { href: '/', text: 'Voir le site' }),
      h('span', { class: 'label', text: store.user.username }),
      h('button', {
        class: 'btn btn--ghost btn--sm', type: 'button', text: 'Quitter',
        onclick: async () => { await api.post('/api/auth/logout'); location.href = '/'; },
      }),
    ),
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Changer de thème', onclick: toggleTheme }, icon('theme', 13)),
  );
}

function toggleTheme() {
  const el = document.documentElement;
  const current = el.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const next = current === 'dark' ? 'light' : 'dark';
  el.dataset.theme = next;
  try { localStorage.setItem('onde.theme', next); } catch { /* ignore */ }
}

function paintTabs() {
  const bar = h('div', { class: 'tabs' });
  TABS.forEach(([id, label]) => {
    bar.append(h('button', {
      class: store.tab === id ? 'is-on' : '', type: 'button', text: label,
      onclick: () => { location.hash = id; },
    }));
  });
  return bar;
}

async function paintTab() {
  const [, , panel] = TABS.find(([id]) => id === store.tab) ?? TABS[0];
  const body = h('div');
  render(root(), h('div', { class: 'wrap' }, paintTabs(), body));

  try {
    await panel(body);
  } catch (err) {
    render(body, h('div', { class: 'panel' }, h('div', { class: 'notice', text: err.message })));
  }
}

window.addEventListener('hashchange', () => {
  const id = location.hash.slice(1);
  store.tab = TABS.some(([tab]) => tab === id) ? id : 'antenne';
  paintTab();
});

/* --------------------------------------------------------------- dashboard */

async function panelDashboard(box) {
  const { totals, top, recent_users: recent } = await api.get('/api/studio/stats');

  const card = (label, value) => h('div', {}, h('span', { class: 'label', text: label }), h('b', { text: value }));

  render(box, h('section', { class: 'panel' },
    h('div', { class: 'panel__head' },
      h('div', {},
        h('span', { class: 'label', text: 'Vue d’ensemble' }),
        h('h1', { text: 'Antenne' }),
      ),
      h('a', { class: 'btn btn--solid', href: '#stations', text: 'Programmer une station' }),
    ),

    h('div', { class: 'cards cards--3' },
      card('Stations en ligne', `${totals.published} / ${totals.stations}`),
      card('Titres en bibliothèque', String(totals.tracks)),
      card('Auditeurs inscrits', String(totals.users)),
      card('Écoutes (7 jours)', String(totals.plays_7d)),
      card('Écoutes totales', String(totals.plays)),
      card('Notes déposées', String(totals.ratings)),
      card('Playlists créées', String(totals.playlists)),
      card('Espace audio', fmtSize(totals.storage)),
    ),

    h('div', { class: 'section' },
      h('h2', { text: 'Stations les plus écoutées' }),
      top.length
        ? table(['Station', 'Écoutes', 'Note'], top.map((row) => [
            h('a', { href: `/station/${row.slug}`, text: row.name }),
            h('span', { class: 'num', text: String(row.plays) }),
            h('span', { class: 'num', text: row.rating_avg ? Number(row.rating_avg).toFixed(1) : '—' }),
          ]))
        : h('div', { class: 'empty', text: 'Pas encore d’écoute enregistrée.' }),
    ),

    h('div', { class: 'section' },
      h('h2', { text: 'Derniers inscrits' }),
      recent.length
        ? table(['Pseudo', 'Rôle', 'Inscription'], recent.map((u) => [
            u.username,
            h('span', { class: `tag ${u.role === 'admin' ? 'tag--on' : ''}`, text: u.role }),
            h('span', { class: 'num', text: fmtDate(u.created_at) }),
          ]))
        : h('div', { class: 'empty', text: 'Aucun compte pour l’instant.' }),
    ),
  ));
}

function table(headers, rows) {
  const thead = h('tr', {}, ...headers.map((label, i) => h('th', {
    text: label, style: i > 0 && i === headers.length - 1 ? { textAlign: 'right' } : null,
  })));

  const tbody = h('tbody', {}, ...rows.map((cells) => h('tr', {}, ...cells.map((cell, i) => h('td', {
    class: i === cells.length - 1 && cells.length > 1 ? 'num' : '',
  }, cell)))));

  return h('div', { class: 'tbl__scroll' }, h('table', { class: 'tbl' }, h('thead', {}, thead), tbody));
}

/* ---------------------------------------------------------------- stations */

async function panelStations(box) {
  const [{ stations }, { tracks }] = await Promise.all([
    api.get('/api/studio/stations'),
    api.get('/api/studio/tracks'),
  ]);
  store.stations = stations;
  store.tracks = tracks;

  const editorBox = h('div', { class: 'editor' });
  const listBox = h('div');
  store.editorBox = editorBox;

  const openEditor = async (station) => {
    store.editing = station;
    store.programme = [];
    if (station?.kind === 'mixtape') {
      const data = await api.get(`/api/studio/stations/${station.id}`);
      store.programme = data.tracks;
    }
    render(editorBox, stationEditor(refresh));
    render(listBox, stationList(openEditor, refresh));
  };

  const refresh = async () => {
    const data = await api.get('/api/studio/stations');
    store.stations = data.stations;
    render(listBox, stationList(openEditor, refresh));
  };

  render(box, h('section', { class: 'panel' },
    h('div', { class: 'panel__head' },
      h('div', {},
        h('span', { class: 'label', text: `${stations.length} stations` }),
        h('h1', { text: 'Stations' }),
      ),
      h('button', { class: 'btn btn--solid', type: 'button', onclick: () => openEditor(null) }, icon('plus', 12), 'Nouvelle station'),
    ),
    h('div', { class: 'split' }, editorBox, listBox),
  ));

  await openEditor(null);
}

function stationList(openEditor, refresh) {
  if (!store.stations.length) {
    return h('div', { class: 'empty', text: 'Aucune station. Créez la première à gauche.' });
  }

  const rows = store.stations.map((s) => [
    h('div', {},
      h('a', { href: `/station/${s.slug}`, style: { fontWeight: '500' }, text: s.name }),
      h('div', { class: 'pick__sub', text: s.tagline || s.genre || '—' }),
    ),
    h('span', { class: `tag ${s.published ? 'tag--on' : 'tag--off'}`, text: s.published ? 'en ligne' : 'brouillon' }),
    h('span', { class: 'tag', text: s.kind === 'live' ? 'direct' : `mixtape ${s.track_count}` }),
    h('span', { class: 'num', text: String(s.play_count) }),
    h('span', { class: 'num', text: s.rating_avg ? Number(s.rating_avg).toFixed(1) : '—' }),
    h('div', { class: 'actions' },
      h('button', { class: 'btn btn--ghost btn--sm', type: 'button', title: 'Modifier', onclick: () => openEditor(s) }, icon('edit', 11)),
      h('button', {
        class: 'btn btn--ghost btn--sm', type: 'button', text: s.published ? 'Retirer' : 'Publier',
        onclick: async () => {
          await api.patch(`/api/studio/stations/${s.id}`, { published: !s.published });
          toast(s.published ? 'Station retirée de la grille.' : 'Station publiée.');
          await refresh();
        },
      }),
      h('button', {
        class: 'btn btn--ghost btn--sm btn--danger', type: 'button', title: 'Supprimer',
        onclick: async () => {
          if (!(await confirmDialog('Supprimer la station', `« ${s.name} » et son programme seront retirés du site.`))) return;
          await api.del(`/api/studio/stations/${s.id}`);
          if (store.editing?.id === s.id) store.editing = null;
          toast('Station supprimée.');
          await refresh();
        },
      }, icon('trash', 11)),
    ),
  ]);

  const head = h('tr', {}, ...['Station', 'État', 'Type', 'Écoutes', 'Note', ''].map((label) => h('th', { text: label })));
  const body = h('tbody', {}, ...rows.map((cells) => h('tr', {}, ...cells.map((cell) => h('td', {}, cell)))));

  return h('div', { class: 'tbl__scroll' }, h('table', { class: 'tbl' }, h('thead', {}, head), body));
}

function stationEditor(refresh) {
  const station = store.editing;
  const isNew = !station;

  const name = h('input', { class: 'input', value: station?.name ?? '', required: true, maxlength: '120' });
  const tagline = h('input', { class: 'input', value: station?.tagline ?? '', maxlength: '160' });
  const genre = h('input', { class: 'input', value: station?.genre ?? '', maxlength: '40', placeholder: 'Ambient, Jazz, Rap…' });
  const description = h('textarea', { class: 'textarea', maxlength: '2000' }, station?.description ?? '');
  const streamUrl = h('input', { class: 'input', type: 'url', value: station?.stream_url ?? '', placeholder: 'https://…' });
  const published = h('input', { type: 'checkbox', checked: Boolean(station?.published) });

  const kind = h('select', { class: 'select' },
    h('option', { value: 'live', text: 'Direct — un flux http(s)', selected: (station?.kind ?? 'live') === 'live' }),
    h('option', { value: 'mixtape', text: 'Mixtape — vos fichiers', selected: station?.kind === 'mixtape' }),
  );

  const liveField = h('label', { class: 'field' }, h('span', { class: 'label', text: 'URL du flux' }), streamUrl);
  const syncKind = () => { liveField.style.display = kind.value === 'live' ? '' : 'none'; };
  kind.addEventListener('change', syncKind);

  let cover = station?.cover ?? null;
  const coverPreview = cover
    ? h('img', { class: 'cover', src: `/media/covers/${cover}`, alt: '' })
    : h('div', { class: 'cover cover--none', text: 'sans' });
  const coverBox = h('div', { class: 'cover-pick' }, coverPreview);

  const coverInput = h('input', { type: 'file', accept: 'image/*', hidden: true });
  coverInput.addEventListener('change', async () => {
    const file = coverInput.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    try {
      const data = await api.upload('/api/studio/covers', form);
      cover = data.cover;
      render(coverBox,
        h('img', { class: 'cover', src: data.cover_url, alt: '' }),
        coverActions(),
      );
    } catch (err) { toast(err.message, 'error'); }
  });

  const coverActions = () => h('div', {},
    h('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: 'Changer', onclick: () => coverInput.click() }),
    cover ? h('button', {
      class: 'btn btn--ghost btn--sm', type: 'button', text: 'Retirer',
      onclick: () => { cover = null; render(coverBox, h('div', { class: 'cover cover--none', text: 'sans' }), coverActions()); },
    }) : null,
  );
  coverBox.append(coverActions());

  const form = h('form', { class: 'editor__box' },
    h('span', { class: 'label', text: isNew ? 'Nouvelle station' : `Station #${station.id}` }),
    h('h2', { style: { margin: '8px 0 22px', fontSize: '20px', letterSpacing: '-.03em' }, text: isNew ? 'Créer' : station.name }),

    h('label', { class: 'field' }, h('span', { class: 'label', text: 'Nom' }), name),
    h('label', { class: 'field' }, h('span', { class: 'label', text: 'Accroche' }), tagline),
    h('label', { class: 'field' }, h('span', { class: 'label', text: 'Genre' }), genre),
    h('label', { class: 'field' }, h('span', { class: 'label', text: 'Source' }), kind),
    liveField,
    h('label', { class: 'field' }, h('span', { class: 'label', text: 'Description' }), description),
    h('div', { class: 'field' }, h('span', { class: 'label', text: 'Pochette' }), coverBox, coverInput),
    h('label', { class: 'checkbox', style: { marginBottom: '20px' } }, published, 'Visible sur le site'),

    h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
      h('button', { class: 'btn btn--solid', type: 'submit', text: isNew ? 'Créer' : 'Enregistrer' }),
      !isNew ? h('button', {
        class: 'btn btn--ghost', type: 'button', text: 'Nouvelle',
        onclick: () => { store.editing = null; store.programme = []; render(store.editorBox, stationEditor(refresh)); },
      }) : null,
    ),
  );

  syncKind();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      name: name.value, tagline: tagline.value, genre: genre.value, description: description.value,
      kind: kind.value, stream_url: streamUrl.value, cover, published: published.checked,
    };
    try {
      const data = isNew
        ? await api.post('/api/studio/stations', payload)
        : await api.patch(`/api/studio/stations/${station.id}`, payload);
      store.editing = data.station;
      if (data.station.kind === 'mixtape' && !store.programme.length && !isNew) {
        store.programme = (await api.get(`/api/studio/stations/${data.station.id}`)).tracks;
      }
      toast(isNew ? 'Station créée.' : 'Station enregistrée.');
      await refresh();
      render(store.editorBox, stationEditor(refresh));
    } catch (err) { toast(err.message, 'error'); }
  });

  const wrap = h('div', {}, form);
  if (store.editing?.kind === 'mixtape') wrap.append(programmeEditor(store.editing, refresh));
  return wrap;
}

function programmeEditor(station, refresh) {
  const list = h('div', { class: 'programme' });
  const count = h('h2', { style: { margin: '8px 0 4px', fontSize: '18px', letterSpacing: '-.03em' } });

  // `ids` comes from dragReorder; the other callers pass the order they just built.
  const save = async (ids) => {
    const trackIds = ids ?? [...list.querySelectorAll('[data-id]')].map((el) => Number(el.dataset.id));
    const data = await api.put(`/api/studio/stations/${station.id}/tracks`, { track_ids: trackIds });
    store.programme = data.tracks;
    paint();
    await refresh();
  };

  const paint = () => {
    const n = store.programme.length;
    count.textContent = `${n} titre${n > 1 ? 's' : ''}`;
    clear(list);
    if (!n) {
      list.append(h('div', { class: 'empty', style: { padding: '26px 0' }, text: 'Programme vide.' }));
      return;
    }
    store.programme.forEach((track, i) => {
      list.append(h('div', { class: 'programme__item', draggable: 'true', dataset: { id: track.id } },
        h('span', { class: 'grip' }, icon('drag', 12)),
        h('span', { class: 'num', text: String(i + 1).padStart(2, '0') }),
        h('div', { style: { minWidth: 0 } },
          h('div', { style: { fontSize: '14px' }, text: track.title }),
          h('div', { class: 'pick__sub', text: track.artist || '—' }),
        ),
        h('span', { class: 'num', text: track.duration ? fmtTime(track.duration) : '' }),
        h('button', {
          class: 'btn btn--ghost btn--sm', type: 'button', 'aria-label': 'Retirer du programme',
          onclick: async () => {
            store.programme = store.programme.filter((t) => t.id !== track.id);
            await save(store.programme.map((t) => t.id));
          },
        }, icon('close', 11)),
      ));
    });
  };

  dragReorder(list, save);
  paint();

  return h('div', { class: 'editor__box', style: { marginTop: '18px' } },
    h('span', { class: 'label', text: 'Programme' }),
    count,
    h('p', { class: 'pick__sub', style: { margin: '0 0 8px' }, text: 'glissez pour réordonner' }),
    list,
    h('button', {
      class: 'btn', type: 'button', style: { marginTop: '16px' },
      onclick: () => pickTracksDialog(station, save),
    }, icon('plus', 12), 'Ajouter des titres'),
  );
}

function pickTracksDialog(station, save) {
  modal('Ajouter au programme', (close) => {
    const search = h('input', { class: 'input', placeholder: 'filtrer la bibliothèque…' });
    const list = h('div', { style: { maxHeight: '46vh', overflowY: 'auto', marginTop: '14px' } });
    const chosen = new Set();

    const paint = (query = '') => {
      clear(list);
      const inProgramme = new Set(store.programme.map((t) => t.id));
      const rows = store.tracks.filter((t) => !inProgramme.has(t.id) && (
        !query || `${t.title} ${t.artist} ${t.album}`.toLowerCase().includes(query)
      ));

      if (!rows.length) {
        list.append(h('div', { class: 'empty', style: { padding: '26px 0' }, text: 'Rien à ajouter. Importez des fichiers dans l’onglet Titres.' }));
        return;
      }

      rows.forEach((track) => {
        const check = h('input', { type: 'checkbox', checked: chosen.has(track.id) });
        check.addEventListener('change', () => (check.checked ? chosen.add(track.id) : chosen.delete(track.id)));
        list.append(h('label', { class: 'pick' },
          check,
          h('div', { style: { minWidth: 0 } },
            h('div', { text: track.title }),
            h('div', { class: 'pick__sub', text: [track.artist, track.album].filter(Boolean).join(' · ') || '—' }),
          ),
          h('span', { class: 'num', text: track.duration ? fmtTime(track.duration) : '' }),
        ));
      });
    };

    search.addEventListener('input', () => paint(search.value.trim().toLowerCase()));
    paint();

    const actions = h('div', { class: 'modal__actions' },
      h('button', { class: 'btn btn--ghost', type: 'button', text: 'Annuler', onclick: close }),
      h('button', {
        class: 'btn btn--solid', type: 'button', text: 'Ajouter',
        onclick: async () => {
          const added = store.tracks.filter((t) => chosen.has(t.id));
          if (!added.length) return close();
          store.programme = [...store.programme, ...added];
          close();
          await save(store.programme.map((t) => t.id));
          toast(`${added.length} titre(s) ajouté(s).`);
        },
      }),
    );

    return frag(search, list, actions);
  });
}

/* ------------------------------------------------------------------ tracks */

async function panelTracks(box) {
  const listBox = h('div');
  const bar = h('div', { class: 'progress', hidden: true }, h('i'));

  const load = async (query = '') => {
    const { tracks } = await api.get(`/api/studio/tracks${qs({ q: query })}`);
    store.tracks = tracks;
    render(listBox, trackTable(load));
  };

  const send = async (files) => {
    const audio = [...files].filter((f) => f.type.startsWith('audio/') || /\.(mp3|ogg|oga|opus|wav|flac|m4a|aac|webm)$/i.test(f.name));
    if (!audio.length) return toast('Aucun fichier audio dans la sélection.', 'error');

    const form = new FormData();
    audio.slice(0, 20).forEach((file) => form.append('files', file));

    bar.hidden = false;
    try {
      const data = await api.upload('/api/studio/uploads', form, (ratio) => {
        bar.firstChild.style.width = `${Math.round(ratio * 100)}%`;
      });
      toast(`${data.tracks.length} titre(s) importé(s).`);
      await load();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      bar.hidden = true;
      bar.firstChild.style.width = '0';
    }
  };

  const fileInput = h('input', { type: 'file', accept: 'audio/*', multiple: true, hidden: true });
  fileInput.addEventListener('change', () => { send(fileInput.files); fileInput.value = ''; });

  const drop = h('div', { class: 'drop', role: 'button', tabindex: '0', onclick: () => fileInput.click() },
    icon('upload', 22),
    h('strong', { text: 'Déposez vos fichiers audio ici' }),
    h('small', { text: 'mp3 · flac · wav · ogg · opus · m4a — 20 fichiers par envoi, 120 Mo par fichier' }),
  );

  drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('is-over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('is-over');
    send(e.dataTransfer.files);
  });

  const search = h('input', { type: 'search', placeholder: 'chercher dans la bibliothèque…', 'aria-label': 'Recherche' });
  let timer = null;
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => load(search.value.trim()), 220);
  });

  render(box, h('section', { class: 'panel' },
    h('div', { class: 'panel__head' },
      h('div', {},
        h('span', { class: 'label', text: 'Bibliothèque' }),
        h('h1', { text: 'Titres' }),
      ),
    ),
    drop, fileInput, bar,
    h('div', { class: 'filters', style: { marginTop: '30px' } }, h('div', { class: 'search' }, icon('search', 13), search)),
    listBox,
  ));

  await load();
}

function trackTable(reload) {
  if (!store.tracks.length) {
    return h('div', { class: 'empty', text: 'Bibliothèque vide. Déposez vos premiers fichiers ci-dessus.' });
  }

  const head = h('tr', {}, ...['Titre', 'Artiste', 'Album', 'Durée', 'Poids', 'Stations', ''].map((l) => h('th', { text: l })));

  const body = h('tbody', {}, ...store.tracks.map((track) => h('tr', {},
    h('td', {},
      h('button', {
        class: 'btn btn--ghost btn--sm', type: 'button', 'aria-label': `Écouter ${track.title}`,
        style: { marginRight: '8px' }, onclick: () => player.playTracks([track], 0),
      }, icon('play', 10)),
      track.title,
    ),
    h('td', { text: track.artist || '—' }),
    h('td', { text: track.album || '—' }),
    h('td', { class: 'num', text: track.duration ? fmtTime(track.duration) : '—' }),
    h('td', { class: 'num', text: fmtSize(track.size) }),
    h('td', { class: 'num', text: String(track.station_count ?? 0) }),
    h('td', { class: 'actions' },
      h('button', { class: 'btn btn--ghost btn--sm', type: 'button', title: 'Modifier', onclick: () => editTrackDialog(track, reload) }, icon('edit', 11)),
      h('button', {
        class: 'btn btn--ghost btn--sm btn--danger', type: 'button', title: 'Supprimer',
        onclick: async () => {
          if (!(await confirmDialog('Supprimer le titre', `« ${track.title} » sera effacé du serveur.`))) return;
          await api.del(`/api/studio/tracks/${track.id}`);
          toast('Titre supprimé.');
          await reload();
        },
      }, icon('trash', 11)),
    ),
  )));

  return h('div', { class: 'tbl__scroll' }, h('table', { class: 'tbl' }, h('thead', {}, head), body));
}

function editTrackDialog(track, reload) {
  modal('Modifier le titre', (close) => {
    const title = h('input', { class: 'input', value: track.title, maxlength: '200' });
    const artist = h('input', { class: 'input', value: track.artist, maxlength: '200' });
    const album = h('input', { class: 'input', value: track.album, maxlength: '200' });
    const year = h('input', { class: 'input', value: track.year, maxlength: '10' });

    const form = h('form', {},
      h('label', { class: 'field' }, h('span', { class: 'label', text: 'Titre' }), title),
      h('label', { class: 'field' }, h('span', { class: 'label', text: 'Artiste' }), artist),
      h('label', { class: 'field' }, h('span', { class: 'label', text: 'Album' }), album),
      h('label', { class: 'field' }, h('span', { class: 'label', text: 'Année' }), year),
      h('p', { class: 'pick__sub', text: `Fichier : ${track.file} · ${fmtSize(track.size)} · importé le ${fmtDateTime(track.created_at)}` }),
      h('div', { class: 'modal__actions' },
        h('button', { class: 'btn btn--ghost', type: 'button', text: 'Annuler', onclick: close }),
        h('button', { class: 'btn btn--solid', type: 'submit', text: 'Enregistrer' }),
      ),
    );

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api.patch(`/api/studio/tracks/${track.id}`, {
          title: title.value, artist: artist.value, album: album.value, year: year.value,
        });
        close();
        toast('Titre mis à jour.');
        await reload();
      } catch (err) { toast(err.message, 'error'); }
    });

    return form;
  });
}

/* ------------------------------------------------------------------- users */

async function panelUsers(box) {
  const listBox = h('div');

  const load = async () => {
    const { users } = await api.get('/api/studio/users');

    const head = h('tr', {}, ...['Pseudo', 'E-mail', 'Rôle', 'Notes', 'Playlists', 'Inscription', ''].map((l) => h('th', { text: l })));

    const body = h('tbody', {}, ...users.map((u) => {
      const select = h('select', { class: 'select' },
        h('option', { value: 'listener', text: 'auditeur', selected: u.role === 'listener' }),
        h('option', { value: 'admin', text: 'studio', selected: u.role === 'admin' }),
      );
      select.addEventListener('change', async () => {
        try {
          await api.patch(`/api/studio/users/${u.id}`, { role: select.value });
          toast('Rôle mis à jour.');
        } catch (err) { toast(err.message, 'error'); await load(); }
      });

      return h('tr', {},
        h('td', { text: u.username }),
        h('td', { class: 'num', text: u.email }),
        h('td', {}, u.id === store.user.id ? h('span', { class: 'tag tag--on', text: 'vous' }) : select),
        h('td', { class: 'num', text: String(u.ratings) }),
        h('td', { class: 'num', text: String(u.playlists) }),
        h('td', { class: 'num', text: fmtDate(u.created_at) }),
        h('td', { class: 'actions' },
          u.id === store.user.id ? null : h('button', {
            class: 'btn btn--ghost btn--sm btn--danger', type: 'button', title: 'Supprimer le compte',
            onclick: async () => {
              if (!(await confirmDialog('Supprimer le compte', `Le compte « ${u.username} », ses notes et ses playlists seront effacés.`))) return;
              await api.del(`/api/studio/users/${u.id}`);
              toast('Compte supprimé.');
              await load();
            },
          }, icon('trash', 11)),
        ),
      );
    }));

    render(listBox, h('div', { class: 'tbl__scroll' }, h('table', { class: 'tbl' }, h('thead', {}, head), body)));
  };

  render(box, h('section', { class: 'panel' },
    h('div', { class: 'panel__head' },
      h('div', {},
        h('span', { class: 'label', text: 'Comptes' }),
        h('h1', { text: 'Auditeurs' }),
      ),
    ),
    listBox,
  ));

  await load();
}

/* -------------------------------------------------------------------- gate */

function gate(message) {
  const identifier = h('input', { class: 'input', autocomplete: 'username', required: true });
  const password = h('input', { class: 'input', type: 'password', autocomplete: 'current-password', required: true });
  const notice = h('div', { class: 'notice', hidden: true });

  const form = h('form', {},
    h('label', { class: 'field' }, h('span', { class: 'label', text: 'E-mail ou pseudo' }), identifier),
    h('label', { class: 'field' }, h('span', { class: 'label', text: 'Mot de passe' }), password),
    h('button', { class: 'btn btn--solid', type: 'submit', style: { width: '100%', justifyContent: 'center' }, text: 'Entrer' }),
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    notice.hidden = true;
    try {
      const { user } = await api.post('/api/auth/login', { identifier: identifier.value, password: password.value });
      if (user.role !== 'admin') {
        notice.textContent = 'Ce compte n’a pas accès au studio.';
        notice.hidden = false;
        return;
      }
      store.user = user;
      paintNav();
      await paintTab();
    } catch (err) {
      notice.textContent = err.message;
      notice.hidden = false;
    }
  });

  render(root(), h('div', { class: 'wrap' },
    h('div', { class: 'gate' },
      h('span', { class: 'label', text: 'Accès réservé' }),
      h('h1', { text: 'Studio' }),
      h('p', { text: message }),
      notice,
      form,
      h('p', { class: 'auth__alt' }, h('a', { href: '/', text: '← retour au site' })),
    ),
  ));
}

/* -------------------------------------------------------------------- boot */

const initialTab = location.hash.slice(1);
if (TABS.some(([id]) => id === initialTab)) store.tab = initialTab;

api.get('/api/auth/me')
  .then(async ({ user }) => {
    store.user = user;
    paintNav();

    if (!user) return gate('Connectez-vous avec le compte propriétaire pour piloter la grille.');
    if (user.role !== 'admin') return gate('Ce compte n’a pas accès au studio. Connectez-vous avec le compte propriétaire.');
    await paintTab();
  })
  .catch(() => gate('Serveur injoignable.'));
