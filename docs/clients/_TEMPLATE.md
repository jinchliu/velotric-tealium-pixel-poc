# <CLIENT>

一段话说明这个客户有什么不同 —— 主题、市场、这套栈里哪些部分存在。如果
[ARCHITECTURE.md](../../ARCHITECTURE.md) 完全适用，就这么写一句，然后删掉本段。

任何关于部署状态的断言都要带上观测日期，否则就不要写:「截至 <日期>，……」
会诚实地变旧，「未部署」则会悄悄变错。

## 标识符

| 占位符 | 值 |
| --- | --- |
| `<gtm-web-container-id>` | `GTM-…` —— account `…`，container `…`，名为 `…` |
| `<gtm-server-container-id>` | `GTM-…` —— account `…`，container `…`，名为 `…` |
| `<stape-container-identifier>` | |
| `<container-loading-path>` | `https://load.…` |
| `<tagging-server-url>` | `https://…` |
| `<gcp-project>` | 项目、数据库、区域 |

Loader 脚本 `<prefix><stape-container-identifier>.js` 与 query string ——
两者都只出现在 Shopify 的 Stape Conversion Tracking app 生成的 GTM 代码里，
Stape 后台看不到，前缀也不由容器标识推导。取法见
[README](../../README.md#2-stape-常量)。`theme-liquid.html` 硬编码的 URL 与
pixel 用常量拼出的是同一个，改要一起改。

如果用了 Google Service Account power-up，记下 Firestore 服务账号与角色 ——
授权范围见 [安全考量](../../ARCHITECTURE.md#安全考量)。

## 店铺

| 店铺 | Hostname | Shop domain | Measurement ID |
| --- | --- | --- | --- |
| production | | | |
| test | | | |

每个构建用的 `gmcCountryFallback` 是什么，以及有没有拿 Merchant Center 的 feed
导出核对过。

## GTM 对象 ID

通用文档按名字描述这些对象;这里记打开它们要用的 API ID。

| 对象 | 容器 | ID |
| --- | --- | --- |
| Measurement ID Lookup Table | web | |
| Measurement ID Lookup Table | server | |
| `is transaction tracked` | server | |

## Merchant Center

`item_id` 前缀是拿哪一份 feed 导出核对的，以及日期。绝不要拿文档核对 —— 见
[Merchant Center item ID](../../ARCHITECTURE.md#merchant-center-item-id)。

## 本客户的未决事项

- 哪些环节还没有端到端验证过，以及要怎样才算验证。
