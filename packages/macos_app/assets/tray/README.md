# Tray icon assets

Place the following PNG files here before building:

| File | Size | Purpose |
|------|------|---------|
| `inactive.png` | 16×16 (+ `inactive@2x.png` at 32×32) | Monochrome **template** icon — shown when connected but no timer running. Uses the simplified Time Keeper monogram as a pure black silhouette; macOS tints it automatically for light/dark mode. |
| `grey.png` | 16×16 (+ `grey@2x.png` at 32×32) | Same monogram as `inactive.png` but at ~45% grey — shown when not connected / not configured. |

The colored dot shown when a timer is active is generated at runtime by `IconGenerator.coloredDot()` — no static file needed for that state.

## Quick way to generate placeholder icons

Install [Inkscape](https://inkscape.org) or use any vector editor. A minimal clock icon:

```bash
# Using ImageMagick to generate a simple placeholder circle
magick -size 32x32 xc:none -fill white -draw "circle 15,15 15,2" inactive@2x.png
magick -size 16x16 xc:none -fill white -draw "circle 7,7 7,1" inactive.png
convert inactive@2x.png -fill gray50 -colorize 60 grey@2x.png
convert inactive.png -fill gray50 -colorize 60 grey.png
```

For production, keep the tray assets derived from the simplified Time Keeper monogram (`timekeeper-template.svg` / `timekeeper-grey.svg`) and export them at 16×16 and 32×32.
