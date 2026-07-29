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
            setTimeout(() => { // Stape cookie sender logic - ensure full functions are here
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

                function get_ga4_client_id(mid) {
                    return new Promise((resolve) => {
                        let clId = '';
                        let res = false;
                        const tryGet = () => {
                            const cks = document.cookie.split(';').reduce((a, ck) => {
                                const p = ck.split('=').map(s => s.trim());
                                if (p.length === 2) a[p[0]] = p[1];
                                return a;
                            }, {});
                            if (cks._ga) {
                                const cv = cks._ga;
                                const ps = cv.split('.');
                                if (ps.length === 4 && ps[0] === 'GA1') return `${ps[2]}.${ps[3]}`;
                                if (ps.length >= 3 && ps[0] === 'GA1' && ps[1].match(/^\d+$/)) return `${ps[ps.length - 2]}.${ps[ps.length - 1]}`;
                                if (cv.length > 6 && cv.startsWith('GA1.')) {
                                    const cp = cv.substring(cv.lastIndexOf('.', cv.lastIndexOf('.') - 1) + 1);
                                    if (cp.includes('.')) return cp;
                                }
                            }
                            return null;
                        };
                        const fbUUID = () => generateUUID();
                        const resClId = (id, src) => {
                            if (!res) {
                                res = true; /* console.log(`客户端ID (来源: ${src}):`, id); */
                                resolve(id);
                            }
                        };
                        if (typeof gtag === 'function') {
                            let timedOut = false;
                            const tOut = setTimeout(() => {
                                if (res) return;
                                timedOut = true;
                                clId = tryGet();
                                if (clId) resClId(clId, "cks (tout)");
                                else resClId(fbUUID(), "uuid (tout)");
                            }, 1500);
                            try {
                                gtag('get', mid, 'client_id', (api_cid) => {
                                    clearTimeout(tOut);
                                    if (res || timedOut) return;
                                    if (api_cid) resClId(api_cid, "gtag");
                                    else {
                                        clId = tryGet();
                                        if (clId) resClId(clId, "cks (empty)");
                                        else resClId(fbUUID(), "uuid (empty)");
                                    }
                                });
                            } catch (e) {
                                clearTimeout(tOut);
                                if (res) return;
                                console.error("gtag client_id error:", e);
                                clId = tryGet();
                                if (clId) resClId(clId, "cks (err)");
                                else resClId(fbUUID(), "uuid (err)");
                            }
                        } else {
                            clId = tryGet();
                            if (clId) resClId(clId, "cks (no gtag)");
                            else resClId(fbUUID(), "uuid (no gtag)");
                        }
                    });
                }

                function get_ga4_session_id(mid) {
                    return new Promise((resolve) => {
                        let sessId = '';
                        let res = false;
                        const tryGetSess = () => {
                            const cks = document.cookie.split(';').reduce((a, ck) => {
                                const p = ck.split('=').map(s => s.trim());
                                if (p.length === 2) a[p[0]] = p[1];
                                return a;
                            }, {});
                            const mSuffix = mid.startsWith('G-') ? mid.substring(2) : mid;
                            if (!mSuffix) return null;
                            const ckKey = '_ga_' + mSuffix.replace(/-/g, '_');
                            const g4cv = cks[ckKey] || cks['_ga_' + mSuffix];
                            if (g4cv) {
                                const ps = g4cv.split('.');
                                if (ps.length >= 3) {
                                    let sPart = ps[2];
                                    if (sPart.startsWith('s') && sPart.includes('$')) {
                                        const sTs = sPart.substring(1).split('$')[0];
                                        if (/^\d+$/.test(sTs)) return sTs;
                                    } else if (/^\d+$/.test(sPart)) return sPart;
                                }
                            }
                            return null;
                        };
                        const fbTs = () => Math.floor(Date.now() / 1000).toString();
                        const resSessId = (id, src) => {
                            if (!res) {
                                res = true; /* console.log(`会话ID (来源: ${src}):`, String(id)); */
                                resolve(String(id));
                            }
                        };
                        if (typeof gtag === 'function') {
                            let timedOut = false;
                            const tOut = setTimeout(() => {
                                if (res) return;
                                timedOut = true;
                                sessId = tryGetSess();
                                if (sessId) resSessId(sessId, "cks (tout)");
                                else resSessId(fbTs(), "ts (tout)");
                            }, 1500);
                            try {
                                gtag('get', mid, 'session_id', (api_sid) => {
                                    clearTimeout(tOut);
                                    if (res || timedOut) return;
                                    if (api_sid) resSessId(api_sid, "gtag");
                                    else {
                                        sessId = tryGetSess();
                                        if (sessId) resSessId(sessId, "cks (empty)");
                                        else resSessId(fbTs(), "ts (empty)");
                                    }
                                });
                            } catch (e) {
                                clearTimeout(tOut);
                                if (res) return;
                                console.error("gtag session_id error:", e);
                                sessId = tryGetSess();
                                if (sessId) resSessId(sessId, "cks (err)");
                                else resSessId(fbTs(), "ts (err)");
                            }
                        } else {
                            sessId = tryGetSess();
                            if (sessId) resSessId(sessId, "cks (no gtag)");
                            else resSessId(fbTs(), "ts (no gtag)");
                        }
                    });
                }

                /***************************************************/
                /************* MODIFICATION START ******************/
                /***************************************************/
                async function getCookiesPayloadInternal() {
                    try {
                        const [
                            clientId,
                            sessionId,
                            fbp,
                            fbc,
                            gaCookie,
                            gaGidCookie,
                            sep_campaign,
                            sep_content,
                            sep_medium,
                            sep_source,
                            sep_source_platform,
                            sep_term
                        ] = await Promise.all([
                            get_ga4_client_id(config.conversionTracking.measurement_id),
                            get_ga4_session_id(config.conversionTracking.measurement_id),
                            browser.cookie.get('_fbp').catch(() => null),
                            browser.cookie.get('_fbc').catch(() => null),
                            browser.cookie.get('_ga').catch(() => null),
                            browser.cookie.get(`_ga_${config.conversionTracking.g_id}`).catch(() => null),
                            // New cookies from your image
                            browser.cookie.get('gtm_dd_sep_campaign').catch(() => null),
                            browser.cookie.get('gtm_dd_sep_content').catch(() => null),
                            browser.cookie.get('gtm_dd_sep_medium').catch(() => null),
                            browser.cookie.get('gtm_dd_sep_source').catch(() => null),
                            browser.cookie.get('gtm_dd_sep_source_platform').catch(() => null), // Assuming full name for 'gtm_dd_sep_source_pl...'
                            browser.cookie.get('gtm_dd_sep_term').catch(() => null)
                        ]);

                        const shopifyCustomerIdFromEvent = event.data?.checkout?.customer?.id || null;

                        const payload = {
                            "event": "store_cookies",
                            "cart_token": event.data.checkout.token,
                            "fbp": fbp,
                            "fbc": fbc,
                            "_ga": gaCookie,
                            [`_ga_${config.conversionTracking.g_id}`]: gaGidCookie,
                            "ga_client_id": clientId,
                            "ga_session_id": sessionId,
                            "shopify_customer_id": shopifyCustomerIdFromEvent,
                            // Adding the new parameters to the payload
                            "gtm_dd_sep_campaign": sep_campaign,
                            "gtm_dd_sep_content": sep_content,
                            "gtm_dd_sep_medium": sep_medium,
                            "gtm_dd_sep_source": sep_source,
                            "gtm_dd_sep_source_platform": sep_source_platform,
                            "gtm_dd_sep_term": sep_term
                        };
                        return payload;
                    } catch (error) {
                        console.error('Error in getCookiesPayloadInternal:', error);
                        return {
                            error: "Failed to get cookies payload",
                            details: error.message || String(error)
                        };
                    }
                }
                /***************************************************/
                /************** MODIFICATION END *******************/
                /***************************************************/

                async function sendCookiesToSgtmInternal() {
                    const payload = await getCookiesPayloadInternal();
                    if (payload && !payload.error) {
                        fetch(`${STAPE_GTM_SCRIPT_URL_BASE}/data`, {
                            method: "POST",
                            headers: {
                                "Content-Type": "application/json"
                            },
                            body: JSON.stringify(payload),
                            keepalive: true
                        }).then(response => {
                            if (!response.ok) {
                                console.error('Error sending payload: Server responded with status', response.status, response.statusText);
                                return response.text().then(text => {
                                    throw new Error(text || response.statusText)
                                });
                            }
                            return response.json().catch(() => ({}));
                        }).catch(error => {
                            console.error('Error sending payload to Stape:', error);
                        });
                    } else if (payload && payload.error) {
                        console.error("Not sending payload due to previous error:", payload);
                    }
                }
                sendCookiesToSgtmInternal();
            }, 500);

            const eventContextData = event.context?.document;
            const checkout = event.data?.checkout; // Use checkout object directly for this event
            if (!checkout) {
                console.warn("Begin Checkout: No checkout data found.");
                return;
            }

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
                cart_token: checkoutDataSource.token,
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