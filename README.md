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

## Keys

- Arrow keys move around a grid; Home/End go along a row; Page Up/Page Down go along a column; Ctrl+Home goes to A1.
- Type a square to jump to it, like `C` `7` or `J` `1` `4`.
- Enter or Space places a ship or fires.
- Setup: `R` rotates. Choosing a placed ship picks it back up.
- Battle: `S` reads fleet status, `L` repeats the last message. There's also a "Fire at" box.

## Files

- `js/engine.js` holds the rules and the computer opponent, with no screen code.
- `js/ui.js` holds the grids, keyboard handling and announcements.
