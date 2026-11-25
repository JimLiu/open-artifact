// The status page of an artifact installed as an app. It draws what the main process sends (`artifactApp.onState`):
// `{ status, busy, title, body, actions: [{ id, label, primary }], ask: { id, title, body, yes, cancel } | null, lang }`;
// every word is the main process's, in the language this run speaks. A button runs `artifactApp.act(id)`.
(() => {
  const bridge = window.artifactApp;
  const $ = (id) => document.querySelector(`[data-testid="${id}"]`);
  const status = $('status');
  const ask = $('ask');
  let asking = null;
  const draw = (view) => {
    if (!view) return;
    document.documentElement.lang = view.lang || 'en';
    status.dataset.status = view.status;
    if (view.busy) status.dataset.busy = '';
    else delete status.dataset.busy;
    $('status-title').textContent = view.title || '';
    $('status-body').textContent = view.body || '';
    const actions = $('status-actions');
    actions.replaceChildren(
      ...(view.actions || []).map((action) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = action.label;
        button.dataset.testid = `action-${action.id}`;
        if (action.primary) button.className = 'primary';
        button.addEventListener('click', () => void bridge.act(action.id));
        return button;
      }),
    );
    asking = view.ask || null;
    ask.hidden = !asking;
    if (asking) {
      $('ask-title').textContent = asking.title;
      $('ask-body').textContent = asking.body;
      $('ask-yes').textContent = asking.yes;
      $('ask-cancel').textContent = asking.cancel;
      $('ask-cancel').focus();
    }
  };
  $('ask-yes').addEventListener('click', () => asking && void bridge.answer(asking.id, true));
  $('ask-cancel').addEventListener('click', () => asking && void bridge.answer(asking.id, false));
  document.addEventListener('keydown', (event) => {
    if (asking && event.key === 'Escape') void bridge.answer(asking.id, false);
  });
  bridge.onState(draw);
  void bridge.state().then(draw);
})();
