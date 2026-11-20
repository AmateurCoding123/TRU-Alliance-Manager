# TRU Alliance Manager

Alliance management site for TRU, Kingdom 2443. It runs on Cloudflare Pages,
uses Pages Functions for its API and a D1 database for storage. Live alliance
data comes from the MightPulse worker.

## What's where

| Path | What it does |
| --- | --- |
| `index.html` | The whole app: dashboard, members, events, Castle Battle, leadership tools |
| `power.html` | Power growth table (leaders only). `?alliance=academy` shows the academy |
| `power-academy.html` | Redirect to `power.html?alliance=academy`, kept for old links |
| `sw.js`, `manifest.webmanifest`, `icon-*.png` | Lets members install the site as an app |
| `functions/api/admin.js` | Leadership login and logout |
| `functions/api/events.js` | Events and sign-ups (members sign up with the alliance PIN, only leaders cancel) |
| `functions/api/attendance.js` | Attendance log (leaders only) |
| `functions/api/announcements.js` | Dashboard announcements: leaders post, everyone reads them in their own language |
| `functions/_lib/translate.js` | Shared Workers AI translation code and the list of announcement languages |
| `functions/api/chat.js` | Leader Chat (leaders only): messages are translated English ↔ Korean with Workers AI |
| `functions/api/power.js` | Daily power snapshots and growth (leaders only) |
| `functions/_lib/shared.js` | Shared API code: leadership-login check, MightPulse address and fetch, name matching |
| `functions/_lib/power.js` | Power snapshot code shared by `/api/power` and `/api/snapshot` |
| `functions/api/snapshot.js` | Saves today's power for both alliances; called by the daily Worker |
| `cron-worker/` | Separate scheduled Worker (`tru-daily-snapshot`) that calls `/api/snapshot` twice a day |
| `schema.sql` | Every database table |

## Cloudflare settings

- **D1 binding:** `DB`
- **Workers AI binding:** `AI`, used by Leader Chat and Announcements to translate messages. Add it under
  the Pages project's Settings → Bindings → Add → Workers AI, variable name `AI`, then
  redeploy. Without it the chat still works, but messages aren't translated.
- **Secret:** `ADMIN_PASSWORD`, the shared leadership password
- **Secret:** `MEMBER_PIN`, the alliance PIN members enter to sign up for events.
  Members are asked for it once per device. Logged-in leaders don't need it.
  If it isn't set, sign-ups work without a PIN.
- **Secret:** `SNAPSHOT_KEY`, a long random key. The same value goes on the
  `tru-daily-snapshot` Worker, so only that Worker can take the daily snapshot.

## Announcements

Shown at the top of the dashboard to everyone, no login needed. Leaders write an
announcement once (in any of the listed languages) and post it. Each member sees it
in their phone's language automatically, or picks another from the 🌐 menu, and
can tap "Original" to see the leader's own wording. Translations are made with
Workers AI and saved: English, Korean, German, French, Portuguese and Spanish
straight after posting, other languages the first time someone reads them. The
latest 10 announcements are shown; leaders can delete any of them.

Each translation is checked before it is saved: no sentences left in the original
language and no letters from an unrelated alphabet. If a model's answer fails, the
next model in the list is tried, and the answer with the fewest problems is kept.
Leaders can tap "↻ Redo translations" to throw away an announcement's saved
translations and make them again from the original.

## Leader Chat

A tab for logged-in leaders. Each leader sets their name and reading language
(English or 한국어) once per device. They write in their own language; the server
detects English or Korean, translates it to the other with Workers AI, and saves
both. Everyone reads every message in their own language and can tap
"Show original" to see what was actually typed. The page checks for new messages
every 4 seconds while the tab is open.

## Daily power snapshot

`cron-worker/worker.js` is a separate Worker, not part of the Pages site. It runs
at 12:17 and 23:47 UTC and calls `/api/snapshot`. To set it up in the dashboard:
create a Worker named `tru-daily-snapshot`, paste in `worker.js`, add the
`SNAPSHOT_KEY` secret, and add the two Cron Triggers `17 12 * * *` and `47 23 * * *`.

## Setting up a new database

```
npx wrangler d1 execute <database-name> --remote --file=schema.sql
```

This is safe to run on the live database too: it only adds missing tables.
