# Bifacial Rear Support Comparison Tool

This repository includes a Monte Carlo estimator to compare bifacial annual production for different rear support layouts.

Typical use case:
- compare `0 purlin`, `2 purlin`, `3 purlin`, `purlin + cross brace`
- estimate annual production delta from rear-side structural shading

## Web UI (Local)

A technical local web interface is available at:
- `web/index.html`

Run a local server from the repository root:

```bash
python local_server.py --port 8000
```

Open:
- `http://localhost:8000/web/`

Why this server:
- proxies NASA POWER + PVGIS 5.2 API calls via `/api/*` to avoid browser CORS blocks

What you can do in the UI:
- step 1: system inputs + dynamic panel preview
- step 2: geometry inputs + dynamic front/side/top technical views
- step 3: scenario builder + live scenario technical preview
- step 4: simulation run + comparison table + delta bars + CSV export

## What The Script Does

`bifacial_support_compare.py`:
- models panel rear surface as a 2D area
- creates support members (purlins, cross braces, optional custom boxes)
- ray-casts cosine-weighted hemispherical rays from panel rear points
- estimates:
  - rear optical blockage
  - non-uniformity across panel points
  - mismatch penalty using a configurable factor
  - effective rear gain and annual total energy
- prints a comparison table and can export CSV

## Quick Start

Run with the sample configuration:

```bash
python bifacial_support_compare.py --config example_config.json
```

Export CSV:

```bash
python bifacial_support_compare.py --config example_config.json --out-csv results.csv
```

## Configuration

Edit `example_config.json`.

Main fields:
- `panel.width_m`, `panel.height_m`
- `energy_model.annual_front_energy_kwh`
- `energy_model.ideal_bifacial_gain_pct`
- `energy_model.base_rear_mismatch_pct`
- `energy_model.mismatch_from_nonuniformity_factor`
- `geometry_defaults.*`
- `scenarios[]`

Scenario options:
- `name`
- `purlin_count`
- `cross_brace`
- optional overrides:
  - `purlin_depth_z_m`
  - `purlin_thickness_y_m`
  - `purlin_z_offset_m`
  - `purlin_edge_margin_m`
  - `brace_thickness_m`
  - `brace_z_start_m`
  - `brace_z_end_m`
  - `brace_segments`
  - `brace_x_rel_positions`
- optional custom members:
  - `extra_boxes`: list of `{ "min":[x,y,z], "max":[x,y,z], "label":"..." }`

## Important Modeling Notes

This is an engineering comparison tool, not a full optical/electrical digital twin.

Key simplifications:
- isotropic rear irradiance proxy using cosine-weighted hemisphere
- axis-aligned boxes for supports (cross braces are approximated by segmented boxes)
- mismatch modeled from rear non-uniformity with a tunable empirical factor

So absolute values should be calibrated with measurement or detailed simulation, but scenario-to-scenario deltas are useful for design decisions.

## Deploy to Railway (Production)

This repo is deployment-ready for Railway with Docker.

### 1) Push to GitHub
- commit your current branch
- push to a GitHub repository

### 2) Create Railway Project
- Railway dashboard -> `New Project` -> `Deploy from GitHub Repo`
- select this repository
- Railway will detect `Dockerfile` and build it automatically

### 3) Set Runtime
- no custom start command needed (already in `Dockerfile`)
- app binds with `--host 0.0.0.0 --port $PORT`
- health endpoint: `/health`

### 4) Generate Public URL
- Service -> `Settings` -> `Networking` -> `Generate Domain`
- open `https://<your-domain>/web/`

### 5) (Optional) Persist outputs
By default Railway filesystem is ephemeral. If you need to keep generated report files (`outputs/`), attach a persistent volume and map it to `/app/outputs`.
