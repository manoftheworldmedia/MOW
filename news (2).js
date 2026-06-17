/* MOW news system — single renderer for the homepage featured strip and the
   Newsroom page. Reads content/news.json (the CMS-editable source). */
(function () {
  var URL = '/content/news.json';
  var TYPES = ['Blog', 'Article', 'Thought Leadership', 'Press Release'];
  var TYPE_TINT = {
    'Blog': '#C49C4E',
    'Article': '#7FA98B',
    'Thought Leadership': '#E2C173',
    'Press Release': '#B98BA9'
  };

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  function fmtDate(d) {
    if (!d) return '';
    var t = new Date(d + (d.length === 10 ? 'T00:00:00' : ''));
    if (isNaN(t)) return d;
    return t.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  }

  function art(item) {
    if (item.hero) {
      return '<img src="' + (item.hero.charAt(0) === '/' ? '' : '/') + esc(item.hero) + '" alt="' + esc(item.title) + '" loading="lazy" style="width:100%;height:100%;object-fit:cover;display:block;">';
    }
    var initials = (item.title || '?').trim().charAt(0);
    return '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:radial-gradient(circle at 64% 36%, rgba(196,156,78,0.18), transparent 62%);">' +
      '<span style="font-family:\'Bodoni Moda\',serif;font-style:italic;font-weight:600;font-size:120px;line-height:1;color:rgba(226,193,115,0.9);">' + esc(initials) + '</span></div>';
  }

  function badge(type) {
    var c = TYPE_TINT[type] || '#C49C4E';
    return '<span style="position:absolute;top:16px;left:16px;font-family:\'Archivo\',sans-serif;font-size:10px;font-weight:600;letter-spacing:0.16em;text-transform:uppercase;color:#07211A;background:' + c + ';padding:5px 11px;border-radius:999px;">' + esc(type) + '</span>';
  }

  function card(item, fixedWidth) {
    var w = fixedWidth ? 'flex:0 0 auto;width:min(82vw,400px);scroll-snap-align:start;' : '';
    var ext = /^https?:/.test(item.link || '') ? ' target="_blank" rel="noopener"' : '';
    return '<a class="mow-blogcard"' + ext + ' href="' + esc(item.link || '#') + '" style="' + w + 'display:block;cursor:pointer;background:rgba(237,230,212,0.035);border:1px solid rgba(196,156,78,0.22);border-radius:18px;overflow:hidden;">' +
      '<div style="position:relative;aspect-ratio:16/11;overflow:hidden;background:#05190F;">' +
        '<div data-blogart>' + art(item) + '</div>' + badge(item.type) +
      '</div>' +
      '<div style="padding:24px 24px 28px;">' +
        '<div style="font-family:\'Archivo\',sans-serif;font-size:11px;letter-spacing:0.13em;text-transform:uppercase;color:#9FB09B;margin-bottom:13px;">' + esc(fmtDate(item.date)) + '</div>' +
        '<h3 style="font-family:\'Bodoni Moda\',serif;font-weight:600;font-size:24px;line-height:1.12;color:#F6F0E1;margin-bottom:12px;">' + esc(item.title) + '</h3>' +
        '<p style="font-family:\'Archivo\',sans-serif;font-size:14px;line-height:1.6;color:#9FB09B;margin-bottom:18px;">' + esc(item.summary) + '</p>' +
        '<span style="font-family:\'Archivo\',sans-serif;font-size:12px;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;color:#E2C173;">Read →</span>' +
      '</div></a>';
  }

  function byTypeOrder(a, b) {
    var d = TYPES.indexOf(a.type) - TYPES.indexOf(b.type);
    if (d !== 0) return d;
    return (b.date || '').localeCompare(a.date || '');
  }

  function renderHome(items) {
    var host = document.querySelector('[data-news-home]');
    if (!host) return;
    var list = items.slice().sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
    if (!list.length) return;
    // Native horizontal scroll (manual finger swipe) + gentle auto-advance + seamless loop.
    host.style.overflowX = 'auto';
    host.style.overflowY = 'hidden';
    host.style.touchAction = 'pan-x';        // finger swipes scroll the strip; vertical passes to the page
    host.style.webkitOverflowScrolling = 'touch';
    host.style.scrollSnapType = 'none';
    var inner = document.createElement('div');
    inner.style.cssText = 'display:flex;gap:22px;width:max-content;';
    var one = list.map(function (i) { return card(i, true); }).join('');
    inner.innerHTML = one + one; // two copies for seamless loop
    host.innerHTML = '';
    host.appendChild(inner);

    var half = 0, visible = true, paused = false, resume = 0;
    function measure() { half = inner.scrollWidth / 2; }
    measure();
    window.addEventListener('resize', measure);
    // Pause auto-advance while the user is interacting; resume shortly after.
    function hold() { paused = true; resume = Date.now() + 2600; }
    host.addEventListener('mouseenter', function () { paused = true; });
    host.addEventListener('mouseleave', function () { paused = false; });
    ['pointerdown', 'touchstart', 'wheel'].forEach(function (ev) {
      host.addEventListener(ev, hold, { passive: true });
    });
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (es) { visible = es[0].isIntersecting; }, { threshold: 0 }).observe(host);
    }
    var last = null;
    function frame(t) {
      if (last == null) last = t;
      var dt = t - last; last = t;
      if (paused && resume && Date.now() > resume) { paused = false; resume = 0; }
      if (!paused && visible && half > 0) {
        host.scrollLeft += (dt / 1000) * 42; // ~42px/sec drift
      }
      // Seamless wrap in both directions (manual or auto): one full copy = half.
      if (half > 0) {
        if (host.scrollLeft >= half) host.scrollLeft -= half;
        else if (host.scrollLeft <= 0) host.scrollLeft += half;
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  function renderRoom(items) {
    var host = document.querySelector('[data-news-room]');
    if (!host) return;
    var filters = document.querySelector('[data-news-filters]');
    var active = 'All';

    function draw() {
      var list = items.slice().sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
      if (active !== 'All') list = list.filter(function (i) { return i.type === active; });
      if (!list.length) { host.innerHTML = '<p style="grid-column:1/-1;font-family:\'Cormorant Garamond\',serif;font-size:22px;color:#9FB09B;">Nothing here yet.</p>'; return; }
      host.innerHTML = list.map(function (i) { return card(i, false); }).join('');
    }

    if (filters) {
      var btns = ['All'].concat(TYPES);
      filters.innerHTML = btns.map(function (b) {
        return '<button type="button" data-filter="' + esc(b) + '" style="font-family:\'Archivo\',sans-serif;font-size:12px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;padding:11px 22px;border-radius:999px;border:1px solid rgba(196,156,78,0.4);background:transparent;color:#CBD6C7;cursor:pointer;transition:all .2s;">' + esc(b === 'All' ? 'All' : b) + '</button>';
      }).join('');
      function paint() {
        filters.querySelectorAll('[data-filter]').forEach(function (btn) {
          var on = btn.getAttribute('data-filter') === active;
          btn.style.background = on ? '#C49C4E' : 'transparent';
          btn.style.color = on ? '#07211A' : '#CBD6C7';
          btn.style.borderColor = on ? '#C49C4E' : 'rgba(196,156,78,0.4)';
        });
      }
      filters.addEventListener('click', function (e) {
        var b = e.target.closest('[data-filter]');
        if (!b) return;
        active = b.getAttribute('data-filter');
        paint(); draw();
      });
      paint();
    }
    draw();
  }

  function boot() {
    fetch(URL, { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var items = (j && j.items) || [];
        renderHome(items);
        renderRoom(items);
      })
      .catch(function () {});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
