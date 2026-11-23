# Privacy

QuotaBar has no QuotaBar account, server, analytics, or crash reporting. It
never sends credentials or usage data to the QuotaBar maintainers.

It does make network requests. Quota polling uses the credentials your existing
tools already saved and sends them to the provider that issued them. Cost
estimates are computed on your device.

## What leaves your machine

| Request | Sent to | What is sent | When |
| --- | --- | --- | --- |
| Claude quota | `api.anthropic.com` | Your Claude Code OAuth token | Each Claude poll |
| Codex quota and reset credits | `chatgpt.com` | Your Codex (ChatGPT) access token and account id | Each Codex poll |
| Cursor quota and usage events | `cursor.com` | Your Cursor session token | Each Cursor poll |
| Grok credits | `cli-chat-proxy.grok.com` | Your Grok Build access token | Each Grok poll |
| Grok renewal | `auth.x.ai`, through the official `grok` CLI | Your Grok refresh token, sent by the CLI, not by QuotaBar | Only near expiry or after a 401/403 |
| Model prices | `raw.githubusercontent.com` (LiteLLM price catalog) | No credentials or usage data; a plain download | When the local price cache is missing or old |

Each provider receives only its own credential. A request never carries another
provider's credential. Those requests are subject to each provider's own
privacy policy.

Links such as "Open console" open the provider's site in your browser. QuotaBar
does not send anything with them.

## What QuotaBar reads locally

- Claude Code credentials: the macOS Keychain entry from `claude login`, the
  Claude config directory on Windows, or `CLAUDE_CODE_OAUTH_TOKEN`.
- Codex: `$CODEX_HOME/auth.json` (default `~/.codex/auth.json`).
- Cursor: Cursor's local `state.vscdb` or `CURSOR_SESSION_TOKEN`.
- Grok Build: `$GROK_HOME/auth.json` (default `~/.grok/auth.json`).
- Usage logs of Claude Code, Codex, Cursor and Grok Build, for cost estimates and
  session titles.

QuotaBar never refreshes, writes or copies these credentials. Grok renewal is
delegated to the official `grok` CLI, which saves its own credentials.

## What QuotaBar writes locally

- Settings (theme, visible providers, notification thresholds, optional plan
  prices) and custom session names in the app's webview storage.
- Cost snapshots and recent usage-analysis reports, which include project paths
  and session titles from your local logs, in `<OS cache directory>/quotabar`
  (`~/Library/Caches/quotabar` on macOS).
- The model price cache and a local usage ledger, written by the bundled ccstats
  SDK to `<OS cache directory>/ccstats`. The ledger caches usage parsed from
  your local logs, keyed by log file path, so later scans are faster. It never
  leaves your machine.
- Diagnostic logs: `~/Library/Logs/quotabar` on macOS, or the OS cache directory
  on Windows and Linux. They include request status, a few rate-limit response
  headers and error text. Tokens are redacted and never logged.
- On macOS, the Hide Dock choice in `<OS data directory>/quotabar/dock-hidden`
  (`~/Library/Application Support/quotabar/dock-hidden`), and the position of
  each menu bar icon in the app's preferences (the `com.starlight.quotabar`
  defaults domain).
- Launch at Login, while it is turned on, as an OS login item: a LaunchAgent
  plist in `~/Library/LaunchAgents` on macOS, a value under the current user's
  `Run` registry key on Windows, or a `.desktop` file in `~/.config/autostart`
  on Linux.
- Files you export yourself (usage summaries and share cards, named
  `QuotaBar-<timestamp>.json` or `.svg`) in your Downloads folder.

Deleting the cache and log directories removes the snapshots, caches and logs
(the `ccstats` directory is shared with the ccstats CLI if you also use it).
It does not remove the rest: turn off Launch at Login before deleting the app,
then delete the `dock-hidden` file and any exports you no longer need. Settings
and menu bar positions stay in the webview storage and preferences until those
are cleared.
The credentials of your provider tools are not affected.

## Reporting

Report suspected credential exposure privately; see [SECURITY.md](SECURITY.md).
