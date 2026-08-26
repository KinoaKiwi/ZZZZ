import {
  h, frag, render, clear, icon, fmtTime, fmtDate, fmtDateTime, toast, modal, confirmDialog, dragReorder,
} from './dom.js';
import { api, qs } from './api.js';
import { player } from './player.js';

const state = {
  user: null,
  filters: { q: '', tag: '', sort: 'recent' },
};

const main = () => document.getElementById('main');

/* --------------------------------------------------------------- routing */

const ROUTES = [
  [/^\/$/, () => viewCatalogue()],
  [/^\/piece\/([A-Za-z0-9_-]+)$/, (slug) => viewEpisode(slug)],
  [/^\/series$/, () => viewSeriesIndex()],
  [/^\/serie\/([A-Za-z0-9_-]+)$/, (slug) => viewSeries(slug)],
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
    h('div', { class: 'page__head' }, h('h1', { text: 'Page introuvable' })),
    h('p', { class: 'muted', text: 'Cette adresse ne mène nulle part.' }),
    h('p', {}, link('/', 'Retour au catalogue', 'btn')),
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

  render(document.getElementById('nav'),
    h('a', { href: '/', class: 'brand', 'data-link': '' }, 'Onde', h('em', { text: 'pièces sonores' })),
    h('nav', { class: 'nav' },
      h('a', { href: '/', class: isOn('/'), 'data-link': '', text: 'Catalogue' }),
      h('a', { href: '/series', class: isOn('/serie'), 'data-link': '', text: 'Séries' }),
      h('a', { href: '/playlists', class: isOn('/playlist'), 'data-link': '', text: 'Playlists' }),
      state.user
        ? h('a', { href: '/compte', class: isOn('/compte'), 'data-link': '', text: state.user.username })
        : h('a', { href: '/connexion', class: isOn('/connexion'), 'data-link': '', text: 'Se connecter' }),
      state.user?.role === 'admin' ? h('a', { href: '/studio', text: 'Studio', class: 'accent' }) : null,
    ),
    h('button', {
      class: 'icon-btn', type: 'button', 'aria-label': 'Changer de thème', onclick: toggleTheme,
    }, icon('theme', 13)),
  );
}

function toggleTheme() {
  const root = document.documentElement;
  const current = root.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const next = current === 'dark' ? 'light' : 'dark';
  root.dataset.theme = next;
  try { localStorage.setItem('onde.theme', next); } catch { /* ignore */ }
}

/* ------------------------------------------------------------- catalogue */

async function viewCatalogue() {
  const [{ episodes }, { tags }, started] = await Promise.all([
    api.get(`/api/episodes${qs(state.filters)}`),
    api.get('/api/tags'),
    state.user ? api.get('/api/continue') : Promise.resolve({ episodes: [] }),
  ]);

  const list = h('div', { class: 'index' });
  const search = h('input', {
    type: 'search', value: state.filters.q, placeholder: 'chercher un titre, un auteur, un thème…', 'aria-label': 'Recherche',
  });

  const reload = async () => {
    const data = await api.get(`/api/episodes${qs(state.filters)}`);
    paintIndex(list, data.episodes);
    paintChips();
  };

  let timer = null;
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => { state.filters.q = search.value.trim(); reload(); }, 220);
  });

  const chipRow = h('div', { class: 'chips' });
  const paintChips = () => {
    render(chipRow,
      chip('Tout', !state.filters.tag, () => { state.filters.tag = ''; reload(); }),
      tags.slice(0, 14).map(({ tag, n }) => chip(tag, state.filters.tag === tag, () => {
        state.filters.tag = state.filters.tag === tag ? '' : tag;
        reload();
      }, n)),
    );
  };
  paintChips();

  const sort = h('select', { class: 'select', 'aria-label': 'Trier' },
    ...[['recent', 'récentes'], ['oldest', 'plus anciennes'], ['rating', 'mieux notées'],
        ['popular', 'plus écoutées'], ['short', 'les plus courtes'], ['long', 'les plus longues'], ['title', 'a → z']]
      .map(([value, label]) => h('option', { value, text: label, selected: state.filters.sort === value })),
  );
  sort.addEventListener('change', () => { state.filters.sort = sort.value; reload(); });

  const total = episodes.reduce((sum, e) => sum + (e.duration || 0), 0);

  render(main(),
    h('div', { class: 'wrap' },
      h('section', { class: 'hero' },
        h('div', { class: 'hero__meta' },
          h('span', { class: 'label', text: 'Catalogue' }),
          h('span', { class: 'label', text: `${episodes.length} pièce${episodes.length > 1 ? 's' : ''}` }),
          h('span', { class: 'label', text: `${fmtTotal(total)} d’écoute` }),
        ),
        h('h1', { text: 'Écouter' }),
        h('p', { text: 'Documentaires, fictions et pièces sonores. Rien en direct : tout se réécoute quand vous voulez, et reprend là où vous l’avez laissé.' }),
      ),

      started.episodes.length
        ? h('section', { class: 'section', style: { marginTop: '0' } },
            h('h2', { text: 'Reprendre l’écoute' }),
            h('div', { class: 'index' }, ...started.episodes.map((e, i) => episodeRow(e, i + 1, started.episodes))),
          )
        : null,

      h('section', { class: 'filters' },
        h('div', { class: 'search' }, icon('search', 13), search),
        chipRow,
        sort,
      ),
      list,
    ),
  );

  paintIndex(list, episodes);
}

function chip(label, active, onclick, count = null) {
  return h('button', { class: `chip ${active ? 'is-on' : ''}`, type: 'button', onclick },
    label,
    count ? h('i', { text: String(count) }) : null,
  );
}

/** "18 min" reads better than "0.3 h" for a young catalogue. */
function fmtTotal(seconds) {
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  return `${(seconds / 3600).toFixed(1).replace('.', ',')} h`;
}

function paintIndex(container, episodes) {
  clear(container);

  if (!episodes.length) {
    container.append(h('div', { class: 'empty' },
      h('p', { text: 'Rien à écouter ici pour l’instant.' }),
      state.user?.role === 'admin'
        ? h('p', {}, h('a', { href: '/studio#episodes', class: 'btn btn--sm', text: 'Déposer une pièce' }))
        : null,
    ));
    return;
  }

  episodes.forEach((episode, i) => container.append(episodeRow(episode, i + 1, episodes)));
  syncPlayingRows();
}

/** Where this listener stopped, if far enough in to be worth resuming. */
function resumePosition(episode) {
  const saved = state.user ? (episode.progress?.completed ? 0 : episode.progress?.position ?? 0) : 0;
  return saved > 30 && (!episode.duration || saved < episode.duration - 20) ? saved : 0;
}

/** `hideSeries` avoids repeating the series title on every row of that same series. */
function episodeRow(episode, position, queue = null, { hideSeries = false } = {}) {
  const resume = resumePosition(episode);
  const context = queue ?? [episode];

  const meta = hideSeries
    ? episode.authors
    : [episode.series?.title, episode.authors].filter(Boolean).join(' · ');
  const aside = hideSeries
    ? episode.authors || episode.tags[0] || ''
    : episode.series?.title ?? episode.authors ?? episode.tags[0] ?? '';

  return h('div', {
    class: 'row', dataset: { episode: episode.id },
    onclick: () => navigate(`/piece/${episode.slug}`),
  },
    h('span', { class: 'row__num', text: String(position).padStart(2, '0') }),
    h('div', { class: 'row__main' },
      h('div', { class: 'row__name', text: episode.title }),
      h('div', { class: 'row__sub', text: episode.subtitle || meta || '—' }),
      resume
        ? h('div', { class: 'row__resume' },
            h('i', { style: { width: `${Math.min(100, (resume / (episode.duration || 1)) * 100)}%` } }),
            h('span', { text: `reprendre à ${fmtTime(resume)}` }),
          )
        : null,
    ),
    h('span', { class: 'row__genre', text: aside }),
    h('span', { class: 'row__kind tnum', text: episode.duration ? fmtTime(episode.duration) : '' }),
    h('span', { class: 'row__score' },
      episode.rating_avg ? String(episode.rating_avg.toFixed(1)) : h('span', { text: '—' }),
    ),
    h('button', {
      class: 'row__play', type: 'button', 'aria-label': `Écouter ${episode.title}`,
      onclick: (e) => { e.stopPropagation(); player.play(context, context.indexOf(episode)); },
    }, icon('play', 11)),
  );
}

function syncPlayingRows() {
  const id = player.current?.id ?? null;
  document.querySelectorAll('.row[data-episode]').forEach((row) => {
    row.classList.toggle('is-playing', Number(row.dataset.episode) === id && player.playing);
  });
}

/* --------------------------------------------------------------- episode */

async function viewEpisode(slug) {
  const { episode, series, siblings, breakdown } = await api.get(`/api/episodes/${slug}`);
  const queue = [episode, ...(series ? siblings : [])];
  const resume = resumePosition(episode);

  const ratingBox = h('div');
  const paintRating = (summary) => render(ratingBox, ratingWidget(episode, summary, paintRating));
  paintRating({ rating_avg: episode.rating_avg, rating_count: episode.rating_count, my_rating: episode.my_rating });

  const bookmark = h('button', {
    class: `btn ${episode.bookmarked ? 'btn--ghost' : ''}`, type: 'button',
    text: episode.bookmarked ? 'Dans vos écoutes' : 'À écouter',
    onclick: async () => {
      if (!requireAccount()) return;
      const next = !bookmark.classList.contains('btn--ghost');
      try {
        await (next
          ? api.put(`/api/episodes/${episode.id}/bookmark`)
          : api.del(`/api/episodes/${episode.id}/bookmark`));
        bookmark.classList.toggle('btn--ghost', next);
        bookmark.textContent = next ? 'Dans vos écoutes' : 'À écouter';
      } catch (err) { toast(err.message, 'error'); }
    },
  });

  render(main(),
    h('div', { class: 'wrap' },
      h('div', { class: 'station' },
        h('div', {},
          series
            ? h('a', { href: `/serie/${series.slug}`, 'data-link': '', class: 'label', text: `← ${series.title}` })
            : h('a', { href: '/', 'data-link': '', class: 'label', text: '← le catalogue' }),

          h('h1', { text: episode.title }),
          episode.subtitle ? h('p', { class: 'station__tagline', text: episode.subtitle }) : null,

          h('div', { class: 'hero__meta', style: { margin: '0 0 26px' } },
            episode.authors ? h('span', { class: 'label', text: episode.authors }) : null,
            h('span', { class: 'label', text: fmtTime(episode.duration) }),
            episode.published_at ? h('span', { class: 'label', text: fmtDate(episode.published_at) }) : null,
          ),

          h('div', { class: 'station__actions' },
            h('button', {
              class: 'btn btn--solid', type: 'button', onclick: () => player.play(queue, 0),
            }, icon('play', 12), resume ? `Reprendre à ${fmtTime(resume)}` : 'Écouter'),
            resume
              ? h('button', {
                  class: 'btn btn--ghost', type: 'button', text: 'Depuis le début',
                  onclick: () => {
                    episode.progress = { position: 0, completed: false };
                    player.play(queue, 0);
                  },
                })
              : null,
            bookmark,
            h('button', {
              class: 'btn btn--ghost', type: 'button', text: 'Ajouter à une playlist',
              onclick: () => addToPlaylist({ episode_id: episode.id }, episode.title),
            }),
          ),

          ratingBox,

          episode.description
            ? h('div', { class: 'prose' }, ...episode.description.split(/\n{2,}/).map((p) => h('p', { text: p })))
            : null,

          episode.tags.length
            ? h('div', { class: 'chips', style: { marginTop: '26px' } },
                ...episode.tags.map((tag) => h('a', {
                  class: 'chip', href: '/', 'data-link': '', text: tag,
                  onclick: () => { state.filters.tag = tag; state.filters.q = ''; },
                })),
              )
            : null,

          episode.credits
            ? h('div', { class: 'credits' },
                h('span', { class: 'label', text: 'Générique' }),
                ...episode.credits.split(/\n+/).map((line) => h('p', { text: line })),
              )
            : null,

          commentsSection(episode),

          siblings.length
            ? frag(
                h('h2', { class: 'label', style: { marginTop: '48px' }, text: series ? 'Dans la même série' : 'À écouter aussi' }),
                h('div', { class: 'index' }, ...siblings.map((e, i) => episodeRow(e, i + 1, siblings, { hideSeries: Boolean(series) }))),
              )
            : null,
        ),

        h('aside', {},
          episode.cover_url
            ? h('img', { class: 'cover', src: episode.cover_url, alt: `Illustration de ${episode.title}` })
            : h('div', { class: 'cover cover--none', text: 'pièce sonore' }),

          h('dl', { class: 'deflist' },
            series ? def('Série', series.title) : def('Format', 'Pièce isolée'),
            def('Durée', fmtTime(episode.duration)),
            episode.published_at ? def('Publié le', fmtDate(episode.published_at)) : null,
            def('Écoutes', String(episode.play_count)),
            def('Note', episode.rating_avg ? `${episode.rating_avg.toFixed(1)} / 5` : '—'),
          ),

          breakdown.length ? ratingBars(breakdown, episode.rating_count) : null,
        ),
      ),
    ),
  );

  syncPlayingRows();
}

const def = (term, value) => h('div', {}, h('dt', { text: term }), h('dd', { text: value }));

/* ------------------------------------------------------------- réactions */

const REPORT_REASONS = [
  ['spam', 'Spam ou publicité'],
  ['haine', 'Propos haineux'],
  ['harcelement', 'Harcèlement'],
  ['hors-sujet', 'Hors sujet'],
  ['droits', 'Problème de droits'],
  ['autre', 'Autre'],
];

function reportDialog(targetType, targetId, label) {
  if (!requireAccount()) return;

  modal('Signaler', (close) => {
    const reason = h('select', { class: 'select' },
      ...REPORT_REASONS.map(([value, text]) => h('option', { value, text })),
    );
    const detail = h('textarea', { class: 'textarea', maxlength: '600', placeholder: 'précisez si besoin' });

    const form = h('form', {},
      h('p', { class: 'muted', style: { marginTop: '0' }, text: `À propos de : ${label}` }),
      h('label', { class: 'field' }, h('span', { class: 'label', text: 'Motif' }), reason),
      h('label', { class: 'field' }, h('span', { class: 'label', text: 'Détail' }), detail),
      h('p', { class: 'label', text: 'le signalement part au studio, qui tranche' }),
      h('div', { class: 'modal__actions' },
        h('button', { class: 'btn btn--ghost', type: 'button', text: 'Annuler', onclick: close }),
        h('button', { class: 'btn btn--solid', type: 'submit', text: 'Envoyer' }),
      ),
    );

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api.post('/api/reports', {
          target_type: targetType, target_id: targetId, reason: reason.value, detail: detail.value,
        });
        close();
        toast('Signalement envoyé.');
      } catch (err) { toast(err.message, 'error'); }
    });

    return form;
  });
}

function commentRow(comment, reload) {
  const tools = h('div', { class: 'comment__tools' });

  if (comment.can_delete) {
    tools.append(h('button', {
      type: 'button', text: 'Supprimer',
      onclick: async () => {
        if (!(await confirmDialog('Supprimer le message', 'Ce message sera définitivement effacé.'))) return;
        await api.del(`/api/comments/${comment.id}`);
        await reload();
      },
    }));
  }
  if (state.user && !comment.is_mine) {
    tools.append(h('button', {
      type: 'button', text: 'Signaler',
      onclick: () => reportDialog('comment', comment.id, `message de ${comment.author.username}`),
    }));
  }

  return h('article', { class: `comment ${comment.status === 'hidden' ? 'comment--hidden' : ''}` },
    h('div', { class: 'comment__head' },
      h('span', { class: 'comment__who', text: comment.author.username }),
      h('span', { class: 'label', text: fmtDateTime(comment.created_at) }),
      comment.status === 'hidden' ? h('span', { class: 'flag', text: 'masqué par la modération' }) : null,
    ),
    h('p', { class: 'comment__body', text: comment.body }),
    tools.childElementCount ? tools : null,
  );
}

function commentsSection(episode) {
  const heading = h('h2', { class: 'label', text: 'Réactions' });
  const list = h('div');
  const box = h('section', { class: 'comments' }, heading, list);

  const reload = async () => {
    const { comments } = await api.get(`/api/episodes/${episode.slug}/comments`);
    heading.textContent = comments.length
      ? `Réactions — ${comments.length}`
      : 'Réactions';
    clear(list);
    if (!comments.length) {
      list.append(h('div', { class: 'empty', style: { padding: '26px 0' }, text: 'Personne n’a encore réagi.' }));
    } else {
      comments.forEach((comment) => list.append(commentRow(comment, reload)));
    }
  };

  if (!state.user) {
    box.append(h('p', { class: 'muted', style: { marginTop: '18px' } },
      'Connectez-vous pour laisser une réaction. ', link('/connexion', 'Se connecter', 'accent')));
  } else if (state.user.status !== 'active') {
    box.append(h('div', { class: 'notice', style: { marginTop: '18px' },
      text: 'Votre compte est suspendu : vous pouvez écouter, mais plus publier.' }));
  } else {
    const body = h('textarea', { class: 'textarea', maxlength: '1500', placeholder: 'ce que la pièce vous a fait…' });
    const counter = h('span', { class: 'label', text: '0 / 1500' });
    body.addEventListener('input', () => { counter.textContent = `${body.value.length} / 1500`; });

    const form = h('form', { class: 'composer' },
      body,
      h('div', { class: 'composer__foot' }, counter, h('button', { class: 'btn', type: 'submit', text: 'Publier' })),
    );

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (body.value.trim().length < 2) return;
      try {
        await api.post(`/api/episodes/${episode.id}/comments`, { body: body.value });
        body.value = '';
        counter.textContent = '0 / 1500';
        await reload();
      } catch (err) { toast(err.message, 'error'); }
    });

    box.append(form);
  }

  reload().catch(() => {});
  return box;
}



function ratingWidget(episode, summary, repaint) {
  const mine = summary.my_rating;

  const stars = h('div', { class: `stars ${mine ? 'is-set' : ''}` });
  for (let i = 1; i <= 5; i += 1) {
    const btn = h('button', {
      type: 'button', text: '★', 'aria-label': `Noter ${i} sur 5`,
      class: (mine ? mine >= i : Math.round(summary.rating_avg ?? 0) >= i) ? 'on' : '',
      onclick: async () => {
        if (!requireAccount()) return;
        try {
          repaint(mine === i
            ? await api.del(`/api/episodes/${episode.id}/rating`)
            : await api.put(`/api/episodes/${episode.id}/rating`, { score: i }));
        } catch (err) { toast(err.message, 'error'); }
      },
    });
    btn.addEventListener('mouseenter', () => {
      [...stars.children].forEach((el, idx) => el.classList.toggle('hot', idx < i));
    });
    stars.append(btn);
  }
  stars.addEventListener('mouseleave', () => [...stars.children].forEach((el) => el.classList.remove('hot')));

  return h('div', { class: 'rating' },
    stars,
    h('span', { class: 'rating__score' },
      summary.rating_avg
        ? frag(h('b', { text: Number(summary.rating_avg).toFixed(1) }), ` / 5 · ${summary.rating_count} avis`)
        : 'pas encore noté',
    ),
    mine ? h('span', { class: 'label', text: `votre note : ${mine}` }) : null,
  );
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

/* ---------------------------------------------------------------- series */

async function viewSeriesIndex() {
  const { series } = await api.get('/api/series');

  render(main(),
    h('div', { class: 'wrap page' },
      h('div', { class: 'page__head' },
        h('span', { class: 'label', text: 'Collections' }),
        h('h1', { text: 'Séries' }),
        h('p', { class: 'muted', style: { marginTop: '14px', maxWidth: '52ch' },
          text: 'Des pièces qui se suivent : feuilletons, enquêtes en plusieurs volets, carnets.' }),
      ),
      series.length
        ? h('div', { class: 'index' }, ...series.map((s, i) => seriesRow(s, i + 1)))
        : h('div', { class: 'empty', text: 'Aucune série pour l’instant.' }),
    ),
  );
}

function seriesRow(series, position) {
  return h('div', {
    class: 'row', onclick: () => navigate(`/serie/${series.slug}`),
  },
    h('span', { class: 'row__num', text: String(position).padStart(2, '0') }),
    h('div', { class: 'row__main' },
      h('div', { class: 'row__name', text: series.title }),
      h('div', { class: 'row__sub', text: series.tagline || series.authors || '—' }),
    ),
    h('span', { class: 'row__genre', text: series.authors || '' }),
    h('span', { class: 'row__kind', text: `${series.episode_count} épisode${series.episode_count > 1 ? 's' : ''}` }),
    h('span', { class: 'row__score tnum', text: series.total_duration ? fmtTime(series.total_duration) : '' }),
    h('span', {}),
  );
}

async function viewSeries(slug) {
  const { series, episodes } = await api.get(`/api/series/${slug}`);

  const follow = h('button', {
    class: `btn ${series.following ? 'btn--ghost' : ''}`, type: 'button',
    text: series.following ? 'Suivie' : 'Suivre',
    onclick: async () => {
      if (!requireAccount()) return;
      const next = !follow.classList.contains('btn--ghost');
      try {
        await (next ? api.put(`/api/series/${series.id}/follow`) : api.del(`/api/series/${series.id}/follow`));
        follow.classList.toggle('btn--ghost', next);
        follow.textContent = next ? 'Suivie' : 'Suivre';
      } catch (err) { toast(err.message, 'error'); }
    },
  });

  render(main(),
    h('div', { class: 'wrap' },
      h('div', { class: 'station' },
        h('div', {},
          h('a', { href: '/series', 'data-link': '', class: 'label', text: '← les séries' }),
          h('h1', { text: series.title }),
          series.tagline ? h('p', { class: 'station__tagline', text: series.tagline }) : null,

          h('div', { class: 'hero__meta', style: { margin: '0 0 26px' } },
            series.authors ? h('span', { class: 'label', text: series.authors }) : null,
            h('span', { class: 'label', text: `${series.episode_count} épisode${series.episode_count > 1 ? 's' : ''}` }),
            series.total_duration ? h('span', { class: 'label', text: `${fmtTime(series.total_duration)} en tout` }) : null,
          ),

          h('div', { class: 'station__actions' },
            h('button', {
              class: 'btn btn--solid', type: 'button', onclick: () => episodes.length && player.play(episodes, 0),
            }, icon('play', 12), 'Écouter la série'),
            follow,
            h('button', {
              class: 'btn btn--ghost', type: 'button', text: 'Ajouter à une playlist',
              onclick: () => addToPlaylist({ series_id: series.id }, series.title),
            }),
          ),

          series.description
            ? h('div', { class: 'prose' }, ...series.description.split(/\n{2,}/).map((p) => h('p', { text: p })))
            : null,

          h('h2', { class: 'label', style: { marginTop: '44px' }, text: 'Épisodes' }),
          episodes.length
            ? h('div', { class: 'index' }, ...episodes.map((e, i) => episodeRow(e, e.number || i + 1, episodes, { hideSeries: true })))
            : h('div', { class: 'empty', text: 'Aucun épisode publié pour l’instant.' }),
        ),

        h('aside', {},
          series.cover_url
            ? h('img', { class: 'cover', src: series.cover_url, alt: `Illustration de ${series.title}` })
            : h('div', { class: 'cover cover--none', text: 'série' }),
          h('dl', { class: 'deflist' },
            def('Épisodes', String(series.episode_count)),
            def('Durée totale', series.total_duration ? fmtTime(series.total_duration) : '—'),
            def('Abonnés', String(series.follower_count)),
          ),
        ),
      ),
    ),
  );

  syncPlayingRows();
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
                class: 'btn btn--solid', type: 'button', style: { marginBottom: '18px' }, onclick: newPlaylistDialog,
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
  const bits = [
    `${pl.item_count} pièce${pl.item_count > 1 ? 's' : ''}`,
    pl.total_duration ? fmtTime(pl.total_duration) : null,
    pl.owner,
    pl.is_public ? 'publique' : 'privée',
  ].filter(Boolean);

  return h('div', { class: 'list-row' },
    h('div', { class: 'list-row__main' },
      h('a', { class: 'list-row__title', href: `/playlist/${pl.id}`, 'data-link': '', text: pl.name }),
      h('div', { class: 'list-row__sub', text: bits.join(' · ') }),
    ),
    link(`/playlist/${pl.id}`, 'Ouvrir', 'btn btn--ghost btn--sm'),
  );
}

function newPlaylistDialog() {
  modal('Nouvelle playlist', (close) => {
    const name = h('input', { class: 'input', required: true, maxlength: '80' });
    const description = h('textarea', { class: 'textarea', maxlength: '400' });
    const isPublic = h('input', { type: 'checkbox' });

    const form = h('form', {},
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
  const list = h('div', { class: 'index' });

  const paintItems = (rows) => {
    clear(list);
    if (!rows.length) {
      list.append(h('div', { class: 'empty', text: 'Playlist vide. Ajoutez des pièces depuis le catalogue.' }));
      return;
    }

    const queue = rows.map((r) => r.episode);
    rows.forEach((item, i) => {
      const row = episodeRow(item.episode, i + 1, queue);
      if (playlist.is_mine) {
        row.classList.add('row--editable');
        row.setAttribute('draggable', 'true');
        row.dataset.id = item.item_id;
        row.append(h('button', {
          class: 'row__play', type: 'button', 'aria-label': 'Retirer de la playlist',
          onclick: async (e) => {
            e.stopPropagation();
            const data = await api.del(`/api/playlists/${id}/items/${item.item_id}`);
            paintItems(data.items);
          },
        }, icon('close', 11)));
      }
      list.append(row);
    });

    if (playlist.is_mine) {
      dragReorder(list, async (order) => {
        try { await api.put(`/api/playlists/${id}/order`, { item_ids: order }); }
        catch (err) { toast(err.message, 'error'); }
      });
    }
    syncPlayingRows();
  };

  render(main(),
    h('div', { class: 'wrap page' },
      h('div', { class: 'page__head' },
        h('a', { href: '/playlists', 'data-link': '', class: 'label', text: '← playlists' }),
        h('h1', { text: playlist.name }),
        h('p', { class: 'muted', style: { marginTop: '12px' },
          text: [`${playlist.item_count} pièce${playlist.item_count > 1 ? 's' : ''}`,
                 playlist.total_duration ? fmtTime(playlist.total_duration) : null,
                 `par ${playlist.owner}`,
                 playlist.is_public ? 'publique' : 'privée'].filter(Boolean).join(' · ') }),
        playlist.description ? h('p', { class: 'muted', style: { maxWidth: '60ch' }, text: playlist.description }) : null,
      ),

      h('div', { class: 'station__actions' },
        h('button', {
          class: 'btn btn--solid', type: 'button',
          onclick: () => items.length && player.play(items.map((i) => i.episode), 0),
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
          : h('button', {
              class: 'btn btn--ghost', type: 'button', text: 'Signaler',
              onclick: () => reportDialog('playlist', playlist.id, playlist.name),
            }),
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

/** `payload` is either { episode_id } or { series_id } — a whole series can be added at once. */
async function addToPlaylist(payload, label) {
  if (!requireAccount()) return;
  const { playlists } = await api.get('/api/playlists');

  modal(`Ajouter « ${label} »`, (close) => {
    const box = h('div');

    const add = async (playlistId) => {
      try {
        const { added } = await api.post(`/api/playlists/${playlistId}/items`, payload);
        close();
        toast(added > 1 ? `${added} pièces ajoutées.` : 'Ajouté à la playlist.');
      } catch (err) { toast(err.message, 'error'); }
    };

    box.append(
      playlists.length
        ? frag(...playlists.map((pl) => h('button', {
            class: 'pick-row', type: 'button', onclick: () => add(pl.id),
          },
            h('div', { class: 'list-row__main' },
              h('div', { class: 'list-row__title', text: pl.name }),
              h('div', { class: 'list-row__sub', text: `${pl.item_count} pièce${pl.item_count > 1 ? 's' : ''}` }),
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

/* ---------------------------------------------------------------- compte */

async function viewAccount() {
  if (!state.user) return navigate('/connexion', { replace: true });

  const [bookmarks, follows, playlists, history, started] = await Promise.all([
    api.get('/api/bookmarks'),
    api.get('/api/follows'),
    api.get('/api/playlists'),
    api.get('/api/history'),
    api.get('/api/continue'),
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
        h('p', { class: 'muted mono', style: { marginTop: '12px' },
          text: `${state.user.email} · inscrit le ${fmtDate(state.user.created_at)}` }),
      ),

      state.user.status !== 'active'
        ? h('div', { class: 'notice',
            text: state.user.status === 'suspended'
              ? 'Compte suspendu : l’écoute reste ouverte, mais vous ne pouvez plus publier de réaction, de note ni de playlist publique.'
              : 'Compte fermé.' })
        : null,

      h('div', { class: 'station__actions' },
        state.user.role === 'admin' ? h('a', { class: 'btn btn--solid', href: '/studio', text: 'Ouvrir le studio' }) : null,
        h('button', {
          class: 'btn btn--ghost', type: 'button', text: 'Se déconnecter',
          onclick: async () => {
            await api.post('/api/auth/logout');
            state.user = null;
            player.setUser(null);
            navigate('/');
          },
        }),
      ),

      h('div', { class: 'cards cards--3', style: { marginTop: '10px' } },
        h('div', {}, h('span', { class: 'label', text: 'À écouter' }), h('b', { text: String(bookmarks.episodes.length) })),
        h('div', {}, h('span', { class: 'label', text: 'Séries suivies' }), h('b', { text: String(follows.series.length) })),
        h('div', {}, h('span', { class: 'label', text: 'Playlists' }), h('b', { text: String(playlists.playlists.length) })),
      ),

      started.episodes.length
        ? h('section', { class: 'section' },
            h('h2', { text: 'En cours' }),
            h('div', { class: 'index' }, ...started.episodes.map((e, i) => episodeRow(e, i + 1, started.episodes))),
          )
        : null,

      h('section', { class: 'section' },
        h('h2', { text: 'À écouter' }),
        bookmarks.episodes.length
          ? h('div', { class: 'index' }, ...bookmarks.episodes.map((e, i) => episodeRow(e, i + 1, bookmarks.episodes)))
          : h('div', { class: 'empty', text: 'Rien de mis de côté.' }),
      ),

      h('section', { class: 'section' },
        h('h2', { text: 'Séries suivies' }),
        follows.series.length
          ? h('div', { class: 'index' }, ...follows.series.map((s, i) => seriesRow(s, i + 1)))
          : h('div', { class: 'empty', text: 'Aucune série suivie.' }),
      ),

      h('section', { class: 'section' },
        h('h2', { text: 'Dernières écoutes' }),
        history.history.length
          ? h('div', { class: 'tracks' }, ...history.history.map((row) => h('div', {
              class: 'track', style: { gridTemplateColumns: '1fr auto' },
            },
            h('div', {},
              h('a', { class: 'track__title', href: `/piece/${row.slug}`, 'data-link': '', text: row.title }),
              h('div', { class: 'track__artist', text: row.series_title || '' }),
            ),
            h('span', { class: 'track__time', text: fmtDateTime(row.played_at) }),
          )))
          : h('div', { class: 'empty', text: 'Rien encore écouté.' }),
      ),

      h('section', { class: 'section' }, h('h2', { text: 'Profil' }), bioForm),
      h('section', { class: 'section' }, h('h2', { text: 'Sécurité' }), pwForm),
    ),
  );

  syncPlayingRows();
}

/* ------------------------------------------------------------------ auth */

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
    h('button', {
      class: 'btn btn--solid', type: 'submit', style: { width: '100%', justifyContent: 'center' },
      text: isLogin ? 'Entrer' : 'Créer le compte',
    }),
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    notice.hidden = true;
    try {
      const { user } = isLogin
        ? await api.post('/api/auth/login', { identifier: identifier.value, password: password.value })
        : await api.post('/api/auth/register', { email: email.value, username: username.value, password: password.value });

      state.user = user;
      player.setUser(user);
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
        h('p', { class: 'auth__alt muted',
          text: 'Un compte sert à reprendre vos écoutes d’un appareil à l’autre, noter les pièces et monter des playlists. Rien de plus.' }),
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
  .then(({ user }) => { state.user = user; player.setUser(user); })
  .catch(() => {})
  .finally(() => { paintNav(); route(); });
