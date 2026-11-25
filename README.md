# Salvo Command

A screen-reader-accessible naval strategy game on a 10 × 14 grid, played in the browser or the iPhone app, against a computer opponent or a friend online. (The repository keeps its original name, Advanced-Battleship.)

Play it here: https://christopherabel3000-creator.github.io/Advanced-Battleship/

## The board

- Rows A to J, top to bottom. Columns 1 to 14, left to right.
- A1 is the top left, J1 the bottom left, A14 the top right and J14 the bottom right.

## Fleet

| Ship | Spaces |
|---|---|
| Aircraft carrier | 5 |
| Battleship | 4 |
| Light missile cruiser | 3 |
| Fast attack sub | 3 |
| Special operations craft | 2 |

Ships go horizontally (extending right) or vertically (extending down) and can't overlap.

## Weapons modes

Choose **Basic weapons** for a normal game or **Advanced weapons** before the battle. With advanced weapons, both sides get:

- **Attack squadrons (2, on the carrier):** fly anywhere on the enemy grid and search an X pattern (square plus four diagonals) or a plus pattern (square plus four beside it). The searcher learns which squares hold a ship; the defender learns the pattern and which of their ships were seen, but not the squadron's square. A squadron's first sighting of an unhit ship square makes it strike one spotted square immediately (required). A squadron still on deck dies if its carrier square is hit.
- **Antiaircraft battery:** fire at a square of your own grid; downs any enemy squadron flying there. Unlimited.
- **Tomahawk (1, battleship):** hits the chosen square and the eight around it.
- **Harpoons (2, cruiser):** three squares in a horizontal or vertical line centered on the chosen square.
- **Torpedoes (2, sub):** horizontal ones run along a row from column 1, vertical ones down a column from row A, stopping at the first ship that isn't sunk (wrecks are passed over). Squares passed are marked clear.
- **Sonar (sub, unlimited):** scans a 3 × 3 area and reports "enemy ship detected" or "confirmed clear waters."

A ship's weapons are lost when it sinks. Every action takes the turn.

## Target plus 1

An optional rule, chosen at setup, that works with either weapons mode. Any action that damages a ship (a shot, a squadron strike, or a Tomahawk, harpoon or torpedo that hits anything) or downs a squadron with antiaircraft fire earns another turn. Misses, observe-only searches, and sonar end the turn. A torpedo that runs into an already damaged section does no new damage, so it ends the turn.

## Keys

- Arrow keys move around a grid; Home/End go along a row; Page Up/Page Down go along a column; Ctrl+Home goes to A1.
- Type a square to jump to it, like `C` `7` or `J` `1` `4`.
- Enter or Space places a ship or fires.
- Setup: `R` rotates. Choosing a placed ship picks it back up.
- Battle: `S` reads fleet status, `L` repeats the last message. There's also a "Fire at" box.
- Advanced: `W` / `Shift+W` change weapon, `R` switches pattern or direction. The antiaircraft battery fires from your own fleet grid.
- On a phone: the Place at and Fire at boxes, the Weapon menu, and the Repeat last message and Fleet status buttons do everything.

## Online play

Press **Host an online game** to get a four-letter code and invite link for a friend. The host's choice of weapons and turn rules applies to both players. Games are stored in the game's own Firebase project, `salvo-command` (Realtime Database, US), under `salvoCommand/<CODE>`. The rules are in `database.rules.json` and are published in the Firebase console (Realtime Database, then Rules). Change the file and the console together.

A game record holds the rules chosen, each player's fleet, the list of actions, and a random code for each player's device. There are no names or messages. Both devices rebuild the game by replaying the actions through the rules engine, which has no randomness, so they always agree. The database rules only accept well-formed records and require every change to be exactly one version newer than the last, so a game can't be rewound or wiped. A game nobody has touched in 7 days can be deleted, which the game does when its code comes up again. Nobody can list the games; a game can only be read with its code.

A player on the website and a player in the App Store app can play each other. In the app, the invite link points at the website.

## Files

- `index.html`, `style.css` — the page
- `js/engine.js` — the rules and the computer opponent, with no screen code
- `js/ui.js` — the grids, keyboard handling, announcements and online play
- `firebase-config.js` — the settings of the Firebase project used for online play
- `vendor/firebase/` — the Firebase library (version 10.12.2), kept with the game so nothing loads from outside
- `icons/` — the website's icons
- `privacy.html`, `support.html` — the privacy policy and the support page, linked from the bottom of the game and used as the App Store's Privacy Policy URL and Support URL
- `database.rules.json` — the Firebase Realtime Database rules for online play
- `package.json`, `capacitor.config.json`, `scripts/build-www.js`, `ios/`, `.github/workflows/ios.yml` — the iPhone app (see App Store below)
- `appstore/` — the App Store listing text and screenshots. Not part of the game or the app.
- `tools/icon.html`, `tools/icon.py` — draw the app icon and launch image. `tools/screenshots.py` takes the App Store screenshots. Both run with Python and Playwright; the notes at the top of each say how.

## App Store

The App Store version wraps the same files with [Capacitor](https://capacitorjs.com). Nothing about the game changes: `scripts/build-www.js` copies the page, its script and style, the two extra pages, `firebase-config.js`, `icons/` and `vendor/` into `www/`, and `npx cap sync ios` puts them in the Xcode project in `ios/`.

There's no Mac needed: `.github/workflows/ios.yml` builds the app on GitHub's Macs. Every push that touches the game checks that it still builds; running the workflow by hand (Actions, iPhone app, Run workflow) signs it and sends it to TestFlight. Signing needs four repo secrets, listed at the top of the workflow. The app is `com.playbyear.salvocommand`.
