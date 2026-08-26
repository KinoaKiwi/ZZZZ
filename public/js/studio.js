import {
  h, frag, render, clear, icon, fmtTime, fmtDate, fmtDateTime, fmtSize, toast, modal, confirmDialog, dragReorder,
} from './dom.js';
import { api, qs } from './api.js';
import { player } from './player.js';
import { timeBars, rankBars, statTile } from './chart.js';

const store = {
  user: null,
  tab: 'antenne',
  episodes: [],
  series: [],
  editingEpisode: null,
  editingSeries: null,
  filters: { q: '', state: '' },
  modView: 'reports',
};

const root = () => document.getElementById('studio');

const TABS = [
  ['antenne', 'Antenne', panelDashboard],
  ['pieces', 'Pièces', panelEpisodes],
  ['series', 'Séries', panelSeries],
  ['moderation', 'Modération', panelModeration],
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

const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

const ROLE_LABELS = { admin: 'studio', listener: 'auditeur' };
const STATUS_LABELS = { active: 'actif', suspended: 'suspendu', banned: 'fermé' };
const TARGET_LABELS = { comment: 'réaction', playlist: 'playlist', user: 'compte' };

function dayLabels(series) {
  return series.map(({ day, n }) => {
    const [year, month, date] = day.split('-');
    return {
      label: `${Number(date)} ${MONTHS[Number(month) - 1]}`,
      full: `${Number(date)} ${MONTHS[Number(month) - 1]} ${year}`,
      value: n,
    };
  });
}

const hours = (seconds) => (seconds < 3600
  ? `${Math.round(seconds / 60)} min`
  : `${(seconds / 3600).toFixed(1).replace('.', ',')} h`);

async function panelDashboard(box) {
  const stats = await api.get('/api/studio/stats');
  const { totals, completion, plays_daily: plays, signups_daily: signups, ratings_spread: spread, top, tags, recent_users: recent } = stats;

  const noPlays = tags.every((t) => t.plays === 0);
  const attention = totals.drafts + totals.reports_open + totals.never_played + totals.suspended;

  render(box, h('section', { class: 'panel' },
    h('div', { class: 'panel__head' },
      h('div', {},
        h('span', { class: 'label', text: 'Vue d’ensemble' }),
        h('h1', { text: 'Antenne' }),
      ),
      h('a', { class: 'btn btn--solid', href: '#pieces', text: 'Déposer une pièce' }),
    ),

    h('div', { class: 'tiles' },
      statTile('Écoutes (30 jours)', String(totals.plays_30d), { hint: `${totals.plays} depuis le début` }),
      statTile('Auditeurs connectés (30 j)', String(totals.listeners_30d), { hint: `${totals.users} comptes au total` }),
      statTile('Temps écouté', hours(totals.listened), { hint: `catalogue de ${hours(totals.duration)}` }),
      statTile('Pièces terminées', `${completion.rate} %`, {
        share: completion.rate,
        hint: `${completion.finished} sur ${completion.started} commencées`,
      }),
    ),

    h('div', { class: 'section' },
      h('div', { class: 'charts-2' },
        timeBars({ caption: 'Écoutes par jour', data: dayLabels(plays), unit: 'écoutes', empty: 'Aucune écoute sur les 30 derniers jours.' }),
        timeBars({ caption: 'Nouveaux comptes', data: dayLabels(signups), unit: 'comptes', empty: 'Aucune inscription sur les 30 derniers jours.' }),
      ),
    ),

    attention
      ? h('div', { class: 'section' },
          h('h2', { text: 'À traiter' }),
          h('div', { class: 'tiles' },
            statTile('Brouillons', String(totals.drafts), { hint: totals.drafts ? 'en attente de publication' : 'rien en attente' }),
            statTile('Signalements ouverts', String(totals.reports_open), { hint: totals.reports_open ? 'à arbitrer' : 'file vide' }),
            statTile('Jamais écoutées', String(totals.never_played), { hint: 'pièces en ligne sans une seule écoute' }),
            statTile('Comptes restreints', String(totals.suspended), { hint: 'suspendus ou fermés' }),
          ),
        )
      : null,

    h('div', { class: 'section' },
      h('h2', { text: 'Le catalogue en chiffres' }),
      h('div', { class: 'tiles' },
        statTile('Pièces en ligne', `${totals.published} / ${totals.episodes}`),
        statTile('Séries', String(totals.series)),
        statTile('Note moyenne', totals.avg_rating ? `${Number(totals.avg_rating).toFixed(1)} / 5` : '—', { hint: `${totals.ratings} notes` }),
        statTile('Réactions', String(totals.comments), { hint: totals.comments_hidden ? `${totals.comments_hidden} masquée(s)` : 'aucune masquée' }),
        statTile('Playlists publiques', String(totals.public_playlists), { hint: `${totals.playlists} au total` }),
        statTile('Espace audio', fmtSize(totals.storage)),
      ),
    ),

    h('div', { class: 'section' },
      h('div', { class: 'charts-2' },
        rankBars({
          caption: noPlays ? 'Thèmes — nombre de pièces' : 'Thèmes les plus écoutés',
          rows: tags.map((t) => ({ label: t.tag, value: noPlays ? t.episodes : t.plays })),
          empty: 'Aucun thème renseigné.',
        }),
        rankBars({
          caption: 'Répartition des notes',
          rows: [5, 4, 3, 2, 1].map((score) => ({
            label: `${score} étoile${score > 1 ? 's' : ''}`,
            value: spread.find((r) => r.score === score)?.n ?? 0,
          })),
          empty: 'Aucune note déposée.',
        }),
      ),
    ),

    h('div', { class: 'section' },
      h('h2', { text: 'Les plus écoutées' }),
      top.length
        ? table(['Pièce', 'Écoutes', 'Terminée', 'Note'], top.map((row) => [
            h('a', { href: `/piece/${row.slug}`, text: row.title }),
            h('span', { class: 'num', text: String(row.plays) }),
            h('span', { class: 'num', text: row.started ? `${Math.round((row.finished / row.started) * 100)} %` : '—' }),
            h('span', { class: 'num', text: row.rating_avg ? Number(row.rating_avg).toFixed(1) : '—' }),
          ]))
        : h('div', { class: 'empty', text: 'Aucune pièce publiée pour l’instant.' }),
    ),

    h('div', { class: 'section' },
      h('h2', { text: 'Derniers inscrits' }),
      recent.length
        ? table(['Pseudo', 'Rôle', 'État', 'Inscription'], recent.map((u) => [
            u.username,
            h('span', { class: `tag ${u.role === 'admin' ? 'tag--on' : ''}`, text: ROLE_LABELS[u.role] ?? u.role }),
            h('span', { class: `tag ${u.status === 'active' ? 'tag--off' : 'tag--on'}`, text: STATUS_LABELS[u.status] ?? u.status }),
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

/* ------------------------------------------------------------- modération */

const REASON_LABELS = {
  spam: 'Spam', haine: 'Haine', harcelement: 'Harcèlement',
  'hors-sujet': 'Hors sujet', droits: 'Droits', autre: 'Autre',
};

const REPORT_STATUS = { open: 'ouvert', resolved: 'classé', dismissed: 'écarté' };

const ACTION_LABELS = {
  'comment.hide': 'réaction masquée',
  'comment.show': 'réaction réaffichée',
  'comment.delete': 'réaction supprimée',
  'report.resolved': 'signalement classé',
  'report.dismissed': 'signalement écarté',
  'report.open': 'signalement rouvert',
  'playlist.hide': 'playlist retirée du public',
  'playlist.show': 'playlist remise en public',
  'user.suspended': 'compte suspendu',
  'user.banned': 'compte fermé',
  'user.active': 'compte réactivé',
  'user.delete': 'compte supprimé',
  'user.role.admin': 'accès studio accordé',
  'user.role.listener': 'accès studio retiré',
};

const MOD_VIEWS = [
  ['reports', 'Signalements', (d) => d.reports.filter((r) => r.status === 'open').length],
  ['comments', 'Réactions', (d) => d.comments.filter((c) => c.status === 'hidden' || c.reports).length],
  ['playlists', 'Playlists publiques', (d) => d.playlists.filter((p) => p.reports).length],
  ['comptes', 'Comptes', (d) => d.flagged.length],
  ['journal', 'Journal', () => 0],
];

async function panelModeration(box) {
  let data = await api.get('/api/studio/moderation');

  const seg = h('div', { class: 'seg' });
  const view = h('div');

  const reload = async () => {
    data = await api.get('/api/studio/moderation');
    paint();
  };

  const act = async (run, message) => {
    try {
      await run();
      toast(message);
      await reload();
    } catch (err) { toast(err.message, 'error'); }
  };

  const paint = () => {
    render(seg, ...MOD_VIEWS.map(([id, label, badge]) => {
      const n = badge(data);
      return h('button', {
        class: store.modView === id ? 'is-on' : '', type: 'button',
        onclick: () => { store.modView = id; paint(); },
      }, label, n ? h('i', { text: String(n) }) : null);
    }));

    const painters = {
      reports: () => modReports(data, act),
      comments: () => modComments(data.comments, act),
      playlists: () => modPlaylists(data.playlists, act),
      comptes: () => modAccounts(data.flagged, act),
      journal: () => modLog(),
    };
    render(view, painters[store.modView]?.() ?? painters.reports());
  };

  const open = data.reports.filter((r) => r.status === 'open').length;

  render(box, h('section', { class: 'panel' },
    h('div', { class: 'panel__head' },
      h('div', {},
        h('span', { class: 'label', text: open ? `${open} signalement(s) en attente` : 'file vide' }),
        h('h1', { text: 'Modération' }),
      ),
    ),
    seg,
    view,
  ));

  paint();
}

function modReports(data, act) {
  const open = data.reports.filter((r) => r.status === 'open');
  const closed = data.reports.filter((r) => r.status !== 'open').slice(0, 20);

  if (!data.reports.length) {
    return h('div', { class: 'empty', text: 'Aucun signalement. Les auditeurs peuvent en déposer depuis une réaction ou une playlist publique.' });
  }

  const card = (report) => {
    const { target } = report;
    const actions = h('div', { class: 'case__actions' });

    if (!target.gone && report.target_type === 'comment') {
      actions.append(
        h('button', {
          class: 'btn btn--ghost btn--sm', type: 'button',
          text: target.status === 'hidden' ? 'Réafficher' : 'Masquer',
          onclick: () => act(
            () => api.patch(`/api/studio/comments/${report.target_id}`, {
              status: target.status === 'hidden' ? 'visible' : 'hidden',
            }),
            target.status === 'hidden' ? 'Réaction réaffichée.' : 'Réaction masquée.',
          ),
        }),
        h('button', {
          class: 'btn btn--ghost btn--sm btn--danger', type: 'button', text: 'Supprimer',
          onclick: async () => {
            if (!(await confirmDialog('Supprimer la réaction', 'Le message sera effacé et le signalement classé.'))) return;
            act(() => api.del(`/api/studio/comments/${report.target_id}`), 'Réaction supprimée.');
          },
        }),
      );
    }

    if (!target.gone && report.target_type === 'playlist') {
      actions.append(h('button', {
        class: 'btn btn--ghost btn--sm', type: 'button',
        text: target.status === 'hidden' ? 'Remettre en public' : 'Retirer du public',
        onclick: () => act(
          () => api.patch(`/api/studio/playlists/${report.target_id}`, { moderated: target.status !== 'hidden' }),
          target.status === 'hidden' ? 'Playlist remise en public.' : 'Playlist retirée du public.',
        ),
      }));
    }

    if (!target.gone && report.target_type === 'user') {
      actions.append(
        h('button', {
          class: 'btn btn--ghost btn--sm', type: 'button',
          text: target.status === 'active' ? 'Suspendre' : 'Réactiver',
          onclick: () => act(
            () => api.patch(`/api/studio/users/${report.target_id}`, { status: target.status === 'active' ? 'suspended' : 'active' }),
            target.status === 'active' ? 'Compte suspendu.' : 'Compte réactivé.',
          ),
        }),
      );
    }

    if (target.link) actions.append(h('a', { class: 'btn btn--ghost btn--sm', href: target.link, text: 'Voir en ligne' }));

    if (report.status === 'open') {
      actions.append(
        h('button', {
          class: 'btn btn--sm', type: 'button', text: 'Classer',
          onclick: () => act(() => api.patch(`/api/studio/reports/${report.id}`, { status: 'resolved' }), 'Signalement classé.'),
        }),
        h('button', {
          class: 'btn btn--ghost btn--sm', type: 'button', text: 'Écarter',
          onclick: () => act(() => api.patch(`/api/studio/reports/${report.id}`, { status: 'dismissed' }), 'Signalement écarté.'),
        }),
      );
    } else {
      actions.append(h('button', {
        class: 'btn btn--ghost btn--sm', type: 'button', text: 'Rouvrir',
        onclick: () => act(() => api.patch(`/api/studio/reports/${report.id}`, { status: 'open' }), 'Signalement rouvert.'),
      }));
    }

    return h('article', { class: `case ${report.status === 'open' ? 'case--open' : ''}` },
      h('div', { class: 'case__head' },
        h('span', { class: 'tag tag--on', text: REASON_LABELS[report.reason] ?? report.reason }),
        h('span', { class: `tag ${report.status === 'open' ? '' : 'tag--off'}`, text: REPORT_STATUS[report.status] }),
        h('span', { class: 'label', text: TARGET_LABELS[report.target_type] ?? report.target_type }),
        h('span', { class: 'label', text: `signalé par ${report.reporter ?? 'compte supprimé'} · ${fmtDateTime(report.created_at)}` }),
      ),
      h('p', { class: `case__quote ${target.gone ? 'case__quote--muted' : ''}`, text: target.label }),
      target.meta ? h('div', { class: 'pick__sub', text: target.meta }) : null,
      report.detail ? h('p', { class: 'case__note', text: `motif détaillé : ${report.detail}` }) : null,
      actions,
    );
  };

  return frag(
    open.length
      ? frag(h('h2', { class: 'label', style: { marginBottom: '4px' }, text: 'En attente' }), ...open.map(card))
      : h('div', { class: 'empty', text: 'Rien en attente. Tout est arbitré.' }),
    closed.length
      ? frag(
          h('h2', { class: 'label', style: { margin: '40px 0 4px' }, text: 'Déjà traités' }),
          ...closed.map(card),
        )
      : null,
  );
}

function modComments(comments, act) {
  if (!comments.length) return h('div', { class: 'empty', text: 'Aucune réaction publiée pour l’instant.' });

  return frag(
    h('p', { class: 'label', style: { marginBottom: '18px' }, text: `${comments.length} dernière(s) réaction(s)` }),
    ...comments.map((comment) => h('article', { class: `case ${comment.reports ? 'case--open' : ''}` },
      h('div', { class: 'case__head' },
        h('span', { style: { fontWeight: '500' }, text: comment.username }),
        comment.status === 'hidden' ? h('span', { class: 'tag tag--on', text: 'masquée' }) : null,
        comment.reports ? h('span', { class: 'tag tag--on', text: `${comment.reports} signalement(s)` }) : null,
        comment.user_status !== 'active'
          ? h('span', { class: 'tag tag--on', text: STATUS_LABELS[comment.user_status] ?? comment.user_status })
          : null,
        h('span', { class: 'label', text: fmtDateTime(comment.created_at) }),
      ),
      h('p', { class: 'case__quote', text: comment.body }),
      h('div', { class: 'pick__sub', text: `sur « ${comment.episode_title} »` }),
      h('div', { class: 'case__actions' },
        h('button', {
          class: 'btn btn--ghost btn--sm', type: 'button',
          text: comment.status === 'hidden' ? 'Réafficher' : 'Masquer',
          onclick: () => act(
            () => api.patch(`/api/studio/comments/${comment.id}`, { status: comment.status === 'hidden' ? 'visible' : 'hidden' }),
            comment.status === 'hidden' ? 'Réaction réaffichée.' : 'Réaction masquée.',
          ),
        }),
        h('button', {
          class: 'btn btn--ghost btn--sm btn--danger', type: 'button', text: 'Supprimer',
          onclick: async () => {
            if (!(await confirmDialog('Supprimer la réaction', 'Le message sera définitivement effacé.'))) return;
            act(() => api.del(`/api/studio/comments/${comment.id}`), 'Réaction supprimée.');
          },
        }),
        h('a', { class: 'btn btn--ghost btn--sm', href: `/piece/${comment.episode_slug}`, text: 'Voir la pièce' }),
        h('button', {
          class: 'btn btn--ghost btn--sm', type: 'button', text: 'Suspendre l’auteur',
          onclick: async () => {
            if (!(await confirmDialog('Suspendre le compte',
              `${comment.username} pourra encore écouter, mais ne pourra plus publier.`, 'Suspendre'))) return;
            act(() => api.patch(`/api/studio/users/${comment.user_id}`, { status: 'suspended' }), 'Compte suspendu.');
          },
        }),
      ),
    )),
  );
}

function modPlaylists(playlists, act) {
  if (!playlists.length) return h('div', { class: 'empty', text: 'Aucune playlist publique.' });

  const head = h('tr', {}, ...['Playlist', 'Auteur', 'Pièces', 'Signalements', 'État', ''].map((l) => h('th', { text: l })));

  const body = h('tbody', {}, ...playlists.map((pl) => h('tr', {},
    h('td', {},
      h('a', { href: `/playlist/${pl.id}`, style: { fontWeight: '500' }, text: pl.name }),
      pl.description ? h('div', { class: 'pick__sub', text: pl.description }) : null,
    ),
    h('td', { class: 'num', text: pl.owner }),
    h('td', { class: 'num', text: String(pl.item_count) }),
    h('td', { class: 'num', text: pl.reports ? String(pl.reports) : '—' }),
    h('td', {}, h('span', {
      class: `tag ${pl.moderated ? 'tag--on' : 'tag--off'}`, text: pl.moderated ? 'retirée' : 'publique',
    })),
    h('td', { class: 'actions' },
      h('button', {
        class: 'btn btn--ghost btn--sm', type: 'button', text: pl.moderated ? 'Remettre' : 'Retirer',
        onclick: () => act(
          () => api.patch(`/api/studio/playlists/${pl.id}`, { moderated: !pl.moderated }),
          pl.moderated ? 'Playlist remise en public.' : 'Playlist retirée du public.',
        ),
      }),
    ),
  )));

  return h('div', { class: 'tbl__scroll' }, h('table', { class: 'tbl' }, h('thead', {}, head), body));
}

function modAccounts(flagged, act) {
  if (!flagged.length) {
    return h('div', { class: 'empty', text: 'Aucun compte signalé ni restreint. La liste complète est dans l’onglet Auditeurs.' });
  }

  return frag(...flagged.map((user) => {
    const note = h('input', { class: 'input', value: user.moderation_note, maxlength: '500', placeholder: 'note interne' });

    return h('article', { class: `case ${user.reports ? 'case--open' : ''}` },
      h('div', { class: 'case__head' },
        h('span', { style: { fontWeight: '500' }, text: user.username }),
        h('span', { class: `tag ${user.status === 'active' ? 'tag--off' : 'tag--on'}`, text: STATUS_LABELS[user.status] ?? user.status }),
        user.reports ? h('span', { class: 'tag tag--on', text: `${user.reports} signalement(s)` }) : null,
        h('span', { class: 'label', text: `${user.email} · ${user.comments} réaction(s) · inscrit le ${fmtDate(user.created_at)}` }),
      ),
      h('div', { style: { maxWidth: '460px' } }, note),
      h('div', { class: 'case__actions' },
        user.status !== 'suspended'
          ? h('button', {
              class: 'btn btn--ghost btn--sm', type: 'button', text: 'Suspendre',
              onclick: () => act(() => api.patch(`/api/studio/users/${user.id}`, { status: 'suspended', moderation_note: note.value }), 'Compte suspendu.'),
            })
          : null,
        user.status !== 'banned'
          ? h('button', {
              class: 'btn btn--ghost btn--sm btn--danger', type: 'button', text: 'Fermer le compte',
              onclick: async () => {
                if (!(await confirmDialog('Fermer le compte',
                  `${user.username} ne pourra plus se connecter. Ses écoutes et ses playlists restent en base.`, 'Fermer'))) return;
                act(() => api.patch(`/api/studio/users/${user.id}`, { status: 'banned', moderation_note: note.value }), 'Compte fermé.');
              },
            })
          : null,
        user.status !== 'active'
          ? h('button', {
              class: 'btn btn--sm', type: 'button', text: 'Réactiver',
              onclick: () => act(() => api.patch(`/api/studio/users/${user.id}`, { status: 'active', moderation_note: note.value }), 'Compte réactivé.'),
            })
          : null,
        h('button', {
          class: 'btn btn--ghost btn--sm', type: 'button', text: 'Enregistrer la note',
          onclick: () => act(() => api.patch(`/api/studio/users/${user.id}`, { moderation_note: note.value }), 'Note enregistrée.'),
        }),
      ),
    );
  }));
}

function modLog() {
  const box = h('div', {}, h('div', { class: 'empty', text: 'Chargement…' }));

  api.get('/api/studio/log').then(({ entries }) => render(box,
    entries.length
      ? frag(
          h('p', { class: 'label', style: { marginBottom: '14px' }, text: `${entries.length} dernière(s) décision(s)` }),
          ...entries.map((entry) => h('div', { class: 'logline' },
            h('span', { text: fmtDateTime(entry.created_at) }),
            h('b', { text: entry.admin ?? '—' }),
            h('span', {},
              ACTION_LABELS[entry.action] ?? entry.action,
              entry.detail ? ` — ${entry.detail}` : '',
            ),
          )),
        )
      : h('div', { class: 'empty', text: 'Aucune décision de modération enregistrée.' }),
  )).catch((err) => render(box, h('div', { class: 'notice', text: err.message })));

  return box;
}

/* -------------------------------------------------------------- auditeurs */

async function panelUsers(box) {
  const listBox = h('div');

  const load = async () => {
    const { users } = await api.get('/api/studio/users');
    const head = h('tr', {}, ...['Pseudo', 'E-mail', 'Rôle', 'État', 'Réactions', 'Écoutes', 'Playlists', 'Inscription', '']
      .map((l) => h('th', { text: l })));

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

      const status = h('select', { class: 'select' },
        h('option', { value: 'active', text: 'actif', selected: u.status === 'active' }),
        h('option', { value: 'suspended', text: 'suspendu', selected: u.status === 'suspended' }),
        h('option', { value: 'banned', text: 'fermé', selected: u.status === 'banned' }),
      );
      status.addEventListener('change', async () => {
        try {
          await api.patch(`/api/studio/users/${u.id}`, { status: status.value });
          toast(status.value === 'active' ? 'Compte réactivé.' : 'État du compte mis à jour.');
        } catch (err) { toast(err.message, 'error'); await load(); }
      });

      return h('tr', {},
        h('td', {},
          u.username,
          u.moderation_note ? h('div', { class: 'pick__sub', text: u.moderation_note }) : null,
        ),
        h('td', { class: 'num', text: u.email }),
        h('td', {}, u.id === store.user.id ? h('span', { class: 'tag tag--on', text: 'vous' }) : select),
        h('td', {}, u.id === store.user.id ? h('span', { class: 'tag tag--off', text: 'actif' }) : status),
        h('td', { class: 'num', text: String(u.comments) }),
        h('td', { class: 'num', text: String(u.plays) }),
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
