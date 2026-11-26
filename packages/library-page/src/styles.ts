/**
 * The page's CSS. It reads neutral tokens (`--oa-page-*`, listed in the README) that the host maps onto its own design
 * tokens, and two attributes on the page's root (`.oa-page`): `data-theme="dark"` for the dark look, and
 * `data-platform="darwin"` for the room a macOS window's title bar takes (`--oa-page-top-clearance`). Every class starts
 * with `oa-`: nothing here reaches the app around the page.
 */

/** The Open Artifact page. */
export const PAGE_CSS = `
.oa-page{position:relative;width:100%;min-width:0;height:100%;min-height:0;color:var(--oa-page-text-primary);background:var(--oa-page-bg);font-size:14px;line-height:1.6;display:flex;flex-direction:column;overflow:hidden}
.oa-scroll{flex:1;min-height:0;overflow:auto;scrollbar-gutter:stable}
.oa-content{max-width:1120px;margin:0 auto;padding:0 clamp(24px,4vw,48px) 56px}
.oa-heading{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px 16px;padding-top:28px;margin-bottom:24px}
:where(.oa-page)[data-platform=darwin] .oa-heading{padding-top:calc(28px + var(--oa-page-top-clearance,0px))}
.oa-heading h1{margin:0;font-size:20px;font-weight:500;line-height:28px}
.oa-tools{display:flex;align-items:center;gap:4px;margin-left:auto}
.oa-tool{position:relative;display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;padding:0;border:0;border-radius:8px;background:none;color:var(--oa-page-text-secondary);cursor:pointer}
.oa-tool:hover,.oa-tool[aria-expanded=true]{background:var(--oa-page-hover-bg);color:var(--oa-page-text-primary)}
.oa-tool[data-active=true]::after{content:"";position:absolute;top:6px;right:6px;width:6px;height:6px;border-radius:50%;background:var(--oa-page-accent)}
.oa-search{display:flex;align-items:center;gap:6px;width:min(240px,50vw);height:32px;padding:0 8px 0 10px;border:.5px solid var(--oa-page-border);border-radius:8px;color:var(--oa-page-text-tertiary)}
.oa-search:focus-within{border-color:var(--oa-page-accent)}
.oa-search input{flex:1;min-width:0;height:100%;border:0;padding:0;background:none;color:var(--oa-page-text-primary);font:inherit;font-size:13px;outline:none}
.oa-search input::placeholder{color:var(--oa-page-text-caption)}
.oa-search input::-webkit-search-cancel-button{display:none}
.oa-search button{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;margin-right:-4px;padding:0;border:0;border-radius:6px;background:none;color:inherit;cursor:pointer}
.oa-search button:hover{background:var(--oa-page-hover-bg)}
.oa-section-title{margin:0 0 12px;font-size:13px;font-weight:400;line-height:20px;color:var(--oa-page-text-tertiary)}
.oa-tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(112px,1fr));gap:14px 10px;margin:0 0 36px;padding:0;list-style:none}
.oa-tile-groups{display:flex;flex-wrap:wrap;gap:20px 28px;margin:0 0 36px}
.oa-tile-group{display:flex;flex-direction:column;min-width:0}
.oa-tile-group .oa-section-title{margin-bottom:10px}
.oa-tile-group .oa-tiles{display:flex;flex-wrap:wrap;gap:10px;margin:0}
.oa-tile-group .oa-tiles>li{width:112px}
.oa-tile{display:flex;flex-direction:column;gap:8px;width:100%;padding:0;border:0;background:none;color:inherit;font:inherit;text-align:left;cursor:pointer}
.oa-tile-art{position:relative;display:flex;align-items:center;justify-content:center;aspect-ratio:10/7;border-radius:14px;overflow:hidden;background:var(--oa-wash);color:var(--oa-ink);transition:transform .2s cubic-bezier(.2,.7,.3,1),background-color .15s}
.oa-tile:hover .oa-tile-art,.oa-tile[data-peek=true] .oa-tile-art{transform:scale(1.03)}
.oa-tile:focus-visible{outline:none}
.oa-tile:focus-visible .oa-tile-art{outline:var(--oa-page-focus-ring-width,2px) solid var(--oa-page-focus-ring-color,var(--oa-page-accent));outline-offset:2px}
.oa-tile-art>svg{position:relative}
.oa-tile-art>.oa-tile-doodle{position:absolute;inset:0;width:100%;height:100%;opacity:.14;pointer-events:none}
.oa-tile-beta{position:absolute;top:6px;left:6px;padding:0 6px;border-radius:999px;background:#fff;box-shadow:0 0 0 .5px var(--oa-page-border-floating,rgba(0,0,0,.16));color:var(--oa-page-text-secondary);font-size:11px;line-height:16px}
.oa-tile-label{display:flex;flex-direction:column;padding-left:2px;font-size:14px;line-height:20px}
.oa-tile-state{display:inline-flex;align-items:center;gap:5px;color:var(--oa-page-text-tertiary);font-size:12px;line-height:16px}
.oa-tile-state[data-state=failed]{color:var(--oa-page-danger)}
.oa-tile-state .oa-spinner{width:9px;height:9px;border-width:1.2px}
.oa-tile[data-missing=true] .oa-tile-art{background:color-mix(in srgb,var(--oa-wash) 45%,var(--oa-page-bg));color:color-mix(in srgb,var(--oa-ink) 55%,var(--oa-page-bg));box-shadow:inset 0 0 0 .5px color-mix(in srgb,var(--oa-ink) 22%,transparent)}
.oa-tile[data-missing=true]:hover .oa-tile-art,.oa-tile[data-missing=true][data-peek=true] .oa-tile-art{background:color-mix(in srgb,var(--oa-wash) 65%,var(--oa-page-bg))}
.oa-tile[data-missing=true] .oa-tile-doodle{opacity:.08}
.oa-tile[data-missing=true] .oa-tile-label{color:var(--oa-page-text-secondary)}
:where(.oa-page)[data-theme=dark] .oa-tile-art{background:color-mix(in srgb,var(--oa-ink) 36%,var(--oa-page-bg));color:var(--oa-wash)}
:where(.oa-page)[data-theme=dark] .oa-tile[data-missing=true] .oa-tile-art{background:color-mix(in srgb,var(--oa-ink) 16%,var(--oa-page-bg));color:color-mix(in srgb,var(--oa-wash) 55%,var(--oa-page-bg));box-shadow:inset 0 0 0 .5px color-mix(in srgb,var(--oa-wash) 18%,transparent)}
:where(.oa-page)[data-theme=dark] .oa-tile[data-missing=true]:hover .oa-tile-art,:where(.oa-page)[data-theme=dark] .oa-tile[data-missing=true][data-peek=true] .oa-tile-art{background:color-mix(in srgb,var(--oa-ink) 24%,var(--oa-page-bg))}
:where(.oa-page)[data-theme=dark] .oa-tile-art>.oa-tile-doodle{opacity:.12}
:where(.oa-page)[data-theme=dark] .oa-tile-beta{background:var(--oa-page-bg)}
.oa-peek{position:fixed;z-index:900;width:288px;max-width:calc(100vw - 16px);box-sizing:border-box;padding:16px;border:.5px solid var(--oa-page-border-floating,rgba(0,0,0,.16));border-radius:16px;background:var(--oa-page-bg);box-shadow:0 12px 32px -10px rgba(0,0,0,.22);color:var(--oa-page-text-primary);animation:oa-peek-in .14s ease-out}
.oa-peek-title{font-size:17px;line-height:24px}
.oa-peek-by{margin-top:2px;font-size:14px;line-height:20px;color:var(--oa-page-text-secondary)}
.oa-peek-about{margin:6px 0 0;font-size:14px;line-height:20px;color:var(--oa-page-text-secondary)}
.oa-peek-act{margin-top:14px;height:32px;padding:0 10px;border:0;border-radius:8px;background:color-mix(in srgb,var(--oa-page-text-primary) 6%,var(--oa-page-bg));color:var(--oa-page-text-primary);font:inherit;font-size:14px;cursor:pointer}
.oa-peek-act:hover{background:color-mix(in srgb,var(--oa-page-text-primary) 10%,var(--oa-page-bg))}
.oa-peek-act:focus-visible{outline:var(--oa-page-focus-ring-width,2px) solid var(--oa-page-focus-ring-color,var(--oa-page-accent));outline-offset:2px}
@keyframes oa-peek-in{from{opacity:0;transform:translateY(-4px)}}
.oa-dialog-head{display:flex;align-items:center;gap:12px;margin-bottom:12px}
.oa-dialog-head h2{margin:0}
.oa-dialog .oa-glyph{width:40px;height:40px}
.oa-dialog p+p{margin-top:8px}
.oa-dialog p[data-kind=error]{color:var(--oa-page-danger)}
.oa-dialog-status{display:flex;align-items:center;gap:8px}
.oa-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:20px;margin:0;padding:0;list-style:none}
.oa-item{position:relative;min-width:0}
.oa-card{display:flex;flex-direction:column;width:100%;padding:0;border:.5px solid var(--oa-page-border);border-radius:14px;overflow:hidden;background:var(--oa-page-bg);color:inherit;font:inherit;text-align:left;cursor:pointer;transition:background-color .15s}
.oa-item:hover .oa-card{background:var(--oa-page-hover-bg)}
.oa-card:disabled{cursor:progress}
.oa-card:focus-visible,.oa-row:focus-visible{outline:var(--oa-page-focus-ring-width,2px) solid var(--oa-page-focus-ring-color,var(--oa-page-accent));outline-offset:2px}
.oa-preview{position:relative;display:block;width:100%;aspect-ratio:2/1;overflow:hidden;background:color-mix(in srgb,var(--oa-tint) 16%,var(--oa-page-bg))}
.oa-sheet{position:absolute;left:12%;right:12%;top:13%;bottom:-8px;border-radius:8px 8px 0 0;overflow:hidden;background:var(--oa-page-bg);box-shadow:0 0 0 .5px var(--oa-page-border),0 6px 18px -8px rgba(0,0,0,.28);transition:transform .2s}
.oa-item:hover .oa-sheet{transform:translateY(-3px)}
.oa-sheet img{display:block;width:100%;height:100%;object-fit:cover;object-position:top center;user-select:none}
.oa-preview[data-stack=true] .oa-sheet{left:20%;right:20%}
.oa-preview[data-stack=true]::before{content:"";position:absolute;left:21%;right:19%;top:10%;bottom:-8px;border-radius:8px 8px 0 0;background:var(--oa-page-bg);box-shadow:0 0 0 .5px var(--oa-page-border);transform:rotate(1.6deg);transform-origin:bottom center}
.oa-paper{position:absolute;left:14%;right:14%;top:13%;bottom:-8px;border-radius:8px 8px 0 0;background:var(--oa-page-bg);box-shadow:0 0 0 .5px var(--oa-page-border),0 6px 18px -8px rgba(0,0,0,.25);padding:6% 7% 0;display:flex;flex-direction:column;gap:6px;overflow:hidden;transition:transform .2s}
.oa-item:hover .oa-paper{transform:translateY(-3px)}
.oa-paper-title{font-size:11px;line-height:1.35;font-weight:600;color:var(--oa-page-text-primary);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
.oa-line{height:5px;border-radius:3px;background:var(--oa-page-border)}
.oa-slide{position:absolute;left:14%;right:14%;top:13%;aspect-ratio:16/9;border-radius:6px;background:var(--oa-page-bg);box-shadow:0 0 0 .5px var(--oa-page-border),0 6px 18px -8px rgba(0,0,0,.25);display:flex;flex-direction:column;justify-content:center;gap:6px;padding:0 9%;transition:transform .2s}
.oa-item:hover .oa-slide{transform:translateY(-3px)}
.oa-slide .oa-paper-title{font-size:12px}
.oa-slide .oa-line{width:40%;background:var(--oa-tint);opacity:.55}
.oa-boards{display:flex;gap:6px;flex:1;margin-top:2px}
.oa-board{flex:1;border-radius:3px;background:color-mix(in srgb,var(--oa-tint) 18%,var(--oa-page-bg));box-shadow:0 0 0 .5px var(--oa-page-border)}
.oa-board:nth-child(2){flex:.7;margin-top:10%}
.oa-flow{display:block;width:100%;height:auto;margin-top:4px}
.oa-flow rect{fill:color-mix(in srgb,var(--oa-tint) 18%,var(--oa-page-bg));stroke:var(--oa-page-border);stroke-width:.5}
.oa-flow path{fill:none;stroke:var(--oa-tint);stroke-width:1.2;stroke-linecap:round;stroke-linejoin:round}
.oa-cells{display:block;width:100%;height:auto;margin-top:4px}
.oa-cells path{fill:none;stroke:var(--oa-page-border);stroke-width:.75}
.oa-cells-head{fill:color-mix(in srgb,var(--oa-tint) 18%,var(--oa-page-bg))}
.oa-cells-pick{fill:none;stroke:var(--oa-tint);stroke-width:1.5}
.oa-swatches{display:flex;gap:4px}
.oa-swatch{width:16px;height:16px;border-radius:50%;background:var(--oa-tint)}
.oa-swatch:nth-child(2){opacity:.7}.oa-swatch:nth-child(3){opacity:.45}.oa-swatch:nth-child(4){opacity:.25}
.oa-specimen{font-size:20px;line-height:1;font-weight:600;color:var(--oa-page-text-secondary)}
.oa-kpis{display:flex;gap:5px}
.oa-kpi{flex:1;height:16px;border-radius:3px;box-shadow:0 0 0 .5px var(--oa-page-border)}
.oa-bars{display:flex;align-items:flex-end;gap:5px;height:34%;margin-top:2px}
.oa-bar{flex:1;border-radius:2px 2px 0 0;background:var(--oa-tint);opacity:.7}
.oa-film{position:absolute;left:14%;right:14%;top:13%;aspect-ratio:16/9;border-radius:6px;background:#1d1d1f;box-shadow:0 6px 18px -8px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;transition:transform .2s;color:#fff}
.oa-item:hover .oa-film{transform:translateY(-3px)}
.oa-film-bar{position:absolute;left:8%;right:8%;bottom:10%;height:3px;border-radius:2px;background:rgba(255,255,255,.25)}
.oa-film-bar::after{content:"";position:absolute;left:0;top:0;bottom:0;width:38%;border-radius:2px;background:var(--oa-tint)}
.oa-film-title{position:absolute;left:8%;right:8%;top:10%;font-size:10px;font-weight:600;color:rgba(255,255,255,.85);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.oa-busy{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:8px;background:color-mix(in srgb,var(--oa-page-bg) 70%,transparent);color:var(--oa-page-text-secondary);font-size:13px}
.oa-spinner{width:14px;height:14px;border-radius:50%;border:1.5px solid currentColor;border-right-color:transparent;animation:oa-spin .8s linear infinite}
@keyframes oa-spin{to{transform:rotate(360deg)}}
.oa-info{display:flex;align-items:center;gap:12px;min-width:0;padding:12px 14px}
.oa-glyph{flex:none;display:flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:9px;background:var(--oa-wash);color:var(--oa-ink)}
:where(.oa-page)[data-theme=dark] .oa-glyph{background:color-mix(in srgb,var(--oa-ink) 36%,var(--oa-page-bg));color:var(--oa-wash)}
.oa-menu-glyph{display:flex;color:var(--oa-ink)}
:where(.oa-page)[data-theme=dark] .oa-menu-glyph{color:var(--oa-wash)}
.oa-text{display:flex;flex-direction:column;min-width:0;flex:1}
.oa-name{font-weight:500;line-height:20px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.oa-meta{color:var(--oa-page-text-tertiary);font-size:12px;line-height:18px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.oa-actions{position:absolute;top:10px;right:10px;display:flex;align-items:center;gap:6px}
.oa-act{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;padding:0;border:.5px solid var(--oa-page-border);border-radius:8px;background:var(--oa-page-bg);color:var(--oa-page-text-secondary);cursor:pointer;opacity:0;transition:opacity .12s}
.oa-act:hover{color:var(--oa-page-text-primary);background:color-mix(in srgb,var(--oa-page-text-primary) 6%,var(--oa-page-bg))}
.oa-item:hover .oa-act,.oa-item:focus-within .oa-act,.oa-act[aria-expanded=true],.oa-act[data-on=true]{opacity:1}
.oa-act[data-on=true]{color:var(--oa-page-text-primary)}
.oa-list{display:flex;flex-direction:column;gap:2px;margin:0;padding:0;list-style:none}
.oa-list .oa-item{display:flex;align-items:center;border-radius:10px;padding-right:8px}
.oa-list .oa-item:hover,.oa-list .oa-item[data-menu=true]{background:var(--oa-page-hover-bg)}
.oa-row{display:flex;align-items:center;gap:12px;flex:1;min-width:0;padding:8px 10px;border:0;border-radius:10px;background:none;color:inherit;font:inherit;text-align:left;cursor:pointer}
.oa-row:disabled{cursor:progress}
.oa-row .oa-name{flex:1;min-width:0}
.oa-row .oa-meta{flex:none;max-width:45%;margin-left:16px}
.oa-row-tools{flex:none;display:flex;align-items:center;gap:2px;margin-left:4px;color:var(--oa-page-text-tertiary)}
.oa-shared{display:inline-flex;align-items:center;margin-right:6px;color:var(--oa-page-text-tertiary)}
.oa-list .oa-act{width:28px;height:28px;border:0;background:none}
.oa-list .oa-act:hover{background:color-mix(in srgb,var(--oa-page-text-primary) 8%,transparent)}
.oa-list .oa-act-more{opacity:1}
@media (max-width:560px){.oa-row .oa-meta{display:none}}
.oa-menu{position:fixed;z-index:1000;min-width:200px;padding:6px;border:.5px solid var(--oa-page-border);border-radius:12px;background:var(--oa-page-bg);box-shadow:0 8px 28px -6px rgba(0,0,0,.28);font-size:14px}
.oa-menu-item{display:flex;align-items:center;gap:10px;width:100%;min-height:34px;padding:5px 10px;border:0;border-radius:8px;background:none;color:var(--oa-page-text-primary);font:inherit;text-align:left;white-space:nowrap;cursor:pointer}
.oa-menu-item:hover,.oa-menu-item:focus-visible,.oa-menu-item[aria-expanded=true]{background:var(--oa-page-hover-bg);outline:none}
.oa-menu-item[data-danger=true]{color:var(--oa-page-danger)}
.oa-menu-item svg{flex:none}
.oa-menu-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis}
.oa-menu-value{margin-left:16px;color:var(--oa-page-text-tertiary)}
.oa-menu-count{margin-left:16px;color:var(--oa-page-text-tertiary);font-variant-numeric:tabular-nums}
.oa-menu-key{margin-left:20px;color:var(--oa-page-text-tertiary);font:inherit;font-size:12px}
.oa-menu-rule{height:.5px;margin:6px 4px;background:var(--oa-page-border)}
.oa-menu-chev{margin-left:6px;color:var(--oa-page-text-tertiary)}
.oa-menu-row{position:relative}
.oa-submenu{position:absolute;left:calc(100% + 12px);top:-6px;z-index:1001;min-width:190px;padding:6px;border:.5px solid var(--oa-page-border);border-radius:12px;background:var(--oa-page-bg);box-shadow:0 8px 28px -6px rgba(0,0,0,.28)}
.oa-submenu[data-flip=true]{left:auto;right:calc(100% + 12px)}
.oa-check{flex:none;display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border:1px solid var(--oa-page-border-strong);border-radius:5px;color:transparent}
.oa-check[data-on=true]{border-color:var(--oa-page-accent);background:var(--oa-page-accent);color:#fff}
.oa-tick{flex:none;margin-left:16px;color:var(--oa-page-accent)}
.oa-scrim{position:fixed;inset:0;z-index:1100;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(0,0,0,.36)}
.oa-dialog{width:min(420px,100%);padding:20px;border-radius:16px;background:var(--oa-page-bg);box-shadow:0 18px 48px -12px rgba(0,0,0,.4)}
.oa-dialog h2{margin:0 0 12px;font-size:16px;font-weight:600;line-height:24px;overflow-wrap:anywhere}
.oa-dialog p{margin:0;color:var(--oa-page-text-secondary);font-size:14px;line-height:1.55;overflow-wrap:anywhere}
.oa-dialog input{box-sizing:border-box;width:100%;height:38px;padding:0 12px;border:1px solid var(--oa-page-border);border-radius:10px;background:none;color:var(--oa-page-text-primary);font:inherit;outline:none}
.oa-dialog input:focus{border-color:var(--oa-page-accent)}
.oa-dialog-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:20px}
.oa-btn{height:34px;padding:0 14px;border:0;border-radius:9px;background:var(--oa-page-hover-bg);color:var(--oa-page-text-primary);font:inherit;font-weight:500;cursor:pointer}
.oa-btn:hover{background:color-mix(in srgb,var(--oa-page-text-primary) 12%,var(--oa-page-bg))}
.oa-btn:disabled{color:var(--oa-page-text-caption);cursor:default;background:var(--oa-page-hover-bg)}
.oa-btn[data-primary=true]{background:var(--oa-page-accent);color:#fff}
.oa-btn[data-primary=true]:hover:not(:disabled){filter:brightness(1.08)}
.oa-btn[data-primary=true]:disabled{background:var(--oa-page-hover-bg);color:var(--oa-page-text-caption)}
.oa-btn[data-danger=true]{border:1px solid var(--oa-page-danger);background:color-mix(in srgb,var(--oa-page-danger) 10%,var(--oa-page-bg));color:var(--oa-page-danger)}
.oa-btn[data-danger=true]:hover{background:color-mix(in srgb,var(--oa-page-danger) 18%,var(--oa-page-bg))}
.oa-toast{position:absolute;left:50%;bottom:24px;z-index:900;display:flex;align-items:center;gap:10px;max-width:min(560px,calc(100% - 32px));padding:9px 10px 9px 14px;border:.5px solid var(--oa-page-border);border-radius:12px;background:var(--oa-page-bg);box-shadow:0 8px 28px -6px rgba(0,0,0,.28);transform:translateX(-50%);font-size:14px}
.oa-toast[data-kind=error]{color:var(--oa-page-danger)}
.oa-toast svg{flex:none}
.oa-toast-text{min-width:0;overflow-wrap:anywhere}
.oa-toast-undo{flex:none;padding:2px 8px;border:0;border-radius:6px;background:none;color:var(--oa-page-accent);font:inherit;font-weight:500;cursor:pointer}
.oa-toast-undo:hover{background:var(--oa-page-hover-bg)}
.oa-toast-close{flex:none;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;padding:0;border:0;border-radius:6px;background:none;color:var(--oa-page-text-tertiary);cursor:pointer}
.oa-toast-close:hover{background:var(--oa-page-hover-bg)}
.oa-empty{display:flex;flex-direction:column;align-items:center;gap:8px;padding:56px 20px;text-align:center;color:var(--oa-page-text-tertiary)}
.oa-empty svg{color:var(--oa-page-text-caption);margin-bottom:4px}
.oa-empty h2{margin:0;font-size:14px;font-weight:500;color:var(--oa-page-text-secondary)}
.oa-empty p{margin:0;max-width:420px;font-size:13px;line-height:1.6}
.oa-retry{margin-top:8px;height:30px;padding:0 12px;border:.5px solid var(--oa-page-border);border-radius:15px;background:none;color:var(--oa-page-text-primary);font:inherit;font-size:13px;cursor:pointer}
.oa-retry:hover{background:var(--oa-page-hover-bg)}
.oa-skeleton .oa-card{cursor:default}
.oa-skeleton .oa-preview{background:var(--oa-page-skeleton-bg,var(--oa-page-hover-bg))}
.oa-skeleton .oa-line{width:60%;height:10px;margin:18px 14px}
@media (prefers-reduced-motion:reduce){.oa-sheet,.oa-paper,.oa-slide,.oa-film,.oa-act,.oa-tile-art,.oa-card{transition:none}.oa-tile:hover .oa-tile-art,.oa-tile[data-peek=true] .oa-tile-art{transform:none}.oa-peek{animation:none}.oa-spinner{animation-duration:2s}}
.oa-news .oau-head{margin-bottom:8px}
.oa-notes{display:flex;flex-direction:column;gap:12px;align-items:flex-start}
.oa-release{align-self:stretch;min-width:0}
.oa-release-head{display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;margin:0 0 4px;font-size:14px;font-weight:600;line-height:22px;color:var(--oa-page-text-primary)}
.oa-release-date{font-weight:400;color:var(--oa-page-text-tertiary);font-size:12px}
.oa-release-summary{margin:0 0 6px;color:var(--oa-page-text-primary);font-size:13px;line-height:20px;overflow-wrap:anywhere}
.oa-release-section{margin-top:6px}
.oa-release-section h4{margin:0 0 2px;font-size:12px;font-weight:500;line-height:18px;color:var(--oa-page-text-tertiary)}
.oa-release-section ul{margin:0;padding-left:18px;color:var(--oa-page-text-secondary);font-size:13px;line-height:20px}
.oa-release-section li{overflow-wrap:anywhere}
.oa-release-section li+li{margin-top:2px}
.oa-release code{padding:0 4px;border-radius:4px;background:color-mix(in srgb,var(--oa-page-text-primary) 8%,transparent);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
.oa-release strong{font-weight:600;color:var(--oa-page-text-primary)}
.oa-release a{color:var(--oa-page-accent)}
.oa-news-upcoming{display:flex;flex-direction:column;align-items:flex-start;gap:8px;margin-top:10px;padding-top:10px;border-top:.5px solid var(--oa-page-border)}
.oa-foot{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:4px 8px;margin-top:40px;color:var(--oa-page-text-tertiary);font-size:12px;line-height:18px}
.oa-dialog[data-wide=true]{width:min(640px,100%);display:flex;flex-direction:column;max-height:min(720px,calc(100vh - 48px))}
.oa-changelog{flex:1;min-height:0;overflow:auto;margin:0 -20px;padding:0 20px}
.oa-changelog .oa-release+.oa-release{padding-top:12px;border-top:.5px solid var(--oa-page-border)}
.oa-btn-link{display:inline-flex;align-items:center;text-decoration:none;margin-right:auto}
`;

/** The update panel's CSS (updates.tsx), and the tag the changelog puts beside a version. */
export const UPDATE_CSS = `
.oau-panel{margin:0 0 24px;padding:14px 16px;border-radius:12px;background:var(--oa-page-hover-bg);color:var(--oa-page-text-primary);font-size:13px;line-height:20px}
.oau-head{display:flex;flex-wrap:wrap;align-items:flex-start;gap:8px 16px}
.oau-head-text{flex:1;min-width:200px}
.oau-title{font-weight:500;overflow-wrap:anywhere}
.oau-text{color:var(--oa-page-text-secondary);overflow-wrap:anywhere}
.oau-actions{flex:none;display:flex;gap:8px}
.oau-line{display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;margin:0 0 20px;color:var(--oa-page-text-secondary);font-size:13px;line-height:20px}
.oau-show{padding:0;border:0;background:none;color:var(--oa-page-accent);font:inherit;cursor:pointer}
.oau-show:hover{text-decoration:underline}
.oau-tag{display:inline-flex;align-items:center;padding:0 8px;border-radius:9px;font-size:12px;line-height:20px;background:color-mix(in srgb,var(--oa-page-accent) 12%,transparent);color:var(--oa-page-accent)}
.oau-tag[data-tone="neutral"]{background:var(--oa-page-hover-bg);color:var(--oa-page-text-secondary)}
`;

/** Adds CSS to the document once; the returned function takes it away. */
export function injectStyles(id: string, css: string): () => void {
  if (typeof document === "undefined" || !css) return () => {};
  if (document.querySelector(`style[data-plugin-css="${id}"]`)) return () => {};
  const tag = document.createElement("style");
  tag.dataset.pluginCss = id;
  tag.textContent = css;
  document.head.appendChild(tag);
  return () => tag.remove();
}
