"""Generate login pages for the Layer 3 visual model — FICTIONAL brands only.

The visual gallery and all training pages use invented brands (ExampleBank and five others) with
original, CSS-drawn designs. No real brand's look is reproduced. For production, the reference
gallery of real official login pages must be captured by you (docs/HUMAN_TODO.md).

Roles:
  official  the brand's own login page (small natural variation) -> gallery + training
  clone     phishing-kit style copy (shifted, rescaled, colour-jittered, logo as an image, banners)
  generic   unrelated login pages with random styles (negatives, class "other")
Output: ml/data/visual/pages.jsonl and shared/visual_brands.json (fictional brand -> official domains).
"""
from __future__ import annotations

import argparse
import base64
import colorsys
import io
import json
import random

from PIL import Image, ImageDraw

import _common  # noqa: F401
from phishguard_ml.paths import DATA, SHARED

BRANDS = [
    {"id": "examplebank", "name": "ExampleBank", "domains": ["examplebank.test"], "primary": "#1d3c8f",
     "accent": "#f2b705", "bg": "#f4f6fb", "logo": "circle", "layout": "card", "font": "Georgia, serif"},
    {"id": "lumorabank", "name": "Lumora Bank", "domains": ["lumorabank.test"], "primary": "#0f7b5f",
     "accent": "#e4572e", "bg": "#eef7f3", "logo": "diamond", "layout": "split", "font": "Verdana, sans-serif"},
    {"id": "quillpay", "name": "Quillpay", "domains": ["quillpay.test"], "primary": "#6b2fb3",
     "accent": "#21c7a8", "bg": "#f6f1fc", "logo": "square", "layout": "left", "font": "Trebuchet MS, sans-serif"},
    {"id": "parcelix", "name": "Parcelix Courier", "domains": ["parcelix.test"], "primary": "#d94f04",
     "accent": "#1b1b1b", "bg": "#fff6ee", "logo": "stripes", "layout": "card", "font": "Arial Black, sans-serif"},
    {"id": "civicportal", "name": "Civic Portal", "domains": ["civicportal.test"], "primary": "#24527a",
     "accent": "#5dade2", "bg": "#ffffff", "logo": "ring", "layout": "banner", "font": "Tahoma, sans-serif"},
    {"id": "mailora", "name": "Mailora", "domains": ["mailora.test"], "primary": "#c2185b",
     "accent": "#ffd54f", "bg": "#fdf2f6", "logo": "triangle", "layout": "split", "font": "Courier New, monospace"},
]
LAYOUTS = ["card", "split", "left", "banner"]
LOGOS = ["circle", "diamond", "square", "stripes", "ring", "triangle"]
FONTS = ["Georgia, serif", "Verdana, sans-serif", "Arial, sans-serif", "Tahoma, sans-serif", "Courier New, monospace",
         "Trebuchet MS, sans-serif", "Times New Roman, serif"]
WORDS = "acme nova blue river peak urban maple cedar orbit pixel lotus harbor summit vista crest metro".split()


def jitter(hex_color: str, r: random.Random, amount: float) -> str:
    rr, gg, bb = (int(hex_color[i:i + 2], 16) / 255 for i in (1, 3, 5))
    h, l, s = colorsys.rgb_to_hls(rr, gg, bb)
    h = (h + r.uniform(-amount, amount) * 0.1) % 1
    l = min(1, max(0, l + r.uniform(-amount, amount) * 0.15))
    out = colorsys.hls_to_rgb(h, l, s)
    return "#" + "".join(f"{int(c * 255):02x}" for c in out)


def logo_css(shape: str, color: str, accent: str, size: int) -> str:
    s = size
    if shape == "circle":
        return f"width:{s}px;height:{s}px;border-radius:50%;background:radial-gradient(circle at 35% 35%,{accent} 0 22%,{color} 23%)"
    if shape == "diamond":
        return f"width:{s}px;height:{s}px;transform:rotate(45deg) scale(.75);background:{color};border:{s // 8}px solid {accent}"
    if shape == "square":
        return f"width:{s}px;height:{s}px;border-radius:{s // 5}px;background:linear-gradient(135deg,{color} 50%,{accent} 50%)"
    if shape == "stripes":
        return f"width:{s}px;height:{s}px;background:repeating-linear-gradient(90deg,{color} 0 {s // 6}px,{accent} {s // 6}px {s // 3}px)"
    if shape == "ring":
        return f"width:{s}px;height:{s}px;border-radius:50%;border:{s // 5}px solid {color};box-shadow:inset 0 0 0 {s // 10}px {accent}"
    return (f"width:0;height:0;border-left:{s // 2}px solid transparent;border-right:{s // 2}px solid transparent;"
            f"border-bottom:{s}px solid {color};filter:drop-shadow(0 4px 0 {accent})")


def logo_png(shape: str, color: str, accent: str, name: str) -> str:
    """Logo + wordmark drawn as an image (phishing kits often use images so the text is not in the DOM)."""
    img = Image.new("RGB", (260, 64), "white")
    d = ImageDraw.Draw(img)
    if shape in ("circle", "ring"):
        d.ellipse([4, 4, 56, 56], fill=color, outline=accent, width=6)
    elif shape in ("square", "diamond"):
        d.rectangle([4, 4, 56, 56], fill=color, outline=accent, width=6)
    elif shape == "stripes":
        for i in range(0, 52, 13):
            d.rectangle([4 + i, 4, 10 + i, 56], fill=color)
    else:
        d.polygon([(30, 4), (56, 56), (4, 56)], fill=color, outline=accent)
    d.text((70, 22), name, fill=color)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def page(style: dict, r: random.Random, role: str) -> str:
    primary, accent, bg, font = style["primary"], style["accent"], style["bg"], style["font"]
    shift_x = shift_y = 0
    scale = 1.0
    if role == "clone":
        primary, accent, bg = jitter(primary, r, 0.4), jitter(accent, r, 0.4), jitter(bg, r, 0.2)
        shift_x, shift_y, scale = r.randint(-60, 60), r.randint(-40, 40), r.uniform(0.9, 1.1)
        if r.random() < 0.3:
            font = r.choice(FONTS)
    name = style["name"]
    use_img_logo = role == "clone" and r.random() < 0.6
    logo = (f'<img src="{logo_png(style["logo"], primary, accent, name)}" alt="" style="height:48px">' if use_img_logo
            else f'<div class="logo" style="{logo_css(style["logo"], primary, accent, 48)}"></div>'
                 f'<span class="word">{name if style.get("show_name", True) else ""}</span>')
    banner = ""
    if role == "clone" and r.random() < 0.5:
        banner = '<div class="warn">Verify your account within 24 hours to avoid suspension.</div>'
    elif role == "official" and r.random() < 0.3:
        banner = '<div class="note">We will never ask for your OTP over phone or email.</div>'
    form = ('<form action="/session" method="post"><label>User ID<input name="u" id="user"></label>'
            '<label>Password<input type="password" name="p" id="pass"></label>'
            f'<button type="submit">{r.choice(["Sign in", "Log in", "Continue"]) if role != "official" else "Sign in"}</button></form>')
    layout = style["layout"]
    css = f"""
    *{{box-sizing:border-box}} body{{margin:0;background:{bg};font-family:{font};color:#1b1b1b;height:100vh}}
    .wrap{{position:relative;left:{shift_x}px;top:{shift_y}px;transform:scale({scale:.3f});transform-origin:center top}}
    .brand{{display:flex;align-items:center;gap:14px;margin-bottom:18px}} .word{{font-size:26px;font-weight:700;color:{primary}}}
    form label{{display:block;margin:10px 0;font-size:14px}} input{{display:block;width:100%;padding:10px;margin-top:4px;
      border:1px solid {primary}55;border-radius:6px;font:inherit}}
    button{{margin-top:14px;width:100%;padding:12px;border:0;border-radius:6px;background:{primary};color:#fff;font-weight:700}}
    .warn{{background:#fde8e8;color:#9b1c1c;padding:8px;margin-bottom:10px;font-size:13px}}
    .note{{background:#eef;padding:8px;margin-bottom:10px;font-size:13px}}
    .card{{width:380px;margin:70px auto;background:#fff;padding:30px;border-radius:12px;box-shadow:0 8px 30px #0002;border-top:6px solid {accent}}}
    .split{{display:grid;grid-template-columns:1fr 1fr;height:100vh}} .split .side{{background:{primary}}}
    .split .main{{padding:120px 80px}} .left .main{{width:420px;margin-left:80px;padding-top:90px}}
    .banner .top{{height:120px;background:{primary};border-bottom:8px solid {accent}}} .banner .main{{width:400px;margin:-40px auto 0;background:#fff;padding:28px;border-radius:8px}}
    """
    inner = f'<div class="brand">{logo}</div>{banner}{form}'
    if layout == "card":
        body = f'<div class="wrap"><div class="card">{inner}</div></div>'
    elif layout == "split":
        body = f'<div class="wrap split"><div class="side"></div><div class="main">{inner}</div></div>'
    elif layout == "left":
        body = f'<div class="wrap left"><div class="main">{inner}</div></div>'
    else:
        body = f'<div class="wrap banner"><div class="top"></div><div class="main">{inner}</div></div>'
    return f"<!doctype html><html><head><meta charset='utf-8'><title>Sign in</title><style>{css}</style></head><body>{body}</body></html>"


def generic_style(r: random.Random, i: int) -> dict:
    return {"id": "other", "name": f"{r.choice(WORDS).title()}{r.choice(WORDS)}", "primary": f"#{r.randrange(0xFFFFFF):06x}",
            "accent": f"#{r.randrange(0xFFFFFF):06x}", "bg": r.choice(["#ffffff", "#f5f5f5", f"#{r.randrange(0xFFFFFF):06x}"]),
            "logo": r.choice(LOGOS), "layout": r.choice(LAYOUTS), "font": r.choice(FONTS), "show_name": r.random() < 0.8}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--official", type=int, default=12, help="official variants per brand")
    ap.add_argument("--clones", type=int, default=90, help="clone variants per brand")
    ap.add_argument("--generic", type=int, default=700)
    ap.add_argument("--decoys", type=int, default=60, help="per brand: same colours, different logo/name (negatives)")
    ap.add_argument("--seed", type=int, default=21)
    args = ap.parse_args()
    r = random.Random(args.seed)
    rows = []
    for b in BRANDS:
        for k in range(args.official):
            rows.append({"id": f"{b['id']}-official-{k}", "label": b["id"], "role": "official", "html": page(b, r, "official")})
        for k in range(args.clones):
            rows.append({"id": f"{b['id']}-clone-{k}", "label": b["id"], "role": "clone", "html": page(b, r, "clone")})
    for k in range(args.generic):
        rows.append({"id": f"generic-{k}", "label": "other", "role": "generic", "html": page(generic_style(r, k), r, "generic")})
    # Hard negatives: other organisations often share a brand's colours. Same palette, different
    # logo shape and name -> "other". Without these the model learned "green page = Lumora Bank".
    for b in BRANDS:
        for k in range(args.decoys):
            st = generic_style(r, k)
            st.update(primary=b["primary"], accent=b["accent"], bg=b["bg"],
                      logo=r.choice([x for x in LOGOS if x != b["logo"]]))
            rows.append({"id": f"decoy-{b['id']}-{k}", "label": "other", "role": "generic", "html": page(st, r, "generic")})
    # Deterministic split by id hash: 70% train, 15% val, 15% test (official pages: gallery uses train part).
    for row in rows:
        h = sum(map(ord, row["id"])) * 2654435761 % 100
        row["split"] = "train" if h < 70 else ("val" if h < 85 else "test")
    out = DATA / "visual" / "pages.jsonl"
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", encoding="utf-8") as fh:
        for row in rows:
            fh.write(json.dumps(row) + "\n")
    (SHARED / "visual_brands.json").write_text(json.dumps({
        "notes": "FICTIONAL brands used by the visual model demo gallery and tests. Replace with real official login-page captures in production (docs/HUMAN_TODO.md).",
        "brands": [{"id": b["id"], "name": b["name"], "official_domains": b["domains"]} for b in BRANDS]}, indent=2) + "\n")
    print(f"wrote {len(rows)} visual pages to {out}")


if __name__ == "__main__":
    main()
