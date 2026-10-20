"""Draws the (original, generic) PhishGuard shield icon at 16/32/48/128 px."""
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parents[1] / "public" / "icons"
OUT.mkdir(parents=True, exist_ok=True)
for size in (16, 32, 48, 128):
    s = size * 4  # draw large, downsample for smooth edges
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    shield = [(s * 0.5, s * 0.06), (s * 0.88, s * 0.2), (s * 0.84, s * 0.58), (s * 0.5, s * 0.94),
              (s * 0.16, s * 0.58), (s * 0.12, s * 0.2)]
    d.polygon(shield, fill=(21, 94, 239, 255))
    w = max(2, int(s * 0.09))
    d.line([(s * 0.3, s * 0.5), (s * 0.45, s * 0.65), (s * 0.72, s * 0.36)], fill=(255, 255, 255, 255), width=w,
           joint="curve")
    img.resize((size, size), Image.LANCZOS).save(OUT / f"icon{size}.png")
print("icons written to", OUT)
