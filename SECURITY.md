# Security

## Reporting a vulnerability

Please use GitHub's private reporting instead of a public issue: open this
repo's **Security** tab → **Report a vulnerability**. That opens a private
advisory only you and the maintainer can see, so it doesn't get exposed
before a fix ships.

If you can't use that for some reason, a regular issue is fine for anything
that isn't immediately exploitable, just avoid pasting real phone numbers,
tokens, or `.env` contents into it.

## What data stays local

This bot is self-hosted and doesn't call out to any third-party service for
your data:

- The food log (SQLite), logged meal photos, and your WhatsApp session are
  all stored on your own machine, under `./data/` and `./auth/` (both
  gitignored, never committed).
- Food/photo analysis runs through your own Claude Code CLI login, under
  your own Anthropic subscription, not a separate hosted API this project
  controls.
- The only network connections this bot makes are to WhatsApp's servers (via
  [Baileys](https://github.com/WhiskeySockets/Baileys), the same way WhatsApp
  Web connects) and to the Claude CLI's own backend. Nothing else.
- See [Privacy](README.md#privacy) in the README for the full rundown.

## Scope

This is a self-hosted personal/small-trainer tool, not a hosted service.
"Vulnerability" here mainly means: a bug that could leak one client's data to
another, let an unauthorized number use the bot, or execute something it
shouldn't when handling a message, photo, or filename. Dependency
vulnerabilities are also welcome; run `npm audit` first to check if it's
already known.
