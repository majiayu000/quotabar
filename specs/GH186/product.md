# GH-186 Product Spec: Tray popover stays anchored on every display

Linked issue: https://github.com/majiayu000/quotabar/issues/186

## Goals

- The tray popover opens next to the tray icon on 1080p, 2K, 4K and 5K displays at 100%–200% scaling.
- The distance between the icon and the popover stays the same in logical pixels at every scale.
- The popover never covers the taskbar and never leaves the monitor that holds the tray icon.

## Non-Goals

- Font size changes for 27" 2K screens are a separate [text-size follow-up](text-size.md) within the same issue.
- Tray icons collapsed into the Windows overflow flyout (the OS reports the flyout rect).

## Behavior Invariants

1. `B-001` Placement is computed from the tray icon rect, the work area and the scale factor of the monitor that contains the icon. The window's previous physical frame is never an input.
2. `B-002` The edge facing the icon sits `8 × scale` physical pixels from it, or on the work area edge when the icon sits deeper in the taskbar than that gap.
3. `B-003` The popover opens away from the taskbar: up for bottom, down for top or the macOS menu bar, left for right, right for left.
4. `B-004` Content-driven height changes re-run the same placement, so the edge facing the icon does not move.
5. `B-005` The frame always lies inside the work area; a popover taller than the work area is clamped to it.
6. `B-006` Moving from a monitor with one scale onto a monitor with another applies the final size after the move, so the OS DPI rescale cannot shift the popover.

## Acceptance Criteria

- `cargo test --manifest-path src-tauri/Cargo.toml popover_layout` covers B-001–B-005 across 1366×768 … 5120×2880 at 100%–200%.
- Manual Windows check (see tasks.md) covers B-006 and real taskbar positions.
