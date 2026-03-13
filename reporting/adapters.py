from __future__ import annotations

import re
from datetime import datetime
from typing import Any

from .schema import (
    AssumptionItem,
    DataSource,
    LOCKED_REPORT_AUTHOR,
    Recommendation,
    ReportInput,
    ReportMetadata,
    ScenarioResult,
    SiteInfo,
    UncertaintyPoint,
)


def _slug(value: str) -> str:
    text = re.sub(r"[^a-zA-Z0-9]+", "-", (value or "").strip().lower()).strip("-")
    return text or "scenario"


def _as_float(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    raw = str(value).strip().replace(",", "")
    if not raw:
        return None
    try:
        return float(raw)
    except ValueError:
        return None


def _as_int(value: Any) -> int | None:
    parsed = _as_float(value)
    if parsed is None:
        return None
    return int(round(parsed))


def _as_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "y", "evet"}


def _min_max(values: list[float | None]) -> tuple[float, float]:
    clean = [v for v in values if v is not None]
    if not clean:
        return 0.0, 1.0
    lo = min(clean)
    hi = max(clean)
    if abs(hi - lo) < 1e-9:
        hi = lo + 1.0
    return lo, hi


def _norm(value: float | None, lo: float, hi: float, inverse: bool = False) -> float:
    if value is None:
        return 0.5
    score = (value - lo) / (hi - lo)
    score = max(0.0, min(1.0, score))
    return 1.0 - score if inverse else score


def _estimate_structure_cost(base_cost: float, purlin_count: int | None, cross_brace: bool, purlin_unit_cost: float, brace_cost: float) -> float:
    purlin_cost = (purlin_count or 0) * purlin_unit_cost
    return base_cost + purlin_cost + (brace_cost if cross_brace else 0.0)


def _estimate_structural_confidence(purlin_count: int | None, cross_brace: bool) -> float:
    base = 56.0 + 9.5 * float(purlin_count or 0)
    if cross_brace:
        base += 7.5
    return max(30.0, min(96.0, base))


def build_report_input_from_analysis(
    *,
    project_name: str,
    config: dict[str, Any] | None,
    rows: list[dict[str, Any]],
    metrics: dict[str, Any],
    commentary_text: str,
    simulation_stdout: str,
    payload: dict[str, Any] | None = None,
) -> ReportInput:
    payload = payload or {}
    cfg = config or {}
    site_cfg = cfg.get("site", {}) if isinstance(cfg, dict) else {}
    project_cfg = cfg.get("project", {}) if isinstance(cfg, dict) else {}

    report_date = datetime.now().date()
    currency = str(payload.get("currency", "USD")).strip() or "USD"
    base_structure_cost = float(payload.get("base_structure_cost", 420_000.0))
    purlin_unit_cost = float(payload.get("purlin_unit_cost", 17_500.0))
    brace_cost = float(payload.get("brace_cost", 12_500.0))

    reference_name = str(metrics.get("reference", {}).get("scenario", "")).strip()

    scenario_rows: list[ScenarioResult] = []
    for row in rows:
        label = str(row.get("scenario", "")).strip() or "Scenario"
        scenario_id = _slug(label)
        purlin_count = _as_int(row.get("purlin_count"))
        cross_brace = _as_bool(row.get("cross_brace"))
        annual_total = _as_float(row.get("annual_total_kwh"))
        structure_cost = _estimate_structure_cost(base_structure_cost, purlin_count, cross_brace, purlin_unit_cost, brace_cost)
        structural_conf = _estimate_structural_confidence(purlin_count, cross_brace)

        scenario_rows.append(
            ScenarioResult(
                scenario_id=scenario_id,
                label=label,
                purlin_count=purlin_count,
                cross_brace=cross_brace,
                annual_total_kwh=annual_total,
                annual_rear_kwh=_as_float(row.get("annual_rear_kwh")),
                effective_rear_gain_pct=_as_float(row.get("effective_rear_gain_pct")),
                rear_blockage_pct=_as_float(row.get("mean_blockage_pct")),
                rear_blockage_std_pct=_as_float(row.get("std_blockage_pct")),
                mismatch_pct=_as_float(row.get("mismatch_pct")),
                structural_confidence_score=structural_conf,
                structure_cost=structure_cost,
                delta_kwh_vs_ref=_as_float(row.get("delta_vs_ref_kwh")),
                delta_pct_vs_ref=_as_float(row.get("delta_vs_ref_pct")),
                engineering_notes=[
                    f"Purlin count: {purlin_count if purlin_count is not None else 'N/A'}",
                    "Cross-brace used" if cross_brace else "No cross-brace",
                ],
                commercial_notes=[
                    "Structure cost includes indicative purlin and brace uplift assumptions.",
                ],
            )
        )

    scenario_by_label = {s.label: s for s in scenario_rows}
    reference = scenario_by_label.get(reference_name, scenario_rows[0])
    for s in scenario_rows:
        if s.capex_delta_vs_ref is None:
            if s.structure_cost is not None and reference.structure_cost is not None:
                s.capex_delta_vs_ref = s.structure_cost - reference.structure_cost

    energy_lo, energy_hi = _min_max([s.annual_total_kwh for s in scenario_rows])
    cost_lo, cost_hi = _min_max([s.structure_cost for s in scenario_rows])
    struct_lo, struct_hi = _min_max([s.structural_confidence_score for s in scenario_rows])

    for s in scenario_rows:
        energy_score = _norm(s.annual_total_kwh, energy_lo, energy_hi, inverse=False)
        cost_score = _norm(s.structure_cost, cost_lo, cost_hi, inverse=True)
        struct_score = _norm(s.structural_confidence_score, struct_lo, struct_hi, inverse=False)
        s.decision_score = 100.0 * (0.5 * energy_score + 0.3 * cost_score + 0.2 * struct_score)

    ranked = sorted(scenario_rows, key=lambda s: s.decision_score or 0.0, reverse=True)
    recommended = ranked[0]
    second = ranked[1] if len(ranked) > 1 else ranked[0]

    uncertainty: list[UncertaintyPoint] = []
    for s in scenario_rows:
        p50 = s.annual_total_kwh
        std_pct = s.rear_blockage_std_pct or 0.0
        sigma = (std_pct / 100.0) * (s.annual_rear_kwh or 0.0) * 0.35
        uncertainty.append(
            UncertaintyPoint(
                scenario_id=s.scenario_id,
                p50_kwh=p50,
                p90_kwh=(p50 - 1.28 * sigma) if p50 is not None else None,
                p10_kwh=(p50 + 1.28 * sigma) if p50 is not None else None,
                note="Indicative confidence range derived from rear-side non-uniformity proxy.",
            )
        )

    recommendation = Recommendation(
        recommended_scenario_id=recommended.scenario_id,
        summary=(
            f"Recommended baseline for bankable deployment: '{recommended.label}'. "
            f"Decision score {recommended.decision_score:.1f}/100."
        ),
        rationale=[
            f"Energy-positioned outcome with annual total {recommended.annual_total_kwh:,.0f} kWh.",
            f"Structure cost delta vs reference: {recommended.capex_delta_vs_ref:+,.0f} {currency} (indicative)."
            if recommended.capex_delta_vs_ref is not None
            else "Structure cost delta is not available in input and was estimated from default assumptions.",
            f"Structural confidence proxy: {recommended.structural_confidence_score:.1f}/100."
            if recommended.structural_confidence_score is not None
            else "Structural confidence proxy unavailable.",
        ],
        conditional_note=(
            f"If static checks or site risk controls tighten, '{second.label}' can be selected as a risk-downside alternative."
            if second.scenario_id != recommended.scenario_id
            else None
        ),
        investor_takeaway="Select the highest decision-score scenario while validating static constraints with project-specific engineering calculations.",
    )

    tradeoffs = [
        "Lower purlin count tends to improve rear irradiance access and can reduce structural CAPEX uplift.",
        "Higher purlin count increases structure robustness confidence but usually raises backside obstruction and cost.",
        "The economically preferred option should satisfy both yield advantage and minimum structural reliability threshold.",
    ]

    assumptions = [
        AssumptionItem(title="Analysis engine", value="Monte Carlo rear-side obstruction comparison across scenarios.", confidence="high"),
        AssumptionItem(title="Climate source", value="NASA POWER and PVGIS derived climate/albedo inputs.", confidence="high"),
        AssumptionItem(
            title="Cost normalization",
            value=(
                f"Base structure cost = {base_structure_cost:,.0f} {currency}, "
                f"purlin uplift = {purlin_unit_cost:,.0f} {currency}/purlin, "
                f"cross-brace uplift = {brace_cost:,.0f} {currency}."
            ),
            confidence="medium",
        ),
        AssumptionItem(title="Uncertainty note", value="Ranges represent scenario confidence interpretation, not guaranteed yield bounds.", confidence="medium"),
    ]

    method = [
        "Scenario set is evaluated with Monte Carlo-based rear-side obstruction and mismatch propagation.",
        "Rear gain and annual total energy are calculated per scenario and compared against reference.",
        "Decision score combines energy performance, indicative structure cost, and structural confidence proxy.",
    ]

    data_sources = [
        DataSource(name="NASA POWER", provider="NASA", url="https://power.larc.nasa.gov/", note="Albedo and climatology context."),
        DataSource(name="PVGIS TMY 5.2", provider="European Commission JRC", url="https://re.jrc.ec.europa.eu/pvg_tools/en/", note="Irradiance and meteorological baseline."),
    ]

    appendix_notes = [
        "This report is for decision support and does not replace detailed structural design checks.",
        "Final EPC execution decisions should include local geotechnical constraints and code compliance.",
    ]

    executive = (
        commentary_text.strip()
        if commentary_text.strip()
        else (
            f"This report compares purlin-count alternatives for '{project_name}' and identifies the most balanced option "
            "across energy yield, structural confidence, and cost efficiency."
        )
    )
    executive = executive[:1800]

    decision_snapshot = (
        f"Primary recommendation: {recommended.label}. "
        f"Compared with reference '{reference.label}', this option targets a balanced return profile "
        f"under current climate/albedo assumptions."
    )

    site = SiteInfo(
        site_name=str(project_cfg.get("name", project_name)).strip() or project_name,
        latitude=_as_float(site_cfg.get("lat")),
        longitude=_as_float(site_cfg.get("lon")),
        annual_albedo=_as_float(site_cfg.get("annual_albedo")),
        annual_ghi_kwh_m2=_as_float(site_cfg.get("annual_ghi_kwh_m2")),
        climate_note=str(site_cfg.get("climate_note", "")).strip() or None,
    )

    metadata = ReportMetadata(
        project_name=project_name,
        project_code=str(project_cfg.get("code", "")).strip() or None,
        client_name=str(payload.get("client_name", "")).strip() or None,
        prepared_by=LOCKED_REPORT_AUTHOR,
        report_date=report_date,
        report_version=str(payload.get("report_version", "2.0")),
        currency=currency,
    )

    reference_id = reference.scenario_id if reference else scenario_rows[0].scenario_id

    return ReportInput(
        metadata=metadata,
        site=site,
        executive_summary=executive,
        decision_snapshot=decision_snapshot,
        methodology_overview=method,
        data_sources=data_sources,
        assumptions=assumptions,
        scenarios=scenario_rows,
        reference_scenario_id=reference_id,
        uncertainty=uncertainty,
        key_tradeoffs=tradeoffs,
        recommendation=recommendation,
        appendix_notes=appendix_notes,
        simulation_stdout=simulation_stdout,
    )
