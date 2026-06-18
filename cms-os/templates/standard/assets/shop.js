/**
 * MOW Shop — drop-in storefront cart for a static site.
 * No build, no dependencies. It keeps a cart in localStorage and hands off to
 * Stripe Checkout via your MOW CMS backend (which sets the price securely).
 *
 * 1) Configure once (before this script), pointing at your portal + project id:
 *      <script>window.MOW_SHOP = {
 *        api: 'https://mow-cms-os.onrender.com',   // your portal URL
 *        project: 'manoftheworldmedia-mow'          // project id from the portal
 *      };</script>
 *      <script src="/assets/shop.js" defer></script>
 *
 * 2) Mark up products and the cart:
 *      <button data-mow-add="mow-tee" data-mow-name="MOW Tee" data-mow-price="29.99">Add to cart</button>
 *      <span data-mow-cart-count></span>
 *      <button data-mow-checkout>Checkout</button>
 *
 * Product ids must match files at content/products/<id>.json in the repo.
 */
(function () {
  var CFG = window.MOW_SHOP || {};
  var KEY = 'mow_cart_' + (CFG.project || 'default');

  function read() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } }
  function write(c) { localStorage.setItem(KEY, JSON.stringify(c)); render(); }
  function count(c) { return Object.values(c).reduce(function (n, q) { return n + q; }, 0); }

  function add(id, qty) {
    if (!id) return;
    var c = read(); c[id] = (c[id] || 0) + (qty || 1); write(c);
  }
  function setQty(id, qty) { var c = read(); if (qty <= 0) delete c[id]; else c[id] = qty; write(c); }
  function clear() { localStorage.removeItem(KEY); render(); }

  async function checkout() {
    var c = read();
    var items = Object.keys(c).map(function (id) { return { productId: id, qty: c[id] }; });
    if (!items.length) { alert('Your cart is empty.'); return; }
    if (!CFG.api || !CFG.project) { alert('Shop is not configured.'); return; }
    try {
      var res = await fetch(CFG.api.replace(/\/$/, '') + '/api/projects/' + CFG.project + '/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: items,
          successUrl: location.origin + (CFG.successPath || '/?checkout=success'),
          cancelUrl: location.href,
        }),
      });
      var data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Checkout failed');
      window.location.href = data.url; // Stripe-hosted checkout
    } catch (e) { alert('Checkout error: ' + e.message); }
  }

  function render() {
    var c = read();
    document.querySelectorAll('[data-mow-cart-count]').forEach(function (el) { el.textContent = String(count(c)); });
    document.querySelectorAll('[data-mow-cart-empty]').forEach(function (el) { el.style.display = count(c) ? 'none' : ''; });
  }

  document.addEventListener('click', function (e) {
    var addBtn = e.target.closest('[data-mow-add]');
    if (addBtn) { e.preventDefault(); add(addBtn.getAttribute('data-mow-add'), 1); flash(addBtn); return; }
    if (e.target.closest('[data-mow-checkout]')) { e.preventDefault(); checkout(); return; }
    if (e.target.closest('[data-mow-cart-clear]')) { e.preventDefault(); clear(); return; }
  });

  function flash(btn) {
    var t = btn.textContent; btn.textContent = 'Added ✓';
    setTimeout(function () { btn.textContent = t; }, 1100);
  }

  // public API for custom UIs
  window.mowCart = { add: add, setQty: setQty, clear: clear, get: read, count: function () { return count(read()); }, checkout: checkout };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render); else render();
})();
