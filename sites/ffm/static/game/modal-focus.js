// Only gameplay dialogs are managed here; account and title dialogs have their own owners.
export function initGameplayModalFocus({ doc = globalThis.document } = {}) {
  const win = doc?.defaultView;
  const overlays = ['pause-overlay', 'heal-tip-overlay', 'level-clear', 'game-over', 'skill-intro']
    .map(id => doc?.getElementById(id)).filter(Boolean);
  if (!doc?.body || !win || !overlays.length) return { refresh() {}, destroy() {} };
  const selector = 'button, input, select, textarea, a[href], [tabindex]';
  const savedInert = new Map();
  let active = null;
  let previousFocus = null;
  let destroyed = false;

  function visible(element) {
    if (!element?.isConnected) return false;
    for (let node = element; node && node.nodeType === 1; node = node.parentElement) {
      const style = win.getComputedStyle(node);
      if (node.hidden || style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
    }
    return true;
  }
  function focusable(overlay) {
    return [...overlay.querySelectorAll(selector)].filter(el =>
      !el.disabled && el.tabIndex >= 0 && !el.closest('[inert]') && visible(el));
  }
  function focusFirst() {
    (focusable(active)[0] || active)?.focus();
  }
  function restoreBackground() {
    for (const [el, wasInert] of savedInert) {
      if (el.inert !== wasInert) el.inert = wasInert;
    }
    savedInert.clear();
  }
  function refresh() {
    if (destroyed) return;
    const next = overlays.filter(visible).at(-1) || null;
    if (!next) {
      if (!active) return;
      active = null;
      restoreBackground();
      if (visible(previousFocus) && !previousFocus.disabled && !previousFocus.closest('[inert]')) previousFocus.focus();
      previousFocus = null;
      return;
    }
    const changed = next !== active;
    if (!active) previousFocus = doc.activeElement;
    active = next;
    for (const child of doc.body.children) {
      if (!savedInert.has(child)) savedInert.set(child, !!child.inert);
      const inert = child === active ? savedInert.get(child) : true;
      if (child.inert !== inert) child.inert = inert;
    }
    if (changed || !active.contains(doc.activeElement) || !visible(doc.activeElement)
      || doc.activeElement.disabled || (doc.activeElement === active && focusable(active).length)) focusFirst();
  }
  function keydown(event) {
    if (!active || event.key !== 'Tab') return;
    const choices = focusable(active);
    if (!choices.length) {
      event.preventDefault();
      active.focus();
      return;
    }
    const index = choices.indexOf(doc.activeElement);
    if (event.shiftKey && index <= 0) {
      event.preventDefault();
      choices.at(-1).focus();
    } else if (!event.shiftKey && (index < 0 || index === choices.length - 1)) {
      event.preventDefault();
      choices[0].focus();
    }
  }
  function focusin(event) {
    if (active && !active.contains(event.target)) focusFirst();
  }
  for (const overlay of overlays) {
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    const heading = overlay.querySelector('h2');
    if (heading) {
      if (!heading.id) heading.id = `${overlay.id}-title`;
      overlay.setAttribute('aria-labelledby', heading.id);
    }
    if (!overlay.hasAttribute('tabindex')) overlay.setAttribute('tabindex', '-1');
  }
  const observer = win.MutationObserver ? new win.MutationObserver(refresh) : null;
  const observed = new Set();
  for (const overlay of overlays) {
    const targets = [overlay, ...overlay.querySelectorAll(selector)];
    for (const target of targets) {
      for (let node = target; node && overlay.contains(node); node = node.parentElement) {
        if (observed.has(node)) continue;
        observed.add(node);
        observer?.observe(node, {
          attributes: true, attributeFilter: ['style', 'hidden', 'class', 'disabled'],
        });
      }
    }
  }
  doc.addEventListener('keydown', keydown);
  doc.addEventListener('focusin', focusin);
  refresh();
  return {
    refresh,
    destroy() {
      destroyed = true;
      observer?.disconnect();
      doc.removeEventListener('keydown', keydown);
      doc.removeEventListener('focusin', focusin);
      restoreBackground();
      active = null;
    },
  };
}
