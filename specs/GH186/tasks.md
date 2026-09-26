# GH-186 Tasks: Tray popover placement

- [x] `SP186-T1` Extract pure popover placement with work area, per-monitor scale and scaled gap.
- [x] `SP186-T2` Route tray click, reopen and content resize through one `apply_popover_layout`.
- [x] `SP186-T3` Unit tests for 1366×768 … 5120×2880 at 100%–200%, all taskbar edges, negative-origin monitor, auto-hide, invalid scale.
- [x] `SP186-T5` Disable the Windows tray native shadow during setup so hidden non-client insets cannot invalidate the computed frame; propagate setup failures.
- [ ] `SP186-T4` Manual Windows check, record results in the issue:
  - [ ] 1080p 100%, bottom taskbar — open, switch providers (height changes), reopen.
  - [ ] 2560×1440 100% (issue reporter's setup).
  - [ ] 3840×2160 150% and 200%.
  - [ ] Laptop 100% + external 4K 200%: tray on each monitor in turn.
  - [ ] Taskbar on left, right and top; auto-hide on.
  - [ ] Windows 10/11: confirm the tray has no native shadow/border and remains inside the work area; the analysis window retains its normal frame.
  - Pass: gap to the icon looks identical everywhere, popover never overlaps the taskbar, no jump after it opens.
