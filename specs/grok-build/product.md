# Grok Build provider

## Problem

QuotaBar tracks Claude Code, Codex, Cursor, and Antigravity. SuperGrok / X Premium+ users running Grok Build have a live weekly credits pool (shared across Build, Chat, Imagine, Voice, and API) plus optional extra credits, but QuotaBar cannot show it.

## Goals

- Reuse `~/.grok/auth.json` (or `$GROK_HOME/auth.json`) and delegate renewal to the official CLI. Never write or log the token from QuotaBar.
- Fetch `GET https://cli-chat-proxy.grok.com/v1/billing?format=credits` with the same CLI headers Grok Build uses.
- Show the unified weekly/monthly pool used percent and reset time as the tray value and primary panel bar.
- Show `productUsage` as a composition of that same pool (not independent remaining quotas).
- Show Extra credits (`onDemandUsed` / `onDemandCap` / `prepaidBalance`) only when any value is non-zero.
- Estimate the shared pool's USD value from ccstats' durable per-inference ledger and cache-aware, long-context pricing, scaled by `creditUsagePercent`. Use the exact official period timestamps and fail closed when local pricing coverage is missing or partial.
- Wire Grok into the switcher, overview, settings trays, and per-provider tray icon.

## Non-Goals

- Calendar CostSummarySection (Today/This Week/This Month) for Grok.
- xAI Management API / prepaid API-team spend.
- grok.com gRPC-web / browser cookies / WKE.
- Interactive `grok login` orchestration or direct refresh-token requests.
- Landing-page copy.

## Behavior

1. Missing auth → disconnected, tell the user to run `grok login`.
2. A token within `GROK_AUTH_EARLY_INVALIDATION_SECS` of expiry (300 seconds by default) → run the official CLI's non-interactive `grok models` command when a saved refresh token is available, then reread and validate the selected auth record. Renewal failure → disconnected with recovery guidance.
3. 401/403 → renew the rejected auth record through the official CLI when its refresh token is available, reread that record, and retry billing once. Renewal failure or a second 401/403 → disconnected with re-login recovery text. Failed automatic renewal retains a five-minute retry cooldown; a validated renewal clears it. Manual retry can bypass the cooldown.
4. Transient OS errors reuse last-good data when present.
5. `productUsage` omitted `usagePercent` is 0 (proto3).
6. Tray and overview use the shared pool percent, not a product row.
