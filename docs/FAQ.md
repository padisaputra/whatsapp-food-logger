# Troubleshooting / FAQ

## Troubleshooting

**"Could not find the Claude Code CLI"**
Install it from [claude.com/claude-code](https://claude.com/claude-code),
make sure running `claude` works in a plain terminal, then try again.

**"the Claude CLI is logged out"**
Run `claude` once in a terminal and log in again (subscriptions occasionally
need re-authentication), then retry.

**The bot doesn't respond to a message**
Check the sender's number is in the client roster (`clients` command as the
coach, or `ALLOWED_NUMBERS` in `.env` for the original bootstrap list).
Every other number is silently ignored, on purpose, see
[Privacy](../README.md#privacy).

**"you're sending messages faster than I can log them"**
A safety limit (`RATE_LIMIT_PER_MINUTE` in `.env`) to stop a stuck client or
a flood of redelivered messages from spawning too many AI calls at once.
Wait a few seconds and try again, or raise the limit in `.env`.

**A photo analysis takes a while or times out**
Photos take longer than text (the CLI has to "look" at the image).
`CLAUDE_TIMEOUT_MS` in `.env` controls how long the bot waits before giving
up, raise it if your machine or connection is slow.

**WhatsApp disconnects on its own sometimes**
Normal. The bot reconnects automatically with a short backoff. If it says
it was logged out instead of just disconnected, run `npm run relink`.

**A client was added but "add client" says they already exist**
If they were previously removed (`remove client`), `add client` on the same
number reactivates them instead of erroring, their old data is still there.
If they're currently active or paused, that's a real duplicate.

**Still stuck**
Run `pm2 logs food-logger` (or check `bot.log` if you used launchd) for the
actual error, which is usually specific enough to point at the fix.

**`npm install` prints `npm warn install-scripts ...`**
Harmless. Recent npm versions block install scripts from dependencies by
default unless allow-listed; this project's native dependency
(`better-sqlite3`) ships prebuilt binaries for all common platforms, so it
works without them. Nothing to fix.

## General questions

### Can I use my main WhatsApp number?

Technically yes, but it's not recommended. This bot connects the same
unofficial way WhatsApp Web does, which can violate WhatsApp's Terms of
Service and carries some risk of the linked number being limited. A spare
SIM or secondary number keeps that risk off your main line. See the
[WhatsApp ToS caveat](../README.md#whatsapp-tos-caveat) in the README.

### How accurate are the macro estimates?

Good enough for day-to-day tracking, not lab-grade. Text with gram weights
("200g chicken breast") is the most accurate, since the AI isn't guessing
portion size. Photos are estimates, portion size and ingredient composition
are inherently approximate. Spot-check anything that looks off and use
`edit` or `delete` to correct it. This is a convenience tool, not medical or
nutritional advice.

### What happens if I text something that isn't food?

The bot checks whether your message looks like a food description before
logging anything. A greeting, a question, or random text gets a reply
pointing you at `help` instead of being logged as a (wrong) food entry.

### Can multiple people use one bot?

Yes, that's what coach mode is for. Each client in the roster gets their
own independent log and targets, see [docs/COMMANDS.md](COMMANDS.md) for
the full add/pause/resume/remove flow and the
[Dashboard guide](DASHBOARD.md) for the Coach tab.

### Does the dashboard need the bot running?

No. The dashboard opens the same SQLite file directly, it works whether or
not `npm start` is currently running, and you can even add your first
clients from the dashboard before the bot's first run.

### What if I restart my computer?

The bot and dashboard both stop until you start them again, unless you've
set one up under pm2, launchd, or systemd, see
[Running it 24/7](SETUP.md#running-it-247). Your data (`./data/`) and
WhatsApp link (`./auth/`) are untouched by a restart either way.

### Can I change someone's targets without asking them to text it themselves?

Yes, as the coach: `client <name> targets <kcal> <protein> <carbs> <fat>`
over WhatsApp, or the Coach tab on the dashboard.

### I removed a client by mistake. Can I get them back?

Yes. `remove client` only blocks access, it keeps all their logged data.
`add client <same number>` reactivates them and they pick up right where
they left off. Only `delete client data ... confirm` is permanent.
