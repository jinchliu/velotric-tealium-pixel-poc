# SPEEDIANCE

整套栈都为这个客户部署了 —— pixel、GTM web、sGTM、backfill 和 Firestore ——
所以通用文档完全适用。pixel 在 `3e3f3b2` 重新指向该客户，Merchant Center 的
`item_id` 在 `3653b29` 修好。

截至 2026-08-14:在生产店面验证过，未发现问题;未上线 —— 要不要上线在当时是
客户的未决定项。

## 标识符

| 占位符 | 值 |
| --- | --- |
| `<gtm-web-container-id>` | `GTM-5G84T5XX` |
| `<gtm-server-container-id>` | `GTM-N9LNC9LQ` |
| `<stape-container-identifier>` | `jlwuusem` |
| `<container-loading-path>` | `https://load.securedata.ca.speediance.com` |
| `<tagging-server-url>` | 未记录 —— 按 eco-worthy 的规律应该是 `https://securedata.ca.speediance.com`，未验证 |
| `<gcp-project>` | 未记录 |

Loader 脚本 `3g83jlwuusem.js` —— 前缀 `3g83`，query string
`bwbti=BAFOMiE6QV8qXUchQC80TBtYQVtEUQgEUBYDEBATBQsDBhZbFhgB`。两者都来自
Shopify 的 Stape Conversion Tracking app 生成的 GTM 代码，前缀不由容器标识
`jlwuusem` 推导。`theme-liquid.html` 硬编码的 URL 与 pixel 用常量拼出的是
同一个，改要一起改。

account/container 那对数字 ID 还没查过，只知道 `GTM-` 公开 ID。

## 店铺

| 店铺 | Hostname | Shop domain | Measurement ID |
| --- | --- | --- | --- |
| CA | `ca.speediance.com` —— 从 Stape 域名推断，未验证 | 未记录 | `G-NT7ETBJR94` |
| test | `speediance-fs-test.myshopify.com` | 同左 | `G-NT7ETBJR94` |

测试店与 CA 共用同一个 measurement ID，跑在 Shopify 的演示数据上(USD、
"Hydrogen Vendor" 商品)，它的 `shop.countryCode` 返回 **`US`** —— 正是这一点
确认了该字段报告的是店铺自身的国家，而不是它销售的市场。所以从这个店发出的
测试命中带的是 `shopify_US_…` 的 id，这是设计使然，不是 bug。

`speediance` 分支把 `shopify/web-pixel.js` 指向 CA 的值;这个客户的交付件要从
那个分支构建，不要从 `main` —— `main` 上还是 eco-worthy 的值。交付件是
`speediance/web-pixel.ca.min.js`(gitignored)。

## Merchant Center

一份日期为 2026-08-13 的 feed 导出确认了格式是
`shopify_CA_<productId>_<variantId>`，例如
`shopify_CA_9245431103746_48093899096322`。商品 `9245431103746` 以两个不同的
variant id 出现了两次 —— 这是 feed 为变体级、而商品级 `item_id` 对不上的直接
证据。尚未迁移到 `ZZ` 格式;2026-08-18 Content API 停用后需要复查。

## 本客户的未决事项

- **sGTM 的 Lookup Table 没配。** speediance 的 shop domain 不在服务端容器的
  表里，所以事件会落到它的默认 measurement ID。
- **webhook topic 未确认。** 两个系统都不校验它，而 eco-worthy 有一个店铺订错
  成 `carts/create` 好几个月 —— 在相信任何回补的 purchase 之前，先确认这个客户
  订的是 `orders/paid`。
- **归因回补路径在这里从未被走通过。** 这个客户的 Firestore 文档、join 结果、
  去重键都没有被检查过;2026-08-14 验证的只有浏览器端。
- **`ep.ecomm_proid`** —— GA4 payload 里少了个 `d`。pixel 发的是
  `ecomm_prodid`，所以这个名字是在 GTM 里引入的。查一下 Google Ads 再营销 tag
  实际读的是哪个。
- **`cus_view_item_list` 不发 `ecomm_prodid`**，而另外八个 ecommerce 事件都发，
  所以列表曝光可能永远进不了再营销受众。
- **`ep.cus_hit_timestamp` 以 `undefined` 开头** —— 一个 GTM 侧解析不出来的
  变量。
- **观测到的 payload 里没有 `item_variant`。** pixel 发的是 `sku || title`，
  未确认是演示商品两者都没有，还是 tag 没有映射它。
