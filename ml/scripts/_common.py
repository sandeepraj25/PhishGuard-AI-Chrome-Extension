"""Make `phishguard_ml` importable when scripts are run directly (python ml/scripts/x.py)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
