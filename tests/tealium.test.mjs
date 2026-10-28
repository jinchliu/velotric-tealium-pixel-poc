import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createHash, webcrypto } from 'node:crypto';
import { buildDevDelivery, prepareCustomPixel, CUSTOM_PIXEL_LENGTH_LIMIT } from '../scripts/build-dev-delivery.mjs';

const pixelSource = await readFile(new URL('../shopify/web-pixel.js', import.meta.url), 'utf8');
const themeSource = await readFile(new URL('../shopify/theme-liquid.html', import.meta.url), 'utf8');
const block = (text, kind) => text.slice(text.indexOf('/* TEALIUM_' + kind + '_START */'), text.indexOf('/* TEALIUM_' + kind + '_END */') + ('/* TEALIUM_' + kind + '_END */').length);
const defaults = vm.runInNewContext(block(pixelSource, 'CONFIG') + '\nTEALIUM_CONFIG');
const clone = value => JSON.parse(JSON.stringify(value));
const enabled = { enabled: true, account: 'test-account', profile: 'test-profile', environment: 'dev' };
const merchantUrl = 'https://www.velotricbike.com/products/bike';
const checkoutUrl = 'https://www.velotricbike.com/checkouts/cn/test';
const granted = { analyticsProcessingAllowed: true, marketingAllowed: true, preferencesProcessingAllowed: false, saleOfDataAllowed: false };
const variant = { id: 'v1', sku: 'SKU-1', title: 'Blue', price: { amount: '100', currencyCode: 'USD' }, product: { id: 'p1', title: 'Bike', vendor: 'Velotric', type: 'E-Bike' } };
const cartLine = { quantity: 2, merchandise: variant, cost: { totalAmount: { amount: '180', currencyCode: 'USD' } } };
const checkout = {
    token: 'checkout-token', customer: { id: 'customer-1' }, order: { id: 'order-1' },
    currencyCode: 'USD', email: ' Test@Example.COM ',
    lineItems: [{ quantity: 2, variant, finalLinePrice: { amount: '180' } }],
    subtotalPrice: { amount: '180' }, totalPrice: { amount: '208' }, totalTax: { amount: '18' },
    shippingLine: { title: 'Standard', price: { amount: '10' } }, discountsAmount: { amount: '20' },
    discountApplications: [{ type: 'DISCOUNT_CODE', title: 'SAVE20' }], transactions: [{ gateway: 'shopify_payments' }],
    shippingAddress: { firstName: 'Test', lastName: 'Buyer', address1: '1 Test Road', city: 'Test City', provinceCode: 'CA', zip: '00000', countryCode: 'US' },
};
const approvedEvents = [
    ['page_viewed', {}, 'page_view'], ['collection_viewed', { collection: { id: 'list1', title: 'Bikes', productVariants: [variant] } }, 'view_item_list'],
    ['velotric:sign_up', {}, 'sign_up'], ['velotric:login', {}, 'login'],
    ['product_viewed', { productVariant: variant }, 'view_item'], ['product_added_to_cart', { cartLine }, 'add_to_cart'],
    ['product_removed_from_cart', { cartLine }, 'remove_from_cart'],
    ['cart_viewed', { cart: { lines: [cartLine], cost: { totalAmount: { amount: '180', currencyCode: 'USD' } } } }, 'view_cart'],
    ['checkout_started', { checkout }, 'begin_checkout'], ['checkout_shipping_info_submitted', { checkout }, 'add_shipping_info'],
    ['payment_info_submitted', { checkout }, 'add_payment_info'], ['checkout_completed', { checkout }, 'purchase'],
];

function environment({ url = checkoutUrl, settings = enabled, privacy = granted, sdkReady = true, autoLoad = true, cookies = {}, cookieRead, tracking = {}, preserveConfiguration = false, consentmo = { analytics: true, marketing: true, preferences: false } } = {}) {
    const handlers = new Map();
    const listeners = new Map();
    const calls = [];
    const requests = [];
    const scripts = [];
    const posted = [];
    const warnings = [];
    const timers = new Map();
    const frames = [];
    const documentListeners = new Map();
    const cookieReads = [];
    const documentEvent = name => { for (const callback of [...(documentListeners.get(name) || [])]) callback({ type: name }); };
    let cmpState = consentmo;
    let nextTimer = 0;
    let now = 0;
    let privacyHandler;
    let parentReceiver;
    let parentProxy;
    const utag = { view: data => calls.push({ method: 'view', data: clone(data) }), link: data => calls.push({ method: 'link', data: clone(data) }) };
    const addScript = script => {
        scripts.push(script);
        if (autoLoad && script.src?.includes('tags.tiqcdn.com')) win.utag = utag;
    };
    const doc = {
        addEventListener(name, callback) { if (!documentListeners.has(name)) documentListeners.set(name, new Set()); documentListeners.get(name).add(callback); },
        removeEventListener(name, callback) { documentListeners.get(name)?.delete(callback); },
        head: { appendChild: addScript }, documentElement: { appendChild: addScript },
        createElement: () => ({ remove() {} }),
        getElementsByTagName: () => [{ parentNode: { insertBefore: addScript } }],
        querySelectorAll: () => frames,
    };
    class FakeDate extends Date { static now() { return now; } }
    const win = {
        document: doc, location: new URL(url), crypto: webcrypto,
        setTimeout(fn, ms) { const id = ++nextTimer; timers.set(id, { fn, at: now + ms }); return id; },
        clearTimeout(id) { timers.delete(id); },
        addEventListener(name, callback) { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(callback); },
        postMessage(data) { deliver({ source: parentProxy, origin: new URL(url).origin, data: clone(data) }); },
    };
    parentProxy = { postMessage(data, target) { posted.push({ data: clone(data), target }); parentReceiver?.(data); } };
    win.parent = parentProxy;
    function setConsentmo(state, emit = true) {
        cmpState = state;
        win.Consentmo = state === null ? undefined : { currentVisitorConsent: () => cmpState, events: { ConsentUpdate: 'consentmo:update' } };
        if (emit) documentEvent('consentmo:update');
    }
    setConsentmo(consentmo, false);
    if (sdkReady) win.utag = utag;
    const context = vm.createContext({
        window: win, document: doc, URL, Date: FakeDate, TextEncoder, Uint8Array,
        console: { warn: (...args) => warnings.push(args), error: (...args) => warnings.push(args), log() {} },
        performance: { now: () => now },
        init: { context: { document: { location: { href: url }, title: 'Merchant page', referrer: 'https://www.velotricbike.com/' } }, customerPrivacy: privacy, data: { shop: { name: 'Velotric', countryCode: 'US' } } },
        browser: { cookie: { get: name => { cookieReads.push(name); return cookieRead ? cookieRead(name) : Promise.resolve(cookies[name] ?? null); } } },
        analytics: { subscribe(name, callback) { if (!handlers.has(name)) handlers.set(name, []); handlers.get(name).push(callback); } },
        api: { customerPrivacy: { subscribe(name, callback) { privacyHandler = callback; } } },
        fetch: async (address, options) => { requests.push({ address, options, body: JSON.parse(options.body) }); return { ok: true }; },
    });
    Object.defineProperty(context, 'dataLayer', { get: () => win.dataLayer });
    function deliver(message) { for (const callback of listeners.get('message') || []) callback(message); }
    const settingsBlock = '/* TEALIUM_CONFIG_START */\nconst TEALIUM_CONFIG = ' + JSON.stringify({ ...defaults, ...settings }) + ';\n/* TEALIUM_CONFIG_END */';
    const configured = source => preserveConfiguration ? source : Object.entries(tracking).reduce((result, [key, value]) => result.replace(key + ': true', key + ': ' + value), source.replace(block(source, 'CONFIG'), settingsBlock));
    const settle = async () => { await vm.runInContext('typeof tealiumBuildQueue === "undefined" ? Promise.resolve() : tealiumBuildQueue', context); await new Promise(resolve => setImmediate(resolve)); };
    return {
        win, doc, handlers, context, calls, requests, scripts, posted, warnings, frames, timers, utag, deliver, settle, setConsentmo, documentEvent, cookieReads,
        windowEvent(name) { for (const callback of listeners.get(name) || []) callback({ type: name }); },
        runPixel(source = pixelSource) { vm.runInContext(configured(source), context); },
        runTheme(source = themeSource) { for (const [, body] of configured(source).matchAll(/<script>([\s\S]*?)<\/script>/g)) vm.runInContext(body, context); },
        event(name, data = {}, customData = {}, extra = {}) {
            const event = { id: name + '-id', timestamp: '2026-10-23T04:00:00.000Z', name, context: { document: { location: { href: url }, title: 'Merchant page', referrer: 'https://www.velotricbike.com/' } }, data: clone(data), customData, ...extra };
            for (const callback of handlers.get(name) || []) callback(event);
            return event;
        },
        privacy(state) { privacyHandler?.({ customerPrivacy: state }); },
        parent(receiver) { parentReceiver = receiver; },
        async advance(ms) {
            now += ms;
            for (let count = 0; count < 100; count += 1) {
                const entry = [...timers].find(([, timer]) => timer.at <= now);
                if (!entry) break;
                timers.delete(entry[0]); entry[1].fn();
                await new Promise(resolve => setImmediate(resolve));
            }
        },
    };
}
function connect(pixel, theme) {
    theme.frames.push({ contentWindow: pixel.win });
    pixel.parent(data => theme.deliver({ source: pixel.win, origin: 'null', data: clone(data) }));
    for (const message of pixel.posted.filter(item => item.data.kind === 'hello')) theme.deliver({ source: pixel.win, origin: 'null', data: message.data });
}


const approvedPayloads = JSON.parse(await readFile(new URL('fixtures/approved-tealium-payloads.json', import.meta.url), 'utf8'));

test('Tealium-only sources preserve shared blocks and contain no legacy sender', () => {
    const themeSettings = vm.runInNewContext(block(themeSource, 'CONFIG') + '\nTEALIUM_CONFIG');
    for (const [key, value] of Object.entries(themeSettings)) assert.deepEqual(clone(value), clone(defaults[key]));
    assert.doesNotMatch(themeSource, /createVelotricTealiumRuntime|setTimeout|queueLimit|Consentmo/);
    assert.equal(defaults.enabled, false);
    assert.equal(defaults.environment, 'dev');
    assert.match(pixelSource, /measurementId: 'G-4FLMVWWG56'/);
    assert.doesNotMatch(pixelSource + themeSource, /storefrontOrigins|tealium-5hvassg6\.myshopify\.com/);
    assert.doesNotMatch(pixelSource + themeSource, /STAPE_|GTM-|securemetrics|sendStoreCookies|loadGTM|dataLayer|legacyTrackingEnabled|G-HMY36WYC3Q/);
});

test('all 12 approved Tealium payloads match the pre-separation regression fixture', async () => {
    const env = environment(); env.runPixel();
    for (const [name, data] of approvedEvents) {
        env.event(name, data, { method: 'email', user_id: 'existing-hashed-id' }); await env.settle();
    }
    assert.deepEqual(env.calls, approvedPayloads);
    assert.equal(env.calls.length, 12);
    assert.equal(env.win.dataLayer, undefined);
    assert.equal(env.requests.length, 0);
    assert.equal(env.handlers.has('checkout_contact_info_submitted'), false);
});

test('purchase maps discounted prices, money, and normalized hashed identity', async () => {
    const env = environment(); env.runPixel(); env.event('checkout_completed', { checkout }); await env.settle();
    const data = env.calls[0].data;
    assert.equal(data.order_id, 'order-1');
    assert.deepEqual(data.product_price, [90]); assert.deepEqual(data.product_quantity, [2]);
    assert.equal(data.value, 180); assert.equal(data.order_subtotal, 180); assert.equal(data.order_total, 208);
    assert.equal(data.order_tax_amount, 18); assert.equal(data.order_shipping_amount, 10); assert.equal(data.order_discount_amount, 20);
    assert.equal(data.customer_email_hash, createHash('sha256').update('test@example.com').digest('hex'));
    assert.equal(data.customer_country, 'US');
    assert.equal(data.customer_email, undefined); assert.equal(data.user_email, undefined); assert.equal(data.user_data, undefined);
    assert.equal(data.cart_token, undefined); assert.equal(data.checkout_token, undefined);
});

test('purchase requires the real order ID and deduplicates by order as well as source', async () => {
    const env = environment(); env.runPixel();
    env.event('checkout_completed', { checkout: { ...checkout, order: null } });
    env.event('checkout_completed', { checkout }); env.event('checkout_completed', { checkout });
    env.event('checkout_completed', { checkout }, {}, { id: 'new-source-same-order' }); await env.settle();
    assert.equal(env.calls.length, 1);
});

test('plan-defined SKU or variant labels stay aligned across nine commerce events', async () => {
    const variants = [
        { ...variant, id: 'bad', sku: 'FILTERED', price: { ...variant.price, amount: '-1' } },
        { ...variant, id: 'empty', sku: null, title: 'Default Title' },
        { ...variant, id: 'real', sku: 'sku-managed-1' },
    ];
    const lines = variants.map(merchandise => ({ quantity: 1, merchandise, cost: { totalAmount: merchandise.price } }));
    const checkoutData = { ...checkout, lineItems: variants.map(variant => ({ quantity: 1, variant })) };
    const cases = [
        ['collection_viewed', { collection: { id: 'list', productVariants: variants } }, ['Default Title', 'sku-managed-1']],
        ['product_viewed', { productVariant: variants[1] }, ['Default Title']],
        ['product_added_to_cart', { cartLine: lines[1] }, ['Default Title']], ['product_removed_from_cart', { cartLine: lines[1] }, ['Default Title']],
        ['cart_viewed', { cart: { lines, cost: { totalAmount: { amount: '200', currencyCode: 'USD' } } } }, ['Default Title', 'sku-managed-1']],
        ...['checkout_started', 'checkout_shipping_info_submitted', 'payment_info_submitted', 'checkout_completed']
            .map(name => [name, { checkout: checkoutData }, ['Default Title', 'sku-managed-1']]),
    ];
    for (const [name, data, expected] of cases) {
        const env = environment(); env.runPixel(); env.event(name, data); await env.settle();
        assert.deepEqual(env.calls[0].data.product_sku, expected, name);
        for (const [key, values] of Object.entries(env.calls[0].data).filter(([key]) => key.startsWith('product_'))) {
            assert.equal(values.length, expected.length, name + ':' + key);
        }
    }
});

test('product and identity inputs are snapshotted before asynchronous preparation', async () => {
    const env = environment(); env.runPixel();
    const event = env.event('cart_viewed', { cart: { lines: [cartLine], cost: { totalAmount: { amount: '180', currencyCode: 'USD' } } } });
    event.data.cart.lines[0].merchandise.sku = 'CHANGED'; event.data.cart.lines[0].quantity = 99;
    await env.settle(); assert.deepEqual(env.calls[0].data.product_sku, ['SKU-1']); assert.deepEqual(env.calls[0].data.product_quantity, [2]);
});

test('existing attribution cookies are read without inventing missing GA identifiers', async () => {
    const env = environment({ cookies: { gtm_dd_sep_source: 'google', gtm_dd_sep_medium: 'cpc', _ga: 'GA1.1.123.456', _ga_4FLMVWWG56: 'GS2.1.s789$o1$g1' } });
    env.runPixel(); env.event('page_viewed'); await env.settle();
    assert.equal(env.calls[0].data.client_id, '123.456'); assert.equal(env.calls[0].data.session_id, '789');
    assert.equal(env.calls[0].data.cus_utm_source, 'google'); assert.equal(env.calls[0].data.cus_utm_medium, 'cpc');
    const missing = environment(); missing.runPixel(); missing.event('page_viewed'); await missing.settle();
    assert.equal(missing.calls[0].data.client_id, undefined); assert.equal(missing.calls[0].data.session_id, undefined);
});

test('denied Shopify consent prevents cookie reads, SDK loads, and historical replay', async () => {
    const env = environment({ privacy: { ...granted, analyticsProcessingAllowed: false }, sdkReady: false }); env.runPixel();
    env.event('page_viewed'); await env.settle();
    assert.equal(env.cookieReads.length, 0); assert.equal(env.scripts.length, 0); assert.equal(env.calls.length, 0);
    env.privacy(granted); await env.settle(); assert.equal(env.calls.length, 0);
    env.event('page_viewed', {}, {}, { id: 'after-grant' }); await env.settle(); assert.equal(env.calls.length, 1);
});

test('partial consent excludes identity and addresses while permitted analytics continues', async () => {
    const env = environment({ privacy: { ...granted, marketingAllowed: false } }); env.runPixel();
    env.event('velotric:login', {}, { user_id: 'secret', customer_email: 'test@example.com', method: 'email' });
    env.event('checkout_completed', { checkout }); await env.settle();
    assert.equal(env.calls.length, 2);
    assert.ok(env.calls.every(call => !Object.keys(call.data).some(key => key === 'user_id' || key.startsWith('customer_'))));
    env.privacy(granted); env.event('page_viewed'); await env.settle(); assert.equal(env.calls.at(-1).data.user_id, undefined);
});

test('withdrawal while the SDK is pending discards queued events permanently', async () => {
    const env = environment({ sdkReady: false, autoLoad: false }); env.runPixel(); env.event('checkout_completed', { checkout }); await env.settle();
    env.privacy({ ...granted, analyticsProcessingAllowed: false }); env.privacy(granted);
    env.win.utag = env.utag; await env.advance(100); assert.equal(env.calls.length, 0);
    env.event('page_viewed'); await env.settle(); assert.equal(env.calls.length, 1);
});

test('identity withdrawal redacts all queued customer fields permanently even if granted again', async () => {
    const env = environment({ sdkReady: false, autoLoad: false }); env.runPixel();
    env.event('velotric:login', {}, { user_id: 'customer-1', customer_email: 'test@example.com' });
    env.event('checkout_completed', { checkout }); await env.settle();
    env.privacy({ ...granted, marketingAllowed: false }); env.privacy(granted);
    env.win.utag = env.utag; await env.advance(100);
    assert.deepEqual(env.calls.map(call => call.data.tealium_event), ['login', 'purchase']);
    assert.ok(env.calls.every(call => !Object.keys(call.data).some(key => key === 'user_id' || key.startsWith('customer_'))));
});

test('withdrawal during asynchronous cookie preparation cannot be undone by a later grant', async () => {
    let release;
    const blocked = new Promise(resolve => { release = resolve; });
    const env = environment({ cookieRead: () => blocked }); env.runPixel(); env.event('checkout_completed', { checkout });
    await new Promise(resolve => setImmediate(resolve));
    env.privacy({ ...granted, analyticsProcessingAllowed: false }); env.privacy(granted); release(null); await env.settle();
    assert.equal(env.calls.length, 0);
});

test('delayed or partially initialized utag queues once and emits in order after methods exist', async () => {
    const env = environment({ sdkReady: false, autoLoad: false }); env.runPixel();
    env.event('page_viewed'); env.event('product_viewed', { productVariant: variant }); await env.settle();
    assert.equal(env.scripts.length, 1); assert.equal(env.win.utag_cfg_ovrd.noview, true); assert.equal(env.calls.length, 0);
    env.win.utag = {}; await env.advance(100); assert.equal(env.calls.length, 0);
    env.win.utag = env.utag; await env.advance(100);
    assert.deepEqual(env.calls.map(call => call.data.tealium_event), ['page_view', 'view_item']);
    assert.equal(env.scripts[0].src, 'https://tags.tiqcdn.com/utag/test-account/test-profile/dev/utag.js');
});

test('missing utag methods, SDK errors, and absent bridge time out without uncaught errors', async () => {
    const env = environment({ sdkReady: false, autoLoad: false, settings: { ...enabled, readyTimeoutMs: 100 } });
    env.runPixel(); env.event('page_viewed'); await env.settle(); await env.advance(101);
    assert.equal(env.calls.length, 0); assert.equal(env.timers.size, 0); assert.ok(env.warnings.length);
    const failure = environment({ sdkReady: false, autoLoad: false }); failure.runPixel(); failure.event('page_viewed'); await failure.settle();
    failure.scripts[0].onerror(); assert.equal(failure.timers.size, 0); assert.equal(failure.calls.length, 0);
    const storefront = environment({ url: merchantUrl, settings: { ...enabled, readyTimeoutMs: 100 } });
    storefront.runPixel(); await storefront.advance(101); assert.equal(storefront.timers.size, 0); assert.equal(storefront.calls.length, 0);
});

test('bounded SDK queues release source deduplication keys when evicting old events', async () => {
    const env = environment({ sdkReady: false, autoLoad: false, settings: { ...enabled, queueLimit: 2 } }); env.runPixel();
    for (const id of ['first', 'second', 'third', 'first']) { env.event('page_viewed', {}, {}, { id }); await env.settle(); }
    env.win.utag = env.utag; await env.advance(100);
    assert.deepEqual(env.calls.map(call => call.data.event_id), ['third', 'first']);
});

test('unresponsive cookie API expires preparation and releases the event queue', async () => {
    const env = environment({ cookieRead: () => new Promise(() => {}), settings: { ...enabled, readyTimeoutMs: 100 } }); env.runPixel();
    env.event('page_viewed'); await new Promise(resolve => setImmediate(resolve)); await env.advance(101); await env.settle();
    assert.equal(env.calls.length, 0); assert.equal(vm.runInContext('pendingTealiumBuilds', env.context), 0); assert.ok(env.warnings.length);
});

test('login hashes once, identity propagates, and logout clears queued identity', async () => {
    const env = environment(); env.runPixel();
    const hash = createHash('sha256').update('test@example.com').digest('hex');
    env.event('velotric:login', {}, { method: 'email', user_id: 'existing-id', customer_email_hash: hash.toUpperCase() }); await env.settle();
    env.event('page_viewed'); await env.settle(); assert.equal(env.calls[1].data.customer_email_hash, hash);
    env.event('velotric:logout'); env.event('page_viewed', {}, {}, { id: 'after-logout' }); await env.settle();
    assert.equal(env.calls.at(-1).data.user_id, undefined); assert.equal(env.calls.at(-1).data.customer_email_hash, undefined);
});

test('missing source IDs, invalid timestamps, and non-HTTPS event URLs are skipped', async () => {
    const env = environment(); env.runPixel();
    env.event('page_viewed', {}, {}, { id: undefined }); env.event('page_viewed', {}, {}, { timestamp: 'bad' });
    env.event('page_viewed', {}, {}, { context: { document: { location: { href: 'http://other.example/' } } } });
    await env.settle(); assert.equal(env.calls.length, 0); assert.equal(env.cookieReads.length, 0);
});

function bridged(options = {}) {
    const pixel = environment({ url: merchantUrl, ...options }); pixel.runPixel();
    const theme = environment({ url: merchantUrl, ...options }); theme.runTheme(); connect(pixel, theme);
    return { pixel, theme };
}

test('storefront dispatches through its theme only without touching existing dataLayer', async () => {
    const { pixel, theme } = bridged({ sdkReady: false });
    theme.win.dataLayer = [{ event: 'existing-event' }];
    pixel.event('page_viewed'); pixel.event('product_added_to_cart', { cartLine }); await pixel.settle();
    assert.equal(pixel.calls.length, 0); assert.equal(pixel.scripts.length, 0);
    assert.deepEqual(theme.calls.map(call => call.data.tealium_event), ['page_view', 'add_to_cart']);
    assert.deepEqual(theme.win.dataLayer, [{ event: 'existing-event' }]); assert.equal(pixel.win.dataLayer, undefined);
    assert.equal(theme.scripts.length, 1); assert.equal(theme.requests.length, 0);
    assert.equal(theme.scripts[0].type, 'text/javascript');
    assert.equal(theme.scripts[0].async, true);
    assert.equal(theme.win.utag_cfg_ovrd.noview, true);
    assert.equal(theme.scripts[0].src, 'https://tags.tiqcdn.com/utag/test-account/test-profile/dev/utag.js');
});

test('purchase retains order shipping fallback and address omission configuration', async () => {
    const env = environment({ settings: { ...enabled, includePurchaseAddress: false } }); env.runPixel();
    const data = { ...checkout, shippingLine: null, order: { id: 'fallback-order', shippingLine: { title: 'Express' },
        totalShippingPriceSet: { shopMoney: { amount: '12' } } } };
    env.event('checkout_completed', { checkout: data }); await env.settle();
    assert.equal(env.calls[0].data.shipping_tier, 'Express'); assert.equal(env.calls[0].data.order_shipping_amount, 12);
    assert.equal(env.calls[0].data.customer_first_name, undefined); assert.ok(env.calls[0].data.customer_email_hash);
});

test('bridge rejects untrusted frames, wrong channels, old protocol, and wrong ready origins', async () => {
    const { pixel, theme } = bridged();
    const payload = { tealium_event: 'page_view', event_id: 'forged', page_location: merchantUrl };
    const consent = { cmp_consent_analytics: 'granted', cmp_consent_marketing: 'granted' };
    const message = { channel: 'velotric:tealium', version: 3, kind: 'event', payload, consent, captureConsent: consent, revision: 0 };
    theme.deliver({ source: {}, data: message });
    theme.deliver({ source: pixel.win, data: { ...message, channel: 'other' } });
    theme.deliver({ source: pixel.win, data: { ...message, version: 2 } });
    theme.deliver({ source: pixel.win, data: { ...message, payload: { ...payload, page_location: 'https://other.example/' } } });
    assert.equal(theme.calls.length, 0);
    pixel.deliver({ source: pixel.win.parent, origin: 'https://other.example', data: { channel: 'velotric:tealium', version: 3, kind: 'consentmo', revision: 100, consent: {} } });
    pixel.event('page_viewed'); await pixel.settle(); assert.equal(theme.calls.length, 1);
});

test('disabled or non-HTTPS pages perform no work or changes to existing tracking', async () => {
    for (const options of [
        { url: 'https://www.velotricbike.com/', settings: { ...enabled, enabled: false } },
        { url: 'http://velotric.myshopify.com/', settings: enabled },
        { url: 'about:blank', settings: enabled },
    ]) {
        const pixel = environment(options); pixel.win.dataLayer = [{ event: 'existing' }]; pixel.runPixel();
        const theme = environment(options); theme.win.dataLayer = [{ event: 'existing' }]; theme.runTheme();
        pixel.event('page_viewed'); await pixel.settle();
        for (const env of [pixel, theme]) {
            assert.equal(env.scripts.length, 0); assert.equal(env.requests.length, 0); assert.equal(env.cookieReads.length, 0);
            assert.equal(env.timers.size, 0); assert.deepEqual(env.win.dataLayer, [{ event: 'existing' }]);
        }
        assert.equal(pixel.handlers.size, 0);
    }
});

test('Dev delivery runs standalone checkout and inline storefront with its own configuration', async () => {
    const url = 'https://velotric-test.myshopify.com'; const delivery = await buildDevDelivery();
    assert.ok(delivery.pixel.length < CUSTOM_PIXEL_LENGTH_LIMIT); assert.ok(Buffer.byteLength(delivery.pixel) < CUSTOM_PIXEL_LENGTH_LIMIT);
    assert.doesNotMatch(delivery.pixel + delivery.theme, /STAPE_|GTM-|securemetrics|dataLayer|asset_url/);
    // Shopify's editor must see literal subscriptions as well as working runtime registrations.
    const literalEvents = [...delivery.pixel.matchAll(/\banalytics\.subscribe\((["'])([^"']+)\1\s*,/g)].map(match => match[2]);
    assert.deepEqual(literalEvents.sort(), [...approvedEvents.map(([name]) => name), 'velotric:logout'].sort());
    const checkoutEnv = environment({ url: url + '/checkouts/cn/test', preserveConfiguration: true,
        cookies: { _ga: 'GA1.1.123.456', _ga_4FLMVWWG56: 'GS2.1.s789$o1$g1' } });
    checkoutEnv.runPixel(delivery.pixel); checkoutEnv.event('checkout_completed', { checkout }); await checkoutEnv.settle();
    assert.deepEqual([...checkoutEnv.handlers.keys()].sort(), [...approvedEvents.map(([name]) => name), 'velotric:logout'].sort());
    assert.ok([...checkoutEnv.handlers.values()].every(callbacks => callbacks.length === 1));
    assert.equal(checkoutEnv.calls[0].data.session_id, '789'); assert.equal(checkoutEnv.requests.length, 0);
    const pixel = environment({ url, preserveConfiguration: true, consentmo: null }); pixel.runPixel(delivery.pixel);
    const theme = environment({ url, preserveConfiguration: true, consentmo: null }); theme.runTheme(delivery.theme); connect(pixel, theme);
    pixel.event('page_viewed'); await pixel.settle(); assert.equal(theme.calls.length, 1); assert.equal(pixel.calls.length, 0);
    assert.doesNotMatch(delivery.pixel + delivery.theme, /consentmoRequired|Consentmo/);
    assert.equal(theme.timers.size, 0); assert.equal(theme.warnings.length, 0);
});

test('Dev without Consentmo still honors Shopify grants, denial, withdrawal, and identity permission', async () => {
    const url = 'https://velotric-test.myshopify.com'; const delivery = await buildDevDelivery();
    const options = { url, preserveConfiguration: true, consentmo: null, privacy: null };
    const pixel = environment(options); pixel.runPixel(delivery.pixel);
    const theme = environment(options); theme.runTheme(delivery.theme); connect(pixel, theme);
    pixel.event('page_viewed'); await pixel.settle(); assert.equal(theme.calls.length, 0); assert.equal(pixel.cookieReads.length, 0);
    pixel.privacy({ ...granted, analyticsProcessingAllowed: false });
    pixel.event('page_viewed', {}, {}, { id: 'denied' }); await pixel.settle(); assert.equal(theme.calls.length, 0);
    pixel.privacy({ ...granted, marketingAllowed: false });
    pixel.event('checkout_completed', { checkout }); await pixel.settle(); assert.equal(theme.calls.length, 1);
    assert.equal(theme.calls[0].data.customer_email_hash, undefined); assert.equal(theme.calls[0].data.customer_first_name, undefined);
    pixel.privacy({ ...granted, analyticsProcessingAllowed: false });
    pixel.event('page_viewed', {}, {}, { id: 'revoked' }); await pixel.settle(); assert.equal(theme.calls.length, 1);
    pixel.privacy(granted); await pixel.settle(); assert.equal(theme.calls.length, 1);
    pixel.event('page_viewed', {}, {}, { id: 'new-after-grant' }); await pixel.settle(); assert.equal(theme.calls.length, 2);
});

test('strict delivery size checks include the notice and multibyte strings', async () => {
    const source = value => 'globalThis.payload = ' + JSON.stringify(value) + ';';
    const overhead = (await prepareCustomPixel(source(''))).length;
    const accepted = source('x'.repeat(CUSTOM_PIXEL_LENGTH_LIMIT - overhead - 1));
    assert.equal((await prepareCustomPixel(accepted)).length, CUSTOM_PIXEL_LENGTH_LIMIT - 1);
    await assert.rejects(prepareCustomPixel(source('x'.repeat(CUSTOM_PIXEL_LENGTH_LIMIT - overhead))), /shorter than 64000/);
    await assert.rejects(prepareCustomPixel(accepted, '// TEALIUM DEV POC.'), /shorter than 64000/);
    await assert.rejects(prepareCustomPixel(source('雪'.repeat(22_000))), /shorter than 64000/);
});

test('the same Dev delivery works on installed Shopify and custom domains without a fixed allowlist', async () => {
    const delivery = await buildDevDelivery();
    assert.doesNotMatch(delivery.pixel + delivery.minifiedPixel + delivery.theme, /storefrontOrigins|tealium-5hvassg6\.myshopify\.com/);
    assert.ok(delivery.minifiedPixel.length < delivery.pixel.length);
    assert.ok(Buffer.byteLength(delivery.minifiedPixel) < CUSTOM_PIXEL_LENGTH_LIMIT);
    for (const url of ['https://velotric.myshopify.com', 'https://www.velotricbike.com', 'https://unlisted-test.example']) {
        for (const source of [delivery.pixel, delivery.minifiedPixel]) {
            const pixel = environment({ url, preserveConfiguration: true }); pixel.runPixel(source);
            const theme = environment({ url, preserveConfiguration: true, sdkReady: false }); theme.runTheme(delivery.theme); connect(pixel, theme);
            pixel.event('page_viewed'); await pixel.settle();
            assert.equal(theme.calls.length, 1); assert.equal(pixel.calls.length, 0);
            assert.equal(theme.scripts[0].src, 'https://tags.tiqcdn.com/utag/velotric-trial/main/dev/utag.js');
            assert.equal(pixel.posted.filter(message => message.data.kind === 'event').length, 1);
            assert.ok(pixel.posted.every(message => message.target === url));
            const checkoutEnv = environment({ url: url + '/checkouts/cn/test', preserveConfiguration: true, sdkReady: false });
            checkoutEnv.runPixel(source); checkoutEnv.event('checkout_started', { checkout }); await checkoutEnv.settle();
            assert.equal(checkoutEnv.calls.length, 1); assert.equal(checkoutEnv.calls[0].data.tealium_event, 'begin_checkout');
            assert.equal(checkoutEnv.scripts[0].src, 'https://tags.tiqcdn.com/utag/velotric-trial/main/dev/utag.js');
            assert.equal(checkoutEnv.posted.length, 0);
        }
    }
});

test('compact delivery preserves all 12 approved event payloads', async () => {
    const delivery = await buildDevDelivery();
    const env = environment({ preserveConfiguration: true }); env.runPixel(delivery.minifiedPixel);
    for (const [name, data] of approvedEvents) {
        env.event(name, data, { method: 'email', user_id: 'existing-hashed-id' }); await env.settle();
    }
    assert.deepEqual(env.calls, approvedPayloads);
});

test('removing the domain allowlist retains exact parent-source and ready-origin checks', async () => {
    const url = 'https://velotric.myshopify.com';
    const delivery = await buildDevDelivery();
    const pixel = environment({ url, preserveConfiguration: true }); pixel.runPixel(delivery.minifiedPixel);
    const ready = { channel: 'velotric:tealium', version: 3, kind: 'ready' };
    pixel.event('page_viewed'); await pixel.settle();
    pixel.deliver({ source: {}, origin: url, data: ready });
    pixel.deliver({ source: pixel.win.parent, origin: 'https://other.example', data: ready });
    await pixel.advance(50);
    assert.equal(pixel.posted.filter(message => message.data.kind === 'event').length, 0);
    pixel.deliver({ source: pixel.win.parent, origin: url, data: ready });
    await pixel.advance(50);
    const events = pixel.posted.filter(message => message.data.kind === 'event');
    assert.equal(events.length, 1); assert.equal(events[0].target, url);
});


test('the original per-event tracking switches remain independent', async () => {
    const env = environment({ tracking: { trackViewCart: false, trackPurchase: false } }); env.runPixel();
    assert.equal(env.handlers.has('cart_viewed'), false); assert.equal(env.handlers.has('checkout_completed'), false);
    env.event('product_added_to_cart', { cartLine }); await env.settle(); assert.equal(env.calls[0].data.tealium_event, 'add_to_cart');
});

test('thin theme keeps SDK waiting and withdrawal queues in the Pixel', async () => {
    const { pixel, theme } = bridged({ sdkReady: false, autoLoad: false });
    pixel.event('page_viewed'); pixel.event('product_added_to_cart', { cartLine }); await pixel.settle();
    assert.equal(theme.scripts.length, 1); assert.equal(theme.timers.size, 0); assert.equal(theme.calls.length, 0);
    pixel.privacy({ ...granted, analyticsProcessingAllowed: false }); pixel.privacy(granted);
    theme.win.utag = theme.utag; await pixel.advance(100); assert.equal(theme.calls.length, 0);
    pixel.event('page_viewed', {}, {}, { id: 'after-grant' }); await pixel.settle();
    assert.equal(theme.calls.length, 1);
});

test('the parent does not load or dispatch before Shopify analytics permission', async () => {
    const { pixel, theme } = bridged({ sdkReady: false, privacy: { ...granted, analyticsProcessingAllowed: false } });
    pixel.event('page_viewed'); await pixel.settle(); assert.equal(theme.scripts.length, 0); assert.equal(pixel.cookieReads.length, 0);
    pixel.privacy(granted); pixel.event('page_viewed', {}, {}, { id: 'permitted' }); await pixel.settle();
    assert.equal(theme.calls.length, 1); assert.equal(theme.scripts.length, 1);
});

test('parent-bound SDK readiness preserves ordered delivery and source/order deduplication', async () => {
    const { pixel, theme } = bridged({ sdkReady: false, autoLoad: false });
    pixel.event('page_viewed'); pixel.event('checkout_completed', { checkout }); pixel.event('checkout_completed', { checkout }); await pixel.settle();
    theme.win.utag = theme.utag; await pixel.advance(100);
    assert.deepEqual(theme.calls.map(call => call.data.tealium_event), ['page_view', 'purchase']);
    assert.equal(theme.timers.size, 0); assert.equal(theme.scripts.length, 1);
});

test('marketing withdrawal redacts the Pixel queue before it reaches the thin theme', async () => {
    const { pixel, theme } = bridged({ sdkReady: false, autoLoad: false });
    pixel.event('checkout_completed', { checkout }); await pixel.settle();
    pixel.privacy({ ...granted, marketingAllowed: false }); pixel.privacy(granted);
    theme.win.utag = theme.utag; await pixel.advance(100);
    assert.equal(theme.calls.length, 1); assert.equal(theme.calls[0].data.customer_email_hash, undefined);
    assert.equal(theme.calls[0].data.customer_first_name, undefined);
});

test('parent SDK failures and a missing theme expire safely in the Pixel', async () => {
    const options = { sdkReady: false, autoLoad: false, settings: { ...enabled, readyTimeoutMs: 100 } };
    const { pixel, theme } = bridged(options); pixel.event('page_viewed'); await pixel.settle();
    theme.scripts[0].onerror(); await pixel.advance(101);
    assert.equal(theme.calls.length, 0); assert.equal(pixel.timers.size, 0); assert.equal(theme.timers.size, 0);
    const alone = environment({ url: merchantUrl, ...options }); alone.runPixel(); alone.event('page_viewed'); await alone.settle();
    await alone.advance(101); assert.equal(alone.timers.size, 0); assert.ok(alone.warnings.length);
});

test('the receiver rejects stale revisions and late events whose captured permission was denied', async () => {
    const { pixel, theme } = bridged();
    const grantedState = { cmp_consent_analytics: 'granted', cmp_consent_marketing: 'granted' };
    const event = { channel: 'velotric:tealium', version: 3, kind: 'event', revision: 0, consent: grantedState,
        captureConsent: grantedState, payload: { tealium_event: 'page_view', event_id: 'late', page_location: merchantUrl } };
    theme.deliver({ source: pixel.win, data: { ...event, kind: 'consent', revision: 2, consent: { cmp_consent_analytics: 'denied' } } });
    theme.deliver({ source: pixel.win, data: event }); assert.equal(theme.calls.length, 0);
    theme.deliver({ source: pixel.win, data: { ...event, revision: 3, captureConsent: { cmp_consent_analytics: 'denied' } } });
    assert.equal(theme.calls.length, 0);
    theme.runTheme(); assert.equal(theme.timers.size, 0); assert.equal(theme.scripts.length, 0);
});
