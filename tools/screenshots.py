# Takes the App Store screenshots: iPhone 6.3" (1206 x 2622) and iPad 13" (2064 x 2752).
# Serve the repo first: python3 -m http.server 8772, then: python3 tools/screenshots.py appstore/screenshots
import sys, time
from playwright.sync_api import sync_playwright
OUT = sys.argv[1]
URL = "http://localhost:8772/index.html"
def fire(pg, sq):
    pg.fill("#fire-input", sq); pg.press("#fire-input", "Enter"); pg.wait_for_timeout(60)
with sync_playwright() as p:
    b = p.chromium.launch()
    for dev, w, h, scale in (("iphone", 402, 874, 3), ("ipad", 1032, 1376, 2)):
        ctx = b.new_context(viewport={"width": w, "height": h}, device_scale_factor=scale, color_scheme="dark", has_touch=True, is_mobile=True)
        # Online play isn't needed for the pictures; keep the page from trying to connect.
        ctx.route("**/firebase-config.js", lambda r: r.fulfill(body="window.FIREBASE_CONFIG=null;", content_type="text/javascript"))
        pg = ctx.new_page(); errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        def shot(name, sel=None, pad=8):
            if sel: pg.evaluate("([s,p]) => { const e = document.querySelector(s); window.scrollTo(0, e.getBoundingClientRect().top + window.scrollY - p); }", [sel, pad])
            else: pg.evaluate("window.scrollTo(0,0)")
            pg.evaluate("document.activeElement && document.activeElement.blur()")
            pg.wait_for_timeout(250); pg.screenshot(path=f"{OUT}/{dev}-{name}.png")
        pg.goto(URL); pg.wait_for_timeout(400)
        # 1. Setup with advanced weapons
        pg.check("#mode-advanced")
        for sq in ("b2", "d4"): pg.fill("#place-input", sq); pg.click("#place-form button")
        pg.click("#rotate")
        for sq in ("a10", "f13", "h3"): pg.fill("#place-input", sq); pg.click("#place-form button")
        for sq in ("b3", "b5"): pg.fill("#place-input", sq); pg.click("#place-form button")
        shot("03-setup", "#setup")
        # 2. Battle: a squadron search, a strike, and some shots
        pg.click("#start"); pg.wait_for_timeout(200)
        import random; random.seed(7)
        pg.select_option("#weapon", "sq1"); fire(pg, "e7")
        msg = pg.inner_text("#status")
        import re
        m = re.search(r"choose ([A-J]\d+)", msg)
        if m: fire(pg, m.group(1))
        pg.select_option("#weapon", "shot")
        squares = [f"{r}{c}" for r in "ABCDEFGHIJ" for c in range(1, 15)]
        random.shuffle(squares)
        n = 0
        for sq in squares:
            if n >= 14 or not pg.is_hidden("#over"): break
            if "isn't your turn" in pg.inner_text("#status"): continue
            fire(pg, sq); n += 1
        shot("01-battle")
        # 3. Weapons menu with an advanced weapon ready (whichever ship is still afloat to carry it)
        opts = pg.eval_on_selector_all("#weapon option", "o => o.map(x => x.value)")
        pg.select_option("#weapon", next(w for w in ("harpoon", "torpedo", "tomahawk", "sonar", "aa") if w in opts))
        shot("02-weapons", "#enemy-section")
        # 4. Your fleet and fleet status
        pg.click("#status-btn"); pg.wait_for_timeout(200)
        shot("04-fleet", "#player-section")
        # 5. Battle log
        shot("05-log", "#fleet-status")
        assert pg.is_hidden("#over"), "the game ended before the pictures were taken"
        print(dev, "errors:", errs)
        ctx.close()
    b.close()
