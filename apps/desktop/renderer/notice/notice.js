// The "saved" notice's page: it draws what the main process sends (`{ id, name, folder, words }`) and sends back
// Show in Finder (by the notice's id), Close, and whether the pointer rests on it (it stays while it does).
(() => {
  const bridge = window.notice;
  const card = document.querySelector('.notice');
  const name = document.querySelector('.notice-name');
  const where = document.querySelector('.notice-where');
  const reveal = document.querySelector('.notice-reveal');
  const close = document.querySelector('.notice-close');
  let current = null;
  bridge.onShow((notice) => {
    current = notice;
    if (!notice) {
      card.hidden = true;
      return;
    }
    document.documentElement.lang = notice.lang || 'en';
    name.textContent = notice.name;
    name.title = notice.name;
    where.textContent = notice.where;
    reveal.textContent = notice.words.reveal;
    close.setAttribute('aria-label', notice.words.close);
    close.title = notice.words.close;
    card.hidden = false;
    // Restart the entrance.
    card.style.animation = 'none';
    void card.offsetWidth;
    card.style.animation = '';
  });
  reveal.addEventListener('click', () => current && bridge.reveal(current.id));
  close.addEventListener('click', () => bridge.dismiss());
  card.addEventListener('mouseenter', () => bridge.hover(true));
  card.addEventListener('mouseleave', () => bridge.hover(false));
  bridge.ready();
})();
