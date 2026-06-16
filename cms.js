/* Pages CMS content loader for the MOW homepage.
   Reads content/home.json and injects copy + SEO meta into the live page,
   so the site is edited via labeled form fields in Pages CMS (not raw HTML). */
(function () {
  var DATA_URL = 'content/home.json';
  var data = null;

  function getPath(o, p) {
    return p.split('.').reduce(function (a, k) { return a == null ? a : a[k]; }, o);
  }

  // Inject any element tagged with data-cms="dotted.path"
  function applyText() {
    if (!data) return;
    var nodes = document.querySelectorAll('[data-cms]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var v = getPath(data, el.getAttribute('data-cms'));
      if (v != null && el.textContent !== String(v)) el.textContent = v;
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

  // Push the editable section headlines into the component's EN dictionary
  // so they survive the language toggle, then re-apply.
  function patchLabels() {
    var MOW = window.MOW;
    if (!MOW || !MOW.i18n || !MOW.i18n.en || !data || !data.labels) return false;
    for (var k in data.labels) {
      if (data.labels.hasOwnProperty(k)) MOW.i18n.en[k] = data.labels[k];
    }
    if (typeof MOW.applyLang === 'function') {
      if (!MOW.__cmsWrapped) {
        var orig = MOW.applyLang.bind(MOW);
        MOW.applyLang = function (lang) { orig(lang); applyText(); };
        MOW.__cmsWrapped = true;
      }
      var lang = (MOW.state && MOW.state.lang) || 'en';
      MOW.applyLang(lang);
    } else {
      applyText();
    }
    return true;
  }

  function boot() {
    fetch(DATA_URL, { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        data = j;
        applyMeta();
        applyText();
        var tries = 0;
        (function wait() {
          if (patchLabels()) return;
          if (tries++ < 80) setTimeout(wait, 100);
          else applyText();
        })();
      })
      .catch(function () {});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
