/**
 * The plugin's CSS on the app's own design tokens (`--dsw-*`, `--dsh-*`), so it follows the app's theme. The page's own
 * CSS is `@open-artifact/library-page`'s, on neutral tokens (`--oa-page-*`): {@link PAGE_TOKENS} says which of the app's
 * tokens each one is. Every class starts with `oa-` (the page) or `oac-` (the chat cards): nothing here reaches the app
 * around them.
 */

/**
 * The page's tokens, each as the app token it is (with that token's own fallback where the page had one). Declared on
 * the page's root, and on the two of its classes the plugin draws outside it (the Update button and the tag on the
 * plugin's page in Plugins), as `var()` in a custom property is read where it is declared.
 */
export const PAGE_TOKENS: Readonly<Record<string, string>> = Object.freeze({
  '--oa-page-text-primary': 'var(--dsw-alias-label-primary)',
  '--oa-page-text-secondary': 'var(--dsw-alias-label-secondary)',
  '--oa-page-text-tertiary': 'var(--dsw-alias-label-tertiary)',
  '--oa-page-text-caption': 'var(--dsw-alias-label-caption)',
  '--oa-page-bg': 'var(--dsw-alias-bg-base)',
  '--oa-page-hover-bg': 'var(--dsw-alias-interactive-bg-hover)',
  '--oa-page-accent': 'var(--dsw-alias-state-business-primary)',
  '--oa-page-danger': 'var(--dsw-alias-state-error-primary)',
  '--oa-page-border-strong': 'var(--dsw-alias-border-l1)',
  '--oa-page-border': 'var(--dsw-alias-border-l2)',
  '--oa-page-border-floating': 'var(--dsw-alias-border-l4,rgba(0,0,0,.16))',
  '--oa-page-skeleton-bg': 'var(--dsw-alias-bg-skeleton,var(--dsw-alias-interactive-bg-hover))',
  '--oa-page-focus-ring-width': 'var(--dsw-focus-ring-width,2px)',
  '--oa-page-focus-ring-color': 'var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))',
  '--oa-page-top-clearance': 'var(--dsh-frame-top-clearance,0px)',
});

/** {@link PAGE_TOKENS} as CSS, injected before the page's own. */
export const TOKEN_CSS = `
.oa-page,.oa-btn,.oau-tag{${Object.entries(PAGE_TOKENS)
  .map(([name, value]) => `${name}:${value}`)
  .join(';')}}
`;

/** The chat cards of comments and requests sent to the agent. */
export const CARD_CSS = `
.oac-row{display:flex;flex-direction:column;align-items:flex-end;gap:8px;width:100%}
.oac-card{box-sizing:border-box;max-width:min(calc(var(--dsh-chat-content-width, 748px) * 0.702), 82%);min-width:min(320px, 82%);
  border:0.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-xl, 12px);background:var(--dsw-alias-markdown-code-block);
  color:var(--dsw-alias-label-primary);padding:10px 14px 12px;display:flex;flex-direction:column;gap:6px}
.oac-head{display:flex;align-items:center;gap:6px;color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xxs-12, 12px/18px sans-serif)}
.oac-head svg{flex:none}
.oac-head-text{flex:1;min-width:0;display:flex;white-space:nowrap;overflow:hidden}
.oac-head-text>span{flex:none}
.oac-head-text>.oac-head-title{flex:0 1 auto;min-width:1.5em;overflow:hidden;text-overflow:ellipsis}
.oac-toggle{flex:none;display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;margin:-2px -4px -2px 0;
  border:0;border-radius:var(--dsw-radius-sm, 6px);background:none;color:inherit;cursor:pointer;padding:0}
.oac-toggle:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
.oac-toggle svg{transition:transform .15s}
.oac-toggle[aria-expanded=false] svg{transform:rotate(-90deg)}
.oac-body{font-size:var(--dsh-content-font-size, 14px);line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere}
.oac-selection{display:flex;flex-direction:column;gap:4px;min-width:0}
.oac-chip{align-self:flex-start;max-width:100%;box-sizing:border-box;display:inline-flex;align-items:center;gap:4px;height:24px;padding:0 8px;
  border:0.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm, 6px);color:var(--dsw-alias-label-secondary);
  font:var(--dsw-font-xxs-12, 12px/18px sans-serif)}
.oac-chip svg{flex:none}
.oac-chip-text{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.oac-chip .oac-toggle{margin:0 -4px 0 0}
.oac-selection-list{display:flex;flex-direction:column;gap:2px;padding-left:8px;border-left:2px solid var(--dsw-alias-border-l1)}
.oac-selection-text{color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xxs-12, 12px/18px sans-serif);white-space:pre-wrap;
  overflow-wrap:anywhere;max-height:9em;overflow:auto}
.oac-meta{display:flex;flex-direction:column;gap:6px;padding-top:6px;border-top:0.5px solid var(--dsw-alias-border-l1)}
.oac-where{color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xxs-12, 12px/18px sans-serif);overflow-wrap:anywhere}
.oac-view{align-self:flex-start;display:inline-flex;align-items:center;gap:2px;height:24px;margin-left:-6px;padding:0 6px;border:0;
  border-radius:var(--dsw-radius-sm, 6px);background:none;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xxs-12, 12px/18px sans-serif);cursor:pointer}
.oac-view:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.oac-view:focus-visible,.oac-toggle:focus-visible{outline:var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));outline-offset:1px}
@media (prefers-reduced-motion:reduce){.oac-toggle svg{transition:none}}
`;
