import { h, render, clear } from './dom.js';

/*
 * Single-series charts only, drawn in plain HTML so they reflow with the page and
 * keep their type at real size. One accent hue carries the data; grid and axes stay
 * recessive; only the peak is labelled directly, the rest is on hover.
 */

let tip = null;

/** Sits under the plot rather than over the bar, so it never covers the caption. */
function tooltip(text, target, anchor) {
  tip ??= h('div', { class: 'chart__tip', role: 'status' });
  if (!tip.isConnected) document.body.append(tip);

  tip.textContent = text;
  const box = target.getBoundingClientRect();
  const under = (anchor ?? target).getBoundingClientRect();
  const own = tip.getBoundingClientRect();

  tip.style.left = `${Math.min(
    Math.max(8, box.left + box.width / 2 - own.width / 2),
    window.innerWidth - own.width - 8,
  )}px`;
  tip.style.top = `${under.bottom + 6 + window.scrollY}px`;
  tip.classList.add('is-on');
}

const hideTip = () => tip?.classList.remove('is-on');

/**
 * Vertical bars over time.
 * `data` is [{ label, value, full }] — `full` is the long form used in the tooltip.
 */
export function timeBars({ caption, data, unit = '', empty = 'Rien à afficher.' }) {
  let anchor = null;
  const max = Math.max(1, ...data.map((d) => d.value));
  const total = data.reduce((sum, d) => sum + d.value, 0);
  const peak = data.reduce((best, d) => (d.value > best.value ? d : best), data[0] ?? { value: 0 });

  const plot = h('div', {
    class: 'chart__plot',
    role: 'img',
    'aria-label': `${caption} : ${total} au total, maximum ${peak.value} le ${peak.full ?? peak.label}.`,
  });

  data.forEach((point) => {
    const bar = h('div', {
      class: `chart__bar ${point.value && point === peak ? 'is-peak' : ''}`,
      tabindex: '0',
      dataset: { value: String(point.value) },
      style: { '--h': `${(point.value / max) * 100}%` },
    }, h('i'));

    const text = `${point.full ?? point.label} — ${point.value} ${unit}`.trim();
    bar.addEventListener('mouseenter', () => tooltip(text, bar, anchor ?? plot));
    bar.addEventListener('focus', () => tooltip(text, bar, anchor ?? plot));
    bar.addEventListener('mouseleave', hideTip);
    bar.addEventListener('blur', hideTip);
    plot.append(bar);
  });

  const ends = [data[0], data[Math.floor(data.length / 2)], data.at(-1)].filter(Boolean);
  const axis = h('div', { class: 'chart__axis' }, ...ends.map((d) => h('span', { text: d.label })));
  anchor = axis;

  return h('figure', { class: 'chart' },
    h('figcaption', {},
      h('span', { class: 'label', text: caption }),
      h('b', { class: 'chart__peak', text: total ? `pic ${peak.value}` : '' }),
    ),
    total ? plot : h('div', { class: 'empty', style: { padding: '30px 0' }, text: empty }),
    total ? axis : null,
    total ? tableView(caption, data.filter((d) => d.value), unit) : null,
  );
}

function tableView(caption, rows, unit) {
  return h('details', { class: 'chart__data' },
    h('summary', { class: 'label', text: 'voir les chiffres' }),
    h('table', { class: 'tbl' },
      h('thead', {}, h('tr', {}, h('th', { text: 'Jour' }), h('th', { text: unit || 'Valeur' }))),
      h('tbody', {}, ...rows.map((d) => h('tr', {},
        h('td', { text: d.full ?? d.label }),
        h('td', { class: 'num', text: String(d.value) }),
      ))),
    ),
  );
}

/** Horizontal ranking bars — magnitude by category, biggest first. */
export function rankBars({ caption, rows, empty = 'Rien à classer.', format = String }) {
  const max = Math.max(1, ...rows.map((r) => r.value));

  return h('figure', { class: 'chart chart--rank' },
    caption ? h('figcaption', {}, h('span', { class: 'label', text: caption })) : null,
    rows.length
      ? h('div', { class: 'rank' }, ...rows.map((row) => h('div', { class: 'rank__row' },
          h('span', { class: 'rank__label', text: row.label, title: row.label }),
          h('i', { class: 'rank__track' }, h('b', { style: { width: `${(row.value / max) * 100}%` } })),
          h('span', { class: 'rank__value tnum', text: format(row.value) }),
        )))
      : h('div', { class: 'empty', style: { padding: '24px 0' }, text: empty }),
  );
}

/** A single headline figure, with an optional bar underneath when it is a share. */
export function statTile(label, value, { hint = null, share = null } = {}) {
  return h('div', { class: 'tile' },
    h('span', { class: 'label', text: label }),
    h('b', { text: value }),
    share !== null ? h('i', { class: 'tile__meter' }, h('b', { style: { width: `${Math.min(100, share)}%` } })) : null,
    hint ? h('span', { class: 'tile__hint', text: hint }) : null,
  );
}

export { render, clear };
