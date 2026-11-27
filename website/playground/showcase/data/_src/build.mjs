#!/usr/bin/env node
// Writes the data demo's showcase: Juniper Coffee's subscriptions dashboard (this folder's `db/` and `_blobs/`), and the
// demo's definition, `demos/data.demo.json`: the simulated agent's script and the replay. The page's styles and scripts
// are `app.css` and `app.js` beside this file (`goal.js` comes with the agent's second answer); its HTML is `page()` below. Everything here is made up, from fixed
// numbers, so a run always writes the same files.
//
//   node website/playground/showcase/data/_src/build.mjs && node website/playground/scripts/make-seeds.mjs data
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const PLAYGROUND = path.resolve(ROOT, '..', '..');

/* ---- the numbers ------------------------------------------------------------------------------------------------- */

/** A small fixed random source (mulberry32): the same rows on every run. */
function random(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = random(20260420);
const between = (low, high) => low + (high - low) * rand();

const DAY = 864e5;
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const FIRST_WEEK = Date.UTC(2026, 1, 2);
/** Thirteen Mondays, Feb 2 to Apr 27. The dashboard is built with the first eleven; the agent's answer brings the rest. */
const WEEKS = Array.from({ length: 13 }, (_, i) => iso(FIRST_WEEK + i * 7 * DAY));
const BUILT_WEEKS = 11;
const LAUNCH = WEEKS[11];

const PLANS = [
  { plan: 'Solo', price: 36, ships: '1 bag / 2 wks', bags: 1, perWeek: 0.5, shipment: 18, start: 858 },
  { plan: 'Duo', price: 64, ships: '2 bags / 2 wks', bags: 2, perWeek: 0.5, shipment: 32, start: 562 },
  { plan: 'Office', price: 240, ships: '4 bags / wk', bags: 4, perWeek: 1, shipment: 60, start: 128 },
];
/** Net new subscribers per week after the first, and cancellations per week, by plan. The last two weeks are launch. */
const NET = {
  Solo: [11, 13, 10, 12, 14, 11, 12, 13, 12, 12, 69, 41],
  Duo: [6, 8, 7, 6, 8, 7, 7, 6, 8, 7, 45, 28],
  Office: [1, 1, 1, 0, 2, 1, 1, 1, 1, 1, 7, 5],
};
const CHURNED = {
  Solo: [9, 10, 9, 11, 10, 9, 10, 11, 10, 11, 12, 9, 8],
  Duo: [6, 7, 6, 7, 6, 7, 6, 7, 7, 7, 7, 6, 5],
  Office: [1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
};

/** `subscriptions`: one row per week and plan. */
const SUBSCRIPTIONS = [];
for (const [w, week] of WEEKS.entries()) {
  for (const plan of PLANS) {
    const active = plan.start + NET[plan.plan].slice(0, w).reduce((a, b) => a + b, 0);
    const churned = CHURNED[plan.plan][w];
    const net = w === 0 ? Math.round(between(8, 12) * (plan.start / 858)) : NET[plan.plan][w - 1];
    const launch = w >= 11;
    const orders = Math.round(active * plan.perWeek * between(0.97, 1.03) * (launch ? 1.05 : 1));
    const revenue = Math.round(orders * plan.shipment * (1 + (launch ? between(0.11, 0.13) : between(0.03, 0.06))));
    SUBSCRIPTIONS.push({ week, plan: plan.plan, active, new: net + churned, churned, mrr: active * plan.price, orders, revenue });
  }
}

const ROASTS = [
  { roast: 'Homestead', origin: 'Colombia and Brazil blend', level: 'Medium roast', notes: 'Milk chocolate and toasted almond', seasonal: 'no' },
  { roast: 'Ridgeline', origin: 'Sumatra and Guatemala blend', level: 'Dark roast', notes: 'Cocoa and cedar', seasonal: 'no' },
  { roast: 'Daybreak', origin: 'Ethiopia Guji', level: 'Light roast', notes: 'Peach and jasmine', seasonal: 'no' },
  { roast: 'Guest Roast', origin: 'A new single origin each month', level: 'Medium roast', notes: 'Changes monthly', seasonal: 'no' },
  { roast: 'Night Shift Decaf', origin: 'Colombia Huila', level: 'Medium roast', notes: 'Caramel and red apple', seasonal: 'no' },
  { roast: 'First Light', origin: 'Kenya Nyeri and Ethiopia Sidama', level: 'Light roast', notes: 'Blackcurrant and citrus blossom', seasonal: 'yes' },
];
const TASTE = {
  Solo: { Homestead: 0.3, Ridgeline: 0.2, Daybreak: 0.24, 'Guest Roast': 0.15, 'Night Shift Decaf': 0.11 },
  Duo: { Homestead: 0.32, Ridgeline: 0.22, Daybreak: 0.2, 'Guest Roast': 0.15, 'Night Shift Decaf': 0.11 },
  Office: { Homestead: 0.44, Ridgeline: 0.3, Daybreak: 0.1, 'Guest Roast': 0.06, 'Night Shift Decaf': 0.1 },
};
const FIRST_LIGHT = { Solo: [0.31, 0.28], Duo: [0.29, 0.26], Office: [0.15, 0.15] };

/** `roast_bags`: bags shipped per week, plan and roast. First Light ships from launch week. */
const ROAST_BAGS = [];
for (const [w, week] of WEEKS.entries()) {
  for (const plan of PLANS) {
    const row = SUBSCRIPTIONS.find((r) => r.week === week && r.plan === plan.plan);
    const launch = w >= 11;
    const total = Math.round(row.orders * plan.bags * (launch ? 1.06 : 1.02));
    const weights = Object.entries(TASTE[plan.plan]).map(([roast, share]) => [roast, share * between(0.93, 1.07) * (launch && roast === 'Guest Roast' ? 0.7 : 1)]);
    const seasonal = launch ? FIRST_LIGHT[plan.plan][w - 11] : 0;
    const sum = weights.reduce((a, [, v]) => a + v, 0);
    const shares = weights.map(([roast, v]) => [roast, (v / sum) * (1 - seasonal)]);
    if (launch) shares.push(['First Light', seasonal]);
    const counts = shares.map(([roast, share]) => [roast, Math.floor(total * share), (total * share) % 1]);
    let left = total - counts.reduce((a, [, n]) => a + n, 0);
    for (const item of [...counts].sort((a, b) => b[2] - a[2])) if (left-- > 0) item[1] += 1;
    for (const [roast, bags] of counts) ROAST_BAGS.push({ week, plan: plan.plan, roast, bags });
  }
}
ROAST_BAGS.sort((a, b) => a.week.localeCompare(b.week) || a.plan.localeCompare(b.plan) || a.roast.localeCompare(b.roast));
SUBSCRIPTIONS.sort((a, b) => a.week.localeCompare(b.week) || a.plan.localeCompare(b.plan));

/** `orders`: the latest eight, as the dashboard was built (Sunday, Apr 19) and two weeks on (Sunday, May 3). */
const order = (order_no, placed_at, plan, roast, bags, total, status) => ({ order_no, placed_at, plan, roast, bags, total, status });
const ORDERS_BUILT = [
  order('JC-21480', '2026-04-19T21:47:00Z', 'Solo', 'Daybreak', 1, 18, 'Paid'),
  order('JC-21479', '2026-04-19T21:12:00Z', 'Duo', 'Homestead', 2, 32, 'Paid'),
  order('JC-21478', '2026-04-19T20:38:00Z', 'Solo', 'Ridgeline', 1, 18, 'Paid'),
  order('JC-21477', '2026-04-19T19:55:00Z', 'Office', 'Homestead', 4, 60, 'Roasting'),
  order('JC-21476', '2026-04-19T19:21:00Z', 'Duo', 'Guest Roast', 3, 49, 'Roasting'),
  order('JC-21475', '2026-04-19T18:40:00Z', 'Solo', 'Homestead', 1, 18, 'Roasting'),
  order('JC-21474', '2026-04-19T17:58:00Z', 'Solo', 'Night Shift Decaf', 2, 35, 'Shipped'),
  order('JC-21473', '2026-04-19T16:44:00Z', 'Duo', 'Daybreak', 2, 32, 'Shipped'),
];
const ORDERS_LATER = [
  order('JC-23512', '2026-05-03T21:52:00Z', 'Duo', 'First Light', 3, 51, 'Paid'),
  order('JC-23511', '2026-05-03T21:30:00Z', 'Solo', 'First Light', 1, 18, 'Paid'),
  order('JC-23510', '2026-05-03T20:49:00Z', 'Solo', 'Homestead', 2, 37, 'Paid'),
  order('JC-23509', '2026-05-03T20:11:00Z', 'Office', 'First Light', 4, 60, 'Roasting'),
  order('JC-23508', '2026-05-03T19:36:00Z', 'Duo', 'Ridgeline', 2, 32, 'Roasting'),
  order('JC-23507', '2026-05-03T18:58:00Z', 'Solo', 'Daybreak', 1, 18, 'Roasting'),
  order('JC-23506', '2026-05-03T18:02:00Z', 'Duo', 'First Light', 2, 32, 'Shipped'),
  order('JC-23505', '2026-05-03T17:15:00Z', 'Office', 'Homestead', 5, 79, 'Shipped'),
];

/** The spring goal: a straight line from where subscribers stood in the first week to 2,000 on May 25. */
const GOAL = 2000;
const GOAL_WEEKS = 17;
const startTotal = PLANS.reduce((a, p) => a + p.start, 0);
const GOALS = Array.from({ length: GOAL_WEEKS }, (_, i) => ({ week: iso(FIRST_WEEK + i * 7 * DAY), subscribers: Math.round(startTotal + ((GOAL - startTotal) * i) / (GOAL_WEEKS - 1)) }));

/* ---- the figures the words quote ---------------------------------------------------------------------------------- */

function figures(weeks) {
  const rows = SUBSCRIPTIONS.filter((r) => weeks.includes(r.week));
  const total = (week, key) => rows.filter((r) => r.week === week).reduce((a, r) => a + r[key], 0);
  const sum = (list, key) => list.reduce((a, week) => a + total(week, key), 0);
  const last = weeks.at(-1);
  const recent = weeks.slice(-4);
  const bags = new Map();
  for (const r of ROAST_BAGS) if (r.week === last) bags.set(r.roast, (bags.get(r.roast) ?? 0) + r.bags);
  const ranked = [...bags].sort((a, b) => b[1] - a[1]);
  const subscribers = total(last, 'active');
  return {
    subscribers,
    mrr: total(last, 'mrr'),
    churn: sum(recent, 'churned') / total(weeks.at(-5), 'active'),
    order: sum(recent, 'revenue') / sum(recent, 'orders'),
    gap: subscribers - GOALS.find((g) => g.week === last).subscribers,
    ranked,
  };
}
const int = (n) => Math.round(n).toLocaleString('en-US');
const kusd = (n) => `$${(n / 1000).toFixed(1)}k`;
const pct = (n) => `${(n * 100).toFixed(1)}%`;
const usd = (n) => `$${n.toFixed(2)}`;
const BUILT = figures(WEEKS.slice(0, BUILT_WEEKS));
const LATER = figures(WEEKS);

/* ---- the documents ------------------------------------------------------------------------------------------------ */

const csv = (rows) => `${[Object.keys(rows[0]).join(','), ...rows.map((row) => Object.values(row).join(','))].join('\n')}\n`;
const FILES = {
  plans: { name: 'plans.csv', text: csv(PLANS.map(({ plan, price, ships, bags }) => ({ plan, price_per_month: price, ships, bags_per_shipment: bags }))) },
  roast_catalog: { name: 'roasts.csv', text: csv(ROASTS) },
  goals: { name: 'spring-goal.csv', text: csv(GOALS) },
};
for (const file of Object.values(FILES)) file.id = createHash('sha256').update(file.text).digest('hex').slice(0, 32);

const UPLOADED = { at: '2026-04-20T13:00:00Z', by: 'Agent' };
const fileSource = (key) => ({ kind: 'file', url: `/_blob/${FILES[key].id}`, name: FILES[key].name, format: 'csv' });
const SQL = {
  subscriptions: [
    'SELECT s.week, s.plan, s.active, s.new, s.churned, s.mrr, o.orders, o.revenue',
    'FROM subscription_weeks s',
    'JOIN (',
    "  SELECT date_trunc('week', placed_at)::date AS week, plan,",
    '         count(*) AS orders, sum(total) AS revenue',
    '  FROM orders',
    "  WHERE status <> 'cancelled'",
    '  GROUP BY 1, 2',
    ') o USING (week, plan)',
    "WHERE s.week >= DATE '2026-02-02'",
    'ORDER BY s.week, s.plan',
  ].join('\n'),
  roast_bags: [
    "SELECT date_trunc('week', o.placed_at)::date AS week, o.plan, i.roast, sum(i.bags) AS bags",
    'FROM order_items i',
    'JOIN orders o ON o.id = i.order_id',
    "WHERE o.status <> 'cancelled'",
    "  AND o.placed_at >= DATE '2026-02-02'",
    'GROUP BY 1, 2, 3',
    'ORDER BY 1, 2, 3',
  ].join('\n'),
  orders: ['SELECT order_no, placed_at, plan, roast, bags, total, status', 'FROM orders', 'ORDER BY placed_at DESC', 'LIMIT 8'].join('\n'),
};
const query = (id) => ({ kind: 'call', connector: 'shop', tool: 'run_sql', args: { query: SQL[id] } });

const DATASETS = {
  subscriptions: { title: 'Subscriptions by week', description: 'Active, new and cancelled subscriptions, MRR, orders and revenue per week and plan, since February.', source: query('subscriptions'), langs: { query: 'sql' } },
  roast_bags: { title: 'Bags shipped by roast', description: 'Bags shipped per week, plan and roast, since February.', source: query('roast_bags'), langs: { query: 'sql' } },
  orders: { title: 'Latest orders', description: 'The eight most recent orders in the shop.', source: query('orders'), langs: { query: 'sql' } },
  plans: { title: 'Plans and prices', description: 'What each plan costs a month and what it ships.', source: fileSource('plans'), updated: UPLOADED, fixed: true },
  roast_catalog: { title: 'Roast catalog', description: 'Each roast’s origin and roast level, and whether it is seasonal.', source: fileSource('roast_catalog'), updated: UPLOADED, fixed: true },
  goals: { title: 'Spring subscriber goal', description: 'The weekly path to 2,000 active subscribers by May 25.', source: fileSource('goals'), updated: UPLOADED, fixed: true },
};

/** The shop's answers as its owner's computer saved them (`data/live`): what a page without connectors shows. */
function snapshot(weeks, orders, at) {
  const answer = (id, rows) => [`data/live/answers/${id}`, { at, connector: 'shop', calls: [{ tool: 'run_sql', args: { query: SQL[id] }, result: { structuredContent: { rows } } }] }];
  return Object.fromEntries([
    answer('subscriptions', SUBSCRIPTIONS.filter((r) => weeks.includes(r.week))),
    answer('roast_bags', ROAST_BAGS.filter((r) => weeks.includes(r.week))),
    answer('orders', orders),
    ['data/live', { at, owner: '', queries: ['orders', 'roast_bags', 'subscriptions'] }],
  ]);
}
const SNAPSHOT_BUILT = snapshot(WEEKS.slice(0, BUILT_WEEKS), ORDERS_BUILT, '2026-04-20T13:00:00Z');
const SNAPSHOT_LATER = snapshot(WEEKS, ORDERS_LATER, '2026-05-04T13:00:00Z');

const LOOK = {
  system: { name: 'Juniper Coffee' },
  light: {
    ground: '#f7f2e8', card: '#fffdf8', text: '#1d1b16', muted: '#756f62', border: '#e7e2d6',
    good: '#2c6140', warning: '#8a5a12', bad: '#a93a1c',
    charts: ['#20402f', '#5b7f5e', '#e3a53c', '#c2562b', '#8c7355', '#3f6f8a', '#a8a08c', '#7a4a5e'],
  },
  dark: {
    ground: '#15140f', card: '#201e18', text: '#f7f2e8', muted: '#a39c8c', border: '#34312a',
    good: '#7fc296', warning: '#e3a53c', bad: '#ee8b6c',
    charts: ['#7fb08e', '#b9d0b3', '#e3a53c', '#e0764b', '#bfa27f', '#7fb1cc', '#8f8a7c', '#c08aa0'],
  },
  corners: '10px',
  fonts: { display: "'Iowan Old Style', 'Palatino Linotype', Georgia, serif" },
};
/** The same look with terracotta leading the charts: the agent's third answer. */
const LOOK_WARM = {
  ...LOOK,
  light: { ...LOOK.light, charts: ['#c2562b', '#e3a53c', '#8c7355', '#20402f', '#5b7f5e', '#3f6f8a', '#a8a08c', '#7a4a5e'] },
  dark: { ...LOOK.dark, charts: ['#e0764b', '#e3a53c', '#bfa27f', '#7fb08e', '#b9d0b3', '#7fb1cc', '#8f8a7c', '#c08aa0'] },
};

/* ---- the page ----------------------------------------------------------------------------------------------------- */

const tile = (metric, title, note) => `      <article class="jc-card jc-tile" id="tile-${metric}">
        <h2>${title}</h2>
        <p class="jc-big"><span data-draw="kpi-${metric}" data-source="kpis" data-field="value" data-where="metric=${metric}" data-fetchpriority="high">—</span></p>
        <p class="jc-delta"><span data-draw="delta-${metric}" data-source="kpis" data-field="change" data-where="metric=${metric}">—</span> ${note}</p>
        <div class="jc-spark" data-draw="spark-${metric}" data-source="totals"></div>
      </article>`;

/**
 * The page's HTML. The replay writes it in four passes (`trend`, `roasts` and `tables` say how far it has got); the
 * agent's second answer adds the goal bar and marks the launch on the chart (`goal`).
 */
function page({ trend = true, roasts = true, tables = true, goal = false } = {}) {
  const parts = [];
  parts.push(`<meta name="dash-one-writer">
<link rel="stylesheet" href="app.css">
<main class="jc" data-read lang="en">
  <header class="jc-head" id="overview">
    <p class="jc-eyebrow">Juniper Coffee</p>
    <h1 class="jc-title" id="title">Subscriptions</h1>
    <div class="jc-filters">
      <label class="jc-filter">Plan
        <select class="dash-select" data-draw="plan-filter" aria-label="Plan" data-source="plans"></select>
      </label>
    </div>
    <p class="jc-lede" id="summary" data-read-step>Week of <b data-draw="lede-week" data-source="totals" data-field="week">—</b>: <b data-draw="lede-subscribers" data-source="kpis" data-field="value" data-where="metric=subscribers">—</b> active subscribers, <span data-draw="lede-direction" data-source="standing" data-field="direction">—</span> <b data-draw="lede-growth" data-source="standing" data-field="gained_by">—</b> since <span data-draw="lede-first" data-source="totals" data-field="week">—</span><span data-all-plans> and <b data-draw="lede-gap" data-source="standing" data-field="gap_by" data-where="plan=All plans">—</b> <b data-draw="lede-side" data-source="standing" data-field="side" data-where="plan=All plans">—</b> the path to <span data-draw="lede-goal" data-source="goals" data-field="subscribers" data-where="week=${GOALS.at(-1).week}">—</span> by <span data-draw="lede-goal-day" data-source="goals" data-field="week">—</span></span>.</p>
  </header>

  <section class="jc-tiles" id="figures" aria-label="Key figures">
${tile('subscribers', 'Active subscribers', 'in 4 weeks')}
${tile('mrr', 'Monthly recurring revenue', 'in 4 weeks')}
${tile('churn', 'Churn, last 4 weeks', 'vs prior 4 weeks')}
${tile('order', 'Average order, 4 weeks', 'vs prior 4 weeks')}
  </section>`);
  if (goal) {
    parts.push(`
  <section class="jc-card jc-goalbar" id="spring-goal" data-all-plans>
    <h2>Spring goal</h2>
    <p class="jc-sub"><b data-draw="goal-now" data-source="kpis" data-field="value" data-where="plan=All plans&amp;metric=subscribers">—</b> of <span data-draw="lede-goal" data-source="goals" data-field="subscribers" data-where="week=${GOALS.at(-1).week}">—</span> subscribers by <span data-draw="lede-goal-day" data-source="goals" data-field="week">—</span></p>
    <div class="jc-meter" data-draw="goal-meter" data-source="goal_progress"></div>
    <p class="jc-meter-value"><b data-draw="goal-progress" data-source="goal_progress">—</b></p>
  </section>`);
  }
  if (trend) {
    parts.push(`
  <section class="jc-grid">
    <figure class="jc-card jc-fig" id="subscribers-chart" data-source="totals subscriptions goals">
      <figcaption>Subscribers against the spring goal</figcaption>
      <p class="jc-legend"><span><i></i>Subscribers</span><span data-all-plans><i class="jc-goal"></i>Goal path</span>${goal ? '<span><i class="jc-launch"></i>First Light launch</span>' : ''}</p>
      <div class="jc-chart" data-draw="trend"${goal ? ` data-mark-week="${LAUNCH}" data-mark-label="First Light"` : ''}></div>
      <p class="jc-foot">In the latest week <b data-draw="flow-new" data-source="totals" data-field="new">—</b> people subscribed and <b data-draw="flow-cancelled" data-source="totals" data-field="churned">—</b> cancelled.</p>
    </figure>${
      roasts
        ? `
    <figure class="jc-card jc-fig" id="roasts-chart" data-source="roast_week roast_bags roast_catalog">
      <figcaption>Bags shipped by roast</figcaption>
      <p class="jc-sub">Week of <span data-draw="roast-week" data-source="roast_week" data-field="week">—</span></p>
      <div class="jc-bars" data-draw="roasts"></div>
      <p class="jc-foot">The tick on each bar is the week before.</p>
    </figure>`
        : ''
    }
  </section>`);
  }
  if (tables) {
    parts.push(`
  <section class="jc-grid">
    <div class="jc-card jc-fig" id="orders">
      <h2>Latest orders</h2>
      <p class="jc-sub">Straight from the shop, newest first</p>
      <div class="jc-scroll">
        <table class="jc-table" id="orders-table" data-source="orders" data-row-key="order_no" data-fetchpriority="low">
          <thead><tr><th data-field="order_no">Order</th><th data-field="placed_at">Placed</th><th data-field="plan">Plan</th><th data-field="roast">Roast</th><th data-field="bags" class="jc-num">Bags</th><th data-field="total" class="jc-num">Total</th><th data-field="status">Status</th></tr></thead>
          <tbody data-draw="orders-rows"></tbody>
        </table>
      </div>
    </div>
    <div class="jc-card jc-fig" id="plans">
      <h2>Plans</h2>
      <p class="jc-sub">Pick one to filter the page</p>
      <div class="jc-scroll">
        <table class="jc-table jc-plans" id="plans-table" data-source="plan_mix" data-row-key="plan">
          <thead><tr><th data-field="plan">Plan</th><th data-field="price" class="jc-num">A month</th><th data-field="subscribers" class="jc-num">Subscribers</th><th data-field="share" class="jc-num">Share</th></tr></thead>
          <tbody data-draw="plan-rows"></tbody>
        </table>
      </div>
    </div>
  </section>

  <details class="jc-notes" id="definitions">
    <summary>How these figures are worked out</summary>
    <dl>
      <dt>Active subscribers</dt><dd>Subscriptions that are paid up at the end of the week.</dd>
      <dt>Monthly recurring revenue</dt><dd>Every active subscription at its plan’s monthly price.</dd>
      <dt>Churn</dt><dd>Cancellations over four weeks, as a share of the subscribers at the start of those weeks. Lower is better.</dd>
      <dt>Average order</dt><dd>Revenue over orders for four weeks, add-on bags included.</dd>
      <dt>Goal path</dt><dd>A straight line from where subscribers stood in the first week to the spring goal. It counts every plan, so it steps aside when one plan is picked.</dd>
    </dl>
  </details>`);
  }
  parts.push(`\n</main>\n<script src="app.js"></script>\n${goal ? '<script src="goal.js"></script>\n' : ''}`);
  return parts.join('');
}

/* ---- write the folder --------------------------------------------------------------------------------------------- */

const read = (name) => fs.readFileSync(path.join(HERE, name), 'utf8');
const DOCS = {
  'dash/meta': { title: 'Juniper Coffee subscriptions', lang: 'en' },
  'dash/params': { plan: '' },
  'dash/look': LOOK,
  ...Object.fromEntries(Object.entries(DATASETS).map(([id, doc]) => [`datasets/${id}`, doc])),
  'files/app.css': { text: read('app.css') },
  'files/app.js': { text: read('app.js') },
  'files/index.html': { text: page() },
  ...SNAPSHOT_BUILT,
};

for (const name of ['db', '_blobs']) fs.rmSync(path.join(ROOT, name), { recursive: true, force: true });
for (const [docPath, data] of Object.entries(DOCS)) {
  const file = path.join(ROOT, 'db', `${docPath}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data)}\n`);
}
fs.mkdirSync(path.join(ROOT, '_blobs'), { recursive: true });
for (const file of Object.values(FILES)) fs.writeFileSync(path.join(ROOT, '_blobs', `${file.id}.csv`), file.text);
fs.writeFileSync(path.join(ROOT, '.gitignore'), "# Open Artifact: this machine's state, not the artifact.\n_agent/\nhistory/\n.artifact*\n.sharing.json\n*.log\n*.tmp\n.DS_Store\n");

/* ---- the demo: the agent's script and the replay ------------------------------------------------------------------ */

const set = (docPath, data) => ({ op: 'set', path: docPath, data });
const db = (...writes) => ({ kind: 'db', writes });
const gained = LATER.subscribers - BUILT.subscribers;
const second = LATER.ranked[1][0] === 'First Light';
if (!second) throw new Error(`First Light should be the second roast of the last week: ${JSON.stringify(LATER.ranked)}`);

const demo = {
  id: 'data',
  type: 'data',
  typeTitle: 'Data',
  title: 'Juniper Coffee subscriptions',
  source: 'website/playground/showcase/data',
  omit: ['_src/build.mjs', '_src/app.css', '_src/app.js', '_src/goal.js', '_src/comment.json'],
  agent: {
    name: 'Agent',
    thinkMs: 2500,
    responses: [
      {
        reply: {
          en: `Done. I ran the shop queries again, so the last two weeks of April are in. Launch week shows: ${int(LATER.subscribers)} active subscribers (${int(gained)} more than on April 13), MRR at ${kusd(LATER.mrr)}, and you are now ${int(LATER.gap)} ahead of the goal path. First Light is already the second most shipped roast.`,
          zh: `好了。我重新跑了一遍店铺的查询，4 月最后两周的订单已经进来。上新那一周很明显：活跃订阅 ${int(LATER.subscribers)} 人（比 4 月 13 日那周多 ${int(gained)} 人），MRR 到了 ${kusd(LATER.mrr)}，现在比目标线高出 ${int(LATER.gap)} 人。First Light 已经是出货量第二的豆子。`,
        },
        edits: [db(...Object.entries(SNAPSHOT_LATER).map(([docPath, data]) => set(docPath, data)))],
      },
      {
        reply: {
          en: 'Here is a first pass at “{{request}}”: I added a Spring goal bar under the figures and marked the First Light launch on the subscribers chart, so the jump has a date on it.',
          zh: '针对“{{request}}”先做了一版：在指标卡下面加了一条“春季目标”进度条，并在订阅曲线上标出了 First Light 的上新日，这样那次跳升就对得上日期了。',
        },
        edits: [db(set('files/goal.js', { text: read('goal.js') }), set('files/index.html', { text: page({ goal: true }) }))],
      },
      {
        reply: {
          en: 'I took “{{request}}” as a nudge on the look as well: the charts now lead with Juniper’s terracotta instead of forest green. Say the word and I will put the green back.',
          zh: '我把“{{request}}”也当成对外观的提醒：图表现在以 Juniper 的陶土色为主，不再是森林绿。想换回绿色，说一声就行。',
        },
        edits: [db(set('dash/look', LOOK_WARM))],
      },
    ],
  },
  replay: {
    prompt: {
      en: '/open-artifact data a subscriptions dashboard for Juniper Coffee from our shop database: subscribers, MRR, churn and bags by roast, against the goal in spring-goal.csv',
      zh: '/open-artifact data 用店铺数据库给 Juniper Coffee 做一个订阅看板：订阅人数、MRR、流失率和各款豆子的出货，对照 spring-goal.csv 里的目标',
    },
    steps: [
      { say: 'Read the data type’s guide', ms: 700, open: true },
      { say: 'Artifact · call upload plans.csv, roasts.csv, spring-goal.csv', ms: 700 },
      { say: 'ArtifactData · write dash/meta, dash/look, 6 datasets', take: ['db/dash/*', 'db/datasets/*', 'db/data/live*'], ms: 900 },
      // The styles, the script and the first page in one write (a page with files and no index.html says so); the last
      // pass takes the seed's own files, of which only index.html differs by then.
      {
        say: 'ArtifactData · write files/app.css, files/app.js, files/index.html',
        edits: [db(set('files/app.css', DOCS['files/app.css']), set('files/app.js', DOCS['files/app.js']), set('files/index.html', { text: page({ trend: false, roasts: false, tables: false }) }))],
        ms: 1300,
      },
      { say: 'ArtifactData · str_replace files/index.html · subscribers against the goal', edits: [db(set('files/index.html', { text: page({ roasts: false, tables: false }) }))], ms: 1000 },
      { say: 'ArtifactData · str_replace files/index.html · bags by roast', edits: [db(set('files/index.html', { text: page({ tables: false }) }))], ms: 900 },
      { say: 'ArtifactData · str_replace files/index.html · latest orders, plans', take: ['db/files/*'], ms: 900 },
      { say: 'Artifact · call check', ms: 800 },
    ],
    made: {
      en: `The dashboard is up: four key figures, subscribers against the spring goal, bags by roast, the latest orders and a plan filter. The shop queries run live on your computer; the three CSV files are stored with it. As of the week of April 13 you have ${int(BUILT.subscribers)} subscribers, ${int(-BUILT.gap)} behind the goal path.`,
      zh: `看板做好了：四个关键指标、订阅人数对照春季目标、各款豆子的出货、最新订单，还有一个套餐筛选。店铺查询在你的电脑上实时运行，三个 CSV 文件随看板一起保存。截至 4 月 13 日那周，订阅 ${int(BUILT.subscribers)} 人，比目标线少 ${int(-BUILT.gap)} 人。`,
    },
    comment: {
      text: {
        en: 'This stops at April 19. Pull in the late-April orders so launch week shows',
        zh: '这里只到 4 月 19 日。把 4 月下旬的订单也拉进来，我想看到上新那一周',
      },
      ...JSON.parse(read('comment.json')),
    },
  },
};
fs.writeFileSync(path.join(PLAYGROUND, 'demos', 'data.demo.json'), `${JSON.stringify(demo, null, 2)}\n`);

console.log(`weeks ${WEEKS[0]} to ${WEEKS.at(-1)}; built with ${BUILT_WEEKS}`);
const say = (name, f) => console.log(`${name}: ${int(f.subscribers)} subscribers, MRR ${kusd(f.mrr)}, churn ${pct(f.churn)}, order ${usd(f.order)}, gap ${f.gap}, roasts ${f.ranked.map(([r, n]) => `${r} ${n}`).join(', ')}`);
say('built', BUILT);
say('later', LATER);
