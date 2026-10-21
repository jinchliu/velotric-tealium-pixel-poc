datalayer：Shopify → GA4 事件推送脚本，用于电商转化追踪。订阅店面与结账事件，
转换成 GA4 风格的 payload 推送到 `dataLayer`，并在结账阶段把
第一方 cookie 桥接到 Stape 服务端 GTM (sGTM)，供订单 webhook 事后回补归因。

整套埋点方案分三部分，本仓库是 **web 端**的全部源码 —— pixel、主题片段，以及
GTM web 容器里那两个 custom HTML tag。另外两部分分别是托管在 Stape 的 sGTM，
以及跑在 Cloud Run 上的 order-backfill。三部分如何协作见
[ARCHITECTURE.md](ARCHITECTURE.md#系统全景)。

## 配置

复用到新店铺时只需改 [shopify/web-pixel.js](shopify/web-pixel.js) 顶部的两个
区块，下方业务逻辑无需改动。

### 1. `config`

```js
const config = {
    conversionTracking: {
        measurementId: 'G-XXXXXXXXXX', // GA4 Measurement ID
        trackPageViews: true,          // 以下为各事件开关 (track*)
        // ...
    },
    store: {
        gmcCountryFallback: 'US',      // GMC item_id 的国家段回退值
        affiliationName: /* 自动取自 init.data.shop.name */,
    },
};
```

| 字段 | 填什么 | 填错会怎样 |
| --- | --- | --- |
| `measurementId` | GA4 数据流 (Data Stream) 的 ID，必须与店面 gtag.js 实际写入的属性一致 | `ga_session_id` 静默回退成时间戳，而 `ga_client_id` 依然正确，不看控制台发现不了 |
| `gmcCountryFallback` | Merchant Center feed 里真实 `item_id` 的国家段 | `item_id` 格式正常但 join 不上任何商品 |

`gmcCountryFallback` 只在 `init` 读不到店铺国家时才生效。

### 2. Stape 常量

```js
const STAPE_CONTAINER_LOADING_PATH = 'https://load.YOUR-DOMAIN.com'; // Stape 容器加载域名
const STAPE_LOADER_SCRIPT_NAME     = 'xxxxxxxxxxx.js';               // loader 文件名
const STAPE_LOADER_QUERY_STRING    = 'xxxx=...';                     // loader query string
```

这三个值分两步取，**后两个在 Stape 后台里看不到**:

**第一步 —— Stape 后台**(Custom Loader power-up → Code & Setup information)
给出三个值:Web GTM ID、Container loading path、Container identifier。其中
Container loading path 就是 `STAPE_CONTAINER_LOADING_PATH`。

**第二步 —— Shopify 的 Stape Conversion Tracking app**。把上面三个值填进去
(sGTM 容器 URL、勾选 Add custom loader、填 Container identifier)，app 会在页面
底部生成一段 GTM 代码。剩下两个常量从这段代码里复制:

```html
j.src="https://load.securedata.example.com/28eqbgxbxdc.js?"+i
...
(window,document,'script','dataLayer','3fev=CgBFJSwq…%3D%3D');
```

| 常量 | 从哪复制 |
| --- | --- |
| `STAPE_LOADER_SCRIPT_NAME` | `j.src` 里的文件名，如 `28eqbgxbxdc.js` |
| `STAPE_LOADER_QUERY_STRING` | 最后一个参数，如 `3fev=CgBFJSwq…%3D%3D` |

文件名是 **app 生成的前缀 + Stape 的 Container identifier**，前缀不可推导 ——
modesees 是 `28e`(3 位)，speediance 是 `3g83`(4 位)。query string 同理，只在
生成的代码里。两者成对使用才有效。

这段生成的代码也正是要贴进 `theme.liquid` 的那段，所以同一个 URL 在
`theme-liquid.html` 和 `web-pixel.js` 里各有一份。

## 部署

### 1. Web Pixel

Shopify 后台 **Settings → Customer events → Add custom pixel**，粘贴
[shopify/web-pixel.js](shopify/web-pixel.js) 全文，填好上述两个区块后保存。

**可选：压缩后再粘贴（以 `terser` 为例）。**交给客户自行部署时通常给一份压缩产物:

```bash
terser shopify/web-pixel.js -o web-pixel.min.js
```

**不要加任何 flag。** 产物是 gitignored 的交付件，不是源码，检查方法见
[排查手册](docs/troubleshooting.md#检查产物-build-artefacts)。

### 2. theme.liquid 接收端

Pixel 跑在 Shopify 的沙箱 iframe 里，事件通过 `postMessage` 镜像给父页面，必须
由主题里的监听器接进顶层 `dataLayer`，顶层 GTM 才消费得到 —— 所以装完 pixel
还得改主题。

完整片段见 [shopify/theme-liquid.html](shopify/theme-liquid.html)，里面是两段
script，整段加到
[`theme.liquid`](https://shopify.dev/docs/storefronts/themes/architecture/layouts)
的 `<head>`：GTM 容器在前尽早加载，下面这段监听器在后。GTM 会持续消费
`dataLayer`，所以监听器放在容器之后也不会漏事件。

```html
<script>
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({ event: "cus_page_view" });
  window.addEventListener('message', function (event) {
    if (event.data && event.data.event) {
      window.dataLayer.push(event.data);
      window.dataLayer.push({ ecommerce: null });
    }
  });
</script>
```

## 参考文档

| 文档 | 什么时候读 |
| --- | --- |
| `event` | 固定 `store_cookies` |
| `measurement_id` | GA4 Measurement ID from `config.conversionTracking.measurementId` |
| `cart_token` | `checkout.token`。字段名沿用线上已部署 sGTM 的 `cart_token`(不可改),但**值是 checkout token**,对应订单 webhook 的 `checkout_token`,而非 webhook 的 `cart_token` |
| `_ga` | `_ga` cookie 原值 |
| `_ga_<g_id>` | GA4 session cookie 原值(键名随 `measurement_id` 变化) |
| `ga_client_id` | 从 `_ga` 解析(取末两段);失败回退随机 UUID |
| `ga_session_id` | 从 `_ga_<g_id>` 解析,兼容 `GS1` / `GS2` 两种格式;失败回退当前 unix 秒 |
| `fbp` / `fbc` | `_fbp` / `_fbc` cookie |
| `shopify_customer_id` | `checkout.customer.id`(可为 `null`) |
| `gtm_dd_sep_campaign` / `_content` / `_medium` / `_source` / `_source_platform` / `_term` | 店面 GTM 写入的 UTM cookie |

所有 cookie 均通过沙箱的 `browser.cookie.get()` 并行读取。

### 触发与重试

| Shopify 事件 | 作用 |
| --- | --- |
| `checkout_started` | 首次发送(同时 `loadGTM()`) |
| `checkout_contact_info_submitted` | 重试 |
| `checkout_address_info_submitted` | 重试 |
| `checkout_shipping_info_submitted` | 重试 |
| `payment_info_submitted` | 重试 |
| `checkout_completed` | 重试 |

`checkout_started` 只有一次机会,请求若被页面卸载打断,该订单就再也无法归因。后续每个结账步骤都携带同一个 `checkout.token`,重发一次即可兜底;顺利时只是一次短路,不产生额外写入。

两个模块级 Set 保证幂等:

- `sentCheckoutTokens` —— 已被 sGTM 以 2xx 确认的 token,后续事件直接短路。发送失败的 token 不会进来,所以下一步会自动重试。
- `inFlightCheckoutTokens` —— 请求已发出但未收到响应的 token。结账步骤可能在同一个 tick 内触发,若只看 `sentCheckoutTokens`,会在首个响应回来之前漏过去,导致同一 token 在 Firestore 里写两次。该 Set 在第一个 `await` 之前同步占位。

这组订阅**不受 `track*` 开关控制** —— 它服务的是订单归因而非 GA4 报表,必须在开关关闭时依旧工作。

## 设计要点 (Design Notes)

- **价格按实付计算**:优先使用 `finalLinePrice` / `cost.totalAmount`,逐项还原折扣 (discount) 与优惠码 (coupon),仅 `DISCOUNT_CODE` 类型计入 coupon。
- **GA id 纯 cookie 解析**:直接读 `_ga` / `_ga_<g_id>` 解出 client id 与 session id,不走 gtag 回调,因此没有超时等待;解析失败分别回退随机 UUID 与当前 unix 秒。
- **cookie 立即发送,不设延时**:这些 cookie 由店面 GTM 在进入结账之前就已写好,等待不会等出新值,只会拉长「页面卸载打断请求」的窗口。`keepalive` 保的是已发出的请求,救不了从没发出的请求。
- **`fetch` 使用 `keepalive`**:页面跳转进结账时请求仍能完成。
- **GA4 ecommerce 重置**:携带 `ecommerce` 的事件在推送后追加 `dataLayer.push({ ecommerce: null })`,防止连续事件的 item 数据互相污染。

## 追踪的事件与参数 (Tracked Events & Parameters)

每个事件都可在 `config.conversionTracking` 的对应 `track*` 开关中独立启停;所有事件都携带下方**公共字段**。

### 公共字段 (Common Fields)

所有事件都携带以下字段,各 handler 从 `event.context.document` 就地读取:

| 参数 | 来源 | 说明 |
| --- | --- | --- |
| `event` | — | 推送到 dataLayer 的事件名 |
| `page_location` | `document.location.href` | 当前页 URL |
| `page_referrer` | `document.referrer` | 来源页 |
| `page_title` | `document.title` | 页面标题 |

Pixel 加载时还会用 `init.context.document` 先推一条**不带 `event` 名**的页面上下文(同样三个字段)到沙箱 dataLayer,作为后续事件的默认值。

### 商品对象 (Item Object)

GA4 `ecommerce.items[]` 有三种构造方式,下方各事件会引用:

**A. 变体商品** —— 在 `cus_view_item` / `cus_add_to_cart` / `cus_remove_from_cart` 各自的 handler 内联构造

| 参数 | 来源 |
| --- | --- |
| `item_id` | `product.id` |
| `item_name` | `product.title` |
| `affiliation` | `config.store.affiliationName`(店铺名) |
| `item_brand` | `product.vendor` |
| `item_category` | `product.type` |
| `item_variant` | `sku` \|\| `title` |
| `price` | `price.amount` |
| `quantity` | 数量 |

**B. 结账 / 购物车行** —— `processCheckoutProducts()`,用于 `cus_view_cart` / 各 checkout 步骤 / `cus_purchase`。在 A 的基础上增加:

| 参数 | 来源 |
| --- | --- |
| `coupon` | 行级 `DISCOUNT_CODE` 优惠码(多个用逗号拼接) |
| `discount` | 每单位折扣额(由实付价还原) |
| `index` | 行序号(从 1 起) |

> 注:此处 `price` 为**折后每单位实付价**(`finalLinePrice / quantity`),而非原价。

**C. 商品列表** —— `cus_view_item_list` 内联构造。字段同 A(无 `sku` 级 `item_variant`),并额外带 `index`、`item_list_id`、`item_list_name`。

### 事件明细 (Event Details)

下表按事件列出,标题为推送到 dataLayer 的事件名,参数表仅列**公共字段之外**的字段。

#### `cus_page_view` — 页面浏览

**Shopify 事件** `page_viewed` · **开关** `trackPageViews`

无额外参数。

> 该事件直接调 `window.dataLayer.push`,不走 `pushEventToDataLayer`,因此**不会镜像给父页面** —— 只有结账页(`loadGTM()` 已把 GTM 注入沙箱)才会被消费。店面的页面浏览由 theme.liquid 里那次 `cus_page_view` 负责;两者在结账页会各报一次,如需去重可关掉 `trackPageViews`。

#### `custom_click_storefront` / `custom_click_link_storefront` — 店面点击

**Shopify 事件** `custom_click` / `custom_link_click` · **开关** `trackClicks`

| 参数 | 来源 |
| --- | --- |
| `data` | `event.customData`(原样透传) |

#### `custom_click_checkout` — 结账内点击

**Shopify 事件** `clicked` · **开关** `trackClicks`

| 参数 | 来源 |
| --- | --- |
| `data.click_element` | `element.tagName` |
| `data.click_id` | `element.id` |
| `data.click_classes` | `element.className` |
| `data.click_text` | `element.textContent` \|\| `element.value` |
| `data.click_target` | `element.target` |
| `data.click_url` | `element.href` |

> 仅当 Pixel 初始化时的 URL 含 `/checkouts/` 才注册该订阅。

#### `cus_view_search_results` — 站内搜索

**Shopify 事件** `search_submitted` · **开关** `trackSearch`

| 参数 | 来源 |
| --- | --- |
| `search_term` | `searchResult.query` |

#### `form_submit` — 表单提交

**Shopify 事件** `form_submitted` · **开关** `trackFormSubmit`

| 参数 | 来源 |
| --- | --- |
| `form_action` | `element.action` |
| `form_id` | `element.id` |

> 跳过 `action` 含 `/cart/add` 的加购表单(由 `cus_add_to_cart` 单独追踪)。

#### `cus_view_item_list` — 浏览商品列表

**Shopify 事件** `collection_viewed` · **开关** `trackViewItemList`

| 参数 | 来源 |
| --- | --- |
| `ecommerce.item_list_id` | `collection.id` |
| `ecommerce.item_list_name` | `collection.title` |
| `ecommerce.items[]` | 商品对象 **C** |

#### `cus_view_item` — 浏览商品详情

**Shopify 事件** `product_viewed` · **开关** `trackViewItem`

| 参数 | 来源 |
| --- | --- |
| `ecomm_prodid` | `shopify_<country>_<product>_<variant>` |
| `ecommerce.currency` | `price.currencyCode` |
| `ecommerce.value` | `price.amount` |
| `ecommerce.items[]` | 商品对象 **A**(单件) |

#### `cus_add_to_cart` / `cus_remove_from_cart` — 加入 / 移出购物车

**Shopify 事件** `product_added_to_cart` / `product_removed_from_cart` · **开关** `trackAddToCart` / `trackRemoveFromCart`

| 参数 | 来源 |
| --- | --- |
| `ecomm_prodid` | `shopify_<country>_<product>_<variant>` |
| `ecommerce.currency` | `merchandise.price.currencyCode` |
| `ecommerce.value` | 单价 × 加购/移除数量 |
| `ecommerce.items[]` | 商品对象 **A** |

#### `cus_view_cart` — 查看购物车

**Shopify 事件** `cart_viewed` · **开关** `trackViewCart`

| 参数 | 来源 |
| --- | --- |
| `ecomm_prodid` | 各行 prodid 逗号拼接 |
| `ecommerce.currency` | `cart.cost.totalAmount.currencyCode` |
| `ecommerce.value` | `cart.cost.totalAmount.amount` |
| `ecommerce.coupon` | 订单级 `DISCOUNT_CODE` 优惠码 |
| `ecommerce.items[]` | 商品对象 **B** |

#### `cus_begin_checkout` / `cus_add_shipping_info` / `cus_add_payment_info` — 结账步骤

**Shopify 事件** `checkout_started` / `checkout_shipping_info_submitted` / `payment_info_submitted` · **开关** `trackBeginCheckout` / `trackAddShippingInfo` / `trackAddPaymentInfo`

三者 payload 结构一致;`checkout_started` 还会触发 `loadGTM()` 与首次 cookie 桥接。

| 参数 | 来源 |
| --- | --- |
| `ecomm_prodid` | 各行 prodid 逗号拼接 |
| `ecommerce.currency` | `checkout.currencyCode` |
| `ecommerce.value` | `checkout.subtotalPrice.amount` |
| `ecommerce.coupon` | 订单级 `DISCOUNT_CODE` 优惠码 |
| `ecommerce.items[]` | 商品对象 **B** |
| `ecommerce.shipping_tier` | 仅 `cus_add_shipping_info`:配送方式名称 |

#### `cus_purchase` — 下单完成

**Shopify 事件** `checkout_completed` · **开关** `trackPurchase`

该 handler 会再调一次 `loadGTM()`。

顶层字段:

| 参数 | 来源 |
| --- | --- |
| `cart_token` | `checkout.token`。字段名沿用线上已部署 sGTM 的 `cart_token`(不可改),但**值是 checkout token**,对应订单 webhook 的 `checkout_token`,而非 webhook 的 `cart_token` |
| `ecomm_prodid` | 各行 prodid 逗号拼接 |
| `user_email` | `checkout.email` |
| `user_data.address.*` | `first_name` / `last_name` / `street` / `city` / `region` / `postal_code` / `country`,优先配送地址,回退账单地址 |
| `total_value_before_discount` | 折前总额(各行原单价 × 数量) |
| `total_value_after_discount` | `subtotalPrice`(折后、税/运费前) |
| `total_value_without_tax_shipping` | 同上 |
| `total_value_with_tax_shipping` | `totalPrice`(含税含运费) |

`ecommerce` 字段:

| 参数 | 来源 |
| --- | --- |
| `transaction_id` | `order.name` \|\| `order.id` \|\| `checkout.token` |
| `affiliation` | 店铺名 |
| `currency` | `checkout.currencyCode` |
| `value` | `subtotalPrice`(折后、税/运费前) |
| `tax` | `totalTax.amount` |
| `shipping` | `shippingLine.price.amount`(回退 order 运费) |
| `shipping_tier` | 配送方式名称 |
| `coupon` | 订单级 `DISCOUNT_CODE` 优惠码 |
| `discount` | `discountsAmount.amount`(订单级折扣总额) |
| `payment_type` | `transactions[0].gateway` |
| `items[]` | 商品对象 **B** |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 系统怎么搭的、三端如何协作、关键契约 |
| [AGENTS.md](AGENTS.md) | 在这个仓库里改东西要遵守的规则 |
| [docs/events.md](docs/events.md) | 在 GTM 里配变量，查某个事件发了什么字段 |
| [docs/troubleshooting.md](docs/troubleshooting.md) | 数据看起来正常但对不上 |
| [docs/clients/](docs/clients/) | 各客户的标识符与部署记录 |
