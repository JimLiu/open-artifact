window.jc = {
  int: d3.format(','),
  kusd: (v) => (Math.abs(v) >= 1000 ? `$${d3.format(',.1f')(v / 1000)}k` : d3.format('$,.0f')(v)),
  usd: d3.format('$,.2f'),
  pct: d3.format('.1%'),
  share: d3.format('.0%'),
  day: d3.utcFormat('%b %-d'),
  stamp: d3.utcFormat('%b %-d, %-I:%M %p'),
  week: (text) => new Date(`${text}T00:00:00Z`),
  ok: (source) => source.status === 'ok',
  /* The calcs below work every plan out, and all of them together under this name; the drawings show the one picked. */
  ALL: 'All plans',
  scope: () => dash.params().plan || 'All plans',
  scoped: (rows) => rows.filter((row) => row.plan === jc.scope()),
};

/* ---- what is worked out from the sources ---- */

dash.calc('totals', {
  title: 'Weekly totals',
  description: 'Each week for each plan, and summed over all of them beside the goal for that week.',
  inputs: ['subscriptions', 'goals'],
  fn: (subscriptions, goals) => {
    const goal = new Map(goals.map((row) => [row.week, Number(row.subscribers)]));
    const sum = (rows, key) => d3.sum(rows, (row) => Number(row[key]));
    const plans = [...new Set(subscriptions.map((row) => row.plan))];
    return ['All plans', ...plans].flatMap((plan) =>
      d3
        .rollups(subscriptions.filter((row) => plan === 'All plans' || row.plan === plan), (rows) => rows, (row) => String(row.week).slice(0, 10))
        .map(([week, rows]) => ({
          plan,
          week,
          subscribers: sum(rows, 'active'),
          new: sum(rows, 'new'),
          churned: sum(rows, 'churned'),
          mrr: sum(rows, 'mrr'),
          orders: sum(rows, 'orders'),
          revenue: sum(rows, 'revenue'),
          goal: plan === 'All plans' ? goal.get(week) ?? null : null,
        }))
        .sort((a, b) => d3.ascending(a.week, b.week)),
    );
  },
});

dash.calc('kpis', {
  title: 'Key figures',
  description: 'For each plan and for all of them: the latest week against four weeks earlier. Churn is cancellations over four weeks, as a share of the subscribers at their start. Average order is revenue over orders for four weeks.',
  inputs: ['totals'],
  fn: (totals) =>
    d3.groups(totals, (row) => row.plan).flatMap(([plan, weeks]) => {
      if (weeks.length < 9) return [];
      const last = weeks.at(-1);
      const before = weeks.at(-5);
      const recent = weeks.slice(-4);
      const prior = weeks.slice(-8, -4);
      const sum = (rows, key) => d3.sum(rows, (row) => row[key]);
      const churn = sum(recent, 'churned') / before.subscribers;
      const churnBefore = sum(prior, 'churned') / weeks.at(-9).subscribers;
      const order = sum(recent, 'revenue') / sum(recent, 'orders');
      const orderBefore = sum(prior, 'revenue') / sum(prior, 'orders');
      return [
        { plan, metric: 'subscribers', value: last.subscribers, before: before.subscribers, change: last.subscribers / before.subscribers - 1 },
        { plan, metric: 'mrr', value: last.mrr, before: before.mrr, change: last.mrr / before.mrr - 1 },
        { plan, metric: 'churn', value: churn, before: churnBefore, change: (churn - churnBefore) * 100 },
        { plan, metric: 'order', value: order, before: orderBefore, change: order / orderBefore - 1 },
      ];
    }),
});

dash.calc('standing', {
  title: 'Where subscribers stand',
  description: 'For each plan and for all of them: subscribers gained since the first week shown, and for all plans the latest week less the goal for that week (goal_gap; below zero is behind). gained_by and gap_by are the same without their sign, beside the word for it.',
  inputs: ['totals'],
  fn: (totals) =>
    d3.groups(totals, (row) => row.plan).map(([plan, weeks]) => {
      const last = weeks.at(-1);
      const gained = last.subscribers - weeks[0].subscribers;
      const gap = last.goal === null ? null : last.subscribers - last.goal;
      return {
        plan,
        week: last.week,
        first_week: weeks[0].week,
        gained,
        gained_by: Math.abs(gained),
        direction: gained < 0 ? 'down' : 'up',
        goal_gap: gap,
        gap_by: gap === null ? null : Math.abs(gap),
        side: gap === null ? null : gap < 0 ? 'behind' : 'ahead of',
      };
    }),
});

dash.calc('roast_week', {
  title: 'Bags by roast, latest week',
  description: 'For each plan and for all of them: bags shipped in the latest week by roast, beside the week before and the roast’s catalog entry.',
  inputs: ['roast_bags', 'roast_catalog'],
  fn: (roast_bags, roast_catalog) => {
    const all = roast_bags.map((row) => ({ ...row, week: String(row.week).slice(0, 10) }));
    const weeks = [...new Set(all.map((row) => row.week))].sort();
    const latest = weeks.at(-1);
    const previous = weeks.at(-2);
    const catalog = new Map(roast_catalog.map((row) => [row.roast, row]));
    const plans = [...new Set(all.map((row) => row.plan))];
    return ['All plans', ...plans].flatMap((plan) => {
      const rows = all.filter((row) => plan === 'All plans' || row.plan === plan);
      const bags = (week) => d3.rollup(rows.filter((row) => row.week === week), (found) => d3.sum(found, (row) => Number(row.bags)), (row) => row.roast);
      const now = bags(latest);
      const then = bags(previous);
      const total = d3.sum(now.values());
      return [...now]
        .map(([roast, count]) => ({
          plan,
          roast,
          week: latest,
          bags: count,
          share: total ? count / total : 0,
          week_before: then.get(roast) ?? null,
          origin: catalog.get(roast)?.origin ?? '',
          level: catalog.get(roast)?.level ?? '',
          seasonal: catalog.get(roast)?.seasonal === 'yes',
        }))
        .sort((a, b) => d3.descending(a.bags, b.bags));
    });
  },
});

dash.calc('plan_mix', {
  title: 'Subscribers by plan',
  description: 'Active subscribers in the latest week by plan, beside the plan’s price.',
  inputs: ['subscriptions', 'plans'],
  fn: (subscriptions, plans) => {
    const latest = d3.max(subscriptions, (row) => String(row.week).slice(0, 10));
    const rows = subscriptions.filter((row) => String(row.week).slice(0, 10) === latest);
    const total = d3.sum(rows, (row) => Number(row.active));
    return plans.map((plan) => {
      const active = d3.sum(rows.filter((row) => row.plan === plan.plan), (row) => Number(row.active));
      return { plan: plan.plan, price: Number(plan.price_per_month), ships: plan.ships, subscribers: active, share: total ? active / total : 0 };
    });
  },
});

/* ---- the filter ---- */

dash.draw('plan-filter', (select) => {
  const plans = dash.data('plans');
  select.replaceChildren(new Option('All plans', ''), ...(jc.ok(plans) ? plans.data : []).map((row) => new Option(row.plan)));
  select.value = dash.params().plan ?? '';
  select.onchange = () => dash.setParams({ plan: select.value });
});

dash.onData(() => {
  const picked = Boolean(dash.params().plan);
  for (const part of document.querySelectorAll('.jc [data-all-plans]')) part.hidden = picked;
});

/* ---- the sentence and the tiles ---- */

jc.kpi = (metric) => {
  const source = dash.data('kpis');
  return jc.ok(source) ? jc.scoped(source.data).find((row) => row.metric === metric) ?? null : null;
};
jc.text = (read) => (el) => {
  const text = read();
  el.classList.toggle('dash-skeleton', text === undefined);
  el.textContent = text ?? '—';
};
jc.totals = () => {
  const source = dash.data('totals');
  if (source.status === 'loading') return undefined;
  const rows = jc.ok(source) ? jc.scoped(source.data) : [];
  return rows.length ? rows : null;
};
jc.value = (id) => {
  const source = dash.data(id);
  if (source.status === 'loading') return undefined;
  return jc.ok(source) ? source.data : null;
};
/* The picked plan's row of `standing`: undefined while it loads, null when there is none. */
jc.standing = (field) => {
  const rows = jc.value('standing');
  if (!rows) return rows;
  return jc.scoped(rows)[0]?.[field] ?? null;
};

dash.draw('lede-week', jc.text(() => {
  const rows = jc.totals();
  return rows && jc.day(jc.week(rows.at(-1).week));
}));
dash.draw('lede-first', jc.text(() => {
  const rows = jc.totals();
  return rows && jc.day(jc.week(rows[0].week));
}));
dash.draw('lede-subscribers', jc.text(() => {
  const rows = jc.totals();
  return rows && jc.int(rows.at(-1).subscribers);
}));
dash.draw('lede-growth', jc.text(() => {
  const gained = jc.standing('gained_by');
  return typeof gained === 'number' ? jc.int(gained) : gained;
}));
dash.draw('lede-direction', jc.text(() => jc.standing('direction')));
dash.draw('lede-gap', jc.text(() => {
  const gap = jc.standing('gap_by');
  return typeof gap === 'number' ? jc.int(gap) : gap;
}));
dash.draw('lede-side', (el) => {
  const side = jc.standing('side');
  el.textContent = side ?? '—';
  el.classList.toggle('jc-up', side === 'ahead of');
  el.classList.toggle('jc-down', side === 'behind');
});
dash.draw('lede-goal', jc.text(() => {
  const goals = dash.data('goals');
  if (goals.status === 'loading') return undefined;
  return jc.ok(goals) && goals.data.length ? jc.int(Number(goals.data.at(-1).subscribers)) : null;
}));
dash.draw('lede-goal-day', jc.text(() => {
  const goals = dash.data('goals');
  if (goals.status === 'loading') return undefined;
  return jc.ok(goals) && goals.data.length ? jc.day(jc.week(goals.data.at(-1).week)) : null;
}));

jc.figure = (metric, format) => (el) => {
  const loading = dash.data('kpis').status === 'loading';
  const row = jc.kpi(metric);
  el.classList.toggle('dash-skeleton', loading);
  el.textContent = row ? format(row.value) : '—';
};
jc.change = (metric, { points = false, lowerIsBetter = false } = {}) => (el) => {
  const row = jc.kpi(metric);
  if (!row || !Number.isFinite(row.change)) {
    el.textContent = '—';
    el.classList.remove('jc-up', 'jc-down');
    return;
  }
  const size = Math.abs(row.change);
  const flat = points ? size < 0.05 : size < 0.0005;
  el.textContent = `${flat ? '' : row.change > 0 ? '▲ ' : '▼ '}${points ? `${d3.format('.1f')(size)} pt` : jc.pct(size)}`;
  const good = lowerIsBetter ? row.change < 0 : row.change > 0;
  el.classList.toggle('jc-up', !flat && good);
  el.classList.toggle('jc-down', !flat && !good);
};
dash.draw('kpi-subscribers', jc.figure('subscribers', jc.int));
dash.draw('delta-subscribers', jc.change('subscribers'));
dash.draw('kpi-mrr', jc.figure('mrr', jc.kusd));
dash.draw('delta-mrr', jc.change('mrr'));
dash.draw('kpi-churn', jc.figure('churn', jc.pct));
dash.draw('delta-churn', jc.change('churn', { points: true, lowerIsBetter: true }));
dash.draw('kpi-order', jc.figure('order', jc.usd));
dash.draw('delta-order', jc.change('order'));

jc.spark = (read) => (el) => {
  const rows = jc.totals();
  el.replaceChildren();
  if (!rows) return;
  const values = read(rows).filter((value) => Number.isFinite(value));
  if (values.length < 2) return;
  const width = el.clientWidth || 56;
  const height = el.clientHeight || 26;
  const x = d3.scaleLinear().domain([0, values.length - 1]).range([2, width - 4]);
  const y = d3.scaleLinear().domain(d3.extent(values)).range([height - 3, 3]);
  const svg = d3.select(el).append('svg').attr('width', width).attr('height', height).attr('aria-hidden', 'true');
  svg.append('path').attr('d', d3.line().x((_, i) => x(i)).y((value) => y(value))(values)).attr('fill', 'none').style('stroke', dash.colors[0]).attr('stroke-width', 1.5).attr('stroke-linejoin', 'round').attr('opacity', 0.75);
  svg.append('circle').attr('cx', x(values.length - 1)).attr('cy', y(values.at(-1))).attr('r', 2.5).style('fill', dash.colors[3]);
};
jc.rolling = (rows, read) => rows.map((_, i) => (i < 4 ? NaN : read(rows.slice(i - 3, i + 1), rows[i - 4])));
dash.draw('spark-subscribers', jc.spark((rows) => rows.map((row) => row.subscribers)));
dash.draw('spark-mrr', jc.spark((rows) => rows.map((row) => row.mrr)));
dash.draw('spark-churn', jc.spark((rows) => jc.rolling(rows, (recent, base) => d3.sum(recent, (row) => row.churned) / base.subscribers)));
dash.draw('spark-order', jc.spark((rows) => jc.rolling(rows, (recent) => d3.sum(recent, (row) => row.revenue) / d3.sum(recent, (row) => row.orders))));

/* ---- subscribers against the goal ---- */

dash.draw('trend', (el) => {
  const source = dash.data('totals');
  const goals = dash.data('goals');
  el.classList.toggle('dash-skeleton', source.status === 'loading');
  el.replaceChildren();
  if (source.status === 'loading') return;
  const picked = jc.ok(source) ? jc.scoped(source.data) : [];
  if (!picked.length) {
    el.textContent = source.status === 'error' ? 'Failed to load' : '—';
    return;
  }
  const rows = picked.map((row) => ({ ...row, at: jc.week(row.week) }));
  const withGoal = rows.some((row) => row.goal !== null) && jc.ok(goals);
  const path = withGoal ? goals.data.map((row) => ({ at: jc.week(row.week), goal: Number(row.subscribers) })) : [];
  const last = rows.at(-1);
  const width = el.clientWidth || 560;
  const height = 188;
  const svg = d3.select(el).append('svg').attr('width', width).attr('height', height).attr('role', 'img')
    .attr('aria-label', `Active subscribers by week, from ${jc.int(rows[0].subscribers)} in the week of ${jc.day(rows[0].at)} to ${jc.int(last.subscribers)} in the week of ${jc.day(last.at)}${withGoal ? `, against a goal path that reaches ${jc.int(path.at(-1).goal)} on ${jc.day(path.at(-1).at)}` : ''}.`);

  const values = [...rows.map((row) => row.subscribers), ...path.map((row) => row.goal)];
  const y = d3.scaleLinear().domain(d3.extent(values)).nice(4).range([height - 26, 20]);
  const ticks = y.ticks(4);
  const probe = svg.append('g').attr('class', 'jc-axis');
  const tickWidth = d3.max(ticks, (tick) => probe.append('text').text(jc.int(tick)).node().getComputedTextLength()) ?? 30;
  const endText = probe.append('text').attr('class', 'jc-endlabel').text(jc.int(last.subscribers));
  const goalText = withGoal ? probe.append('text').attr('class', 'jc-goallabel').text(`Goal ${jc.int(path.at(-1).goal)}`) : null;
  const endWidth = Math.max(endText.node().getComputedTextLength(), goalText ? goalText.node().getComputedTextLength() : 0);
  probe.remove();
  const left = Math.ceil(tickWidth) + 10;
  const right = withGoal ? 12 : Math.ceil(endWidth) + 14;
  const x = d3.scaleUtc().domain([rows[0].at, withGoal ? path.at(-1).at : last.at]).range([left, width - right]);

  svg.append('g').selectAll('line').data(ticks).join('line').attr('class', 'jc-gridline').attr('x1', left).attr('x2', width - right).attr('y1', (tick) => y(tick)).attr('y2', (tick) => y(tick));
  svg.append('g').attr('class', 'jc-axis').selectAll('text').data(ticks).join('text').attr('x', left - 8).attr('y', (tick) => y(tick)).attr('dy', '0.32em').attr('text-anchor', 'end').text((tick) => jc.int(tick));
  const span = x.domain()[1] - x.domain()[0];
  const every = Math.max(1, Math.ceil(span / 6048e5 / Math.max(2, Math.floor((width - left - right) / 78))));
  const dates = d3.utcMonday.range(x.domain()[0], new Date(+x.domain()[1] + 1), every);
  svg.append('g').attr('class', 'jc-axis').selectAll('text').data(dates).join('text').attr('x', (date) => x(date)).attr('y', height - 6).attr('text-anchor', (date, i) => (i === 0 ? 'start' : x(date) > width - right - 20 ? 'end' : 'middle')).text((date) => jc.day(date));

  const mark = el.dataset.markWeek ? jc.week(el.dataset.markWeek) : null;
  if (mark && mark >= x.domain()[0] && mark <= last.at) {
    const g = svg.append('g');
    g.append('line').attr('x1', x(mark)).attr('x2', x(mark)).attr('y1', 20).attr('y2', height - 26).style('stroke', dash.colors[3]).attr('stroke-width', 1.5);
    g.append('text').attr('class', 'jc-marklabel').attr('x', x(mark) - 6).attr('y', 30).attr('text-anchor', 'end').text(el.dataset.markLabel ?? '');
  }

  if (withGoal) {
    svg.append('path').attr('d', d3.line().x((row) => x(row.at)).y((row) => y(row.goal))(path)).attr('fill', 'none').style('stroke', 'var(--dash-chart-reference)').attr('stroke-width', 1.5).attr('stroke-dasharray', '4 4');
    const end = path.at(-1);
    svg.append('text').attr('class', 'jc-goallabel').attr('x', x(end.at)).attr('y', y(end.goal) - 8).attr('text-anchor', 'end').text(`Goal ${jc.int(end.goal)}`);
  }
  svg.append('path').attr('d', d3.line().x((row) => x(row.at)).y((row) => y(row.subscribers))(rows)).attr('fill', 'none').style('stroke', dash.colors[0]).attr('stroke-width', 2.25).attr('stroke-linejoin', 'round').attr('stroke-linecap', 'round');
  svg.append('g').selectAll('circle').data(rows.slice(0, -1)).join('circle').attr('cx', (row) => x(row.at)).attr('cy', (row) => y(row.subscribers)).attr('r', 2.25).style('fill', dash.colors[0]);
  svg.append('circle').attr('cx', x(last.at)).attr('cy', y(last.subscribers)).attr('r', 4.5).style('fill', dash.colors[3]).style('stroke', 'var(--color-panel)').attr('stroke-width', 2);
  const labelAbove = !withGoal || last.goal === null || last.subscribers >= last.goal;
  svg.append('text').attr('class', 'jc-endlabel').attr('x', withGoal ? x(last.at) + 8 : x(last.at) + 9).attr('y', y(last.subscribers) + (withGoal ? (labelAbove ? -9 : 17) : 4)).attr('text-anchor', withGoal ? 'middle' : 'start').text(jc.int(last.subscribers));

  const rule = svg.append('line').attr('y1', 20).attr('y2', height - 26).style('stroke', 'var(--dash-chart-axis)').attr('stroke-width', 1).attr('visibility', 'hidden');
  const dot = svg.append('circle').attr('r', 4).style('fill', dash.colors[0]).style('stroke', 'var(--color-panel)').attr('stroke-width', 2).attr('visibility', 'hidden');
  const tip = document.createElement('div');
  tip.className = 'jc-tip';
  tip.hidden = true;
  el.append(tip);
  const line = (label, value) => {
    const row = document.createElement('span');
    const figure = document.createElement('em');
    figure.textContent = value;
    row.append(label, figure);
    return row;
  };
  svg.on('pointermove', (event) => {
    const [px] = d3.pointer(event, el);
    const row = d3.least(rows, (candidate) => Math.abs(x(candidate.at) - px));
    rule.attr('x1', x(row.at)).attr('x2', x(row.at)).attr('visibility', 'visible');
    dot.attr('cx', x(row.at)).attr('cy', y(row.subscribers)).attr('visibility', 'visible');
    const head = document.createElement('b');
    head.textContent = `Week of ${jc.day(row.at)}`;
    tip.replaceChildren(head, line('Subscribers', jc.int(row.subscribers)), ...(row.goal !== null ? [line('Goal path', jc.int(row.goal))] : []), line('New', `+${jc.int(row.new)}`), line('Cancelled', `−${jc.int(row.churned)}`));
    tip.hidden = false;
    const at = x(row.at) + 14;
    tip.style.left = `${at + tip.offsetWidth > width ? Math.max(0, x(row.at) - 14 - tip.offsetWidth) : at}px`;
    tip.style.top = `${Math.max(0, Math.min(y(row.subscribers) - 20, height - tip.offsetHeight))}px`;
  }).on('pointerleave', () => {
    tip.hidden = true;
    rule.attr('visibility', 'hidden');
    dot.attr('visibility', 'hidden');
  });
});

dash.draw('flow-new', jc.text(() => {
  const rows = jc.totals();
  return rows && jc.int(rows.at(-1).new);
}));
dash.draw('flow-cancelled', jc.text(() => {
  const rows = jc.totals();
  return rows && jc.int(rows.at(-1).churned);
}));

/* ---- roasts ---- */

dash.draw('roast-week', jc.text(() => {
  const rows = jc.value('roast_week');
  return rows === undefined ? undefined : rows && rows.length ? jc.day(jc.week(rows[0].week)) : null;
}));

dash.draw('roasts', (el) => {
  const source = dash.data('roast_week');
  el.classList.toggle('dash-skeleton', source.status === 'loading');
  el.replaceChildren();
  if (source.status === 'loading') return;
  const rows = jc.ok(source) ? jc.scoped(source.data) : [];
  if (!rows.length) {
    el.textContent = source.status === 'error' ? 'Failed to load' : '—';
    return;
  }
  const most = d3.max(rows, (row) => Math.max(row.bags, row.week_before ?? 0)) || 1;
  const tip = document.createElement('div');
  tip.className = 'jc-tip';
  tip.hidden = true;
  for (const row of rows) {
    const bar = document.createElement('div');
    bar.className = 'jc-bar';
    if (row.seasonal) bar.dataset.seasonal = '';
    const name = document.createElement('span');
    name.className = 'jc-bar-name';
    name.textContent = row.roast;
    if (row.week_before === null || row.seasonal) {
      const badge = document.createElement('small');
      badge.textContent = row.week_before === null ? 'New' : 'Seasonal';
      name.append(badge);
    }
    const value = document.createElement('span');
    value.className = 'jc-bar-val';
    value.textContent = jc.int(row.bags);
    const share = document.createElement('small');
    share.textContent = jc.share(row.share);
    value.append(share);
    const track = document.createElement('span');
    track.className = 'jc-bar-track';
    const fill = document.createElement('span');
    fill.className = 'jc-bar-fill';
    fill.style.width = `${(row.bags / most) * 100}%`;
    track.append(fill);
    if (row.week_before !== null) {
      const tick = document.createElement('span');
      tick.className = 'jc-bar-tick';
      tick.style.left = `calc(${(row.week_before / most) * 100}% - 1px)`;
      track.append(tick);
    }
    bar.append(name, value, track);
    bar.addEventListener('pointerenter', () => {
      const head = document.createElement('b');
      head.textContent = row.roast;
      const about = document.createElement('span');
      about.textContent = [row.origin, row.level].filter(Boolean).join(' · ');
      const line = (label, text) => {
        const part = document.createElement('span');
        const figure = document.createElement('em');
        figure.textContent = text;
        part.append(label, figure);
        return part;
      };
      tip.replaceChildren(head, about, line('Bags', jc.int(row.bags)), line('Week before', row.week_before === null ? 'not on sale' : jc.int(row.week_before)), line('Share', jc.pct(row.share)));
      tip.hidden = false;
      tip.style.left = '0px';
      tip.style.top = `${Math.min(bar.offsetTop + bar.offsetHeight + 4, Math.max(0, el.offsetHeight - tip.offsetHeight))}px`;
    });
    bar.addEventListener('pointerleave', () => { tip.hidden = true; });
    el.append(bar);
  }
  el.append(tip);
});

/* ---- tables ---- */

dash.draw('orders-rows', (body) => {
  const source = dash.data('orders');
  body.replaceChildren();
  if (!jc.ok(source)) return;
  const plan = dash.params().plan || '';
  const rows = source.data.filter((row) => !plan || row.plan === plan);
  const cell = (text, name) => {
    const td = document.createElement('td');
    if (name) td.className = name;
    td.textContent = text;
    return td;
  };
  for (const row of rows) {
    const tr = document.createElement('tr');
    tr.dataset.key = row.order_no;
    const status = document.createElement('td');
    const pill = document.createElement('span');
    pill.className = 'jc-pill';
    pill.dataset.status = row.status;
    pill.textContent = row.status;
    status.append(pill);
    tr.append(cell(row.order_no), cell(jc.stamp(new Date(row.placed_at)), 'jc-quiet'), cell(row.plan), cell(row.roast), cell(String(row.bags), 'jc-num'), cell(jc.usd(Number(row.total)), 'jc-num'), status);
    body.append(tr);
  }
  if (!rows.length) {
    const tr = document.createElement('tr');
    const td = cell(`None of the latest ${source.data.length} orders is on this plan.`, 'jc-empty');
    td.colSpan = 7;
    tr.append(td);
    body.append(tr);
  }
});

dash.draw('plan-rows', (body) => {
  const source = dash.data('plan_mix');
  body.replaceChildren();
  if (!jc.ok(source)) return;
  const picked = dash.params().plan || '';
  for (const row of source.data) {
    const tr = document.createElement('tr');
    tr.dataset.key = row.plan;
    tr.tabIndex = 0;
    tr.setAttribute('aria-selected', String(picked === row.plan));
    const plan = document.createElement('td');
    plan.textContent = row.plan;
    const ships = document.createElement('small');
    ships.textContent = row.ships;
    plan.append(ships);
    const price = document.createElement('td');
    price.className = 'jc-num';
    price.textContent = d3.format('$,.0f')(row.price);
    const subscribers = document.createElement('td');
    subscribers.className = 'jc-num';
    subscribers.textContent = jc.int(row.subscribers);
    const share = document.createElement('td');
    share.className = 'jc-num';
    const meter = document.createElement('span');
    meter.className = 'jc-share';
    const fill = document.createElement('i');
    fill.style.width = `${row.share * 100}%`;
    meter.append(fill);
    share.append(meter, jc.share(row.share));
    tr.append(plan, price, subscribers, share);
    const pick = () => dash.setParams({ plan: picked === row.plan ? '' : row.plan });
    tr.addEventListener('click', pick);
    tr.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        pick();
      }
    });
    body.append(tr);
  }
});
