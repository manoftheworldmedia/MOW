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
    if (data.meta.title) {
      document.title = data.meta.title;
      var ogt = document.querySelector('meta[property="og:title"]');
      if (ogt) ogt.setAttribute('content', data.meta.title);
      var twt = document.querySelector('meta[name="twitter:title"]');
      if (twt) twt.setAttribute('content', data.meta.title);
    }
    if (data.meta.description) {
      var m = document.querySelector('meta[name="description"]');
      if (m) m.setAttribute('content', data.meta.description);
      var og = document.querySelector('meta[property="og:description"]');
      if (og) og.setAttribute('content', data.meta.description);
      var twd = document.querySelector('meta[name="twitter:description"]');
      if (twd) twd.setAttribute('content', data.meta.description);
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

  // Render the FAQ list from home.json (faqs[]), and keep the SEO FAQ schema
  // (JSON-LD) in sync. Falls back silently to the static HTML if anything's off.
  function renderFaqs() {
    if (!data || !Array.isArray(data.faqs) || !data.faqs.length) return;
    var box = document.getElementById('mow-faq-list');
    if (box) {
      box.innerHTML = '';
      data.faqs.forEach(function (item, i) {
        var last = i === data.faqs.length - 1;
        var d = document.createElement('details');
        d.setAttribute('style', 'border-top:1px solid rgba(26,23,18,0.18);' + (last ? 'border-bottom:1px solid rgba(26,23,18,0.18);' : '') + 'padding:8px 0;');
        var s = document.createElement('summary');
        s.setAttribute('style', "cursor:pointer;font-family:'Bodoni Moda',serif;font-size:clamp(19px,2vw,26px);color:#11281E;padding:22px 40px 22px 0;position:relative;");
        s.appendChild(document.createTextNode(item.question || item.q || ''));
        var plus = document.createElement('span');
        plus.className = 'mow-faqplus';
        plus.setAttribute('style', "position:absolute;right:0;top:22px;font-family:'Archivo',sans-serif;color:#C49C4E;font-size:24px;");
        plus.appendChild(document.createTextNode('+'));
        s.appendChild(plus);
        var p = document.createElement('p');
        p.setAttribute('style', "font-family:'Archivo',sans-serif;font-size:15.5px;line-height:1.72;color:#4A4639;padding:0 40px 26px 0;");
        p.appendChild(document.createTextNode(item.answer || item.a || ''));
        d.appendChild(s); d.appendChild(p);
        box.appendChild(d);
      });
    }
    try {
      var scripts = document.querySelectorAll('script[type="application/ld+json"]');
      for (var j = 0; j < scripts.length; j++) {
        if (scripts[j].textContent.indexOf('"FAQPage"') > -1) {
          scripts[j].textContent = JSON.stringify({
            '@context': 'https://schema.org', '@type': 'FAQPage',
            mainEntity: data.faqs.map(function (f) {
              return { '@type': 'Question', name: f.question || f.q, acceptedAnswer: { '@type': 'Answer', text: f.answer || f.a } };
            }),
          });
          break;
        }
      }
    } catch (e) { /* SEO sync is best-effort */ }
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
        renderFaqs();
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
