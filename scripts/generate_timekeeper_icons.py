#!/usr/bin/env python3
"""Generate Time Keeper icon assets from the Gemini icon brief.

This script is the source of truth for all raster icon outputs in the repo:
- frontend favicons / PWA icons
- macOS app icon asset catalog
- macOS Flutter in-app icon
- macOS tray PNGs

Requires: Pillow (`python3 -c 'import PIL'`)
Run: `python3 scripts/generate_timekeeper_icons.py`
"""

from __future__ import annotations

from pathlib import Path
from PIL import Image, ImageColor, ImageDraw

ROOT = Path(__file__).resolve().parents[1]

TEAL = "#207D9B"
CHARCOAL = "#1A202C"
WHITE = "#FFFFFF"
GREY = "#6B7280"
TRANSPARENT = (0, 0, 0, 0)

BASE_CANVAS = 512
APP_CORNER_RADIUS = 120
RING_RADIUS = 180
RING_STROKE = 24
DOT_RADIUS = 10

# Monogram paths in the Gemini brief (relative to center on a 512 canvas).
SEGMENTS = [
    ((-80, -100), (80, -100)),
    ((0, -100), (0, 0)),
    ((0, 0), (80, 100)),
    ((0, 0), (-60, 80)),
    ((0, 0), (-80, 0)),
    ((80, -100), (0, 0)),
    ((0, 0), (-80, -100)),
]
DOT_CENTERS = [(0, 60), (0, 90)]


def rgba(color: str, alpha: float = 1.0) -> tuple[int, int, int, int]:
    r, g, b = ImageColor.getrgb(color)
    return (r, g, b, round(max(0.0, min(1.0, alpha)) * 255))


def ensure_parent(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def scale_point(x: float, y: float, scale: float, center: float) -> tuple[float, float]:
    return (center + x * scale, center + y * scale)


def round_line(draw: ImageDraw.ImageDraw, a: tuple[float, float], b: tuple[float, float], width: float, color: tuple[int, int, int, int]) -> None:
    draw.line([a, b], fill=color, width=round(width), joint="curve")
    radius = width / 2
    draw.ellipse([a[0] - radius, a[1] - radius, a[0] + radius, a[1] + radius], fill=color)
    draw.ellipse([b[0] - radius, b[1] - radius, b[0] + radius, b[1] + radius], fill=color)


def draw_monogram(draw: ImageDraw.ImageDraw, canvas_size: int, color: tuple[int, int, int, int], *, include_ring: bool = True, include_dots: bool = True, stroke_scale: float = 1.0) -> None:
    scale = canvas_size / BASE_CANVAS
    center = canvas_size / 2
    stroke = RING_STROKE * scale * stroke_scale

    if include_ring:
        ring_radius = RING_RADIUS * scale
        draw.ellipse(
            [center - ring_radius, center - ring_radius, center + ring_radius, center + ring_radius],
            outline=color,
            width=max(1, round(stroke)),
        )

    for start, end in SEGMENTS:
        a = scale_point(start[0], start[1], scale, center)
        b = scale_point(end[0], end[1], scale, center)
        round_line(draw, a, b, stroke, color)

    if include_dots:
        dot_radius = DOT_RADIUS * scale * stroke_scale
        for x, y in DOT_CENTERS:
            cx, cy = scale_point(x, y, scale, center)
            draw.ellipse([cx - dot_radius, cy - dot_radius, cx + dot_radius, cy + dot_radius], fill=color)


def render_app_icon(size: int, *, rounded: bool, background: str) -> Image.Image:
    render_size = max(size * 6, 512)
    img = Image.new("RGBA", (render_size, render_size), TRANSPARENT)
    draw = ImageDraw.Draw(img)

    if rounded:
        radius = APP_CORNER_RADIUS * (render_size / BASE_CANVAS)
        draw.rounded_rectangle([0, 0, render_size - 1, render_size - 1], radius=radius, fill=rgba(background))
    else:
        draw.rectangle([0, 0, render_size - 1, render_size - 1], fill=rgba(background))

    draw_monogram(draw, render_size, rgba(WHITE), include_ring=True, include_dots=True)

    if render_size != size:
        img = img.resize((size, size), Image.Resampling.LANCZOS)
    return img


def render_tray_icon(size: int, *, color: str, alpha: float) -> Image.Image:
    render_size = max(size * 12, 192)
    img = Image.new("RGBA", (render_size, render_size), TRANSPARENT)
    draw = ImageDraw.Draw(img)
    # Menu-bar icons are tiny; use the monogram only, no ring or dots, with thicker strokes.
    draw_monogram(
        draw,
        render_size,
        rgba(color, alpha),
        include_ring=False,
        include_dots=False,
        stroke_scale=1.18,
    )
    if render_size != size:
        img = img.resize((size, size), Image.Resampling.LANCZOS)
    return img


def save_png(path: Path, image: Image.Image) -> None:
    ensure_parent(path)
    image.save(path, format="PNG")
    print(path.relative_to(ROOT))


def main() -> None:
    frontend_public = ROOT / "packages/frontend/public"
    frontend_icons = frontend_public / "icons"
    macos_assets = ROOT / "packages/macos_app/macos/Runner/Assets.xcassets/AppIcon.appiconset"
    macos_images = ROOT / "packages/macos_app/assets/images"
    tray_assets = ROOT / "packages/macos_app/assets/tray"

    rounded_sizes = [16, 32, 48, 64, 128, 180, 192, 256, 384, 512, 1024]
    rounded_icons = {size: render_app_icon(size, rounded=True, background=TEAL) for size in rounded_sizes}
    maskable_sizes = {size: render_app_icon(size, rounded=False, background=TEAL) for size in (192, 512)}

    # Frontend icons.
    save_png(frontend_icons / "icon-16x16.png", rounded_icons[16])
    save_png(frontend_icons / "icon-32x32.png", rounded_icons[32])
    save_png(frontend_icons / "icon-48x48.png", rounded_icons[48])
    save_png(frontend_icons / "icon-64x64.png", rounded_icons[64])
    save_png(frontend_icons / "icon-128x128.png", rounded_icons[128])
    save_png(frontend_icons / "icon-180x180.png", rounded_icons[180])
    save_png(frontend_icons / "apple-touch-icon.png", rounded_icons[180])
    save_png(frontend_icons / "icon-192x192.png", rounded_icons[192])
    save_png(frontend_public / "icon-192.png", rounded_icons[192])
    save_png(frontend_icons / "icon-256x256.png", rounded_icons[256])
    save_png(frontend_icons / "icon-384x384.png", rounded_icons[384])
    save_png(frontend_icons / "icon-512x512.png", rounded_icons[512])
    save_png(frontend_public / "icon-512.png", rounded_icons[512])
    save_png(frontend_icons / "maskable-192x192.png", maskable_sizes[192])
    save_png(frontend_icons / "maskable-512x512.png", maskable_sizes[512])

    favicon = rounded_icons[512].copy()
    ensure_parent(frontend_icons / "favicon.ico")
    favicon.save(
        frontend_icons / "favicon.ico",
        format="ICO",
        sizes=[(16, 16), (32, 32), (48, 48)],
    )
    print((frontend_icons / "favicon.ico").relative_to(ROOT))
    ensure_parent(frontend_public / "favicon.ico")
    favicon.save(
        frontend_public / "favicon.ico",
        format="ICO",
        sizes=[(16, 16), (32, 32), (48, 48)],
    )
    print((frontend_public / "favicon.ico").relative_to(ROOT))

    # macOS app icon assets.
    save_png(macos_images / "app_icon.png", rounded_icons[256])
    save_png(macos_assets / "app_icon_16.png", rounded_icons[16])
    save_png(macos_assets / "app_icon_32.png", rounded_icons[32])
    save_png(macos_assets / "app_icon_64.png", rounded_icons[64])
    save_png(macos_assets / "app_icon_128.png", rounded_icons[128])
    save_png(macos_assets / "app_icon_256.png", rounded_icons[256])
    save_png(macos_assets / "app_icon_512.png", rounded_icons[512])
    save_png(macos_assets / "app_icon_1024.png", rounded_icons[1024])

    # Tray icons.
    save_png(tray_assets / "inactive.png", render_tray_icon(16, color="#000000", alpha=1.0))
    save_png(tray_assets / "inactive@2x.png", render_tray_icon(32, color="#000000", alpha=1.0))
    save_png(tray_assets / "grey.png", render_tray_icon(16, color=GREY, alpha=0.45))
    save_png(tray_assets / "grey@2x.png", render_tray_icon(32, color=GREY, alpha=0.45))


if __name__ == "__main__":
    main()
