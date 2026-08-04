// Step 1. Initialize the JavaScript pixel SDK (make sure to exclude HTML)

// Ensure 'init' and 'analytics' are available in this scope (provided by Shopify Pixel SDK)
const config = {
    /* *************** CONVERSION TRACKING SETTINGS *************** */
    conversionTracking: {
        gtmContainerId: 'GTM-NZ3GPW', // web GTM
        measurement_id: 'G-66S3XN5ND0', // GA4 measurement ID
        get g_id() { return this.measurement_id.replace(/^G-/, ''); },
        trackPageViews: true,
        trackClicks: true,
        trackSearch: true,
        trackFormSubmit: true,
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
    /* *************** STORE SETTINGS *************** */
    store: {
        country: 'US', // used to build Google Merchant Center product IDs: shopify_<country>_<productId>_<variantId>
        affiliationName: typeof init !== 'undefined' && init.data && init.data.shop ? init.data.shop.name : 'Unknown Store',
    },
};

/* *********************************************************************************
 ****************************** END OF GLOBAL SETTINGS ******************************
 ********************************************************************************** */

const STAPE_GTM_SCRIPT_URL_BASE = 'https://load.securedata.eco-worthy.com'; //在Stape的custom loader里
const STAPE_GTM_CONTAINER_ID = 'cxmuqqvd'; //在Stape的custom loader里
const STAPE_GTM_LOADER_PREFIX = '2i5'; // custom loader 脚本文件名前缀：<prefix><containerId>.js
const STAPE_GTM_BASE_QUERY_PARAMS = '4wficl=DRJMNiEgVS0%2BRTYhIksOXlZYQFcRA0UGBxlcBhofDAsdWBIeGA%3D%3D'; //在Shopify的插件（Stape Server GTM）里生成，这个参数可选择的
// Loader script URL, derived from the constants above — loadGTM() consumes this instead of a hardcoded string
const STAPE_GTM_SCRIPT_URL = `${STAPE_GTM_SCRIPT_URL_BASE}/${STAPE_GTM_LOADER_PREFIX}${STAPE_GTM_CONTAINER_ID}.js`;

function pushEventToDataLayer(eventData) {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push(eventData);
    if (window.parent && window.parent !== window) {
        try {
            window.parent.postMessage(eventData, '*');
        } catch (e) {
            console.warn("Pixel: Could not post message to parent window.", e);
        }
    }
    if (eventData.ecommerce) {
        window.dataLayer.push({
            ecommerce: null
        });
    }
}

// Build a Google Merchant Center product ID (shopify_<country>_<productId>_<variantId>)
function buildEcommProdId(productId, variantId) {
    return `shopify_${config.store.country}_${productId}_${variantId}`;
}

const initContextData = typeof init !== 'undefined' ? init.context?.document : null;
if (initContextData) {
    window.dataLayer = window.dataLayer || [];
    dataLayer.push({
        page_location: initContextData.location?.href,
        page_referrer: initContextData.referrer,
        page_title: initContextData.title,
    });
}

//在Shopify插件（Stape Server GTM）里生成
function loadGTM() {
    /* ... GTM Loader from previous version ... */
   (function(w,d,s,l,i,src){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s);j.async=true;j.src=src+"?"+i;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer',STAPE_GTM_BASE_QUERY_PARAMS,STAPE_GTM_SCRIPT_URL);
}


// --- Store cookies bridge (sGTM / Firestore) ---

// Read a first-party cookie through the Shopify Web Pixel sandbox API.
function getCookie(name) {
    return browser.cookie.get(name).catch(() => null);
}

function generateUUID() {
    var d = new Date().getTime();
    var d2 = (typeof performance !== 'undefined' && performance.now && (performance.now() * 1000)) || 0;
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = Math.random() * 16;
        if (d > 0) {
            r = (d + r) % 16 | 0;
            d = Math.floor(d / 16);
        } else {
            r = (d2 + r) % 16 | 0;
            d2 = Math.floor(d2 / 16);
        }
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
}

// _ga cookie format: GA1.<domainDepth>.<random>.<firstVisitTimestamp>
// The client ID is the last two segments, e.g. "1234567890.1700000000".
function parseGa4ClientId(gaCookie) {
    if (!gaCookie || !gaCookie.startsWith('GA1.')) return null;
    const segments = gaCookie.split('.');
    if (segments.length < 4) return null;
    return `${segments[segments.length - 2]}.${segments[segments.length - 1]}`;
}

// _ga_<gaContainerId> cookie holds the session ID in its third segment:
//   GS1 format: GS1.1.<sessionId>.<sessionNumber>...
//   GS2 format: GS2.1.s<sessionId>$o<n>$g<n>...
// gaContainerId is the measurement ID minus its "G-" prefix, e.g.
// "G-XXXXXXXXXX" -> "_ga_XXXXXXXXXX". Google's cookie docs call this
// "container-id"; the "ga" prefix here keeps it distinct from the GTM
// and Stape container IDs also used in this file.
function parseGa4SessionId(sessionCookie) {
    if (!sessionCookie) return null;
    const segments = sessionCookie.split('.');
    if (segments.length < 3) return null;
    const sessionSegment = segments[2];
    let sessionId = sessionSegment;
    if (sessionSegment.startsWith('s') && sessionSegment.includes('$')) {
        sessionId = sessionSegment.substring(1).split('$')[0];
    }
    return /^\d+$/.test(sessionId) ? sessionId : null;
}

// Checkout tokens sGTM has already acknowledged with a 2xx. Every checkout step
// event retries the send, so this is what keeps the happy path down to a single
// Firestore write: once a send succeeds the token lands here and later events
// short-circuit. A failed send leaves the token out, so the next step retries it.
const sentCheckoutTokens = new Set();

// Tokens whose request is issued but not yet answered. Checkout steps can fire
// in the same tick, which would otherwise slip past sentCheckoutTokens while the
// first response is still in flight and write the same token to Firestore twice.
const inFlightCheckoutTokens = new Set();

// POST the storefront cookies to sGTM, which persists them in Firestore keyed
// by checkout token so that webhook-replayed orders can be attributed later.
//
// Runs immediately, with no timer and no gtag round-trip. Every cookie read
// here is written by the storefront GTM container long before checkout starts,
// so waiting cannot surface a value that is not already there — it only widens
// the window in which a page unload kills the request. `keepalive` protects a
// request in flight; it does nothing for one that was never issued.
async function sendStoreCookies(checkoutToken, shopifyCustomerId) {
    // Without the join key the payload can never be matched back to an order,
    // and sGTM keys the Firestore collection on it, so there is nowhere to put it.
    if (!checkoutToken) {
        console.warn('store_cookies: no checkout token, skipping.');
        return;
    }
    if (sentCheckoutTokens.has(checkoutToken) || inFlightCheckoutTokens.has(checkoutToken)) return;
    // Claim the token synchronously — the first await below yields control and
    // would let a same-tick event through.
    inFlightCheckoutTokens.add(checkoutToken);

    const gaSessionCookieName = `_ga_${config.conversionTracking.g_id}`;
    const [
        gaCookie,
        gaSessionCookie,
        fbp,
        fbc,
        sepCampaign,
        sepContent,
        sepMedium,
        sepSource,
        sepSourcePlatform,
        sepTerm
    ] = await Promise.all([
        getCookie('_ga'),
        getCookie(gaSessionCookieName),
        getCookie('_fbp'),
        getCookie('_fbc'),
        getCookie('gtm_dd_sep_campaign'),
        getCookie('gtm_dd_sep_content'),
        getCookie('gtm_dd_sep_medium'),
        getCookie('gtm_dd_sep_source'),
        getCookie('gtm_dd_sep_source_platform'),
        getCookie('gtm_dd_sep_term')
    ]);

    const payload = {
        "event": "store_cookies",
        // Join key. Matches `checkout_token` on the orders/paid webhook payload
        // — NOT `cart_token`, which Shopify exposes on the same order as a
        // different value in a different format.
        "checkout_token": checkoutToken,
        "fbp": fbp,
        "fbc": fbc,
        "_ga": gaCookie,
        [gaSessionCookieName]: gaSessionCookie,
        "ga_client_id": parseGa4ClientId(gaCookie) || generateUUID(),
        "ga_session_id": parseGa4SessionId(gaSessionCookie) || String(Math.floor(Date.now() / 1000)),
        "shopify_customer_id": shopifyCustomerId,
        "gtm_dd_sep_campaign": sepCampaign,
        "gtm_dd_sep_content": sepContent,
        "gtm_dd_sep_medium": sepMedium,
        "gtm_dd_sep_source": sepSource,
        "gtm_dd_sep_source_platform": sepSourcePlatform,
        "gtm_dd_sep_term": sepTerm
    };

    return fetch(`${STAPE_GTM_SCRIPT_URL_BASE}/data`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(payload),
        keepalive: true
    }).then((response) => {
        inFlightCheckoutTokens.delete(checkoutToken);
        if (response.ok) {
            sentCheckoutTokens.add(checkoutToken);
        } else {
            console.error('store_cookies rejected by sGTM:', response.status, response.statusText);
        }
    }).catch((error) => {
        inFlightCheckoutTokens.delete(checkoutToken);
        console.error('store_cookies failed to send:', error);
    });
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

        let lineItemData = {
            item_id: product?.id,
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
        if (product?.id && variant?.id) {
            ecomm_prodid_list.push(buildEcommProdId(product.id, variant.id));
        }
    });
    return {
        items: finalProductArray,
        ecomm_prodid_list: ecomm_prodid_list
    };
};


if (typeof analytics !== 'undefined') {
    // ... (Non-ecommerce event subscriptions - page_view, clicks, search, form_submit - unchanged from previous full code) ...
    if (config.conversionTracking.trackPageViews) {
        analytics.subscribe('page_viewed', (event) => {
            const eventContextData = event.context?.document;
            window.dataLayer.push({
                event: 'cus_page_view',
                page_location: eventContextData?.location?.href,
                page_referrer: eventContextData?.referrer,
                page_title: eventContextData?.title,
            });
        });
    }
    if (config.conversionTracking.trackClicks) {
        analytics.subscribe('custom_click', (event) => {
            const eventContextData = event.context?.document;
            pushEventToDataLayer({
                event: 'custom_click_storefront',
                page_location: eventContextData?.location?.href,
                page_referrer: eventContextData?.referrer,
                page_title: eventContextData?.title,
                data: event.customData
            });
        });
        analytics.subscribe('custom_link_click', (event) => {
            const eventContextData = event.context?.document;
            pushEventToDataLayer({
                event: 'custom_click_link_storefront',
                page_location: eventContextData?.location?.href,
                page_referrer: eventContextData?.referrer,
                page_title: eventContextData?.title,
                data: event.customData
            });
        });
        if (initContextData?.location?.href.includes('/checkouts/')) {
            analytics.subscribe('clicked', (event) => {
                const element = event.data?.element;
                const eventContextData = event.context?.document;
                pushEventToDataLayer({
                    event: 'custom_click_checkout',
                    page_location: eventContextData?.location?.href,
                    page_referrer: eventContextData?.referrer,
                    page_title: eventContextData?.title,
                    data: {
                        click_element: element?.tagName,
                        click_id: element?.id || '',
                        click_classes: element?.className || '',
                        click_text: element?.textContent?.trim() || element?.value || '',
                        click_target: element?.target || '',
                        click_url: element?.href || ''
                    }
                });
            });
        }
    }
    if (config.conversionTracking.trackSearch) {
        analytics.subscribe('search_submitted', (event) => {
            const eventContextData = event.context?.document;
            pushEventToDataLayer({
                event: 'cus_view_search_results',
                page_location: eventContextData?.location?.href,
                page_referrer: eventContextData?.referrer,
                page_title: eventContextData?.title,
                search_term: event.data?.searchResult?.query
            });
        });
    }
    if (config.conversionTracking.trackFormSubmit) {
        analytics.subscribe('form_submitted', (event) => {
            const eventContextData = event.context?.document;
            const decodedAction = decodeURIComponent(event.data?.element?.action || '');
            if (!decodedAction.includes('/cart/add')) {
                pushEventToDataLayer({
                    event: 'form_submit',
                    page_location: eventContextData?.location?.href,
                    page_referrer: eventContextData?.referrer,
                    page_title: eventContextData?.title,
                    form_action: event.data?.element?.action,
                    form_id: event.data?.element?.id
                });
            }
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

    // ... (view_item_list, view_item, add_to_cart, view_cart, remove_from_cart - unchanged from previous full code, but ensure they use the corrected processCheckoutProducts if applicable for items structure) ...
    if (config.conversionTracking.trackViewItemList) {
        analytics.subscribe('collection_viewed', (event) => {
            const eventContextData = event.context?.document;
            const collection = event.data?.collection;
            if (!collection) return;
            const googleAnalyticsProducts = (collection.productVariants || []).map((item, index) => ({
                item_id: item.product?.id,
                item_name: item.product?.title,
                affiliation: config.store.affiliationName,
                index: index + 1,
                item_brand: item.product?.vendor,
                item_category: item.product?.type,
                item_list_id: collection.id,
                item_list_name: collection.title,
                price: parseFloat(item.price?.amount || 0),
                quantity: 1
            }));
            pushEventToDataLayer({
                event: 'cus_view_item_list',
                page_location: eventContextData?.location?.href,
                page_referrer: eventContextData?.referrer,
                page_title: eventContextData?.title,
                ecommerce: {
                    item_list_id: collection.id,
                    item_list_name: collection.title,
                    items: googleAnalyticsProducts
                }
            });
        });
    }
    if (config.conversionTracking.trackViewItem) {
        analytics.subscribe('product_viewed', (event) => {
            const eventContextData = event.context?.document;
            const productVariant = event.data?.productVariant;
            if (!productVariant) return;
            const googleAnalyticsProducts = [{
                item_id: productVariant.product?.id,
                item_name: productVariant.product?.title,
                affiliation: config.store.affiliationName,
                item_brand: productVariant.product?.vendor,
                item_category: productVariant.product?.type,
                item_variant: productVariant.sku || productVariant.title,
                price: parseFloat(productVariant.price?.amount || 0),
                quantity: 1
            }];
            pushEventToDataLayer({
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
            });
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
                item_id: merchandise.product?.id,
                item_name: merchandise.product?.title,
                affiliation: config.store.affiliationName,
                item_brand: merchandise.product?.vendor,
                item_category: merchandise.product?.type,
                item_variant: merchandise.sku || merchandise.title,
                price: itemPrice,
                quantity: quantityAdded
            }];
            pushEventToDataLayer({
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
            });
        });
    }
    if (config.conversionTracking.trackViewCart) {
        analytics.subscribe('cart_viewed', (event) => {
            const eventContextData = event.context?.document;
            const cart = event.data?.cart;
            if (!cart) return;
            const processedData = processCheckoutProducts(cart.lines);
            const orderLevelCoupons = getOrderLevelCoupons(cart.discountApplications);
            pushEventToDataLayer({
                event: 'cus_view_cart',
                page_location: eventContextData?.location?.href,
                page_referrer: eventContextData?.referrer,
                page_title: eventContextData?.title,
                ecomm_prodid: processedData.ecomm_prodid_list.join(','),
                ecommerce: {
                    currency: cart.cost?.totalAmount?.currencyCode,
                    value: parseFloat(cart.cost?.totalAmount?.amount || 0),
                    coupon: orderLevelCoupons,
                    items: processedData.items
                }
            });
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
                item_id: merchandise.product?.id,
                item_name: merchandise.product?.title,
                affiliation: config.store.affiliationName,
                item_brand: merchandise.product?.vendor,
                item_category: merchandise.product?.type,
                item_variant: merchandise.sku || merchandise.title,
                price: itemPrice,
                quantity: quantityRemoved
            }];
            pushEventToDataLayer({
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
            });
        });
    }


    /* *************** BEGIN CHECKOUT *************** */
    if (config.conversionTracking.trackBeginCheckout) {
        analytics.subscribe('checkout_started', (event) => {
            loadGTM();

            const eventContextData = event.context?.document;
            const checkout = event.data?.checkout; // Use checkout object directly for this event
            if (!checkout) {
                console.warn("Begin Checkout: No checkout data found.");
                return;
            }
            sendStoreCookies(checkout.token, checkout.customer?.id || null);

            const processedData = processCheckoutProducts(checkout.lineItems);
            const orderLevelCoupons = getOrderLevelCoupons(checkout.discountApplications);
            const ga4EcommerceValue = parseFloat(checkout.subtotalPrice?.amount || 0);

            pushEventToDataLayer({
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
            });
        });
    }

    /* *************** STORE COOKIES RETRY *************** */
    // checkout_started is a single shot: if its request never leaves the page,
    // the order can never be attributed. Every later checkout step carries the
    // same checkout.token, so re-running the send there costs one short-circuit
    // on the happy path and buys a retry when the first attempt was lost.
    //
    // Deliberately not gated behind the track* flags — this feeds order
    // attribution, not GA4 reporting, and must survive those being turned off.
    [
        'checkout_contact_info_submitted',
        'checkout_address_info_submitted',
        'checkout_shipping_info_submitted',
        'payment_info_submitted',
        'checkout_completed'
    ].forEach((eventName) => {
        analytics.subscribe(eventName, (event) => {
            const checkout = event.data?.checkout;
            if (checkout?.token) {
                sendStoreCookies(checkout.token, checkout.customer?.id || null);
            }
        });
    });

    if (config.conversionTracking.trackAddShippingInfo) {
        analytics.subscribe('checkout_shipping_info_submitted', (event) => {
            const eventContextData = event.context?.document;
            const checkout = event.data?.checkout;
            if (!checkout) return;
            const processedData = processCheckoutProducts(checkout.lineItems);
            const orderLevelCoupons = getOrderLevelCoupons(checkout.discountApplications);
            const ga4EcommerceValue = parseFloat(checkout.subtotalPrice?.amount || 0);
            pushEventToDataLayer({
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
            });
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
            pushEventToDataLayer({
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
            });
        });
    }

    /* *************** PURCHASE *************** */
    if (config.conversionTracking.trackPurchase) {
        analytics.subscribe('checkout_completed', (event) => {
            loadGTM();
            console.log(event)
            const eventContextData = event.context?.document;
            // For 'checkout_completed', event.data.checkout is the primary and most complete data source.
            const checkoutDataSource = event.data?.checkout;

            if (!checkoutDataSource) {
                console.error("Pixel Purchase Event: No checkout data source found in event.data.checkout. Cannot process.");
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
            const transactionId = orderDataSource?.name || orderDataSource?.id || checkoutDataSource.token;


            const dataLayerObj = {
                event: 'cus_purchase',
                // Same value the store_cookies bridge sends: Shopify's checkout
                // token, which is what the orders webhook joins on. Not the
                // order's own `token`, and not `cart_token`.
                checkout_token: checkoutDataSource.token,
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
                    transaction_id: transactionId,
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
            // console.log("Final Purchase Datalayer:", JSON.stringify(dataLayerObj, null, 2));
            pushEventToDataLayer(dataLayerObj);
        });
    }

} else {
    console.error("Pixel: Shopify 'analytics' object not found. Tracking will not work.");
}

console.log("Shopify Pixel Initialized with GTM/Stape integration and refined logic (v.complete_final_fix_attempt).");