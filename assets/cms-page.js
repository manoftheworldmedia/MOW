/* Generic CMS loader for static content pages (framework pages, etc.).
   The page declares its content file with <body data-cms-page="frameworks/messaging-matrix">.
   On the live site it fetches /content/<page>.json and injects:
     - meta:   document.title + description + og:title/description
     - text:   every [data-cms-text="dotted.key"] -> textContent
     - images: every [data-cms-img="dotted.key"]  -> src   (duplicate marquee
               images share a key, so each is ONE swappable slot)
   English-only for now; values are looked up by dotted path in the JSON.
   Best-effort: if the fetch fails, the static HTML is left exactly as-is. */
(function () {
  var page = document.body && document.body.getAttribute('data-cms-page');
  if (!page) return;
  var host = (location.hostname || '').toLowerCase();
  var live = host.indexOf('mow.media') > -1 || host.indexOf('github.io') > -1 ||
             host === 'localhost' || host === '127.0.0.1';
  if (!live) return;

  function get(obj, path) {
    var parts = String(path).split('.'), cur = obj;
    for (var i = 0; i < parts.length; i++) {
      if (cur == null) return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }
  function setMeta(sel, attr, val) {
    var m = document.querySelector(sel);
    if (m && val != null && val !== '') m.setAttribute(attr, val);
  }

  fetch('/content/' + page + '.json', { cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (d.meta) {
        if (d.meta.title) {
          document.title = d.meta.title;
          setMeta('meta[property="og:title"]', 'content', d.meta.title);
          setMeta('meta[name="twitter:title"]', 'content', d.meta.title);
        }
        if (d.meta.description) {
          setMeta('meta[name="description"]', 'content', d.meta.description);
          setMeta('meta[property="og:description"]', 'content', d.meta.description);
          setMeta('meta[name="twitter:description"]', 'content', d.meta.description);
        }
      }
      var texts = document.querySelectorAll('[data-cms-text]');
      for (var i = 0; i < texts.length; i++) {
        var v = get(d, texts[i].getAttribute('data-cms-text'));
        if (v != null) texts[i].textContent = v;
      }
      var imgs = document.querySelectorAll('[data-cms-img]');
      for (var j = 0; j < imgs.length; j++) {
        var iv = get(d, imgs[j].getAttribute('data-cms-img'));
        if (iv != null && iv !== '' && imgs[j].getAttribute('src') !== String(iv)) {
          imgs[j].setAttribute('src', iv);
        }
      }
    })
    .catch(function () { /* leave static HTML as-is */ });
})();
