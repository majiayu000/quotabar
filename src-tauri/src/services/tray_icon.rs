use std::sync::OnceLock;

use image::{
    imageops::{resize, FilterType},
    load_from_memory_with_format, ImageBuffer, ImageEncoder, ImageFormat, Rgba, RgbaImage,
};
use serde::Deserialize;

const GLYPH_WIDTH: u32 = 3;
const GLYPH_HEIGHT: u32 = 5;
const BADGE_BORDER: Rgba<u8> = Rgba([255, 255, 255, 235]);
const BADGE_TEXT: Rgba<u8> = Rgba([255, 255, 255, 255]);
const CLAUDE_BADGE_BYTES: &[u8] = include_bytes!("../../icons/tray-badges/claude.png");
const CODEX_BADGE_BYTES: &[u8] = include_bytes!("../../icons/tray-badges/codex.png");
const CURSOR_BADGE_BYTES: &[u8] = include_bytes!("../../icons/tray-badges/cursor.png");
const ANTIGRAVITY_BADGE_BYTES: &[u8] = include_bytes!("../../icons/tray-badges/antigravity.png");
const LARGE_BADGE_OUTER_RADIUS: f32 = 11.2;
const SMALL_BADGE_OUTER_RADIUS: f32 = 6.4;
const LARGE_BADGE_BORDER_WIDTH: f32 = 1.2;
const SMALL_BADGE_BORDER_WIDTH: f32 = 1.0;
const LARGE_BADGE_ICON_SIZE: u32 = 17;
const SMALL_BADGE_ICON_SIZE: u32 = 8;
const LARGE_BADGE_INSET: f32 = 0.0;
const SMALL_BADGE_INSET: f32 = 0.4;
const LARGE_RING_WIDTH: f32 = 5.8;
const SMALL_RING_WIDTH: f32 = 3.2;
const LARGE_RING_OUTER_INSET: f32 = 1.2;
const SMALL_RING_OUTER_INSET: f32 = 0.6;
const LARGE_DIGIT_OFFSET_X: i32 = -1;
const LARGE_DIGIT_OFFSET_Y: i32 = -1;
const SMALL_DIGIT_OFFSET_X: i32 = 0;
const SMALL_DIGIT_OFFSET_Y: i32 = 0;

const DIGITS: [[u8; 5]; 10] = [
    [0b111, 0b101, 0b101, 0b101, 0b111],
    [0b010, 0b110, 0b010, 0b010, 0b111],
    [0b111, 0b001, 0b111, 0b100, 0b111],
    [0b111, 0b001, 0b111, 0b001, 0b111],
    [0b101, 0b101, 0b111, 0b001, 0b001],
    [0b111, 0b100, 0b111, 0b001, 0b111],
    [0b111, 0b100, 0b111, 0b101, 0b111],
    [0b111, 0b001, 0b001, 0b001, 0b001],
    [0b111, 0b101, 0b111, 0b101, 0b111],
    [0b111, 0b101, 0b111, 0b001, 0b111],
];

#[derive(Clone, Copy)]
pub enum TrayIconIdentity {
    Claude,
    Codex,
    Cursor,
    Antigravity,
}

/// Menu bar rendering style, mirroring the Settings "Menu bar style" control.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TrayIconStyle {
    /// Progress ring with the usage percentage digits (default).
    #[default]
    Percent,
    /// Progress ring only.
    Ring,
    /// Provider badge only.
    Icon,
}

fn draw_glyph(img: &mut RgbaImage, pattern: &[u8; 5], x: i32, y: i32, scale: u32, color: Rgba<u8>) {
    for (row, bits) in pattern.iter().enumerate() {
        for col in 0..GLYPH_WIDTH {
            if (bits >> (GLYPH_WIDTH - 1 - col)) & 1 == 1 {
                for sy in 0..scale {
                    for sx in 0..scale {
                        let px = x + (col * scale) as i32 + sx as i32;
                        let py = y + (row as u32 * scale) as i32 + sy as i32;
                        if px >= 0
                            && py >= 0
                            && (px as u32) < img.width()
                            && (py as u32) < img.height()
                        {
                            img.put_pixel(px as u32, py as u32, color);
                        }
                    }
                }
            }
        }
    }
}

fn draw_digit(img: &mut RgbaImage, digit: u8, x: i32, y: i32, scale: u32, color: Rgba<u8>) {
    if digit <= 9 {
        draw_glyph(img, &DIGITS[digit as usize], x, y, scale, color);
    }
}

fn smooth_step(edge0: f32, edge1: f32, x: f32) -> f32 {
    let t = ((x - edge0) / (edge1 - edge0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

fn usage_color(used_percent: u8) -> (u8, u8, u8) {
    if used_percent >= 80 {
        (239, 68, 68)
    } else if used_percent >= 50 {
        (245, 158, 11)
    } else {
        (34, 197, 94)
    }
}

fn neutral_color() -> (u8, u8, u8) {
    (148, 163, 184)
}

fn badge_background(identity: TrayIconIdentity) -> Rgba<u8> {
    match identity {
        TrayIconIdentity::Claude => Rgba([217, 119, 87, 255]),
        TrayIconIdentity::Codex => Rgba([17, 24, 39, 255]),
        TrayIconIdentity::Cursor => Rgba([55, 65, 81, 255]),
        TrayIconIdentity::Antigravity => Rgba([66, 133, 244, 255]),
    }
}

fn decode_badge(bytes: &[u8]) -> RgbaImage {
    load_from_memory_with_format(bytes, ImageFormat::Png)
        .expect("failed to decode tray badge png")
        .into_rgba8()
}

fn badge_source(identity: TrayIconIdentity) -> &'static RgbaImage {
    static CLAUDE_BADGE: OnceLock<RgbaImage> = OnceLock::new();
    static CODEX_BADGE: OnceLock<RgbaImage> = OnceLock::new();
    static CURSOR_BADGE: OnceLock<RgbaImage> = OnceLock::new();
    static ANTIGRAVITY_BADGE: OnceLock<RgbaImage> = OnceLock::new();

    match identity {
        TrayIconIdentity::Claude => CLAUDE_BADGE.get_or_init(|| decode_badge(CLAUDE_BADGE_BYTES)),
        TrayIconIdentity::Codex => CODEX_BADGE.get_or_init(|| decode_badge(CODEX_BADGE_BYTES)),
        TrayIconIdentity::Cursor => CURSOR_BADGE.get_or_init(|| decode_badge(CURSOR_BADGE_BYTES)),
        TrayIconIdentity::Antigravity => {
            ANTIGRAVITY_BADGE.get_or_init(|| decode_badge(ANTIGRAVITY_BADGE_BYTES))
        }
    }
}

fn blend_pixel(bottom: Rgba<u8>, top: Rgba<u8>) -> Rgba<u8> {
    let top_alpha = top[3] as f32 / 255.0;
    let bottom_alpha = bottom[3] as f32 / 255.0;
    let out_alpha = top_alpha + bottom_alpha * (1.0 - top_alpha);

    if out_alpha <= 0.0 {
        return Rgba([0, 0, 0, 0]);
    }

    let blend_channel = |bottom: u8, top: u8| -> u8 {
        let bottom = bottom as f32 / 255.0;
        let top = top as f32 / 255.0;
        (((top * top_alpha) + (bottom * bottom_alpha * (1.0 - top_alpha))) / out_alpha * 255.0)
            .round()
            .clamp(0.0, 255.0) as u8
    };

    Rgba([
        blend_channel(bottom[0], top[0]),
        blend_channel(bottom[1], top[1]),
        blend_channel(bottom[2], top[2]),
        (out_alpha * 255.0).round().clamp(0.0, 255.0) as u8,
    ])
}

fn draw_badge(img: &mut RgbaImage, identity: TrayIconIdentity) {
    let size = img.width() as f32;
    let is_large = size >= 44.0;
    let outer_radius = if is_large {
        LARGE_BADGE_OUTER_RADIUS
    } else {
        SMALL_BADGE_OUTER_RADIUS
    };
    let border_width = if is_large {
        LARGE_BADGE_BORDER_WIDTH
    } else {
        SMALL_BADGE_BORDER_WIDTH
    };
    let inner_radius = outer_radius - border_width;
    let inset = if is_large {
        LARGE_BADGE_INSET
    } else {
        SMALL_BADGE_INSET
    };
    let center_x = size - outer_radius - inset;
    let center_y = size - outer_radius - inset;
    let fill = badge_background(identity);

    for y in 0..img.height() {
        for x in 0..img.width() {
            let dx = x as f32 - center_x + 0.5;
            let dy = y as f32 - center_y + 0.5;
            let dist = (dx * dx + dy * dy).sqrt();
            let outer_mask = smooth_step(outer_radius + 0.5, outer_radius - 0.5, dist);
            let inner_mask = smooth_step(inner_radius + 0.5, inner_radius - 0.5, dist);

            if outer_mask > 0.01 {
                img.put_pixel(
                    x,
                    y,
                    blend_pixel(
                        *img.get_pixel(x, y),
                        Rgba([
                            BADGE_BORDER[0],
                            BADGE_BORDER[1],
                            BADGE_BORDER[2],
                            (BADGE_BORDER[3] as f32 * outer_mask) as u8,
                        ]),
                    ),
                );
            }

            if inner_mask > 0.01 {
                img.put_pixel(
                    x,
                    y,
                    blend_pixel(
                        *img.get_pixel(x, y),
                        Rgba([
                            fill[0],
                            fill[1],
                            fill[2],
                            (fill[3] as f32 * inner_mask) as u8,
                        ]),
                    ),
                );
            }
        }
    }

    let icon_size = if is_large {
        LARGE_BADGE_ICON_SIZE
    } else {
        SMALL_BADGE_ICON_SIZE
    };
    let resized = resize(
        badge_source(identity),
        icon_size,
        icon_size,
        FilterType::Triangle,
    );
    let start_x = (center_x.round() as i32 - icon_size as i32 / 2).max(0);
    let start_y = (center_y.round() as i32 - icon_size as i32 / 2).max(0);

    for y in 0..resized.height() {
        for x in 0..resized.width() {
            let px = start_x + x as i32;
            let py = start_y + y as i32;
            if px < 0 || py < 0 || px as u32 >= img.width() || py as u32 >= img.height() {
                continue;
            }

            let top = *resized.get_pixel(x, y);
            if top[3] == 0 {
                continue;
            }

            let current = *img.get_pixel(px as u32, py as u32);
            img.put_pixel(px as u32, py as u32, blend_pixel(current, top));
        }
    }
}

fn encode_png(img: &RgbaImage, size: u32) -> Vec<u8> {
    let mut png_bytes = Vec::new();
    let encoder = image::codecs::png::PngEncoder::new(&mut png_bytes);
    encoder
        .write_image(img.as_raw(), size, size, image::ExtendedColorType::Rgba8)
        .expect("failed to encode tray icon png");
    png_bytes
}

pub fn generate_tray_icon(
    identity: TrayIconIdentity,
    used_percent: Option<u8>,
    size: u32,
    style: TrayIconStyle,
) -> Vec<u8> {
    let mut img: RgbaImage = ImageBuffer::new(size, size);
    let center = size as f32 / 2.0;
    let is_large = size >= 44;
    let pct = used_percent.map(|value| value.min(100));
    let (pr, pg, pb) = pct.map(usage_color).unwrap_or_else(neutral_color);
    let ring_width = if is_large {
        LARGE_RING_WIDTH
    } else {
        SMALL_RING_WIDTH
    };
    let outer_radius = center
        - if is_large {
            LARGE_RING_OUTER_INSET
        } else {
            SMALL_RING_OUTER_INSET
        };
    let inner_radius = outer_radius - ring_width;
    let start_angle = -std::f32::consts::FRAC_PI_2;
    let progress_angle =
        pct.map(|value| start_angle + (2.0 * std::f32::consts::PI * (value as f32 / 100.0)));

    for y in 0..size {
        if style == TrayIconStyle::Icon {
            break;
        }
        for x in 0..size {
            let dx = x as f32 - center + 0.5;
            let dy = y as f32 - center + 0.5;
            let dist = (dx * dx + dy * dy).sqrt();
            let inner_edge = smooth_step(inner_radius - 0.5, inner_radius + 0.5, dist);
            let outer_edge = smooth_step(outer_radius + 0.5, outer_radius - 0.5, dist);
            let ring_mask = inner_edge * outer_edge;
            if ring_mask <= 0.01 {
                continue;
            }

            let angle = dy.atan2(dx);
            let normalized = if angle < start_angle {
                angle + 2.0 * std::f32::consts::PI
            } else {
                angle
            };

            let alpha = (255.0 * ring_mask) as u8;
            if let Some(progress) = progress_angle {
                if normalized <= progress {
                    img.put_pixel(x, y, Rgba([pr, pg, pb, alpha]));
                } else {
                    img.put_pixel(x, y, Rgba([130, 130, 130, (100.0 * ring_mask) as u8]));
                }
            } else {
                img.put_pixel(x, y, Rgba([pr, pg, pb, (130.0 * ring_mask) as u8]));
            }
        }
    }

    if let (TrayIconStyle::Percent, Some(pct)) = (style, pct) {
        let scale = if is_large { 3 } else { 1 };
        let digit_w = GLYPH_WIDTH * scale;
        let digit_h = GLYPH_HEIGHT * scale;
        let spacing = if is_large { 2 } else { 1 };
        let digits: Vec<u8> = pct
            .to_string()
            .bytes()
            .map(|digit| digit.saturating_sub(b'0'))
            .collect();
        let total_width =
            digits.len() as u32 * digit_w + digits.len().saturating_sub(1) as u32 * spacing;
        let digit_offset_x = if is_large {
            LARGE_DIGIT_OFFSET_X
        } else {
            SMALL_DIGIT_OFFSET_X
        };
        let digit_offset_y = if is_large {
            LARGE_DIGIT_OFFSET_Y
        } else {
            SMALL_DIGIT_OFFSET_Y
        };
        let start_x = (((size as i32 - total_width as i32) / 2) + digit_offset_x).max(0);
        let start_y = (((size as i32 - digit_h as i32) / 2) + digit_offset_y).max(0);
        for (index, digit) in digits.into_iter().enumerate() {
            let x = start_x + index as i32 * (digit_w + spacing) as i32;
            draw_digit(&mut img, digit, x, start_y, scale, BADGE_TEXT);
        }
    }

    draw_badge(&mut img, identity);
    encode_png(&img, size)
}

#[cfg(test)]
mod tests {
    use super::{generate_tray_icon, usage_color, TrayIconIdentity, TrayIconStyle};

    #[test]
    fn generate_icon_returns_png_bytes() {
        let bytes = generate_tray_icon(
            TrayIconIdentity::Claude,
            Some(73),
            44,
            TrayIconStyle::Percent,
        );
        assert!(!bytes.is_empty());
    }

    #[test]
    fn generate_placeholder_icon_returns_png_bytes() {
        let bytes = generate_tray_icon(TrayIconIdentity::Claude, None, 44, TrayIconStyle::Percent);
        assert!(!bytes.is_empty());
    }

    #[test]
    fn service_badges_produce_distinct_icons() {
        let claude = generate_tray_icon(
            TrayIconIdentity::Claude,
            Some(42),
            44,
            TrayIconStyle::Percent,
        );
        let codex = generate_tray_icon(
            TrayIconIdentity::Codex,
            Some(42),
            44,
            TrayIconStyle::Percent,
        );
        assert_ne!(claude, codex);
    }

    #[test]
    fn tray_icon_distinguishes_full_usage_from_ninety_nine() {
        let ninety_nine = generate_tray_icon(
            TrayIconIdentity::Claude,
            Some(99),
            44,
            TrayIconStyle::Percent,
        );
        let full = generate_tray_icon(
            TrayIconIdentity::Claude,
            Some(100),
            44,
            TrayIconStyle::Percent,
        );
        let over_limit = generate_tray_icon(
            TrayIconIdentity::Claude,
            Some(130),
            44,
            TrayIconStyle::Percent,
        );

        assert_ne!(ninety_nine, full);
        assert_eq!(full, over_limit);
    }

    #[test]
    #[ignore]
    fn dump_production_tray_icons() {
        for (id, name) in [
            (TrayIconIdentity::Claude, "claude"),
            (TrayIconIdentity::Codex, "codex"),
            (TrayIconIdentity::Cursor, "cursor"),
            (TrayIconIdentity::Antigravity, "antigravity"),
        ] {
            let bytes = generate_tray_icon(id, Some(65), 44, TrayIconStyle::Percent);
            std::fs::write(format!("/tmp/tray_{}.png", name), &bytes).unwrap();
        }
    }

    #[test]
    fn usage_color_matches_ui_thresholds() {
        assert_eq!(usage_color(49), (34, 197, 94));
        assert_eq!(usage_color(50), (245, 158, 11));
        assert_eq!(usage_color(79), (245, 158, 11));
        assert_eq!(usage_color(80), (239, 68, 68));
    }
}
