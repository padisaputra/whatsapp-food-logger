# Changelog

All notable changes to this project are documented here. Format loosely
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.1.0] - 2026-10-08

Pre-public-release polish: first-run experience and repo hygiene, plus one
real bug CI caught — no other behavior changes.

### Fixed

- **The stated minimum Node version (20) was wrong and would segfault.**
  `better-sqlite3@13.0.3` requires Node >=22 for its native binary; running
  on Node 20/21 crashes with SIGSEGV on first database access. Raised the
  documented and enforced minimum to Node 22 everywhere (README, setup
  wizard's version check, `package.json` `engines`, CI matrix). Caught by
  adding CI with a Node 20/22 matrix — the 20 leg segfaulted immediately.
- `docs/SETUP.md`'s test count was stale (117 vs. the current 122).

### Added

- GitHub Actions CI (Node 22 and 24, `npm ci` + `npm test` on every push and
  PR), with a live status badge in the README replacing the static count.
- `SECURITY.md` (how to report a vulnerability, what data stays local) and
  `CONTRIBUTING.md` (dev setup, test requirement, PR expectations).
- A pull request template.
- `package.json` `repository`/`bugs`/`homepage`/`keywords` fields.
- `docs/FAQ.md` now explains the harmless `npm warn install-scripts` notice
  recent npm versions print on install (prebuilt binaries cover it, nothing
  to fix).

## 1.0.0 - 2026-10-08

Initial release.

### Added

- WhatsApp food logging from text ("200g chicken breast, 150g rice") or a
  photo of a meal or nutrition label, replying with per-item macros and
  running daily totals vs. targets.
- Commands: `today`, `yesterday`, `week`, `targets show`/`set`, `undo`,
  `delete`, `edit`, `export` (CSV), `help`.
- AI backend runs entirely on the user's own Claude Code CLI login (`claude
  -p`), no API key and no metered third-party billing.
- Interactive setup wizard (`npm run setup`): checks prerequisites, asks for
  numbers/timezone/targets, writes `.env`, links WhatsApp via an 8-character
  pairing code (no QR, no camera needed).
- `npm run relink` to re-pair WhatsApp without losing data.
- Local web dashboard (`npm run dashboard`): Today, Trends (streak,
  adherence, protein-target hit rate, logging-consistency heatmap, weekly
  averages), and Foods views, plus CSV export. Optional password + Tailscale
  guidance for viewing on a phone.
- Coach mode: a client registry (`clients` SQLite table) backing
  `add client`, `clients`, `client <name> targets`, `pause client`,
  `resume client`, `remove client`, `delete client data ... confirm`, and
  `coach summary`, all usable from WhatsApp, with no `.env` edits or
  restarts. The same actions are mirrored as an Add Client form and
  Pause/Resume/Remove buttons on the dashboard's Coach tab.
- 117 automated tests (`node --test`) covering parsing, timezone math,
  SQLite CRUD, CSV export, the client registry, the setup wizard's pure
  logic, and the full command-dispatch path against a stubbed Claude CLI.

[1.1.0]: https://github.com/padisaputra/whatsapp-food-logger/releases/tag/v1.1.0
