# Keep CrossX MVP running (even when screen is locked)

This project uses **launchd user agent** on macOS (no sudo).

## Install / start

```bash
cd "/Users/kwok/Documents/New project"

npm run build
npm run launchd:install
```

`launchd:install` now runs the production security preflight first and aborts on missing required env.

After install, open:

- http://127.0.0.1:8787

## Stop

```bash
cd "/Users/kwok/Documents/New project"
npm run launchd:uninstall
```

## Logs

```bash
tail -n 200 "/Users/kwok/Documents/New project/data/launchd.out.log"

tail -n 200 "/Users/kwok/Documents/New project/data/launchd.err.log"
```

## Health check

```bash
curl -s http://127.0.0.1:8787/api/health
```

## Public entry without touching local tests

Keep `8787` as the local test instance, and use a separate public lane on `8792`.

Before exposing a public lane, set these env vars in `.env.local` or launchd:

- `NODE_ENV=production`
- `FORCE_HTTPS=1`
- `PUBLIC_MODE=1`
- `APP_BASE_URL=https://your-domain.com`
- `ADMIN_ALLOWED_IPS=...`
- `ADMIN_SECRET_KEY=...`
- `MERCHANT_AUTH_SECRET=...`
- `USER_TOKEN_SECRET=...`
- `MERCHANT_BOOTSTRAP_PASSWORD=...`
- `CROSSX_DB_ENCRYPTION_KEY=...`
- `CROSSX_FIELD_ENC_SALT=...`
- `CROSSX_CONSENT_STRICT=1`

If these are incomplete, the runtime security guard will fail startup intentionally.

Preflight the current env before install/start:

```bash
cd "/Users/kwok/Documents/New project"
npm run security:preflight
```

Fail on warnings too when validating a production candidate:

```bash
cd "/Users/kwok/Documents/New project"
npm run security:preflight:strict
```

`public:install`, `tunnel:install`, and `launchd:install` now run this preflight automatically before writing plist files or restarting agents.

Install the public app agent only when port `8792` is free:

```bash
cd "/Users/kwok/Documents/New project"
PUBLIC_PORT=8792 npm run public:install
```

Install the public tunnel agent:

```bash
cd "/Users/kwok/Documents/New project"
PUBLIC_PORT=8792 npm run tunnel:install
```

Check status and fetch the current public URL:

```bash
cd "/Users/kwok/Documents/New project"
PUBLIC_PORT=8792 npm run public:status
```

Stop them:

```bash
cd "/Users/kwok/Documents/New project"
npm run tunnel:uninstall
npm run public:uninstall
```

Notes:

- `public:install` refuses to replace an already-running listener on `8792`; this avoids interrupting the live lane.
- If `CLOUDFLARE_TUNNEL_TOKEN` is present, the tunnel agent runs a remotely managed tunnel for a stable hostname.
- If `CLOUDFLARE_TUNNEL_TOKEN` is missing, the tunnel agent falls back to a Cloudflare quick tunnel and writes the random `trycloudflare.com` URL into `data/cloudflared.out.log`.
- Cloudflare documents quick tunnels as test-only and notes that they do not support SSE. CrossX chat streaming should therefore use a named tunnel before external production use.

## v0.2 demo paths

Open these URLs directly to auto-run state-machine demos:

- normal path (ask/plan/confirm/execute/completed):
  - `http://127.0.0.1:8787/?demo=normal`
- fail + auto-replan path:
  - `http://127.0.0.1:8787/?demo=fail`
- voice-interrupt style path:
  - `http://127.0.0.1:8787/?demo=voice`

Or run from browser console:

```js
await window.CrossXAgentDebug.runDemoPath("normal");
await window.CrossXAgentDebug.runDemoPath("fail");
await window.CrossXAgentDebug.runDemoPath("voice");
```

## Notes

- Runtime data is persisted to:
  - `/Users/kwok/Documents/New project/data/db.json`
- To enable Gaode live data in launchd mode:
  - edit `/Users/kwok/Documents/New project/scripts/crossx-agent.plist.template`
  - add `GAODE_KEY` under `<key>EnvironmentVariables</key>`
  - reinstall with `npm run launchd:install`
- To enable ChatGPT smart reply in launchd mode:
  - edit `/Users/kwok/Documents/New project/scripts/crossx-agent.plist.template`
  - add `OPENAI_API_KEY` (optional: `OPENAI_MODEL`, `OPENAI_BASE_URL`, `OPENAI_TIMEOUT_MS`)
  - reinstall with `npm run launchd:install`
- Launchd installer now auto-injects these vars from current shell env or `.env.local` / `.env`:
  - `OPENAI_API_KEY` / `OPENAI_KEY` / `CHATGPT_API_KEY`
  - `OPENAI_MODEL` / `OPENAI_CHAT_MODEL`
  - `OPENAI_BASE_URL`, `OPENAI_TIMEOUT_MS`
- To enable Partner Hub external candidates (Meituan/Ctrip via your gateway):
  - edit `/Users/kwok/Documents/New project/scripts/crossx-agent.plist.template`
  - add `PARTNER_HUB_KEY` and `PARTNER_HUB_BASE_URL`
  - optional: `PARTNER_HUB_PROVIDER`, `PARTNER_HUB_CHANNELS`, `PARTNER_HUB_TIMEOUT_MS`
  - or configure rail separately with `RAIL_KEY`, `RAIL_BASE_URL`, optional `RAIL_PROVIDER`, `RAIL_CHANNELS`, `RAIL_TIMEOUT_MS`
  - reinstall with `npm run launchd:install`
- If port 8787 is occupied, edit:
  - `/Users/kwok/Documents/New project/scripts/crossx-agent.plist.template`
  - change `PORT` and reinstall with `npm run launchd:install`
