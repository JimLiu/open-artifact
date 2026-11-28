// Small progressive enhancements: copy buttons, install tabs, mobile menu, language choice, the home page's live stage.
(function () {
  var d = document;
  var zh = d.documentElement.getAttribute('data-lang') === 'zh';

  // Remember the language someone picks with the toggle.
  d.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('[data-lang-switch]');
    if (!a) return;
    try { localStorage.setItem('oa-lang', a.getAttribute('data-lang-switch')); } catch (_) {}
    if (location.hash) a.href = a.href.split('#')[0] + location.hash;
  });

  // Copy buttons on code blocks.
  d.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('.code .copy');
    if (!b) return;
    var code = b.parentNode.querySelector('code');
    var text = code ? code.innerText.replace(/\n$/, '') : '';
    var done = function () {
      b.classList.add('done');
      b.setAttribute('title', zh ? '已复制' : 'Copied');
      setTimeout(function () { b.classList.remove('done'); b.setAttribute('title', zh ? '复制' : 'Copy'); }, 1400);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () {});
    else {
      var ta = d.createElement('textarea');
      ta.value = text; d.body.appendChild(ta); ta.select();
      try { d.execCommand('copy'); done(); } catch (_) {}
      ta.remove();
    }
  });

  // Mobile menu.
  var btn = d.querySelector('.menu-btn');
  if (btn) btn.addEventListener('click', function () {
    var open = d.body.classList.toggle('nav-open');
    btn.setAttribute('aria-expanded', String(open));
  });


  // Tab strips, like the app's TabStrip (packages/ui/src/tab-strip.tsx): a row of tabs that keeps the one in front in
  // sight, puts the tabs that do not fit into a list behind a ▾ button at the end of the row, and brings a tab picked
  // there into the row. `row` holds the tabs (its element children); `isOn(tab)` says which one is in front; `detail`
  // gives a tab's second line in the list. Without JavaScript the row simply scrolls.
  var openMenu = null;
  function closeMenu(refocus) {
    if (!openMenu) return;
    var m = openMenu; openMenu = null;
    m.menu.remove();
    m.more.setAttribute('aria-expanded', 'false');
    if (refocus) m.more.focus();
  }
  d.addEventListener('pointerdown', function (e) { if (openMenu && !openMenu.menu.contains(e.target) && !openMenu.more.contains(e.target)) closeMenu(false); });
  d.addEventListener('keydown', function (e) { if (e.key === 'Escape' && openMenu) { e.preventDefault(); closeMenu(true); } });
  window.addEventListener('resize', function () { closeMenu(false); });
  window.addEventListener('scroll', function () { closeMenu(false); }, { passive: true });

  function tabStrip(row, isOn, detail) {
    var tabs = Array.prototype.slice.call(row.children);
    var start = 0;
    var more = d.createElement('button');
    more.type = 'button';
    more.className = 'strip-more';
    more.hidden = true;
    more.setAttribute('aria-haspopup', 'menu');
    more.setAttribute('aria-expanded', 'false');
    more.title = zh ? '更多' : 'More';
    more.setAttribute('aria-label', zh ? '更多标签' : 'More tabs');
    more.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg>';
    row.appendChild(more);
    row.classList.add('strip');

    function fit() {
      tabs.forEach(function (t) { t.hidden = false; });
      more.hidden = true;
      var gap = parseFloat(getComputedStyle(row).columnGap) || 0;
      var widths = tabs.map(function (t) { return t.getBoundingClientRect().width; });
      var total = widths.reduce(function (a, w) { return a + w; }, 0) + gap * (tabs.length - 1);
      var pad = parseFloat(getComputedStyle(row).paddingLeft) + parseFloat(getComputedStyle(row).paddingRight);
      var avail = row.clientWidth - pad;
      if (total <= avail + 0.5) { start = 0; return; }
      more.hidden = false;
      var space = avail - more.getBoundingClientRect().width - gap;
      var span = function (a, b) { var w = gap * (b - a); for (var k = a; k <= b; k++) w += widths[k]; return w; };
      var front = Math.max(0, tabs.findIndex(isOn));
      var first = Math.min(start, tabs.length - 1);
      if (front < first) first = front;
      else while (first < front && span(first, front) > space) first++;
      var last = first;
      while (last + 1 < tabs.length && span(first, last + 1) <= space) last++;
      if (last === tabs.length - 1) while (first > 0 && span(first - 1, last) <= space) first--;
      start = first;
      tabs.forEach(function (t, k) { t.hidden = k < first || k > last; });
    }

    more.addEventListener('click', function () {
      if (openMenu && openMenu.more === more) return closeMenu(false);
      closeMenu(false);
      var menu = d.createElement('div');
      menu.className = 'strip-menu';
      menu.setAttribute('role', 'menu');
      tabs.forEach(function (t) {
        if (!t.hidden) return;
        var item = d.createElement('button');
        item.type = 'button';
        item.setAttribute('role', 'menuitem');
        var icon = t.querySelector('.stage-tab-icon');
        var sub = detail && detail(t);
        item.innerHTML = (icon ? icon.outerHTML : '') + '<span><b></b>' + (sub ? '<small></small>' : '') + '</span>';
        item.querySelector('b').textContent = (t.getAttribute('data-name') || t.textContent).trim();
        if (sub) item.querySelector('small').textContent = sub;
        if (t.style.cssText) item.style.cssText = t.style.cssText;
        item.addEventListener('click', function () {
          closeMenu(false);
          t.hidden = false;
          t.click();
          fit();
          t.focus();
        });
        menu.appendChild(item);
      });
      d.body.appendChild(menu);
      var r = more.getBoundingClientRect();
      var w = menu.offsetWidth;
      menu.style.left = Math.max(8, Math.min(r.right - w, innerWidth - w - 8)) + 'px';
      menu.style.top = r.bottom + 6 + 'px';
      menu.style.maxHeight = Math.max(160, innerHeight - r.bottom - 16) + 'px';
      more.setAttribute('aria-expanded', 'true');
      openMenu = { menu: menu, more: more };
      var firstItem = menu.querySelector('[role=menuitem]');
      if (firstItem) firstItem.focus();
      menu.addEventListener('keydown', function (e) {
        var items = Array.prototype.slice.call(menu.querySelectorAll('[role=menuitem]'));
        var i = items.indexOf(d.activeElement);
        var n = e.key === 'ArrowDown' ? i + 1 : e.key === 'ArrowUp' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : null;
        if (n === null) { if (e.key === 'Tab') closeMenu(false); return; }
        e.preventDefault();
        items[(n + items.length) % items.length].focus();
      });
    });

    if ('ResizeObserver' in window) new ResizeObserver(function () { fit(); }).observe(row.parentNode);
    else window.addEventListener('resize', fit);
    if ('MutationObserver' in window) new MutationObserver(function () { if (!tabs.some(function (t) { return isOn(t) && t.hidden; })) return; fit(); }).observe(row, { subtree: true, attributes: true, attributeFilter: ['aria-selected', 'aria-current'] });
    if (d.fonts && d.fonts.ready) d.fonts.ready.then(fit);
    fit();
    row._fit = fit;
    return fit;
  }

  // Tabs (install picker). The chosen app is remembered across pages.
  var KEY = 'oa-app';
  function select(root, tab, focus) {
    var tabs = root.querySelectorAll('[role=tab]');
    for (var i = 0; i < tabs.length; i++) {
      var on = tabs[i] === tab;
      tabs[i].setAttribute('aria-selected', String(on));
      tabs[i].tabIndex = on ? 0 : -1;
      var p = d.getElementById(tabs[i].getAttribute('aria-controls'));
      if (p) { if (on) p.removeAttribute('data-hidden'); else p.setAttribute('data-hidden', ''); }
    }
    var list = root.querySelector('.tab-list');
    if (list && list._fit && tab.hidden) list._fit();
    if (focus) tab.focus();
  }
  var roots = d.querySelectorAll('[data-tabs]');
  var saved = null;
  try { saved = localStorage.getItem(KEY); } catch (_) {}
  Array.prototype.forEach.call(roots, function (root) {
    var tabs = Array.prototype.slice.call(root.querySelectorAll('[role=tab]'));
    var list = root.querySelector('.tab-list');
    if (list) tabStrip(list, function (t) { return t.getAttribute('aria-selected') === 'true'; }, function (t) {
      var p = d.getElementById(t.getAttribute('aria-controls'));
      var small = p && p.querySelector('.tab-panel-title small');
      return small ? small.textContent : '';
    });
    if (saved) {
      var s = tabs.filter(function (x) { return x.id.slice(x.id.indexOf('-tab-') + 5) === saved; })[0];
      if (s) select(root, s, false);
    }
    root.addEventListener('click', function (e) {
      var tab = e.target.closest('[role=tab]');
      if (!tab) return;
      select(root, tab, false);
      try { localStorage.setItem(KEY, tab.id.slice(tab.id.indexOf('-tab-') + 5)); } catch (_) {}
    });
    root.addEventListener('keydown', function (e) {
      var i = tabs.indexOf(d.activeElement);
      if (i < 0) return;
      var n = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : null;
      if (n === null) return;
      e.preventDefault();
      select(root, tabs[(n + tabs.length) % tabs.length], true);
    });
  });

  // Docs: on wide screens the nav is always open.
  var nav = d.querySelector('[data-docs-nav]');
  if (nav && window.matchMedia) {
    var mq = window.matchMedia('(min-width: 960px)');
    var sync = function () { if (mq.matches) nav.setAttribute('open', ''); };
    sync();
    if (mq.addEventListener) mq.addEventListener('change', sync);
    var cur = nav.querySelector('[aria-current=page]');
    if (cur && mq.matches && cur.scrollIntoView) {
      var list = nav.querySelector('.docs-nav');
      if (list && cur.offsetTop > list.clientHeight - 80) list.scrollTop = cur.offsetTop - 120;
    }
  }

  // Docs: highlight the current heading in "On this page".
  var toc = d.querySelectorAll('.toc a');
  if (toc.length && 'IntersectionObserver' in window) {
    var map = {};
    Array.prototype.forEach.call(toc, function (a) { map[decodeURIComponent(a.hash.slice(1))] = a; });
    var heads = Array.prototype.filter.call(d.querySelectorAll('.prose h2[id], .prose h3[id]'), function (h) { return map[h.id]; });
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        Array.prototype.forEach.call(toc, function (a) { a.classList.remove('on'); });
        map[en.target.id].classList.add('on');
      });
    }, { rootMargin: '0px 0px -70% 0px' });
    heads.forEach(function (h) { io.observe(h); });
  }

  // Home: the live stage. Each tab is one of the playground's demos, shown in a frame (`<demo>/?embed=1`, the demo's
  // own page without its hint bar). No frame exists until the page has loaded and the stage is near the viewport, so
  // the page never waits for an editor; on a small screen or a data-saving connection, not until someone asks.
  var stage = d.querySelector('[data-stage]');
  if (stage) (function () {
    var view = stage.querySelector('[data-stage-view]');
    var veil = stage.querySelector('[data-stage-veil]');
    var open = stage.querySelector('[data-stage-open]');
    var load = stage.querySelector('[data-stage-load]');
    var again = stage.querySelector('[data-stage-replay]');
    var lang = /^zh/i.test(d.documentElement.lang || '') ? 'zh' : 'en';
    var tabs = Array.prototype.slice.call(stage.querySelectorAll('[data-demo]'));
    tabStrip(stage.querySelector('.stage-tabs'), function (a) { return a.getAttribute('aria-current') === 'true'; }, null);
    var base = stage.getAttribute('data-base');
    var KEEP = 3;       // loaded demos kept alive (with what was done in them); the least recently shown one goes
    var frames = {};    // demo -> { el, ready, replay: what the demo says of its replay ('ready' | 'playing' | 'done') }
    var recent = [];
    var current = (stage.querySelector('[data-demo][aria-current=true]') || tabs[0]).getAttribute('data-demo');
    var wanted = false; // frames may load
    var active = false; // the pointer and keyboard are the demo's
    var seen = !('IntersectionObserver' in window); // enough of the stage is in view to watch a replay

    function tell(f, what) { try { f.el.contentWindow.postMessage({ openArtifactDemo: what, chip: active }, location.origin); } catch (_) {} }
    function replaying(f) { return !!f && (f.replay === 'ready' || f.replay === 'playing'); }
    // A demo plays its replay (the agent's session that makes the artifact) only while it is the one on show and in view.
    // Its own "Skip" shows (`chip`) once the veil, which skips on a click, is out of the way.
    function conduct() { for (var k in frames) if (replaying(frames[k])) tell(frames[k], k === current && seen ? 'play' : 'pause'); }
    function tabOf(demo) { return tabs.filter(function (a) { return a.getAttribute('data-demo') === demo; })[0]; }
    function sync() {
      var f = frames[current];
      stage.setAttribute('data-state', f && f.ready ? 'ready' : wanted ? 'loading' : 'idle');
      if (active) stage.setAttribute('data-active', ''); else stage.removeAttribute('data-active');
      veil.hidden = !(f && f.ready) || active;
      if (replaying(f)) stage.setAttribute('data-replay', 'playing'); else if (f && f.replay === 'done') stage.setAttribute('data-replay', 'done'); else stage.removeAttribute('data-replay');
      again.hidden = !(f && f.replay === 'done');
      conduct();
      for (var k in frames) { if (k === current) frames[k].el.setAttribute('data-on', ''); else frames[k].el.removeAttribute('data-on'); }
    }
    function ready(demo) {
      if (!frames[demo] || frames[demo].ready) return;
      frames[demo].ready = true;
      sync();
      if (active && demo === current) focusFrame();
    }
    function ensure(demo) {
      if (!frames[demo]) {
        var el = d.createElement('iframe');
        el.className = 'stage-frame';
        el.title = tabOf(demo).getAttribute('data-name') + ' · ' + stage.getAttribute('data-frame-title');
        el.setAttribute('allow', 'clipboard-read; clipboard-write; fullscreen');
        el.setAttribute('allowfullscreen', '');
        // The Shell greets its parent (shell_hello) once it is up; a page that never does still shows after a while.
        el.addEventListener('load', function () { setTimeout(function () { ready(demo); }, 4000); });
        // `replay=hold`: the demo's replay waits for `play` (conduct, above).
        el.src = base + demo + '/?embed=1&replay=hold&lang=' + lang;
        frames[demo] = { el: el, ready: false, replay: null };
        view.insertBefore(el, veil);
      }
      recent = recent.filter(function (x) { return x !== demo; });
      recent.push(demo);
      while (recent.length > KEEP) {
        var old = recent.shift();
        view.removeChild(frames[old].el);
        delete frames[old];
      }
    }
    function focusFrame() {
      var f = frames[current];
      try { if (f) f.el.contentWindow.focus(); } catch (_) {}
    }
    function show(demo) {
      var tab = tabOf(demo);
      if (!tab) return false;
      current = demo;
      tabs.forEach(function (a) { if (a === tab) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current'); });
      ['--tint', '--wash', '--ink'].forEach(function (v) { stage.style.setProperty(v, tab.style.getPropertyValue(v)); });
      stage.querySelector('[data-stage-name]').textContent = tab.getAttribute('data-name');
      stage.querySelector('[data-stage-line]').textContent = tab.getAttribute('data-line');
      stage.querySelector('[data-stage-icon]').innerHTML = tab.querySelector('svg').outerHTML.replace(/(width|height)="\d+"/g, '$1="28"');
      open.href = load.href = tab.href;
      if (tab.parentNode._fit && tab.hidden) tab.parentNode._fit();
      if (wanted) ensure(demo);
      sync();
      return true;
    }
    function start() {
      if (wanted) return;
      wanted = true;
      ensure(current);
      sync();
    }
    function setActive(on) {
      if (active === on) return;
      active = on;
      sync();
      if (on) focusFrame();
    }
    var plain = function (e) { return !(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button); };

    window.addEventListener('message', function (e) {
      if (e.origin !== location.origin || !e.data) return;
      var hello = e.data.openArtifact === 'shell_hello';
      var replay = e.data.openArtifactDemo === 'replay' ? e.data.state : null;
      if (!hello && !replay) return;
      for (var k in frames) {
        if (frames[k].el.contentWindow !== e.source) continue;
        // A demo with a replay is worth showing as soon as its session is up, before its editor.
        if (replay) frames[k].replay = replay;
        ready(k);
        sync();
      }
    });
    stage.addEventListener('click', function (e) {
      if (!plain(e)) return;
      var tab = e.target.closest('[data-demo]');
      if (tab) { e.preventDefault(); wanted = true; show(tab.getAttribute('data-demo')); return; }
      if (e.target.closest('[data-stage-load]')) { e.preventDefault(); start(); setActive(true); return; }
      if (e.target.closest('[data-stage-replay]')) {
        var f = frames[current];
        if (!f) return;
        f.replay = null;
        tell(f, 'restart');
        setActive(false);
        sync();
        return;
      }
      if (e.target.closest('[data-stage-veil]')) {
        if (replaying(frames[current])) tell(frames[current], 'skip');
        setActive(true);
      }
    });
    // "Try it live" on a type's card: that demo, here.
    d.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('[data-stage-demo]');
      if (!a || !plain(e)) return;
      wanted = true;
      if (!show(a.getAttribute('data-stage-demo'))) return;
      e.preventDefault();
      stage.scrollIntoView({ behavior: window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
    });
    // The demo gives the pointer back: a press outside the stage, Escape, or the stage scrolling out of view.
    d.addEventListener('pointerdown', function (e) { if (active && !stage.contains(e.target)) setActive(false); });
    d.addEventListener('keydown', function (e) { if (e.key === 'Escape') setActive(false); });
    // Keyboard focus moving into the frame (Tab) is asking for it too.
    window.addEventListener('blur', function () {
      setTimeout(function () { var f = frames[current]; if (f && f.ready && d.activeElement === f.el) setActive(true); });
    });

    var conn = navigator.connection;
    var saving = !!conn && (conn.saveData || /(^|-)2g$/.test(conn.effectiveType || ''));
    var small = !!window.matchMedia && matchMedia('(max-width: 760px)').matches;
    var auto = !saving && !small;
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (!en.isIntersecting || en.intersectionRatio < 0.25) setActive(false);
          seen = en.isIntersecting && en.intersectionRatio >= 0.3;
        });
        conduct();
      }, { threshold: [0, 0.25, 0.3] }).observe(view);
    }
    sync();
    if (auto) {
      var go = function () {
        var idle = window.requestIdleCallback || function (fn) { return setTimeout(fn, 200); };
        var kick = function () { idle(start, { timeout: 1500 }); };
        if (!('IntersectionObserver' in window)) return kick();
        var near = new IntersectionObserver(function (entries) {
          if (!entries.some(function (en) { return en.isIntersecting; })) return;
          near.disconnect();
          kick();
        }, { rootMargin: '400px 0px' });
        near.observe(stage);
      };
      if (d.readyState === 'complete') go(); else window.addEventListener('load', go);
    }
  })();
})();
