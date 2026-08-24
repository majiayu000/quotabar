# Grok Build provider

## Problem

QuotaBar tracks Claude Code, Codex, Cursor, and Antigravity. SuperGrok / X Premium+ users running Grok Build have a live weekly credits pool (shared across Build, Chat, Imagine, Voice, and API) plus optional extra credits, but QuotaBar cannot show it.

## Goals

- Read-only reuse of `~/.grok/auth.json` (or `$GROK_HOME/auth.json`). Never write, refresh, or log the token.
- Fetch `GET https://cli-chat-proxy.grok.com/v1/billing?format=credits` with the same CLI headers Grok Build uses.
- Show the unified weekly/monthly pool used percent and reset time as the tray value and primary panel bar.
- Show `productUsage` as a composition of that same pool (not independent remaining quotas).
- Show Extra credits (`onDemandUsed` / `onDemandCap` / `prepaidBalance`) only when any value is non-zero.
- Estimate the shared pool's API-equivalent USD/token value from local Grok usage scaled by `creditUsagePercent`. Fail closed when local usage is missing or does not match the official period.
- Wire Grok into the switcher, overview, settings trays, and per-provider tray icon.

## Non-Goals

- Calendar CostSummarySection (Today/This Week/This Month) for Grok.
- xAI Management API / prepaid API-team spend.
- grok.com gRPC-web / browser cookies / WKE.
- Token refresh or `grok login` orchestration.
- Landing-page copy.

## Behavior

1. Missing auth → disconnected, tell the user to run `grok login`.
2. Expired local token is not sent → disconnected, tell the user to re-login.
3. 401/403 → session expired, same recovery.
4. Transient OS errors reuse last-good data when present.
5. `productUsage` omitted `usagePercent` is 0 (proto3).
6. Tray and overview use the shared pool percent, not a product row.
