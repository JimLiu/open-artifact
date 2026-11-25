/**
 * The Pi extension `pi-open-artifact` loads (`package.json` → `pi.extensions`). See `extension.ts`.
 */
import { openArtifact } from './extension.ts';

export { openArtifact, type OpenArtifactPiOptions } from './extension.ts';

export default openArtifact();
