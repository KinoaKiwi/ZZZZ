/* Tiny DOM helpers — no framework, no innerHTML for user data. */

export function h(tag, props = null, ...children) {
  const el = document.createElement(tag);

  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key === 'style') Object.assign(el.style, value);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else if (key in el && key !== 'list' && typeof value !== 'object') el[key] = value;
    else el.setAttribute(key, value === true ? '' : value);
  }

  append(el, children);
  return el;
}

function append(parent, children) {
  for (const child of children.flat(4)) {
    if (child === null || child === undefined || child === false) continue;
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function frag(...children) {
  const f = document.createDocumentFragment();
  append(f, children);
  return f;
}

export function clear(el) {
  while (el.firstChild) el.firstChild.remove();
  return el;
}

export function render(el, ...children) {
  clear(el);
  append(el, children);
  return el;
}

const SVG = 'http://www.w3.org/2000/svg';

const SHAPES = {
  play:    { d: 'M5 3.5 13.5 8 5 12.5Z', fill: true },
  pause:   { d: 'M5 3.5h2v9H5zM9 3.5h2v9H9z', fill: true },
  prev:    { d: 'M4.5 3.5h1.4v9H4.5zM12.5 3.5 6.6 8l5.9 4.5Z', fill: true },
  next:    { d: 'M10.1 3.5h1.4v9h-1.4zM3.5 3.5 9.4 8l-5.9 4.5Z', fill: true },
  list:    { d: 'M2.5 4h11M2.5 8h11M2.5 12h7' },
  close:   { d: 'M3.5 3.5l9 9M12.5 3.5l-9 9' },
  plus:    { d: 'M8 3v10M3 8h10' },
  check:   { d: 'M3 8.5 6.5 12 13 4.5' },
  trash:   { d: 'M3.5 4.5h9M6.5 4.5V3h3v1.5M4.8 4.5l.6 8h5.2l.6-8' },
  up:      { d: 'M8 12.5V3.5M4 7.5 8 3.5l4 4' },
  down:    { d: 'M8 3.5v9M4 8.5l4 4 4-4' },
  upload:  { d: 'M8 11V2.5M4.5 6 8 2.5 11.5 6M2.5 11v2.5h11V11' },
  edit:    { d: 'M11 2.8 13.2 5 5.4 12.8l-2.9.7.7-2.9Z' },
  theme:   { parts: [
    { d: 'M8 8m-6 0a6 6 0 1 0 12 0a6 6 0 1 0-12 0' },
    { d: 'M8 2A6 6 0 0 1 8 14Z', fill: true },
  ] },
  drag:    { d: 'M6 4h.01M10 4h.01M6 8h.01M10 8h.01M6 12h.01M10 12h.01', cap: 'round', width: 2 },
  search:  { d: 'M7.2 11.4a4.2 4.2 0 1 0 0-8.4 4.2 4.2 0 0 0 0 8.4ZM10.4 10.4 13.5 13.5' },
  // Skip buttons: an open loop with an arrow head, and the seconds set inside it.
  back15:  { parts: [
    { d: 'M12.6 8A4.6 4.6 0 1 1 8 3.4H10.2' },
    { d: 'M8.9 1.5 6.9 3.4l2 1.9' },
    { text: '15' },
  ] },
  fwd15:   { parts: [
    { d: 'M3.4 8A4.6 4.6 0 1 0 8 3.4H5.8' },
    { d: 'M7.1 1.5 9.1 3.4l-2 1.9' },
    { text: '15' },
  ] },
};

export function icon(name, size = 16) {
  const shape = SHAPES[name] ?? SHAPES.play;
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');

  for (const part of shape.parts ?? [shape]) {
    if (part.text !== undefined) {
      const label = document.createElementNS(SVG, 'text');
      label.setAttribute('x', '8');
      label.setAttribute('y', '10.6');
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('font-size', part.size ?? '6.4');
      label.setAttribute('font-family', 'ui-monospace, monospace');
      label.setAttribute('fill', 'currentColor');
      label.textContent = part.text;
      svg.append(label);
      continue;
    }
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', part.d);
    if (part.fill) {
      path.setAttribute('fill', 'currentColor');
    } else {
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', 'currentColor');
      path.setAttribute('stroke-width', part.width ?? 1.4);
      path.setAttribute('stroke-linecap', part.cap ?? 'square');
      path.setAttribute('stroke-linejoin', 'miter');
    }
    svg.append(path);
  }
  return svg;
}

/* ------------------------------------------------------------- formatting */

export function fmtTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--';
  const s = Math.floor(seconds % 60);
  const m = Math.floor(seconds / 60) % 60;
  const hrs = Math.floor(seconds / 3600);
  const pad = (n) => String(n).padStart(2, '0');
  return hrs ? `${hrs}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function fmtSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} o`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} Ko`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} Mo`;
  return `${(n / 1024 ** 3).toFixed(2)} Go`;
}

export const pad2 = (n) => String(n).padStart(2, '0');

/* ------------------------------------------------------------------- chrome */

let toastTimer = null;

export function toast(message, kind = '') {
  document.querySelector('.toast')?.remove();
  clearTimeout(toastTimer);

  const node = h('div', { class: `toast ${kind ? `toast--${kind}` : ''}`, role: 'status', text: message });
  document.body.append(node);
  toastTimer = setTimeout(() => node.remove(), 3200);
}

/** Opens a modal; `build(close)` returns its contents. `onClose` fires however it closes. */
export function modal(title, build, onClose = null) {
  const backdrop = h('div', { class: 'backdrop' });
  let closed = false;

  const close = () => {
    if (closed) return;
    closed = true;
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
    onClose?.();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };

  const box = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' }, h('h2', { text: title }));
  box.append(build(close));

  backdrop.append(box);
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(); });
  document.addEventListener('keydown', onKey);
  document.body.append(backdrop);

  box.querySelector('input, textarea, select, button')?.focus();
  return close;
}

export function confirmDialog(title, message, confirmLabel = 'Supprimer') {
  return new Promise((resolve) => {
    let answer = false;
    modal(
      title,
      (close) => frag(
        h('p', { class: 'muted', text: message, style: { margin: '0' } }),
        h('div', { class: 'modal__actions' },
          h('button', { class: 'btn btn--ghost', type: 'button', text: 'Annuler', onclick: close }),
          h('button', {
            class: 'btn btn--solid', type: 'button', text: confirmLabel,
            onclick: () => { answer = true; close(); },
          }),
        ),
      ),
      () => resolve(answer),
    );
  });
}

/** Makes direct children of `container` reorderable by drag; calls back with the new id order. */
export function dragReorder(container, onReorder) {
  let dragged = null;

  container.addEventListener('dragstart', (e) => {
    const item = e.target.closest('[draggable="true"]');
    if (!item) return;
    dragged = item;
    item.style.opacity = '.4';
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', item.dataset.id ?? '');
  });

  container.addEventListener('dragend', () => {
    if (dragged) dragged.style.opacity = '';
    dragged = null;
    onReorder([...container.querySelectorAll('[draggable="true"]')].map((el) => Number(el.dataset.id)));
  });

  container.addEventListener('dragover', (e) => {
    if (!dragged) return;
    e.preventDefault();
    const target = e.target.closest('[draggable="true"]');
    if (!target || target === dragged) return;
    const box = target.getBoundingClientRect();
    const after = e.clientY > box.top + box.height / 2;
    target.parentNode.insertBefore(dragged, after ? target.nextSibling : target);
  });
}
