# CLAUDE.md

Shopify → GA4 conversion tracking with server-side attribution recovery. This
repo holds only the browser-side piece; the solution spans four systems and most
of the hard parts live at their seams.

> **This document is a template.** Everything above "Client deployment" holds
> for any storefront and refers to per-client values by placeholder
> (`<tagging-server-url>`, `<measurement-id>`, …). Concrete values — and any new
> fact that turns out to be client-specific — belong in that section, not
> inline.

Architecture and the recovery path explain what exists; the join contract,
Firestore layout, dedup and the Merchant Center item ID are the four contracts
you can break; the rest is operational.

## Architecture

| System | Where | Responsibility |
| --- | --- | --- |
| `datalayer` (this repo) | `shopify/web-pixel.js`, `shopify/theme-liquid.html` | Shopify Web Pixel + theme snippet. Emits GA4-shaped events, bridges first-party cookies to sGTM. |
| GTM web container | `<gtm-web-container-id>` | Consumes `dataLayer`, sends GA4 events to the server container. |
| GTM server container, hosted on Stape | `<gtm-server-container-id>`, Stape container identifier `<stape-container-identifier>` | Writes Firestore, joins, dedupes, forwards to GA4. |
| `order-backfill` | [order-backfill](https://github.com/jinchliu/order-backfill) (Cloud Run) | Receives Shopify order webhooks and replays them to the server container. |

"sGTM" below is shorthand for the GTM server container.

> **All join and dedup logic lives in sGTM** — not in the pixel, not in the
> backfill. The backfill is re-send only.

**Endpoints.** Two hostnames reach the same server container, and each product
names its own: GTM calls `<tagging-server-url>` the *tagging server URL*, Stape
calls `<container-loading-path>` the *container loading path* (a custom loader
domain). The pixel posts cookies to `<container-loading-path>/data`; the
backfill posts to `<tagging-server-url>/data`.

**Firestore.** GCP project `<gcp-project>`, database `(default)`. Read it with
the Firestore REST API and `gcloud auth application-default print-access-token`.

## The recovery path

A checkout can end without the browser ever reporting a usable purchase — the
page unloads, an ad blocker eats the request, consent is withheld. The recovery
path is: capture the buyer's cookies at checkout, key them by checkout token in
Firestore, and let the order webhook look them back up later.

```
checkout_started ──► sendStoreCookies() ──► sGTM ──► Firestore /{checkoutToken}/
                                                             │
Shopify orders/paid ──► order-backfill ──► sGTM ─────────────┘ join on checkout token
                                             │
                                             └─► GA4 purchase (if not already tracked)
```

## The join contract

Read this before touching any token field.

The pixel sends a field **named `cart_token` whose value is `checkout.token`**.
The name is a legacy misnomer frozen by the already-deployed sGTM container. The
value is Shopify's checkout token (32-hex), which the `orders/paid` webhook
exposes as `checkout_token`. Shopify's *own* `cart_token` on the same order is a
different value in a different format and joins at 0%.

> **Do not rename this field on a deployed client.** `git log` will show it
> renamed to `checkout_token` and then back. Do not rename it a third time.
>
> The freeze exists because the sGTM container is already live. On a client
> where nothing has shipped yet the name can — and should — be corrected before
> launch; modesees did, see [MODESEES](#modesees). Renaming is only safe as an
> atomic four-way change, because `Write Checkout Token` sends the whole event
> data payload to Firestore, which turns the field name into a stored document
> field that the lookups filter on:
>
> 1. the pixel's outgoing field
> 2. sGTM `ED - checkout_token` — keyPath
> 3. sGTM `ga_client_id` — queryKey
> 4. sGTM `ga_session_id` — queryKey
>
> Miss any one and the join returns nothing, with no error.

Three distinct identifiers are easy to confuse:

| Identifier | Format | Where it appears |
| --- | --- | --- |
| checkout token | 32-hex, e.g. `74f42247acd2a4eb80a8b4ebe6ee2f14` | `checkout.token`, webhook `checkout_token`, Firestore collection name |
| checkout **session** token | 24-char base62, e.g. `hWNFGsv0RqSB6fPRQKIoS7By` | the `/checkouts/cn/<token>/` URL segment |
| order id | numeric, e.g. `6829546569893` | `order.id`, webhook `id`, Firestore collection name |

## Firestore layout

Root collections are named by identifier, not by entity type:

```
/{checkoutToken}/{autoId}          store_cookies payload (_ga, _fbp, UTM, ga_client_id, …)
/{orderId}/{autoId}                purchase record with `tracked: true` — the dedup key
/shopify_webhooks/{topic}-{id}     raw webhook receipt: checkout_token, status, original_body_b64
```

> **Two `client_id`-shaped fields mean opposite things.** In a store_cookies
> doc, `ga_client_id` is the real one parsed from `_ga`, and `client_id` is a
> `dcid.…` value sGTM synthesised (the pixel's cross-origin fetch sends no
> cookies). In a purchase doc, `client_id` is the real one. Downstream code must
> read `ga_client_id` from store_cookies.

## Dedup

An sGTM variable (`is transaction tracked`) queries `/{transaction_id}/` for
`tracked`, and the backfill purchase tag fires only when that is not `true`. So
a client-side purchase that lands **without** a `transaction_id` writes no dedup
key, and the backfill reports the same order a second time.

The two paths label themselves, which is the fastest way to tell them apart in
GA4 — add `transaction_source` as a secondary dimension:

| Tag | `transaction_source` | `page_location` |
| --- | --- | --- |
| `GA4 Tag` (client-side pass-through) | `ga_server_side` | real page URL |
| `Webhook Purchase GA4` (backfill) | `shopify_webhook` | hardcoded `/thank_you` |

## The Merchant Center item ID

GA4 `item_id` must be byte-identical to the product's `id` in the Google
Merchant Center feed, or nothing in Google Ads joins item-level data back to a
product. Shopify's Google & YouTube app writes that id as
`shopify_<country>_<productId>_<variantId>`, **one row per variant**.

So `items[]` carries the variant-level id and `product.id` moves to
`item_group_id`, which is GMC's name for the product-level grouping.
`item_group_id` is *not* a standard GA4 item parameter — it arrives as a custom
item-scoped one and has to be registered in GA4 before it appears in reports.

**The country segment is not observable from the pixel.** Its ground truth is
the feed, which the sandbox cannot read, so `resolveGmcCountry()` infers it from
`init.data.shop.countryCode` and falls back to `config.store.gmcCountryFallback`.
Two things that inference cannot get right — both of which make the resolved
value disagree with the fallback, which is what the warning is for:

- `shop.countryCode` is the shop's **own** country. It follows the store address
  in Settings, which Shopify requires to match the business entity's country, so
  a brand selling abroad resolves to where it is registered rather than where it
  sells.
- Shopify's Google & YouTube app emits a market-agnostic **`ZZ`** segment for
  stores migrated to the Merchant API, and no Shopify field will ever return
  `ZZ`. Creating new products or uninstalling and reinstalling that app triggers
  the migration; Content API for Shopping sunset 2026-08-18. Tell clients not to
  reinstall the app.

> **Verify against a feed export, never against the docs.** Ask the client for a
> csv of `item_id` from Merchant Center and compare the prefix.

Changing `item_id` breaks GA4 item reporting continuity — the same product
appears under both the old and the new id, with no retroactive mapping.

## Per-store builds

**Routing.** One GA4 property per storefront, resolved by a Lookup Table
variable in each container:

| Container | Input | Default |
| --- | --- | --- |
| GTM web | `{{Page Hostname}}` | none — an unlisted store tracks nothing client-side |
| GTM server | `{{Request Header - Shopify Shop Domain}}` | a fallback measurement ID — unlisted stores all land in it |

> **The two tables key on different inputs on purpose — do not "align" them.**

**Building a store's file.** Copy `shopify/web-pixel.js`, swap `measurement_id`
and `gmcCountryFallback`, then minify. `g_id` and the `_ga_<id>` cookie name
derive from `measurement_id` automatically — do not edit them separately, and
note that `gmcCountryFallback` only takes effect when `init` reports no shop
country.

> **Minify with plain `terser <src> -o <out>` and no flags.** `-m` renames
> `eventData` to `e`, which collides with the `catch (e)` in
> `pushEventToDataLayer` and trips a JSHint IE8 rule in the Shopify custom pixel
> editor. `-m "reserved=['e']"` also works and keeps the 5.6 KB, but plain is
> safer.

Outputs are gitignored — they are build artefacts delivered to the client, not
source. Check one with `node --check`, and count occurrences with
`grep -o … | wc -l` rather than `grep -c`: the artefact is a single line, so
`grep -c` reports 1 for everything.

## Failure modes that never raise an error

Every one of these produces plausible-looking data and no exception. Suspect
them first.

- **`measurement_id` mismatch.** The pixel reads `_ga_<measurementId>`, which is
  written by gtag.js on the storefront. If the two disagree, `ga_session_id`
  falls back to `Math.floor(Date.now()/1000)` — a normal-looking integer with no
  relation to any GA4 session. `_ga` is property-agnostic, so `ga_client_id`
  stays correct and hides the problem.

- **`transaction_id` fallback.** `order?.name || order?.id || checkout.token`:
  `Order` has no `name` field at all, and `checkout.token` appears to be null on
  `checkout_completed`, so only the middle term works. When `order` is null the
  purchase reaches GA4 with no transaction id, writes no dedup key, and gets
  counted twice.

- **Wrong webhook topic.** A store subscribed to `carts/create` instead of
  `orders/paid` makes the backfill forward cart creations, which sGTM reports as
  0.00 purchases keyed by cart token. Nothing in either system checks the topic.

- **Wrong Merchant Center country segment.** `shopify_US_…` against a feed that
  says `shopify_CA_…` is a well-formed id that joins nothing. See
  [The Merchant Center item ID](#the-merchant-center-item-id).

- **Unvalidated postMessage.** `theme-liquid.html` pushes any message with an
  `event` property into `dataLayer` with no `origin` or `source` check, so any
  iframe on the page can inject events.

- **sGTM Preview shows nothing.** The pixel's `fetch` carries no
  `X-Gtm-Server-Preview` header and, with default `credentials: 'same-origin'`,
  no cookies cross-origin. Absence from Preview proves nothing; check Firestore
  or the response's `unique_event_id` instead.

## Conventions

**Code**

- No build step and no dependencies. The pixel runs in Shopify's sandbox against
  `analytics`, `browser` and `init`; `document.cookie` is not readable there, so
  cookies must go through `browser.cookie.get`.
- Code comments in English.

**Committing**

- Do not commit without being asked.
- Commit messages in English, Conventional Commits, with a body explaining
  *why* — see `c8d3e1d` and `d5f055e` for the expected depth.

**GTM**

- Changes stay in a workspace draft until a version is published. Check
  `get_workspace_status` for unrelated pending changes before creating a
  version — publishing takes everything in the workspace live.

**Investigating**

- Verify against data rather than reasoning from the docs alone. Shopify's Web
  Pixels API reference is thin on nullability, and several fields the code
  depends on turned out not to exist.

## Open items

- **`transaction_id` fallback still unfixed** — see
  [Failure modes](#failure-modes-that-never-raise-an-error).
- **`checkout.token` being null on `checkout_completed` is unconfirmed.** If it
  is, the `checkout_completed` entry in the store_cookies retry list never
  fires.
- **`loadGTM()` has no idempotence guard.** It runs on both `checkout_started`
  and `checkout_completed`; double injection on a single-page checkout is
  unverified.
- **`shopify/web-pixel.js` carries one client's `config` values** as its
  committed defaults. Every deployed client now has its own branch —
  `eco-worthy`, `speediance`, `modesees` — while `main` still happens to hold
  eco-worthy's values rather than a neutral baseline. Read `config` and check
  which branch you are standing on before building anything, and build each
  client's artefact from that client's branch.

---

## Client deployment

Everything below is specific to this client. Nothing above should depend on it.

### ECO-WORTHY

#### Identifiers

| Placeholder | Value |
| --- | --- |
| `<gtm-web-container-id>` | `GTM-NZ3GPW` — account `299275`, container `333061`, named `eco-worthy` |
| `<gtm-server-container-id>` | `GTM-T77P7Z3W` — account `299275`, container `257700041`, named `eco-worthy sGTM` |
| `<stape-container-identifier>` | `cxmuqqvd` |
| `<container-loading-path>` | `https://load.securedata.eco-worthy.com` |
| `<tagging-server-url>` | `https://securedata.eco-worthy.com` |
| `<gcp-project>` | `eco-worthy-20260701`, database `(default)`, us-central1 |

The `GTM-` public ID is what the GTM UI and tag snippets show; the numeric
account/container pair is what the API and `tagmanager.google.com` URLs take.

A third web container, `GTM-MLLSX5RN` (container `258917052`, named
`Web GTM (TEST ONLY!)`), exists in the same account and is not part of this
deployment.

ADC for the Firestore project is already configured on this machine.

#### Stores

| Store | Hostname | Shop domain | Measurement ID |
| --- | --- | --- | --- |
| US | `www.eco-worthy.com` | `eco-worthy.myshopify.com` | `G-66S3XN5ND0` |
| CA | `ca.eco-worthy.com` | `eco-worthy-ca.myshopify.com` | `G-TNLPPY0TR6` |
| UK | `uk.eco-worthy.com` | `eco-worthy-uk.myshopify.com` | `G-K5237BLCEC` |
| DE | `de.eco-worthy.com` | `eco-worthy-de.myshopify.com` | `G-W3VZCPGNQT` |
| test | `eco-worthy-fs-test.myshopify.com` | same | `G-XRCJVNYK60` |

FR/ES/IT/JP/AU stores exist but are deliberately out of scope; they are absent
from both Lookup Tables, so they fall through to the US property server-side and
to nothing client-side.

`shopify/web-pixel.js` on `main` is committed with the US values (`GTM-NZ3GPW`,
`G-66S3XN5ND0`, `gmcCountryFallback: 'US'`); the other stores are built from it.
What was `store.country` is now `gmcCountryFallback`, and the segment is
resolved at runtime — see [The Merchant Center item
ID](#the-merchant-center-item-id).

#### GTM object IDs

The generic sections describe these by name; here are the API IDs to open.

| Object | Container | ID |
| --- | --- | --- |
| Measurement ID Lookup Table, input `{{Page Hostname}}`, no default | web | variable 42 |
| Measurement ID Lookup Table, input `{{Request Header - Shopify Shop Domain}}`, default `G-66S3XN5ND0` | server | variable 37 |
| `is transaction tracked` | server | variable 40 |
| Backfill purchase trigger | server | trigger 41 |
| `GA4 Tag` (client-side pass-through) | server | tag 73 |
| `Webhook Purchase GA4` (backfill) | server | tag 65 |

#### Incidents and measurements

- **DE subscribed to the wrong webhook topic.** `carts/create` instead of
  `orders/paid`; the backfill forwarded 1,441 cart creations and sGTM reported
  every one as a €0.00 purchase keyed by cart token.
- **`(not set)` transaction ids.** ~3.8% of US purchases, likely double-counted.
- **`checkout.token` on `checkout_completed`** looked null across 21 samples.
- **UK builds use `GB`** for what is now `gmcCountryFallback` (ISO 3166-1
  alpha-2). Never checked against the actual Merchant Center prefix, and the
  fallback is now reached only when `init` reports no shop country — so the
  operative value for these stores is whatever `shop.countryCode` returns, which
  has never been observed on any eco-worthy storefront.

### SPEEDIANCE

The full stack is deployed for this client — pixel, GTM web, sGTM, backfill and
Firestore — so everything above applies unchanged. The pixel was retargeted in
`3e3f3b2` and the Merchant Center item ID fixed in `3653b29`.

Verified on the production storefront 2026-08-14 with no problems found.
**Not live** — whether to ship was still the client's open decision.

#### Identifiers

| Placeholder | Value |
| --- | --- |
| `<gtm-web-container-id>` | `GTM-5G84T5XX` |
| `<gtm-server-container-id>` | `GTM-N9LNC9LQ` |
| `<stape-container-identifier>` | `jlwuusem` |
| `<container-loading-path>` | `https://load.securedata.ca.speediance.com` |
| `<tagging-server-url>` | not recorded — by eco-worthy's pattern it would be `https://securedata.ca.speediance.com`, unverified |
| `<gcp-project>` | not recorded |

Loader script `3g83jlwuusem.js` — prefix `3g83`, base query params
`bwbti=BAFOMiE6QV8qXUchQC80TBtYQVtEUQgEUBYDEBATBQsDBhZbFhgB`. Both are
per-container values, from Stape's custom loader and the Stape Shopify app
respectively; neither derives from the container identifier, so both have to be
copied out of those UIs. `theme-liquid.html` hardcodes the same URL that the
pixel assembles from its constants — change them together.

Numeric account/container IDs have not been looked up; only the `GTM-` public
IDs are known.

#### Stores

| Store | Hostname | Shop domain | Measurement ID |
| --- | --- | --- | --- |
| CA | `ca.speediance.com` — inferred from the Stape domain, unverified | not recorded | `G-NT7ETBJR94` |
| test | `speediance-fs-test.myshopify.com` | same | `G-NT7ETBJR94` |

The test store shares the CA measurement ID, runs on Shopify demo data (USD,
"Hydrogen Vendor" products) and its `shop.countryCode` returns **`US`** — which
is what established that the field reports the shop's own country rather than
the market it sells to. A test hit from it therefore carries `shopify_US_…` ids
by design, not as a bug.

The `speediance` branch retargets `shopify/web-pixel.js` at the CA values; build
this client's artefact from that branch, not from `main`, which still holds
eco-worthy's. The delivered artefact is `speediance/web-pixel.ca.min.js`
(gitignored).

#### Merchant Center

A feed export dated 2026-08-13 confirmed `shopify_CA_<productId>_<variantId>`,
e.g. `shopify_CA_9245431103746_48093899096322`. Product `9245431103746` appears
twice under two variant ids — the direct evidence that the feed is variant-level
and that a product-level `item_id` cannot line up. Not yet migrated to the `ZZ`
format; recheck after the 2026-08-18 Content API sunset.

#### Open for this client

- **sGTM Lookup Table not configured.** The speediance shop domain is absent
  from the server container's table, so events fall through to its default
  measurement ID.
- **Webhook topic unconfirmed.** Nothing in either system checks it, and one
  eco-worthy store was subscribed to `carts/create` for months — confirm this
  client is on `orders/paid` before trusting any backfilled purchase.
- **The recovery path has not been exercised here.** No Firestore document,
  join or dedup key from this client has been inspected; the browser side is
  what was verified on 2026-08-14.
- **`ep.ecomm_proid`** — the GA4 payload spells it without the `d`. The pixel
  sends `ecomm_prodid`, so the name is introduced in GTM. Check what the Google
  Ads remarketing tag actually reads.
- **`cus_view_item_list` sends no `ecomm_prodid`** while the other eight
  ecommerce events do, so collection impressions may never reach remarketing
  audiences.
- **`ep.cus_hit_timestamp` begins with `undefined`** — a GTM-side variable that
  does not resolve.
- **No `item_variant` in the observed payload.** The pixel sends
  `sku || title`; unconfirmed whether the demo products have neither or the tag
  does not map it.

### MODESEES

A women's fashion storefront on Shopify's **Paris** theme, not Dawn — the
browser-side selectors share almost nothing with the other two clients. The
containers were cloned from eco-worthy's and still carried its defects when work
started; see [Cloned-container defects](#cloned-container-defects) below.

**Nothing is deployed.** As of 2026-08-20 `modesees.com` carries no GTM
container at all — only Shopify's native gtag (`G-F5R3YM4Z73`) and two Google
Ads tags. Both GTM workspaces hold unpublished drafts, so GTM Preview cannot
attach to the storefront and nothing has been verified end to end.

#### Identifiers

| Placeholder | Value |
| --- | --- |
| `<gtm-web-container-id>` | `GTM-KD9BJV54` — account `6369409954`, container `260123513`, named `Modesees web GTM` |
| `<gtm-server-container-id>` | `GTM-538Z4G6H` — account `6369409954`, container `260817352`, named `Modesees sGTM` |
| `<stape-container-identifier>` | `qbgxbxdc` |
| `<container-loading-path>` | `https://load.securedata.modesees.com` |
| `<tagging-server-url>` | `https://securedata.modesees.com` — both it and the loading path answer `/healthy` with 200 |
| `<gcp-project>` | `modesees01`, database `(default)`, FIRESTORE_NATIVE, us-central1 |

Loader script `28eqbgxbxdc.js` — prefix `28e`, query string
`3fev=CgBFJSwqTzonXTooLlJWVxVZSkxJQQYfXgkXBh0UBxQQShsNFQ%3D%3D`. Verified 200
and the served bundle contains `GTM-KD9BJV54`; the bare path without the query
string 404s, so the pair is only valid together. `theme-liquid.html` hardcodes
the same URL the pixel assembles from its constants — change them together.

Firestore was created from scratch on 2026-08-20 (the project had
`firestore.googleapis.com` disabled and no database). Stape reaches it through
the **Google Service Account power-up**, not through GCP-hosted credentials:
service account `stape-sgtm@modesees01.iam.gserviceaccount.com`, role
**Cloud Datastore User** (`roles/datastore.user`), JSON key uploaded in Stape.

> `roles/datastore.user` is the whole grant. `datastore.editor` also works but
> adds `backups.delete`, `backupSchedules.*` and `userCreds.create` — rights a
> key held by a third party should not carry. Security rules are irrelevant
> here: they govern client SDKs, and IAM-authenticated server access bypasses
> them, so the database is Restrictive.

#### Stores

| Store | Hostname | Shop domain | Measurement ID |
| --- | --- | --- | --- |
| production | `modesees.com` | `yxz5tg-xz.myshopify.com` | `G-5LSR0MTS2B` |
| test | `modesees-fs-test.myshopify.com` | same | `G-4FLMVWWG56` |

`www.modesees.com` 301s to the apex, so `{{Page Hostname}}` is always
`modesees.com` and the web Lookup Table needs only the one row. The shop domain
is a randomly generated store name and looks nothing like the brand — the
server-side table keys on it, so the two tables share no key.

#### The checkout token name is corrected here

modesees sends **`checkout_token`**, not the `cart_token` misnomer the
[join contract](#the-join-contract) describes. The correction was made before
anything shipped, as the atomic four-way change that section lists: the pixel
field, `ED - checkout_token`'s keyPath, and the queryKey on both
`Firestore - ga_client_id` and `Firestore - ga_session_id`.

> **Never build eco-worthy's artefact from `main`.** Every deployed client now
> has its own branch, so merging modesees into `main` is fine — but whatever
> lands there becomes the default the next client is cloned from, and
> eco-worthy's live sGTM still reads `cart_token`. Build each client from its
> own branch.

The webhook side was already correct — Shopify's own `checkout_token` — so
`ED - webhook_checkout_token` did not change. After the correction it and
`ED - checkout_token` are configured identically and differ only in which event
they read from; both were kept so the source of each value stays visible.

#### Paris theme

The two interaction trackers were rewritten from eco-worthy's Dawn versions.
Source of truth is `gtm/click-interaction-tracker.html` and
`gtm/link-interaction-tracker.html`; the GTM tags are byte-identical copies.
They share `window.dlIdentifyModule` — the eco-worthy name
`ecoworthyIdentifyModule` is gone — and the link tag fires on Initialization
while the click tag fires on Page View, so both copies must stay identical.

What differs from Dawn, and why the port was not a selector swap:

- **Flickity, not Swiper.** Every `[class*="swiper"]` rule was dead code.
- **`<product-card>` custom element**, not `.card-wrapper`. Paris has no
  `.grid__item`, so v3's two-stage product-card heuristic is unnecessary.
- **Unstable tokens in three shapes** — Shopify Magic `...aigenblock...`
  suffixes, `template--<digits>__` section scoping, and trailing build hashes.
  `normalizeToken()` strips each and keeps the semantic prefix; it also feeds
  `element_id`, whose Paris values carry Shopify numeric ids.
- **Section fallback needs a hex guard.** Several Paris sections are named by a
  bare hex id that would otherwise become the module value verbatim.
- **No blog**, so the `blog_list` branch is gone. Judge.me is present and
  unchanged. Frequently Bought Together (`cbb-*`) renders outside every
  `shopify-section` and needed its own rule.

Module coverage measured against the live DOM: 586 / 630 / 511 clickable
elements on home, collection and PDP, one `unknown` each — the skip-to-content
link. `debug_mode` is deliberately left `true` for the test period.

> The AI "triple banner" section is named **`promo_tiles`**, not `*_banner`, so
> that `GA4 - banner_click`'s `module contains banner` condition cannot sweep it
> up. Two module values are contract: `hero_banner` and anything matching
> `/menu/`.

#### Cloned-container defects

Both containers were copied from eco-worthy, which replicated its defects. All
are fixed here; the eco-worthy originals are **still live**.

- **`DLV - element_id` read the key `button_state`** — a copy-paste slip, so the
  parameter was permanently empty. The pixel emits neither key; both come only
  from the click tracker.
- **`GA4 - social_icon_click` sent Event Name `menu_click`**, byte-identical to
  `GA4 - menu_click` including its parameter table, so social clicks were
  indistinguishable from menu clicks in GA4. On eco-worthy it is worse: 6 of 13
  social links sit inside `.menu-drawer`, so both tags fire and one click
  produces two identical `menu_click` hits.
- **`element_id` appeared twice** in three tags' parameter tables.
- **Cross-client leakage**: the server Lookup Table defaulted to eco-worthy's
  `G-66S3XN5ND0`, `project id` pointed at `eco-worthy-20260701`, `server_url`
  at `https://securedata.eco-worthy.com`, and the `GA4 client`'s
  `gtagMeasurementIds` listed eco-worthy's four IDs.
- **Credential exposure**: `CST - OpenAI Ads API Key` and its test twin still
  hold eco-worthy's live `sk-svcacct-…` service account keys. The three
  `OpenAI Ads CAPI - *` tags are paused, but the keys are readable by anyone
  with access to this container.

> The lesson is the workflow, not any single field: cloning a container for a
> new client with no diff or QA step carries every defect across. Worth keeping
> a clean template container and checking tag name vs Event Name, variable name
> vs key, parameter-table duplicates, and trigger-to-DOM correspondence before
> delivery — all four would have fired here.

#### Open for this client

- **Nothing is installed on the storefront.** `GTM-KD9BJV54` is absent from
  `modesees.com`, so no Preview, no end-to-end verification, no data.
- **Neither container has ever been published.** Both hold a single version 1
  — the web one is literally named `Empty Container`. Installing the theme
  snippet or pointing the backfill at sGTM today reaches a container with no
  tags in it: no Firestore write, no GA4 forward, no error.
- **OpenAI Ads keys still sit in the sGTM container** — the three CAPI tags are
  paused, so nothing is sent, but the keys remain readable.
- **Stape's service-account key upload is unverified** from here — only the GCP
  side (project, database, SA, role) was confirmed.
- **eco-worthy's copies of the two defects are unfixed** and the decision to fix
  them is the client's; both change GA4 continuity.
- **OpenAI Ads keys should be removed** from this container regardless of
  whether modesees runs OpenAI Ads, and rotated on eco-worthy's side.
- **`Include webhook` is dead config** — its `affectedTagTypes` is `cvt_P842H`,
  a tag type no tag in this container has.
- **Two parameter-name typos**: `cus_hit_timestape` in both webhook PageView
  tags, and `transasction_id` in `Write Webhook Transaction ID` (paused).
- **`cus_hit_timestamp` may begin with `undefined`**, as observed on speediance
  — same configuration, unverified here.
- **`CJS - click_product_name` returns a URL handle, not a name.** 12 of 42
  product handles on the homepage exceed GA4's 100-char limit, and truncation
  removes the trailing style code that identifies the product.
- **Two zero-reference Event Data variables**: `ED - fake_client_id` duplicates
  `ED - client_id` exactly, and `ED - user_id` is unused.
