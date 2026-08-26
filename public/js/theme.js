/* Runs before first paint so the page never flashes the wrong palette. */
try {
  var stored = localStorage.getItem('onde.theme');
  if (stored === 'light' || stored === 'dark') document.documentElement.dataset.theme = stored;
} catch (e) { /* private mode: keep the system palette */ }
