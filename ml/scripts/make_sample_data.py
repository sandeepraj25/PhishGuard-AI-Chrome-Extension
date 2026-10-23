"""Generate a SYNTHETIC sample dataset so the whole pipeline runs offline.

!!! These URLs are generated from templates. Metrics computed on them describe how well the
!!! model learns the generator, NOT real-world phishing detection. Every result file produced
!!! from this data records "dataset": "synthetic-sample" and the README shows that label.

Design goals (so the pipeline is exercised realistically):
* Several URLs per registered domain (campaigns, multi-page sites) -> grouped split matters.
* first_seen spread over 2025-01 .. 2026-09 with drift (later phishing uses more homoglyphs
  and hosting platforms) -> the time split is harder than a random split.
* Overlap between classes: legit login pages, legit sites on "risky" TLDs, legit hyphenated
  domains; phishing on compromised ordinary-looking sites with no brand signal.
* Domain/cert age known for only ~30% of rows, with overlapping distributions.

Output: ml/data/processed/urls.csv (+ ml/data/processed/edge_cases.txt for the parity test).
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import random

import _common  # noqa: F401
from phishguard_ml.data import PROCESSED, UrlRecord, write_records
from phishguard_ml.features import default_engine
from phishguard_ml.paths import SHARED

WORDS = ("acme nova blue river green peak urban maple cedar orbit pixel lotus tiger delta sunrise harbor "
         "summit vista crest metro prime spark willow falcon ember atlas zenith coral north quill raven "
         "saffron tulsi monsoon ganga kaveri sahyadri chai masala bazaar kirana vidya gyan seva "
         "craft studio labs works foods books travel health school media cloud store market news").split()
LEGIT_TLDS = ["com"] * 8 + ["in"] * 3 + ["co.in"] * 3 + ["org"] * 2 + ["net", "io", "co", "edu", "gov.in", "com.br",
                                                                          "co.id", "es", "de", "xyz", "online", "app"]
PHISH_TLDS = ["com"] * 4 + ["xyz", "top", "online", "site", "icu", "shop", "live", "info", "in", "co.in", "cfd",
                            "sbs", "click", "net", "org", "tk", "ml", "buzz", "rest", "support"]
LEGIT_PATHS = ["/", "/", "/", "/about", "/contact", "/products/{w}", "/blog/{w}-{n}", "/category/{w}/{w}",
               "/search?q={w}", "/login", "/account/settings", "/help/{w}", "/{w}.html", "/docs/v{n}/{w}",
               "/news/2025/{n}/{w}", "/cart?item={n}&qty=1", "/static/{w}.css"]
PHISH_PATHS = ["/", "/login", "/signin.php", "/verify/account", "/secure/update.html", "/{w}/login.php",
               "/wp-content/{w}/index.php", "/kyc-update", "/{b}/auth/?session={h}", "/confirm?id={h}&token={h}",
               "/billing/payment", "/account/suspended", "/{h}/", "/upi/refund", "/parcel/tracking?id={n}",
               "/rekening/verifikasi", "/conta/atualizar", "/cuenta/verificar"]
HOSTING = ["web.app", "firebaseapp.com", "pages.dev", "netlify.app", "vercel.app", "github.io", "glitch.me",
           "herokuapp.com", "blogspot.com", "weebly.com", "wixsite.com", "000webhostapp.com"]
CYRILLIC = {"a": "\u0430", "e": "\u0435", "o": "\u043e", "p": "\u0440", "c": "\u0441", "x": "\u0445", "i": "\u0456"}
TYPO = {"l": "1", "o": "0", "m": "rn", "w": "vv", "i": "l", "a": "4", "e": "3"}

START = dt.date(2025, 1, 1)
END = dt.date(2026, 9, 30)


class Gen:
    def __init__(self, seed: int) -> None:
        self.r = random.Random(seed)
        brands = json.loads((SHARED / "brands.json").read_text(encoding="utf-8"))["brands"]
        self.brands = [b for b in brands if b["id"] != "examplebank"] + [b for b in brands if b["id"] == "examplebank"] * 3

    # ---------- small helpers ----------
    def word(self) -> str:
        return self.r.choice(WORDS)

    def hexs(self, n: int = 8) -> str:
        return "".join(self.r.choice("0123456789abcdef") for _ in range(n))

    def date(self, bias_late: float = 0.0) -> str:
        span = (END - START).days
        x = self.r.random() ** (1.0 / (1.0 + bias_late)) if bias_late > 0 else self.r.random()
        return (START + dt.timedelta(days=int(x * span))).isoformat()

    def fill(self, template: str, brand_token: str = "") -> str:
        out = template
        while "{w}" in out:
            out = out.replace("{w}", self.word(), 1)
        while "{n}" in out:
            out = out.replace("{n}", str(self.r.randint(1, 999)), 1)
        while "{h}" in out:
            out = out.replace("{h}", self.hexs(self.r.choice([6, 12, 24])), 1)
        return out.replace("{b}", brand_token or self.word())

    def ages(self, phish: bool) -> tuple[float, float]:
        if self.r.random() > 0.3:
            return -1.0, -1.0
        if phish:
            dom = self.r.choice([self.r.uniform(0, 30), self.r.uniform(0, 400), self.r.uniform(200, 3000)])
            cert = min(dom, self.r.uniform(0, 60))
        else:
            dom = self.r.choice([self.r.uniform(30, 365), self.r.uniform(365, 9000), self.r.uniform(365, 9000)])
            cert = self.r.uniform(0, 300)
        return round(dom, 1), round(cert, 1)

    def scheme(self, phish: bool) -> str:
        return "https" if self.r.random() < (0.85 if phish else 0.97) else "http"

    # ---------- legitimate ----------
    def legit_site(self) -> list[UrlRecord]:
        r = self.r
        kind = r.random()
        if kind < 0.12:  # official brand site with login pages (hard negatives)
            b = r.choice(self.brands)
            domain = r.choice(b["official_domains"])
            subs = ["www", "login", "accounts", "secure", "netbanking", "m", ""]
        else:
            name = self.word() + (r.choice(["", "", "-", ""]) + self.word() if r.random() < 0.6 else "")
            if r.random() < 0.08:
                name += str(r.randint(1, 99))
            domain = f"{name}.{r.choice(LEGIT_TLDS)}"
            subs = ["www", "www", "", "shop", "blog", "mail", "app", "docs", "support"]
        first = self.date()
        dom_age, cert_age = self.ages(False)
        out = []
        for _ in range(r.randint(1, 6)):
            sub = r.choice(subs)
            host = f"{sub}.{domain}" if sub else domain
            path = self.fill(r.choice(LEGIT_PATHS))
            d = (dt.date.fromisoformat(first) + dt.timedelta(days=r.randint(0, 60))).isoformat()
            out.append(UrlRecord(f"{self.scheme(False)}://{host}{path}", 0, min(d, END.isoformat()),
                                 "synthetic-legit", "", dom_age, cert_age))
        return out

    # ---------- phishing ----------
    def homoglyph(self, token: str) -> str:
        chars = [i for i, c in enumerate(token) if c in CYRILLIC]
        if not chars:
            # No letter has a look-alike (e.g. "dhl"): returning the token unchanged would create
            # the brand's REAL domain as a "phishing" example. Use a typo instead.
            return self.typo(token)
        i = self.r.choice(chars)
        label = token[:i] + CYRILLIC[token[i]] + token[i + 1:]
        return "xn--" + label.encode("punycode").decode("ascii")

    def typo(self, token: str) -> str:
        r = self.r
        op = r.random()
        cands = [i for i, c in enumerate(token) if c in TYPO]
        if op < 0.4 and cands:
            i = r.choice(cands)
            return token[:i] + TYPO[token[i]] + token[i + 1:]
        if op < 0.6 and len(token) > 4:
            i = r.randrange(len(token))
            return token[:i] + token[i + 1:]
        if op < 0.8 and len(token) > 3:
            i = r.randrange(len(token) - 1)
            return token[:i] + token[i + 1] + token[i] + token[i + 2:]
        i = r.randrange(len(token) + 1)
        return token[:i] + r.choice("abcdefghijklmnopqrstuvwxyz") + token[i:]

    def phish_campaign(self) -> list[UrlRecord]:
        r = self.r
        b = r.choice(self.brands)
        tok = r.choice(b["tokens"])
        first = self.date(bias_late=0.6)
        late = first >= "2026-01-01"
        style = r.random()
        tld = r.choice(PHISH_TLDS)
        if style < (0.20 if not late else 0.12):     # brand in subdomain of attacker domain
            domain = f"{self.word()}-{r.choice(['secure', 'login', 'verify', 'auth', 'online'])}.{tld}"
            host_fn = lambda: f"{tok}.{r.choice(['com', 'in', 'co.in', 'test', 'net'])}.{domain}"
        elif style < 0.38:                            # brand + keyword in registered label
            domain = f"{tok}-{r.choice(['kyc', 'update', 'secure', 'rewards', 'help', 'login', 'care'])}.{tld}"
            host_fn = lambda: r.choice(["", "www.", "m."]) + domain
        elif style < (0.52 if not late else 0.45):   # typosquat
            domain = f"{self.typo(tok)}.{tld}"
            host_fn = lambda: r.choice(["", "www.", "login."]) + domain
        elif style < (0.58 if not late else 0.62):   # homoglyph / punycode (more frequent later)
            domain = f"{self.homoglyph(tok)}.{r.choice(['com', 'net', tld])}"
            host_fn = lambda: r.choice(["", "www."]) + domain
        elif style < (0.68 if not late else 0.78):   # free hosting platform (more frequent later)
            domain = f"{tok}-{self.word()}{r.randint(1, 999)}.{r.choice(HOSTING)}"
            host_fn = lambda: domain
        elif style < 0.80:                            # compromised ordinary site, brand in path
            domain = f"{self.word()}{self.word()}.{r.choice(LEGIT_TLDS)}"
            host_fn = lambda: r.choice(["", "www."]) + domain
        elif style < 0.86:                            # IP host
            domain = f"{r.randint(11, 223)}.{r.randint(0, 255)}.{r.randint(0, 255)}.{r.randint(1, 254)}"
            host_fn = lambda: domain + (r.choice(["", ":8080", ":8443"]))
        else:                                         # random-looking domain, no brand signal
            domain = f"{self.hexs(r.randint(6, 14))}.{tld}" if r.random() < 0.5 else f"{self.word()}{r.randint(10, 9999)}.{tld}"
            host_fn = lambda: r.choice(["", "www.", "secure."]) + domain
        dom_age, cert_age = self.ages(True)
        out = []
        for _ in range(r.randint(1, 4)):
            path = self.fill(r.choice(PHISH_PATHS), tok)
            if style >= 0.68 and style < 0.80:
                path = f"/{r.choice(['wp-includes', 'images', 'tmp', self.word()])}/{tok}{path}"
            userinfo = f"{tok}.com@" if r.random() < 0.03 else ""
            d = (dt.date.fromisoformat(first) + dt.timedelta(days=r.randint(0, 5))).isoformat()
            out.append(UrlRecord(f"{self.scheme(True)}://{userinfo}{host_fn()}{path}", 1, min(d, END.isoformat()),
                                 "synthetic-phish", "", dom_age, cert_age))
        return out


EDGE_CASES = [
    "", " ", "://", "http://", "https://", "@@@", "http://[", "http://[::1", "http://[::1]:99999/x", "xn--",
    "http://xn--/", "http://xn--80ak6aa92e.com/", "http://xn--80ak6aa92e/", "http://xn--zzzzzzzzzzzzzzzz.com/",
    "http://a..b/", "http://..../", "HTTP://EXAMPLEBANK.TEST.EVIL.COM/LOGIN", "examplebank.test",
    "//examplebank.test/x", "http://user:pass@host.com:80/", "http://host.com:443", "http://host.com:/x",
    "http://3232235777/", "http://1.2.3.4.5/", "http://999.999.999.999/", "http://0x7f.0.0.1/",
    "https://example.com/caf\u00e9?q=\u00fc", "https://ex\u00e4mple.com/", "https://\u0440\u0430ypal.com/",
    "https://www.\u0441\u0431\u0435\u0440.\u0440\u0444/", "https://\u0928\u092e\u0938\u094d\u0924\u0947.\u092d\u093e\u0930\u0924/",
    "https://xn--h2brj9c.xn--h2brj9c/", "https://a.b.c.d.e.f.g.h.i.j.k.example.co.uk/a/b/c/d/e/f",
    "https://paypa1.com/", "https://rnicrosoft.com/", "https://vvhatsapp.com/", "https://g00gle.com/",
    "https://onlinesbi.sbi.kyc-update.xyz/", "https://hdfc-netbanking.in/", "https://sbi.co.in/", "https://ups.com/",
    "https://groups.example.com/", "https://login.microsoftonline.com/common/oauth2/authorize?client_id=1&x=2",
    "https://\t\nexample.com/\x7f", "http://example.com/#frag?notquery", "http://example.com?q=1#f",
    "http://example.com/" + "a" * 3000, "ftp://files.example.com/", "javascript:alert(1)", "data:text/html,hi",
    "mailto:a@b.com", "http://example.com/%00%ff", "http://exa mple.com/", "http://example.com:8080@evil.com/",
    "https://axis.bank.in/login", "https://evil.web.app/examplebank", "https://www.ck/", "https://a.b.ck/",
]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--legit-sites", type=int, default=6000)
    ap.add_argument("--phish-campaigns", type=int, default=4500)
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()
    g = Gen(args.seed)
    recs: list[UrlRecord] = []
    for _ in range(args.legit_sites):
        recs += g.legit_site()
    for _ in range(args.phish_campaigns):
        recs += g.phish_campaign()
    eng = default_engine()
    uniq: dict[str, UrlRecord] = {}
    for r in recs:
        r.registered_domain = eng.registered_domain(r.url)
        uniq.setdefault(r.url, r)
    # Same rule as clean_dedupe.py: a domain with phishing URLs has no legit rows.
    # Safety net: a brand's official domain must never be labelled phishing.
    official = {d for b in json.loads((SHARED / "brands.json").read_text(encoding="utf-8"))["brands"]
                for d in b["official_domains"]}
    uniq = {u: r for u, r in uniq.items() if not (r.label == 1 and r.registered_domain in official)}
    phish_domains = {r.registered_domain for r in uniq.values() if r.label == 1}
    final = [r for r in uniq.values() if r.label == 1 or r.registered_domain not in phish_domains]
    final.sort(key=lambda r: (r.first_seen, r.url))
    write_records(PROCESSED, final)
    (PROCESSED.parent / "edge_cases.txt").write_text(
        "\n".join(e.replace("\n", "\\n").replace("\t", "\\t") for e in EDGE_CASES) + "\n", encoding="utf-8")
    n_phish = sum(r.label for r in final)
    print(f"wrote {len(final)} synthetic records ({n_phish} phishing, {len(final) - n_phish} legit) to {PROCESSED}")


if __name__ == "__main__":
    main()
