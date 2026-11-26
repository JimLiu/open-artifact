/**
 * The playground's root URL, where `editors/`, `frame-host/` and `page-shell.html` live. A demo's own page
 * (`<demo>/index.html`) names it in `<meta name="playground-root">` (`../`, or the absolute base); `demo.html` names
 * `./`. Without the tag (the page demo's inner frame), the build's base.
 */
export function playgroundRoot(): URL {
  const meta = typeof document === 'undefined' ? null : document.querySelector<HTMLMetaElement>('meta[name="playground-root"]');
  return new URL(meta?.content || import.meta.env.BASE_URL, location.href);
}
