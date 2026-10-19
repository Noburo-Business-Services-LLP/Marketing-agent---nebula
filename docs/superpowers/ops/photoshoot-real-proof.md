# Photoshoot: the one real proof run (needs the owner's OK)

Not run yet. Everything about Photoshoot was built and checked with a fake image generator. Before `ENABLE_PHOTOSHOOT=on`, ONE real photo proves that the prompt and the reference photo work with the real image model, and measures what a photo really costs.

## What it does

- Makes exactly ONE image call: the Marketplace pack's "Front" scene (or a pack and scene you name) from ONE product photo on this computer, at medium quality, the same prompt rules as the studio.
- Cost: about USD 0.06 to 0.10 (about 5 to 8 rupees). Nothing is charged to any customer account.
- Touches no database, uploads nothing; the photo is saved on this computer and the path is printed. The key is never printed.

## Steps

1. Pick a clear photo of one product (PNG, JPEG or WEBP, up to 6 MB), for example a pickle jar on a table.
2. In a terminal, from the `backend` folder of the `nebulaa-redesign` worktree:

```
CONFIRM_REAL_PHOTOSHOOT=yes PROOF_PRODUCT_PHOTO=/path/to/your-product.jpg node scripts/photoshoot-real-proof.js
```

Optional: a name and another pack and scene, for example the Festival pack's lamps scene:

```
CONFIRM_REAL_PHOTOSHOOT=yes PROOF_PRODUCT_PHOTO=/path/to/your-product.jpg PROOF_PRODUCT_NAME="Mango pickle" node scripts/photoshoot-real-proof.js festival lights
```

## What to look at

- PASS line with the seconds it took and where the photo was saved. Open the photo:
  - the product looks exactly like yours (shape, colours, label),
  - no person, face or hands,
  - no added logo, words, price or watermark,
  - the scene matches the pack (pure white and filling the frame for Marketplace).
- The token line: `input ... (image N, text M)`. Send it to the developer: the image part is the real cost of the reference photo, which replaces the estimate `photoshoot_reference_input_per_photo` (USD 0.012) in `backend/config/apiCosts.js`. Every pack price then updates by itself.

## If it fails

- "Refusing": the confirm word was not set; nothing was called.
- "The image call was refused": the message says why (for example the model name or a safety refusal). Nothing was charged to anyone; tell the developer the message.

## After a good proof

1. Correct the reference rate in `apiCosts.js` if it differs, run the tests.
2. Release, then set `ENABLE_PHOTOSHOOT=on` on the server and restart. The packs open for paid plans, agency clients and managed accounts.
