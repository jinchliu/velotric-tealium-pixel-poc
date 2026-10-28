# Velotric

## Source and identifiers

These values were extracted on 2026-10-23 from the Pixel supplied by the user.
They describe the supplied code, not a verified production deployment.

| Setting | Value |
| --- | --- |
| Storefront | `https://www.velotricbike.com` |
| Development storefront | `https://tealium-5hvassg6.myshopify.com` |
| Web GTM container | `GTM-5M9PZ5B4` |
| GA4 Measurement ID | `G-HMY36WYC3Q` |
| GA4 test Measurement ID, supplied by the user on 2026-10-23 | `G-4FLMVWWG56` |
| Stape loading origin | `https://load.securemetrics.velotricbike.com` |
| Loader filename | `gzLdwmaknhgo.js` |
| Loader query | `33=aWQ9R1RNLTVNOVBaNUI0&sort=asc` |
| Stape container identifier | `wmaknhgo` |
| Supplied cookie-bridge destination | `https://load.securemetrics.velotricbike.com/data` |
| Checkout join key | `cart_token`, whose value is `checkout.token` |
| Tealium account, confirmed from the 2026-10-23 screenshot | `velotric-trial` |
| Tealium profile, confirmed from the 2026-10-23 screenshot | `main` |
| Tealium local target environment | `dev` |

On 2026-10-23, read-only GET checks returned HTTP 200 and JavaScript loader
content for both `https://tags.tiqcdn.com/utag/velotric-trial/main/dev/utag.js`
and `https://tags.tiqcdn.com/utag/velotric-trial/main/qa/utag.js`. The scripts
were not executed; availability does not establish Collect or connector behavior.

On 2026-10-23, the development storefront above opened in the browser and
redirected to `/password`, showing the store name `tealium`. This confirms the
public storefront is reachable; no password was entered or tracking validated.

The supplied code's unused `STAPE_GTM_BASE_QUERY_PARAMS` points to a different
container. The active loader URL above describes the supplied production integration.
Do not change the join key to the generic repository's `checkout_token` without
coordinating the deployed sGTM lookup fields. The `US` item-ID prefix is retained
from the supplied Pixel; a Merchant Center feed comparison remains outstanding.

## Tealium-only POC scope

On 2026-10-27, the user confirmed that the original GTM-only Pixel was never
changed in the production store. The local POC is a separate Tealium-only
installation. Do not replace or modify the production GTM Pixel or theme.

The user requested the original script layout with only necessary integration
changes. The current `shopify/web-pixel.js` therefore retains:

- The original `config.conversionTracking` event switches and separate literal
  `analytics.subscribe()` callbacks for each approved commerce event.
- The original product and order calculations, including the verbatim
  `processCheckoutProducts` helper and each event's price/quantity extraction.
- In-memory commerce objects, followed by a dedicated Tealium UDO mapping and
  sender. The objects are not written or forwarded to dataLayer.

The Tealium sender maps `product_sku` from `ecommerce.items[].item_variant` as
defined in the plan: the Shopify SKU, falling back to the variant label. It retains
source event IDs/timestamps, actual
purchase order IDs, hashed email, permission checks, bounded readiness, and
per-runtime source/order deduplication. There are no GTM/Stape loaders or cookie
capture POSTs. Existing product-ID and financial output conventions are retained.

## Minimal theme bridge

`shopify/theme-liquid.html` is an inline SDK loader and message receiver. It
contains only the connection settings used by the theme, validates the sending
Custom Pixel iframe and message revision, loads the configured SDK after Shopify
analytics permission, acknowledges SDK readiness, and invokes the guarded
`utag.view`/`utag.link` method for the received payload.

All event preparation, cookie/hash work, queueing, SDK-readiness retries, and
source/order deduplication stay in the Pixel. The parent has no retry timer,
business-data mapper, SDK queue, or Consentmo observer. `utag_cfg_ovrd.noview`
prevents an automatic SDK page view; Shopify's source event drives the explicit
page-view call. Existing page dataLayer entries are left untouched.

The loader uses the official Universal Tag snippet body (asynchronous script
insertion before the first script), with the URL supplied by the existing
account/profile/environment settings and the existing error handler retained.
It is a separate `loadTealium()` function. The bridge calls it only after the
same Shopify permission check; the SDK is not loaded unconditionally. The
message protocol and Pixel implementation are unchanged by this loader update.

The bridge uses protocol version 3. Both installation files must be replaced
together. Older version-2 drafts are not compatible with this simplified bridge.
This structure was verified with local mocks, not by saving a new Shopify draft.
The earlier version-2 editor validation does not establish deployment of this
version.

## Configuration and Dev delivery

Source configuration is disabled by default. On 2026-10-28, the user requested
removing the fixed storefront-domain allowlist for customer handoff. Review
`config` and `TEALIUM_CONFIG`, then run:

```sh
npm ci
node scripts/sync-tealium-theme.mjs
npm test
node scripts/sync-tealium-theme.mjs --check
npm run build:dev
```

The sync script copies only the settings actually used by the theme, not a copy
of the Pixel runtime. The builder enables `velotric-trial/main/dev` without
requiring a storefront URL, and selects `G-4FLMVWWG56` for existing GA session
cookie lookup. It does not configure a GA4 sender. Tealium iQ destinations need
separate configuration and Dev publication.

Replace the test store's Custom Pixel with all of `dist/dev/web-pixel.min.js`.
Replace its previous POC theme fragment with all of `dist/dev/theme-liquid.html`,
including the script tags, before `</head>`. Do not append a duplicate or install
a second loader. No separate theme asset is required. Leave the production
store's GTM installation untouched.

The builder generates both `dist/dev/web-pixel.js` with four-space indentation
and `dist/dev/web-pixel.min.js` with compact formatting. Both use Terser with
compression and mangling disabled, preserving names and runtime behavior. Each
complete Pixel, including its notice, must remain below 64,000 characters and
UTF-8 bytes. The already-short theme fragment keeps its readable source formatting.

The delivery runs on the HTTPS storefront where it is installed, including its
checkout pages. There is no hard-coded store hostname. The Pixel targets the
actual parent origin from Shopify's page context, and the theme still validates
the sending Custom Pixel iframe, channel/version, revision, and payload page
origin. Ready messages must come from that parent origin. Tealium's `dev` path
selects the SDK publication environment; installing it on a live store still
collects live-store visits. Keep the customer's original GTM installation separate.

## Privacy and deferred Consentmo work

The current POC uses Shopify's real `init.customerPrivacy` state and
`api.customerPrivacy.subscribe('visitorConsentCollected', ...)` on both storefront
and checkout. Analytics permission gates collection; marketing permission gates
identity and purchase addresses. Unknown or denied permissions do not become
consent. Withdrawal clears pending collection and permanently redacts queued
identity. A later grant does not replay discarded history.

Consentmo live integration was deferred by the user on 2026-10-27. Its observer,
polling, and bidirectional state synchronization have been removed from these
test files rather than left as unused configuration. A customer-environment
Consentmo validation is separate work and must confirm that the CMP updates
Shopify privacy correctly, or add the agreed API integration before production
Tealium collection is enabled. Do not treat Dev event tests as a CMP acceptance
result. Shopify's Custom Pixel privacy settings still apply.

The Pixel reads existing `gtm_dd_sep_*` attribution cookies through Shopify's
cookie API to retain `cus_utm_*`, and reads existing GA identifiers. It neither
loads their original writer nor invents missing values. No writer in a test
store means the corresponding fields remain absent.

## Validation

`tests/fixtures/approved-tealium-payloads.json` contains all 12 approved event
payloads from the combined implementation. Regression tests compare the restored
layout against that fixture, and cover SKU/variant-label array alignment, order money,
identity, independent event switches, consent withdrawal, SDK delay/error/timeout,
parent messaging, Shopify/custom domains, HTTPS validation, literal event
subscriptions, compact-output equivalence, and delivery size.
The original checkout-product helper was also compared with the preserved source
and retained verbatim.

The parent SDK is loaded once and uses a bounded Pixel-side queue until the
SDK's view/link methods exist. Errors or a missing bridge expire pending events
without an uncaught tracking exception. Purchase requires the actual order ID;
source/order deduplication is per runtime, not a cross-page/server guarantee.

After replacing both Dev files, validate the Shopify editor, real source events,
page/product/cart/checkout/purchase amounts and arrays, rejection and withdrawal,
Tealium requests and Trace receipt, then the configured GA4 test destination.
Local mocks and syntax checks do not establish Shopify deployment or downstream
receipt.

## Authentication integration

The current delivery contains only the Pixel and theme fragment. The developer
that owns the authentication result must publish the agreed Shopify custom event
in that execution context, only after confirmed success:

```js
window.Shopify.analytics.publish('velotric:login', {
    method: 'email',
    user_id: existingUserId,
    customer_email: trustedEmail,
});
```

Publish `velotric:sign_up` after successful account creation and
`velotric:logout` after sign-out.
An already hashed email can be supplied as `customer_email_hash` instead. The
Pixel validates 64 hexadecimal characters and does not hash that value again.
The existing `user_id` representation is preserved. Checkout contact information
is not treated as an authenticated account. Confirm the current account type,
success signals, and identifier format with Velotric before connecting these
publish calls. The Pixel subscribes to these events; it does not listen to form
submissions, infer success, or automatically emit authentication events.

## Outstanding integration validation

- Compare `product_id` values with the agreed tracking specification and Merchant
  Center feed; the existing `shopify_US_<product>_<variant>` convention is retained.
- Confirm real order-ID representation and backend purchase deduplication. Local
  deduplication is per runtime, not a cross-page/server guarantee.
- Integrate confirmed login, sign-up, and logout success signals before installing
  the account-page publish calls. Checkout email is not authenticated login.
- Configure category rules and identity/activation filters in Tealium iQ and
  EventStream/AudienceStream. Browser permission handling alone does not establish
  backend consent enforcement or downstream identity stitching.
- Review real Consentmo/Shopify initialization and updates in both storefront and
  checkout. Confirm supported regions and the test store's Custom Pixel privacy
  requirements with the store developer.
- Optional navigation/content fields are accepted only from explicit source
  custom data. Product cost/model/size and refunds still require reliable sources.

## References

- [Technical specification](https://docs.google.com/spreadsheets/d/1c9ZCTFAn9fO82ip0LwALKVWPST1hsQU9Rumrt4zh6cQ/edit)
- [20 October implementation meeting](https://bcn0acrafh9q.feishu.cn/minutes/obcnqb773i4pz2q36iexmz47), 03:29 and 06:51-07:05: retain GTM and add Tealium calls; 01:26 and 07:34: storefront/theme and checkout/Custom Pixel placement.
- [Tealium installation and code access](https://docs.tealium.com/platforms/javascript/install/#get-the-code)
- [27 October implementation meeting](https://bcn0acrafh9q.feishu.cn/minutes/obcnuzl6ll4x74o1w442q4cj), 02:00, 04:52-05:49, and 10:05: separate Tealium from the production GA/GTM Pixel and guard missing SDK methods.
- [Consentmo Storefront JavaScript API](https://support.consentmo.com/en/article/consentmo-storefront-javascript-api-j0ef2h/)
- [Shopify Pixel privacy API](https://shopify.dev/docs/api/web-pixels-api/pixel-privacy)
