"""
Records the onboarding questionnaire as a screen video, filled in as the demo brand Zaya Naturals.

Use it ONLY against the safe recording pair (see docs/superpowers/ops/demo-onboarding-recording.md):
  - a backend started with dummy provider keys and the outbound-request block, on port 5100
  - the frontend started with VITE_BACKEND_URL pointing at it, on port 3300, opened as 127.0.0.1 (not localhost)
  - the throwaway account made by backend/scripts/seed-onboarding-recording.js (password in ~/nebulaa-demo-secrets)

  python3 -I backend/scripts/demo-brand/record-onboarding.py [--lang en|ta|hi] [--out DIR]

Nothing is sent anywhere except to that local pair. The password is read from the file and never printed.
The values mirror backend/scripts/demo-brand/constants.js (BRAND, COMPETITORS).
"""
import argparse
import os
import sys
import time

from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:3300'
SECRETS = os.path.expanduser('~/nebulaa-demo-secrets/onboarding-recording.txt')

ANSWERS = {
    'name': 'Zaya Naturals',
    'mobile': '+91 90000 12345',
    'type': 'Beauty and wellness',
    'city': 'Chennai, Tamil Nadu',
    'hero': 'Kumkumadi Glow Serum',
    'who': 'Working women 22 to 38 in Chennai, Bengaluru, Mumbai and Delhi who read labels and follow skin creators',
    'goals': ['More sales', 'More followers, likes and comments'],
    'tones': ['Caring', 'Helpful and informative'],
    'competitors': ['Kaya Veda', 'Pure Petal Co', 'Ritu Organics'],
    'different': 'Traditional ayurvedic recipes in clean, fragrance-light formulas',
    'rules': 'No medical claims. No before and after photos. Never name other brands.',
    'upcoming': 'Diwali gift boxes and a new rose and saffron range',
}

CURSOR_JS = """
(() => {
  const d = document.createElement('div');
  d.id = '__cur';
  d.style.cssText = 'position:fixed;z-index:2147483647;width:22px;height:22px;border-radius:50%;background:rgba(245,166,35,.55);border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.35);pointer-events:none;left:-40px;top:-40px;transform:translate(-50%,-50%);transition:width .12s,height .12s';
  const add = () => document.body && !document.getElementById('__cur') && document.body.appendChild(d);
  addEventListener('DOMContentLoaded', add); setInterval(add, 500);
  addEventListener('mousemove', (e) => { d.style.left = e.clientX + 'px'; d.style.top = e.clientY + 'px'; }, true);
  addEventListener('mousedown', () => { d.style.width = d.style.height = '14px'; }, true);
  addEventListener('mouseup', () => { d.style.width = d.style.height = '22px'; }, true);
})();
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--lang', default='en', choices=['en', 'ta', 'hi'])
    ap.add_argument('--out', default=os.path.expanduser('~/nebulaa-demo-recordings'))
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    email, pw = open(SECRETS).read().split()[:2]

    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(
            viewport={'width': 1600, 'height': 900},
            record_video_dir=args.out, record_video_size={'width': 1600, 'height': 900},
        )
        ctx.add_init_script(CURSOR_JS)
        pg = ctx.new_page()
        pos = {'x': 800, 'y': 450}
        # The real demo account already holds the name "Zaya Naturals", so the "business already exists" check would block this
        # recording. Only this browser's answer to that one check is replaced; nothing on the server is changed.
        pg.route('**/auth/check-duplicate', lambda r: r.fulfill(status=200, content_type='application/json', body='{"success":true,"duplicate":false}'))

        def pause(s):
            pg.wait_for_timeout(int(s * 1000))

        def glide(el):
            el.scroll_into_view_if_needed()
            box = el.bounding_box()
            x, y = box['x'] + min(box['width'] / 2, 140), box['y'] + box['height'] / 2
            pg.mouse.move(pos['x'] + (x - pos['x']) * 0.5, pos['y'] + (y - pos['y']) * 0.5, steps=14)
            pg.mouse.move(x, y, steps=14)
            pos.update(x=x, y=y)

        def click(sel_or_el, wait=0.5):
            el = pg.locator(sel_or_el).first if isinstance(sel_or_el, str) else sel_or_el
            glide(el.element_handle())
            pause(0.25)
            el.click()
            pause(wait)

        def type_into(sel, text, wait=0.6):
            el = pg.locator(sel).first
            glide(el.element_handle())
            el.click()
            pg.keyboard.type(text, delay=48)
            pause(wait)

        # Sign in (not part of the story; the recording starts at the questionnaire).
        pg.goto(f'{BASE}/#/login')
        pg.fill('input[type=email]', email)
        pg.fill('input[type=password]', pw)
        pg.click('button:has-text("Sign In")')
        pg.wait_for_selector('input[placeholder*="Nebulaa Corp"]', timeout=20000)
        if args.lang != 'en':
            pg.click('button:has-text("%s")' % {'ta': 'தமிழ்', 'hi': 'हिन्दी'}[args.lang])
        pause(2.2)  # the opening shot: the empty form beside the sample posts

        # Step 1: identity
        type_into('input[placeholder*="Nebulaa Corp"]', ANSWERS['name'])
        type_into('input[placeholder*="98765"]', ANSWERS['mobile'])
        sel = pg.locator('select').first
        glide(sel.element_handle())
        sel.select_option(label=ANSWERS['type'])
        pause(0.8)
        type_into('input[placeholder*="Cuddalore"]', ANSWERS['city'])
        click('button:has-text("One business")')
        pause(0.8)
        click('button:has-text("Continue")', 1.6)

        # Step 2: audience
        type_into('input[placeholder*="Masala"]', ANSWERS['hero'])
        type_into('textarea[placeholder*="Families"]', ANSWERS['who'], 0.8)
        click('button:has-text("People")')
        click('button:has-text("All of India")')
        pause(0.8)
        click('button:has-text("Continue")', 1.6)

        # Step 3: strategy
        for g in ANSWERS['goals']:
            click(f'button:has-text("{g}")', 0.4)
        for t in ANSWERS['tones']:
            click(f'button:has-text("{t}")', 0.4)
        for c in ANSWERS['competitors']:
            type_into('input[placeholder*="Nike"]', c, 0.3)
            click('button:has-text("Add")', 0.5)
        type_into('input[placeholder*="25 years"]', ANSWERS['different'])
        type_into('textarea[placeholder*="political"]', ANSWERS['rules'])
        type_into('textarea[placeholder*="Diwali"]', ANSWERS['upcoming'], 0.9)
        click('button:has-text("Continue")', 1.8)

        # Step 4: connect (skipped, as most new customers do) and finish
        pause(1.2)
        click('button:has-text("Finish Setup")', 0.5)
        pg.wait_for_timeout(6000)  # the first screen after setup
        pause(1.0)

        video = pg.video
        ctx.close()
        path = video.path()
        browser.close()
    final = os.path.join(args.out, f'zaya-onboarding-{args.lang}-{time.strftime("%Y%m%d-%H%M%S")}.webm')
    os.replace(path, final)
    print('Recorded:', final)


if __name__ == '__main__':
    sys.exit(main())
