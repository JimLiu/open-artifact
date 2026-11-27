// Runs in the page's head, before the style sheets and before anything is drawn: the look the page starts in. The
// main process's first state can take seconds (it waits for the connection), and until then the page would draw in
// the light look over a dark window. `prefers-color-scheme` already follows the app's setting here
// (`nativeTheme.themeSource`), so it is the same look the state will say; `main.tsx` and `App.tsx` set it again.
document.documentElement.dataset.theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
