import {
  h, frag, render, clear, icon, fmtTime, fmtDate, fmtDateTime, fmtSize, toast, modal, confirmDialog, dragReorder,
} from './dom.js';
import { api, qs } from './api.js';
import { player } from './player.js';

const store = {
  user: null,
  tab: 'antenne',
  episodes: [],
  series: [],
  editingEpisode: null,
  editingSeries: null,
  filters: { q: '', state: '' },
};

const root = () => document.getElementById('studio');

const TABS = [
  ['antenne', 'Antenne', panelDashboard],
  ['pieces', 'Pièces', panelEpisodes],
  ['series', 'Séries', panelSeries],
  ['auditeurs', 'Auditeurs', panelUsers],
];

/* ---------------------------------------------------------------- chrome */

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

function tabBar() {
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
  render(root(), h('div', { class: 'wrap' }, tabBar(), body));

  try {
    await panel(body);
  } catch (err) {
    render(body, h('div', { class: 'panel' }, h('div', { class: 'notice', text: err.message })));
  }
}

window.addEventListener('hashchange', () => {
  const id = location.hash.slice(1);
  store.tab = TABS.some(([tab]) => tab === id) ? id : 'antenne';
  store.editingEpisode = null;
  store.editingSeries = null;
  paintTab();
});

/* ------------------------------------------------------------- dashboard */

async function panelDashboard(box) {
  const { totals, top, recent_users: recent } = await api.get('/api/studio/stats');
  const card = (label, value) => h('div', {}, h('span', { class: 'label', text: label }), h('b', { text: value }));

  render(box, h('section', { class: 'panel' },
    h('div', { class: 'panel__head' },
      h('div', {},
        h('span', { class: 'label', text: 'Vue d’ensemble' }),
        h('h1', { text: 'Antenne' }),
      ),
      h('a', { class: 'btn btn--solid', href: '#pieces', text: 'Déposer une pièce' }),
    ),

    h('div', { class: 'cards cards--3' },
      card('Pièces en ligne', `${totals.published} / ${totals.episodes}`),
      card('Séries', String(totals.series)),
      card('Durée publiée', `${(totals.duration / 3600).toFixed(1)} h`),
      card('Auditeurs', String(totals.users)),
      card('Écoutes (7 jours)', String(totals.plays_7d)),
      card('Écoutes totales', String(totals.plays)),
      card('Notes déposées', String(totals.ratings)),
      card('Espace audio', fmtSize(totals.storage)),
    ),

    h('div', { class: 'section' },
      h('h2', { text: 'Les plus écoutées' }),
      top.length
        ? table(['Pièce', 'Écoutes', 'Note'], top.map((row) => [
            h('a', { href: `/piece/${row.slug}`, text: row.title }),
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
  const head = h('tr', {}, ...headers.map((label) => h('th', { text: label })));
  const body = h('tbody', {}, ...rows.map((cells) => h('tr', {}, ...cells.map((cell, i) => h('td', {
    class: i === cells.length - 1 && cells.length > 1 ? 'num' : '',
  }, cell)))));
  return h('div', { class: 'tbl__scroll' }, h('table', { class: 'tbl' }, h('thead', {}, head), body));
}

/* ---------------------------------------------------------------- pièces */

async function loadEpisodes() {
  const { episodes } = await api.get(`/api/studio/episodes${qs(store.filters)}`);
  store.episodes = episodes;
  return episodes;
}

async function panelEpisodes(box) {
  const [, { series }] = await Promise.all([loadEpisodes(), api.get('/api/studio/series')]);
  store.series = series;

  if (store.editingEpisode) return renderEpisodeEditor(box);

  const listBox = h('div');
  const bar = h('div', { class: 'progress', hidden: true }, h('i'));

  const refresh = async () => {
    await loadEpisodes();
    render(listBox, episodeTable(box));
  };

  const seriesSelect = h('select', { class: 'select', 'aria-label': 'Ranger dans une série' },
    h('option', { value: '', text: 'pièce isolée' }),
    ...series.map((s) => h('option', { value: String(s.id), text: s.title })),
  );

  const send = async (files) => {
    const audio = [...files].filter((f) => f.type.startsWith('audio/') || /\.(mp3|ogg|oga|opus|wav|flac|m4a|aac|webm)$/i.test(f.name));
    if (!audio.length) return toast('Aucun fichier audio dans la sélection.', 'error');

    const form = new FormData();
    if (seriesSelect.value) form.append('series_id', seriesSelect.value);
    audio.slice(0, 20).forEach((file) => form.append('files', file));

    bar.hidden = false;
    try {
      const data = await api.upload('/api/studio/uploads', form, (ratio) => {
        bar.firstChild.style.width = `${Math.round(ratio * 100)}%`;
      });
      toast(`${data.episodes.length} pièce(s) déposée(s) — à compléter puis publier.`);
      await refresh();
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
    h('small', { text: 'mp3 · flac · wav · ogg · opus · m4a — 20 fichiers par envoi, 400 Mo par fichier' }),
  );
  drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('is-over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('is-over'); send(e.dataTransfer.files); });

  const search = h('input', { type: 'search', value: store.filters.q, placeholder: 'chercher une pièce…', 'aria-label': 'Recherche' });
  let timer = null;
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => { store.filters.q = search.value.trim(); refresh(); }, 220);
  });

  const stateSelect = h('select', { class: 'select', 'aria-label': 'Filtrer' },
    h('option', { value: '', text: 'toutes' }),
    h('option', { value: 'published', text: 'en ligne', selected: store.filters.state === 'published' }),
    h('option', { value: 'draft', text: 'brouillons', selected: store.filters.state === 'draft' }),
  );
  stateSelect.addEventListener('change', () => { store.filters.state = stateSelect.value; refresh(); });

  render(box, h('section', { class: 'panel' },
    h('div', { class: 'panel__head' },
      h('div', {},
        h('span', { class: 'label', text: `${store.episodes.length} pièce(s)` }),
        h('h1', { text: 'Pièces' }),
      ),
      h('label', { class: 'inline-field' }, h('span', { class: 'label', text: 'Déposer dans' }), seriesSelect),
    ),
    drop, fileInput, bar,
    h('div', { class: 'filters', style: { marginTop: '30px' } },
      h('div', { class: 'search' }, icon('search', 13), search),
      h('span', {}),
      stateSelect,
    ),
    listBox,
  ));

  render(listBox, episodeTable(box));
}

function episodeTable(box) {
  if (!store.episodes.length) {
    return h('div', { class: 'empty', text: 'Aucune pièce. Déposez vos premiers fichiers ci-dessus.' });
  }

  const head = h('tr', {}, ...['Pièce', 'Série', 'État', 'Durée', 'Écoutes', 'Note', ''].map((l) => h('th', { text: l })));

  const body = h('tbody', {}, ...store.episodes.map((episode) => h('tr', {},
    h('td', {},
      h('button', {
        class: 'btn btn--ghost btn--sm', type: 'button', 'aria-label': `Écouter ${episode.title}`,
        style: { marginRight: '8px' }, onclick: () => player.play([episode], 0),
      }, icon('play', 10)),
      h('a', {
        href: '#', style: { fontWeight: '500' }, text: episode.title,
        onclick: (e) => { e.preventDefault(); store.editingEpisode = episode.id; renderEpisodeEditor(box); },
      }),
      episode.subtitle ? h('div', { class: 'pick__sub', text: episode.subtitle }) : null,
    ),
    h('td', { class: 'num', text: episode.series?.title ?? '—' }),
    h('td', {}, h('span', {
      class: `tag ${episode.published ? 'tag--on' : 'tag--off'}`, text: episode.published ? 'en ligne' : 'brouillon',
    })),
    h('td', { class: 'num', text: episode.duration ? fmtTime(episode.duration) : '—' }),
    h('td', { class: 'num', text: String(episode.play_count) }),
    h('td', { class: 'num', text: episode.rating_avg ? Number(episode.rating_avg).toFixed(1) : '—' }),
    h('td', { class: 'actions' },
      h('button', {
        class: 'btn btn--ghost btn--sm', type: 'button', title: 'Modifier',
        onclick: () => { store.editingEpisode = episode.id; renderEpisodeEditor(box); },
      }, icon('edit', 11)),
      h('button', {
        class: 'btn btn--ghost btn--sm', type: 'button', text: episode.published ? 'Retirer' : 'Publier',
        onclick: async () => {
          try {
            await api.patch(`/api/studio/episodes/${episode.id}`, { published: !episode.published });
            toast(episode.published ? 'Pièce retirée du catalogue.' : 'Pièce publiée.');
            await loadEpisodes();
            await panelEpisodes(box);
          } catch (err) { toast(err.message, 'error'); }
        },
      }),
      h('button', {
        class: 'btn btn--ghost btn--sm btn--danger', type: 'button', title: 'Supprimer',
        onclick: async () => {
          if (!(await confirmDialog('Supprimer la pièce', `« ${episode.title} » et son fichier audio seront effacés.`))) return;
          await api.del(`/api/studio/episodes/${episode.id}`);
          toast('Pièce supprimée.');
          await loadEpisodes();
          await panelEpisodes(box);
        },
      }, icon('trash', 11)),
    ),
  )));

  return h('div', { class: 'tbl__scroll' }, h('table', { class: 'tbl' }, h('thead', {}, head), body));
}

function renderEpisodeEditor(box) {
  const episode = store.episodes.find((e) => e.id === store.editingEpisode);
  if (!episode) { store.editingEpisode = null; return panelEpisodes(box); }

  const back = async () => { store.editingEpisode = null; await panelEpisodes(box); };

  const title = h('input', { class: 'input', value: episode.title, maxlength: '200', required: true });
  const subtitle = h('input', { class: 'input', value: episode.subtitle, maxlength: '200', placeholder: 'une phrase de présentation' });
  const authors = h('input', { class: 'input', value: episode.authors, maxlength: '200', placeholder: 'qui l’a fait' });
  const tags = h('input', { class: 'input', value: episode.tags.join(', '), maxlength: '200', placeholder: 'documentaire, intime, ville' });
  const description = h('textarea', { class: 'textarea textarea--tall', maxlength: '4000' }, episode.description);
  const credits = h('textarea', { class: 'textarea', maxlength: '2000', placeholder: 'une ligne par mention' }, episode.credits);
  const number = h('input', { class: 'input', type: 'number', min: '0', value: String(episode.number || 0) });
  const published = h('input', { type: 'checkbox', checked: episode.published });

  const seriesSelect = h('select', { class: 'select' },
    h('option', { value: '', text: 'aucune — pièce isolée' }),
    ...store.series.map((s) => h('option', { value: String(s.id), text: s.title, selected: episode.series_id === s.id })),
  );

  let cover = episode.cover ?? null;
  const coverBox = h('div', { class: 'cover-pick' });
  const coverInput = h('input', { type: 'file', accept: 'image/*', hidden: true });

  const paintCover = () => {
    render(coverBox,
      cover
        ? h('img', { class: 'cover', src: `/media/covers/${cover}`, alt: '' })
        : h('div', { class: 'cover cover--none', text: 'sans' }),
      h('div', {},
        h('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: 'Changer', onclick: () => coverInput.click() }),
        cover ? h('button', {
          class: 'btn btn--ghost btn--sm', type: 'button', text: 'Retirer',
          onclick: () => { cover = null; paintCover(); },
        }) : null,
      ),
    );
  };
  coverInput.addEventListener('change', async () => {
    const file = coverInput.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    try {
      const data = await api.upload('/api/studio/covers', form);
      cover = data.cover;
      paintCover();
    } catch (err) { toast(err.message, 'error'); }
  });
  paintCover();

  const form = h('form', { class: 'editor-grid' },
    h('div', {},
      h('label', { class: 'field' }, h('span', { class: 'label', text: 'Titre' }), title),
      h('label', { class: 'field' }, h('span', { class: 'label', text: 'Chapô' }), subtitle),
      h('label', { class: 'field' }, h('span', { class: 'label', text: 'Description' }), description),
      h('label', { class: 'field' }, h('span', { class: 'label', text: 'Générique' }), credits),
    ),
    h('div', {},
      h('label', { class: 'field' }, h('span', { class: 'label', text: 'Auteur·rices' }), authors),
      h('label', { class: 'field' }, h('span', { class: 'label', text: 'Thèmes (séparés par des virgules)' }), tags),
      h('label', { class: 'field' }, h('span', { class: 'label', text: 'Série' }), seriesSelect),
      h('label', { class: 'field' }, h('span', { class: 'label', text: 'Numéro dans la série' }), number),
      h('div', { class: 'field' }, h('span', { class: 'label', text: 'Illustration' }), coverBox, coverInput),
      h('label', { class: 'checkbox', style: { marginBottom: '22px' } }, published, 'En ligne dans le catalogue'),

      h('dl', { class: 'deflist' },
        h('div', {}, h('dt', { text: 'Fichier' }), h('dd', { text: episode.file })),
        h('div', {}, h('dt', { text: 'Durée' }), h('dd', { text: fmtTime(episode.duration) })),
        h('div', {}, h('dt', { text: 'Poids' }), h('dd', { text: fmtSize(episode.size) })),
        h('div', {}, h('dt', { text: 'Adresse' }), h('dd', { text: `/piece/${episode.slug}` })),
        h('div', {}, h('dt', { text: 'Déposé le' }), h('dd', { text: fmtDateTime(episode.created_at) })),
      ),
    ),
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const { episode: saved } = await api.patch(`/api/studio/episodes/${episode.id}`, {
        title: title.value,
        subtitle: subtitle.value,
        authors: authors.value,
        tags: tags.value,
        description: description.value,
        credits: credits.value,
        series_id: seriesSelect.value || null,
        number: number.value,
        cover,
        published: published.checked,
      });
      toast(saved.published ? 'Pièce enregistrée et en ligne.' : 'Brouillon enregistré.');
      await loadEpisodes();
      store.editingEpisode = saved.id;
      renderEpisodeEditor(box);
    } catch (err) { toast(err.message, 'error'); }
  });

  render(box, h('section', { class: 'panel' },
    h('div', { class: 'panel__head' },
      h('div', {},
        h('button', { class: 'label linkish', type: 'button', text: '← toutes les pièces', onclick: back }),
        h('h1', { text: episode.title }),
      ),
      h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
        h('button', { class: 'btn btn--ghost', type: 'button', onclick: () => player.play([episode], 0) }, icon('play', 11), 'Écouter'),
        episode.published ? h('a', { class: 'btn btn--ghost', href: `/piece/${episode.slug}`, text: 'Voir la page' }) : null,
        h('button', { class: 'btn btn--solid', type: 'button', text: 'Enregistrer', onclick: () => form.requestSubmit() }),
      ),
    ),
    form,
  ));
}

/* ---------------------------------------------------------------- séries */

async function panelSeries(box) {
  const { series } = await api.get('/api/studio/series');
  store.series = series;

  if (store.editingSeries !== null) return renderSeriesEditor(box);

  const head = h('tr', {}, ...['Série', 'Épisodes', 'Durée', 'Abonnés', 'État', ''].map((l) => h('th', { text: l })));

  const body = h('tbody', {}, ...series.map((s) => h('tr', {},
    h('td', {},
      h('a', {
        href: '#', style: { fontWeight: '500' }, text: s.title,
        onclick: (e) => { e.preventDefault(); store.editingSeries = s.id; renderSeriesEditor(box); },
      }),
      s.tagline ? h('div', { class: 'pick__sub', text: s.tagline }) : null,
    ),
    h('td', { class: 'num', text: `${s.published_count} / ${s.episode_count}` }),
    h('td', { class: 'num', text: s.total_duration ? fmtTime(s.total_duration) : '—' }),
    h('td', { class: 'num', text: String(s.follower_count) }),
    h('td', {}, h('span', { class: `tag ${s.published ? 'tag--on' : 'tag--off'}`, text: s.published ? 'en ligne' : 'brouillon' })),
    h('td', { class: 'actions' },
      h('button', {
        class: 'btn btn--ghost btn--sm', type: 'button', title: 'Modifier',
        onclick: () => { store.editingSeries = s.id; renderSeriesEditor(box); },
      }, icon('edit', 11)),
      h('button', {
        class: 'btn btn--ghost btn--sm btn--danger', type: 'button', title: 'Supprimer',
        onclick: async () => {
          if (!(await confirmDialog('Supprimer la série',
            `« ${s.title} » sera supprimée. Ses ${s.episode_count} pièce(s) restent en ligne, comme pièces isolées.`))) return;
          await api.del(`/api/studio/series/${s.id}`);
          toast('Série supprimée.');
          await panelSeries(box);
        },
      }, icon('trash', 11)),
    ),
  )));

  render(box, h('section', { class: 'panel' },
    h('div', { class: 'panel__head' },
      h('div', {},
        h('span', { class: 'label', text: `${series.length} série(s)` }),
        h('h1', { text: 'Séries' }),
      ),
      h('button', {
        class: 'btn btn--solid', type: 'button',
        onclick: () => { store.editingSeries = 0; renderSeriesEditor(box); },
      }, icon('plus', 12), 'Nouvelle série'),
    ),
    series.length
      ? h('div', { class: 'tbl__scroll' }, h('table', { class: 'tbl' }, h('thead', {}, head), body))
      : h('div', { class: 'empty', text: 'Aucune série. Une pièce peut très bien vivre seule — les séries servent à regrouper ce qui se suit.' }),
  ));
}

function renderSeriesEditor(box) {
  const isNew = store.editingSeries === 0;
  const series = isNew ? null : store.series.find((s) => s.id === store.editingSeries);
  if (!isNew && !series) { store.editingSeries = null; return panelSeries(box); }

  const back = async () => { store.editingSeries = null; await panelSeries(box); };

  const title = h('input', { class: 'input', value: series?.title ?? '', maxlength: '120', required: true });
  const tagline = h('input', { class: 'input', value: series?.tagline ?? '', maxlength: '160' });
  const authors = h('input', { class: 'input', value: series?.authors ?? '', maxlength: '200' });
  const description = h('textarea', { class: 'textarea textarea--tall', maxlength: '4000' }, series?.description ?? '');
  const published = h('input', { type: 'checkbox', checked: Boolean(series?.published) });

  let cover = series?.cover ?? null;
  const coverBox = h('div', { class: 'cover-pick' });
  const coverInput = h('input', { type: 'file', accept: 'image/*', hidden: true });

  const paintCover = () => {
    render(coverBox,
      cover ? h('img', { class: 'cover', src: `/media/covers/${cover}`, alt: '' }) : h('div', { class: 'cover cover--none', text: 'sans' }),
      h('div', {},
        h('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: 'Changer', onclick: () => coverInput.click() }),
        cover ? h('button', {
          class: 'btn btn--ghost btn--sm', type: 'button', text: 'Retirer',
          onclick: () => { cover = null; paintCover(); },
        }) : null,
      ),
    );
  };
  coverInput.addEventListener('change', async () => {
    const file = coverInput.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    try {
      const data = await api.upload('/api/studio/covers', form);
      cover = data.cover;
      paintCover();
    } catch (err) { toast(err.message, 'error'); }
  });
  paintCover();

  const orderBox = h('div');

  const form = h('form', { class: 'editor-grid' },
    h('div', {},
      h('label', { class: 'field' }, h('span', { class: 'label', text: 'Titre' }), title),
      h('label', { class: 'field' }, h('span', { class: 'label', text: 'Accroche' }), tagline),
      h('label', { class: 'field' }, h('span', { class: 'label', text: 'Description' }), description),
    ),
    h('div', {},
      h('label', { class: 'field' }, h('span', { class: 'label', text: 'Auteur·rices' }), authors),
      h('div', { class: 'field' }, h('span', { class: 'label', text: 'Illustration' }), coverBox, coverInput),
      h('label', { class: 'checkbox', style: { marginBottom: '22px' } }, published, 'Visible dans les séries'),
      orderBox,
    ),
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      title: title.value, tagline: tagline.value, authors: authors.value,
      description: description.value, cover, published: published.checked,
    };
    try {
      const data = isNew
        ? await api.post('/api/studio/series', payload)
        : await api.patch(`/api/studio/series/${series.id}`, payload);
      toast(isNew ? 'Série créée.' : 'Série enregistrée.');
      const { series: all } = await api.get('/api/studio/series');
      store.series = all;
      store.editingSeries = data.series.id;
      renderSeriesEditor(box);
    } catch (err) { toast(err.message, 'error'); }
  });

  render(box, h('section', { class: 'panel' },
    h('div', { class: 'panel__head' },
      h('div', {},
        h('button', { class: 'label linkish', type: 'button', text: '← toutes les séries', onclick: back }),
        h('h1', { text: isNew ? 'Nouvelle série' : series.title }),
      ),
      h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
        !isNew && series.published ? h('a', { class: 'btn btn--ghost', href: `/serie/${series.slug}`, text: 'Voir la page' }) : null,
        h('button', { class: 'btn btn--solid', type: 'button', text: isNew ? 'Créer' : 'Enregistrer', onclick: () => form.requestSubmit() }),
      ),
    ),
    form,
  ));

  if (!isNew) paintSeriesOrder(orderBox, series.id);
}

async function paintSeriesOrder(box, seriesId) {
  const { episodes } = await api.get(`/api/studio/series/${seriesId}`);
  const list = h('div', { class: 'programme' });

  const paint = (rows) => {
    clear(list);
    if (!rows.length) {
      list.append(h('div', { class: 'empty', style: { padding: '22px 0' }, text: 'Aucune pièce dans cette série.' }));
      return;
    }
    rows.forEach((episode, i) => {
      list.append(h('div', { class: 'programme__item', draggable: 'true', dataset: { id: episode.id } },
        h('span', { class: 'grip' }, icon('drag', 12)),
        h('span', { class: 'num', text: String(i + 1).padStart(2, '0') }),
        h('div', { style: { minWidth: 0 } },
          h('div', { style: { fontSize: '14px' }, text: episode.title }),
          h('div', { class: 'pick__sub', text: episode.published ? 'en ligne' : 'brouillon' }),
        ),
        h('span', { class: 'num', text: episode.duration ? fmtTime(episode.duration) : '' }),
      ));
    });
  };

  dragReorder(list, async (order) => {
    try {
      const data = await api.put(`/api/studio/series/${seriesId}/order`, { episode_ids: order });
      paint(data.episodes);
    } catch (err) { toast(err.message, 'error'); }
  });

  paint(episodes);

  render(box,
    h('span', { class: 'label', text: 'Ordre des épisodes' }),
    h('p', { class: 'pick__sub', style: { margin: '6px 0 0' }, text: 'glissez pour réordonner' }),
    list,
  );
}

/* -------------------------------------------------------------- auditeurs */

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
              if (!(await confirmDialog('Supprimer le compte',
                `Le compte « ${u.username} », ses notes et ses playlists seront effacés.`))) return;
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
      h('div', {}, h('span', { class: 'label', text: 'Comptes' }), h('h1', { text: 'Auditeurs' })),
    ),
    listBox,
  ));

  await load();
}

/* ------------------------------------------------------------------ gate */

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
      player.setUser(user);
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

/* ------------------------------------------------------------------ boot */

const initialTab = location.hash.slice(1);
if (TABS.some(([id]) => id === initialTab)) store.tab = initialTab;

api.get('/api/auth/me')
  .then(async ({ user }) => {
    store.user = user;
    player.setUser(user);
    paintNav();

    if (!user) return gate('Connectez-vous avec le compte propriétaire pour publier.');
    if (user.role !== 'admin') return gate('Ce compte n’a pas accès au studio.');
    await paintTab();
  })
  .catch(() => gate('Serveur injoignable.'));
