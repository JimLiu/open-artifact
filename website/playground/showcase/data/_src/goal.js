/* The Spring goal bar: how far the latest week is along the way to the goal. */

dash.calc('goal_progress', {
  title: 'Progress to the spring goal',
  description: 'Active subscribers in the latest week, on every plan, as a share of the goal the path ends at.',
  inputs: ['subscriptions', 'goals'],
  fn: (subscriptions, goals) => {
    const latest = d3.max(subscriptions, (row) => String(row.week).slice(0, 10));
    const active = d3.sum(subscriptions.filter((row) => String(row.week).slice(0, 10) === latest), (row) => Number(row.active));
    const goal = Number(goals.at(-1)?.subscribers);
    return goal ? active / goal : null;
  },
});

dash.draw('goal-now', jc.text(() => {
  const totals = jc.value('totals');
  if (!totals) return totals;
  const last = totals.filter((row) => row.plan === jc.ALL).at(-1);
  return last ? jc.int(last.subscribers) : null;
}));
dash.draw('goal-progress', jc.text(() => {
  const progress = jc.value('goal_progress');
  return progress === undefined || progress === null ? progress : jc.share(progress);
}));
dash.draw('goal-meter', (el) => {
  const progress = jc.value('goal_progress');
  const fill = document.createElement('i');
  fill.style.width = `${Math.max(0, Math.min(1, progress ?? 0)) * 100}%`;
  el.replaceChildren(fill);
});
