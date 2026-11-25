import type { DesktopBridge, ArtifactAppBridge, NoticeBridge } from '../src/contracts.ts';
declare global {
  interface Window {
    desktop: DesktopBridge;
    artifactApp: ArtifactAppBridge;
    notice: NoticeBridge;
  }
}
