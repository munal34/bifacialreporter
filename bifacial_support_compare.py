#!/usr/bin/env python3
"""
Rear-side structural shading estimator for bifacial PV systems.

This tool compares annual energy for multiple support-layout scenarios
such as:
- no rear purlin
- 2 rear purlins
- 3 rear purlins
- purlin + cross-brace combinations

Model notes:
- Uses Monte Carlo ray casting from panel rear surface.
- Uses cosine-weighted hemisphere sampling (isotropic rear irradiance proxy).
- Estimates optical rear blocking and a mismatch adjustment based on
  irradiance non-uniformity across panel points.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import random
import statistics
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any


EPS = 1e-9


def configure_output_encoding() -> None:
    # Prevent UnicodeEncodeError on Windows legacy code pages when scenario names include non-ASCII characters.
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            continue


@dataclass(frozen=True)
class AABB:
    min_x: float
    max_x: float
    min_y: float
    max_y: float
    min_z: float
    max_z: float
    label: str = ""


@dataclass
class ScenarioResult:
    name: str
    purlin_count: int
    cross_brace: bool
    mean_blockage_ratio: float
    blockage_std_ratio: float
    mismatch_pct: float
    effective_rear_gain_pct: float
    annual_total_kwh: float
    annual_rear_kwh: float
    optical_rear_loss_kwh: float
    mismatch_rear_loss_kwh: float
    delta_vs_ref_kwh: float = 0.0
    delta_vs_ref_pct: float = 0.0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Compare bifacial annual production across support-layout scenarios."
    )
    parser.add_argument(
        "--config",
        required=True,
        help="Path to JSON config file.",
    )
    parser.add_argument(
        "--out-csv",
        default="",
        help="Optional CSV output path.",
    )
    return parser.parse_args()


def load_config(path: str) -> dict[str, Any]:
    cfg_path = Path(path)
    if not cfg_path.exists():
        raise FileNotFoundError(f"Config file not found: {cfg_path}")
    with cfg_path.open("r", encoding="utf-8") as f:
        raw = json.load(f)
    if not isinstance(raw, dict):
        raise ValueError("Top-level config must be a JSON object.")
    return raw


def cfg_get_number(container: dict[str, Any], key: str, default: float) -> float:
    value = container.get(key, default)
    if not isinstance(value, (int, float)):
        raise ValueError(f"'{key}' must be numeric, got: {value!r}")
    return float(value)


def ray_hits_aabb(origin: tuple[float, float, float], direction: tuple[float, float, float], box: AABB) -> bool:
    ox, oy, oz = origin
    dx, dy, dz = direction

    t_min = EPS
    t_max = float("inf")

    for o, d, b_min, b_max in (
        (ox, dx, box.min_x, box.max_x),
        (oy, dy, box.min_y, box.max_y),
        (oz, dz, box.min_z, box.max_z),
    ):
        if abs(d) < EPS:
            if o < b_min or o > b_max:
                return False
            continue
        inv_d = 1.0 / d
        t1 = (b_min - o) * inv_d
        t2 = (b_max - o) * inv_d
        if t1 > t2:
            t1, t2 = t2, t1
        t_min = max(t_min, t1)
        t_max = min(t_max, t2)
        if t_max < t_min:
            return False
    return True


def sample_cosine_hemisphere(rng: random.Random) -> tuple[float, float, float]:
    u1 = rng.random()
    u2 = rng.random()
    r = math.sqrt(u1)
    theta = 2.0 * math.pi * u2
    x = r * math.cos(theta)
    y = r * math.sin(theta)
    z = math.sqrt(max(0.0, 1.0 - u1))
    return (x, y, z)


def build_purlin_boxes(
    panel_w: float,
    panel_h: float,
    scenario: dict[str, Any],
    defaults: dict[str, Any],
) -> list[AABB]:
    count = int(cfg_get_number(scenario, "purlin_count", 0.0))
    if count <= 0:
        return []

    purlin_depth_z = cfg_get_number(scenario, "purlin_depth_z_m", cfg_get_number(defaults, "purlin_depth_z_m", 0.04))
    purlin_thickness_y = cfg_get_number(
        scenario, "purlin_thickness_y_m", cfg_get_number(defaults, "purlin_thickness_y_m", 0.05)
    )
    purlin_z_offset = cfg_get_number(scenario, "purlin_z_offset_m", cfg_get_number(defaults, "purlin_z_offset_m", 0.06))
    purlin_edge_margin = cfg_get_number(
        scenario, "purlin_edge_margin_m", cfg_get_number(defaults, "purlin_edge_margin_m", 0.15)
    )
    purlin_overhang_x = cfg_get_number(
        scenario, "purlin_overhang_x_m", cfg_get_number(defaults, "purlin_overhang_x_m", 0.02)
    )

    if panel_h - 2.0 * purlin_edge_margin <= 0:
        raise ValueError("Invalid purlin edge margin: no space left on panel height.")

    if count == 1:
        y_positions = [0.5 * panel_h]
    else:
        span = panel_h - 2.0 * purlin_edge_margin
        step = span / (count - 1)
        y_positions = [purlin_edge_margin + i * step for i in range(count)]

    boxes: list[AABB] = []
    for idx, y_c in enumerate(y_positions, start=1):
        boxes.append(
            AABB(
                min_x=-purlin_overhang_x,
                max_x=panel_w + purlin_overhang_x,
                min_y=y_c - 0.5 * purlin_thickness_y,
                max_y=y_c + 0.5 * purlin_thickness_y,
                min_z=purlin_z_offset,
                max_z=purlin_z_offset + purlin_depth_z,
                label=f"purlin_{idx}",
            )
        )
    return boxes


def build_cross_brace_boxes(
    panel_w: float,
    panel_h: float,
    scenario: dict[str, Any],
    defaults: dict[str, Any],
) -> list[AABB]:
    cross_enabled = bool(scenario.get("cross_brace", False))
    if not cross_enabled:
        return []

    thickness = cfg_get_number(scenario, "brace_thickness_m", cfg_get_number(defaults, "brace_thickness_m", 0.03))
    z_start = cfg_get_number(scenario, "brace_z_start_m", cfg_get_number(defaults, "brace_z_start_m", 0.06))
    z_end = cfg_get_number(scenario, "brace_z_end_m", cfg_get_number(defaults, "brace_z_end_m", 0.18))
    y_margin = cfg_get_number(scenario, "brace_edge_margin_m", cfg_get_number(defaults, "brace_edge_margin_m", 0.10))
    segments = int(cfg_get_number(scenario, "brace_segments", cfg_get_number(defaults, "brace_segments", 22.0)))
    x_rel = scenario.get("brace_x_rel_positions", defaults.get("brace_x_rel_positions", [0.35, 0.65]))
    if not isinstance(x_rel, list) or not x_rel:
        raise ValueError("brace_x_rel_positions must be a non-empty list.")

    y_low = y_margin
    y_high = panel_h - y_margin
    if y_high <= y_low:
        raise ValueError("Invalid brace edge margin: no space left on panel height.")

    boxes: list[AABB] = []
    brace_id = 0
    for rel in x_rel:
        if not isinstance(rel, (int, float)):
            raise ValueError(f"brace_x_rel_positions entries must be numeric, got {rel!r}")
        x_center = panel_w * float(rel)
        brace_id += 1
        boxes.extend(
            segment_to_boxes(
                x_center=x_center,
                y0=y_low,
                z0=z_start,
                y1=y_high,
                z1=z_end,
                thickness=thickness,
                segments=segments,
                label=f"brace_{brace_id}_fwd",
            )
        )
        brace_id += 1
        boxes.extend(
            segment_to_boxes(
                x_center=x_center,
                y0=y_high,
                z0=z_start,
                y1=y_low,
                z1=z_end,
                thickness=thickness,
                segments=segments,
                label=f"brace_{brace_id}_rev",
            )
        )
    return boxes


def segment_to_boxes(
    x_center: float,
    y0: float,
    z0: float,
    y1: float,
    z1: float,
    thickness: float,
    segments: int,
    label: str,
) -> list[AABB]:
    boxes: list[AABB] = []
    if segments <= 0:
        return boxes

    for i in range(segments):
        t0 = i / segments
        t1 = (i + 1) / segments
        yc0 = y0 + (y1 - y0) * t0
        zc0 = z0 + (z1 - z0) * t0
        yc1 = y0 + (y1 - y0) * t1
        zc1 = z0 + (z1 - z0) * t1

        y_center = 0.5 * (yc0 + yc1)
        z_center = 0.5 * (zc0 + zc1)
        half_y = 0.5 * abs(yc1 - yc0) + 0.5 * thickness
        half_z = 0.5 * abs(zc1 - zc0) + 0.5 * thickness
        half_x = 0.5 * thickness

        boxes.append(
            AABB(
                min_x=x_center - half_x,
                max_x=x_center + half_x,
                min_y=y_center - half_y,
                max_y=y_center + half_y,
                min_z=z_center - half_z,
                max_z=z_center + half_z,
                label=f"{label}_seg_{i+1}",
            )
        )
    return boxes


def build_extra_boxes(scenario: dict[str, Any]) -> list[AABB]:
    extras = scenario.get("extra_boxes", [])
    if extras is None:
        return []
    if not isinstance(extras, list):
        raise ValueError("extra_boxes must be a list.")

    boxes: list[AABB] = []
    for idx, entry in enumerate(extras, start=1):
        if not isinstance(entry, dict):
            raise ValueError(f"extra_boxes[{idx}] must be object.")
        min_xyz = entry.get("min")
        max_xyz = entry.get("max")
        if not isinstance(min_xyz, list) or not isinstance(max_xyz, list) or len(min_xyz) != 3 or len(max_xyz) != 3:
            raise ValueError(f"extra_boxes[{idx}] must contain min/max as [x,y,z].")
        min_x, min_y, min_z = (float(v) for v in min_xyz)
        max_x, max_y, max_z = (float(v) for v in max_xyz)
        if min_x > max_x or min_y > max_y or min_z > max_z:
            raise ValueError(f"extra_boxes[{idx}] has invalid min/max order.")
        boxes.append(
            AABB(
                min_x=min_x,
                max_x=max_x,
                min_y=min_y,
                max_y=max_y,
                min_z=min_z,
                max_z=max_z,
                label=str(entry.get("label", f"extra_{idx}")),
            )
        )
    return boxes


def build_scenario_members(panel_w: float, panel_h: float, scenario: dict[str, Any], defaults: dict[str, Any]) -> list[AABB]:
    members: list[AABB] = []
    members.extend(build_purlin_boxes(panel_w, panel_h, scenario, defaults))
    members.extend(build_cross_brace_boxes(panel_w, panel_h, scenario, defaults))
    members.extend(build_extra_boxes(scenario))
    return members


def estimate_point_blockage(
    origin: tuple[float, float, float],
    members: list[AABB],
    rays_per_point: int,
    rng: random.Random,
) -> float:
    if not members:
        return 0.0

    blocked = 0
    for _ in range(rays_per_point):
        direction = sample_cosine_hemisphere(rng)
        hit = False
        for m in members:
            if ray_hits_aabb(origin, direction, m):
                hit = True
                break
        if hit:
            blocked += 1
    return blocked / rays_per_point


def run_scenario(
    panel_w: float,
    panel_h: float,
    front_energy_kwh: float,
    ideal_rear_gain_pct: float,
    base_mismatch_pct: float,
    mismatch_scale_pct_per_std: float,
    points_x: int,
    points_y: int,
    rays_per_point: int,
    members: list[AABB],
    rng: random.Random,
    scenario_name: str,
    purlin_count: int,
    cross_brace: bool,
) -> ScenarioResult:
    point_blockages: list[float] = []

    for ix in range(points_x):
        x = panel_w * (ix + 0.5) / points_x
        for iy in range(points_y):
            y = panel_h * (iy + 0.5) / points_y
            point_blockages.append(
                estimate_point_blockage(
                    origin=(x, y, 0.0),
                    members=members,
                    rays_per_point=rays_per_point,
                    rng=rng,
                )
            )

    if not point_blockages:
        mean_blockage = 0.0
        std_blockage = 0.0
    else:
        mean_blockage = statistics.fmean(point_blockages)
        std_blockage = statistics.pstdev(point_blockages)

    mismatch_pct = base_mismatch_pct + mismatch_scale_pct_per_std * std_blockage
    mismatch_pct = max(0.0, min(80.0, mismatch_pct))

    rear_ideal_kwh = front_energy_kwh * (ideal_rear_gain_pct / 100.0)
    rear_after_optical_kwh = rear_ideal_kwh * (1.0 - mean_blockage)
    rear_after_mismatch_kwh = rear_after_optical_kwh * (1.0 - mismatch_pct / 100.0)
    annual_total_kwh = front_energy_kwh + rear_after_mismatch_kwh

    effective_rear_gain_pct = 100.0 * rear_after_mismatch_kwh / front_energy_kwh

    return ScenarioResult(
        name=scenario_name,
        purlin_count=purlin_count,
        cross_brace=cross_brace,
        mean_blockage_ratio=mean_blockage,
        blockage_std_ratio=std_blockage,
        mismatch_pct=mismatch_pct,
        effective_rear_gain_pct=effective_rear_gain_pct,
        annual_total_kwh=annual_total_kwh,
        annual_rear_kwh=rear_after_mismatch_kwh,
        optical_rear_loss_kwh=rear_ideal_kwh - rear_after_optical_kwh,
        mismatch_rear_loss_kwh=rear_after_optical_kwh - rear_after_mismatch_kwh,
    )


def choose_reference_scenario(results: list[ScenarioResult], raw_scenarios: list[dict[str, Any]]) -> int:
    for i, s in enumerate(raw_scenarios):
        purlin_count = int(cfg_get_number(s, "purlin_count", 0.0))
        cross_brace = bool(s.get("cross_brace", False))
        extras = s.get("extra_boxes", []) or []
        if purlin_count == 0 and not cross_brace and len(extras) == 0:
            return i
    return min(range(len(results)), key=lambda idx: results[idx].mean_blockage_ratio)


def print_summary(results: list[ScenarioResult], ref_idx: int) -> None:
    ref = results[ref_idx]
    print()
    print(f"Reference scenario: {ref.name}")
    print()
    headers = [
        "Scenario",
        "Purlin",
        "Cross",
        "RearBlock%",
        "StdBlock%",
        "Mismatch%",
        "EffRearGain%",
        "AnnualTotal(kWh)",
        "DeltaRef(kWh)",
        "DeltaRef(%)",
    ]
    widths = [28, 6, 5, 10, 9, 9, 12, 16, 12, 9]
    row_fmt = (
        f"{{:<{widths[0]}}} "
        f"{{:>{widths[1]}}} "
        f"{{:>{widths[2]}}} "
        f"{{:>{widths[3]}.2f}} "
        f"{{:>{widths[4]}.2f}} "
        f"{{:>{widths[5]}.2f}} "
        f"{{:>{widths[6]}.2f}} "
        f"{{:>{widths[7]}.0f}} "
        f"{{:>{widths[8]}.0f}} "
        f"{{:>{widths[9]}.2f}}"
    )

    header_line = (
        f"{headers[0]:<{widths[0]}} "
        f"{headers[1]:>{widths[1]}} "
        f"{headers[2]:>{widths[2]}} "
        f"{headers[3]:>{widths[3]}} "
        f"{headers[4]:>{widths[4]}} "
        f"{headers[5]:>{widths[5]}} "
        f"{headers[6]:>{widths[6]}} "
        f"{headers[7]:>{widths[7]}} "
        f"{headers[8]:>{widths[8]}} "
        f"{headers[9]:>{widths[9]}}"
    )
    print(header_line)
    print("-" * len(header_line))

    for r in results:
        print(
            row_fmt.format(
                r.name[: widths[0] - 1],
                r.purlin_count,
                "yes" if r.cross_brace else "no",
                100.0 * r.mean_blockage_ratio,
                100.0 * r.blockage_std_ratio,
                r.mismatch_pct,
                r.effective_rear_gain_pct,
                r.annual_total_kwh,
                r.delta_vs_ref_kwh,
                r.delta_vs_ref_pct,
            )
        )
    print()


def save_csv(results: list[ScenarioResult], path: str) -> None:
    out_path = Path(path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(
            [
                "scenario",
                "purlin_count",
                "cross_brace",
                "mean_blockage_pct",
                "std_blockage_pct",
                "mismatch_pct",
                "effective_rear_gain_pct",
                "annual_total_kwh",
                "annual_rear_kwh",
                "optical_rear_loss_kwh",
                "mismatch_rear_loss_kwh",
                "delta_vs_ref_kwh",
                "delta_vs_ref_pct",
            ]
        )
        for r in results:
            writer.writerow(
                [
                    r.name,
                    r.purlin_count,
                    r.cross_brace,
                    100.0 * r.mean_blockage_ratio,
                    100.0 * r.blockage_std_ratio,
                    r.mismatch_pct,
                    r.effective_rear_gain_pct,
                    r.annual_total_kwh,
                    r.annual_rear_kwh,
                    r.optical_rear_loss_kwh,
                    r.mismatch_rear_loss_kwh,
                    r.delta_vs_ref_kwh,
                    r.delta_vs_ref_pct,
                ]
            )


def main() -> None:
    configure_output_encoding()
    args = parse_args()
    cfg = load_config(args.config)

    panel_cfg = cfg.get("panel", {})
    energy_cfg = cfg.get("energy_model", {})
    sim_cfg = cfg.get("simulation", {})
    defaults = cfg.get("geometry_defaults", {})
    scenarios = cfg.get("scenarios", [])

    if not isinstance(panel_cfg, dict) or not isinstance(energy_cfg, dict) or not isinstance(sim_cfg, dict):
        raise ValueError("'panel', 'energy_model', and 'simulation' must be objects.")
    if not isinstance(defaults, dict):
        raise ValueError("'geometry_defaults' must be an object.")
    if not isinstance(scenarios, list) or not scenarios:
        raise ValueError("'scenarios' must be a non-empty array.")

    panel_w = cfg_get_number(panel_cfg, "width_m", 1.134)
    panel_h = cfg_get_number(panel_cfg, "height_m", 2.278)

    front_energy_kwh = cfg_get_number(energy_cfg, "annual_front_energy_kwh", 1_000_000.0)
    ideal_rear_gain_pct = cfg_get_number(energy_cfg, "ideal_bifacial_gain_pct", 12.0)
    base_mismatch_pct = cfg_get_number(energy_cfg, "base_rear_mismatch_pct", 10.0)
    mismatch_scale = cfg_get_number(energy_cfg, "mismatch_from_nonuniformity_factor", 35.0)

    points_x = int(cfg_get_number(sim_cfg, "panel_points_x", 10.0))
    points_y = int(cfg_get_number(sim_cfg, "panel_points_y", 20.0))
    rays_per_point = int(cfg_get_number(sim_cfg, "rays_per_point", 600.0))
    seed = int(cfg_get_number(sim_cfg, "seed", 42.0))

    if panel_w <= 0 or panel_h <= 0:
        raise ValueError("Panel dimensions must be > 0.")
    if front_energy_kwh <= 0:
        raise ValueError("annual_front_energy_kwh must be > 0.")
    if points_x <= 0 or points_y <= 0 or rays_per_point <= 0:
        raise ValueError("Simulation counts must be > 0.")

    rng = random.Random(seed)
    results: list[ScenarioResult] = []
    raw_scenarios: list[dict[str, Any]] = []

    for idx, s in enumerate(scenarios, start=1):
        if not isinstance(s, dict):
            raise ValueError(f"scenarios[{idx}] must be an object.")
        name = str(s.get("name", f"scenario_{idx}"))
        purlin_count = int(cfg_get_number(s, "purlin_count", 0.0))
        cross_brace = bool(s.get("cross_brace", False))
        members = build_scenario_members(panel_w, panel_h, s, defaults)
        result = run_scenario(
            panel_w=panel_w,
            panel_h=panel_h,
            front_energy_kwh=front_energy_kwh,
            ideal_rear_gain_pct=ideal_rear_gain_pct,
            base_mismatch_pct=base_mismatch_pct,
            mismatch_scale_pct_per_std=mismatch_scale,
            points_x=points_x,
            points_y=points_y,
            rays_per_point=rays_per_point,
            members=members,
            rng=rng,
            scenario_name=name,
            purlin_count=purlin_count,
            cross_brace=cross_brace,
        )
        results.append(result)
        raw_scenarios.append(s)

    ref_idx = choose_reference_scenario(results, raw_scenarios)
    ref_energy = results[ref_idx].annual_total_kwh
    for r in results:
        r.delta_vs_ref_kwh = r.annual_total_kwh - ref_energy
        r.delta_vs_ref_pct = 100.0 * (r.annual_total_kwh / ref_energy - 1.0)

    print_summary(results, ref_idx)

    if args.out_csv:
        save_csv(results, args.out_csv)
        print(f"CSV written: {Path(args.out_csv).resolve()}")


if __name__ == "__main__":
    main()
