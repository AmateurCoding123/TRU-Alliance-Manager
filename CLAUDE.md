# Notes for Claude

## Merging
- The owner has given standing permission to merge changes straight into `main`
  once they are tested. No need to ask first each time.
- Still ask first before anything big or risky: deleting data, changing the
  database structure in a way that loses data, or changing how logins work.
- `main` is what the live site (tru-alliance-manager.pages.dev) deploys from.

## Project
- Cloudflare Pages site with Pages Functions (`functions/api/`) and a D1
  database bound as `DB`. See README.md for what each file does.
- Secrets set in Cloudflare (never put their values in the code):
  `ADMIN_PASSWORD` (leadership login), `MEMBER_PIN` (alliance sign-up PIN) and
  `SNAPSHOT_KEY` (shared with the `tru-daily-snapshot` Worker in `cron-worker/`).
- Every table is listed in `schema.sql`; keep it up to date when adding tables.
- Messages that tell members who to ask should name **Gassed**.
- There is no build step or test suite. Check changes in Chromium with
  Playwright and fake the `/api/*` and MightPulse responses.
