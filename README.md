# Advanced Battleship

A screen-reader-accessible Battleship game on a 10 × 14 grid, played in the browser against a computer opponent.

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

- **Attack squadrons (2, on the carrier):** fly anywhere on the enemy grid and search an X pattern (square plus four diagonals) or a plus pattern (square plus four beside it). The searcher learns which squares hold a ship; the defender learns the pattern and which of their ships were seen, but not the squadron's square. A squadron's first sighting of an unhit ship square lets it strike one spotted square immediately (or pass, which uses up the strike). A squadron still on deck dies if its carrier square is hit.
- **Antiaircraft battery:** fire at a square of your own grid; downs any enemy squadron flying there. Unlimited.
- **Tomahawk (1, battleship):** hits the chosen square and the eight around it.
- **Harpoons (2, cruiser):** three squares in a horizontal or vertical line centered on the chosen square.
- **Torpedoes (2, sub):** horizontal ones run along a row from column 1, vertical ones down a column from row A, stopping at the first ship that isn't sunk (wrecks are passed over). Squares passed are marked clear.
- **Sonar (sub, unlimited):** scans a 3 × 3 area and reports "enemy ship detected" or "confirmed clear waters."

A ship's weapons are lost when it sinks. Every action takes the turn.

## Keys

- Arrow keys move around a grid; Home/End go along a row; Page Up/Page Down go along a column; Ctrl+Home goes to A1.
- Type a square to jump to it, like `C` `7` or `J` `1` `4`.
- Enter or Space places a ship or fires.
- Setup: `R` rotates. Choosing a placed ship picks it back up.
- Battle: `S` reads fleet status, `L` repeats the last message. There's also a "Fire at" box.
- Advanced: `W` / `Shift+W` change weapon, `R` switches pattern or direction, `Escape` skips a squadron strike. The antiaircraft battery fires from your own fleet grid.

## Files

- `js/engine.js` holds the rules and the computer opponent, with no screen code.
- `js/ui.js` holds the grids, keyboard handling and announcements.
