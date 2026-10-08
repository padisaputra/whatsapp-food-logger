# Commands

Every message is either a command below or a food description (logged if it
looks like food, politely rejected if it doesn't, see
[docs/FAQ.md](FAQ.md#what-happens-if-i-text-something-that-isnt-food)).
Commands are case-insensitive.

## Everyone (anyone in the client roster)

### Logging food

| Message | What happens |
|---|---|
| `200g chicken breast, 150g rice` | Logs each item with estimated macros, replies with a per-item breakdown and your new daily total |
| *(a photo of a meal)* | Same, but the AI looks at the photo instead of reading text |
| *(a photo of a nutrition label or a Cal AI-style screenshot)* | Same, reading the numbers off the label/screenshot |

The first thing you ever log gets a one-line hint appended ("first one
logged...") pointing at `today`, `week`, and `help`. Every log after that is
just the breakdown and totals.

### Checking totals

| Message | What happens |
|---|---|
| `today` | Today's entries and totals vs. targets |
| `yesterday` | Same, for yesterday |
| `week` | Monday-to-today totals vs. targets, counting only days you logged something |

### Targets

| Message | What happens |
|---|---|
| `targets show` (or just `targets`) | Shows your current daily targets |
| `targets set 2200 160 220 70` | Sets kcal, protein_g, carbs_g, fat_g, in that order |

### Fixing a mistake

| Message | What happens |
|---|---|
| `undo` | Removes the most recently logged entry (today only) |
| `delete 12` | Removes entry #12 (see ids via `export`, or ask your coach to check the dashboard) |
| `edit 12 grams=250 kcal=400` | Edits one or more fields on entry #12. Valid fields: `name`, `grams`, `kcal`, `protein_g`, `carbs_g`, `fat_g`. Multiple `field=value` pairs can go in one message |

### Everything else

| Message | What happens |
|---|---|
| `export` | Sends your full log as a CSV file (all-time, every entry) |
| `help` | Lists these commands. If you're the coach/admin number, the coach commands below are appended |

## Coach / admin only

Gated to whichever number is set as `COACH_NUMBER` in `.env` (or chosen
during `npm run setup`). Anyone else gets back "that command is for the
coach account only."

### Managing clients

| Message | What happens |
|---|---|
| `add client 447700900123` | Adds a client by number. Replies with a ready-to-forward invite message containing a `wa.me` link, so the client messages the bot first |
| `add client 447700900123 Priya` | Same, with a name attached (shown everywhere as `Priya (447700900123)`) |
| `add client 447700900123 Priya --welcome` | Same, but the bot messages Priya directly with the invite instead of handing it back to you to forward |
| `clients` | Lists every active and paused client with today's kcal/protein vs. target |
| `client Priya targets 2200 160 220 70` | Sets Priya's targets (kcal, protein_g, carbs_g, fat_g), without touching your own |
| `pause client Priya` | Blocks Priya from using the bot, her data and targets are untouched |
| `resume client Priya` | Unblocks a paused client |
| `remove client Priya` | Blocks Priya and drops her from the `clients` roster. Her logged food and targets are kept, she can be re-added later with `add client` to pick up where she left off |
| `delete client data Priya` | First message: warns this is permanent and asks you to resend with `confirm` |
| `delete client data Priya confirm` | Permanently deletes Priya's entries, targets, and client record. This cannot be undone |

`<name|number>` in any of the above can be either the client's number or
their name (case-insensitive). If two clients share a name, the bot asks
you to use the number instead.

Numbers can be typed loosely: `add client +44 7700 900123 Priya` and
`add client 447700900123 Priya` both work, spaces, dashes, and a leading
`+` are all stripped. A bare local-format number (`add client 0812...`)
expands automatically using `DEFAULT_COUNTRY_CODE` from `.env`, if set.

### Coach summary

| Message | What happens |
|---|---|
| `coach summary` | Today's kcal/protein totals for every client on the roster, one line each (name if known, otherwise the number) |

For status tags (paused, etc.) and current targets alongside today's
totals, use `clients` instead — same roster, more detail per line.

The same add/pause/resume/remove actions, plus trends and adherence, are
also available visually on the [dashboard's Coach tab](DASHBOARD.md#coach-actions-writes).
