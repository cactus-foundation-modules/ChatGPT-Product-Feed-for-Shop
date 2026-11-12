-- ChatGPT Product Feed for Shop: one settings row, nothing else.
--
-- The feed itself is never stored. It is built from the shop's own tables on
-- every fetch, so it can never drift from what the storefront is charging.
-- This table only remembers what the owner chose, the secret key that guards
-- the feed address, and when the feed was last collected - so the settings tab
-- can say whether anything is actually reading it.
--
-- All DDL is idempotent so run-module-migrations can safely re-apply it.

CREATE TABLE IF NOT EXISTS "cpf_settings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    -- Nothing is served until the owner switches it on. Off, the feed address
    -- answers 404 exactly as a wrong key does.
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    -- The shared secret in the feed address. Minted on first read of the
    -- settings, replaced on demand when an address leaks.
    "feed_token" TEXT,
    -- OpenAI's seller_name, required on every row. Null falls back to the
    -- site name from Settings > General.
    "seller_name" TEXT,
    -- Brand is required too. Per row it runs: the supplier the product is filed
    -- under (when brand_from_supplier is on), then default_brand. A row with
    -- neither is held back rather than sent with a made-up maker.
    "default_brand" TEXT,
    "brand_from_supplier" BOOLEAN NOT NULL DEFAULT true,
    -- Publish the row's own SKU as the manufacturer part number. Off by
    -- default: on a shop that numbers its own stock the SKU is a private code.
    "mpn_from_sku" BOOLEAN NOT NULL DEFAULT false,
    "default_condition" TEXT NOT NULL DEFAULT 'new',
    -- Off drops sold-out rows from the feed. On sends them as out_of_stock,
    -- which OpenAI accepts and which keeps a briefly sold-out product known.
    -- Either way a shop that hides sold-out products from shoppers hides them
    -- here too.
    "include_out_of_stock" BOOLEAN NOT NULL DEFAULT true,
    -- Returns, as OpenAI asks them. Null accepts_returns means "not stated",
    -- which is a different answer from false and is sent as an empty cell.
    "accepts_returns" BOOLEAN,
    "return_window_days" INTEGER,
    "return_policy_url" TEXT,
    -- is_ads_eligible on every row. Off sends nothing, which OpenAI reads as
    -- "not for adverts".
    "ads_eligible" BOOLEAN NOT NULL DEFAULT false,
    -- The last successful collection of the feed, for the settings tab.
    "last_fetched_at" TIMESTAMP(3),
    "last_fetched_items" INTEGER,
    "last_fetch_agent" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "cpf_settings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "cpf_settings_singleton_check" CHECK ("id" = 'singleton'),
    CONSTRAINT "cpf_settings_condition_check" CHECK ("default_condition" IN ('new', 'refurbished', 'used')),
    CONSTRAINT "cpf_settings_return_window_check" CHECK ("return_window_days" IS NULL OR "return_window_days" > 0)
);
INSERT INTO "cpf_settings" ("id") VALUES ('singleton') ON CONFLICT DO NOTHING;
