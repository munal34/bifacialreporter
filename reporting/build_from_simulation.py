from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

from generate_case_report import build_rule_based_commentary, compute_metrics
from reporting.adapters import build_report_input_from_analysis


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build report-input JSON from simulation CSV and config JSON.")
    parser.add_argument("--project-name", required=True, help="Project name for report metadata.")
    parser.add_argument("--config-json", required=True, help="Path to analysis config JSON.")
    parser.add_argument("--simulation-csv", required=True, help="Path to simulation CSV output.")
    parser.add_argument("--simulation-stdout", default="", help="Optional path to simulation stdout text file.")
    parser.add_argument("--out-json", required=True, help="Output report-input JSON path.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    config_path = Path(args.config_json).expanduser().resolve()
    csv_path = Path(args.simulation_csv).expanduser().resolve()
    stdout_path = Path(args.simulation_stdout).expanduser().resolve() if args.simulation_stdout else None
    out_path = Path(args.out_json).expanduser().resolve()

    cfg = json.loads(config_path.read_text(encoding="utf-8"))
    with csv_path.open("r", encoding="utf-8", newline="") as f:
        rows = list(csv.DictReader(f))
    if not rows:
        raise RuntimeError("Simulation CSV has no data rows.")

    metrics = compute_metrics(rows)
    simulation_stdout = stdout_path.read_text(encoding="utf-8") if stdout_path and stdout_path.exists() else ""
    commentary = build_rule_based_commentary(metrics, "", args.project_name)

    report_input = build_report_input_from_analysis(
        project_name=args.project_name,
        config=cfg,
        rows=rows,
        metrics=metrics,
        commentary_text=commentary,
        simulation_stdout=simulation_stdout,
        payload={},
    )

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(report_input.model_dump(mode="json"), ensure_ascii=False, indent=2), encoding="utf-8")
    print(str(out_path))


if __name__ == "__main__":
    main()

