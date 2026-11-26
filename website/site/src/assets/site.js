// Small progressive enhancements: copy buttons, install tabs, mobile menu, language choice.
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
})();
