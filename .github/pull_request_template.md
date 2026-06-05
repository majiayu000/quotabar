## Summary

- Describe the user-visible or repository-facing change.

## Verification

- [ ] `npm test`
- [ ] `npm run build`
- [ ] `cd src-tauri && cargo check`
- [ ] `cd src-tauri && cargo test`

## Scope

- [ ] No provider tokens, cookies, sessions, or secrets are committed.
- [ ] User-visible missing data fails closed or renders blank; it does not silently show zero usage.
