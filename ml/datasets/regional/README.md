# Regional dataset

Produced by `ml/scripts/label_cli.py`. This folder intentionally ships **without labeled data**:
labels must come from real labelers (docs/HUMAN_TODO.md). After labeling:

```bash
python ml/scripts/label_cli.py label --input candidates.csv --labeler <you> --region IN --language hi
python ml/scripts/label_cli.py export      # -> regional_urls.csv + DATASHEET.md (+ conflicts.txt)
python ml/scripts/train_url.py --extra ml/datasets/regional/regional_urls.csv
```

`labels.jsonl` is the append-only source of truth (one decision per line, with labeler and time).
