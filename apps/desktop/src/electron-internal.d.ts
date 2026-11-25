import 'electron';
/** Electron's runtime inspection method, used only by test-only handlers. */
declare global {
  namespace Electron {
    interface WebContents {
      getLastWebPreferences?(): WebPreferences;
    }
  }
}
