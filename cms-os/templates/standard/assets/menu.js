/* Menu loader — renders the food/drink menu from content/menu.json and keeps a
   schema.org/Menu JSON-LD block in sync, mirroring the FAQ pattern in cms.js.

   IMPORTANT: this runtime copy is a best-effort FALLBACK. The CANONICAL menu
   JSON-LD is baked into this page's static <head> at publish time (see the
   MOW:MENU-SCHEMA marker), so search engines and JS-blind AI crawlers read it
   straight from the HTML. This script only enriches the live, JS-enabled view
   and the human-visible menu. Lang follows <html lang> / window.MOW.state.lang. */
(function () {
  var DATA_URL = 'content/menu.json';

  var DIET_MAP = {
    vegan: 'https://schema.org/VeganDiet', vegetarian: 'https://schema.org/VegetarianDiet',
    'gluten-free': 'https://schema.org/GlutenFreeDiet', halal: 'https://schema.org/HalalDiet',
    kosher: 'https://schema.org/KosherDiet', 'low-calorie': 'https://schema.org/LowCalorieDiet',
    'low-fat': 'https://schema.org/LowFatDiet', 'low-lactose': 'https://schema.org/LowLactoseDiet',
    'low-salt': 'https://schema.org/LowSaltDiet', diabetic: 'https://schema.org/DiabeticDiet'
  };

  function lang() {
    var w = window.MOW && window.MOW.state && window.MOW.state.lang;
    return w || (document.documentElement.getAttribute('lang') || 'en').slice(0, 2);
  }
  function loc(obj, field, l) {
    if (!obj) return '';
    var pick = function (o) { return o && o[field] != null && o[field] !== '' ? o[field] : ''; };
    return pick(obj[l]) || pick(obj.en) || pick(obj) || '';
  }
  function money(v, cur) {
    var n = Number(v); if (!isFinite(n)) return '';
    var sym = { usd: '$', eur: '€', gbp: '£', cad: '$', aud: '$' }[(cur || 'usd').toLowerCase()] || '';
    return sym + n.toFixed(2);
  }

  function jsonLd(menu, l) {
    var cur = menu.currency || 'usd';
    var sections = (menu.sections || []).map(function (sec) {
      var node = { '@type': 'MenuSection' };
      var n = loc(sec, 'name', l); if (n) node.name = n;
      var items = (sec.items || []).map(function (it) {
        var item = { '@type': 'MenuItem' };
        var name = loc(it, 'name', l); if (name) item.name = name;
        var desc = loc(it, 'description', l); if (desc) item.description = desc;
        var p = Number(it.price);
        if (isFinite(p) && p >= 0) item.offers = { '@type': 'Offer', price: p.toFixed(2), priceCurrency: cur.toUpperCase() };
        var diets = (it.dietary || []).map(function (d) { return DIET_MAP[String(d).toLowerCase()]; }).filter(Boolean);
        if (diets.length) item.suitableForDiet = diets.length === 1 ? diets[0] : diets;
        return item;
      }).filter(function (x) { return x.name; });
      if (items.length) node.hasMenuItem = items;
      return node;
    }).filter(function (s) { return s.name || s.hasMenuItem; });

    var node = { '@context': 'https://schema.org', '@type': 'Menu', inLanguage: l };
    if (sections.length) node.hasMenuSection = sections;
    if (menu.establishmentType && menu.businessName) {
      var est = { '@context': 'https://schema.org', '@type': menu.establishmentType, name: menu.businessName };
      if (menu.url) est.url = menu.url;
      delete node['@context']; est.hasMenu = node; return est;
    }
    return node;
  }

  function syncSchema(menu, l) {
    try {
      var scripts = document.querySelectorAll('script[type="application/ld+json"]');
      for (var i = 0; i < scripts.length; i++) {
        if (scripts[i].hasAttribute('data-mow-menu')) {
          scripts[i].textContent = JSON.stringify(jsonLd(menu, l)); return;
        }
      }
    } catch (e) { /* best-effort */ }
  }

  function render(menu, l) {
    var box = document.getElementById('mow-menu'); if (!box) return;
    var cur = menu.currency || 'usd';
    box.innerHTML = '';
    (menu.sections || []).forEach(function (sec) {
      var secName = loc(sec, 'name', l); if (!secName && !(sec.items || []).length) return;
      var h = document.createElement('h2'); h.className = 'mow-menu-section'; h.textContent = secName;
      box.appendChild(h);
      var sd = loc(sec, 'description', l);
      if (sd) { var p = document.createElement('p'); p.className = 'mow-menu-secdesc'; p.textContent = sd; box.appendChild(p); }
      (sec.items || []).forEach(function (it) {
        var name = loc(it, 'name', l); if (!name) return;
        var row = document.createElement('div'); row.className = 'mow-menu-item';
        var top = document.createElement('div'); top.className = 'mow-menu-itemtop';
        var nm = document.createElement('span'); nm.className = 'mow-menu-name'; nm.textContent = name;
        var pr = document.createElement('span'); pr.className = 'mow-menu-price'; pr.textContent = money(it.price, cur);
        top.appendChild(nm); top.appendChild(pr); row.appendChild(top);
        var desc = loc(it, 'description', l);
        if (desc) { var d = document.createElement('p'); d.className = 'mow-menu-desc'; d.textContent = desc; row.appendChild(d); }
        box.appendChild(row);
      });
    });
  }

  function boot() {
    fetch(DATA_URL, { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (menu) {
        var l = lang();
        render(menu, l);
        syncSchema(menu, l);
        if (window.MOW && typeof window.MOW.applyLang === 'function' && !window.MOW.__menuWrapped) {
          var orig = window.MOW.applyLang.bind(window.MOW);
          window.MOW.applyLang = function (x) { orig(x); render(menu, lang()); syncSchema(menu, lang()); };
          window.MOW.__menuWrapped = true;
        }
      })
      .catch(function () { /* leave the static HTML as-is */ });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
