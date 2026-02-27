# Keep CrossX MVP running (even when screen is locked)

This project uses **launchd user agent** on macOS (no sudo).

## Install / start

```bash
cd "/Users/kwok/Documents/New project"

npm run build
npm run launchd:install
```

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
  - reinstall with `npm run launchd:install`
- If port 8787 is occupied, edit:
  - `/Users/kwok/Documents/New project/scripts/crossx-agent.plist.template`
  - change `PORT` and reinstall with `npm run launchd:install`
