/**
 * Marks a `.scroll-thin` area with `is-scrolling` while it scrolls, so its
 * scrollbar thumb darkens (see index.css). Returns the cleanup.
 */
export function watchScrolling(): () => void {
  const timers = new Map<Element, number>();
  const onScroll = (e: Event) => {
    const el = e.target === document ? document.documentElement : e.target;
    if (
      !(el instanceof Element) ||
      !(el === document.documentElement || el.classList.contains('scroll-thin'))
    ) {
      return;
    }
    el.classList.add('is-scrolling');
    window.clearTimeout(timers.get(el));
    timers.set(
      el,
      window.setTimeout(() => {
        el.classList.remove('is-scrolling');
        timers.delete(el);
      }, 700),
    );
  };
  // Scroll events don't bubble; capturing sees every scrolling element.
  document.addEventListener('scroll', onScroll, { capture: true, passive: true });
  return () => {
    document.removeEventListener('scroll', onScroll, { capture: true });
    timers.forEach((t) => window.clearTimeout(t));
  };
}
