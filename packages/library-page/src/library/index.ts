/**
 * `@open-artifact/library-page/library`: what a host's server and the library page share, with no DOM or React in it.
 * The shapes the page reads (routes.ts), the Library API's answers made into them (shape.ts), the release notes read
 * out of CHANGELOG.md (changelog.ts), and how each type's thumbnail is taken (capture.ts).
 */
export { isNewer, latestOf, type ArtifactList, type DeleteAnswer, type OpenAnswer, type PageArtifact, type TypeTile } from './routes.ts';
export { artifactList, deleteAnswer, openAnswer, pageView, thumbnailStamp, typeTiles } from './shape.ts';
export { inlinePieces, parseChangelog, releasesBetween, type ChangelogAnswer, type Inline, type ReleaseNotes } from './changelog.ts';
export { captureRecipe, type CaptureRecipe } from './capture.ts';
