import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  menuToJsonLd, renderMenuScript, injectMenuJsonLd, buildMenuJsonLdFile, localized,
} from '../lib/menu-schema.js';

const caspian = {
  establishmentType: 'CafeOrCoffeeShop',
  businessName: 'Caspian Coast Coffee',
  url: 'https://caspiancoast.com',
  currency: 'usd',
  image: 'assets/caspian/j8.jpg',
  sections: [
    {
      en: { name: 'Coffee', description: 'Persian roots, California light.' },
      fa: { name: 'قهوه' },
      items: [
        {
          price: 5.5, dietary: ['vegan'], image: 'assets/caspian/j8.jpg',
          en: { name: 'Saffron Latte', description: 'Espresso, milk, saffron.' },
          fa: { name: 'لاته زعفران', description: 'اسپرسو، شیر، زعفران.' },
        },
        { price: 4, en: { name: 'Persian Coffee' } },
      ],
    },
    {
      en: { name: 'Bakery' },
      items: [{ price: 3.5, dietary: ['vegetarian', 'halal'], en: { name: 'Barbari' } }],
    },
  ],
};

test('wraps the Menu in the establishment with hasMenu', () => {
  const ld = menuToJsonLd(caspian, { mediaBase: 'https://caspiancoast.com/' });
  assert.equal(ld['@type'], 'CafeOrCoffeeShop');
  assert.equal(ld.name, 'Caspian Coast Coffee');
  assert.equal(ld.url, 'https://caspiancoast.com');
  assert.equal(ld.image, 'https://caspiancoast.com/assets/caspian/j8.jpg');
  assert.equal(ld.hasMenu['@type'], 'Menu');
  assert.equal(ld.hasMenu['@context'], undefined); // inner node inherits context
  assert.equal(ld['@context'], 'https://schema.org');
});

test('builds sections and items with prices as Offers in cents-free dollar strings', () => {
  const menu = menuToJsonLd(caspian).hasMenu;
  assert.equal(menu.hasMenuSection.length, 2);
  const coffee = menu.hasMenuSection[0];
  assert.equal(coffee.name, 'Coffee');
  assert.equal(coffee.hasMenuItem.length, 2);
  const latte = coffee.hasMenuItem[0];
  assert.equal(latte.name, 'Saffron Latte');
  assert.deepEqual(latte.offers, { '@type': 'Offer', price: '5.50', priceCurrency: 'USD' });
});

test('maps dietary tags to schema.org RestrictedDiet URLs', () => {
  const menu = menuToJsonLd(caspian).hasMenu;
  assert.equal(menu.hasMenuSection[0].hasMenuItem[0].suitableForDiet, 'https://schema.org/VeganDiet');
  assert.deepEqual(menu.hasMenuSection[1].hasMenuItem[0].suitableForDiet, [
    'https://schema.org/VegetarianDiet', 'https://schema.org/HalalDiet',
  ]);
});

test('localizes to Farsi, falling back to English when a field is missing', () => {
  const fa = menuToJsonLd(caspian, { lang: 'fa' }).hasMenu;
  assert.equal(fa.inLanguage, 'fa');
  assert.equal(fa.hasMenuSection[0].name, 'قهوه');             // fa present
  assert.equal(fa.hasMenuSection[0].hasMenuItem[0].name, 'لاته زعفران');
  assert.equal(fa.hasMenuSection[1].name, 'Bakery');          // fa missing → en fallback
});

test('localized() helper falls back lang → en → flat', () => {
  assert.equal(localized({ fa: { name: 'x' }, en: { name: 'y' } }, 'name', 'fa'), 'x');
  assert.equal(localized({ en: { name: 'y' } }, 'name', 'fa'), 'y');
  assert.equal(localized({ name: 'z' }, 'name', 'fa'), 'z');
});

test('omits offers/items that have no name or price', () => {
  const ld = menuToJsonLd({ currency: 'usd', sections: [{ en: { name: 'X' }, items: [{ en: {} }, { en: { name: 'Has name' } }] }] });
  assert.equal(ld['@type'], 'Menu'); // no establishment wrap without businessName
  assert.equal(ld.hasMenuSection[0].hasMenuItem.length, 1);
  assert.equal(ld.hasMenuSection[0].hasMenuItem[0].offers, undefined);
});

test('renderMenuScript emits a valid ld+json script tag', () => {
  const tag = renderMenuScript(caspian);
  assert.match(tag, /^<script type="application\/ld\+json" data-mow-menu>/);
  const json = tag.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '');
  assert.doesNotThrow(() => JSON.parse(json));
});

test('injectMenuJsonLd inserts before </head> then replaces idempotently', () => {
  const html = '<html><head><title>x</title></head><body>hi</body></html>';
  const tag1 = renderMenuScript(caspian, { lang: 'en' });
  const once = injectMenuJsonLd(html, tag1);
  assert.match(once, /MOW:MENU-SCHEMA/);
  assert.ok(once.indexOf('</head>') > once.indexOf('data-mow-menu'));
  // re-injecting the SAME content is a no-op; different content replaces in place
  const twice = injectMenuJsonLd(once, tag1);
  assert.equal(twice, once);
  const changed = injectMenuJsonLd(once, renderMenuScript({ ...caspian, currency: 'eur' }, { lang: 'en' }));
  assert.equal((changed.match(/MOW:MENU-SCHEMA/g) || []).length, 2); // still one region (start+end marker)
  assert.match(changed, /EUR/);
});

test('buildMenuJsonLdFile reads the target page and returns updated HTML', async () => {
  const schema = { name: 'menu', jsonld: { type: 'menu', into: 'menu/index.html', langs: ['en', 'fa'] } };
  const page = '<html><head></head><body></body></html>';
  const readFile = async (p) => (p === 'menu/index.html' ? { content: page } : null);
  const out = await buildMenuJsonLdFile(caspian, schema, { readFile, mediaBase: 'https://caspiancoast.com/' });
  assert.equal(out.path, 'menu/index.html');
  assert.match(out.content, /CafeOrCoffeeShop/);
  assert.match(out.content, /"inLanguage":"fa"/); // multilingual: both blocks emitted
  // second run with identical inputs → no change → null (don't bloat the commit)
  const again = await buildMenuJsonLdFile(caspian, schema, { readFile: async () => ({ content: out.content }), mediaBase: 'https://caspiancoast.com/' });
  assert.equal(again, null);
});

test('buildMenuJsonLdFile is a no-op when the schema does not opt in', async () => {
  const out = await buildMenuJsonLdFile(caspian, { name: 'menu' }, { readFile: async () => ({ content: '<html></html>' }) });
  assert.equal(out, null);
});
