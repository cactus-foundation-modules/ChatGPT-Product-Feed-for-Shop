# ChatGPT Product Feed for Shop

A [Cactus](https://github.com/usersaynoso/cactus-foundation) module that serves a product feed for ChatGPT, in the format OpenAI's merchant tools ask for ([product file specification](https://developers.openai.com/commerce/specs/file-upload/products)).

Every variation is its own product - its own price, photos, stock and link - grouped under its listing with `group_id` and `variant_dict`, so someone asking ChatGPT for the exact size and colour finds the exact size and colour you sell. The feed is built fresh from the shop on every fetch, so it never disagrees with the storefront.

Requires the **shop** and **shop-variations** modules.

## Where it lives

**Settings > ChatGPT product feeds** - `/<admin>/config?tab=chatgpt-product-feeds`, behind `shop.manage`.

## The feed address

```
/api/m/chatgpt-product-feed-for-shop/public/feed/<file>?key=<secret>
```

| `<file>` | Format |
|---|---|
| `products.csv` | CSV (default) |
| `products.csv.gz` | CSV, gzip |
| `products.tsv`, `products.tsv.gz` | TSV |
| `products.jsonl`, `products.jsonl.gz` | JSON Lines |

The key is minted on first open of the settings tab and can be replaced at any time, which cuts the old address off. Every wrong request is a plain 404.

## What it sends

`item_id`, `title`, `description`, `url`, `brand`, `seller_name`, `image_url`, `availability`, `price` on every row, plus where known: `sale_price`, `group_id`, `listing_has_variations`, `variant_dict`, `gtin` (check-digit validated), `mpn` (opt-in, from the SKU), `condition`, `product_category`, `weight` / `item_weight_unit`, `additional_image_urls`, `seller_url`, `accepts_returns`, `return_deadline_in_days`, `return_policy`, `is_ads_eligible`.

Prices are VAT-inclusive whatever the storefront displays. Products with no photo, no brand or no price are held back and listed on the settings tab's **Check the feed**.

## Layout

```
app/api/public/feed/[file]/route.ts   the feed itself
app/api/admin/settings/route.ts       read, save, replace the key
app/api/admin/preview/route.ts        build and report, for the settings tab
components/SettingsTab.tsx            Settings > ChatGPT product feeds
lib/feed-data.ts                      rows from the shop and shop-variations
lib/feed-format.ts                    CSV / TSV / JSONL rendering (pure)
lib/row-parts.ts                      per-row judgement calls (pure)
lib/settings.ts                       the cpf_settings row
migrations/001_initial.sql            cpf_settings
```

Full documentation: [ChatGPT Product Feed on the Cactus wiki](https://github.com/usersaynoso/cactus-foundation/wiki/ChatGPT-Product-Feed).

## Licence

MIT
