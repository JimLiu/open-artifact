/**
 * The playground's Shell page (`<demo>/index.html`, or `demo.html?type=<demo>`): the real Shell from `packages/shell`, booted the way a type
 * server boots its own Shell (`typeServer`, the owner), with its capability broker pointed at the in-memory
 * {@link createDemoArtifact} backend instead of the type server's HTTP API. The editor is the prebuilt bundle from
 * `dist/server/editors/<type>/`, served at `editors/<type>/` and framed unchanged: its `window.openartifact` talks to
 * this Shell by postMessage (`?open_artifact_shell=`), and this Shell answers from memory. The page demo frames
 * frame-host's inner shell instead (`page-shell.html`, `src/page-frame/`), which answers from the same artifact.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type { ShellBoot } from '@open-artifact/protocol';
import { Toaster, TooltipProvider } from '@open-artifact/ui';
import { locale } from '../../../../packages/shell/src/lib/i18n.ts';
import { loadBoot } from '../../../../packages/shell/src/shell/actions.ts';
import { App } from '../../../../packages/shell/src/shell/App.tsx';
import { resetBroker } from '../../../../packages/shell/src/shell/broker.ts';
import '../../../../packages/shell/src/styles.css';
import { createDemoArtifact, type DemoArtifact } from '../provider/demo-provider.ts';
import { playgroundRoot } from '../root.ts';
import { startSeed } from '../replay/plan.ts';
import { loadSeed } from '../seeds/manifest.ts';

declare global {
  interface Window {
    __OPEN_ARTIFACT_BOOT__?: ShellBoot | null;
    /** The demo's backend, for the console and the verification script. */
    __PLAYGROUND__?: DemoArtifact;
  }
}

/** The boot a type server injects into its own Shell, for the demo artifact. */
function bootOf(demo: DemoArtifact, type: string, typeTitle: string): ShellBoot {
  // A page artifact has no editor: frame-host's inner shell frames its own index.html (`page-shell.html`).
  const path = type === 'page' ? 'page-shell.html' : `editors/${type}/index.html`;
  const page = new URL(path, playgroundRoot()).href;
  return {
    id: demo.store.id,
    type,
    typeTitle,
    title: demo.store.title,
    root: '',
    page,
    pageUrl: page,
    url: `open-artifact://artifact/${demo.store.id}`,
    pageKind: null,
    problem: null,
    empty: false,
    prompt: null,
    owner: null,
    userName: 'You',
    agentName: 'Agent',
    version: 'playground',
    // The type server's own Shell: no daemon library, no Ask pane, sharing "only on this computer".
    typeServer: { role: 'owner' },
  };
}

async function start(): Promise<void> {
  // A demo's own page (`<demo>/`) names it on <html>; `demo.html` takes `?type=`.
  const id = document.documentElement.dataset.demo ?? new URLSearchParams(location.search).get('type') ?? 'whiteboard';
  const seed = await loadSeed(id);
  const root = document.getElementById('root')!;
  // `?replay=1` plays the demo's replay first (`replay=hold`: once the framing page says so); not for someone who asked
  // for less motion, who gets the finished artifact.
  const mode = new URLSearchParams(location.search).get('replay');
  const replay = !!seed?.replay && (mode === '1' || mode === 'hold') && !matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!seed) {
    window.__OPEN_ARTIFACT_BOOT__ = null;
    document.title = 'No such demo';
  } else {
    const demo = await createDemoArtifact(seed, replay ? startSeed : undefined);
    demo.agent.lang = document.documentElement.dataset.lang === 'zh' ? 'zh' : 'en';
    window.__PLAYGROUND__ = demo;
    if (replay) {
      // Around the Shell's root before the Shell renders: a frame that moves loads again.
      const { startReplay } = await import('../replay/replay.ts');
      void startReplay(demo, root, { hold: mode === 'hold' });
    }
    // Every framed page's backend is the demo artifact, whatever base the page names.
    resetBroker(() => demo.provider);
    window.__OPEN_ARTIFACT_BOOT__ = bootOf(demo, seed.type, seed.typeTitle);
    document.title = demo.store.title;
  }
  document.documentElement.lang = locale;
  void loadBoot();
  createRoot(root).render(
    <StrictMode>
      <TooltipProvider>
        <Toaster>
          <App />
        </Toaster>
      </TooltipProvider>
    </StrictMode>,
  );
}

void start();
