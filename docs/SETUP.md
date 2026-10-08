# Setup

Full install, linking, 24/7 running, and relinking steps. See the
[README quick start](../README.md#quick-start) for the condensed version.

## 1. Install the Claude Code CLI and log in

Follow the instructions at [claude.com/claude-code](https://claude.com/claude-code)
to install it. Once installed, open a terminal and run:

```bash
claude
```

Follow the prompts to log in with your Claude Pro or Max account. Once you
see a prompt inside Claude Code, type `/exit` (or press Ctrl+C twice) to
close it, you don't need to use it directly, just log in once. The
food-logger bot reuses this same login every time it runs.

## 2. Download and install the bot

```bash
git clone https://github.com/padisaputra/whatsapp-food-logger.git
cd whatsapp-food-logger
npm install
```

(`npm install` downloads the bot's dependencies, it takes a minute or two.)

## 3. Run the setup wizard

```bash
npm run setup
```

This asks you a few questions and sets everything up:

1. Checks your Node version and confirms the Claude CLI is installed and
   logged in (if not, it tells you exactly what to run).
2. Asks for the WhatsApp number(s) allowed to use the bot. Add one number for
   yourself, or several if you're a trainer running this for multiple
   clients. This list is only the initial/bootstrap roster, once the bot is
   running you can add, pause, or remove clients from WhatsApp or the
   dashboard without editing `.env` again.
3. Asks for your timezone (so "today" means midnight-to-midnight in the
   right place).
4. If you entered more than one number, asks whether to turn on **coach
   mode**, one of those numbers becomes the admin and can run the coach
   commands (`add client`, `clients`, `coach summary`, and more, see
   [docs/COMMANDS.md](COMMANDS.md)). If coach mode is on, it then offers to
   add your first client(s) by number right there in the terminal.
5. Asks for your daily calorie/protein/carb/fat targets, either type them in
   directly, or let it compute them from your weight, height, age, and goal
   (cut / maintain / bulk).
6. Asks for the bot's own WhatsApp number — the one it will link as a
   device. Use a spare number, not your main one (see the
   [WhatsApp ToS caveat](../README.md#whatsapp-tos-caveat)).
7. Writes all of this into a `.env` file so you never have to touch it by
   hand.
8. Walks straight into linking WhatsApp (see the next step), you don't need
   to run anything else.

A coach whose clients save numbers without a country code (e.g. a local
`0812...` format) can set `DEFAULT_COUNTRY_CODE` in `.env` so `add client
0812...` expands automatically instead of being rejected.

## 4. Link WhatsApp

Right after the questions, the wizard requests an 8-character pairing code
for the number you gave it and prints it in the terminal. On the phone with
that number:
1. Open WhatsApp.
2. Go to **Settings → Linked Devices → Link a Device → Link with phone
   number instead**.
3. Type in the code shown in the terminal.

The code is valid for about a minute. If it expires before you finish typing
it in, the wizard automatically requests a fresh one and prints that
instead, no need to re-run anything.

Once linked, the terminal prints a confirmation and exits. Your WhatsApp
session is saved locally under `./auth/` so you only do this once, it
survives restarts.

## 5. Start the bot

```bash
npm start
```

Leave this running. Text the bot from one of your allowed numbers to try it,
send a photo of a meal, or type something like `200g chicken breast, 150g
rice`. Stop it anytime with Ctrl+C.

## Running it 24/7

Leaving a terminal window open works, but it stops the moment you close the
terminal or restart your computer. For a trainer relying on this daily, pick
one of these:

### Option A: pm2 (works on Mac or PC, simplest)

```bash
npm install -g pm2
pm2 start src/index.js --name food-logger
pm2 save
pm2 startup   # prints one command to run so pm2 (and the bot) survive a reboot
```

Useful pm2 commands afterwards: `pm2 logs food-logger` (see what it's doing),
`pm2 restart food-logger`, `pm2 stop food-logger`.

### Option B: launchd (Mac, starts automatically on login/boot)

Create `~/Library/LaunchAgents/com.whatsapp-food-logger.plist` (replace
`/path/to/whatsapp-food-logger` with where you cloned it, and check
`which node` for the exact node path):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.whatsapp-food-logger</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>/path/to/whatsapp-food-logger/src/index.js</string>
  </array>
  <key>WorkingDirectory</key><string>/path/to/whatsapp-food-logger</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/path/to/whatsapp-food-logger/bot.log</string>
  <key>StandardErrorPath</key><string>/path/to/whatsapp-food-logger/bot.log</string>
</dict>
</plist>
```

Then:

```bash
launchctl load ~/Library/LaunchAgents/com.whatsapp-food-logger.plist
```

It now starts automatically on login and restarts itself if it crashes. To
stop it: `launchctl unload ~/Library/LaunchAgents/com.whatsapp-food-logger.plist`.

### Option C: systemd (Linux)

Create a systemd service that runs `node src/index.js` from this directory
with `WorkingDirectory` set and `Restart=always`, then `systemctl enable`
it. (Exact unit file depends on your distro.)

**Either way, your computer still needs to stay powered on and connected to
the internet.** Turn off sleep/screen-lock-triggered sleep in your system
settings if replies seem to stop overnight.

## Relinking, "it says I'm logged out"

If WhatsApp shows the linked device as removed, or the bot's terminal says
it was logged out, re-pair with:

```bash
npm run relink
```

This clears the old saved session and walks you through linking again with
a fresh pairing code (same as first-time setup), it'll offer to keep the
same number or let you enter a new one if you're moving the bot to a
different phone. Your food log, targets, and client roster are untouched,
only the WhatsApp connection resets.

## For developers

- **Stack:** Node.js (ES modules), [Baileys](https://github.com/WhiskeySockets/Baileys)
  for WhatsApp, `better-sqlite3` for storage, the Claude Code CLI (`claude -p`)
  as the only AI backend, no `@anthropic-ai/sdk`, no API key anywhere.
- **Code layout:** `src/whatsapp.js` (connection, allowlist, dedupe, rate
  limiting), `src/commands.js` (command parsing, food-logging fallback, and
  coach commands), `src/clients.js` (client registry: add/pause/resume/
  remove, number normalization, name resolution), `src/ai/claudeCli.js`
  (spawns `claude -p`, JSON-schema output, retry on bad JSON, small
  concurrency queue), `src/ai/foodExtract.js` (the food-specific prompts/
  schema on top of that), `src/food/` (SQLite CRUD, formatting, CSV),
  `src/dates.js` (timezone-aware day/week math), `src/dashboard/` (the local
  web dashboard server and queries), `scripts/setup.js` / `scripts/relink.js`
  (the wizard).
- **Database schema:** see `src/db.js` for the authoritative `CREATE TABLE`
  statements and migrations. Briefly: `entries` (one row per logged food
  item, client_id, date, time, name, grams, kcal/protein_g/carbs_g/fat_g,
  confidence, source, meal_type, photo_path, created_at), `targets`
  (per-client daily targets), `clients` (client_id, name, status, created_at,
  updated_at, the source of truth for who can message the bot),
  `processed_messages` (WhatsApp redelivery dedupe, pruned after 7 days).

### Tests

```bash
npm test
```

Runs Node's built-in test runner (`node --test`) against the parsing,
timezone math, SQLite CRUD, CSV export, the client registry, the setup
wizard's pure logic, and the full command-dispatch path, all with a stubbed
Claude CLI and an in-memory database, so no network calls or WhatsApp
connection are needed. 122 tests, all passing.

To test the real Claude CLI integration end-to-end (not mocked), make sure
you're logged in (`claude`) and run a text message and a photo through
`src/ai/foodExtract.js` directly, see the CLI wrapper in
`src/ai/claudeCli.js` for the exact flags it passes.
