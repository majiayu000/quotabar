# GH-19 Tasks

## Implementation Tasks

- [x] `UI19-T1` Owner: codex. Done when: GitHub issue #19 and this SpecRail packet define assets/runtime boundaries. Verify: `find specs/GH19 -maxdepth 1 -type f -print`.
- [ ] `UI19-T2` Owner: codex. Done when: required redesign preview assets are copied into stable docs/assets paths without unused export clutter. Verify: `find docs/assets -maxdepth 2 -type f -print`.
- [ ] `UI19-T3` Owner: codex. Done when: README/docs distinguish current screenshots from static mock previews and document privacy scope. Verify: docs review.
- [ ] `UI19-T4` Owner: codex. Done when: screenshot refresh steps are documented. Verify: `rg -n "screenshot|preview|capture|privacy" README.md docs`.
- [ ] `UI19-T5` Owner: codex. Done when: any runtime notification/widget expansion has explicit capability, permission, error, dedupe, and verification coverage. Verify: PR checklist if runtime code is included.
- [ ] `UI19-T6` Owner: codex. Done when: verification passes. Verify: `npm test` for docs/assets-only, or full frontend/Rust checks if runtime code is touched.

## Handoff Notes

Default implementation is docs/assets only. A real desktop widget or native notification system should be split into its own implementation PR unless the product scope is explicitly expanded.
