# MTA Tracking

Shopify Web Pixel,用于电商转化追踪 (conversion tracking)。订阅 Shopify 店面与结账 (checkout) 事件,转换成 GA4 风格的 payload 推送到 `dataLayer`,并在结账阶段把第一方 cookie 桥接到 Stape 服务端 GTM (server-side GTM / sGTM)。

## 数据流 (Data Flow)

```
Storefront / Checkout 事件
        │  analytics.subscribe(...)
        ▼
  GA4-style payload
        ├─► window.dataLayer.push()          // 本页 GTM
        └─► window.parent.postMessage()       // 镜像给父页面顶层 GTM
        
进入 Checkout 时额外:
  loadGTM()              // 注入 Stape 自定义 GTM loader(延迟到结账,保持店面轻量)
  sendCookiesToSgtm()    // 把 GA client/session id、_fbp/_fbc、UTM 桥接到 Stape /data 端点
```

> 完整的事件清单与逐字段参数见文末 [追踪的事件与参数](#追踪的事件与参数-tracked-events--parameters)。

## 配置 (Configuration)

复用时**只需修改** [shopify/web-pixel.js](shopify/web-pixel.js) 顶部 `config` 块里的占位符,下方业务逻辑无需改动。

```js
const config = {
    conversionTracking: {
        gtmContainerId: 'GTM-XXXXXXXXX',   // Web GTM container ID
        measurementId:  'G-XXXXXXXXXX',    // GA4 Measurement ID
        // ...各事件开关 (track*)
    },
    sgtm: {
        scriptUrlBase:   'https://load.YOUR-STAPE-DOMAIN.com', // Stape 自定义 loader 域名
        loaderScriptId:  'XXXXXXXXXXXX',                       // loader 文件名(不含 .js)
        baseQueryParams: 'bwbti=XXXXXXXXXXXXXXXX',             // Shopify Stape 插件提供的 query 参数
    },
    store: {
        countryCode: 'US', // 用于 ecomm_prodid: shopify_<countryCode>_<product>_<variant>
        // affiliationName 自动取自 Shopify 店铺名
    },
};
```

| 字段 | 来源 |
| --- | --- |
| `gtmContainerId` | Google Tag Manager 容器 |
| `measurementId` | GA4 数据流 (Data Stream) |
| `sgtm.scriptUrlBase` / `loaderScriptId` / `baseQueryParams` | Stape 后台与 Shopify Stape 插件 |
| `store.countryCode` | 店铺所在国家代码 |

## 部署 (Deployment)

### 1. Web Pixel

在 Shopify 后台 **Settings → Customer events → Add custom pixel**,把 [shopify/web-pixel.js](shopify/web-pixel.js) 全部内容粘贴进去,填好 `config` 占位符后保存。

Pixel 运行在沙箱中,通过 Shopify 提供的 `analytics`、`browser`、`init` API 工作,无构建步骤、无依赖。

### 2. theme.liquid 接收端

Web Pixel 跑在沙箱 iframe 里,事件通过 `window.parent.postMessage` 镜像给父页面。需要在主题里加一段监听器,把这些事件接到顶层(父页面)的 `dataLayer`,顶层 GTM 才能消费。

在 [`theme.liquid`](https://shopify.dev/docs/storefronts/themes/architecture/layouts) 的 `<head>` 中依次加入以下两段:GTM 容器尽量靠前放,让它尽早加载;监听器随后注册。两段都用 `dataLayer = dataLayer || []` 兜底,`cus_page_view` 与后续 postMessage 事件都在 GTM 加载后才推入,GTM 会持续消费 `dataLayer`,故监听器放在容器之后也能正常上报。

**① Google Tag Manager 容器**(Stape 自定义 loader,域名与 query 参数需与 `config.sgtm` 一致):

```html
<!-- Google Tag Manager -->
<script>
  (function (w, d, s, l, i) {
    w[l] = w[l] || [];
    w[l].push({ 'gtm.start': new Date().getTime(), event: 'gtm.js' });
    var f = d.getElementsByTagName(s)[0], j = d.createElement(s);
    j.async = true;
    j.src = "https://load.securedata.ca.speediance.com/3g83jlwuusem.js?" + i;
    f.parentNode.insertBefore(j, f);
  })(window, document, 'script', 'dataLayer', 'bwbti=BAFOMiE6QV8qXUchQC80TBtYQVtEUQgEUBYDEBATBQsDBhZbFhgB');
</script>
<!-- End Google Tag Manager -->
```

**② 接收端监听器**(放在 GTM 容器之后):

```html
<script>
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({ event: "cus_page_view" });
  window.addEventListener('message', function (event) {
    if (event.data && event.data.event) {
      window.dataLayer.push(event.data);
      window.dataLayer.push({ ecommerce: null }); // Clear ecommerce object
    }
  });
</script>
```

说明:

- `cus_page_view` 在父页面直接补发一次页面浏览(Pixel 内的 `page_viewed` 默认关闭,交由此处与 GTM 处理)。
- `message` 监听器接收 Pixel 镜像过来的事件并推入 `dataLayer`;每次推送后追加 `{ ecommerce: null }`,与 Pixel 端一致,避免连续事件的 ecommerce 数据互相污染。
- GTM 容器的 `j.src` 域名与末尾 `bwbti=...` query 参数,应与 [shopify/web-pixel.js](shopify/web-pixel.js) 中 `config.sgtm.scriptUrlBase` / `loaderScriptId` / `baseQueryParams` 指向同一个 Stape 容器。

## 设计要点 (Design Notes)

- **价格按实付计算**:优先使用 `finalLinePrice` / `cost.totalAmount`,逐项还原折扣 (discount) 与优惠码 (coupon),仅 `DISCOUNT_CODE` 类型计入 coupon。
- **GA id 解析策略**:`gtag API → cookie → fallback`,1.5s 超时兜底,避免 gtag 回调不触发时卡死。
- **cookie 桥接延迟 500ms**:等 GTM loader 写入 `_ga` / `_ga_<id>` 后再读取。
- **`fetch` 使用 `keepalive`**:页面跳转进结账时请求仍能完成。
- **GA4 ecommerce 重置**:每次推送后 `dataLayer.push({ ecommerce: null })`,防止连续事件的 item 数据互相污染。

## 追踪的事件与参数 (Tracked Events & Parameters)

每个事件都可在 `config.conversionTracking` 的对应 `track*` 开关中独立启停;所有事件都携带下方**公共字段**。`page_viewed` 在 Pixel 内默认关闭,页面浏览由 theme.liquid 的 `cus_page_view` 与 GTM 处理。

### 公共字段 (Common Fields)

所有事件都携带以下字段(由 `getPageContext` 注入):

| 参数 | 来源 | 说明 |
| --- | --- | --- |
| `event` | — | 推送到 dataLayer 的事件名 |
| `page_location` | `document.location.href` | 当前页 URL |
| `page_referrer` | `document.referrer` | 来源页 |
| `page_title` | `document.title` | 页面标题 |

### 商品对象 (Item Object)

GA4 `ecommerce.items[]` 有三种构造方式,下方各事件会引用:

**A. 变体商品** — `buildVariantItem()`,用于 `cus_view_item` / `cus_add_to_cart` / `cus_remove_from_cart`

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

**B. 结账 / 购物车行** — `processCheckoutProducts()`,用于 `cus_view_cart` / 各 checkout 步骤 / `cus_purchase`。在 A 的基础上增加:

| 参数 | 来源 |
| --- | --- |
| `coupon` | 行级 `DISCOUNT_CODE` 优惠码(多个用逗号拼接) |
| `discount` | 每单位折扣额(由实付价还原) |
| `index` | 行序号(从 1 起) |

> 注:此处 `price` 为**折后每单位实付价**(`finalLinePrice / quantity`),而非原价。

**C. 商品列表** — `cus_view_item_list` 内联构造。字段同 A(无 `sku` 级 `item_variant`),并额外带 `index`、`item_list_id`、`item_list_name`。

### 事件明细 (Event Details)

下表按事件列出,标题为推送到 dataLayer 的事件名,参数表仅列**公共字段之外**的字段。

#### `custom_click_storefront` / `custom_click_link_storefront` — 店面点击

**Shopify 事件** `custom_click` / `custom_link_click` · **开关** `trackClicks`

| 参数 | 来源 |
| --- | --- |
| `data` | `event.customData`(原样透传) |

#### `custom_click_checkout` — 结账内点击

**Shopify 事件** `clicked`(仅结账流程内可用) · **开关** `trackClicks`

| 参数 | 来源 |
| --- | --- |
| `data.click_element` | `element.tagName` |
| `data.click_id` | `element.id` |
| `data.click_classes` | `element.className` |
| `data.click_text` | `element.textContent` \|\| `element.value` |
| `data.click_target` | `element.target` |
| `data.click_url` | `element.href` |

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

共用 `buildCheckoutStepPayload()` 生成;`checkout_started` 还会触发 GTM 注入与 cookie 桥接。

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

顶层字段:

| 参数 | 来源 |
| --- | --- |
| `checkout_token` | `checkout.token`(即订单 webhook 的 `checkout_token`,非 `cart_token`) |
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
