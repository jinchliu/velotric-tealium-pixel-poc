/*==============================================================================
  Settings
==============================================================================*/
const config = {
    conversionTracking: {
        measurementId: 'G-4FLMVWWG56', // Existing test-stream cookie lookup only.
        trackPageViews: true,
        trackViewItemList: true,
        trackViewItem: true,
        trackAddToCart: true,
        trackViewCart: true,
        trackRemoveFromCart: true,
        trackBeginCheckout: true,
        trackAddShippingInfo: true,
        trackAddPaymentInfo: true,
        trackPurchase: true,
    },
    store: {
        gmcCountryFallback: 'US',
        affiliationName: typeof init !== 'undefined' && init.data && init.data.shop ? init.data.shop.name : 'Unknown Store',
    },
};

/* TEALIUM_CONFIG_START */
const TEALIUM_CONFIG = {
    enabled: false,
    account: 'velotric-trial',
    profile: 'main',
    environment: 'dev',
    storefrontOrigins: ['https://tealium-5hvassg6.myshopify.com'],
    collectConsentCategory: 'analytics',
    identityConsentCategory: 'marketing',
    includePurchaseAddress: true,
    queueLimit: 100,
    readyTimeoutMs: 10000,
    pixelIframeSelector: 'iframe[id^="web-pixel-sandbox-CUSTOM-"]',
};
/* TEALIUM_CONFIG_END */

/*==============================================================================
  Tealium sender: one queue for checkout or the storefront bridge
==============================================================================*/
function createVelotricTealiumRuntime(settings, transport = null) {
    const consentKeys = ['analytics', 'marketing', 'personalization', 'sale_of_data'];
    const events = new Set(Object.values(eventMap));
    let consent = {};
    let queue = [];
    let script = null;
    let timer = null;
    let deadline = 0;
    let failed = false;
    const seen = new Set();
    const orders = new Set();
    const pending = new Set();
    const pendingOrders = new Set();
    const permitted = state => state['cmp_consent_' + settings.collectConsentCategory] === 'granted';
    const identityPermitted = state => state['cmp_consent_' + settings.identityConsentCategory] === 'granted';
    const configured = () => settings.enabled && /^[a-zA-Z0-9_-]+$/.test(settings.account)
        && /^[a-zA-Z0-9_-]+$/.test(settings.profile) && ['dev', 'qa', 'prod'].includes(settings.environment)
        && consentKeys.includes(settings.collectConsentCategory) && consentKeys.includes(settings.identityConsentCategory);
    const remember = (set, value) => {
        set.add(value);
        if (set.size > 1000) set.delete(set.values().next().value);
    };
    function discard(entry) {
        pending.delete(entry.payload.event_id);
        if (entry.payload.order_id) pendingOrders.delete(entry.payload.order_id);
    }
    function clearQueue() {
        queue.forEach(discard);
        queue = [];
        if (timer !== null) window.clearTimeout(timer);
        timer = null;
    }
    function setConsent(next) {
        consent = Object.fromEntries(consentKeys.map(category => {
            const key = 'cmp_consent_' + category;
            return [key, ['granted', 'denied', 'unknown'].includes(next?.[key]) ? next[key] : 'unknown'];
        }));
        if (!permitted(consent)) clearQueue();
        if (!identityPermitted(consent)) queue.forEach(entry => stripIdentity(entry.payload));
    }
    function fail() {
        failed = true;
        clearQueue();
        if (script) script.remove();
        script = null;
        console.warn('[tealium] SDK unavailable; queued events discarded.');
    }
    function flush() {
        timer = null;
        if (!permitted(consent)) return clearQueue();
        if (transport && !transport.ready()) transport.requestReady();
        const ready = transport ? transport.ready()
            : typeof window.utag?.view === 'function' && typeof window.utag?.link === 'function';
        if (!ready) {
            if (Date.now() >= deadline) return fail();
            timer = window.setTimeout(flush, 50);
            return;
        }
        while (queue.length) {
            const entry = queue.shift();
            const payload = entry.payload;
            discard(entry);
            if (!permitted(consent) || !permitted(entry.captureConsent)) continue;
            if (!identityPermitted(consent) || !identityPermitted(entry.captureConsent)) stripIdentity(payload);
            Object.assign(payload, consent);
            // Mark before invoking vendor code, including a vendor exception.
            remember(seen, payload.event_id);
            if (payload.order_id) remember(orders, payload.order_id);
            try {
                if (transport) transport.send(payload, entry.captureConsent);
                else if (payload.tealium_event === 'page_view') window.utag.view(payload);
                else window.utag.link(payload);
            } catch (error) {
                console.warn('[tealium] Tracking call failed.');
            }
        }
    }
    function enqueue(payload, captureConsent) {
        if (!configured() || failed || !velotricTealiumPageAllowed(payload?.page_location, settings)
            || !events.has(payload?.tealium_event)
            || !payload.event_id || !permitted(captureConsent) || !permitted(consent)) return false;
        if (payload.tealium_event === 'purchase' && !payload.order_id) return false;
        if (seen.has(payload.event_id) || pending.has(payload.event_id)
            || (payload.order_id && (orders.has(payload.order_id) || pendingOrders.has(payload.order_id)))) return false;
        if (queue.length >= settings.queueLimit) discard(queue.shift());
        // Clone parallel product arrays before queueing asynchronous delivery.
        const snapshot = Object.fromEntries(Object.entries(payload).map(([key, value]) => [key, Array.isArray(value) ? [...value] : value]));
        if (!identityPermitted(captureConsent) || !identityPermitted(consent)) stripIdentity(snapshot);
        queue.push({ payload: snapshot, captureConsent: { ...captureConsent } });
        pending.add(payload.event_id);
        if (payload.order_id) pendingOrders.add(payload.order_id);
        if (deadline === 0) deadline = Date.now() + settings.readyTimeoutMs;
        if (!transport && !script && !window.utag) {
            window.utag_cfg_ovrd = { ...window.utag_cfg_ovrd, noview: true };
            script = document.createElement('script');
            script.async = true;
            script.src = 'https://tags.tiqcdn.com/utag/' + settings.account + '/' + settings.profile + '/' + settings.environment + '/utag.js';
            script.onerror = fail;
            (document.head || document.documentElement).appendChild(script);
        }
        if (timer === null) flush();
        return true;
    }
    return { enqueue, setConsent, clearIdentity: () => queue.forEach(entry => stripIdentity(entry.payload)) };
}


function velotricTealiumPageAllowed(pageLocation, settings) {
    try {
        const url = new URL(pageLocation);
        return url.protocol === 'https:' && settings.storefrontOrigins.includes(url.origin);
    } catch (error) { return false; }
}
function velotricTealiumUsesSandbox(pageLocation, settings) {
    if (!velotricTealiumPageAllowed(pageLocation, settings)) return false;
    const path = new URL(pageLocation).pathname;
    return /\/(?:checkouts?|thank_you|thank-you)(?:\/|$)/.test(path)
        || /^\/(?:\d+\/)?orders(?:\/|$)/.test(path);
}
function velotricTealiumShopifyConsent(state) {
    const value = entry => entry === true ? 'granted' : entry === false ? 'denied' : 'unknown';
    return {
        cmp_consent_analytics: value(state?.analyticsProcessingAllowed),
        cmp_consent_marketing: value(state?.marketingAllowed),
        cmp_consent_personalization: value(state?.preferencesProcessingAllowed),
        cmp_consent_sale_of_data: value(state?.saleOfDataAllowed),
    };
}

/*==============================================================================
  Helpers
==============================================================================*/
function resolveGmcCountry() {
    const shop = typeof init !== 'undefined' ? init.data?.shop : null;
    const fallback = config.store.gmcCountryFallback;
    const resolved = shop?.countryCode || fallback;
    if (resolved !== fallback) {
        console.warn(`[pixel] gmcCountry resolved "${resolved}" but fallback is "${fallback}". Verify against a real item ID in the GMC feed.`);
    }
    return resolved;
}

// Resolved once at pixel init — the shop's country does not change between
// events on a page.
const GMC_COUNTRY = resolveGmcCountry();

// Build a Google Merchant Center product ID
// (shopify_<country>_<productId>_<variantId>). GMC lists one row per variant,
// so both IDs are required; callers pass optional-chained values and rely on
// the undefined return to skip the item.
function buildEcommProdId(productId, variantId) {
    if (!productId || !variantId) return undefined;
    return `shopify_${GMC_COUNTRY}_${productId}_${variantId}`;
}

const processCheckoutProducts = (lineItemsInput) => {
    let finalProductArray = [];
    let ecomm_prodid_list = [];
    const lineItems = Array.isArray(lineItemsInput) ? lineItemsInput : [];

    lineItems.forEach((item, index) => {
        const variant = item.variant;
        const product = variant?.product;
        const priceInfo = variant?.price;
        const finalLinePriceInfo = item.finalLinePrice;

        // Prices are reported as actually paid, not as listed: finalLinePrice
        // is the discounted line total, and per-unit price and discount are
        // reconstructed from it. Only DISCOUNT_CODE allocations become `coupon`
        // — automatic and script discounts move the price but are not codes a
        // buyer entered, so reporting them as coupons would overstate code use.
        const originalItemPricePerUnit = parseFloat(priceInfo?.amount || 0);
        const quantity = parseInt(item.quantity || 1, 10);
        const validQuantity = quantity > 0 ? quantity : 1;
        const finalLinePriceTotal = parseFloat(finalLinePriceInfo?.amount ?? (originalItemPricePerUnit * quantity));
        const pricePerUnitAfterAllDiscounts = finalLinePriceTotal / validQuantity;
        const totalDiscountOnLineItem = (originalItemPricePerUnit * quantity) - finalLinePriceTotal;
        const discountPerUnit = totalDiscountOnLineItem / validQuantity;

        let currentItemCoupons = new Set();
        if (Array.isArray(item.discountAllocations)) {
            item.discountAllocations.forEach((allocation) => {
                const discountApp = allocation.discountApplication;
                if (discountApp?.title && typeof discountApp.title === 'string' && discountApp.title.trim() !== '' && discountApp.type === 'DISCOUNT_CODE') {
                    currentItemCoupons.add(discountApp.title.trim());
                }
            });
        }

        const ecommProdId = buildEcommProdId(product?.id, variant?.id);

        let lineItemData = {
            item_id: ecommProdId,
            item_group_id: product?.id,
            item_name: product?.title,
            affiliation: config.store.affiliationName,
            coupon: Array.from(currentItemCoupons).join(',') || undefined,
            discount: parseFloat(discountPerUnit.toFixed(2)),
            index: index + 1,
            item_brand: product?.vendor,
            item_category: product?.type,
            item_variant: variant?.sku || variant?.title,
            price: parseFloat(pricePerUnitAfterAllDiscounts.toFixed(2)),
            quantity: quantity,
        };
        finalProductArray.push(lineItemData);
        if (ecommProdId) {
            ecomm_prodid_list.push(ecommProdId);
        }
    });
    return {
        items: finalProductArray,
        ecomm_prodid_list: ecomm_prodid_list
    };
};

const initContextData = typeof init !== 'undefined' ? init.context?.document : null;
const pageEnabled = TEALIUM_CONFIG.enabled && velotricTealiumPageAllowed(initContextData?.location?.href, TEALIUM_CONFIG);
const checkoutContext = velotricTealiumUsesSandbox(initContextData?.location?.href, TEALIUM_CONFIG);
const GA_SESSION_COOKIE_NAME = '_ga_' + config.conversionTracking.measurementId.replace(/^G-/, '');
const categoryGranted = (state, category) => state['cmp_consent_' + category] === 'granted';
const optionalText = value => typeof value === 'string' && value.trim() ? value.trim() : undefined;
const identifier = value => typeof value === 'number' && Number.isFinite(value) ? String(value) : optionalText(value);
const numeric = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Number(value) : undefined;
const compact = object => Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
const commonTextKeys = ['previous_full_url', 'previous_url_path', 'previous_page_type', 'content_group', 'page_source', 'page_type'];
const eventMap = {
    cus_page_view: 'page_view', cus_view_item_list: 'view_item_list', cus_view_item: 'view_item',
    cus_add_to_cart: 'add_to_cart', cus_remove_from_cart: 'remove_from_cart', cus_view_cart: 'view_cart',
    cus_begin_checkout: 'begin_checkout', cus_add_shipping_info: 'add_shipping_info',
    cus_add_payment_info: 'add_payment_info', cus_purchase: 'purchase',
    'velotric:login': 'login', 'velotric:sign_up': 'sign_up',
};
let privacyState = typeof init !== 'undefined' ? init.customerPrivacy : null;
let consentRevision = 0;
let collectionEpoch = 0;
let identityEpoch = 0;
let knownIdentity = {};
let bridgeReady = false;
let pendingTealiumBuilds = 0;
let tealiumBuildQueue = Promise.resolve();
const consentSnapshot = () => velotricTealiumShopifyConsent(privacyState);
const stripIdentity = payload => Object.keys(payload).filter(key => key === 'user_id' || key.startsWith('customer_'))
    .forEach(key => { delete payload[key]; });
function postTealiumBridge(message) {
    if (!pageEnabled || checkoutContext || window.parent === window) return;
    window.parent.postMessage({ ...message, channel: 'velotric:tealium', version: 3,
        consent: consentSnapshot(), revision: consentRevision }, new URL(initContextData.location.href).origin);
}
const tealiumRuntime = createVelotricTealiumRuntime(TEALIUM_CONFIG, checkoutContext ? null : {
    ready: () => bridgeReady,
    requestReady: () => postTealiumBridge({ kind: 'hello' }),
    send: (payload, captureConsent) => postTealiumBridge({ kind: 'event', payload, captureConsent }),
});
if (pageEnabled) {
    tealiumRuntime.setConsent(consentSnapshot());
    window.addEventListener('message', message => {
        if (checkoutContext || message.source !== window.parent
            || message.origin !== new URL(initContextData.location.href).origin
            || message.data?.channel !== 'velotric:tealium' || message.data.version !== 3
            || message.data.kind !== 'ready') return;
        bridgeReady = true;
    });
    if (typeof api !== 'undefined' && api.customerPrivacy?.subscribe) {
        api.customerPrivacy.subscribe('visitorConsentCollected', event => {
            privacyState = event.customerPrivacy;
            consentRevision += 1;
            const state = consentSnapshot();
            if (!categoryGranted(state, TEALIUM_CONFIG.collectConsentCategory)) collectionEpoch += 1;
            if (!categoryGranted(state, TEALIUM_CONFIG.identityConsentCategory)) {
                identityEpoch += 1;
                knownIdentity = {};
            }
            tealiumRuntime.setConsent(state);
            postTealiumBridge({ kind: 'consent' });
        });
    }
}
function getCookie(name) {
    return typeof browser !== 'undefined' && browser.cookie?.get ? browser.cookie.get(name) : Promise.resolve(null);
}
function parseGa4ClientId(cookie) {
    const parts = typeof cookie === 'string' ? cookie.split('.') : [];
    return parts.length >= 4 && /^\d+$/.test(parts[2]) && /^\d+$/.test(parts[3]) ? parts[2] + '.' + parts[3] : undefined;
}
function parseGa4SessionId(cookie) {
    const segment = typeof cookie === 'string' ? cookie.split('.')[2] : null;
    const id = segment?.startsWith('s') && segment.includes('$') ? segment.slice(1).split('$')[0] : segment;
    return /^\d+$/.test(id || '') ? id : undefined;
}
async function trackingCookies() {
    // Read existing attribution cookies; this integration never writes them.
    const keys = ['source', 'medium', 'campaign', 'term', 'content', 'source_platform'];
    const values = await Promise.all([...keys.map(key => getCookie('gtm_dd_sep_' + key)), getCookie('_ga'), getCookie(GA_SESSION_COOKIE_NAME)]);
    return compact({ ...Object.fromEntries(keys.map((key, index) => ['cus_utm_' + key, optionalText(values[index])])),
        client_id: parseGa4ClientId(values[6]), session_id: parseGa4SessionId(values[7]) });
}
async function emailHash(data) {
    const existing = optionalText(data.customer_email_hash);
    if (existing && /^[a-fA-F0-9]{64}$/.test(existing)) return existing.toLowerCase();
    const email = optionalText(data.customer_email || data.user_email)?.toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !window.crypto?.subtle) return undefined;
    const digest = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(email));
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
function productUdo(items) {
    const products = (Array.isArray(items) ? items : []).filter(item => item
        && identifier(item.item_id) && numeric(item.price) !== undefined && numeric(item.price) >= 0
        && numeric(item.quantity) !== undefined && numeric(item.quantity) > 0);
    // Filter once, then derive every parallel array from the same ordered list.
    return {
        product_id: products.map(item => identifier(item.item_id)),
        product_name: products.map(item => optionalText(item.item_name) || ''),
        product_price: products.map(item => numeric(item.price)),
        product_quantity: products.map(item => numeric(item.quantity)),
        product_group_id: products.map(item => identifier(item.item_group_id) || ''),
        product_brand: products.map(item => optionalText(item.item_brand) || ''),
        product_category: products.map(item => optionalText(item.item_category) || ''),
        product_sku: products.map(item => optionalText(item.item_variant) || ''),
    };
}
async function buildTealiumPayload(eventData, source, captureConsent, identityAtCapture) {
    const name = eventMap[eventData.event];
    const ecommerce = eventData.ecommerce;
    const trusted = source.customData || {};
    const payload = compact({
        tealium_event: name,
        event_id: identifier(source.id),
        event_timestamp: optionalText(source.timestamp),
        page_location: eventData.page_location,
        page_referrer: eventData.page_referrer,
        page_title: eventData.page_title,
        ...Object.fromEntries(commonTextKeys.map(key => [key, optionalText(eventData[key] ?? trusted[key])])),
        ...captureConsent,
        ...(await trackingCookies()),
    });
    if (categoryGranted(captureConsent, TEALIUM_CONFIG.identityConsentCategory)) {
        Object.assign(payload, identityAtCapture);
        if (name === 'login' || name === 'sign_up') {
            Object.assign(payload, compact({
                user_id: identifier(trusted.user_id), customer_email_hash: await emailHash(trusted),
                customer_logged_in: true, method: optionalText(trusted.method),
            }));
        } else if (name === 'purchase') {
            const address = TEALIUM_CONFIG.includePurchaseAddress ? eventData.user_data?.address || {} : {};
            Object.assign(payload, compact({
                customer_email_hash: await emailHash(eventData),
                ...Object.fromEntries(['first_name', 'last_name', 'street', 'city', 'region', 'postal_code', 'country']
                    .map(key => ['customer_' + key, optionalText(address[key])])),
            }));
        }
    } else if (name === 'login' || name === 'sign_up') {
        payload.method = optionalText(trusted.method);
    }
    if (ecommerce) {
        Object.assign(payload, productUdo(ecommerce.items), compact({
            currency: optionalText(ecommerce.currency), value: numeric(ecommerce.value),
            item_list_id: identifier(ecommerce.item_list_id), item_list_name: optionalText(ecommerce.item_list_name),
            coupon: optionalText(ecommerce.coupon), shipping_tier: optionalText(ecommerce.shipping_tier),
        }));
    }
    if (name === 'purchase') {
        // A checkout token is not a stable order ID. Do not use the GA fallback.
        Object.assign(payload, compact({
            order_id: identifier(source.data?.checkout?.order?.id),
            order_subtotal: numeric(eventData.total_value_without_tax_shipping),
            order_total: numeric(eventData.total_value_with_tax_shipping),
            order_tax_amount: numeric(ecommerce.tax), order_shipping_amount: numeric(ecommerce.shipping),
            order_discount_amount: numeric(ecommerce.discount), order_promo_code: optionalText(ecommerce.coupon),
            order_payment_type: optionalText(ecommerce.payment_type),
        }));
    }
    return compact(payload);
}
function queueTealiumEvent(eventData, source) {
    if (!pageEnabled || !eventMap[eventData.event] || !source?.id
        || !velotricTealiumPageAllowed(eventData.page_location, TEALIUM_CONFIG)
        || !Number.isFinite(Date.parse(source.timestamp)) || pendingTealiumBuilds >= TEALIUM_CONFIG.queueLimit) return;
    const captureConsent = consentSnapshot();
    if (!categoryGranted(captureConsent, TEALIUM_CONFIG.collectConsentCategory)) return;
    const epoch = collectionEpoch;
    const receivedAt = Date.now();
    const capturedIdentityEpoch = identityEpoch;
    const identityAtCapture = { ...knownIdentity };
    const eventSnapshot = {
        ...eventData,
        ...(eventData.ecommerce ? { ecommerce: { ...eventData.ecommerce, items: eventData.ecommerce.items?.map(item => ({ ...item })) } } : {}),
        ...(eventData.user_data ? { user_data: { address: { ...eventData.user_data.address } } } : {}),
    };
    const sourceSnapshot = {
        id: source.id, timestamp: source.timestamp, customData: { ...source.customData },
        data: { checkout: { order: { id: source.data?.checkout?.order?.id } } },
    };
    pendingTealiumBuilds += 1;
    // Serialize asynchronous cookie/hash work to preserve the source event order.
    tealiumBuildQueue = tealiumBuildQueue.then(async () => {
        if (epoch !== collectionEpoch || Date.now() - receivedAt >= TEALIUM_CONFIG.readyTimeoutMs) return;
        const identityForEvent = capturedIdentityEpoch === identityEpoch ? { ...identityAtCapture, ...knownIdentity } : {};
        let timer;
        let payload;
        try {
            payload = await Promise.race([
                buildTealiumPayload(eventSnapshot, sourceSnapshot, captureConsent, identityForEvent),
                new Promise((resolve, reject) => {
                    timer = window.setTimeout(() => reject(new Error('Event preparation timed out')), TEALIUM_CONFIG.readyTimeoutMs - (Date.now() - receivedAt));
                }),
            ]);
        } finally { window.clearTimeout(timer); }
        if (epoch !== collectionEpoch || Date.now() - receivedAt >= TEALIUM_CONFIG.readyTimeoutMs) return;
        if (capturedIdentityEpoch !== identityEpoch) stripIdentity(payload);
        if ((payload.tealium_event === 'login' || payload.tealium_event === 'sign_up') && capturedIdentityEpoch === identityEpoch) {
            knownIdentity = compact({ user_id: payload.user_id, customer_email_hash: payload.customer_email_hash, customer_logged_in: payload.customer_logged_in });
        }
        tealiumRuntime.enqueue(payload, captureConsent);
    }).catch(() => { console.warn('[tealium] Event preparation failed.'); })
        .finally(() => { pendingTealiumBuilds -= 1; });
}

function trackAuthentication(event) {
    identityEpoch += 1;
    knownIdentity = categoryGranted(consentSnapshot(), TEALIUM_CONFIG.identityConsentCategory)
        ? compact({ user_id: identifier(event.customData?.user_id), customer_logged_in: true }) : {};
    const context = event.context?.document;
    queueTealiumEvent({ event: event.name, page_location: context?.location?.href,
        page_referrer: context?.referrer, page_title: context?.title }, event);
}

/*==============================================================================
  Event subscriptions: retain the original event-by-event layout
==============================================================================*/
if (pageEnabled && typeof analytics !== 'undefined') {
    analytics.subscribe('velotric:login', event => trackAuthentication(event));
    analytics.subscribe('velotric:sign_up', event => trackAuthentication(event));
    analytics.subscribe('velotric:logout', () => {
        identityEpoch += 1;
        knownIdentity = {};
        tealiumRuntime.clearIdentity();
    });
    if (config.conversionTracking.trackPageViews) {
        analytics.subscribe('page_viewed', (event) => {
            const eventContextData = event.context?.document;
            queueTealiumEvent({
                event: 'cus_page_view',
                page_location: eventContextData?.location?.href,
                page_referrer: eventContextData?.referrer,
                page_title: eventContextData?.title,
            }, event);
        });
    }
    const getOrderLevelCoupons = (discountApplications) => {
        let orderCoupons = new Set();
        if (Array.isArray(discountApplications)) {
            discountApplications.forEach(app => {
                if (app.title && typeof app.title === 'string' && app.title.trim() !== '' && app.type === 'DISCOUNT_CODE') {
                    orderCoupons.add(app.title.trim());
                }
            });
        }
        return Array.from(orderCoupons).join(',') || undefined;
    };

    if (config.conversionTracking.trackViewItemList) {
        analytics.subscribe('collection_viewed', (event) => {
            const eventContextData = event.context?.document;
            const collection = event.data?.collection;
            if (!collection) return;
            // `item` is a ProductVariant, so its own id is the variant id.
            const googleAnalyticsProducts = (collection.productVariants || []).map((item, index) => ({
                item_id: buildEcommProdId(item.product?.id, item.id),
                item_group_id: item.product?.id,
                item_name: item.product?.title,
                affiliation: config.store.affiliationName,
                index: index + 1,
                item_brand: item.product?.vendor,
                item_category: item.product?.type,
                item_variant: item.sku || item.title,
                item_list_id: collection.id,
                item_list_name: collection.title,
                price: parseFloat(item.price?.amount || 0),
                quantity: 1
            }));
            queueTealiumEvent({
                event: 'cus_view_item_list',
                page_location: eventContextData?.location?.href,
                page_referrer: eventContextData?.referrer,
                page_title: eventContextData?.title,
                ecommerce: {
                    item_list_id: collection.id,
                    item_list_name: collection.title,
                    items: googleAnalyticsProducts
                }
            }, event);
        });
    }
    if (config.conversionTracking.trackViewItem) {
        analytics.subscribe('product_viewed', (event) => {
            const eventContextData = event.context?.document;
            const productVariant = event.data?.productVariant;
            if (!productVariant) return;
            const googleAnalyticsProducts = [{
                item_id: buildEcommProdId(productVariant.product?.id, productVariant.id),
                item_group_id: productVariant.product?.id,
                item_name: productVariant.product?.title,
                affiliation: config.store.affiliationName,
                item_brand: productVariant.product?.vendor,
                item_category: productVariant.product?.type,
                item_variant: productVariant.sku || productVariant.title,
                price: parseFloat(productVariant.price?.amount || 0),
                quantity: 1
            }];
            queueTealiumEvent({
                event: 'cus_view_item',
                page_location: eventContextData?.location?.href,
                page_referrer: eventContextData?.referrer,
                page_title: eventContextData?.title,
                ecomm_prodid: buildEcommProdId(productVariant.product?.id, productVariant.id),
                ecommerce: {
                    currency: productVariant.price?.currencyCode,
                    value: parseFloat(productVariant.price?.amount || 0),
                    items: googleAnalyticsProducts
                }
            }, event);
        });
    }
    if (config.conversionTracking.trackAddToCart) {
        analytics.subscribe('product_added_to_cart', (event) => {
            const eventContextData = event.context?.document;
            const cartLine = event.data?.cartLine;
            if (!cartLine || !cartLine.merchandise) return;
            const merchandise = cartLine.merchandise;
            const itemPrice = parseFloat(merchandise.price?.amount || 0);
            const quantityAdded = parseInt(cartLine.quantity || 1, 10);
            const googleAnalyticsProducts = [{
                item_id: buildEcommProdId(merchandise.product?.id, merchandise.id),
                item_group_id: merchandise.product?.id,
                item_name: merchandise.product?.title,
                affiliation: config.store.affiliationName,
                item_brand: merchandise.product?.vendor,
                item_category: merchandise.product?.type,
                item_variant: merchandise.sku || merchandise.title,
                price: itemPrice,
                quantity: quantityAdded
            }];
            queueTealiumEvent({
                event: 'cus_add_to_cart',
                page_location: eventContextData?.location?.href,
                page_referrer: eventContextData?.referrer,
                page_title: eventContextData?.title,
                ecomm_prodid: buildEcommProdId(merchandise.product?.id, merchandise.id),
                ecommerce: {
                    currency: merchandise.price?.currencyCode || cartLine.cost?.totalAmount?.currencyCode,
                    value: itemPrice * quantityAdded,
                    items: googleAnalyticsProducts
                }
            }, event);
        });
    }
    if (config.conversionTracking.trackViewCart) {
        analytics.subscribe('cart_viewed', (event) => {
            const eventContextData = event.context?.document;
            const cart = event.data?.cart;
            if (!cart) return;
            const cartLines = Array.isArray(cart.lines) ? cart.lines : [];
            const googleAnalyticsProducts = cartLines
                .filter((cartLine) => cartLine?.merchandise)
                .map((cartLine, index) => {
                    const merchandise = cartLine.merchandise;
                    const quantity = parseInt(cartLine.quantity || 1, 10);
                    const originalPrice = parseFloat(merchandise.price?.amount || 0);
                    const lineTotal = parseFloat(
                        cartLine.cost?.totalAmount?.amount ?? (originalPrice * quantity)
                    );
                    const pricePerUnit = lineTotal / quantity;

                    return {
                        item_id: buildEcommProdId(merchandise.product?.id, merchandise.id),
                        item_group_id: merchandise.product?.id,
                        item_name: merchandise.product?.title,
                        affiliation: config.store.affiliationName,
                        discount: parseFloat((originalPrice - pricePerUnit).toFixed(2)),
                        index: index + 1,
                        item_brand: merchandise.product?.vendor,
                        item_category: merchandise.product?.type,
                        item_variant: merchandise.sku || merchandise.title,
                        price: parseFloat(pricePerUnit.toFixed(2)),
                        quantity: quantity
                    };
                });
            const orderLevelCoupons = getOrderLevelCoupons(cart.discountApplications);
            queueTealiumEvent({
                event: 'cus_view_cart',
                page_location: eventContextData?.location?.href,
                page_referrer: eventContextData?.referrer,
                page_title: eventContextData?.title,
                ecomm_prodid: googleAnalyticsProducts.map((item) => item.item_id).filter(Boolean).join(','),
                ecommerce: {
                    currency: cart.cost?.totalAmount?.currencyCode,
                    value: parseFloat(cart.cost?.totalAmount?.amount || 0),
                    coupon: orderLevelCoupons,
                    items: googleAnalyticsProducts
                }
            }, event);
        });
    }
    if (config.conversionTracking.trackRemoveFromCart) {
        analytics.subscribe('product_removed_from_cart', (event) => {
            const eventContextData = event.context?.document;
            const cartLine = event.data?.cartLine;
            if (!cartLine || !cartLine.merchandise) return;
            const merchandise = cartLine.merchandise;
            const itemPrice = parseFloat(merchandise.price?.amount || 0);
            const quantityRemoved = parseInt(cartLine.quantity || 0, 10);
            const googleAnalyticsProducts = [{
                item_id: buildEcommProdId(merchandise.product?.id, merchandise.id),
                item_group_id: merchandise.product?.id,
                item_name: merchandise.product?.title,
                affiliation: config.store.affiliationName,
                item_brand: merchandise.product?.vendor,
                item_category: merchandise.product?.type,
                item_variant: merchandise.sku || merchandise.title,
                price: itemPrice,
                quantity: quantityRemoved
            }];
            queueTealiumEvent({
                event: 'cus_remove_from_cart',
                page_location: eventContextData?.location?.href,
                page_referrer: eventContextData?.referrer,
                page_title: eventContextData?.title,
                ecomm_prodid: buildEcommProdId(merchandise.product?.id, merchandise.id),
                ecommerce: {
                    currency: merchandise.price?.currencyCode,
                    value: itemPrice * quantityRemoved,
                    items: googleAnalyticsProducts
                }
            }, event);
        });
    }


    /*==========================================================================
      Begin checkout
    ==========================================================================*/
    if (config.conversionTracking.trackBeginCheckout) {
        analytics.subscribe('checkout_started', (event) => {

            const eventContextData = event.context?.document;
            const checkout = event.data?.checkout; // Use checkout object directly for this event
            if (!checkout) {
                console.warn('[pixel] begin_checkout: no checkout data found.');
                return;
            }
            const processedData = processCheckoutProducts(checkout.lineItems);
            const orderLevelCoupons = getOrderLevelCoupons(checkout.discountApplications);
            const ga4EcommerceValue = parseFloat(checkout.subtotalPrice?.amount || 0);

            queueTealiumEvent({
                event: 'cus_begin_checkout',
                page_location: eventContextData?.location?.href,
                page_referrer: eventContextData?.referrer,
                page_title: eventContextData?.title,
                ecomm_prodid: processedData.ecomm_prodid_list.join(","),
                ecommerce: {
                    currency: checkout.currencyCode,
                    value: ga4EcommerceValue,
                    coupon: orderLevelCoupons,
                    items: processedData.items
                }
            }, event);
        });
    }

    if (config.conversionTracking.trackAddShippingInfo) {
        analytics.subscribe('checkout_shipping_info_submitted', (event) => {
            const eventContextData = event.context?.document;
            const checkout = event.data?.checkout;
            if (!checkout) return;
            const processedData = processCheckoutProducts(checkout.lineItems);
            const orderLevelCoupons = getOrderLevelCoupons(checkout.discountApplications);
            const ga4EcommerceValue = parseFloat(checkout.subtotalPrice?.amount || 0);
            queueTealiumEvent({
                event: 'cus_add_shipping_info',
                page_location: eventContextData?.location?.href,
                page_referrer: eventContextData?.referrer,
                page_title: eventContextData?.title,
                ecomm_prodid: processedData.ecomm_prodid_list.join(","),
                ecommerce: {
                    currency: checkout.currencyCode,
                    value: ga4EcommerceValue,
                    coupon: orderLevelCoupons,
                    shipping_tier: checkout.shippingLine?.title || checkout.delivery?.selectedDeliveryOptions?.[0]?.title || undefined,
                    items: processedData.items
                }
            }, event);
        });
    }

    if (config.conversionTracking.trackAddPaymentInfo) {
        analytics.subscribe('payment_info_submitted', (event) => {
            const eventContextData = event.context?.document;
            const checkout = event.data?.checkout;
            if (!checkout) return;
            const processedData = processCheckoutProducts(checkout.lineItems);
            const orderLevelCoupons = getOrderLevelCoupons(checkout.discountApplications);
            const ga4EcommerceValue = parseFloat(checkout.subtotalPrice?.amount || 0);
            queueTealiumEvent({
                event: 'cus_add_payment_info',
                page_location: eventContextData?.location?.href,
                page_referrer: eventContextData?.referrer,
                page_title: eventContextData?.title,
                ecomm_prodid: processedData.ecomm_prodid_list.join(","),
                ecommerce: {
                    currency: checkout.currencyCode,
                    value: ga4EcommerceValue,
                    coupon: orderLevelCoupons,
                    items: processedData.items
                }
            }, event);
        });
    }

    if (config.conversionTracking.trackPurchase) {
        analytics.subscribe('checkout_completed', (event) => {
            const eventContextData = event.context?.document;
            // For 'checkout_completed', event.data.checkout is the primary and most complete data source.
            const checkoutDataSource = event.data?.checkout;

            if (!checkoutDataSource) {
                console.error('[pixel] purchase: no checkout data in event.data.checkout, cannot process.');
                return;
            }
            // The 'order' object is nested within event.data.checkout.order if available
            const orderDataSource = checkoutDataSource.order;


            const lineItemsToProcess = Array.isArray(checkoutDataSource.lineItems) ? checkoutDataSource.lineItems : [];
            const processedData = processCheckoutProducts(lineItemsToProcess); // This will use lineItems from checkoutDataSource
            const orderLevelCoupons = getOrderLevelCoupons(checkoutDataSource.discountApplications);

            // --- Corrected Total Value Calculations ---
            let totalValueBeforeDiscount = 0;
            lineItemsToProcess.forEach(item => {
                const price = parseFloat(item.variant?.price?.amount || 0);
                const quantity = parseInt(item.quantity || 0, 10);
                totalValueBeforeDiscount += price * quantity;
            });
            totalValueBeforeDiscount = parseFloat(totalValueBeforeDiscount.toFixed(2));

            // Use checkoutDataSource for these financial summaries as it's the primary object for this event
            const totalValueAfterDiscount_topLevel = parseFloat(checkoutDataSource.subtotalPrice?.amount || 0);
            const totalValueWithoutTaxShipping = totalValueAfterDiscount_topLevel;

            const totalTaxAmount = parseFloat(checkoutDataSource.totalTax?.amount || 0);
            const totalShippingAmount = parseFloat(
                checkoutDataSource.shippingLine?.price?.amount || // Checkout's shipping line
                orderDataSource?.totalShippingPriceSet?.shopMoney?.amount || // Fallback to order's shipping if present
                0
            );
            const totalValueWithTaxShipping = parseFloat(checkoutDataSource.totalPrice?.amount || 0);

            // --- GA4 Ecommerce Object Values ---
            const ga4EcommerceValue = parseFloat(checkoutDataSource.subtotalPrice?.amount || 0);
            const totalOrderWideDiscountAmount = parseFloat(checkoutDataSource.discountsAmount?.amount || 0);
            const paymentGateway = checkoutDataSource.transactions?.[0]?.gateway || 'N/A';
            const purchaseData = {
                event: 'cus_purchase',

                page_location: eventContextData?.location?.href,
                page_referrer: eventContextData?.referrer,
                page_title: eventContextData?.title,
                ecomm_prodid: processedData.ecomm_prodid_list.join(","),
                user_email: checkoutDataSource.email,
                user_data: {
                    address: {
                        first_name: checkoutDataSource.shippingAddress?.firstName || checkoutDataSource.billingAddress?.firstName,
                        last_name: checkoutDataSource.shippingAddress?.lastName || checkoutDataSource.billingAddress?.lastName,
                        street: checkoutDataSource.shippingAddress?.address1 || checkoutDataSource.billingAddress?.address1,
                        city: checkoutDataSource.shippingAddress?.city || checkoutDataSource.billingAddress?.city,
                        region: checkoutDataSource.shippingAddress?.provinceCode || checkoutDataSource.billingAddress?.provinceCode,
                        postal_code: checkoutDataSource.shippingAddress?.zip || checkoutDataSource.billingAddress?.zip,
                        country: checkoutDataSource.shippingAddress?.countryCode || checkoutDataSource.billingAddress?.countryCode,
                    }
                },
                total_value_before_discount: totalValueBeforeDiscount,
                total_value_after_discount: totalValueAfterDiscount_topLevel,
                total_value_without_tax_shipping: totalValueWithoutTaxShipping,
                total_value_with_tax_shipping: totalValueWithTaxShipping,

                ecommerce: {
                    affiliation: config.store.affiliationName,
                    currency: checkoutDataSource.currencyCode,
                    value: ga4EcommerceValue,
                    tax: totalTaxAmount,
                    shipping: totalShippingAmount,
                    shipping_tier: checkoutDataSource.shippingLine?.title || orderDataSource?.shippingLine?.title || checkoutDataSource.delivery?.selectedDeliveryOptions?.[0]?.title || undefined,
                    coupon: orderLevelCoupons,
                    discount: totalOrderWideDiscountAmount,
                    payment_type: paymentGateway,
                    items: processedData.items
                }
            };
            queueTealiumEvent(purchaseData, event);
        });
    }

}
