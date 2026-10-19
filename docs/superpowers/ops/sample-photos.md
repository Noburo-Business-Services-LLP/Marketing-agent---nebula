# Make the sample photos for the tiles (about USD 0.66, once)

The tiles on Create content, the Photoshoot packs and Home will show real-looking photos instead of drawings. Until the photos exist, every tile keeps its drawing, so nothing is broken. This card makes the twelve photos once, with your own OpenAI key.

## What it costs
About **USD 0.66** for all twelve (about USD 0.055 each, at medium quality, priced from `backend/config/apiCosts.js`). The script has a hard limit of **USD 2.00** and refuses anything above it. Each photo is one call; nothing is retried. Running it again never pays twice: a photo that is already made is reused.

## The command
Copy all of this into Terminal and press Enter:

```bash
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && cd "/Users/dineshkannaa/Documents/0 CONTENT/Claude Agents/nebula-worktrees/nebulaa-redesign/backend" && I_APPROVED_SAMPLE_PHOTOS=yes node scripts/generate-sample-photos.js
```

Then, in order:
1. It lists the twelve slots and the estimated cost.
2. It asks for your **OpenAI key**. Paste it and press Enter. What you paste is hidden, and the key is never shown, logged or saved.
3. It asks you to type **YES** to the cost. Anything else stops it with nothing spent.
4. It makes the photos one by one (about a minute in all, sometimes more) and prints a short line for each.
5. It prints the path of a **contact sheet** in the folder `nebulaa-sample-photos` in your home folder (outside the app). Open it to look at all the photos:

```bash
open ~/nebulaa-sample-photos/contact-sheet.html
```

6. If you are happy, type **PROMOTE**. Only then are the small copies put into the app (`frontend/public/samples/`). Anything else keeps them only in the scratch folder; run the same command later and type PROMOTE without paying again.

`I_APPROVED_SAMPLE_PHOTOS=yes` is your approval for the paid calls. Without it the script refuses and spends nothing.

## What the twelve photos are
Six Photoshoot packs (Product photoshoot, Marketplace pack, Festival pack with diyas and warm lights, Lifestyle and in use, Flat lay, Clean white background) and six Create tiles (Video, Photoshoot, Single post with a hand lighting a diya, Campaign as a grid of posts, Carousel as slides, LinkedIn as a tidy office desk). Products are small Indian business products: a brownie box, a jar of pickle, sweets, handmade soap, a candle, filter coffee. No faces, no brand logos and no text in any photo. The exact prompts are in `backend/config/samplePhotoPrompts.js`.

## Redo one photo
If one photo is not good, change its prompt in `backend/config/samplePhotoPrompts.js` if you want, then redo only that slot (about USD 0.055). `--force` replaces the old photo:

```bash
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && cd "/Users/dineshkannaa/Documents/0 CONTENT/Claude Agents/nebula-worktrees/nebulaa-redesign/backend" && I_APPROVED_SAMPLE_PHOTOS=yes node scripts/generate-sample-photos.js --only pack-festival --force
```

The slot names are: `pack-product`, `pack-marketplace`, `pack-festival`, `pack-lifestyle`, `pack-flatlay`, `pack-white`, `create-video`, `create-photoshoot`, `create-single`, `create-campaign`, `create-carousel`, `create-linkedin`. Several can be given with commas: `--only create-video,create-single`.

`--quality high` makes sharper photos at about USD 0.22 each. Twelve at high quality would be over the USD 2.00 limit, so use it with `--only` for a few slots.

## After promoting
Reload Create content, Photoshoot and Home: the tiles show the photos. Each copy is at most 36 KB, so the pages stay fast (`cd frontend && node scripts/art-budget.mjs` checks it). Tell us when they are in, so they can be committed and released with the next build.
