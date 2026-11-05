# macOS popover position regression

Decision: restrict overflow-to-taskbar projection to Windows. Preserve native
tray anchors on macOS and Linux. Do not change UI styling or sizing.

## Evidence

- v0.7.0 introduced `taskbar_anchor` for Windows notification overflow icons,
  but `apply_popover_layout` called it on every platform.
- The pinned `tauri-runtime-wry 2.10.0/src/monitor/macos.rs` converts the visible
  frame's width/height and x inset, but omits the menu bar's y inset.
- Local NSScreen readback: main frame 1512 x 982 points, visible frame
  (0, 61, 1512, 888), scale 2. Its top inset is 33 points; Tauri reports y=0.
- A menu icon at y=0 therefore falls inside the reported work area. Before
  the fix the regression test projected its anchor to y=1776 physical pixels
  (the apparent bottom reserved strip), rather than retaining y=0.
- After the fix the same test places the popover at y=82 physical pixels:
  66-pixel icon height plus a 16-pixel gap. The popover fits the work area.
- All 17 placement tests pass, including Windows overflow, side/top taskbars,
  scale factors, resize anchoring and a negative-origin secondary monitor.

## Acceptance

- Release build completed and was signed with the existing QuotaBar Developer ID.
  Installed at `/Applications/QuotaBar.app` after stopping the previous process;
  the previous bundle was moved to Trash. Source and installed executable SHA256:
  `e181ee48263b96722394e38c2f6386b8f438406f1b99e8a748e6fb1e1bf53d95`.
- Native CGWindow readback before: x=996, y=298, width=340, height=582 points.
  After reopening via the workspace menu-bar button: x=996, y=41, width=340,
  height=582. The actual top is now 33+8 points and bottom 623 fits the display.
- Native accessibility confirms the running UI. A complete popover screenshot
  was not captured: it dismisses on focus loss during screenshot automation.
- Windows geometry is tested locally; this change has not been run on a Windows
  desktop. Live cross-monitor movement has not been tested. No remote release.
