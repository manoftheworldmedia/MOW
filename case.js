/* MOW case-study loader — makes case pages editable via the portal.
   Each page carries data-case="<id>" and a <html lang>. Content lives in
   content/cases/<id>.json with per-language blocks; the static HTML is the
   fallback, so nothing breaks if the fetch fails. Body paragraphs are updated
   in place so each language keeps its own typographic styling. */
(function () {
  var host = document.querySelector('[data-case]');
  if (!host) return;
  var id = host.getAttribute('data-case');
  var lang = (document.documentElement.getAttribute('lang') || 'en').slice(0, 2);
  fetch('/content/cases/' + id + '.json', { cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (j) {
      var en = j.en || {}, loc = j[lang] || {};
      var pick = function (k) { var v = loc[k]; return (v != null && v !== '') ? v : en[k]; };
      var setText = function (sel, v) { var e = document.querySelector(sel); if (e && v != null && v !== '') e.textContent = v; };
      setText('[data-cms="cat"]', pick('cat'));
      setText('[data-cms="sub"]', pick('sub'));
      setText('[data-cms="title"]', pick('title'));
      setText('[data-cms="subtitle"]', pick('subtitle'));
      var body = pick('body');
      var wrap = document.querySelector('[data-cms-html="body"]');
      if (wrap && Array.isArray(body)) {
        var existing = Array.prototype.slice.call(wrap.querySelectorAll('p'));
        var styleRef = existing.length ? existing[existing.length - 1].getAttribute('style') : '';
        body.forEach(function (item, i) {
          var t = item && item.text != null ? item.text : item;
          if (t == null) t = '';
          var p = existing[i];
          if (!p) { p = document.createElement('p'); if (styleRef) p.setAttribute('style', styleRef); wrap.appendChild(p); }
          p.textContent = t;
        });
        for (var k = body.length; k < existing.length; k++) existing[k].remove();
      }
      var img = document.querySelector('[data-cms-img="image"]');
      if (img && j.image) img.setAttribute('src', j.image);
    })
    .catch(function () {});
})();
