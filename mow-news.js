/* ============================================================
   mow-news.js — Man of the World "News / Articles" reader.

   Used by:
     • the four fixed article pages (each mounts
       <div id="mowArticle" data-article-slug="<slug>"></div>), and
     • the generic reader /news/article.html?slug=<slug>.

   Data contract:
     content/articles.index.json     -> ["slug-a","slug-b", ...] newest-first
     content/articles/<slug>.json    -> {
        date, category, cover, featured,
        en:{title,excerpt,body}, fa:{title,excerpt,body}, es:{title,excerpt,body}
     }
   `body` is rich HTML and is injected as innerHTML (richtext by contract).
   `cover` (e.g. "assets/news/foo.jpg") is relative to the SITE ROOT; these
   pages are not always at the site root, so we resolve everything relative to
   root regardless of page depth (mirrors Caspian's cc-news.js rootPrefix).

   Language: en / fa / es with EN fallback. Detected from a data-article-lang
   attribute on the mount, else <html lang>, else 'en'.
   ============================================================ */
(function () {
  'use strict';

  /* ---------- mount + slug ---------- */
  function findMount() {
    return document.getElementById('mowArticle') ||
           document.querySelector('[data-mow-article]');
  }

  function getSlug(mount) {
    var attr = mount.getAttribute('data-article-slug');
    if (attr) return attr.trim();
    var m = /[?&]slug=([^&]+)/.exec(location.search);
    return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : '';
  }

  /* ---------- language (en/fa/es, EN fallback) ---------- */
  function detectLang(mount) {
    var l = (mount && mount.getAttribute('data-article-lang')) ||
            document.documentElement.getAttribute('lang') ||
            document.documentElement.lang || 'en';
    l = String(l).toLowerCase().slice(0, 2);
    return (l === 'fa' || l === 'es') ? l : 'en';
  }

  /* ---------- path resolution (relative to site ROOT) ---------- */
  function rootPrefix() {
    var p = location.pathname;
    var dir = p.replace(/[^/]*$/, '');           // keep up to last "/"
    var segs = dir.split('/').filter(Boolean);   // non-empty path segments
    var depth = segs.length;
    if (depth <= 0) return './';
    return new Array(depth + 1).join('../');
  }
  var ROOT = rootPrefix();

  function rootAsset(path) {
    if (!path) return '';
    if (/^(https?:)?\/\//.test(path) || path.charAt(0) === '/') return path; // absolute
    return ROOT + path.replace(/^\.?\//, '');
  }
  function contentUrl(path) { return ROOT + path.replace(/^\.?\//, ''); }

  /* ---------- helpers ---------- */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  var MONTHS_EN = ['January','February','March','April','May','June','July',
                   'August','September','October','November','December'];
  var MONTHS_ES = ['enero','febrero','marzo','abril','mayo','junio','julio',
                   'agosto','septiembre','octubre','noviembre','diciembre'];

  // Format "YYYY-MM-DD". EN -> "June 1, 2026". ES -> "1 de junio de 2026".
  // FA -> a safe numeric-ish form ("1 June 2026") to avoid calendar conversion.
  function formatDate(iso, lang) {
    if (!iso) return '';
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso).trim());
    if (!m) return iso;
    var y = +m[1], mo = +m[2] - 1, d = +m[3];
    if (mo < 0 || mo > 11) return iso;
    if (lang === 'es') return d + ' de ' + MONTHS_ES[mo] + ' de ' + y;
    if (lang === 'fa') return d + ' ' + MONTHS_EN[mo] + ' ' + y;
    return MONTHS_EN[mo] + ' ' + d + ', ' + y;
  }

  // Pick a localized field with EN fallback.
  function pickField(post, lang, key) {
    var en = post.en || {};
    var loc = post[lang] || {};
    if (lang !== 'en' && loc[key] != null && loc[key] !== '') return loc[key];
    if (en[key] != null && en[key] !== '') return en[key];
    // last resort: any non-empty other language
    var others = ['en', 'fa', 'es'];
    for (var i = 0; i < others.length; i++) {
      var o = post[others[i]] || {};
      if (o[key] != null && o[key] !== '') return o[key];
    }
    return '';
  }

  function categoryLabel(cat, lang) {
    if (lang === 'fa') {
      var fa = { 'Thought Leadership':'دیدگاه', 'Blog':'وبلاگ', 'Article':'مقاله',
                 'News':'اخبار', 'Press Release':'بیانیه مطبوعاتی' };
      return fa[cat] || cat || '';
    }
    if (lang === 'es') {
      var es = { 'Thought Leadership':'Liderazgo de opinión', 'Blog':'Blog',
                 'Article':'Artículo', 'News':'Noticias', 'Press Release':'Nota de prensa' };
      return es[cat] || cat || '';
    }
    return cat || '';
  }

  var STR = {
    en: { back: '← News', notFound: 'We couldn’t find that article.' },
    fa: { back: '→ اخبار', notFound: 'این مطلب پیدا نشد.' },
    es: { back: '← Noticias', notFound: 'No pudimos encontrar ese artículo.' }
  };
  function str(lang, key) { return (STR[lang] || STR.en)[key] || STR.en[key]; }

  /* ---------- scoped reader styles ---------- */
  // Mirrors the .mow-article CSS shipped in the static article pages so prose
  // renders identically on the generic reader page too. Injected once.
  function ensureStyles() {
    if (document.getElementById('mow-news-styles')) return;
    var css =
      '.mow-news-shell{padding:0;}' +
      '.mow-news-hero{position:relative;padding:clamp(56px,7vw,104px) clamp(20px,4vw,56px) clamp(24px,3vw,40px);overflow:hidden;}' +
      '.mow-news-hero .mow-news-inner{max-width:820px;margin:0 auto;position:relative;}' +
      '.mow-news-back{font-family:\'Archivo\',sans-serif;font-size:11.5px;font-weight:600;letter-spacing:0.16em;text-transform:uppercase;color:#9FB09B;display:inline-flex;align-items:center;gap:8px;margin-bottom:30px;}' +
      '.mow-news-meta{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:22px;}' +
      '.mow-news-chip{font-family:\'Archivo\',sans-serif;font-size:10.5px;font-weight:600;letter-spacing:0.16em;text-transform:uppercase;color:#07211A;background:#C49C4E;padding:5px 12px;border-radius:999px;}' +
      '.mow-news-date{font-family:\'Archivo\',sans-serif;font-size:11.5px;font-weight:500;letter-spacing:0.14em;text-transform:uppercase;color:#9FB09B;}' +
      '.mow-news-title{font-family:\'Bodoni Moda\',serif;font-weight:600;font-size:clamp(34px,5vw,62px);line-height:1.02;letter-spacing:-0.015em;color:#F6F0E1;}' +
      '.mow-news-excerpt{font-family:\'Cormorant Garamond\',serif;font-style:italic;font-size:clamp(20px,2vw,27px);line-height:1.4;color:#D8C9A8;margin-top:22px;}' +
      '.mow-news-cover{max-width:820px;margin:clamp(28px,4vw,40px) auto 0;padding:0 clamp(20px,4vw,56px);}' +
      '.mow-news-cover img{display:block;width:100%;height:auto;border-radius:14px;border:1px solid rgba(196,156,78,0.25);}' +
      '.mow-news-bodywrap{padding:clamp(28px,4vw,40px) clamp(20px,4vw,56px) clamp(64px,8vw,104px);}' +
      '.mow-article{font-family:\'Cormorant Garamond\',serif;max-width:820px;margin:0 auto;border-top:1px solid rgba(196,156,78,0.22);padding-top:clamp(28px,4vw,44px);}' +
      '.mow-article h2{font-family:\'Bodoni Moda\',serif;font-weight:600;font-size:clamp(26px,3vw,38px);line-height:1.1;letter-spacing:-0.01em;color:#F6F0E1;margin:48px 0 16px;}' +
      '.mow-article h3{font-family:\'Bodoni Moda\',serif;font-weight:600;font-size:clamp(20px,2.2vw,26px);line-height:1.15;color:#E2C173;margin:34px 0 10px;}' +
      '.mow-article p{font-family:\'Cormorant Garamond\',serif;font-size:clamp(19px,1.5vw,23px);line-height:1.62;color:#D3DBCE;margin:0 0 20px;}' +
      '.mow-article em{color:#E9DCBE;}.mow-article strong{color:#F6F0E1;font-weight:600;}' +
      '.mow-article a{color:#E2C173;border-bottom:1px solid rgba(196,156,78,0.45);}' +
      '.mow-article blockquote{margin:38px 0;padding:8px 0 8px 28px;border-left:2px solid #C49C4E;font-style:italic;font-size:clamp(23px,2.4vw,31px);line-height:1.32;color:#F2E9D2;font-family:\'Bodoni Moda\',serif;}' +
      '.mow-article ul{margin:0 0 22px;padding-left:22px;}.mow-article li{font-family:\'Cormorant Garamond\',serif;font-size:clamp(19px,1.5vw,23px);line-height:1.5;color:#D3DBCE;margin-bottom:8px;}' +
      '.mow-article figure{margin:28px 0;}.mow-article figure img{display:block;width:100%;height:auto;border-radius:14px;border:1px solid rgba(196,156,78,0.25);}' +
      '.mow-news-missing{max-width:820px;margin:clamp(80px,12vw,160px) auto;padding:0 clamp(20px,4vw,56px);text-align:center;}' +
      '.mow-news-missing p{font-family:\'Bodoni Moda\',serif;font-size:clamp(22px,3vw,34px);color:#F6F0E1;margin-bottom:24px;}' +
      '.mow-news-rtl{direction:rtl;text-align:right;}' +
      '.mow-news-rtl.mow-article blockquote,.mow-news-rtl .mow-article blockquote{border-left:0;border-right:2px solid #C49C4E;padding:8px 28px 8px 0;}' +
      '.mow-news-rtl .mow-article ul{padding-left:0;padding-right:22px;}';
    var st = document.createElement('style');
    st.id = 'mow-news-styles';
    st.textContent = css;
    document.head.appendChild(st);
  }

  /* ---------- fetch ---------- */
  function fetchJson(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url);
      return r.json();
    });
  }

  /* ---------- render ---------- */
  function showNotFound(mount, lang) {
    mount.innerHTML =
      '<div class="mow-news-missing">' +
        '<p>' + esc(str(lang, 'notFound')) + '</p>' +
        '<a class="mow-news-back" href="/news/">' + esc(str(lang, 'back')) + '</a>' +
      '</div>';
  }

  function buildArticle(mount, p, lang) {
    var isFa = lang === 'fa';
    var title = pickField(p, lang, 'title');
    var excerpt = pickField(p, lang, 'excerpt');
    var body = pickField(p, lang, 'body'); // rich HTML
    var cover = rootAsset(p.cover);

    if (title) document.title = title + ' | MOW News — Man of the World';

    var rtl = isFa ? ' mow-news-rtl' : '';
    var html =
      '<div class="mow-news-shell">' +
        '<section class="mow-news-hero">' +
          '<div class="mow-news-inner' + rtl + '">' +
            '<a class="mow-news-back" href="/news/">' + esc(str(lang, 'back')) + '</a>' +
            '<div class="mow-news-meta">' +
              (p.category ? '<span class="mow-news-chip">' + esc(categoryLabel(p.category, lang)) + '</span>' : '') +
              (p.date ? '<span class="mow-news-date">' + esc(formatDate(p.date, lang)) + '</span>' : '') +
            '</div>' +
            '<h1 class="mow-news-title">' + esc(title) + '</h1>' +
            (excerpt ? '<p class="mow-news-excerpt">' + esc(excerpt) + '</p>' : '') +
          '</div>' +
        '</section>' +
        (cover ? '<div class="mow-news-cover"><img src="' + esc(cover) + '" alt="' + esc(title) + '" loading="lazy"></div>' : '') +
        '<section class="mow-news-bodywrap">' +
          '<div class="mow-article' + rtl + '"></div>' +
        '</section>' +
      '</div>';

    mount.innerHTML = html;
    var bodyEl = mount.querySelector('.mow-article');
    if (bodyEl) bodyEl.innerHTML = body || '';
  }

  function renderArticle(mount) {
    ensureStyles();
    var lang = detectLang(mount);
    var slug = getSlug(mount);
    if (!slug) { showNotFound(mount, lang); return; }
    fetchJson(contentUrl('content/articles/' + slug + '.json'))
      .then(function (p) { buildArticle(mount, p, lang); })
      .catch(function () { showNotFound(mount, lang); });
  }

  /* ---------- bootstrap ---------- */
  function init() {
    var mount = findMount();
    if (mount) renderArticle(mount);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
