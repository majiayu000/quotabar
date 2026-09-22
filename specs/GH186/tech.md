# GH-186 Tech Spec: Tray popover placement

Linked issue: https://github.com/majiayu000/quotabar/issues/186

## Root cause

- `position_window_near_tray` placed the window with its current physical height, then the frontend resized it through `resize_window`, which only called `set_size`. Windows anchors windows at the top-left, so the popover grew downward past the tray icon into the taskbar. The overshoot scales with DPI: 382 logical px becomes 573 px at 150% and 764 px at 200% on 4K.
- The 8 px gap was physical, so it shrank to 4 logical px at 200%.
- Clamping used `monitor.size()`, which includes the taskbar.
- On mixed-DPI setups `outer_size()` was read on the previous monitor, and the OS rescaled the window after the move.

## Approach

- `src-tauri/src/services/popover_layout.rs` — pure `place_popover(anchor, work_area, scale, logical_w, logical_h) -> Rect` in physical pixels of one monitor. No Tauri types; unit-tested.
- `src-tauri/src/services/tray.rs` — `TrayState.popover` stores the last tray anchor and logical content height. `apply_popover_layout` is the only code path that sizes or positions the popover: it picks the monitor that contains the anchor center, reads its `work_area()` and `scale_factor()`, then runs `set_position → set_size → set_position`.
- `src-tauri/src/services/window.rs` — `resize_window` records the logical height and re-places the popover; before the first tray anchor exists it falls back to a plain logical resize.
- Frontend contract (`resize_window(height)`) is unchanged.

## Verification

- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `npm test`, `npm run build`
