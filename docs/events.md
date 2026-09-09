# 事件与参数参考 (Tracked Events & Parameters)

Pixel 推送到 `dataLayer` 的每个事件及其字段。在 GTM 里配变量、核对某个事件到底
发了什么时查这里;装和配 pixel 见 [README](../README.md)。

## 公共字段 (Common Fields)

所有事件都带以下字段，各 handler 从 `event.context.document` 就地读取:

| 参数 | 来源 |
| --- | --- |
| `event` | 推送到 dataLayer 的事件名 |
| `page_location` | `document.location.href` |
| `page_referrer` | `document.referrer` |
| `page_title` | `document.title` |

Pixel 加载时还会用 `init.context.document` 先推一条**不带 `event` 名**的页面
上下文(同样三个字段)到沙箱 dataLayer，作为后续事件的默认值。

## 商品对象 (Item Object)

`item_id` 一律是 Merchant Center 的**变体级** product ID
(`shopify_<country>_<productId>_<variantId>`，由 `buildEcommProdId()` 拼出)，
product 级 ID 放在 `item_group_id`。两个 ID 缺一时该商品被跳过。

`ecommerce.items[]` 有三种构造，下方事件总览引用为 **A / B / C**:

| 参数 | 来源 | A 变体商品 | B 结账 / 购物车行 | C 商品列表 |
| --- | --- | --- | --- | --- |
| `item_id` | `buildEcommProdId(productId, variantId)` | ✓ | ✓ | ✓ |
| `item_group_id` | `product.id` | ✓ | ✓ | ✓ |
| `item_name` | `product.title` | ✓ | ✓ | ✓ |
| `item_brand` | `product.vendor` | ✓ | ✓ | ✓ |
| `item_category` | `product.type` | ✓ | ✓ | ✓ |
| `affiliation` | `config.store.affiliationName`(店铺名) | ✓ | ✓ | ✓ |
| `price` | A/C 为 `price.amount`;B 为 `finalLinePrice / quantity`(折后每单位实付价) | ✓ | ✓ | ✓ |
| `quantity` | 数量 | ✓ | ✓ | 固定 `1` |
| `item_variant` | `sku \|\| title` | ✓ | ✓ | — |
| `index` | 行序号(从 1 起) | — | ✓ | ✓ |
| `coupon` | 行级 `DISCOUNT_CODE` 优惠码(多个逗号拼接) | — | ✓ | — |
| `discount` | 每单位折扣额(由实付价还原) | — | ✓ | — |
| `item_list_id` / `item_list_name` | `collection.id` / `collection.title` | — | — | ✓ |

A 在各自 handler 内联构造，B 由 `processCheckoutProducts()` 产出，C 在
`cus_view_item_list` 内联构造。

## 事件总览 (Event Overview)

每个事件都可在 `config.conversionTracking` 的对应 `track*` 开关中独立启停。

| dataLayer 事件 | Shopify 事件 | 开关 | items |
| --- | --- | --- | --- |
| `cus_page_view` | `page_viewed` | `trackPageViews` | — |
| `custom_click_storefront` | `custom_click` | `trackClicks` | — |
| `custom_click_link_storefront` | `custom_link_click` | `trackClicks` | — |
| `custom_click_checkout` | `clicked` | `trackClicks` | — |
| `cus_view_search_results` | `search_submitted` | `trackSearch` | — |
| `form_submit` | `form_submitted` | `trackFormSubmit` | — |
| `cus_view_item_list` | `collection_viewed` | `trackViewItemList` | C |
| `cus_view_item` | `product_viewed` | `trackViewItem` | A |
| `cus_add_to_cart` | `product_added_to_cart` | `trackAddToCart` | A |
| `cus_remove_from_cart` | `product_removed_from_cart` | `trackRemoveFromCart` | A |
| `cus_view_cart` | `cart_viewed` | `trackViewCart` | B |
| `cus_begin_checkout` | `checkout_started` | `trackBeginCheckout` | B |
| `cus_add_shipping_info` | `checkout_shipping_info_submitted` | `trackAddShippingInfo` | B |
| `cus_add_payment_info` | `payment_info_submitted` | `trackAddPaymentInfo` | B |
| `cus_purchase` | `checkout_completed` | `trackPurchase` | B |

带 items 的事件统一附 `ecomm_prodid`(单件为该商品的 GMC ID，多行为各行逗号
拼接)、`ecommerce.currency` 与 `ecommerce.value`，来源如下;`cus_view_cart` 与
三个结账步骤另附订单级 `ecommerce.coupon`(`DISCOUNT_CODE` 优惠码)。

| 事件 | `currency` | `value` |
| --- | --- | --- |
| `cus_view_item` | `price.currencyCode` | `price.amount` |
| `cus_add_to_cart` / `cus_remove_from_cart` | `merchandise.price.currencyCode` | 单价 × 加购 / 移除数量 |
| `cus_view_cart` | `cart.cost.totalAmount.currencyCode` | `cart.cost.totalAmount.amount` |
| 三个结账步骤 | `checkout.currencyCode` | `checkout.subtotalPrice.amount` |
| `cus_purchase` | `checkout.currencyCode` | `subtotalPrice`(折后、税/运费前) |

> **例外:`cus_view_item_list` 三者都没有** —— 它的 `ecommerce` 只有
> `item_list_id` / `item_list_name` / `items`。少掉的 `ecomm_prodid` 意味着
> 列表曝光可能进不了再营销受众。

## 逐事件补充

只列上面这句概括不覆盖的字段。

**`cus_page_view`** — 无额外参数。它直接调 `window.dataLayer.push` 而不走
`pushEventToDataLayer`，因此**不镜像给父页面**，只有结账页(`loadGTM()` 已把
GTM 注入沙箱)才会消费。店面的页面浏览由 theme.liquid 里那次 `cus_page_view`
负责;两者在结账页会各报一次，如需去重可关掉 `trackPageViews`。

**`custom_click_storefront` / `custom_click_link_storefront`** — `data` 为
`event.customData` 原样透传。

**`custom_click_checkout`** — 仅当 Pixel 初始化时的 URL 含 `/checkouts/` 才注册
该订阅。`data` 下带 `click_element` / `click_id` / `click_classes` /
`click_text` / `click_target` / `click_url`，依次取自 `element` 的 `tagName` /
`id` / `className` / `textContent \|\| value` / `target` / `href`。

**`cus_view_search_results`** — `search_term` 取 `searchResult.query`。

**`form_submit`** — `form_action` / `form_id` 取 `element.action` / `element.id`。
跳过 `action` 含 `/cart/add` 的加购表单(由 `cus_add_to_cart` 单独追踪)。

**`cus_view_item_list`** — `ecommerce.item_list_id` / `item_list_name` 取
`collection.id` / `collection.title`。

**`cus_add_shipping_info`** — 额外带 `ecommerce.shipping_tier`(配送方式名称)。

**`cus_purchase`** — 该 handler 会再调一次 `loadGTM()`。

| 顶层参数 | 来源 |
| --- | --- |
| `checkout_token` | `checkout.token`，即 join key，见下方 store_cookies 一节 |
| `user_email` | `checkout.email` |
| `user_data.address.*` | `first_name` / `last_name` / `street` / `city` / `region` / `postal_code` / `country`，优先配送地址，回退账单地址 |
| `total_value_before_discount` | 折前总额(各行原单价 × 数量) |
| `total_value_after_discount` / `total_value_without_tax_shipping` | `subtotalPrice`(折后、税/运费前) |
| `total_value_with_tax_shipping` | `totalPrice`(含税含运费) |

| `ecommerce` 参数 | 来源 |
| --- | --- |
| `transaction_id` | `order.name` \|\| `order.id` \|\| `checkout.token` |
| `affiliation` | 店铺名 |
| `currency` / `value` | `checkout.currencyCode` / `subtotalPrice`(折后、税/运费前) |
| `tax` / `shipping` | `totalTax.amount` / `shippingLine.price.amount`(回退 order 运费) |
| `shipping_tier` | 配送方式名称 |
| `coupon` / `discount` | 订单级 `DISCOUNT_CODE` 优惠码 / `discountsAmount.amount` |
| `payment_type` | `transactions[0].gateway` |

> `transaction_id` 的三级回退实际只有中间一项有效:`Order` 根本没有 `name`
> 字段，`checkout.token` 在 `checkout_completed` 上疑似为 null。`order` 为 null
> 时 purchase 会不带 transaction id 进入 GA4，写不出去重键，被 webhook 补发的
> 那条重复计数 —— 见
> [排查手册](troubleshooting.md#transaction_id-回退链)。

## store_cookies(不是 dataLayer 事件)

结账页 POST 给 Stape `/data` 的 cookie 快照，不经过 `dataLayer`。sGTM 以
`checkout_token` 为键存进 Firestore，供订单 webhook 事后回查。重发与幂等见
[ARCHITECTURE.md](../ARCHITECTURE.md#store_cookies-的重发)，实现细节在
`shopify/web-pixel.js` 的 `sendStoreCookies()` 注释里。

| 字段 | 来源 |
| --- | --- |
| `event` | 固定 `store_cookies` |
| `checkout_token` | `checkout.token`，与订单 webhook 的 `checkout_token` 同名同值。**不是** webhook 自带的 `cart_token`，那是另一个格式的值，join 率为 0 |
| `_ga` / `_ga_<id>` | cookie 原值，后者键名随 `measurementId` 变化 |
| `ga_client_id` | 从 `_ga` 解析(取末两段);失败回退随机 UUID |
| `ga_session_id` | 从 `_ga_<id>` 解析，兼容 `GS1` / `GS2` 两种格式;失败回退当前 unix 秒 |
| `fbp` / `fbc` | `_fbp` / `_fbc` cookie |
| `shopify_customer_id` | `checkout.customer.id`(可为 `null`) |
| `gtm_dd_sep_campaign` / `_content` / `_medium` / `_source` / `_source_platform` / `_term` | 店面 GTM 写入的 UTM cookie |

所有 cookie 通过沙箱的 `browser.cookie.get()` 并行读取。两个回退值都是格式正常
但 join 不上任何东西的值，只有 `console.warn` 会提示。

**触发时机** —— `checkout_started` 首次发送(同时 `loadGTM()`)，此后以下事件
各重试一次:

| Shopify 事件 | 作用 |
| --- | --- |
| `checkout_started` | 首次发送 |
| `checkout_contact_info_submitted` | 重试 |
| `checkout_address_info_submitted` | 重试 |
| `checkout_shipping_info_submitted` | 重试 |
| `payment_info_submitted` | 重试 |
| `checkout_completed` | 重试 |

这组订阅**不受 `track*` 开关控制**。
