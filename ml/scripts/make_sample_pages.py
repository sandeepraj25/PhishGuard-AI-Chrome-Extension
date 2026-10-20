"""Generate a SYNTHETIC page dataset (HTML) for the Layer 2 page model.

!!! Template-generated pages. Metrics on this data only show the pipeline works. Real pages
!!! come from the crawler (backend/src/workers/crawler.ts) and the labeling CLI.

Pages imitate login/checkout layouts of the FICTIONAL ExampleBank and of generic brands from
shared/brands.json by NAME ONLY (no real logos, CSS or markup are copied).
Output: ml/data/pages/pages.jsonl  — one {"url", "html", "label", "first_seen", "source"} per line.
"""
from __future__ import annotations

import argparse
import datetime as dt
import html
import json
import random

import _common  # noqa: F401
from phishguard_ml.paths import DATA, SHARED

WORDS = ("acme nova blue river green peak urban maple cedar orbit pixel lotus tiger delta harbor summit vista "
         "crest metro prime spark willow falcon ember atlas zenith coral north saffron monsoon kaveri seva").split()
URGENCY = json.loads((SHARED / "urgency_phrases.json").read_text(encoding="utf-8"))["languages"]
START, END = dt.date(2025, 1, 1), dt.date(2026, 9, 30)


class PageGen:
    def __init__(self, seed: int) -> None:
        self.r = random.Random(seed)
        self.brands = json.loads((SHARED / "brands.json").read_text(encoding="utf-8"))["brands"]

    def w(self) -> str:
        return self.r.choice(WORDS)

    def date(self) -> str:
        return (START + dt.timedelta(days=self.r.randint(0, (END - START).days))).isoformat()

    def links(self, host: str, n_internal: int, n_external: int, n_null: int, ext_hosts: list[str]) -> str:
        items = [f'<a href="/{self.w()}">{self.w()}</a>' for _ in range(n_internal)]
        items += [f'<a href="https://{self.r.choice(ext_hosts)}/{self.w()}">{self.w()}</a>' for _ in range(n_external)]
        items += ['<a href="#">' + self.w() + "</a>" if self.r.random() < 0.6 else '<a href="javascript:void(0)">x</a>'
                  for _ in range(n_null)]
        self.r.shuffle(items)
        return "<nav>" + " ".join(items) + "</nav>"

    def resources(self, own: list[str], other: list[str], n_own: int, n_other: int) -> str:
        out = []
        for _ in range(n_own):
            h = self.r.choice(own)
            out.append(self.r.choice([f'<script src="https://{h}/js/{self.w()}.js"></script>',
                                      f'<img src="https://{h}/img/{self.w()}.png" alt="">',
                                      f'<link rel="stylesheet" href="https://{h}/css/{self.w()}.css">']))
        for _ in range(n_other):
            h = self.r.choice(other)
            out.append(self.r.choice([f'<script src="https://{h}/{self.w()}.js"></script>',
                                      f'<img src="https://{h}/logo.png" alt="logo">']))
        return "\n".join(out)

    def form(self, action: str, method: str, kind: str, autocomplete_off: bool = False) -> str:
        ac = ' autocomplete="off"' if autocomplete_off else ""
        if kind == "login":
            fields = (f'<label>User ID <input name="user"></label>'
                      f'<label>Password <input type="password" name="pass"{ac}></label>')
        elif kind == "card":
            fields = ('<label>Card number <input name="cardnumber" autocomplete="cc-number"></label>'
                      '<label>CVV <input name="cvv" autocomplete="cc-csc"></label>')
        elif kind == "otp":
            fields = '<label>OTP <input name="otp" autocomplete="one-time-code"></label>'
        else:
            fields = '<label>Search <input type="search" name="q"></label>'
        act = f' action="{html.escape(action)}"' if action is not None else ""
        return f'<form method="{method}"{act}>{fields}<button>Continue</button></form>'

    def page(self, title: str, body: str, head_extra: str = "", body_attrs: str = "") -> str:
        return (f"<!doctype html><html><head><meta charset='utf-8'><title>{html.escape(title)}</title>{head_extra}"
                f"</head><body{body_attrs}>{body}</body></html>")

    # ---------------- legitimate ----------------
    def legit(self) -> dict:
        r = self.r
        kind = r.random()
        if kind < 0.45:  # brand's own login page on an official domain
            b = r.choice(self.brands)
            dom = r.choice(b["official_domains"])
            host = r.choice(["www.", "login.", "secure.", ""]) + dom
            sso = r.random() < 0.25 and len(b["official_domains"]) > 1
            action = f"https://{r.choice([d for d in b['official_domains'] if d != dom] or [dom])}/auth" if sso else \
                r.choice(["/login", "", "/session", f"https://{host}/auth"])
            title = f"{b['name'].split(' (')[0]} - Sign in"
            body = (f"<h1>{html.escape(b['name'].split(' (')[0])}</h1>"
                    + self.form(action, "post", r.choice(["login", "login", "otp"]))
                    + self.links(host, r.randint(5, 25), r.randint(0, 4), r.randint(0, 2), ["help.example.org", f"m.{dom}"])
                    + self.resources([host, f"static.{dom}"], ["cdn.jsdelivr.net", "fonts.gstatic.com"],
                                     r.randint(3, 12), r.randint(0, 3))
                    + ("<p>We will never ask for your OTP. Report unusual activity to support.</p>" if r.random() < 0.3 else ""))
            url = f"https://{host}/login"
        elif kind < 0.75:  # generic site login (forum, shop) without brand
            name = f"{self.w()}{self.w()}"
            host = f"www.{name}.{r.choice(['com', 'in', 'org', 'co.in', 'net'])}"
            title = f"{name.title()} | Log in"
            body = (self.form(r.choice(["/login", "", f"https://{host}/account/login"]), r.choice(["post", "post", "get"]),
                              "login", r.random() < 0.1)
                    + self.links(host, r.randint(8, 40), r.randint(0, 8), r.randint(0, 5),
                                 ["twitter.example", "facebook.example", "blog.example.net"])
                    + self.resources([host], ["cdn.jsdelivr.net", "www.googletagmanager.com", "fonts.googleapis.com"],
                                     r.randint(2, 10), r.randint(1, 5))
                    + f"<p>{' '.join(self.w() for _ in range(r.randint(20, 200)))}</p>"
                    + (f"<button>Sign in with {r.choice(['Google', 'Microsoft', 'Apple', 'Facebook'])}</button>"
                       if r.random() < 0.35 else ""))
            url = f"https://{host}/login"
        else:  # checkout with card form posting to a payment provider (legit external action)
            name = f"{self.w()}{r.choice(['store', 'shop', 'mart', 'bazaar'])}"
            host = f"www.{name}.{r.choice(['com', 'in', 'co.in'])}"
            title = f"Checkout - {name.title()}"
            body = (self.form(r.choice(["/pay", f"https://checkout.{r.choice(['paygate', 'payflow', 'razor'])}.example/pay"]),
                              "post", "card")
                    + self.links(host, r.randint(5, 20), r.randint(0, 3), r.randint(0, 3), ["help.example.org"])
                    + self.resources([host], ["js.payflow.example", "cdn.jsdelivr.net"], r.randint(2, 8), r.randint(1, 3))
                    + (f"<p>We accept {', '.join(r.sample(['PayPal', 'Paytm', 'PhonePe', 'Google Pay', 'MobiKwik', 'Amazon Pay'], 3))}."
                       f" Delivery by {r.choice(['Delhivery', 'Blue Dart', 'DTDC', 'India Post'])}.</p>" if r.random() < 0.6 else ""))
            url = f"https://{host}/checkout"
        return {"url": url, "html": self.page(title, body), "label": 0, "first_seen": self.date(), "source": "synthetic-legit"}

    # ---------------- phishing ----------------
    def phish(self) -> dict:
        r = self.r
        b = r.choice(self.brands + [x for x in self.brands if x["id"] == "examplebank"] * 4)
        bname = b["name"].split(" (")[0]
        tok = r.choice(b["tokens"])
        host = r.choice([f"{tok}-{self.w()}.{r.choice(['xyz', 'top', 'online', 'com', 'in'])}",
                         f"{self.w()}{self.w()}.{r.choice(['com', 'net', 'org'])}",
                         f"{self.w()}-{r.choice(['secure', 'verify', 'login'])}.{r.choice(['site', 'live', 'shop'])}",
                         f"{tok}{r.randint(1, 99)}.{r.choice(['web.app', 'pages.dev', 'netlify.app'])}"])
        lang = r.choice(["en", "en", "en", "hi", "pt", "id", "es"])
        urgent = " ".join(r.sample(URGENCY[lang], k=r.randint(0, 3)))
        collector = r.choice([f"https://{self.w()}{r.randint(10, 999)}.{r.choice(['ru', 'top', 'xyz', 'com'])}/post.php",
                              "/next.php", "", f"https://{host}/verify.php", "mailto:drop@example.net",
                              f"http://{r.randint(11, 223)}.{r.randint(0, 255)}.{r.randint(0, 255)}.{r.randint(1, 254)}/g.php"])
        kind = r.choice(["login", "login", "login", "card", "otp"])
        hidden = '<iframe src="https://track.example/p" width="1" height="1" style="display:none"></iframe>' \
            if r.random() < 0.15 else ""
        brand_res = self.resources([host], [r.choice(b["official_domains"])], r.randint(0, 3),
                                   r.randint(0, 3) if r.random() < 0.5 else 0)
        generic = r.random() < 0.2  # brandless lures: "webmail", "shared document"
        if generic:
            bname = r.choice(["Webmail", "Document Portal", "Secure Message", "Mailbox Upgrade"])
        title = r.choice([f"{bname} - Sign in", f"{bname} | Verify your account", f"{bname} Online Banking",
                          "Sign in", f"{bname}"])
        body = (f"<h1>{html.escape(bname)}</h1><p class='urgent'>{html.escape(urgent)}</p>"
                + self.form(collector, r.choice(["post", "post", "post", "get"]), kind, r.random() < 0.3)
                + self.links(host, r.randint(0, 4), r.randint(0, 6), r.randint(0, 15),
                             [r.choice(b["official_domains"]), "help.example.org"])
                + brand_res + hidden
                + (f"<p>{' '.join(self.w() for _ in range(r.randint(0, 40)))}</p>" if r.random() < 0.5 else ""))
        attrs = ' oncontextmenu="return false"' if r.random() < 0.2 else ""
        return {"url": f"http://{host}/{r.choice(['login', 'secure/verify', 'index.html', ''])}",
                "html": self.page(title, body, body_attrs=attrs), "label": 1, "first_seen": self.date(),
                "source": "synthetic-phish"}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--legit", type=int, default=3000)
    ap.add_argument("--phish", type=int, default=2000)
    ap.add_argument("--seed", type=int, default=11)
    args = ap.parse_args()
    g = PageGen(args.seed)
    rows = [g.legit() for _ in range(args.legit)] + [g.phish() for _ in range(args.phish)]
    rows.sort(key=lambda x: (x["first_seen"], x["url"]))
    out = DATA / "pages" / "pages.jsonl"
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", encoding="utf-8") as fh:
        for row in rows:
            fh.write(json.dumps(row, ensure_ascii=False) + "\n")
    print(f"wrote {len(rows)} synthetic pages to {out}")


if __name__ == "__main__":
    main()
