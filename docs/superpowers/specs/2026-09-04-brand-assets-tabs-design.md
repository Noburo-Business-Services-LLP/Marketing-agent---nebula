# Brand Assets as the single home for brand material

**Date:** 2026-09-04
**Status:** Approved, in implementation

## Problem

Products & Services sits in the sidebar as its own destination, but it is not a
separate concern. It is a collection of images and details describing what the
brand offers — the same kind of material as the logo, the colours and the tone.
It belongs with them.

Two further gaps:

- **There is nowhere to put photos of the actual premises.** Shop, showroom,
  workshop, storefront. These matter: the Reels wizard has an Environment step
  whose whole purpose is locking scenes to a real space, and it offers "OR PICK
  FROM BRAND ASSETS" — a picker with nothing to pick from, because nothing in
  the product ever writes environment images.
- **"Past Campaign Learning" is misnamed**, which is why its presence here reads
  as arbitrary.

## What "Past Campaign Learning" actually is

Not a history log. You paste captions from posts the brand has already
published, and `computePatternSummary` extracts the brand's real voice from
them: recurring hashtags, common openers, CTA phrasings, caption length,
line-break habits. That feeds `BrandIntelligenceProfile`, which shapes generated
copy. Capped at 40 samples.

So it is **training input for brand voice** — the same family as the logo and
tone, and correctly located. Only the name is wrong: it describes a history
view, which is what AI History (`/ai-history`) actually is. It becomes its own
**Voice** tab.

The distinction worth preserving: AI Memory is the *output* of learning, AI
History is the *log*, and this is the *raw material fed in*. Moving it to AI
Memory would put an input control inside an output view.

## Structure

Brand Assets gains four tabs:

| Tab | Contents |
|---|---|
| Brand | Logos, colours, fonts, tone/style overrides — unchanged |
| Products & Services | The existing Inventory page, moved in |
| Environment | Photos of the premises, stored as `BrandAsset` type `environment` |
| Voice | Past-post learning, renamed, with its detected-patterns summary |

`BrandAsset.type` extends from `['logo','template']` to include `'environment'`.

## Why the Reels step needs no changes

`GET /video-generation/brand-assets/images` already reads the `BrandAsset`
collection directly — the same collection the Brand Assets page writes to. Any
image saved with the new `environment` type therefore appears in the Environment
step's picker automatically, filling a control that has been empty since it was
built.

## Implementation constraint

`Inventory.tsx` is ~1,150 lines and `BrandAssets.tsx` ~980. **They are not merged
into one file.** Brand Assets renders them as tab panels, so each remains a
focused component. A 2,100-line file would be a poor edit surface and the merge
would be hard to unwind.

Likewise the Brand tab keeps its current internal layout untouched. Only Voice
is lifted out. Rearranging working code the user has not complained about is not
part of this.

## Navigation

Products & Services leaves the sidebar; Brand Assets is the single entry.
`/inventory` remains as a route that redirects to `/brand-assets?tab=products`,
so existing links and bookmarks keep working.

## Verification

No test harness exists in this repo. Verification is in the browser, and must
include the round trip that motivates the Environment tab: upload an environment
image in Brand Assets, then confirm it appears in the Reels Environment picker.
