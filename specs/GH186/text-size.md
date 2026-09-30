# GH186 follow-up: interface size and Windows acceptance

The original PR #190 text-only control was superseded by merged PR #194 and
release v0.5.6. Keep the released **100% / 125% / 150% Interface size** setting;
do not add a second text-size preference or multiply the two scales.

The existing setting scales text and controls in the tray and analysis windows,
persists across restart and synchronizes open windows. Native monitor/work-area
clamping and the merged Windows placement fix remain authoritative. Constrained
panels scroll, and resize measurement includes internally clipped content.

## Verification scope

- Frontend tests exercise saved preferences, cross-window synchronization,
  native zoom errors, stale requests and scaled/clipped popover sizing.
- CI runs frontend, production build and locked Rust checks on macOS and Windows.
  Passing these jobs does not establish Windows native UI acceptance.
- The maintainer's [issue comment](https://github.com/majiayu000/quotabar/issues/186#issuecomment-5890254980)
  reports Windows 11 / 4K / 150% verification for v0.5.6. This maintenance session
  does not repeat or independently certify that native check.
- The original Windows 10 / 27-inch 2K case remains unconfirmed. Keep #186 open
  until the reporter confirms readability and tray positioning, including
  relevant DPI/taskbar cases in [tasks.md](tasks.md).
