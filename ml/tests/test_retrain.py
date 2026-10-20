import json
import shutil
import subprocess
import sys
from pathlib import Path

ML = Path(__file__).resolve().parents[1]


def run_retrain(tmp: Path, params: str) -> tuple[int, dict]:
    res = subprocess.run([sys.executable, str(ML / "scripts" / "retrain.py"), "--models-dir", str(tmp / "models"),
                          "--install-dir", str(tmp / "install"), "--results-dir", str(tmp / "results"),
                          "--candidate-params", params], capture_output=True, text=True)
    return res.returncode, json.loads((tmp / "results" / "retrain_latest.json").read_text())


def test_gate_rejects_a_worse_model_and_promotes_an_equal_or_better_one(tmp_path):
    (tmp_path / "models").mkdir()
    for name in ("url_model.onnx", "url_trees.json", "url_model.txt"):
        shutil.copy(ML / "models" / name, tmp_path / "models" / name)
    before = (tmp_path / "models" / "url_model.onnx").read_bytes()

    # A crippled candidate (2 leaves, 3 trees) must be rejected and must not touch production.
    code, res = run_retrain(tmp_path, json.dumps({"num_leaves": 2, "_rounds": 3, "learning_rate": 0.01}))
    assert code == 3 and res["promoted"] is False
    assert "dropped" in res["reason"]
    assert (tmp_path / "models" / "url_model.onnx").read_bytes() == before
    assert not (tmp_path / "install").exists()

    # Same recipe as production (deterministic training) -> not worse -> promoted and installed.
    code, res = run_retrain(tmp_path, "")
    assert code == 0 and res["promoted"] is True
    assert (tmp_path / "install" / "url_model.onnx").exists()
