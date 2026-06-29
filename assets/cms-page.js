/* Generic CMS loader for static content pages (framework pages, etc.).
   The page declares its content file with <body data-cms-page="frameworks/messaging-matrix">.
   On the live site it fetches /content/<page>.json and injects:
     - meta:   document.title + description + og:title/description
     - text:   every [data-cms-text="dotted.key"] -> textContent
     - images: every [data-cms-img="dotted.key"]  -> src   (duplicate marquee
               images share a key, so each is ONE swappable slot)

   TRILINGUAL: a text value may be a plain string OR an object {en,fa,es}. The
   active language comes from <html lang> and from clicking a [data-langbtn]
   button (the shared nav toggle); on language change the text re-renders. Image
   values are shared across languages. Falls back to English for missing
   translations. Best-effort: on fetch failure the static HTML is left as-is. */
(function () {
  var page = document.body && document.body.getAttribute('data-cms-page');
  if (!page) return;
  var host = (location.hostname || '').toLowerCase();
  var live = host.indexOf('mow.media') > -1 || host.indexOf('github.io') > -1 ||
             host === 'localhost' || host === '127.0.0.1';
  if (!live) return;

  var data = null;
  var lang = (document.documentElement.getAttribute('lang') || 'en').slice(0, 2);

  function get(obj, path) {
    var parts = String(path).split('.'), cur = obj;
    for (var i = 0; i < parts.length; i++) {
      if (cur == null) return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }
  function pick(v) {
    if (v && typeof v === 'object') return v[lang] != null ? v[lang] : v.en;
    return v;
  }
  function setMeta(sel, val) {
    var m = document.querySelector(sel);
    if (m && val != null && val !== '') m.setAttribute('content', val);
  }

  function applyText() {
    if (!data) return;
    var els = document.querySelectorAll('[data-cms-text]');
    for (var i = 0; i < els.length; i++) {
      var v = pick(get(data, els[i].getAttribute('data-cms-text')));
      if (v != null) {
        els[i].textContent = v;
        els[i].style.direction = (lang === 'fa') ? 'rtl' : 'ltr';
      }
    }
    if (data.meta) {
      var t = pick(data.meta.title), d = pick(data.meta.description);
      if (t) {
        document.title = t;
        setMeta('meta[property="og:title"]', t);
        setMeta('meta[name="twitter:title"]', t);
      }
      if (d) {
        setMeta('meta[name="description"]', d);
        setMeta('meta[property="og:description"]', d);
        setMeta('meta[name="twitter:description"]', d);
      }
    }
  }

  function applyImages() {
    if (!data) return;
    var imgs = document.querySelectorAll('[data-cms-img]');
    for (var j = 0; j < imgs.length; j++) {
      var iv = get(data, imgs[j].getAttribute('data-cms-img'));
      if (iv != null && typeof iv === 'string' && iv !== '' &&
          imgs[j].getAttribute('src') !== iv) {
        imgs[j].setAttribute('src', iv);
      }
    }
  }

  // Re-render body copy when the shared language toggle is clicked.
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-langbtn]');
    if (b && data) {
      var l = b.getAttribute('data-langbtn');
      if (l && l !== lang) { lang = l; applyText(); }
    }
  });

  fetch('/content/' + page + '.json', { cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (d) { data = d; applyImages(); applyText(); })
    .catch(function () { /* leave static HTML as-is */ });
})();
