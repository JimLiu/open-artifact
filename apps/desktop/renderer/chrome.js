// The window's bar: the first tab (the app's own, the home page later) and one tab per open artifact, with a mark
// while something is not saved, and the connection's state. Everything goes through `window.desktop` (preload.cjs).
const tabsEl = document.getElementById('tabs');
const connectionEl = document.getElementById('connection');
const placeholder = document.getElementById('placeholder');
const bridge = window.desktop; // not `desktop`: the preload's global cannot be declared over

const STATUS = { opening: 'Opening…', loading: '', ready: '', reconnecting: 'Reconnecting…', stale: 'Reload to reconnect', crashed: 'Crashed' };

function tabButton({ id, title, selected, unsaved, status, closable }) {
  const tab = document.createElement('div');
  tab.className = 'tab';
  tab.setAttribute('role', 'tab');
  tab.setAttribute('aria-selected', String(selected));
  tab.dataset.tab = id;
  tab.dataset.unsaved = String(!!unsaved);
  if (status) tab.dataset.status = status;
  tab.tabIndex = 0;
  tab.addEventListener('click', () => void bridge.select(id));
  const label = document.createElement('span');
  label.className = 'title';
  label.textContent = title;
  tab.append(label);
  if (unsaved) {
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.title = 'Not saved yet';
    dot.dataset.testid = 'unsaved';
    tab.append(dot);
  }
  if (status && STATUS[status]) {
    const state = document.createElement('span');
    state.className = 'state';
    state.textContent = STATUS[status];
    if (status === 'stale') {
      state.setAttribute('role', 'button');
      state.addEventListener('click', (event) => {
        event.stopPropagation();
        void bridge.reload(id);
      });
    }
    tab.append(state);
  }
  if (closable) {
    const close = document.createElement('button');
    close.className = 'close';
    close.setAttribute('aria-label', `Close ${title}`);
    close.textContent = '×';
    close.addEventListener('click', (event) => {
      event.stopPropagation();
      void bridge.close(id);
    });
    tab.append(close);
  }
  return tab;
}

function render(state) {
  tabsEl.replaceChildren(
    tabButton({ id: 'home', title: 'Home', selected: state.current === 'home', closable: false }),
    ...state.tabs.map((tab) => tabButton({ id: tab.id, title: tab.title, selected: state.current === tab.id, unsaved: tab.unsaved, status: tab.status, closable: true })),
  );
  connectionEl.textContent = state.connected ? '' : 'Reconnecting to Open Artifact…';
  connectionEl.dataset.connected = String(state.connected);
  placeholder.hidden = state.current !== 'home';
  document.title = state.current === 'home' ? 'Open Artifact' : `${state.tabs.find((t) => t.id === state.current)?.title ?? ''} — Open Artifact`;
}

bridge.onState(render);
void bridge.state().then(render);
