"""Train the Layer-3 visual embedding model, export ONNX (fp32 + int8), build the reference gallery.

Model: MobileNetV3-small backbone (width 0.75, trained from scratch — pretrained ImageNet weights
could not be downloaded in the build environment; swap them in for real use), global average
pool, 128-d L2-normalised embedding, cosine classifier (NormFace) over brands + "other".
Input: raw RGB 0..255 floats [N,3,112,112] produced by extension/src/lib/visualprep.ts; the
normalisation is inside the network so the browser never has to replicate it.

Inference in the extension: cosine(embedding, gallery) -> best brand; if similarity >= threshold
and the page's registered domain is not that brand's official domain -> "looks like brand X".

Writes: ml/models/visual_model{,.int8}.onnx, extension/public/models/{visual_model.onnx,visual_gallery.json},
ml/results/visual_eval.json.
"""
from __future__ import annotations

import argparse
import csv
import json
import shutil
import time
from pathlib import Path

import numpy as np
import onnxruntime as ort
import torch
import torch.nn.functional as F
from PIL import Image
from torch import nn
from torchvision.models.mobilenetv3 import MobileNetV3, _mobilenet_v3_conf

import _common  # noqa: F401
from phishguard_ml.meta import git_commit, run_meta
from phishguard_ml.paths import DATA, EXTENSION_PUBLIC, MODELS, RESULTS, SHARED

VIS = DATA / "visual"
SIZE = 160
EMB = 128
MEAN = torch.tensor([0.485, 0.456, 0.406]).view(1, 3, 1, 1) * 255
STD = torch.tensor([0.229, 0.224, 0.225]).view(1, 3, 1, 1) * 255


class VisualNet(nn.Module):
    def __init__(self, n_classes: int, width: float = 0.75) -> None:
        super().__init__()
        setting, last = _mobilenet_v3_conf("mobilenet_v3_small", width_mult=width)
        backbone = MobileNetV3(setting, last, num_classes=1)
        self.features = backbone.features
        feat_dim = setting[-1].out_channels * 6  # last 1x1 conv expands 6x in MobileNetV3-small
        self.embed = nn.Linear(feat_dim, EMB)
        self.cls = nn.Parameter(torch.randn(n_classes, EMB) * 0.01)
        self.scale = 24.0

    def embedding(self, x: torch.Tensor) -> torch.Tensor:
        x = (x - MEAN) / STD
        x = self.features(x)
        x = F.adaptive_avg_pool2d(x, 1).flatten(1)
        return F.normalize(self.embed(x), dim=1)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.scale * self.embedding(x) @ F.normalize(self.cls, dim=1).t()


class EmbeddingOnly(nn.Module):
    def __init__(self, net: VisualNet) -> None:
        super().__init__()
        self.net = net

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net.embedding(x)


def load_split() -> tuple[dict[str, list], list[str]]:
    rows = list(csv.DictReader((VIS / "index.csv").open()))
    classes = sorted({r["label"] for r in rows if r["label"] != "other"}) + ["other"]
    data: dict[str, list] = {"train": [], "val": [], "test": []}
    for r in rows:
        img = np.asarray(Image.open(VIS / r["path"]).convert("RGB"), dtype=np.uint8)
        data[r["split"]].append((img, classes.index(r["label"]), r["role"], r["id"]))
    return data, classes


def to_tensor(items: list) -> torch.Tensor:
    return torch.from_numpy(np.stack([it[0] for it in items])).permute(0, 3, 1, 2).float()


def augment(x: torch.Tensor, g: torch.Generator) -> torch.Tensor:
    """Phishing kits copy a look imperfectly: small shifts, scale, colour and brightness changes."""
    n = x.shape[0]
    pad = 8
    xp = F.pad(x, (pad, pad, pad, pad), mode="replicate")
    out = torch.empty_like(x)
    for i in range(n):
        s = float(torch.empty(1).uniform_(0.88, 1.0, generator=g))
        side = int((SIZE + 2 * pad) * s)
        ox = int(torch.randint(0, SIZE + 2 * pad - side + 1, (1,), generator=g))
        oy = int(torch.randint(0, SIZE + 2 * pad - side + 1, (1,), generator=g))
        crop = xp[i:i + 1, :, oy:oy + side, ox:ox + side]
        out[i] = F.interpolate(crop, size=(SIZE, SIZE), mode="bilinear", align_corners=False)[0]
    gain = torch.empty(n, 1, 1, 1).uniform_(0.85, 1.15, generator=g)
    bias = torch.empty(n, 1, 1, 1).uniform_(-20, 20, generator=g)
    chan = torch.empty(n, 3, 1, 1).uniform_(0.92, 1.08, generator=g)
    return (out * gain * chan + bias).clamp(0, 255)


@torch.no_grad()
def recalibrate_bn(net: VisualNet, X: torch.Tensor, g: torch.Generator, passes: int = 3) -> None:
    """Recompute BatchNorm running statistics with the final weights.

    torchvision's MobileNetV3 uses BN momentum 0.01, so after a short training run the running
    mean/var still mostly reflect the early (random) weights and eval-mode outputs collapse.
    Cumulative averaging (momentum=None) over the training set fixes that.
    """
    bns = [m for m in net.modules() if isinstance(m, nn.BatchNorm2d)]
    for m in bns:
        m.reset_running_stats()
        m.momentum = None
    net.train()
    for _ in range(passes):
        for b in range(0, len(X), 64):
            net.embedding(augment(X[b:b + 64], g))
    net.eval()


def train(data: dict, n_classes: int, epochs: int, seed: int) -> VisualNet:
    torch.manual_seed(seed)
    g = torch.Generator().manual_seed(seed)
    net = VisualNet(n_classes)
    X = to_tensor(data["train"])
    y = torch.tensor([it[1] for it in data["train"]])
    counts = torch.bincount(y, minlength=n_classes).float()
    # Square-root re-weighting. Fully balanced sampling showed the very diverse "other" class only
    # 1/7 of the time, so the net learned "this layout = that brand" and matched ~40% of unrelated
    # login pages to a brand. sqrt keeps negatives frequent while still boosting small classes.
    weights = (1.0 / counts.sqrt())[y]
    opt = torch.optim.AdamW(net.parameters(), lr=3e-3, weight_decay=1e-4)
    steps = epochs * (len(X) // 64 + 1)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=3e-3, total_steps=steps)
    Xv, yv = to_tensor(data["val"]), torch.tensor([it[1] for it in data["val"]])
    for ep in range(epochs):
        net.train()
        idx = torch.multinomial(weights, len(X), replacement=True, generator=g)
        total = 0.0
        for b in range(0, len(idx), 64):
            bi = idx[b:b + 64]
            loss = F.cross_entropy(net(augment(X[bi], g)), y[bi])
            opt.zero_grad()
            loss.backward()
            opt.step()
            sched.step()
            total += float(loss) * len(bi)
        if ep == epochs - 1 or (ep + 1) % 6 == 0:
            recalibrate_bn(net, X, g)
            with torch.no_grad():
                acc = float((net(Xv).argmax(1) == yv).float().mean())
            print(f"epoch {ep + 1:2d}/{epochs} loss {total / len(idx):.3f} val_acc {acc:.3f}", flush=True)
            for m in net.modules():  # back to the normal momentum for further training
                if isinstance(m, nn.BatchNorm2d):
                    m.momentum = 0.1
        else:
            print(f"epoch {ep + 1:2d}/{epochs} loss {total / len(idx):.3f}", flush=True)
    recalibrate_bn(net, X, g)
    return net


def export(net: VisualNet, path: Path) -> None:
    net.eval()
    torch.onnx.export(EmbeddingOnly(net), torch.zeros(1, 3, SIZE, SIZE), str(path), input_names=["input"],
                      output_names=["embedding"], dynamic_axes={"input": {0: "N"}, "embedding": {0: "N"}},
                      opset_version=17, dynamo=False)


def quantize(src: Path, dst: Path, calib: np.ndarray) -> None:
    from onnxruntime.quantization import CalibrationDataReader, QuantFormat, QuantType, quantize_static
    from onnxruntime.quantization.shape_inference import quant_pre_process

    class Reader(CalibrationDataReader):
        def __init__(self) -> None:
            self.it = iter(calib[i:i + 1] for i in range(len(calib)))

        def get_next(self):  # type: ignore[override]
            x = next(self.it, None)
            return None if x is None else {"input": x}

    pre = dst.with_suffix(".pre.onnx")
    quant_pre_process(str(src), str(pre))
    quantize_static(str(pre), str(dst), Reader(), quant_format=QuantFormat.QDQ, per_channel=True,
                    weight_type=QuantType.QInt8, activation_type=QuantType.QUInt8)
    pre.unlink()


def embed(sess: ort.InferenceSession, X: np.ndarray) -> np.ndarray:
    return np.concatenate([sess.run(None, {"input": X[i:i + 32]})[0] for i in range(0, len(X), 32)])


def latency_ms(sess: ort.InferenceSession, runs: int = 100) -> dict:
    x = np.random.default_rng(0).uniform(0, 255, (1, 3, SIZE, SIZE)).astype(np.float32)
    for _ in range(10):
        sess.run(None, {"input": x})
    t = []
    for _ in range(runs):
        s = time.perf_counter()
        sess.run(None, {"input": x})
        t.append((time.perf_counter() - s) * 1000)
    return {"p50": float(np.percentile(t, 50)), "p95": float(np.percentile(t, 95)), "runs": runs,
            "note": "onnxruntime CPU, 1 image, this build machine; browser (ORT Web wasm) is slower"}


def unit(x: np.ndarray) -> np.ndarray:
    return x / np.maximum(np.linalg.norm(x, axis=-1, keepdims=True), 1e-9)


def unit(x: np.ndarray) -> np.ndarray:
    return x / np.maximum(np.linalg.norm(x, axis=-1, keepdims=True), 1e-9)


def gallery_and_eval(sess: ort.InferenceSession, data: dict, classes: list[str], protos: np.ndarray,
                     scale: float, max_fmr: float = 0.02) -> tuple[dict, dict]:
    """Two ways to compare a screenshot with reference embeddings; validation picks one.

      nn     nearest neighbour against embeddings of each brand's OFFICIAL login pages (the gallery);
             match if the best cosine >= threshold.
      proto  softmax over learned class prototypes (one per brand + "other", trained on official and
             clone pages); match if a brand wins with probability >= threshold.
    The rule + threshold maximising clone detection with generic false matches <= max_fmr on
    VALIDATION is shipped; TEST numbers are reported for that choice only.
    """
    brands = classes[:-1]
    emb = {k: embed(sess, to_tensor(v).numpy()) for k, v in data.items()}
    tr = data["train"]
    gallery = {b: emb["train"][[i for i, it in enumerate(tr) if it[2] == "official" and classes[it[1]] == b]][:8]
               for b in brands}
    meta = {k: (np.array([it[1] for it in data[k]]), np.array([it[2] for it in data[k]])) for k in ("val", "test")}

    def decide(split: str, rule: str) -> tuple[np.ndarray, np.ndarray]:
        e = emb[split]
        if rule == "nn":
            sims = np.stack([(e @ gallery[b].T).max(1) for b in brands], 1)
            return sims.argmax(1), sims.max(1)
        logits = scale * e @ unit(protos).T
        p = np.exp(logits - logits.max(1, keepdims=True))
        p /= p.sum(1, keepdims=True)
        arg = p.argmax(1)
        return np.where(arg < len(brands), arg, -1), np.where(arg < len(brands), p.max(1), 0.0)

    def rates(split: str, rule: str, thr: float) -> dict:
        arg, conf = decide(split, rule)
        true, role = meta[split]
        match = (arg >= 0) & (conf >= thr)
        hit = match & (arg == true)
        return {"clones": int((role == "clone").sum()), "clone_detection_rate": float(hit[role == "clone"].mean()),
                "generic": int((role == "generic").sum()),
                "generic_false_match_rate": float(match[role == "generic"].mean()),
                "official": int((role == "official").sum()), "official_match_rate": float(hit[role == "official"].mean())}

    best = ("proto", 0.99, -1.0)
    for rule in ("nn", "proto"):
        for thr in np.arange(0.30, 0.9995, 0.0025):
            r = rates("val", rule, float(thr))
            if r["generic_false_match_rate"] <= max_fmr and r["clone_detection_rate"] > best[2]:
                best = (rule, float(thr), r["clone_detection_rate"])
    rule, thr, _ = best
    return ({"rule": rule, "threshold": thr, "brands": brands, "gallery": gallery, "protos": unit(protos), "scale": scale},
            {"rule": rule, "threshold": thr, "max_val_fmr": max_fmr,
             "val": rates("val", rule, thr), "test": rates("test", rule, thr)})


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--epochs", type=int, default=30)
    ap.add_argument("--seed", type=int, default=3)
    args = ap.parse_args()
    torch.set_num_threads(max(1, torch.get_num_threads()))
    data, classes = load_split()
    t0 = time.time()
    net = train(data, len(classes), args.epochs, args.seed)
    train_secs = time.time() - t0
    MODELS.mkdir(parents=True, exist_ok=True)
    fp32, int8 = MODELS / "visual_model.onnx", MODELS / "visual_model.int8.onnx"
    torch.save({"state_dict": net.state_dict(), "classes": classes}, MODELS / "visual_model.pt")
    export(net, fp32)
    quantize(fp32, int8, to_tensor(data["train"][:200]).numpy())
    s32 = ort.InferenceSession(str(fp32), providers=["CPUExecutionProvider"])
    s8 = ort.InferenceSession(str(int8), providers=["CPUExecutionProvider"])
    protos = net.cls.detach().numpy()
    gal32, ev32 = gallery_and_eval(s32, data, classes, protos, net.scale)
    gal8, ev8 = gallery_and_eval(s8, data, classes, protos, net.scale)
    Xt = to_tensor(data["test"]).numpy()
    agree = float(np.mean(np.sum(embed(s32, Xt) * embed(s8, Xt), 1)))

    # Ship int8 unless quantisation costs more than 2 points of clone detection on validation.
    use8 = (ev8["val"]["clone_detection_rate"] or 0) >= (ev32["val"]["clone_detection_rate"] or 0) - 0.02
    chosen, gal, ev = (int8, gal8, ev8) if use8 else (fp32, gal32, ev32)
    dst = EXTENSION_PUBLIC / "models"
    dst.mkdir(parents=True, exist_ok=True)
    shutil.copy(chosen, dst / "visual_model.onnx")
    vb = {b["id"]: b for b in json.loads((SHARED / "visual_brands.json").read_text())["brands"]}
    (dst / "visual_gallery.json").write_text(json.dumps({
        "version": 1, "size": SIZE, "rule": gal["rule"], "threshold": round(gal["threshold"], 4),
        "scale": gal["scale"],
        "prototypes": [[round(float(v), 5) for v in e] for e in gal["protos"]],  # brands..., then "other"
        "notes": "FICTIONAL-brand demo gallery. Embeddings of official login pages (see ml/scripts/train_visual.py).",
        "brands": [{"id": b, "name": vb[b]["name"], "official_domains": vb[b]["official_domains"],
                    "embeddings": [[round(float(v), 5) for v in e] for e in gal["gallery"][b]]} for b in gal["brands"]],
    }) + "\n")
    manifest_path = dst / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    meta = run_meta("ml/scripts/train_visual.py", VIS / "index.csv", "synthetic-sample")
    manifest["visual"] = {"version": f"visual-{meta['generated_at'][:10]}-{git_commit()}", "quantized": use8,
                          "dataset": "synthetic-sample (fictional brands)"}
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")

    t = ev["test"]
    result = {**meta, "classes": classes, "epochs": args.epochs, "train_seconds": round(train_secs, 1),
              "images": {k: len(v) for k, v in data.items()}, "shipped": "int8" if use8 else "fp32",
              "size_bytes": {"fp32": fp32.stat().st_size, "int8": int8.stat().st_size},
              "latency_ms": {"fp32": latency_ms(s32), "int8": latency_ms(s8)},
              "fp32_vs_int8_mean_cosine": agree, "eval_fp32": ev32, "eval_int8": ev8,
              "summary_line": (f"{'int8' if use8 else 'fp32'} model {chosen.stat().st_size / 1024:.0f} KB "
                               f"(fp32 {fp32.stat().st_size / 1024:.0f} KB), CPU latency p50 "
                               f"{latency_ms(s8 if use8 else s32)['p50']:.1f} ms; test clone detection "
                               f"{100 * t['clone_detection_rate']:.1f}% at "
                               f"{100 * t['generic_false_match_rate']:.1f}% false matches on generic pages "
                               f"(rule '{ev['rule']}', fictional-brand synthetic data).")}
    RESULTS.mkdir(parents=True, exist_ok=True)
    (RESULTS / "visual_eval.json").write_text(json.dumps(result, indent=2) + "\n")
    print(result["summary_line"])


if __name__ == "__main__":
    main()
