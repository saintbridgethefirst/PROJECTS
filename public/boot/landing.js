/* (Kept after the footer: CSS hides the footer with #auth-screen[hidden] + .auth-footer.)
     Visitors who aren't signed in see the landing page at once, straight from this HTML, instead of a
     spinner while the app loads (faster for people, and what search engines read first). The app takes
     over when it starts. Signed-in people (tt_signed_in) and app links (#/t/…, /demo) keep the spinner. */
  (function () { try {
    var p = location.pathname, h = location.hash;
    if ((p !== '/' && p !== '/index.html') || (h && h !== '#' && h.indexOf('#lp-') !== 0)) return;
    if (localStorage.getItem('tt_signed_in') === '1') return;
    document.getElementById('auth-screen').hidden = false; document.getElementById('loading').hidden = true;
  } catch (e) {} })();
