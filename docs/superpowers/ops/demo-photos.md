# Real pictures for the Zaya Naturals demo (about USD 1.10, once)

Every picture in the demo account is drawn by a script, so the Library looks samey. This card makes 24 real photos once, with your own OpenAI key, and puts them in place of the drawn ones. A slot with no real photo keeps its drawing, so nothing is ever broken.

## What it costs
About **USD 1.10** for all 24 (24 x USD 0.0457 at medium quality, priced from `backend/config/apiCosts.js`, `PROVIDER_RATES.gpt_image_2_per_picture`, the size used here is the measured 1024x1280). The script has a hard limit of **USD 3.00** and refuses anything above it (24 at high quality would be about USD 4.42, so it refuses). Each picture is one call; nothing is retried. Running it again never pays twice: a finished picture is reused.

## The command
Copy all of this into Terminal and press Enter:

```bash
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 20 && cd "/Users/dineshkannaa/Documents/0 CONTENT/Claude Agents/nebula-worktrees/nebulaa-redesign/backend" && I_APPROVED_DEMO_PHOTOS=yes node scripts/generate-demo-photos.js
```

Then, in order:
1. It lists the 24 slots and the estimated cost.
2. It asks for your **OpenAI key**. Paste it and press Enter. What you paste is hidden; the key is never shown, logged or saved, and the script does not read it from the environment or any file.
3. It asks you to type **YES** to the cost. Anything else stops it with nothing spent.
4. It makes the pictures one by one (several minutes in all) and prints a line for each.
5. It prints the path of a **contact sheet**. Open it and look at all 24:

```bash
open ~/nebulaa-demo-photos/contact-sheet.html
```

6. If you are happy, type **PROMOTE**. Only then are the pictures copied into the demo folder (`backend/demo-assets/zaya/`) under the same file names the drawn ones use. Anything else keeps them only in `~/nebulaa-demo-photos`; run the same command later and type PROMOTE without paying again.

`I_APPROVED_DEMO_PHOTOS=yes` is your approval for the paid calls. Without it the script refuses and spends nothing. It also refuses when `NODE_ENV` is `production`.

## Where things are
- `~/nebulaa-demo-photos/originals/<slot>.png`: the raw picture from OpenAI (outside the repo).
- `~/nebulaa-demo-photos/final/<same path as the drawn picture>.jpg`: the cropped, compressed copy (at most 250 KB).
- `backend/demo-assets/zaya/...`: the demo folder (git-ignored). Promotion copies `final` into it.
- Prompts, slot names and file mapping: `backend/scripts/demo-brand/photoPrompts.js`.

## The 24 slots
Products (square, replace the product page pictures)
1. `product-marble`: the serum on white marble
2. `product-clay`: the mask jar on terracotta clay with sandalwood and saffron
3. `product-leaf`: the toner on a banana leaf with rose petals
4. `swatch-texture`: close-up of serum oil, a drop and a swatch
5. `packaging-stack`: a stack of plain boxes with the cleanser tube and neem
6. `marketplace-white`: the sunscreen tube on pure white, marketplace style

Posts (4:5)
7. `flatlay-turmeric` turmeric roots and powder (cleanser carousel cover)
8. `flatlay-neem` wet stone, neem leaves and the cleanser
9. `flatlay-amla` amla, hibiscus, coconut and the hair oil, moody wood
10. `flatlay-rose` rose petals, rose water and the toner, high key pink
11. `diwali-diyas` the serum among lit diyas, marigolds, brass, night
12. `gifting-hamper` an open hamper on silk with three products
13. `bathroom-shelf` morning light, tiles, plant, nobody in the room
14. `monsoon-mood` rain on a window, the hair oil, masala tea
15. `sandal-ritual` a brass bowl of saffron clay mask and a brush
16. `summer-spf` the sunscreen on a sunlit step with a straw hat
17. `lip-balm-trio` three balms on golden silk

Carousel "What is inside the night cream", four slides with one look (cream linen, brass, soft window light)
18. `carousel-1` ingredients, 19. `carousel-2` cream texture, 20. `carousel-3` the jar, 21. `carousel-4` bedside at night. The fourth slide is new: it appears in the post only once its real photo exists and you run `create` again.

Photoshoot (one picture from each finished job)
22. `photoshoot-studio` styled studio set, 23. `photoshoot-flatlay` natural flat lay, 24. `photoshoot-festival` marigolds and lamps, tall.

No faces, no readable text, no logos in any of them. The packaging is described as plain and blank, because an image model cannot spell a label; the drawn pictures still carry the real product names, so a product page may show one drawn and one real picture of slightly different bottles. That is a known trade-off; redo a slot if it bothers you.

## Redo one picture
```bash
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 20 && cd "/Users/dineshkannaa/Documents/0 CONTENT/Claude Agents/nebula-worktrees/nebulaa-redesign/backend" && I_APPROVED_DEMO_PHOTOS=yes node scripts/generate-demo-photos.js --only diwali-diyas --force
```
It makes that one picture (about USD 0.05), then asks for PROMOTE again. Change the wording in `photoPrompts.js` first if you want a different scene. `--only a,b` takes several slots; `--quality low|medium|high` changes the price.

## Rebuild the demo and see them
Promotion already replaces the files, so a hard refresh (Cmd+Shift+R) shows them. To keep them in a rebuilt demo and to add the fourth carousel slide, run create again (the account and password are kept):

```bash
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 20 && cd "/Users/dineshkannaa/Documents/0 CONTENT/Claude Agents/nebula-worktrees/nebulaa-redesign/backend" && node scripts/seed-demo-brand.js create && node scripts/seed-demo-brand.js status
```
`create` never redraws a slot that has a real photo in `~/nebulaa-demo-photos/final`; it copies the real one in. `status` ends with a line such as `real photos: 24 of 24 slots are real (24 in the demo folder), 0 still drawn`. `remove` deletes only `backend/demo-assets/zaya`, never `~/nebulaa-demo-photos`, so remove then create brings them back with no new spend.
