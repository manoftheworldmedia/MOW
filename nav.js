/* MOW shared nav behavior for standalone pages (case studies + articles).
   Wires the language toggle, mobile menu, header solidify, and the
   scroll swap: language toggle ⇄ Contact button (down = contact, up = toggle). */
(function () {
  var i18n = {
    en: { nav_services:'Services', nav_work:'Work', nav_method:'Method', nav_blog:'News', nav_about:'About', nav_faq:'FAQs', nav_contact:'Contact' },
    fa: { nav_services:'خدمات', nav_work:'کارها', nav_method:'روش', nav_blog:'اخبار', nav_about:'درباره', nav_faq:'سوالات', nav_contact:'تماس' },
    es: { nav_services:'Servicios', nav_work:'Trabajo', nav_method:'Método', nav_blog:'Noticias', nav_about:'Acerca', nav_faq:'Preguntas', nav_contact:'Contacto' }
  };
  // Default language from filename (…es.html / …fa.html) or <html lang>.
  var path = location.pathname.toLowerCase();
  var cur = /\.es\.html$/.test(path) ? 'es' : /\.fa\.html$/.test(path) ? 'fa' : (document.documentElement.lang || 'en').slice(0, 2);
  if (!i18n[cur]) cur = 'en';

  function apply(l) {
    cur = l; var d = i18n[l] || i18n.en;
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var k = el.getAttribute('data-i18n');
      if (d[k] != null) { el.textContent = d[k]; el.style.direction = (l === 'fa') ? 'rtl' : 'ltr'; }
    });
    document.querySelectorAll('[data-langbtn]').forEach(function (b) {
      var a = b.getAttribute('data-langbtn') === l;
      b.style.color = a ? '#E2C173' : '#7E907A'; b.style.fontWeight = a ? '600' : '500';
    });
  }
  function menu() { return document.querySelector('[data-mobilemenu]'); }
  function openMenu() { var m = menu(); if (m) { m.style.opacity = '1'; m.style.pointerEvents = 'auto'; document.body.style.overflow = 'hidden'; } }
  function closeMenu() { var m = menu(); if (m) { m.style.opacity = '0'; m.style.pointerEvents = 'none'; document.body.style.overflow = ''; } }

  document.addEventListener('click', function (e) {
    var c = e.target;
    var lb = c.closest && c.closest('[data-langbtn]'); if (lb) { apply(lb.getAttribute('data-langbtn')); return; }
    if (c.closest && c.closest('[data-burger]')) { openMenu(); return; }
    if (c.closest && c.closest('[data-menuclose]')) { closeMenu(); return; }
    // close method dropdown on outside click
    var mm = document.querySelector('[data-methodmenu]');
    if (mm && !c.closest('[data-methoddrop]')) { mm.style.opacity = '0'; mm.style.pointerEvents = 'none'; }
    var m = menu(); if (m && m.style.opacity === '1') { if (c === m || (c.closest && c.closest('[data-mobilemenu]') && c.tagName === 'A')) closeMenu(); }
  });

  // Method dropdown — build HTML dynamically if not already present,
  // then wire hover/tap. Works even if the page was uploaded with the old nav.
  function initMethodDropdown() {
    var wrap = document.querySelector('[data-methoddrop]');
    // If the dropdown wrapper isn't in the HTML yet, build it around the Method link.
    if (!wrap) {
      var links = document.querySelectorAll('[data-nav] a, nav a');
      for (var i = 0; i < links.length; i++) {
        var a = links[i];
        if (/messaging-matrix|\/method/i.test(a.getAttribute('href') || '') || /^method$/i.test((a.textContent || '').trim())) {
          // Wrap it
          var div = document.createElement('div');
          div.setAttribute('data-methoddrop', '');
          div.style.cssText = 'position:relative;display:inline-block;';
          a.parentNode.insertBefore(div, a);
          div.appendChild(a);
          // Add chevron
          a.style.display = 'flex'; a.style.alignItems = 'center'; a.style.gap = '5px';
          a.href = '/frameworks/messaging-matrix/';
          a.innerHTML = (a.textContent.trim() || 'Method') + ' <svg width="10" height="6" viewBox="0 0 10 6" fill="none" style="flex-shrink:0"><path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
          // Build menu
          var menu = document.createElement('div');
          menu.setAttribute('data-methodmenu', '');
          menu.style.cssText = 'position:absolute;top:calc(100% + 12px);left:50%;transform:translateX(-50%);background:rgba(5,21,14,0.97);border:1px solid rgba(196,156,78,0.3);border-radius:12px;padding:8px;min-width:210px;opacity:0;pointer-events:none;transition:opacity .22s;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);z-index:200;';
          function mkLink(href, label) {
            var l = document.createElement('a');
            l.href = href; l.textContent = label;
            l.style.cssText = 'display:block;font-family:\'Archivo\',sans-serif;font-size:11.5px;font-weight:500;letter-spacing:0.13em;text-transform:uppercase;color:#EDE6D4;padding:11px 16px;border-radius:8px;white-space:nowrap;text-decoration:none;';
            return l;
          }
          menu.appendChild(mkLink('/frameworks/messaging-matrix/', 'Messaging Matrix'));
          menu.appendChild(mkLink('/frameworks/executive-communications/', 'Executives'));
          div.appendChild(menu);
          wrap = div;
          break;
        }
      }
    }
    if (!wrap) return;
    var mm = wrap.querySelector('[data-methodmenu]') || document.querySelector('[data-methodmenu]');
    if (!mm) return;
    var t = null;
    function show() { clearTimeout(t); mm.style.opacity = '1'; mm.style.pointerEvents = 'auto'; }
    function hide() { t = setTimeout(function() { mm.style.opacity = '0'; mm.style.pointerEvents = 'none'; }, 180); }
    mm.querySelectorAll('a').forEach(function(a) {
      a.addEventListener('mouseenter', function() { a.style.background = 'rgba(196,156,78,0.14)'; a.style.color = '#E2C173'; });
      a.addEventListener('mouseleave', function() { a.style.background = ''; a.style.color = '#EDE6D4'; });
    });
    wrap.addEventListener('mouseenter', show);
    wrap.addEventListener('mouseleave', hide);
    mm.addEventListener('mouseenter', show);
    mm.addEventListener('mouseleave', hide);
    var trigger = wrap.querySelector('a');
    if (trigger) {
      trigger.addEventListener('touchstart', function(e) {
        if (mm.style.opacity === '1') { hide(); } else { e.preventDefault(); show(); }
      }, { passive: false });
    }
  }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeMenu(); });

  var hdr = document.querySelector('[data-header]');
  if (hdr) hdr.style.transition = 'transform .45s cubic-bezier(.4,0,.2,1),background .45s,border-color .45s,backdrop-filter .45s';
  var navLast = 0;
  function navScroll() {
    var y = window.scrollY || document.documentElement.scrollTop || 0;
    var scrolled = y > 40;
    if (hdr) {
      if (y > navLast && y > 260) hdr.style.transform = 'translateY(-100%)'; else hdr.style.transform = 'translateY(0)';
      navLast = y;
      hdr.style.background = scrolled ? 'rgba(5,21,14,0.92)' : 'transparent';
      hdr.style.borderBottomColor = scrolled ? 'rgba(196,156,78,0.22)' : 'transparent';
      hdr.style.backdropFilter = scrolled ? 'saturate(150%) blur(16px)' : 'none';
      hdr.style.webkitBackdropFilter = scrolled ? 'saturate(150%) blur(16px)' : 'none';
    }
    var lw = document.querySelector('[data-langwrap]'), ct = document.querySelector('[data-navcontact]');
    if (lw && ct) {
      if (scrolled) {
        lw.style.opacity = '0'; lw.style.transform = 'translateX(-8px)'; lw.style.pointerEvents = 'none';
        ct.style.opacity = '1'; ct.style.transform = 'translate(0,-50%) scale(1)'; ct.style.pointerEvents = 'auto'; ct.classList.add('is-on');
      } else {
        lw.style.opacity = '1'; lw.style.transform = 'translateX(0)'; lw.style.pointerEvents = 'auto';
        ct.style.opacity = '0'; ct.style.transform = 'translate(8px,-50%) scale(0.92)'; ct.style.pointerEvents = 'none'; ct.classList.remove('is-on');
      }
    }
  }
  window.addEventListener('scroll', navScroll, { passive: true });

  function boot() { apply(cur); navScroll(); initMethodDropdown(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
