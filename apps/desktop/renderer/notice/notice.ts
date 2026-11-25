import type { NoticeData } from '../../src/types.ts';
// The notice's page: it draws what the main process sends (a saved file: `{ id, name, where, words }`; a message of
// how something went: `{ id: null, name: <message>, where: '', kind }`) and sends back Show in Finder (by the
// notice's id), Close, and whether the pointer rests on it (it stays while it does).
(() => {
  const bridge = window.notice;
  const card = document.querySelector<HTMLElement>('.notice')!;
  const name = document.querySelector<HTMLElement>('.notice-name')!;
  const where = document.querySelector<HTMLElement>('.notice-where')!;
  const reveal = document.querySelector<HTMLElement>('.notice-reveal')!;
  const close = document.querySelector<HTMLElement>('.notice-close')!;
  const mark = document.querySelector<SVGPathElement>('.notice-icon path')!;
  const MARKS = { ok: mark.getAttribute('d') ?? '', error: 'M8 4v5M8 11.6v.4' };
  let current: NoticeData | null = null;
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
    where.hidden = !notice.where;
    card.dataset.kind = notice.kind || 'saved';
    mark.setAttribute('d', notice.kind === 'error' ? MARKS.error : MARKS.ok);
    reveal.hidden = !notice.id;
    reveal.textContent = notice.words.reveal;
    close.setAttribute('aria-label', notice.words.close);
    close.title = notice.words.close;
    card.hidden = false;
    // Restart the entrance.
    card.style.animation = 'none';
    void card.offsetWidth;
    card.style.animation = '';
  });
  reveal.addEventListener('click', () => current?.id && bridge.reveal(current.id));
  close.addEventListener('click', () => bridge.dismiss());
  card.addEventListener('mouseenter', () => bridge.hover(true));
  card.addEventListener('mouseleave', () => bridge.hover(false));
  bridge.ready();
})();
