# GH186 follow-up: readable text in both windows

The placement fix is already merged in PR #187. This follow-up addresses the
reporter's separate small-text complaint without changing display DPI or native
tray coordinates.

## Behavior

- Display settings offer 100% (existing default), 115% and 130% text sizes.
- The setting affects tray and analysis text, persists across restart and uses
  the existing storage event path to synchronize open windows.
- Missing preferences use 100%. Malformed/unreadable preferences report the
  existing storage warning. Failed writes apply for this session with the
  existing unsaved-change warning.
- Labels wrap and content scrolls. The tray scroll area fits the native viewport;
  content measurement includes internally scrolled text so a small initial
  window can still grow. Native monitor/work-area clamping remains authoritative.
- Provider values, refreshes and OS display scale do not change with text size.

## Verification on 2026-09-27

- `npm test`: 631 tests passed, including persistence failures, both settings
  surfaces, invalid values, constrained-height growth and stable resize requests.
- `npm run build`: TypeScript and production assets passed.
- Browser preview: 340x582 and 280x400 tray settings; 760x560 and 1280x850
  analysis settings. Chinese/light and English/dark states were inspected at
  130%; 115% was changed in one window and observed in the other; reload retained
  130%. At 280x400, the scroll area ends at y=399 and the last setting is reachable.
- Browser preview has no native backend or provider account data. These checks
  establish settings layout and browser storage synchronization, not Windows
  runtime, real quota values, notifications or native webview synchronization.

## Still required for full issue acceptance

Run the native Windows matrix in [tasks.md](tasks.md), also checking 100%, 115%
and 130% text at 2K/100% and 4K/150–200%. Verify both open native windows update,
restart retains the choice, long provider values remain usable and bottom
controls remain reachable. Keep #186 open until that evidence is recorded.
