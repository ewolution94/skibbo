# Skibbo

Our own take on the stock-pile card game for the afternoon meeting, alone against bots or at a table
with friends, at <https://skibbo.ewolution.cloud>. Every card is an enamel house-number plate on a
lime-washed wall: white numerals on Enzian blue (1 to 4), fir green (5 to 8) or fuchsia (9 to 12), the
Joker in all three. Laid out for the tablet first, with a layout of its own on the phone. German
first, English beside it. Barlow Semi Condensed. Part of the ewolution family (Würfle, Stammtisch,
Stichle and CDNMS are its siblings).

The name is the app's own; the game's trademarked name never appears, and the wild card is called
the Joker.

## How it works

- **Alone:** the rules and the bots run in the page (`server/rules.mjs` and `server/bots.mjs` are
  plain ESM the page imports as they are), so a game alone needs no server and plays offline once the
  service worker has the page. One to five bots, in three ranks; with three or five of them, teams of
  two. The game is kept on the device as it goes (`skibbo:solo`); finished games go into a small
  record (`skibbo:record`, games played and won) the start page shows.
- **With friends:** a table with a four-letter code (rooms in memory, `server/rooms.mjs`), a lobby
  with the order of play, two to six at the table and anyone else watching, bots in three ranks to
  fill seats. The host picks the game's length (one round, or to 500), the stock (30 cards, 20 from
  five players; or 10, 20, 30), teams of two with four or six, the clock and the bots' rank. One
  Server-Sent Events stream per page carries the room (`server/api.mjs`), and each page's view is the
  rules' view for its own seat: no stream carries another player's hand, a stock card below the top,
  or the draw pile. Moves are JSON posts.
- **The table** (`src/components/Table.svelte`) is drawn at one size per layout and scaled to the
  window:
  - an iPad on its side (1180 × 820), the main one: the others along the top, each with their stock
    and four discard piles fanned; the four piles in the middle, a row of twelve pips under each that
    fills blue, green and fuchsia as it climbs, the draw pile and the cleared piles beside them; your
    stock, your four discard piles and your hand of five along the bottom;
  - upright (820 × 1180): the same, the hand in its own row;
  - a phone (390 wide, under 700 px): the others' tops only, the piles taking the screen's spare
    height, the hand at the thumb.

  A laptop or a big screen gets the sideways table as large as the window allows (Settings → Table
  size: the whole window, 90 % or 80 %). Nothing changes height while you play.
- **Playing:** drag a plate from your hand, your stock or the top of a discard pile onto a pile, or
  tap it (it lifts; the piles it fits light up, Settings → "Show where it fits") and tap the pile.
  A card from your hand onto one of your discard piles ends the turn after the ✓ beside it. Every move
  shows at once and flies where it goes (`src/lib/table.ts` lays your moves over the server's state
  until it answers); the others' moves fly the same way from their side of the table, one after
  another. The hand keeps its five places: nothing slides when a card leaves. On a computer: 1 to 5
  pick a card from the hand, Space the stock, Q W E R your discard piles, A S D F the piles, Enter
  the ✓, Escape lets go.
- **The page holds still while playing:** the document doesn't scroll or bounce, and a touchmove on
  the table is claimed (iOS otherwise pulls the whole page; Würfle's finding).
- **The clock** (off, 60 s or 25 s a move): when it runs out, a bot plays the rest of the turn.
  Someone who closed the page has their turn played after 12 s.

## The rules

Checked against the publisher's leaflets of 1980/81, 1999, 2003, 2009 and 2011 and the German
Spielanleitung of 2003 (`development/plans/skibbo.md`):

- 162 cards: twelve each of 1 to 12 and 18 Jokers. Two to six players.
- Everyone gets a stock, its top card face up: 30 cards with two to four players, 20 with five or six
  (10 for a short game). Four discard piles each; no hand until your first turn.
- A turn: draw up to five. Play onto the four shared piles in order from 1 to 12, from your hand, your
  stock's top card or the top of any of your discard piles; a Joker counts as whatever comes next. An
  empty pile takes a 1 or a Joker; a pile that reaches 12 is set aside and its place is empty again;
  the set-aside piles are shuffled into a new draw pile when the draw pile runs out. Empty your hand
  mid-turn and you draw five more at once. End the turn by laying one card from your hand on one of
  your discard piles. Playing your stock card is never forced.
- Whoever plays the last card of their stock wins the round: 25 points, and 5 for every card left in
  the others' stocks. One round decides the game, or rounds go on until someone has 500.
- Teams (four or six players, partners opposite): on your turn you may also play from your partner's
  stock and discard piles, never discard onto them; a team wins once both its stocks are empty.
- Not in any leaflet, decided here: a seat with an empty hand and no play passes, and so does one that
  ends its turn without having played; once every seat in a row has passed, the round ends without a
  winner (it happens in about 3 % of four-player games with 30-card stocks, never seen with 10).

## Run it

Node 24, no other runtime.

```
npm install
npm run dev          # the page and the game server on one port (6810), with hot reload
npm test             # the unit tests: the rules, the bots and the rooms on fixed deals (CI runs these)
npm run test:sim     # the simulated games: whole games by bots and random players, honesty, the bots' timing and ranks (local only)
npm run check        # svelte-check
npm run build && npm start -- --port 6811    # the production server with the built page
node tools/ladder.mjs 400                    # the bots' ranks against each other
```

## Deploy (NAS)

This mirrors Würfle and Stammtisch:

- `ci.yml` runs the typecheck, the unit tests and the build, then smoke-tests the production server: the
  page and its headers, a table with a guest and a bot, each page's own hand and no other, a move
  refused out of turn and a discard taken.
- `docker-publish.yml` gates on `ci.yml`, then pushes `ghcr.io/ewolution94/skibbo:latest` for
  amd64 and arm64.
- The shared Watchtower picks the image up. A push to `release` is the whole deploy, and it ends any
  table in progress (games alone carry on in their pages).
- The NAS runs `deploy/portainer-stack.yml`, on the port the workspace's registry holds for it, with
  the health check in Skibbo's slot (every 775 s, `plans/nas-load.md`).
- The stack joins the external Docker network `ewolution`, where Census listens as `census:4901`.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` / `--port` | `8080` | Listen port |
| `HOST` | `0.0.0.0` | Listen address |
| `SKIBBO_CENSUS` | off | Census's ingest origin, `http://census:4901` on the NAS |
| `SKIBBO_MASTER_MS` | `150` | The master bot's time per decision (for the ladder) |

## Project layout

```
server/
  server.mjs     the production server: /healthz, the API, the built page, the Census forwarder
  api.mjs        the rooms over HTTP and SSE
  rooms.mjs      tables with a code, seats, the host, bots, the clock, rounds
  rules.mjs      the game as a pure state machine, with each seat's view (also run by the page alone)
  bots.mjs       the three ranks, reading only their own seat's view
  census.mjs     forwards /_e and /_e.js to Census
src/
  App.svelte     the routes: the start, /solo, /KXPT
  components/    Home, Join, Lobby, Game (a room), SoloGame, Table, Plate, RoundEnd, Final, Settings, Guide …
  lib/table.ts   what fits where, the hand's places, your moves shown before the server answers
  lib/match.ts   what the table shows (a MatchView) and asks (a Driver), for a room or a game alone
  lib/solo.svelte.ts   a game alone in the page; lib/remote.ts the room's driver
tests/           *.test.mjs the unit tests (CI); *.sim.mjs the simulated games (`npm run test:sim`)
tools/           ladder.mjs, qa.mjs, text-audit.mjs
vendor/ewo/      Folio's tokens and elements (`npm run vendor -- skibbo` in folio); don't edit here
```
