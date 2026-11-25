/**
 * The app's entry (bundled into out/main.mjs): an artifact installed as an app carries
 * `Contents/Resources/artifact-app.json` in its package and runs as that one artifact's app (`artifact-app.mjs`);
 * any other start, the desktop app's own package and every development run, is the desktop app (`main.mjs`), as it
 * always was. Both are bundled in; only the one chosen runs.
 */
import { app } from 'electron';
import { readArtifactApp } from './profile.mjs';

const found = readArtifactApp(process.resourcesPath, { packaged: app.isPackaged });
if (found) void import('./artifact-app.mjs').then((artifactApp) => artifactApp.run(found));
else void import('./main.mjs');
