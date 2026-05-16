#!/usr/bin/env python3
"""Generate Time Keeper icon assets from the Windows Clock SVG source.

This script is the source of truth for all raster icon outputs in the repo:
- frontend favicons / PWA icons
- macOS app icon asset catalog
- macOS Flutter in-app icon
- macOS tray PNGs

Requires: cairosvg, Pillow
Install: pip3 install cairosvg pillow --break-system-packages
Run: python3 scripts/generate_timekeeper_icons.py
"""

from __future__ import annotations

import io
from pathlib import Path

import cairosvg
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]


def svg_to_pil(svg_path: Path, size: int) -> Image.Image:
    png_data = cairosvg.svg2png(
        url=str(svg_path),
        output_width=size,
        output_height=size,
    )
    return Image.open(io.BytesIO(png_data)).convert("RGBA")


def add_padding(image: Image.Image, output_size: int, inner_padding: int) -> Image.Image:
    """Add padding around an image by placing it in a canvas.
    
    The image is resized to fit with the specified padding on all sides.
    
    Args:
        image: The source image
        output_size: The final canvas size (e.g., 180 for a 180x180 output)
        inner_padding: Padding in pixels to leave on each side (e.g., 20 for 20px padding)
    
    Returns:
        Image of size output_size × output_size with the input image centered with padding
    """
    # Create transparent canvas
    canvas = Image.new("RGBA", (output_size, output_size), (0, 0, 0, 0))
    # Calculate the size of the image after accounting for padding
    inner_size = output_size - (inner_padding * 2)
    # Resize the image to fit with padding
    resized = image.resize((inner_size, inner_size), Image.Resampling.LANCZOS)
    # Paste in center
    canvas.paste(resized, (inner_padding, inner_padding), resized)
    return canvas


def save_png(path: Path, image: Image.Image) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, format="PNG")
    print(path.relative_to(ROOT))


def main() -> None:
    frontend_public = ROOT / "packages/frontend/public"
    frontend_icons = frontend_public / "icons"
    macos_assets = ROOT / "packages/macos_app/macos/Runner/Assets.xcassets/AppIcon.appiconset"
    macos_images = ROOT / "packages/macos_app/assets/images"
    tray_assets = ROOT / "packages/macos_app/assets/tray"

    app_svg = frontend_icons / "timekeeper.svg"
    maskable_svg = frontend_icons / "timekeeper-maskable.svg"
    template_svg = tray_assets / "timekeeper-template.svg"
    grey_svg = tray_assets / "timekeeper-grey.svg"

    print("Rendering app icons from SVG source...")
    sizes = [16, 32, 48, 64, 128, 180, 192, 256, 384, 512, 1024]
    rendered = {size: svg_to_pil(app_svg, size) for size in sizes}

    # Frontend icons.
    save_png(frontend_icons / "icon-16x16.png", rendered[16])
    save_png(frontend_icons / "icon-32x32.png", rendered[32])
    save_png(frontend_icons / "icon-48x48.png", rendered[48])
    save_png(frontend_icons / "icon-64x64.png", rendered[64])
    save_png(frontend_icons / "icon-128x128.png", rendered[128])
    save_png(frontend_icons / "icon-180x180.png", rendered[180])
    # apple-touch-icon needs padding for macOS dock (rounded corners): 20px padding leaves room for the dock's visual treatment
    save_png(frontend_icons / "apple-touch-icon.png", add_padding(rendered[180], 180, 20))
    save_png(frontend_icons / "icon-192x192.png", rendered[192])
    save_png(frontend_public / "icon-192.png", rendered[192])
    save_png(frontend_icons / "icon-256x256.png", rendered[256])
    save_png(frontend_icons / "icon-384x384.png", rendered[384])
    save_png(frontend_icons / "icon-512x512.png", rendered[512])
    save_png(frontend_public / "icon-512.png", rendered[512])

    # Maskable icons — rendered from the maskable SVG (full-bleed background).
    print("Rendering maskable icons...")
    save_png(frontend_icons / "maskable-192x192.png", svg_to_pil(maskable_svg, 192))
    save_png(frontend_icons / "maskable-512x512.png", svg_to_pil(maskable_svg, 512))

    # Favicon (multi-size .ico).
    favicon_img = rendered[512]
    for ico_path in (frontend_icons / "favicon.ico", frontend_public / "favicon.ico"):
        ico_path.parent.mkdir(parents=True, exist_ok=True)
        favicon_img.save(ico_path, format="ICO", sizes=[(16, 16), (32, 32), (48, 48)])
        print(ico_path.relative_to(ROOT))

    # macOS app icon assets.
    print("Rendering macOS app icons...")
    save_png(macos_images / "app_icon.png", rendered[256])
    save_png(macos_assets / "app_icon_16.png", rendered[16])
    save_png(macos_assets / "app_icon_32.png", rendered[32])
    save_png(macos_assets / "app_icon_64.png", rendered[64])
    save_png(macos_assets / "app_icon_128.png", rendered[128])
    save_png(macos_assets / "app_icon_256.png", rendered[256])
    save_png(macos_assets / "app_icon_512.png", rendered[512])
    save_png(macos_assets / "app_icon_1024.png", rendered[1024])

    # Tray icons — rendered from the monochrome tray SVGs.
    print("Rendering tray icons...")
    save_png(tray_assets / "inactive.png", svg_to_pil(template_svg, 16))
    save_png(tray_assets / "inactive@2x.png", svg_to_pil(template_svg, 32))
    save_png(tray_assets / "grey.png", svg_to_pil(grey_svg, 16))
    save_png(tray_assets / "grey@2x.png", svg_to_pil(grey_svg, 32))

    print("\nDone.")


if __name__ == "__main__":
    main()
