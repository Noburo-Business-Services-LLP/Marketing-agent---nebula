# Inventory → Products & Services catalogue

**Date:** 2026-09-04
**Status:** Approved, in implementation

## Problem

The Inventory page presents itself as stock management: four cards counting
In Stock, Low Stock and Out of Stock, and a form asking for stock quantity.

That is the wrong model for this product. Nebulaa does not know, and has no way
to know, what a business is holding in its shop. The data would be wrong from
the moment it was entered.

What the page is actually for is supplying **source material to generation**:
the images and details of what a business offers, so campaigns, images and
videos can be built around real things rather than invented ones. It is Brand
Assets, scoped to what the business sells.

It also assumes physical goods. A service business — a salon, a consultancy, a
clinic — has nothing to put in a stock column, and today cannot even create an
entry, because `price` is `required`.

## What the code already tells us

Two findings shaped this design:

- **Stock is nearly unused.** `stockStatus` and `stockQuantity` appear only in
  `Inventory.tsx` and `Campaigns.tsx` — and Campaigns is reachable only at
  `/campaigns-classic`, linked from nowhere. Removing stock from the UI breaks
  nothing that a user can reach.
- **Generation never reads price or stock.** `videoGenerationPipeline` uses
  `name`; `aiMemoryService` uses `name`, `category` and `tags`; images come from
  `imageUrl`. The fields the page emphasises are the ones generation ignores.

## Data model

All changes are additive. No migration, and existing records stay valid.

| Field | Change |
|---|---|
| `type` | **new** — `'product' \| 'service'`, default `'product'` |
| `price` | `required: true` → optional |
| `priceNote` | **new** — free text, e.g. "From ₹5,000/session" |
| `images` | **new** — `[String]`; `imageUrl` remains the primary image |
| `keyFeatures` | **new** — `[String]` |
| `stockStatus`, `stockQuantity` | retained in schema; no longer written or displayed |

Stock is hidden rather than dropped so the change is reversible and no data is
destroyed. `imageUrl` is kept alongside `images` so every existing consumer —
the Reels product picker, campaign generation — keeps working untouched.

### Pre-save hook

The model derives `stockStatus` from `stockQuantity`, which defaults to 0, so
every new entry is silently written as `out-of-stock`. That is invisible once
stock leaves the UI, but it is still untrue data. The hook will skip when stock
is not explicitly set.

## Page

Renamed **Products & Services**, in the sidebar and in the page header. The word
"inventory" carries exactly the stock-management meaning this work removes.

The four stock cards are replaced by counts that describe a catalogue: total
entries, products, services, and how many have images — the last because an
entry without images contributes nothing to generation.

The form drops stock and gains: a Product/Service toggle, multiple images, key
features, and the optional price plus free-text note.

## Deliberately out of scope

**The generation prompt is not changed.** `videoGenerationPipeline.js:571`
hardcodes `Feature ${productName} naturally in the frame.`, which is wrong for a
service — there is no physical object to frame. The `type` field makes fixing
this possible, but the fix is deferred: it is better made against real service
data than guessed at now. Until then `type` is stored and displayed only.

## Known defect fixed along the way

`Inventory.tsx:102` calls `product.price.toString()`. The moment price becomes
optional, editing an entry without one throws. Guarded as part of this work.

## Constraints

- No behaviour change for existing product records.
- `frontend/package.json` defines only `dev`, `build` and `preview` — there is no
  test harness, so verification is driving the page in the browser.
