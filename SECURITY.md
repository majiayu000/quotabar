# Security Policy

QuotaBar is a local desktop app. It reads provider auth state from local tools so
it can show quota and cost information, but it must not store or publish provider
tokens, cookies, sessions, or account recovery material.

## Reporting

Report security issues privately through GitHub private security advisories:

https://github.com/majiayu000/quotabar/security/advisories/new

Do not open a public issue for credential exposure, token handling bugs, or a
report that includes local auth paths or session data. Include what you found,
where it happens, and the smallest reproduction that does not disclose secrets.

## In Scope

- Unsafe handling of Claude Code, Codex, Cursor, or Antigravity auth state.
- Release artifacts that accidentally include local credentials, logs, sessions,
  or provider account identifiers.
- Tauri command, CSP, permission, opener, or notification behavior that exposes
  local data beyond the app boundary.
- UI behavior that silently converts missing or invalid quota data into fake zero
  usage.

## Out of Scope

- Third-party provider service behavior.
- Provider account recovery, billing disputes, or quota policy decisions.
- Local usage logs that are already controlled by the user's machine and are not
  copied into QuotaBar artifacts.

## Project Rules

- Never commit provider tokens, cookies, sessions, API keys, or local auth files.
- Never paste secrets into public GitHub issues, pull requests, screenshots, or
  release notes.
- Release artifacts must be built from a clean checkout and inspected before
  publication.
- QuotaBar does not manage provider login flows; users should authenticate with
  the provider tools directly.
