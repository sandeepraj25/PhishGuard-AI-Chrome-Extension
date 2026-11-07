"""Builds docs/screenshots/hero.png (warning inside a browser window) and docs/screenshots/demo.gif from
the real screenshots made by extension/scripts/screenshots.ts. Generic browser frame, no logos."""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
SHOTS = ROOT / "docs" / "screenshots"
ICON = ROOT / "extension" / "public" / "icons" / "icon48.png"
URL = "examplebank.test.verify-account.test/secure/login.php"


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    for name in (["DejaVuSans-Bold.ttf"] if bold else ["DejaVuSans.ttf"]):
        for d in ("/usr/share/fonts/truetype/dejavu/", ""):
            try:
                return ImageFont.truetype(d + name, size)
            except OSError:
                pass
    return ImageFont.load_default()


def browser_frame(page: Image.Image, url: str, badge: bool) -> Image.Image:
    """Wrap a page screenshot in a simple, generic browser window with our toolbar icon."""
    bar = 76
    w, h = page.size
    win = Image.new("RGB", (w, h + bar), "#dee1e6")
    d = ImageDraw.Draw(win)
    for i, c in enumerate(("#ff5f57", "#febc2e", "#28c840")):  # window buttons
        d.ellipse([16 + i * 22, 13, 28 + i * 22, 25], fill=c)
    d.rounded_rectangle([86, 6, 330, 36], radius=8, fill="#ffffff")  # active tab
    d.text((102, 13), "ExampleBank — Verify", fill="#3c4043", font=font(13))
    d.rectangle([0, 38, w, bar], fill="#ffffff")
    d.rounded_rectangle([86, 44, w - 120, 70], radius=13, fill="#f1f3f4")
    d.text((106, 50), "⚠ Not secure   " + url, fill="#5f6368", font=font(13))
    icon = Image.open(ICON).convert("RGBA").resize((26, 26))
    ix, iy = w - 96, 44
    win.paste(icon, (ix, iy), icon)
    if badge:
        d.rounded_rectangle([ix + 14, iy + 12, ix + 32, iy + 28], radius=4, fill="#b42318")
        d.text((ix + 20, iy + 12), "!", fill="#ffffff", font=font(13, True))
    d.text((w - 58, 50), "⋮", fill="#5f6368", font=font(16, True))
    win.paste(page, (0, bar))
    return win


def hero() -> None:
    page = Image.open(SHOTS / "warning.png").convert("RGB")
    win = browser_frame(page, URL, badge=True)
    pad = 36
    canvas = Image.new("RGB", (win.width + pad * 2, win.height + pad * 2 + 40), "#eef1f4")
    canvas.paste(win, (pad, pad))
    d = ImageDraw.Draw(canvas)
    d.rectangle([pad - 1, pad - 1, pad + win.width, pad + win.height], outline="#c9d1da")
    d.text((pad, canvas.height - 50), "Chrome extension · warning appears when you click the password box on a look-alike site "
           "(fictional ExampleBank test page)", fill="#566273", font=font(14))
    canvas.save(SHOTS / "hero.png", optimize=True)


def gif() -> None:
    frames = sorted((SHOTS / "frames").glob("*.png"))
    imgs = [browser_frame(Image.open(f).convert("RGB"), URL, badge=False).resize((780, 536), Image.LANCZOS) for f in frames]
    # Badge appears once the warning is shown (last frames).
    last = [browser_frame(Image.open(f).convert("RGB"), URL, badge=True).resize((780, 536), Image.LANCZOS) for f in frames[-14:]]
    imgs[-14:] = last
    pal = [im.convert("P", palette=Image.ADAPTIVE, colors=128) for im in imgs]
    durations = [120] * len(pal)
    durations[-1] = 2500
    pal[0].save(SHOTS / "demo.gif", save_all=True, append_images=pal[1:], duration=durations, loop=0, optimize=True)


if __name__ == "__main__":
    hero()
    gif()
    for f in ("hero.png", "demo.gif"):
        print(f, (SHOTS / f).stat().st_size // 1024, "KB")
