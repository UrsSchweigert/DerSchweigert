// phone-frame.js — on a wide screen the web game plays inside a portrait phone frame.
//
// The game is laid out for a phone held upright. On a desktop or a tablet the page shows a
// centred, iPhone-shaped frame instead, and the game runs inside it in an <iframe> of a fixed
// 390x844 (iPhone 12-15) screen. An iframe, not a CSS box: inside it the viewport *is* the
// phone screen, so every media query, viewport unit, position:fixed overlay and
// getBoundingClientRect the game relies on keeps meaning "the phone", and nothing in the game
// had to learn about the frame. A real phone (narrow, or short in landscape) gets the game
// full screen exactly as before, and the apps never load this file (index.html wraps it in
// app-omit, see mobile/scripts/copy-assets.mjs).
//
// A classic, synchronous script at the end of <head>, because it has to decide before the
// body is parsed: the page that hosts the frame must not also start a second copy of the game
// (main.js, its audio and its API calls). It stops that with document.write('<plaintext>'):
// the rest of the document becomes inert text, so nothing below loads or runs, and the host
// then replaces it with the frame. The page inside the frame is the same index.html, which
// sees that it is framed and runs normally.
//
// Framing needs the site's CSP to allow it (frame-ancestors 'self' and frame-src 'self', see
// infra/terraform/sites/ffm/main.tf). If the frame cannot load the game anyway (an older
// browser that still obeys X-Frame-Options), the host remembers that for the session and
// reloads without the frame, so the game is never lost behind an empty phone.
(function (win) {
  'use strict';

  // Wide enough that a phone held upright is not it, tall enough that a phone in landscape
  // (at most ~430px high) is not it either. Keep equal to phone-frame.css.
  var FRAME_QUERY = '(min-width: 600px) and (min-height: 500px)';
  var SCREEN = { width: 390, height: 844 };
  var BEZEL = 12;
  var MARGIN = 16;
  var NO_FRAME_KEY = 'arithmoslayer:no-phone-frame';

  /**
   * 'screen' inside the frame, 'host' for the page that shows the frame, 'none' otherwise.
   * @param {{isTop: boolean, wide: boolean, noFrame: boolean}} env
   */
  function decide(env) {
    if (!env.isTop) return 'screen';
    if (env.noFrame || !env.wide) return 'none';
    return 'host';
  }

  /** How far the frame shrinks so that it, its bezel and a margin fit the window (never grows). */
  function frameScale(width, height) {
    var byHeight = (height - 2 * MARGIN) / (SCREEN.height + 2 * BEZEL);
    var byWidth = (width - 2 * MARGIN) / (SCREEN.width + 2 * BEZEL);
    var scale = Math.min(1, byHeight, byWidth);
    return scale > 0 ? scale : 1;
  }

  /** True when the session (or the URL, as a manual escape hatch) asks for no frame. */
  function noFrameRequested(location, storage) {
    if (/[?&]noframe=1(?:&|$)/.test(location.search || '')) return true;
    try { return storage.getItem(NO_FRAME_KEY) === '1'; } catch (error) { return false; }
  }

  win.ArithmoPhoneFrame = {
    FRAME_QUERY: FRAME_QUERY, SCREEN: SCREEN, BEZEL: BEZEL, MARGIN: MARGIN, NO_FRAME_KEY: NO_FRAME_KEY,
    decide: decide, frameScale: frameScale, noFrameRequested: noFrameRequested,
  };

  var doc = win.document;
  if (!doc || !doc.documentElement) return;   // loaded by a test, not a page

  var isTop = true;
  try { isTop = win.top === win.self; } catch (error) { isTop = false; }
  var storage = null;
  try { storage = win.sessionStorage; } catch (error) { storage = null; }
  var mode = decide({
    isTop: isTop,
    wide: Boolean(win.matchMedia && win.matchMedia(FRAME_QUERY).matches),
    noFrame: noFrameRequested(win.location, storage || { getItem: function () { return null; } }),
  });
  if (mode === 'none') return;
  doc.documentElement.setAttribute('data-phone-frame', mode);

  if (mode === 'screen') {
    // The game rewrites its own URL (it drops a used reset token or a checkout result). Keep
    // the address bar of the host in step, so a reload or a bookmark does not replay them.
    var mirror = function (method) {
      var original = win.history && win.history[method];
      if (typeof original !== 'function') return;
      win.history[method] = function () {
        var result = original.apply(this, arguments);
        try { win.top.history.replaceState(win.top.history.state, '', win.location.href); } catch (error) { /* not same-origin: leave it */ }
        return result;
      };
    };
    mirror('replaceState');
    mirror('pushState');
    return;
  }

  // Host: nothing after this script may load or run (see the header comment).
  doc.write('<plaintext hidden>');

  var applyScale = function (frame) {
    frame.style.setProperty('--phone-frame-scale', String(frameScale(win.innerWidth, win.innerHeight)));
  };
  var fallBack = function () {
    try { win.sessionStorage.setItem(NO_FRAME_KEY, '1'); win.location.reload(); return; } catch (error) { /* no session storage */ }
    var search = win.location.search ? win.location.search + '&noframe=1' : '?noframe=1';
    win.location.replace(win.location.pathname + search + win.location.hash);
  };
  doc.addEventListener('DOMContentLoaded', function () {
    var frame = doc.createElement('div');
    frame.className = 'phone-frame';
    var view = doc.createElement('iframe');
    view.className = 'phone-frame-screen';
    view.title = 'Arithmo Slayer';
    view.setAttribute('allow', 'autoplay; fullscreen');
    view.width = String(SCREEN.width);
    view.height = String(SCREEN.height);
    view.addEventListener('load', function () {
      var framed = false;
      try { framed = view.contentDocument.documentElement.getAttribute('data-phone-frame') === 'screen'; } catch (error) { framed = false; }
      if (!framed) { fallBack(); return; }
      try { view.contentWindow.focus(); } catch (error) { /* focus follows the first tap instead */ }
    }, { once: true });
    view.src = win.location.href;
    frame.appendChild(view);
    applyScale(frame);
    win.addEventListener('resize', function () { applyScale(frame); });
    doc.body.replaceChildren(frame);
  });
})(typeof window !== 'undefined' ? window : globalThis);
