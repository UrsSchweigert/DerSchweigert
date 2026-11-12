// Progressive enhancement for the marketing page: scroll reveals, the sticky header
// shadow and the mobile call-to-action bar. Everything here is optional - without
// JavaScript the page renders fully visible and static.

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const header = document.querySelector('.site-header');
const updateHeader = () => header.classList.toggle('is-scrolled', window.scrollY > 8);
updateHeader();
window.addEventListener('scroll', updateHeader, { passive: true });

const reveals = [...document.querySelectorAll('.reveal')];
if (!reduceMotion && 'IntersectionObserver' in window) {
  let observerAnswered = false;
  const observer = new IntersectionObserver(entries => {
    observerAnswered = true;
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.remove('is-hidden');
      observer.unobserve(entry.target);
    }
  }, { rootMargin: '0px 0px -12% 0px' });

  const hidden = [];
  for (const element of reveals) {
    // Only hide what is still below the fold, so nothing flashes or shifts on load.
    if (element.getBoundingClientRect().top > window.innerHeight * 0.92) {
      element.classList.add('is-hidden');
      observer.observe(element);
      hidden.push(element);
    }
  }

  // If the observer never reports back, never leave content invisible.
  window.setTimeout(() => {
    if (observerAnswered) return;
    for (const element of hidden) element.classList.remove('is-hidden');
  }, 3000);
}

const mobileCta = document.querySelector('#mobile-cta');
if (mobileCta && 'IntersectionObserver' in window) {
  const hero = document.querySelector('.hero');
  const footer = document.querySelector('footer');
  const state = { heroPassed: false, footerVisible: false };
  const apply = () => mobileCta.classList.toggle('is-visible', state.heroPassed && !state.footerVisible);

  new IntersectionObserver(([entry]) => {
    state.heroPassed = !entry.isIntersecting;
    apply();
  }, { threshold: 0 }).observe(hero);

  new IntersectionObserver(([entry]) => {
    state.footerVisible = entry.isIntersecting;
    apply();
  }, { threshold: 0 }).observe(footer);
}
