/* Pages CMS content loader for the MOW homepage.
   Reads content/home.json and injects copy + SEO meta + images into the live
   page, so the site is edited via labeled form fields in Pages CMS.
   Multilingual: home.json has en / fa / es objects; these are merged into the
   component's i18n dictionaries so the EN/فارسی/ES toggle reads from the CMS. */
(function () {
  var DATA_URL = 'content/home.json';
  var data = null;

  function applyImages() {
    if (!data || !data.images) return;
    var imgs = document.querySelectorAll('[data-cms-img]');
    for (var i = 0; i < imgs.length; i++) {
      var el = imgs[i];
      var key = (el.getAttribute('data-cms-img') || '').replace('images.', '');
      var v = data.images[key];
      if (v != null && el.getAttribute('src') !== String(v)) el.setAttribute('src', v);
    }
  }

  function applyMeta() {
    if (!data || !data.meta) return;
    if (data.meta.title) document.title = data.meta.title;
    if (data.meta.description) {
      var m = document.querySelector('meta[name="description"]');
      if (m) m.setAttribute('content', data.meta.description);
      var og = document.querySelector('meta[property="og:description"]');
      if (og) og.setAttribute('content', data.meta.description);
    }
  }

  // Merge the CMS language objects into the component dictionaries, then re-apply
  // the active language so headlines + hero render from home.json.
  function patchLabels() {
    var MOW = window.MOW;
    if (!MOW || !MOW.i18n || !MOW.i18n.en || !data) return false;
    ['en', 'fa', 'es'].forEach(function (lang) {
      if (data[lang] && MOW.i18n[lang]) {
        for (var k in data[lang]) {
          if (data[lang].hasOwnProperty(k)) MOW.i18n[lang][k] = data[lang][k];
        }
      }
    });
    if (typeof MOW.applyLang === 'function') {
      if (!MOW.__cmsWrapped) {
        var orig = MOW.applyLang.bind(MOW);
        MOW.applyLang = function (l) { orig(l); applyImages(); };
        MOW.__cmsWrapped = true;
      }
      MOW.applyLang((MOW.state && MOW.state.lang) || 'en');
    }
    return true;
  }

  function boot() {
    // Live site only — never inside the design editor, so direct edits there
    // are never clobbered.
    var host = (location.hostname || '').toLowerCase();
    var live = host.indexOf('mow.media') > -1 || host.indexOf('github.io') > -1 || host === 'localhost' || host === '127.0.0.1';
    if (!live) return;
    fetch(DATA_URL, { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        data = j;
        applyMeta();
        applyImages();
        var tries = 0;
        (function wait() {
          if (patchLabels()) return;
          if (tries++ < 80) setTimeout(wait, 100);
        })();
      })
      .catch(function () {});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
