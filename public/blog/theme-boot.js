/* Blog and landing pages: apply the saved light/dark choice before the page is drawn (no flash).
   An external file, not inline script, so the site's security policy can refuse inline script. */
try{var m=localStorage.getItem('tt_blog_theme');if(m&&m!=='system')document.documentElement.setAttribute('data-theme',m);}catch(e){}
