# playbook-core

Shared engine for the vZNY airport Playbooks (LGA, HPN, …). For VATSIM use only.

Each airport lives in its own repository (`<icao>-playbook`). This repo holds only the parts that are the same everywhere:

| File | What it does |
|---|---|
| `core.css` | All styling: strips, Active block, tabs, pages, pop-ups, flight strips |
| `core.js` | ATIS fetch and parsing (VATSIM first, real-world D-ATIS fallback, per-airport source toggle), Test mode, tabs, Page 10 live strips (VATSIM feed, aircraft class, RNAV, exits, Common Amendments), clearance builder |

## How an airport uses it

The airport's Pages workflow checks this repo out into `core/` at publish time:

| Airport site | Core branch |
|---|---|
| `/` (airport `main`) | `main` |
| `/lab/` (airport `lab`) | `lab` |

The airport's `index.html` holds its own markup (header, Test-mode fields, pages, pop-ups) and ends with:

```html
<script src="core/core.js"></script>
<script src="airport.js"></script>
```

`airport.js` calls `Playbook.start(H => ({...}))`. `H` gives the airport the core helpers (`$`, `esc`, `parseAtis`, `windStr`, `wxStr`, `verdict`, `gateCell`, `cur`, `num`, `checked`, `pad`, `zulu`, `fmtVis`, `state`, `test`, `onTestChange`, …).

## Airport definition

| Key | Required | Meaning |
|---|---|---|
| `id` | yes | FAA id, e.g. `'LGA'` (ICAO is `'K' + id`) |
| `store` | yes | localStorage prefix, e.g. `'lgapb'` (lab adds `lab.`) |
| `airports` | yes | ATIS to read, e.g. `['LGA','JFK','EWR']` |
| `cards` | | ATIS cards drawn (default `[id]`); each needs `<article id="card-XXX">` |
| `pos` | yes | `{lat, lon}` for "on the ground" (within `groundNm`, default 3 nm) |
| `pages`, `groups` | yes | Tab list `[{id, n, r}]`; optional tab groups `[{key, ids, n, r, live(), pageN, dropN, subLabel}]` |
| `active()` | yes | Draws the Active block → `{html, ctx, pageId, liveVfr}`. `ctx` must carry `pair: {land, dep}` |
| `buildTest()`, `presets`, `applyPreset(p)` | yes | Test mode: write `H.test.atis[XXX]` from the airport's Test fields |
| `exits`, `gateFixes`, `exitRules`, `amdAirway`, `amdFix`, `sidRe` | yes | Valid Exits, gate fix lists, exit restrictions, Common Amendments, filed-SID pattern |
| `assignSid(ctx, gate, fix, cls, rnav)` | yes | Departure procedure for one aircraft → `{text, base, extra, why, climbVia}` |
| `initialAlt` | | Initial altitude (default 5,000) |
| `depFreqs` | | Departure frequency order `[{name, freq, say, ok(controller)}]`; empty = "get it from N90" |
| `depPhrase(p)`, `sidSpoken(base)`, `altNote(p)` | | Clearance wording |
| `svdFor(ctx, gate, cls)`, `vfrPrefix` | | VFR departure clearance; none = no SOP VFR wording |
| `amendRoute(ctx, fix, amd)` | | Extra route changes (LGA: DIXIE via the JFK VOR) |
| `taxiFor(x)`, `renderPages()` | | Taxi line on strips; extra page rendering (LGA taxi tables) |
| `climbWords`, `noAtisText(ap)`, `apreq`, `samples` | | ATIS climb keywords, empty-card text, APREQ destinations, sample test strips |

## Changing the core

Work on `lab`, check every airport's `/lab/` site, then promote to `main`. Airport sites pick up a core change the next time they publish.
