/* The site's home is app.penteint.com. Anyone arriving on the old Firebase addresses is sent to the same
   page there, so old links, bookmarks and QR codes keep working. Firebase's own sign-in pages (/__/…)
   and the sign-in pop-up's return page (blank.html) are left alone, and so are preview sites
   (uni-teamtrack--pr-12-….web.app). Loaded first, before anything else, on every page. */
(function () {
  var HOME = 'app.penteint.com';
  var OLD = ['uni-teamtrack.web.app', 'uni-teamtrack.firebaseapp.com'];
  var h = location.hostname, p = location.pathname;
  if (OLD.indexOf(h) === -1 || p.indexOf('/__/') === 0 || /\/blank\.html$/.test(p)) return;
  location.replace('https://' + HOME + p + location.search + location.hash);
})();
