/* Apply the saved theme pack before anything is drawn (no flash of the wrong colours). Full logic: src/themes.js */
  try { var t = localStorage.getItem('tt_theme') || (localStorage.getItem('themePref') === 'light' ? 'daylight' : 'midnight');
    if (t === 'auto') t = matchMedia('(prefers-color-scheme: dark)').matches ? 'midnight' : 'daylight';
    var light = ['daylight', 'paper', 'sakura', 'mint', 'contrast-light'].indexOf(t) > -1, r = document.documentElement;
    if (light) r.setAttribute('data-theme', 'light'); if (t !== 'midnight' && t !== 'daylight') r.setAttribute('data-pack', t);
  } catch (e) {}
