"""Robustness evaluation: scripted attacks on held-out phishing URLs -> recall before/after.

Operating point is FIXED from the clean test set (threshold at 0.1% FPR on legitimate URLs, and
the product threshold score > 60), so false positives stay constant while we measure how many
phishing URLs survive each attack.

Attacks (each applied to every phishing URL in the test split):
  homoglyph_swap   replace one letter of the brand/registrable label with a Cyrillic look-alike (punycode)
  extra_subdomains prepend "secure.login.verify." to the host
  typo             one random edit (substitute / delete / swap / insert) in the registrable label
  brand_in_path    move the brand to the path of a neutral-looking domain
  evasion_clean    attacker removes suspicious words from the path and moves to .com (should HURT recall)
Writes ml/results/robustness.json.
"""
from __future__ import annotations

import argparse
import json
import random
from pathlib import Path

import numpy as np
import onnxruntime as ort

import _common  # noqa: F401
from phishguard_ml.data import PROCESSED, UrlRecord, dataset_kind, read_records
from phishguard_ml.features import default_engine
from phishguard_ml.meta import run_meta
from phishguard_ml.metrics import recall_at_fpr
from phishguard_ml.paths import MODELS, RESULTS
from phishguard_ml.rules import combined_score, rules_score
from phishguard_ml.split import time_domain_split
from phishguard_ml.train import featurize
from phishguard_ml.urlparse import parse_url

CYR = {"a": "а", "e": "е", "o": "о", "p": "р", "c": "с", "x": "х", "i": "і"}
NEUTRAL = ["cedarworks", "bluemaple", "northriver", "pixelharbor", "summitlabs"]
SUSPICIOUS = ["login", "signin", "verify", "secure", "account", "update", "confirm", "kyc", "wallet", "auth",
              "session", "token", "billing", "payment", "suspended", "refund", "upi", "tracking", "parcel"]


def split_host(url: str) -> tuple[str, str, str]:
    u = parse_url(url)
    rest = url.split(u.host, 1)[1] if u.host and u.host in url else "/"
    return (u.scheme or "http"), u.host, rest


def registrable_label(host: str) -> tuple[str, str, str]:
    """(subdomain prefix incl. dot, registrable label, '.suffix')."""
    eng = default_engine()
    reg = eng.psl.registered_domain(host)
    if not reg or reg == host and "." not in host:
        return "", host, ""
    label, _, suffix = reg.partition(".")
    prefix = host[: len(host) - len(reg)]
    return prefix, label, "." + suffix


def homoglyph_swap(url: str, r: random.Random) -> str:
    scheme, host, rest = split_host(url)
    prefix, label, suffix = registrable_label(host)
    _, det = default_engine().extract(url)
    target = det.matched if det.kind == "host" and det.matched and det.matched in label else label
    idx = [i for i, ch in enumerate(label) if ch in CYR and label.find(target) <= i < label.find(target) + len(target)]
    if not idx or label.startswith("xn--"):
        return url
    i = r.choice(idx)
    uni = label[:i] + CYR[label[i]] + label[i + 1:]
    return f"{scheme}://{prefix}xn--{uni.encode('punycode').decode()}{suffix}{rest}"


def extra_subdomains(url: str, r: random.Random) -> str:
    scheme, host, rest = split_host(url)
    return f"{scheme}://secure.login.verify.{host}{rest}"


def typo(url: str, r: random.Random) -> str:
    scheme, host, rest = split_host(url)
    prefix, label, suffix = registrable_label(host)
    if len(label) < 4 or label.startswith("xn--"):
        return url
    i = r.randrange(len(label) - 1)
    op = r.choice(["sub", "del", "swap", "ins"])
    if op == "sub":
        label = label[:i] + r.choice("abcdefghijklmnopqrstuvwxyz") + label[i + 1:]
    elif op == "del":
        label = label[:i] + label[i + 1:]
    elif op == "swap":
        label = label[:i] + label[i + 1] + label[i] + label[i + 2:]
    else:
        label = label[:i] + r.choice("abcdefghijklmnopqrstuvwxyz") + label[i:]
    return f"{scheme}://{prefix}{label}{suffix}{rest}"


def brand_in_path(url: str, r: random.Random) -> str:
    _, det = default_engine().extract(url)
    brand = det.matched if det.kind in ("host", "path") and det.matched else (det.brand or "account")
    scheme, _, rest = split_host(url)
    return f"{scheme}://www.{r.choice(NEUTRAL)}.com/{brand}{rest if rest.startswith('/') else '/' + rest}"


def evasion_clean(url: str, r: random.Random) -> str:
    scheme, host, rest = split_host(url)
    prefix, label, _ = registrable_label(host)
    for w in SUSPICIOUS:
        rest = rest.replace(w, r.choice(["home", "page", "info", "docs"]))
    return f"https://{prefix}{label}.com{rest}"


ATTACKS = {"homoglyph_swap": homoglyph_swap, "extra_subdomains": extra_subdomains, "typo": typo,
           "brand_in_path": brand_in_path, "evasion_clean": evasion_clean}


def scores(sess: ort.InferenceSession, recs: list[UrlRecord]) -> dict[str, np.ndarray]:
    X, _ = featurize(recs)
    p = sess.run(None, {"input": X.astype(np.float32)})[1][:, 1]
    return {"rules_baseline": np.array([rules_score(list(x)) for x in X]),
            "model_onnx": 100.0 * p,
            "combined_shipped": np.array([combined_score(float(pp), list(x)) for pp, x in zip(p, X)])}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", type=Path, default=PROCESSED)
    ap.add_argument("--model", type=Path, default=MODELS / "url_model.onnx")
    ap.add_argument("--seed", type=int, default=13)
    args = ap.parse_args()
    records = read_records(args.data)
    test = time_domain_split(records).test
    legit = [r for r in test if r.label == 0]
    phish = [r for r in test if r.label == 1]
    sess = ort.InferenceSession(str(args.model), providers=["CPUExecutionProvider"])
    s_legit, s_phish = scores(sess, legit), scores(sess, phish)

    out: dict = {**run_meta("ml/scripts/eval_robustness.py", args.data, dataset_kind(records)),
                 "phishing_urls": len(phish), "legit_urls": len(legit), "attacks": {}}
    thresholds = {}
    for k in s_legit:
        y = np.concatenate([np.zeros(len(legit)), np.ones(len(phish))])
        thresholds[k] = recall_at_fpr(y, np.concatenate([s_legit[k], s_phish[k]]), 0.001)["threshold"]
    out["thresholds_at_0.1pct_fpr"] = thresholds
    for name, fn in ATTACKS.items():
        r = random.Random(args.seed)
        attacked = [UrlRecord(fn(x.url, r), 1, x.first_seen, x.source, "", x.domain_age_days, x.cert_age_days)
                    for x in phish]
        changed = sum(a.url != b.url for a, b in zip(attacked, phish))
        s_att = scores(sess, attacked)
        res = {"urls_changed": changed, "examples": [a.url for a, b in zip(attacked, phish) if a.url != b.url][:3]}
        for k in s_att:
            for label, thr in (("at_0.1pct_fpr", thresholds[k]), ("score_gt_60", 60.0)):
                before = float(np.mean(s_phish[k] > thr))
                after = float(np.mean(s_att[k] > thr))
                res.setdefault(k, {})[label] = {"recall_before": before, "recall_after": after, "delta": after - before}
        out["attacks"][name] = res
        print(f"{name:17s} changed={changed:5d}  " + "  ".join(
            f"{k}: {res[k]['score_gt_60']['recall_before']:.3f}->{res[k]['score_gt_60']['recall_after']:.3f}"
            for k in ("rules_baseline", "model_onnx", "combined_shipped")))
    worst = min(out["attacks"].items(), key=lambda kv: kv[1]["combined_shipped"]["score_gt_60"]["recall_after"])
    out["summary_line"] = (
        f"worst attack for the shipped score: {worst[0]} (recall at score > 60 "
        f"{100 * worst[1]['combined_shipped']['score_gt_60']['recall_before']:.1f}% → "
        f"{100 * worst[1]['combined_shipped']['score_gt_60']['recall_after']:.1f}%) on {len(phish)} "
        f"{dataset_kind(records)} phishing URLs; full table in the JSON.")
    RESULTS.mkdir(parents=True, exist_ok=True)
    (RESULTS / "robustness.json").write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n")
    print(out["summary_line"])


if __name__ == "__main__":
    main()
