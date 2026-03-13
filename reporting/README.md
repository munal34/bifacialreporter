# Reporting Layer

This module provides a production-grade reporting layer for bifacial PV purlin trade-off analysis.

Author field is locked at schema level as: `Mustafa Ünal`.

## What it does

- Validates report input JSON with a strict schema (`schema.py`)
- Adapts existing simulation output rows into report-ready structured payload (`adapters.py`)
- Renders a premium HTML decision report and exports A4 PDF (`render_report.py`)
- Uses Playwright for high-fidelity PDF output with page numbers and print-safe styles
- Falls back to Chrome/Edge headless PDF export if Playwright is unavailable

## Quick start (sample)

```bash
python -m reporting.render_report \
  --input-json reporting/samples/sample_report_input.json \
  --out-html outputs/sample_premium_report.html \
  --out-pdf outputs/sample_premium_report.pdf \
  --out-json outputs/sample_premium_report.normalized.json
```

## Build report input from simulation output

```bash
python -m reporting.build_from_simulation \
  --project-name "Ankara Utility-Scale PV" \
  --config-json outputs/report_cfg_<job>.json \
  --simulation-csv outputs/simulation_<job>.csv \
  --out-json outputs/report_input_<job>.json
```

Then render:

```bash
python -m reporting.render_report \
  --input-json outputs/report_input_<job>.json \
  --out-html outputs/otomatik_rapor_<job>.html \
  --out-pdf outputs/otomatik_rapor_<job>.pdf
```

## Integration contract

- Input: structured JSON validated by `ReportInput`
- Output:
  - rendered HTML report
  - printable A4 PDF
  - optional normalized JSON snapshot

## Design goals

- Investor-readable executive clarity
- Engineering-credible details
- Dynamic sections for variable scenario counts and optional inputs
- Print stability for long tables and uneven content lengths
