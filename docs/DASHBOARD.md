# Dashboard

A local web dashboard over the bot's SQLite database, so you (or your
trainer) can see trends, macros, and adherence without scrolling back
through WhatsApp chat history. The food log itself is still read-only here —
only the bot ever writes an entry — but in coach mode the Coach tab can
add, pause, resume, and remove clients (see below). It opens the database
file concurrently with the bot safely (SQLite's WAL mode handles that, plus
a busy-timeout so a rare write collision waits a moment instead of erroring).

## Running it

```bash
npm run dashboard
```

A plain Node HTTP server (no framework, no build step, no extra
dependencies) starts on `http://127.0.0.1:4870` by default, reading the
same `food.db` the bot writes to. Open that URL in a browser while the bot
is running.

## Views

- **Today** — kcal ring vs. target, what's left, macro bars, and entries
  grouped by meal with photo thumbnails (once an entry was logged from a
  photo).
- **Trends** — streak, days logged, protein-target hit rate and average
  intake, a daily-calories chart against your target, a calendar-style
  consistency heatmap, and weekly averages, over 7/30/90-day ranges.
- **Foods** — most-logged foods and a searchable history (latest 200).
- **Coach** — only shown when `COACH_NUMBER` is set. One row per client:
  today's kcal/protein vs. target, last log time, 7-day logging, flags like
  `No logs 2 days` or `Under protein 5/7 days`, and Pause/Resume/Remove
  buttons (Remove asks you to confirm with a second click). Select a client's
  name or row to open their Today view. Below it, an **Add a client** form
  (number, optional name, optional starting targets).
- **Export CSV** — downloads the current client's full log.

Today and Coach refresh themselves every minute while the page is open, so
new WhatsApp logs show up without a reload. A fresh install with nothing
logged yet shows a short getting-started guide instead of empty charts, and
if the dashboard server stops, the page says so and reconnects on its own
once it's back. Light and dark mode follow your system setting (the header
button overrides it).

## Coach actions (writes)

Everything above is read-only. The exceptions, only visible in coach mode:

- **Add client** — same effect as the WhatsApp `add client <number> [name]`
  command: the number can message the bot immediately, with its own log and
  targets (defaults from `.env` until you set them, either here or with
  `client <name> targets ...` on WhatsApp).
- **Pause / Resume** — temporarily blocks or unblocks a client without
  touching their data.
- **Remove** — blocks a client and drops them from the Coach roster. Their
  logged food and targets are kept (and still reachable by picking them from
  the client dropdown) — only a WhatsApp `delete client data <name> confirm`
  permanently deletes that.

These write endpoints (`POST /api/clients/add|pause|resume|remove`) require
coach mode to be on, require a JSON request body, and use the same session
cookie as the rest of the dashboard — a cross-site form or fetch can't reach
them (no CORS headers are served, and a form can't send a JSON body), so no
separate CSRF token is needed on top of that and the cookie's `SameSite=Lax`.

## Configuration

| Env var | Default | Notes |
|---|---|---|
| `DASHBOARD_HOST` | `127.0.0.1` | Bind address. Leave as-is for local-only access. |
| `DASHBOARD_PORT` | `4870` | |
| `DASHBOARD_PASSWORD` | *(none)* | **Required** once `DASHBOARD_HOST` isn't `127.0.0.1`/`localhost`. Gates a simple session cookie. |
| `DASHBOARD_DB` | `<DATA_DIR>/food.db` | Override if your SQLite file lives elsewhere (e.g. pointing at a seeded demo file). |

When bound to `127.0.0.1`, the dashboard trusts anyone who can reach that
port — i.e. you, on your own machine — and skips the login screen. The
moment you set `DASHBOARD_HOST` to anything else (your LAN IP, `0.0.0.0`, a
Tailscale address), it refuses to start unless `DASHBOARD_PASSWORD` is set,
and every request needs a valid session cookie from `/login`.

## Security notes

- **Local mode only answers to `127.0.0.1` / `localhost`.** Requests with
  any other `Host` header get a `421`, which blocks DNS-rebinding tricks
  where a web page you visit tries to read your local dashboard.
- **Login throttling.** After 10 wrong passwords from one address within
  15 minutes, that address is locked out of `/login` until the window ends.
- **Hardened responses.** Every response sends a strict
  `Content-Security-Policy` (same-origin scripts only), `X-Frame-Options:
  DENY` so no other site can frame the Coach buttons, `nosniff`, and
  `Referrer-Policy: no-referrer`.
- **Sessions** live in memory and last 30 days; restarting the dashboard
  logs everyone out. The cookie is `HttpOnly` and `SameSite=Lax`.
- **Who sees what.** The dashboard is for whoever runs the bot. In coach
  mode that's the coach, who can see every client's log; clients
  themselves never get dashboard access, so don't share the password with
  them. Photo URLs are checked against the client they belong to.

It never logs what anyone ate — only ordinary HTTP access, same as whatever
logging your process manager already does for the bot itself.

## Opening it on your phone

The dashboard is a normal web page — your phone just needs to reach the
same host and port the server is listening on. Three options, in order of
how much setup they need:

### 1. Same Wi-Fi (quickest, least secure)

1. Find your computer's LAN IP (System Settings → Wi-Fi → Details on a Mac,
   or `ipconfig` / `ip addr` elsewhere).
2. In `.env`, set `DASHBOARD_HOST=0.0.0.0` and pick a
   `DASHBOARD_PASSWORD`, then restart `npm run dashboard`.
3. On your phone, while on the **same Wi-Fi network**, open
   `http://<that-ip>:4870` and log in with the password.

Anyone else on that Wi-Fi could also try that IP, so only do this on a
network you trust (home, not a cafe).

### 2. Tailscale (recommended)

[Tailscale](https://tailscale.com) is free for personal use. It gives your
computer and phone private addresses that only talk to each other, with no
port forwarding and no public exposure.

1. Install Tailscale on your computer and sign in.
2. Install the Tailscale app on your phone and sign in with the **same
   account**.
3. On your computer, run `tailscale ip -4` to get its Tailscale address
   (looks like `100.x.y.z`), or use the MagicDNS name Tailscale assigned it.
4. In `.env`, set `DASHBOARD_HOST=0.0.0.0` and a `DASHBOARD_PASSWORD`
   (keep the password even on Tailscale — defense in depth).
5. On your phone, open `http://<tailscale-ip-or-name>:4870`. This works
   the same at home or out, as long as both devices are signed into
   Tailscale.

Use this one if you want the dashboard to just work wherever you are,
without exposing anything to the open internet.

### 3. A real public URL (only if someone outside your own devices needs access)

If you need a link you can send to someone else's phone, put a
[Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)
in front of it **with Cloudflare Access enabled** — never expose it
publicly with just the dashboard password:

1. Run `cloudflared tunnel` pointed at `http://127.0.0.1:4870` to get a
   public hostname.
2. In the Cloudflare Zero Trust dashboard, add an **Access policy** on that
   hostname requiring a specific email (yours, or your trainer's) to sign
   in before the request ever reaches your server.
3. Keep `DASHBOARD_PASSWORD` set too — Access is the real gate; the
   dashboard password is a second layer, not a replacement for one.

A single password, even with login throttling, sitting directly on the
open internet is not enough on its own. Always put a proper auth layer (Access,
or equivalent) in front before exposing this beyond devices you control.

## Demo data (development only)

```bash
node src/dashboard/seedDemo.js ./some-temp-path/demo.db
DASHBOARD_DB=./some-temp-path/demo.db npm run dashboard
```

Seeds a fake client with several weeks of varied meals — useful for UI work
or screenshots without touching your real log. Add `--coach` to seed a
coach plus three clients with different habits instead; the script prints
the exact `ALLOWED_NUMBERS` / `COACH_NUMBER` to run it with. Never commit
the generated `.db` file.

## How it reads the data

The dashboard opens the bot's SQLite file the same way the bot does —
read-write, creating it if it doesn't exist yet (so you can add your first
clients from the dashboard before ever starting the bot, if you'd rather).
Photo thumbnails and meal grouping use the `photo_path` / `meal_type`
columns when present; on an older database without them, the dashboard
degrades gracefully — meals are grouped by time of day instead, and entries
just show no thumbnail.
