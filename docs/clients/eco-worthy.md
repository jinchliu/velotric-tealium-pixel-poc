# ECO-WORTHY

**这个客户把 join key 发成 `cart_token`。** 值和别处一样是 `checkout.token`，
只有名字不同，而且被冻住了 —— 它的 sGTM 容器已上线，`ED - checkout_token` 的
keyPath 以及 `Firestore - ga_client_id`、`Firestore - ga_session_id` 两者的
queryKey 都按这个名字过滤。见 [join 契约](../../ARCHITECTURE.md#join-契约)。

## 标识符

| 占位符 | 值 |
| --- | --- |
| `<gtm-web-container-id>` | `GTM-NZ3GPW` —— account `299275`，container `333061`，名为 `eco-worthy` |
| `<gtm-server-container-id>` | `GTM-T77P7Z3W` —— account `299275`，container `257700041`，名为 `eco-worthy sGTM` |
| `<stape-container-identifier>` | `cxmuqqvd` |
| `<container-loading-path>` | `https://load.securedata.eco-worthy.com` |
| `<tagging-server-url>` | `https://securedata.eco-worthy.com` |
| `<gcp-project>` | `eco-worthy-20260701`，数据库 `(default)`，us-central1 |

`GTM-` 公开 ID 是 GTM 界面和 tag 代码片段显示的那个;API 和
`tagmanager.google.com` 的 URL 用的是 account/container 那对数字。

同一个 account 下还有第三个 web 容器 `GTM-MLLSX5RN`(container `258917052`，
名为 `Web GTM (TEST ONLY!)`)，不属于本次部署。

这台机器上 Firestore 项目的 ADC 已配置好。

## 店铺

| 店铺 | Hostname | Shop domain | Measurement ID |
| --- | --- | --- | --- |
| US | `www.eco-worthy.com` | `eco-worthy.myshopify.com` | `G-66S3XN5ND0` |
| CA | `ca.eco-worthy.com` | `eco-worthy-ca.myshopify.com` | `G-TNLPPY0TR6` |
| UK | `uk.eco-worthy.com` | `eco-worthy-uk.myshopify.com` | `G-K5237BLCEC` |
| DE | `de.eco-worthy.com` | `eco-worthy-de.myshopify.com` | `G-W3VZCPGNQT` |
| test | `eco-worthy-fs-test.myshopify.com` | 同左 | `G-XRCJVNYK60` |

FR/ES/IT/JP/AU 店铺存在，但刻意不在范围内;两张 Lookup Table 里都没有它们，
所以服务端会落到 US 属性，客户端什么都不追踪。

`main` 上的 `shopify/web-pixel.js` 提交的是 US 的值(`GTM-NZ3GPW`、
`G-66S3XN5ND0`、`gmcCountryFallback: 'US'`)，其它店铺在此基础上构建。原来的
`store.country` 现在叫 `gmcCountryFallback`，国家段在运行时解析 —— 见
[Merchant Center item ID](../../ARCHITECTURE.md#merchant-center-item-id)。

## GTM 对象 ID

通用文档按名字描述这些对象;这里记的是打开它们要用的 API ID。

| 对象 | 容器 | ID |
| --- | --- | --- |
| Measurement ID Lookup Table，输入 `{{Page Hostname}}`，无默认值 | web | variable 42 |
| Measurement ID Lookup Table，输入 `{{Request Header - Shopify Shop Domain}}`，默认 `G-66S3XN5ND0` | server | variable 37 |
| `is transaction tracked` | server | variable 40 |
| Backfill purchase trigger | server | trigger 41 |
| `GA4 Tag`(客户端直传) | server | tag 73 |
| `Webhook Purchase GA4`(backfill) | server | tag 65 |

## 事故与实测

- **DE 订错了 webhook topic。** 订成 `carts/create` 而非 `orders/paid`;
  backfill 转发了 1，441 次购物车创建，sGTM 把每一次都报成一笔按 cart token
  为键的 €0.00 purchase。
- **`(not set)` 的 transaction id。** 约占 US 购买的 3.8%，很可能被重复计数。
- **`checkout_completed` 上的 `checkout.token`** 在 21 个样本里看起来都是 null。
- **UK 的构建用 `GB`** 作为现在的 `gmcCountryFallback`(ISO 3166-1 alpha-2)。
  从未与真实的 Merchant Center 前缀核对过，而且这个回退值现在只有在 `init`
  读不到店铺国家时才会被用到 —— 所以这些店铺实际生效的是 `shop.countryCode`
  的返回值，而它在任何一个 eco-worthy 店面上都还没被观测过。
