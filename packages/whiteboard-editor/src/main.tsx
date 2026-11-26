/** Entry point of the Whiteboard editor page. */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster, TooltipProvider } from '@open-artifact/ui';
import { App } from './App.tsx';
import { guardComposingKeys } from './lib/composing-keys.ts';
import { holdShellCover } from './services/boot.ts';
import { prepareBoardLoad } from './services/load-recovery.ts';
import { dropLegacyKeys } from './services/storage-scope.ts';
import './styles.css';

holdShellCover();
guardComposingKeys(window, (target) => target instanceof Element && target.closest('.wb-edit') !== null);
dropLegacyKeys();
void prepareBoardLoad().then(() => createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TooltipProvider>
      <App />
      <Toaster />
    </TooltipProvider>
  </StrictMode>,
));
