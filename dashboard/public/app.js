const state = {
  client: null,
  clients: [],
  names: {},
  coachEnabled: false,
  view: 'today',
  range: 30,
  foodSearch: '',
  online: true,
};

function qs(sel, root = document) {
  return root.querySelector(sel);
}

// All user-provided text (food names, client names) goes in via textContent,
// never innerHTML.
function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'text') node.textContent = value;
    else node.setAttribute(key, value);
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(child);
  }
  return node;
}

function svg(tag, attrs = {}) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}

function icon(paths, size = 22) {
  const node = svg('svg', {
    width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
    'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true',
  });
  for (const d of paths) node.appendChild(svg('path', { d }));
  return node;
}

const ICONS = {
  bowl: ['M3 11h18a9 9 0 0 1-18 0Z', 'M8 7c0-1.5 1-2 1-3.5', 'M12 7c0-1.5 1-2 1-3.5', 'M16 7c0-1.5 1-2 1-3.5'],
  chart: ['M4 20V10', 'M10 20V4', 'M16 20v-7', 'M22 20H2'],
  search: ['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z', 'm20 20-4-4'],
  people: ['M16 20v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1', 'M9.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z', 'M21 20v-1a4 4 0 0 0-3-3.9', 'M15.5 4.2a3.5 3.5 0 0 1 0 6.6'],
  plug: ['M9 7V3', 'M15 7V3', 'M6 7h12v4a6 6 0 0 1-12 0Z', 'M12 17v4'],
};

// --- Formatting ----------------------------------------------------------

const nf = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

function fmtInt(v) {
  return nf.format(Math.round(Number(v || 0)));
}

function fmtNum(v) {
  const n = Number(v || 0);
  return Number.isInteger(n) ? nf.format(n) : n.toFixed(1);
}

// Dates arrive as YYYY-MM-DD in the bot's timezone; format them as calendar
// dates (UTC) so the browser's own timezone can't shift them by a day.
function parseDay(day) {
  return new Date(`${day}T00:00:00Z`);
}

function fmtDay(day, opts = { month: 'short', day: 'numeric' }) {
  return parseDay(day).toLocaleDateString('en-US', { timeZone: 'UTC', ...opts });
}

function fmtLastLog(value) {
  if (!value) return 'Never';
  const [day, time] = value.split(' ');
  return `${fmtDay(day)}, ${time}`;
}

function clientLabel(id) {
  return state.names[id] || id;
}

function plural(n, word, many = `${word}s`) {
  return `${n} ${n === 1 ? word : many}`;
}

// --- Network, with a visible offline state and automatic retry -------------

class OfflineError extends Error {}

let retryTimer = null;
let retryDelay = 2000;

async function request(url, options) {
  let res;
  try {
    res = await fetch(url, options);
  } catch {
    throw new OfflineError('server unreachable');
  }
  if (res.status === 401) {
    location.href = '/login.html';
    return new Promise(() => {});
  }
  if (res.status >= 500) throw new OfflineError(`server error ${res.status}`);
  return res;
}

async function fetchJson(url) {
  const res = await request(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  const data = await res.json();
  markOnline();
  return data;
}

// Coach-action mutations. JSON content-type is required server-side as the
// CSRF defense, so always send it here.
async function postJson(url, body) {
  const res = await request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

function markOnline() {
  if (state.online) return;
  state.online = true;
  retryDelay = 2000;
  clearTimeout(retryTimer);
  const banner = qs('#banner');
  banner.hidden = true;
  banner.replaceChildren();
}

function markOffline(retry) {
  state.online = false;
  clearTimeout(retryTimer);
  let seconds = Math.round(retryDelay / 1000);
  const banner = qs('#banner');
  const text = el('span', { class: 'banner__text' });
  const setText = () => {
    text.replaceChildren(
      el('strong', { text: 'Can’t reach the dashboard server.' }),
      ` Check that npm run dashboard is still running. Retrying in ${seconds}s.`
    );
  };
  setText();
  const now = el('button', { type: 'button', class: 'btn btn--sm', text: 'Retry now' });
  now.addEventListener('click', () => {
    clearTimeout(retryTimer);
    retry();
  });
  banner.replaceChildren(el('div', { class: 'banner__inner' }, [text, now]));
  banner.hidden = false;

  const tick = () => {
    seconds -= 1;
    if (seconds <= 0) {
      retryDelay = Math.min(retryDelay * 2, 30000);
      retry();
      return;
    }
    setText();
    retryTimer = setTimeout(tick, 1000);
  };
  retryTimer = setTimeout(tick, 1000);
}

// Runs a view renderer, turning failures into an in-view error plus the
// retry banner instead of a blank page.
async function safeRender(root, fn) {
  if (!root.hasChildNodes()) root.replaceChildren(skeleton());
  root.setAttribute('aria-busy', 'true');
  try {
    await fn();
  } catch (err) {
    const offline = err instanceof OfflineError;
    if (offline) markOffline(() => safeRender(root, fn));
    if (!root.querySelector('.card, .empty') || root.querySelector('.skeleton')) {
      root.replaceChildren(
        emptyState({
          icon: ICONS.plug,
          title: offline ? 'Dashboard server not reachable' : 'Couldn’t load this view',
          body: offline
            ? 'Your data is safe. This page reconnects by itself as soon as the server is back.'
            : 'Something went wrong reading the log. Reload the page to try again.',
        })
      );
    }
    if (!offline) console.error(err);
  } finally {
    root.removeAttribute('aria-busy');
  }
}

// --- Shared building blocks ----------------------------------------------

function skeleton() {
  return el('div', { 'aria-hidden': 'true' }, [
    el('div', { class: 'skeleton skeleton--title' }),
    el('div', { class: 'stack' }, [el('div', { class: 'skeleton skeleton--card' }), el('div', { class: 'skeleton skeleton--short' })]),
  ]);
}

function emptyState({ icon: paths, title, body, extra, inline }) {
  return el('div', { class: `empty${inline ? ' empty--inline' : ''}` }, [
    paths ? el('div', { class: 'empty__icon' }, [icon(paths)]) : null,
    el('h2', { class: 'empty__title', text: title }),
    body ? el('p', { class: 'empty__body', text: body }) : null,
    extra || null,
  ]);
}

function card(title, children, aside) {
  return el('section', { class: 'card' }, [
    title ? el('h2', { class: 'card__title' }, [title, aside ? el('span', { class: 'aside', text: aside }) : null]) : null,
    ...children,
  ]);
}

function viewHead(title, sub, right) {
  return el('div', { class: 'view-head' }, [
    el('div', {}, [el('h1', { class: 'view-title', text: title }), sub ? el('p', { class: 'view-sub', text: sub }) : null]),
    right || null,
  ]);
}

// Shown on every client view of a brand-new install: no clients, no entries.
function firstRunState() {
  const steps = el('ol', { class: 'steps' }, [
    el('li', {}, [el('span', {}, ['Start the bot with ', el('code', { text: 'npm start' }), ' and link WhatsApp.'])]),
    el('li', {}, [el('span', {}, ['From an allowed number, text what you ate, like ', el('strong', { text: '2 eggs and toast' }), ', or send a meal photo.'])]),
    el('li', {}, [el('span', { text: 'Come back here. Entries show up as soon as the bot logs them.' })]),
  ]);
  return card(null, [
    emptyState({
      icon: ICONS.bowl,
      title: 'No food logged yet',
      body: 'This dashboard reads the same log the WhatsApp bot writes to. Once you log your first meal, it fills in.',
      extra: steps,
    }),
  ]);
}

function noClient(root) {
  root.replaceChildren(firstRunState());
}

function progressBar(pct, color) {
  return el('div', { class: 'track' }, [el('div', { class: 'fill', style: `width:${Math.max(0, Math.min(pct, 100))}%;background:${color}` })]);
}

// Reveals a fade on wide tables once they overflow, so a horizontally
// scrollable table is discoverable instead of silently clipping columns.
function markScrollableTables(root) {
  for (const wrap of root.querySelectorAll('.table-wrap')) {
    const update = () => {
      const scrollable = wrap.scrollWidth > wrap.clientWidth + 1;
      const atEnd = wrap.scrollLeft + wrap.clientWidth >= wrap.scrollWidth - 1;
      wrap.dataset.scrollable = String(scrollable && !atEnd);
    };
    update();
    wrap.addEventListener('scroll', update, { passive: true });
  }
}

// --- Theme ---------------------------------------------------------------

function currentTheme() {
  return (
    document.documentElement.getAttribute('data-theme') ||
    (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  );
}

function syncThemeButton() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  qs('#theme-toggle').setAttribute('aria-label', `Switch to ${next} mode`);
}

function initTheme() {
  const saved = localStorage.getItem('dashboard-theme');
  if (saved) document.documentElement.setAttribute('data-theme', saved);
  syncThemeButton();
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    syncThemeButton();
    rerenderChart();
  });
}

function toggleTheme() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('dashboard-theme', next);
  syncThemeButton();
}

// --- View: Today -----------------------------------------------------------

function ringChart(eaten, target) {
  const pct = target > 0 ? Math.min(eaten / target, 1) : 0;
  const size = 168;
  const stroke = 14;
  const r = (size - stroke) / 2;
  const c = size / 2;
  const circumference = 2 * Math.PI * r;
  const over = target > 0 && eaten > target;
  const ring = svg('svg', { viewBox: `0 0 ${size} ${size}`, 'aria-hidden': 'true' });
  ring.append(
    svg('circle', { cx: c, cy: c, r, fill: 'none', stroke: 'var(--surface-sunken)', 'stroke-width': stroke }),
    svg('circle', {
      cx: c, cy: c, r, fill: 'none',
      stroke: over ? 'var(--bad-text)' : 'var(--accent)',
      'stroke-width': stroke,
      'stroke-linecap': pct > 0 ? 'round' : 'butt',
      'stroke-dasharray': `${circumference} ${circumference}`,
      'stroke-dashoffset': `${circumference * (1 - pct)}`,
      transform: `rotate(-90 ${c} ${c})`,
    })
  );
  return el('div', { class: 'ring', role: 'img', 'aria-label': `${fmtInt(eaten)} of ${fmtInt(target)} kcal eaten` }, [
    ring,
    el('div', { class: 'ring__center', 'aria-hidden': 'true' }, [
      el('div', { class: 'ring__big', text: fmtInt(eaten) }),
      el('div', { class: 'ring__sub', text: `of ${fmtInt(target)} kcal` }),
    ]),
  ]);
}

function macroBar(label, eaten, target, color) {
  const pct = target > 0 ? (eaten / target) * 100 : 0;
  return el('div', { class: 'macro-bar' }, [
    el('div', { class: 'macro-bar__labels' }, [
      el('span', { class: 'macro-bar__name', text: label }),
      el('span', { class: 'macro-bar__value' }, [el('b', { text: fmtNum(eaten) }), ` / ${fmtNum(target)} g`]),
    ]),
    progressBar(pct, color),
  ]);
}

function entryRow(item) {
  const meta = [item.time, item.grams ? `${fmtNum(item.grams)} g` : null].filter(Boolean).join(' · ');
  return el('div', { class: `entry${item.photoUrl ? ' entry--photo' : ''}` }, [
    item.photoUrl ? el('img', { class: 'entry__thumb', src: item.photoUrl, alt: `Photo of ${item.name}`, loading: 'lazy' }) : null,
    el('div', { class: 'entry__body' }, [el('div', { class: 'entry__name', text: item.name }), el('div', { class: 'entry__meta', text: meta })]),
    el('div', { class: 'entry__nums' }, [
      el('div', { class: 'entry__kcal', text: `${fmtInt(item.kcal)} kcal` }),
      el('div', { class: 'entry__macros', text: `P ${fmtNum(item.protein_g)} · C ${fmtNum(item.carbs_g)} · F ${fmtNum(item.fat_g)}` }),
    ]),
  ]);
}

async function renderToday() {
  const root = qs('#view-today');
  if (!state.client) return noClient(root);
  const data = await fetchJson(`/api/today?client=${encodeURIComponent(state.client)}`);
  if (!data) return noClient(root);

  const { eaten, targets } = data;
  const left = Math.round(targets.kcal - eaten.kcal);
  const headline = left >= 0
    ? el('p', { class: 'summary__headline', text: `${fmtInt(left)} kcal left today` })
    : el('p', { class: 'summary__headline' }, [el('span', { class: 'over', text: `${fmtInt(-left)} kcal over` }), ' today’s target']);

  const summary = card(null, [
    el('div', { class: 'summary' }, [
      ringChart(eaten.kcal, targets.kcal),
      el('div', { class: 'summary__text' }, [
        headline,
        el('div', { class: 'macro-bars' }, [
          macroBar('Protein', eaten.protein_g, targets.protein_g, 'var(--macro-protein)'),
          macroBar('Carbs', eaten.carbs_g, targets.carbs_g, 'var(--macro-carbs)'),
          macroBar('Fat', eaten.fat_g, targets.fat_g, 'var(--macro-fat)'),
        ]),
      ]),
    ]),
  ]);

  let meals;
  if (data.entries.length === 0) {
    meals = card('Meals', [
      emptyState({
        inline: true,
        title: 'Nothing logged today',
        body: 'Text the bot what you ate, like “200g chicken and rice”, or send a photo of your plate. It shows up here.',
      }),
    ]);
  } else {
    const groups = data.meals.map((group) =>
      el('div', { class: 'meal' }, [
        el('div', { class: 'meal__head' }, [
          el('h3', { class: 'meal__name', text: group.meal.charAt(0).toUpperCase() + group.meal.slice(1) }),
          el('span', { class: 'meal__kcal', text: `${fmtInt(group.totals.kcal)} kcal` }),
        ]),
        ...group.items.map(entryRow),
      ])
    );
    meals = card('Meals', groups, plural(data.entries.length, 'entry', 'entries'));
  }

  const sub = `${fmtDay(data.date, { weekday: 'long', month: 'long', day: 'numeric' })}${state.clients.length > 1 ? ` · ${clientLabel(state.client)}` : ''}`;
  root.replaceChildren(viewHead('Today', sub), el('div', { class: 'stack' }, [summary, meals]));
}

// --- View: Trends ------------------------------------------------------------

let lastChart = null;

// Bars sized to the real container width (re-rendered on resize), so labels
// stay 12px on a phone instead of shrinking with a scaled viewBox.
function dailyKcalChart(container, days, targetKcal) {
  lastChart = { container, days, targetKcal };
  const width = Math.max(container.clientWidth, 260);
  const height = 220;
  const padTop = 10;
  const padBottom = 26;
  const plotH = height - padTop - padBottom;
  const maxVal = Math.max(targetKcal, ...days.map((d) => d.eaten.kcal), 1) * 1.08;
  const y = (v) => padTop + plotH - (v / maxVal) * plotH;
  const chart = svg('svg', { viewBox: `0 0 ${width} ${height}`, height, role: 'img' });
  const logged = days.filter((d) => d.logged);
  const over = logged.filter((d) => d.eaten.kcal > targetKcal * 1.1).length;
  chart.setAttribute('aria-label', `Daily calories over ${days.length} days: ${logged.length} logged, ${over} more than 10% over the ${fmtInt(targetKcal)} kcal target.`);

  chart.appendChild(svg('line', { x1: 0, x2: width, y1: y(0), y2: y(0), stroke: 'var(--border-strong)', 'stroke-width': 1 }));

  const slot = width / days.length;
  const barWidth = Math.max(2, Math.min(22, slot * 0.62));
  days.forEach((d, i) => {
    const cx = (i + 0.5) * slot;
    let bar;
    if (!d.logged) {
      bar = svg('rect', { x: cx - barWidth / 2, y: y(0) - 3, width: barWidth, height: 3, rx: 1, fill: 'var(--border-strong)' });
    } else {
      const top = y(d.eaten.kcal);
      const color = d.eaten.kcal > targetKcal * 1.1 ? 'var(--bad-text)' : 'var(--accent)';
      bar = svg('rect', { x: cx - barWidth / 2, y: top, width: barWidth, height: Math.max(y(0) - top, 1), rx: Math.min(4, barWidth / 2), fill: color });
    }
    const tip = svg('title');
    tip.textContent = `${fmtDay(d.date, { weekday: 'short', month: 'short', day: 'numeric' })}: ${d.logged ? `${fmtInt(d.eaten.kcal)} kcal` : 'not logged'}`;
    bar.appendChild(tip);
    chart.appendChild(bar);
  });

  const ty = y(targetKcal);
  chart.appendChild(svg('line', { x1: 0, x2: width, y1: ty, y2: ty, stroke: 'var(--text-muted)', 'stroke-width': 1, 'stroke-dasharray': '4 4' }));

  const maxLabels = Math.max(2, Math.floor(width / 72));
  const every = Math.ceil(days.length / maxLabels);
  days.forEach((d, i) => {
    if ((days.length - 1 - i) % every !== 0) return;
    const cx = (i + 0.5) * slot;
    const anchor = cx < 24 ? 'start' : cx > width - 24 ? 'end' : 'middle';
    const label = svg('text', { x: cx, y: height - 6, 'text-anchor': anchor });
    label.textContent = fmtDay(d.date);
    chart.appendChild(label);
  });

  container.replaceChildren(chart);
}

function rerenderChart() {
  if (lastChart && lastChart.container.isConnected) dailyKcalChart(lastChart.container, lastChart.days, lastChart.targetKcal);
}

let resizeFrame;
window.addEventListener('resize', () => {
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(rerenderChart);
});

function legend(items) {
  return el('div', { class: 'legend' }, items.map(([color, label]) =>
    el('span', { class: 'legend__item' }, [el('span', { class: 'legend__swatch', style: `background:${color}` }), label])
  ));
}

const HEAT_LEVELS = [
  ['var(--surface-sunken)', 'Not logged'],
  ['color-mix(in srgb, var(--accent) 30%, var(--surface-sunken))', 'Logged'],
  ['color-mix(in srgb, var(--accent) 62%, var(--surface-sunken))', 'Within 15% of kcal target'],
  ['var(--accent)', 'Protein target hit'],
];

// Calendar layout: one column per week, Monday on top.
function heatmapGrid(days, targets) {
  const grid = el('div', { class: 'heatmap', role: 'list', 'aria-label': 'Logging calendar' });
  const offset = (parseDay(days[0].date).getUTCDay() + 6) % 7;
  for (let i = 0; i < offset; i++) grid.appendChild(el('div', { class: 'cell', 'data-level': 'future', 'aria-hidden': 'true' }));
  for (const d of days) {
    let level = 0;
    if (d.logged) {
      if (d.eaten.protein_g >= targets.protein_g) level = 3;
      else if (d.eaten.kcal >= targets.kcal * 0.85 && d.eaten.kcal <= targets.kcal * 1.15) level = 2;
      else level = 1;
    }
    const label = `${fmtDay(d.date, { weekday: 'short', month: 'short', day: 'numeric' })}: ${d.logged ? `${fmtInt(d.eaten.kcal)} kcal, ${fmtNum(d.eaten.protein_g)} g protein` : 'not logged'}`;
    grid.appendChild(el('div', { class: 'cell', role: 'listitem', 'data-level': level, title: label, 'aria-label': label }));
  }
  const dayLabels = el('div', { class: 'heatmap-days', 'aria-hidden': 'true' },
    ['Mon', '', 'Wed', '', 'Fri', '', 'Sun'].map((t) => el('span', { text: t })));
  return el('div', { class: 'heatmap-wrap' }, [dayLabels, grid]);
}

function kpi(label, value, unit, note) {
  return el('div', { class: 'kpi' }, [
    el('div', { class: 'kpi__label', text: label }),
    el('div', { class: 'kpi__value' }, [value, unit ? el('small', { text: unit }) : null]),
    note ? el('div', { class: 'kpi__note', text: note }) : null,
  ]);
}

function rangeControl() {
  const group = el('div', { class: 'segmented', role: 'group', 'aria-label': 'Date range' });
  for (const r of [7, 30, 90]) {
    const btn = el('button', { type: 'button', 'aria-pressed': String(r === state.range), text: `${r} days` });
    btn.addEventListener('click', () => {
      if (state.range === r) return;
      state.range = r;
      safeRender(qs('#view-trends'), renderTrends);
    });
    group.appendChild(btn);
  }
  return group;
}

async function renderTrends() {
  const root = qs('#view-trends');
  if (!state.client) return noClient(root);
  const data = await fetchJson(`/api/trends?client=${encodeURIComponent(state.client)}&range=${state.range}`);
  if (!data) return noClient(root);

  const loggedDays = data.days.filter((d) => d.logged).length;
  const head = viewHead('Trends', `Last ${data.range} days${state.clients.length > 1 ? ` · ${clientLabel(state.client)}` : ''}`, rangeControl());

  if (loggedDays === 0) {
    root.replaceChildren(head, card(null, [
      emptyState({
        icon: ICONS.chart,
        title: `No logs in the last ${data.range} days`,
        body: 'Trends need a few logged days to say anything useful. Log a meal on WhatsApp, or pick a longer range above.',
      }),
    ]));
    return;
  }

  const kpis = el('section', { class: 'card kpis', 'aria-label': 'Summary' }, [
    kpi('Current streak', fmtInt(data.streak), data.streak === 1 ? 'day' : 'days', 'logged in a row'),
    kpi('Days logged', `${data.adherencePct}`, '%', `${loggedDays} of ${data.range} days`),
    kpi('Protein target hit', `${data.proteinHitRatePct}`, '%', 'of logged days'),
    kpi('Average intake', fmtInt(data.avgKcal), 'kcal', `${fmtNum(data.avgProtein)} g protein a day`),
  ]);

  const chartBox = el('div', { class: 'chart' });
  const chartCard = card('Daily calories', [
    chartBox,
    legend([
      ['var(--accent)', 'Logged'],
      ['var(--bad-text)', 'More than 10% over target'],
      ['var(--border-strong)', 'Not logged'],
    ]),
  ], `Dashed line: ${fmtInt(data.targets.kcal)} kcal target`);

  const heatCard = card('Consistency', [heatmapGrid(data.days, data.targets), legend(HEAT_LEVELS)]);

  const table = el('table', {}, [
    el('thead', {}, [el('tr', {}, [
      el('th', { text: 'Week of' }), el('th', { class: 'num', text: 'Days logged' }),
      el('th', { class: 'num', text: 'Avg kcal' }), el('th', { class: 'num', text: 'Avg protein' }),
    ])]),
    el('tbody', {}, [...data.weeks].reverse().map((w) => el('tr', {}, [
      el('td', { text: fmtDay(w.weekStart) }),
      el('td', { class: 'num', text: `${w.loggedDays} / 7` }),
      el('td', { class: 'num', text: w.loggedDays ? fmtInt(w.avgKcal) : '-' }),
      el('td', { class: 'num', text: w.loggedDays ? `${fmtNum(w.avgProtein)} g` : '-' }),
    ]))),
  ]);
  const weeksCard = card('Weekly averages', [el('div', { class: 'table-wrap' }, [table])], 'Logged days only');

  root.replaceChildren(head, el('div', { class: 'stack' }, [kpis, chartCard, el('div', { class: 'split' }, [heatCard, weeksCard])]));
  dailyKcalChart(chartBox, data.days, data.targets.kcal);
  markScrollableTables(root);
}

// --- View: Foods -------------------------------------------------------------

let foodsDebounce;

// The search box is built once per client and kept across searches, so
// typing never loses focus; only the results below it re-render.
async function renderFoods() {
  const root = qs('#view-foods');
  if (!state.client) return noClient(root);

  let results = qs('.foods-results', root);
  if (!results || root.dataset.client !== state.client) {
    root.dataset.client = state.client;
    const input = el('input', { type: 'search', id: 'food-search', class: 'search', placeholder: 'Search foods', value: state.foodSearch, autocomplete: 'off' });
    input.addEventListener('input', (e) => {
      clearTimeout(foodsDebounce);
      const value = e.target.value;
      foodsDebounce = setTimeout(() => {
        state.foodSearch = value;
        safeRender(root, renderFoods);
      }, 200);
    });
    const field = el('div', { class: 'search-field' }, [
      el('label', { class: 'visually-hidden', for: 'food-search', text: 'Search logged foods' }),
      icon(ICONS.search, 18),
      input,
    ]);
    results = el('div', { class: 'foods-results stack', 'aria-live': 'polite' });
    root.replaceChildren(viewHead('Foods', state.clients.length > 1 ? clientLabel(state.client) : 'Everything you’ve logged', field), results);
  }

  const data = await fetchJson(`/api/foods?client=${encodeURIComponent(state.client)}&q=${encodeURIComponent(state.foodSearch)}`);
  const query = state.foodSearch.trim();

  if (data.history.length === 0) {
    results.replaceChildren(card(null, [
      query
        ? emptyState({ icon: ICONS.search, title: `No foods match “${query}”`, body: 'Try a shorter word, or clear the search to see everything.' })
        : emptyState({ icon: ICONS.bowl, title: 'No foods logged yet', body: 'Your most-logged foods and full history appear here once the bot has logged a few meals.' }),
    ]));
    return;
  }

  const top = data.mostLogged.slice(0, 8);
  const maxCount = Math.max(...top.map((f) => f.count));
  const topCard = card('Most logged', [
    el('ul', { class: 'top-foods' }, top.map((food) => el('li', { class: 'top-food' }, [
      el('div', { class: 'top-food__row' }, [
        el('span', { class: 'top-food__name', text: food.name }),
        el('span', { class: 'top-food__count', text: `${food.count}× · ${fmtInt(food.avgKcal)} kcal avg` }),
      ]),
      progressBar((food.count / maxCount) * 100, 'var(--accent)'),
    ]))),
  ]);

  const table = el('table', {}, [
    el('thead', {}, [el('tr', {}, [
      el('th', { text: 'When' }), el('th', { text: 'Food' }),
      el('th', { class: 'num', text: 'kcal' }), el('th', { class: 'num hide-sm', text: 'P / C / F (g)' }),
    ])]),
    el('tbody', {}, data.history.map((row) => el('tr', {}, [
      el('td', { text: `${fmtDay(row.date)}, ${row.time}` }),
      el('td', { class: 'food', text: row.name }),
      el('td', { class: 'num', text: fmtInt(row.kcal) }),
      el('td', { class: 'num hide-sm', text: `${fmtNum(row.protein_g)} / ${fmtNum(row.carbs_g)} / ${fmtNum(row.fat_g)}` }),
    ]))),
  ]);
  const historyCard = card('History', [el('div', { class: 'table-wrap' }, [table])],
    data.history.length >= 200 ? 'Latest 200' : plural(data.history.length, 'entry', 'entries'));

  results.replaceChildren(el('div', { class: 'split' }, [topCard, historyCard]));
  markScrollableTables(results);
}

// --- View: Coach -------------------------------------------------------------

function field(id, label, inputAttrs, hint) {
  const hintId = hint ? `${id}-hint` : null;
  const input = el('input', { id, class: 'text-input', 'aria-describedby': hintId, ...inputAttrs });
  return {
    input,
    node: el('div', { class: 'field' }, [
      el('label', { for: id, text: label }),
      input,
      hint ? el('span', { class: 'hint', id: hintId, text: hint }) : null,
    ]),
  };
}

function addClientForm() {
  const number = field('add-number', 'WhatsApp number', { type: 'tel', inputmode: 'tel', autocomplete: 'off', required: 'true', placeholder: '+1 555 0100' }, 'Include the country code.');
  const name = field('add-name', 'Name', { type: 'text', autocomplete: 'off', placeholder: 'Optional' });
  const targets = [
    field('add-kcal', 'Calories', { type: 'number', min: '0', inputmode: 'numeric', placeholder: 'kcal' }),
    field('add-protein', 'Protein', { type: 'number', min: '0', inputmode: 'numeric', placeholder: 'g' }),
    field('add-carbs', 'Carbs', { type: 'number', min: '0', inputmode: 'numeric', placeholder: 'g' }),
    field('add-fat', 'Fat', { type: 'number', min: '0', inputmode: 'numeric', placeholder: 'g' }),
  ];
  const submit = el('button', { type: 'submit', class: 'btn btn--primary', text: 'Add client' });
  const status = el('div', { class: 'status', role: 'status', 'aria-live': 'polite' });

  const form = el('form', { class: 'form', novalidate: 'true' }, [
    el('div', { class: 'form-row' }, [number.node, name.node]),
    el('fieldset', { class: 'fieldset' }, [
      el('legend', { text: 'Daily targets' }),
      el('div', { class: 'form-row form-row--4' }, targets.map((t) => t.node)),
      el('span', { class: 'hint', text: 'Optional. Fill in all four, or leave them empty to use your defaults from .env.' }),
    ]),
    el('div', { class: 'form-actions' }, [submit, status]),
  ]);

  const setStatus = (text, kind) => {
    status.textContent = text;
    status.className = `status status--${kind}`;
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const numberValue = number.input.value.trim();
    number.input.removeAttribute('aria-invalid');
    if (!numberValue) {
      number.input.setAttribute('aria-invalid', 'true');
      number.input.focus();
      return setStatus('Enter the client’s WhatsApp number.', 'error');
    }
    const filled = targets.filter((t) => t.input.value.trim());
    if (filled.length > 0 && filled.length < 4) {
      return setStatus('Fill in all four targets, or leave them all empty.', 'error');
    }
    const body = { number: numberValue, name: name.input.value.trim() };
    for (const [key, t] of [['kcal', targets[0]], ['protein_g', targets[1]], ['carbs_g', targets[2]], ['fat_g', targets[3]]]) {
      if (t.input.value.trim()) body[key] = Number(t.input.value);
    }
    submit.disabled = true;
    setStatus('Adding…', 'ok');
    try {
      const { ok, data } = await postJson('/api/clients/add', body);
      if (!ok) {
        number.input.setAttribute('aria-invalid', 'true');
        return setStatus(capitalize(data.error || 'Couldn’t add that client.'), 'error');
      }
      form.reset();
      await refreshClients();
      await renderCoach();
      const fresh = qs('#view-coach .form .status');
      if (fresh) {
        fresh.textContent = `Added ${data.client.name || data.client.client_id}. They can message the bot now.`;
        fresh.className = 'status status--ok';
      }
    } catch (err) {
      setStatus('Couldn’t reach the server. Try again in a moment.', 'error');
    } finally {
      submit.disabled = false;
    }
  });

  return card('Add a client', [form]);
}

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function setRosterStatus(text) {
  const status = qs('#roster-status');
  if (status) {
    status.textContent = text;
    status.className = `status${text ? ' status--error' : ''}`;
  }
}

function clientRowActions(c) {
  const toggle = el('button', { type: 'button', class: 'btn btn--sm', text: c.status === 'paused' ? 'Resume' : 'Pause' });
  toggle.addEventListener('click', async (e) => {
    e.stopPropagation();
    const action = c.status === 'paused' ? 'resume' : 'pause';
    toggle.disabled = true;
    try {
      const { ok, data } = await postJson(`/api/clients/${action}`, { client: c.clientId });
      if (ok) return renderCoach();
      setRosterStatus(capitalize(data.error || `Couldn’t ${action} ${c.name || c.clientId}.`));
    } catch {
      setRosterStatus('Couldn’t reach the server. Try again in a moment.');
    }
    toggle.disabled = false;
  });

  // Two-step remove: the first click arms the button for a few seconds.
  const remove = el('button', { type: 'button', class: 'btn btn--sm btn--danger', text: 'Remove' });
  let disarm;
  remove.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (remove.dataset.confirming !== 'true') {
      remove.dataset.confirming = 'true';
      remove.textContent = 'Confirm remove';
      remove.setAttribute('aria-label', `Confirm removing ${c.name || c.clientId}. Their logged food is kept.`);
      disarm = setTimeout(() => {
        remove.dataset.confirming = 'false';
        remove.textContent = 'Remove';
        remove.removeAttribute('aria-label');
      }, 4000);
      return;
    }
    clearTimeout(disarm);
    remove.disabled = true;
    try {
      const { ok, data } = await postJson('/api/clients/remove', { client: c.clientId });
      if (ok) {
        await refreshClients();
        return renderCoach();
      }
      setRosterStatus(capitalize(data.error || `Couldn’t remove ${c.name || c.clientId}.`));
    } catch {
      setRosterStatus('Couldn’t reach the server. Try again in a moment.');
    }
    remove.disabled = false;
  });
  return el('div', { class: 'row-actions roster__actions' }, [toggle, remove]);
}

function openClient(clientId) {
  state.client = clientId;
  if (!state.clients.includes(clientId)) state.clients.push(clientId);
  populateClientSelect();
  updateClientChrome();
  setView('today');
}

function rosterRow(c) {
  const flags = [];
  if (c.status === 'paused') flags.push(el('span', { class: 'badge badge--info', text: 'Paused' }));
  for (const f of c.flags) flags.push(el('span', { class: 'badge badge--warn', text: capitalize(f) }));
  if (!flags.length) flags.push(el('span', { class: 'badge badge--good', text: 'On track' }));

  const label = c.name || c.clientId;
  const nameBtn = el('button', { type: 'button', class: 'roster__name', text: label, 'aria-label': `Open ${label}’s log` });
  nameBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openClient(c.clientId);
  });

  const stat = (cls, title, valueNodes) => el('div', { class: `roster__num ${cls}` }, [el('span', { class: 'roster__label', text: title }), ...valueNodes]);
  const row = el('li', { class: 'roster__row', 'data-clickable': 'true' }, [
    el('div', { class: 'roster__client' }, [nameBtn, c.name ? el('span', { class: 'roster__id', text: `+${c.clientId}` }) : null]),
    stat('roster__kcal', 'Today kcal', [fmtInt(c.today.eaten.kcal), el('span', { class: 'of', text: ` / ${fmtInt(c.today.targets.kcal)}` })]),
    stat('roster__protein', 'Protein', [fmtNum(c.today.eaten.protein_g), el('span', { class: 'of', text: ` / ${fmtNum(c.today.targets.protein_g)} g` })]),
    el('div', { class: 'roster__last' }, [el('span', { class: 'roster__label', text: 'Last log' }), fmtLastLog(c.lastLog)]),
    stat('roster__days', '7-day logging', [`${c.adherencePct}%`]),
    el('div', { class: 'roster__flags' }, flags),
    clientRowActions(c),
  ]);
  row.addEventListener('click', (e) => {
    if (e.target.closest('.row-actions')) return;
    openClient(c.clientId);
  });
  return row;
}

async function renderCoach() {
  const root = qs('#view-coach');
  const data = await fetchJson('/api/coach');
  if (!data) return;

  let roster;
  if (data.clients.length === 0) {
    roster = card('Clients', [
      emptyState({
        icon: ICONS.people,
        title: 'No clients yet',
        body: 'Add a client below with their WhatsApp number. They can start logging right away by messaging the bot.',
      }),
    ]);
  } else {
    const head = el('li', { class: 'roster__row roster__row--head', 'aria-hidden': 'true' }, [
      el('span', { text: 'Client' }), el('span', { class: 'roster__num', text: 'Today kcal' }),
      el('span', { class: 'roster__num', text: 'Protein' }), el('span', { text: 'Last log' }),
      el('span', { class: 'roster__num', text: '7 days' }), el('span', { text: 'Status' }), el('span'),
    ]);
    const flagged = data.clients.filter((c) => c.flags.length).length;
    roster = card('Clients', [
      el('ul', { class: 'roster' }, [head, ...data.clients.map(rosterRow)]),
      el('div', { id: 'roster-status', class: 'status', role: 'status', 'aria-live': 'polite' }),
    ], flagged ? `${flagged} need${flagged === 1 ? 's' : ''} a check-in` : `${plural(data.clients.length, 'client')}`);
  }

  root.replaceChildren(viewHead('Coach', 'Everyone you coach, at a glance. Select a client to open their log.'), el('div', { class: 'stack' }, [roster, addClientForm()]));
}

// --- Routing / chrome --------------------------------------------------------

const RENDERERS = { today: renderToday, trends: renderTrends, foods: renderFoods, coach: renderCoach };

function renderCurrent() {
  const root = qs(`#view-${state.view}`);
  return safeRender(root, RENDERERS[state.view]);
}

function setView(view) {
  state.view = view;
  for (const tab of document.querySelectorAll('.tab')) {
    const selected = tab.dataset.view === view;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
  }
  for (const section of document.querySelectorAll('.view')) {
    section.setAttribute('data-active', String(section.dataset.view === view));
  }
  renderCurrent();
}

function populateClientSelect() {
  const select = qs('#client-select');
  select.replaceChildren(...state.clients.map((c) => el('option', { value: c, text: clientLabel(c) })));
  select.hidden = state.clients.length <= 1;
  if (state.client) select.value = state.client;
}

function updateClientChrome() {
  qs('#client-name').textContent = state.client && state.clients.length <= 1 ? clientLabel(state.client) : '';
  const exportLink = qs('#export-link');
  if (state.client) {
    exportLink.href = `/api/export.csv?client=${encodeURIComponent(state.client)}`;
    exportLink.removeAttribute('aria-disabled');
    exportLink.removeAttribute('tabindex');
  } else {
    exportLink.setAttribute('aria-disabled', 'true');
    exportLink.setAttribute('tabindex', '-1');
  }
}

function applyClientData(clientData) {
  state.clients = clientData.clients;
  state.names = clientData.names || {};
  state.coachEnabled = clientData.coachEnabled;
  if (!state.client || !state.clients.includes(state.client)) state.client = state.clients[0] || null;
  populateClientSelect();
  updateClientChrome();
  qs('#coach-tab').hidden = !state.coachEnabled;
  qs('#logout-form').hidden = !clientData.authRequired;
}

async function refreshClients() {
  applyClientData(await fetchJson('/api/clients'));
}

// Arrow keys move between tabs, per the WAI-ARIA tabs pattern.
function onTabKey(e) {
  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
  const tabs = [...document.querySelectorAll('.tab:not([hidden])')];
  const i = tabs.indexOf(document.activeElement);
  if (i === -1) return;
  const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
  next.focus();
  setView(next.dataset.view);
}

async function boot() {
  try {
    await refreshClients();
  } catch (err) {
    if (err instanceof OfflineError) {
      markOffline(boot);
      qs('#view-today').replaceChildren(card(null, [emptyState({
        icon: ICONS.plug,
        title: 'Dashboard server not reachable',
        body: 'Start it with npm run dashboard. This page reconnects by itself.',
      })]));
      return;
    }
    throw err;
  }
  setView(state.view);
}

function init() {
  initTheme();
  qs('#theme-toggle').addEventListener('click', () => {
    toggleTheme();
    rerenderChart();
  });
  for (const tab of document.querySelectorAll('.tab')) {
    tab.addEventListener('click', () => setView(tab.dataset.view));
  }
  qs('.tabs').addEventListener('keydown', onTabKey);
  qs('#client-select').addEventListener('change', (e) => {
    state.client = e.target.value;
    updateClientChrome();
    renderCurrent();
  });

  // Keep Today and Coach current while the page stays open, so new WhatsApp
  // logs appear without a reload. Skipped while offline (the retry loop owns
  // reconnecting) and while the tab is hidden.
  setInterval(() => {
    if (!state.online || document.hidden) return;
    if (state.view === 'today' || state.view === 'coach') {
      if (qs('#view-coach').contains(document.activeElement) && document.activeElement.matches('input')) return;
      renderCurrent();
    }
  }, 60000);

  boot();
}

init();
