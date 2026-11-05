//! Pure placement math for the tray popover.
//!
//! Every rectangle here is in physical pixels of the monitor that holds the
//! tray icon. Callers convert once at the edge; this module never reads a
//! window, so the geometry can be tested for any resolution and scale factor.

/// Logical width of the tray popover (matches `tauri.conf.json`).
pub const POPOVER_WIDTH: f64 = 340.0;
/// Logical distance between the tray icon and the popover edge.
pub const POPOVER_GAP: f64 = 8.0;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

impl Rect {
    pub fn right(self) -> i32 {
        self.x.saturating_add(self.width as i32)
    }

    pub fn bottom(self) -> i32 {
        self.y.saturating_add(self.height as i32)
    }

    pub fn center(self) -> (i32, i32) {
        (
            self.x.saturating_add(self.width as i32 / 2),
            self.y.saturating_add(self.height as i32 / 2),
        )
    }
}

/// Side of the tray icon the popover opens toward.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OpenToward {
    Up,
    Down,
    Left,
    Right,
}

/// Picks the direction from where the icon sits relative to the work area,
/// which already excludes the taskbar or menu bar on every platform.
pub fn open_direction(anchor: Rect, work_area: Rect) -> OpenToward {
    let (cx, cy) = anchor.center();
    if cy >= work_area.bottom() {
        return OpenToward::Up;
    }
    if cy < work_area.y {
        return OpenToward::Down;
    }
    if cx >= work_area.right() {
        return OpenToward::Left;
    }
    if cx < work_area.x {
        return OpenToward::Right;
    }
    // Auto-hidden taskbar or overflow flyout: open away from the nearest edge.
    let top = cy - work_area.y;
    let bottom = work_area.bottom() - cy;
    let left = cx - work_area.x;
    let right = work_area.right() - cx;
    let nearest = top.min(bottom).min(left).min(right);
    if nearest == bottom {
        OpenToward::Up
    } else if nearest == top {
        OpenToward::Down
    } else if nearest == right {
        OpenToward::Left
    } else {
        OpenToward::Right
    }
}

/// Only Windows overflow icons need projection onto the taskbar. Keep native
/// menu/status anchors on other platforms, even if the reported work area
/// includes them (Tauri 2.10 on macOS omits the menu bar's y inset).
pub fn platform_anchor(anchor: Rect, _monitor: Rect, _work_area: Rect) -> Rect {
    #[cfg(target_os = "windows")]
    {
        taskbar_anchor(anchor, _monitor, _work_area)
    }
    #[cfg(not(target_os = "windows"))]
    {
        anchor
    }
}

/// Moves an anchor that lies inside the work area onto the nearest taskbar.
///
/// Windows reports an icon in the notification overflow flyout (the `^`
/// button, where Windows 10 puts new icons by default) at its spot in that
/// flyout, above the taskbar. The flyout closes as soon as the popover takes
/// focus, so anchoring to it leaves the popover floating in the work area.
/// Projecting the icon onto the reserved strip (`monitor` minus `work_area`)
/// docks the popover to the taskbar like a pinned icon. Anchors outside the
/// work area, and monitors without a reserved strip (auto-hidden taskbar),
/// are returned unchanged.
#[cfg(any(target_os = "windows", test))]
fn taskbar_anchor(anchor: Rect, monitor: Rect, work_area: Rect) -> Rect {
    let (cx, cy) = anchor.center();
    let inside =
        cx >= work_area.x && cx < work_area.right() && cy >= work_area.y && cy < work_area.bottom();
    if !inside {
        return anchor;
    }
    let strip = |start: i32, end: i32| (end - start).max(0) as u32;
    let candidates = [
        (
            work_area.bottom() - cy,
            Rect {
                y: work_area.bottom(),
                height: strip(work_area.bottom(), monitor.bottom()),
                ..anchor
            },
        ),
        (
            cy - work_area.y,
            Rect {
                y: monitor.y,
                height: strip(monitor.y, work_area.y),
                ..anchor
            },
        ),
        (
            work_area.right() - cx,
            Rect {
                x: work_area.right(),
                width: strip(work_area.right(), monitor.right()),
                ..anchor
            },
        ),
        (
            cx - work_area.x,
            Rect {
                x: monitor.x,
                width: strip(monitor.x, work_area.x),
                ..anchor
            },
        ),
    ];
    candidates
        .into_iter()
        .filter(|(_, bar)| bar.width > 0 && bar.height > 0)
        .min_by_key(|(distance, _)| *distance)
        .map_or(anchor, |(_, bar)| bar)
}

/// Returns the popover frame for a logical size on a monitor with `scale`.
///
/// Invariants (covered by tests):
/// - the frame always lies inside `work_area`;
/// - the edge facing the icon sits `POPOVER_GAP * scale` away from it unless
///   that would leave the work area, in which case it sits on the work area edge;
/// - the result depends only on the target monitor, never on the monitor the
///   window was on before.
pub fn place_popover(
    anchor: Rect,
    work_area: Rect,
    scale: f64,
    logical_width: f64,
    logical_height: f64,
) -> Rect {
    let scale = if scale.is_finite() && scale > 0.0 {
        scale
    } else {
        1.0
    };
    let to_px = |value: f64| (value * scale).round() as i64;
    let area_x = work_area.x as i64;
    let area_y = work_area.y as i64;
    let area_w = (work_area.width as i64).max(1);
    let area_h = (work_area.height as i64).max(1);

    let width = to_px(logical_width).clamp(1, area_w);
    let height = to_px(logical_height).clamp(1, area_h);
    let gap = to_px(POPOVER_GAP);
    let (cx, cy) = anchor.center();
    let (cx, cy) = (cx as i64, cy as i64);

    let (x, y) = match open_direction(anchor, work_area) {
        OpenToward::Up => (cx - width / 2, anchor.y as i64 - gap - height),
        OpenToward::Down => (cx - width / 2, anchor.bottom() as i64 + gap),
        OpenToward::Left => (anchor.x as i64 - gap - width, cy - height / 2),
        OpenToward::Right => (anchor.right() as i64 + gap, cy - height / 2),
    };

    Rect {
        x: x.clamp(area_x, area_x + area_w - width) as i32,
        y: y.clamp(area_y, area_y + area_h - height) as i32,
        width: width as u32,
        height: height as u32,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn macos_menu_icon_stays_at_top_when_work_area_omits_menu_bar_offset() {
        // NSScreen on the affected 1512x982, 2x display: visible height 888.
        // Tauri 2.10 reports y=0 rather than the 33-point menu bar inset.
        let monitor = Rect {
            x: 0,
            y: 0,
            width: 3024,
            height: 1964,
        };
        let work_area = Rect {
            height: 1776,
            ..monitor
        };
        let icon = Rect {
            x: 2600,
            y: 0,
            width: 60,
            height: 66,
        };
        let anchor = platform_anchor(icon, monitor, work_area);
        assert_eq!(anchor, icon);
        let frame = place_popover(anchor, work_area, 2.0, 340.0, 582.0);
        assert_eq!(
            frame.y, 82,
            "popover must open 8 points below the menu icon"
        );
        assert!(frame.bottom() <= work_area.bottom());
    }
    /// A Windows monitor with a bottom taskbar, in physical pixels.
    struct Screen {
        width: u32,
        height: u32,
        scale: f64,
    }

    impl Screen {
        fn work_area(&self) -> Rect {
            let taskbar = (48.0 * self.scale).round() as u32;
            Rect {
                x: 0,
                y: 0,
                width: self.width,
                height: self.height - taskbar,
            }
        }

        /// Notification-area icon near the right end of the taskbar.
        fn tray_icon(&self) -> Rect {
            let size = (24.0 * self.scale).round() as u32;
            let taskbar = self.height - self.work_area().height;
            Rect {
                x: self.width as i32 - (160.0 * self.scale).round() as i32,
                y: (self.height - taskbar + (taskbar - size) / 2) as i32,
                width: size,
                height: size,
            }
        }
    }

    const SCREENS: &[Screen] = &[
        Screen {
            width: 1366,
            height: 768,
            scale: 1.0,
        },
        Screen {
            width: 1920,
            height: 1080,
            scale: 1.0,
        },
        Screen {
            width: 1920,
            height: 1080,
            scale: 1.25,
        },
        Screen {
            width: 1920,
            height: 1080,
            scale: 1.5,
        },
        Screen {
            width: 2560,
            height: 1440,
            scale: 1.0,
        },
        Screen {
            width: 2560,
            height: 1440,
            scale: 1.25,
        },
        Screen {
            width: 3840,
            height: 2160,
            scale: 1.0,
        },
        Screen {
            width: 3840,
            height: 2160,
            scale: 1.5,
        },
        Screen {
            width: 3840,
            height: 2160,
            scale: 1.75,
        },
        Screen {
            width: 3840,
            height: 2160,
            scale: 2.0,
        },
        Screen {
            width: 5120,
            height: 2880,
            scale: 2.0,
        },
    ];

    const HEIGHTS: &[f64] = &[200.0, 300.0, 451.0, 582.0];

    fn inside(frame: Rect, area: Rect) -> bool {
        frame.x >= area.x
            && frame.y >= area.y
            && frame.right() <= area.right()
            && frame.bottom() <= area.bottom()
    }

    #[test]
    fn bottom_taskbar_keeps_the_same_logical_gap_at_every_resolution_and_scale() {
        for screen in SCREENS {
            let area = screen.work_area();
            let icon = screen.tray_icon();
            let expected_gap = (POPOVER_GAP * screen.scale).round() as i32;
            for &height in HEIGHTS {
                let frame = place_popover(icon, area, screen.scale, POPOVER_WIDTH, height);
                let label = format!(
                    "{}x{} @{} height {height}",
                    screen.width, screen.height, screen.scale
                );
                assert!(inside(frame, area), "{label}: {frame:?} leaves {area:?}");
                if frame.height < area.height {
                    assert_eq!(
                        frame.bottom(),
                        (icon.y - expected_gap).min(area.bottom()),
                        "{label}: popover bottom drifted from the tray icon"
                    );
                }
            }
        }
    }

    #[test]
    fn resizing_keeps_the_bottom_edge_fixed_on_a_4k_200_percent_screen() {
        let screen = Screen {
            width: 3840,
            height: 2160,
            scale: 2.0,
        };
        let area = screen.work_area();
        let icon = screen.tray_icon();
        let bottoms: Vec<i32> = HEIGHTS
            .iter()
            .map(|&h| place_popover(icon, area, 2.0, POPOVER_WIDTH, h).bottom())
            .collect();
        assert!(
            bottoms.windows(2).all(|pair| pair[0] == pair[1]),
            "{bottoms:?}"
        );
    }

    #[test]
    fn gap_to_the_icon_scales_with_the_monitor() {
        // Icon rect starts right at the taskbar top, so the gap is not hidden by clamping.
        for (scale, gap) in [(1.0, 8), (1.5, 12), (2.0, 16)] {
            let area = Rect {
                x: 0,
                y: 0,
                width: 3840,
                height: 2064,
            };
            let icon = Rect {
                x: 3600,
                y: 2064,
                width: 96,
                height: 96,
            };
            let frame = place_popover(icon, area, scale, POPOVER_WIDTH, 400.0);
            assert_eq!(icon.y - frame.bottom(), gap, "scale {scale}");
        }
    }

    #[test]
    fn size_is_derived_from_the_target_monitor_scale() {
        let screen = Screen {
            width: 3840,
            height: 2160,
            scale: 2.0,
        };
        let frame = place_popover(screen.tray_icon(), screen.work_area(), 2.0, 340.0, 582.0);
        assert_eq!((frame.width, frame.height), (680, 1164));
    }

    #[test]
    fn popover_never_covers_the_taskbar() {
        for screen in SCREENS {
            let area = screen.work_area();
            let frame = place_popover(screen.tray_icon(), area, screen.scale, POPOVER_WIDTH, 582.0);
            assert!(frame.bottom() <= area.bottom());
        }
    }

    #[test]
    fn popover_taller_than_work_area_is_clamped_inside() {
        let area = Rect {
            x: 0,
            y: 0,
            width: 1366,
            height: 696,
        };
        let icon = Rect {
            x: 1200,
            y: 720,
            width: 36,
            height: 36,
        };
        let frame = place_popover(icon, area, 1.5, POPOVER_WIDTH, 582.0);
        assert_eq!(frame.height, 696);
        assert!(inside(frame, area));
    }

    #[test]
    fn macos_menu_bar_opens_downward_below_the_icon() {
        // 2x Retina: menu bar is 37 logical points, work area starts below it.
        let area = Rect {
            x: 0,
            y: 74,
            width: 3024,
            height: 1890,
        };
        let icon = Rect {
            x: 2400,
            y: 0,
            width: 60,
            height: 74,
        };
        let frame = place_popover(icon, area, 2.0, POPOVER_WIDTH, 400.0);
        assert_eq!(open_direction(icon, area), OpenToward::Down);
        assert_eq!(frame.y, icon.bottom() + 16);
        assert_eq!(frame.x, icon.center().0 - 340);
    }

    #[test]
    fn side_and_top_taskbars_open_away_from_the_taskbar() {
        let full = Rect {
            x: 0,
            y: 0,
            width: 3840,
            height: 2160,
        };
        let bar = 96;
        let cases = [
            (
                Rect {
                    y: bar as i32,
                    height: full.height - bar,
                    ..full
                },
                Rect {
                    x: 3600,
                    y: 30,
                    width: 48,
                    height: 48,
                },
                OpenToward::Down,
            ),
            (
                Rect {
                    width: full.width - bar,
                    ..full
                },
                Rect {
                    x: 3770,
                    y: 1900,
                    width: 48,
                    height: 48,
                },
                OpenToward::Left,
            ),
            (
                Rect {
                    x: bar as i32,
                    width: full.width - bar,
                    ..full
                },
                Rect {
                    x: 24,
                    y: 1900,
                    width: 48,
                    height: 48,
                },
                OpenToward::Right,
            ),
        ];
        for (area, icon, direction) in cases {
            assert_eq!(open_direction(icon, area), direction);
            let frame = place_popover(icon, area, 2.0, POPOVER_WIDTH, 582.0);
            assert!(inside(frame, area), "{direction:?}: {frame:?}");
            let gap = 16;
            match direction {
                // The facing edge keeps the gap, or rests on the work area edge
                // when the icon sits deeper inside the taskbar than the gap.
                OpenToward::Down => assert_eq!(frame.y, (icon.bottom() + gap).max(area.y)),
                OpenToward::Left => assert_eq!(frame.right(), (icon.x - gap).min(area.right())),
                OpenToward::Right => assert_eq!(frame.x, (icon.right() + gap).max(area.x)),
                OpenToward::Up => unreachable!(),
            }
        }
    }

    #[test]
    fn secondary_monitor_with_negative_origin_stays_on_that_monitor() {
        // 4K @150% placed left of the primary display.
        let area = Rect {
            x: -3840,
            y: 0,
            width: 3840,
            height: 2088,
        };
        let icon = Rect {
            x: -300,
            y: 2106,
            width: 36,
            height: 36,
        };
        let frame = place_popover(icon, area, 1.5, POPOVER_WIDTH, 582.0);
        assert!(inside(frame, area));
        assert_eq!(frame.bottom(), 2088);
        assert!(frame.right() <= 0);
    }

    #[test]
    fn auto_hidden_taskbar_opens_away_from_the_nearer_edge() {
        let area = Rect {
            x: 0,
            y: 0,
            width: 3840,
            height: 2160,
        };
        for (icon, direction) in [
            (
                Rect {
                    x: 3600,
                    y: 2110,
                    width: 48,
                    height: 48,
                },
                OpenToward::Up,
            ),
            (
                Rect {
                    x: 0,
                    y: 900,
                    width: 48,
                    height: 48,
                },
                OpenToward::Right,
            ),
            (
                Rect {
                    x: 3792,
                    y: 900,
                    width: 48,
                    height: 48,
                },
                OpenToward::Left,
            ),
        ] {
            assert_eq!(open_direction(icon, area), direction);
            assert!(inside(
                place_popover(icon, area, 2.0, POPOVER_WIDTH, 582.0),
                area
            ));
        }
    }

    #[test]
    fn issue_186_2k_monitor_combines_font_zoom_and_system_dpi() {
        for dpi in [1.0, 1.25, 1.5, 2.0] {
            let screen = Screen {
                width: 2560,
                height: 1440,
                scale: dpi,
            };
            for zoom in [1.0, 1.25, 1.5] {
                for height in HEIGHTS {
                    let area = screen.work_area();
                    let frame = place_popover(
                        screen.tray_icon(),
                        area,
                        dpi,
                        POPOVER_WIDTH * zoom,
                        height * zoom,
                    );
                    assert!(inside(frame, area));
                    assert_eq!(frame.width, (POPOVER_WIDTH * zoom * dpi).round() as u32);
                }
            }
        }
    }

    #[test]
    fn issue_186_overflow_flyout_icon_docks_to_the_bottom_taskbar() {
        // Windows 10, 27" 2K, 40 px taskbar at 100%; 50 px at 125%. The icon
        // is in the overflow flyout, above the taskbar and inside the work area.
        for (scale, taskbar, icon_size) in [(1.0, 40, 40), (1.25, 50, 50)] {
            let monitor = Rect {
                x: 0,
                y: 0,
                width: 2560,
                height: 1440,
            };
            let area = Rect {
                height: 1440 - taskbar,
                ..monitor
            };
            let flyout_icon = Rect {
                x: 2290,
                y: area.bottom() - 2 * icon_size as i32,
                width: icon_size,
                height: icon_size,
            };
            let anchor = taskbar_anchor(flyout_icon, monitor, area);
            assert_eq!(
                anchor,
                Rect {
                    y: area.bottom(),
                    height: taskbar,
                    ..flyout_icon
                }
            );
            let frame = place_popover(anchor, area, scale, POPOVER_WIDTH, 451.0);
            let gap = (POPOVER_GAP * scale).round() as i32;
            assert_eq!(frame.bottom(), area.bottom() - gap, "scale {scale}");
            assert_eq!(
                frame.x + frame.width as i32 / 2,
                flyout_icon.center().0,
                "scale {scale}"
            );
            assert!(inside(frame, area));
        }
    }

    #[test]
    fn taskbar_anchor_keeps_pinned_menu_bar_and_auto_hide_anchors() {
        let monitor = Rect {
            x: 0,
            y: 0,
            width: 3840,
            height: 2160,
        };
        // Pinned icon already in a bottom taskbar.
        let bottom_area = Rect {
            height: 2064,
            ..monitor
        };
        let pinned = Rect {
            x: 3600,
            y: 2064,
            width: 48,
            height: 96,
        };
        assert_eq!(taskbar_anchor(pinned, monitor, bottom_area), pinned);
        // macOS menu bar icon above the work area.
        let menu_area = Rect {
            y: 74,
            height: 2086,
            ..monitor
        };
        let menu_icon = Rect {
            x: 2400,
            y: 0,
            width: 60,
            height: 74,
        };
        assert_eq!(taskbar_anchor(menu_icon, monitor, menu_area), menu_icon);
        // Auto-hidden taskbar: no reserved strip, keep the reported rect.
        let hidden = Rect {
            x: 3600,
            y: 2110,
            width: 48,
            height: 48,
        };
        assert_eq!(taskbar_anchor(hidden, monitor, monitor), hidden);
    }

    #[test]
    fn overflow_flyout_docks_to_side_and_top_taskbars() {
        let monitor = Rect {
            x: -1920,
            y: 0,
            width: 1920,
            height: 1080,
        };
        let right_area = Rect {
            width: 1858,
            ..monitor
        };
        let icon = Rect {
            x: -140,
            y: 900,
            width: 40,
            height: 40,
        };
        let anchor = taskbar_anchor(icon, monitor, right_area);
        assert_eq!((anchor.x, anchor.width), (right_area.right(), 62));
        assert_eq!(open_direction(anchor, right_area), OpenToward::Left);

        let top_area = Rect {
            y: 40,
            height: 1040,
            ..monitor
        };
        let icon = Rect {
            x: -300,
            y: 60,
            width: 40,
            height: 40,
        };
        let anchor = taskbar_anchor(icon, monitor, top_area);
        assert_eq!((anchor.y, anchor.height), (0, 40));
        assert_eq!(open_direction(anchor, top_area), OpenToward::Down);
    }

    #[test]
    fn invalid_scale_falls_back_to_one() {
        let area = Rect {
            x: 0,
            y: 0,
            width: 1920,
            height: 1032,
        };
        let icon = Rect {
            x: 1700,
            y: 1044,
            width: 24,
            height: 24,
        };
        for scale in [0.0, -1.0, f64::NAN, f64::INFINITY] {
            let frame = place_popover(icon, area, scale, POPOVER_WIDTH, 300.0);
            assert_eq!((frame.width, frame.height), (340, 300));
        }
    }

    #[test]
    fn ui_zoom_and_monitor_dpi_scale_once_and_keep_the_frame_inside() {
        let area = Rect {
            x: -1920,
            y: 0,
            width: 1920,
            height: 1032,
        };
        let icon = Rect {
            x: -200,
            y: 1044,
            width: 36,
            height: 36,
        };
        for ui_scale in [1.0, 1.25, 1.5] {
            for dpi in [1.0, 1.5, 2.0] {
                let small =
                    place_popover(icon, area, dpi, POPOVER_WIDTH * ui_scale, 300.0 * ui_scale);
                let large =
                    place_popover(icon, area, dpi, POPOVER_WIDTH * ui_scale, 582.0 * ui_scale);
                assert_eq!(small.width, (POPOVER_WIDTH * ui_scale * dpi).round() as u32);
                if large.height < area.height {
                    assert_eq!(small.bottom(), large.bottom());
                }
                assert!(inside(small, area));
                assert!(inside(large, area));
            }
        }
    }
}
