# Contributing

## Dev setup

```bash
git clone https://github.com/padisaputra/whatsapp-food-logger.git
cd whatsapp-food-logger
npm install
npm test
```

No `.env` or WhatsApp link is needed to run the test suite — it uses a
stubbed Claude CLI and an in-memory/temp SQLite database. If you want to run
the bot itself, see [docs/SETUP.md](docs/SETUP.md).

## Making a change

- Keep changes focused; unrelated reformatting makes a PR harder to review.
- Add or update tests for any behavior change (`node --test`, see
  [docs/SETUP.md](docs/SETUP.md#tests)). `npm test` must pass before you open
  a PR — CI runs it on Node 22 and 24.
- Match the existing code style (plain ESM, no build step, no extra
  dependencies unless there's a good reason).
- Update the relevant doc (`README.md`, `docs/`) if you change user-facing
  behavior, and add a line to `CHANGELOG.md` under an "Unreleased" heading.

## Opening a PR

- One logical change per PR. Describe what changed and why in the
  description, not just what.
- Link any related issue.
- Double-check you haven't added real phone numbers, personal data, or
  `.env`/`auth/`/`data/` contents anywhere in the diff.

## Reporting bugs / requesting features

Use the issue templates. For anything security-sensitive, see
[SECURITY.md](SECURITY.md) instead of a public issue.
