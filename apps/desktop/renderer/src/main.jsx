// The window's page starts here: it waits for the main process's first state (the page loads before the connection to
// the daemon is made, and the main process answers once it is ready), then draws.
import { createRoot } from 'react-dom/client';
import { App } from './App.jsx';

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function firstState() {
  let pushed = null;
  const stop = window.desktop.onState((state) => (pushed = state));
  try {
    for (;;) {
      if (pushed) return pushed;
      // null (or no answer yet): the main process is still connecting.
      const state = await window.desktop.state().catch(() => null);
      if (state) return state;
      await sleep(150);
    }
  } finally {
    stop();
  }
}

void firstState().then((initial) => {
  document.documentElement.dataset.theme = initial.look.theme;
  document.documentElement.dataset.platform = initial.look.platform;
  createRoot(document.getElementById('root')).render(<App initial={initial} />);
});
