/**
 * The OMP extension `omp-open-artifact` loads (`package.json` → `omp.extensions`). See `extension.ts`.
 */
import { openArtifact } from './extension.ts';

export { openArtifact, type OpenArtifactOmpOptions } from './extension.ts';

export default openArtifact();
