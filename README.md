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
| `functions/api/events.js` | Events and sign-ups (anyone signs up, only leaders cancel) |
| `functions/api/attendance.js` | Attendance log (leaders only) |
| `functions/api/power.js` | Daily power snapshots and growth (leaders only) |
| `schema.sql` | Every database table |

## Cloudflare settings

- **D1 binding:** `DB`
- **Secret:** `ADMIN_PASSWORD`, the shared leadership password

## Setting up a new database

```
npx wrangler d1 execute <database-name> --remote --file=schema.sql
```

This is safe to run on the live database too: it only adds missing tables.
