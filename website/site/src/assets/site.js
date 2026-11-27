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
    if (focus) tab.focus();
  }
  var roots = d.querySelectorAll('[data-tabs]');
  var saved = null;
  try { saved = localStorage.getItem(KEY); } catch (_) {}
  Array.prototype.forEach.call(roots, function (root) {
    var tabs = Array.prototype.slice.call(root.querySelectorAll('[role=tab]'));
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
      if (tab.scrollIntoView && tab.parentNode.scrollWidth > tab.parentNode.clientWidth) tab.parentNode.scrollLeft = tab.offsetLeft - tab.parentNode.offsetLeft - 40;
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
