use image::{ImageBuffer, ImageEncoder, Rgba, RgbaImage};

const DIGIT_WIDTH: u32 = 3;
const DIGIT_HEIGHT: u32 = 5;

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

fn draw_digit(img: &mut RgbaImage, digit: u8, x: i32, y: i32, scale: u32, color: Rgba<u8>) {
    if digit > 9 {
        return;
    }

    let pattern = &DIGITS[digit as usize];
    for (row, bits) in pattern.iter().enumerate() {
        for col in 0..DIGIT_WIDTH {
            if (bits >> (DIGIT_WIDTH - 1 - col)) & 1 == 1 {
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

fn smooth_step(edge0: f32, edge1: f32, x: f32) -> f32 {
    let t = ((x - edge0) / (edge1 - edge0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

fn usage_color(used_percent: u8) -> (u8, u8, u8) {
    // Keep tray color thresholds aligned with frontend quota cards.
    if used_percent >= 80 {
        (239, 68, 68)
    } else if used_percent >= 50 {
        (245, 158, 11)
    } else {
        (34, 197, 94)
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

pub fn generate_tray_icon(used_percent: u8, size: u32) -> Vec<u8> {
    let mut img: RgbaImage = ImageBuffer::new(size, size);
    let pct = used_percent.min(99);
    let center = size as f32 / 2.0;
    let (pr, pg, pb) = usage_color(pct);

    let ring_width = if size >= 44 { 7.0 } else { 3.5 };
    let outer_radius = center;
    let inner_radius = outer_radius - ring_width;

    // Used quota ring, starts at top and goes clockwise.
    let start_angle = -std::f32::consts::FRAC_PI_2;
    let progress_angle = start_angle + (2.0 * std::f32::consts::PI * (pct as f32 / 100.0));

    for y in 0..size {
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
            if normalized <= progress_angle {
                img.put_pixel(x, y, Rgba([pr, pg, pb, alpha]));
            } else {
                img.put_pixel(x, y, Rgba([130, 130, 130, (100.0 * ring_mask) as u8]));
            }
        }
    }

    let scale = if size >= 44 { 3 } else { 1 };
    let digit_w = DIGIT_WIDTH * scale;
    let digit_h = DIGIT_HEIGHT * scale;
    let spacing = if size >= 44 { 2 } else { 1 };

    let d1 = pct / 10;
    let d2 = pct % 10;
    let total_width = 2 * digit_w + spacing;
    let start_x = ((size as i32 - total_width as i32) / 2).max(0);
    let start_y = ((size as i32 - digit_h as i32) / 2).max(0);
    let text = Rgba([255, 255, 255, 255]);

    draw_digit(&mut img, d1, start_x, start_y, scale, text);
    draw_digit(&mut img, d2, start_x + (digit_w + spacing) as i32, start_y, scale, text);

    encode_png(&img, size)
}

#[cfg(test)]
mod tests {
    use super::{generate_tray_icon, usage_color};

    #[test]
    fn generate_icon_returns_png_bytes() {
        let bytes = generate_tray_icon(73, 44);
        assert!(!bytes.is_empty());
    }

    #[test]
    fn usage_color_matches_ui_thresholds() {
        assert_eq!(usage_color(49), (34, 197, 94));
        assert_eq!(usage_color(50), (245, 158, 11));
        assert_eq!(usage_color(79), (245, 158, 11));
        assert_eq!(usage_color(80), (239, 68, 68));
    }
}
