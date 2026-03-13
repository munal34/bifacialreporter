from __future__ import annotations

import argparse
import json
import math
import subprocess
from html import escape
from pathlib import Path
from typing import Any

from .schema import ReportInput, ScenarioResult

try:
    from playwright.sync_api import sync_playwright
except Exception:
    sync_playwright = None


THIS_DIR = Path(__file__).resolve().parent
TEMPLATE_DIR = THIS_DIR / "template"
DEFAULT_TEMPLATE_PATH = TEMPLATE_DIR / "report_template.html"
DEFAULT_CSS_PATH = TEMPLATE_DIR / "report.css"


def _fmt_num(value: float | None, digits: int = 0) -> str:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return "N/A"
    return f"{value:,.{digits}f}"


def _fmt_pct(value: float | None, digits: int = 2) -> str:
    if value is None:
        return "N/A"
    sign = "+" if value > 0 else ""
    return f"{sign}{value:.{digits}f}%"


def _fmt_signed(value: float | None, digits: int = 0) -> str:
    if value is None:
        return "N/A"
    sign = "+" if value > 0 else ""
    return f"{sign}{value:,.{digits}f}"


def _fmt_currency(value: float | None, currency: str) -> str:
    if value is None:
        return "N/A"
    sign = "+" if value > 0 else ""
    return f"{sign}{value:,.0f} {currency}"


def _status_from_delta(value: float | None) -> str:
    if value is None:
        return "warning"
    if value > 0:
        return "positive"
    if value < 0:
        return "negative"
    return "warning"


def _safe_text(value: str | None, fallback: str = "N/A") -> str:
    text = (value or "").strip()
    return text if text else fallback


def _first_sentence(text: str, fallback: str) -> str:
    clean = (text or "").strip()
    if not clean:
        return fallback
    if "." in clean:
        return clean.split(".", 1)[0].strip() + "."
    return clean


def _ensure_scenario_order(report: ReportInput) -> list[ScenarioResult]:
    return sorted(report.scenarios, key=lambda s: (s.decision_score or 0.0), reverse=True)


def _reference_scenario(report: ReportInput, ordered: list[ScenarioResult]) -> ScenarioResult:
    if report.reference_scenario_id:
        by_id = {s.scenario_id: s for s in ordered}
        if report.reference_scenario_id in by_id:
            return by_id[report.reference_scenario_id]
    return ordered[0]


def _best_energy_scenario(ordered: list[ScenarioResult]) -> ScenarioResult:
    return max(ordered, key=lambda s: (s.annual_total_kwh if s.annual_total_kwh is not None else -1e18))


def _best_structural_scenario(ordered: list[ScenarioResult]) -> ScenarioResult:
    return max(ordered, key=lambda s: (s.structural_confidence_score if s.structural_confidence_score is not None else -1e18))


def _lowest_cost_scenario(ordered: list[ScenarioResult]) -> ScenarioResult:
    return min(ordered, key=lambda s: (s.structure_cost if s.structure_cost is not None else 1e18))


def _render_section_header(title: str, tag: str) -> str:
    return (
        '<div class="section-header">'
        f"<h2>{escape(title)}</h2>"
        f'<span class="section-tag">{escape(tag)}</span>'
        "</div>"
    )


def _render_meta_card(label: str, value: str) -> str:
    return (
        '<div class="meta-card">'
        f'<div class="label">{escape(label)}</div>'
        f'<div class="value">{escape(value)}</div>'
        "</div>"
    )


def _render_kpi_card(label: str, value: str, note: str = "") -> str:
    note_html = f'<div class="kpi-note">{escape(note)}</div>' if note else ""
    return (
        '<div class="kpi-card">'
        f'<div class="kpi-label">{escape(label)}</div>'
        f'<div class="kpi-value">{escape(value)}</div>'
        f"{note_html}"
        "</div>"
    )


def _render_empty_state(message: str) -> str:
    return f'<div class="empty-state">{escape(message)}</div>'


def _render_compact_list(items: list[str]) -> str:
    if not items:
        return _render_empty_state("No content available.")
    html_items = "".join(f"<li>{escape(item)}</li>" for item in items if item and item.strip())
    if not html_items:
        return _render_empty_state("No content available.")
    return f'<ul class="compact">{html_items}</ul>'


def _render_bar_chart(
    *,
    title: str,
    rows: list[ScenarioResult],
    attr: str,
    formatter,
    caption: str,
) -> str:
    values = [getattr(s, attr, None) for s in rows]
    clean = [v for v in values if isinstance(v, (int, float))]
    if not clean:
        return (
            '<div class="chart-block">'
            f"<h3>{escape(title)}</h3>"
            f"{_render_empty_state('No chart data available for this section.')}"
            "</div>"
        )

    hi = max(clean)
    lo = min(clean)
    span = max(hi - lo, 1e-9)

    bars = []
    for s in rows:
        value = getattr(s, attr, None)
        if value is None:
            width = 2.0
            display = "N/A"
        else:
            width = 16.0 + 84.0 * ((value - lo) / span)
            display = formatter(value)
        bars.append(
            '<div class="bar-row">'
            f'<div class="bar-label">{escape(s.label)}</div>'
            '<div class="bar-track">'
            f'<div class="bar-fill" style="width:{width:.1f}%"></div>'
            "</div>"
            f'<div class="bar-value">{escape(display)}</div>'
            "</div>"
        )
    return (
        '<div class="chart-block">'
        f"<h3>{escape(title)}</h3>"
        f'<div class="bar-list">{"".join(bars)}</div>'
        f'<div class="caption">{escape(caption)}</div>'
        "</div>"
    )


def render_cover(report: ReportInput, ordered: list[ScenarioResult], reference: ScenarioResult) -> str:
    rec_id = report.recommendation.recommended_scenario_id or ordered[0].scenario_id
    rec = next((s for s in ordered if s.scenario_id == rec_id), ordered[0])
    m = report.metadata
    s = report.site

    site_name = _safe_text(s.site_name, "Location Not Specified")
    location = (
        f"{site_name} ({s.latitude:.4f}, {s.longitude:.4f})"
        if s.latitude is not None and s.longitude is not None
        else site_name
    )

    cover_cards = "".join(
        [
            _render_meta_card("Project", _safe_text(m.project_name)),
            _render_meta_card("Report Date", str(m.report_date)),
            _render_meta_card("Reference Scenario", _safe_text(reference.label)),
            _render_meta_card("Recommended Scenario", _safe_text(rec.label)),
            _render_meta_card("Scenario Count", str(len(ordered))),
            _render_meta_card("Site / Coordinates", location),
        ]
    )

    return (
        '<section class="page cover-page">'
        '<div class="cover-top">'
        '<div>'
        '<div class="cover-kicker">Engineering Decision Report</div>'
        f'<h1 class="cover-title">{escape(_safe_text(m.report_title))}</h1>'
        f'<p class="cover-sub">{escape(_first_sentence(report.executive_summary, "Integrated technical-commercial scenario decision report for bifacial PV mounting options."))}</p>'
        "</div>"
        '<div class="brand-block">Logo / Branding Area</div>'
        "</div>"
        '<div class="cover-meta-grid">'
        f"{cover_cards}"
        "</div>"
        "</section>"
    )


def render_metadata_section(report: ReportInput, ordered: list[ScenarioResult], reference: ScenarioResult) -> str:
    m = report.metadata
    s = report.site
    best_energy = _best_energy_scenario(ordered)
    best_struct = _best_structural_scenario(ordered)
    low_cost = _lowest_cost_scenario(ordered)

    kpis = "".join(
        [
            _render_kpi_card("Best Energy Scenario", _safe_text(best_energy.label), f"Annual total: {_fmt_num(best_energy.annual_total_kwh)} kWh"),
            _render_kpi_card("Best Structural Confidence", _safe_text(best_struct.label), f"Score: {_fmt_num(best_struct.structural_confidence_score, 1)}/100"),
            _render_kpi_card("Lowest Structure Cost", _safe_text(low_cost.label), f"Cost: {_fmt_currency(low_cost.structure_cost, m.currency)}"),
        ]
    )

    meta_cards = "".join(
        [
            _render_meta_card("Author", _safe_text(m.prepared_by)),
            _render_meta_card("Client", _safe_text(m.client_name, "Not specified")),
            _render_meta_card("Project Code", _safe_text(m.project_code, "Not specified")),
            _render_meta_card("Report Version", _safe_text(m.report_version)),
            _render_meta_card("Currency", _safe_text(m.currency)),
            _render_meta_card("Annual Albedo", _fmt_num(s.annual_albedo, 3)),
            _render_meta_card("Annual GHI (kWh/m2)", _fmt_num(s.annual_ghi_kwh_m2, 0)),
            _render_meta_card("Reference Scenario", _safe_text(reference.label)),
        ]
    )

    return (
        '<section class="page section">'
        f"{_render_section_header('Report Metadata / Project Information', 'Context')}"
        f'<div class="grid-2"><div class="block"><h3>Project Metadata</h3><div class="cover-meta-grid">{meta_cards}</div></div>'
        '<div class="block">'
        '<h3>Site Notes</h3>'
        f'<p>{escape(_safe_text(s.climate_note, "Climate note not provided. NASA POWER and PVGIS context still applied where available."))}</p>'
        '<div class="callout">'
        '<strong>Decision Context</strong>'
        '<p class="small">This report is designed to support purlin-count selection by balancing energy yield, structural confidence, and indicative commercial implications.</p>'
        "</div>"
        "</div></div>"
        f'<div class="grid-3" style="margin-top:12px">{kpis}</div>'
        "</section>"
    )


def render_executive_section(report: ReportInput, ordered: list[ScenarioResult], reference: ScenarioResult) -> str:
    rec_id = report.recommendation.recommended_scenario_id or ordered[0].scenario_id
    rec = next((s for s in ordered if s.scenario_id == rec_id), ordered[0])
    delta_kwh = rec.delta_kwh_vs_ref
    delta_capex = rec.capex_delta_vs_ref

    status_class = _status_from_delta(delta_kwh)
    delta_label = _fmt_signed(delta_kwh, 0) + " kWh"
    capex_label = _fmt_currency(delta_capex, report.metadata.currency)

    snapshot_cards = "".join(
        [
            _render_kpi_card("Recommended Scenario", _safe_text(rec.label), f"Decision score: {_fmt_num(rec.decision_score, 1)}/100"),
            _render_kpi_card("Energy Delta vs Reference", delta_label, "Positive values indicate higher annual total energy."),
            _render_kpi_card("CAPEX Delta vs Reference", capex_label, "Indicative structure CAPEX difference."),
        ]
    )

    pros = rec.engineering_notes[:2] + rec.commercial_notes[:1]
    cons = []
    if rec.rear_blockage_pct is not None and rec.rear_blockage_pct > 10:
        cons.append("Rear-side obstruction is non-trivial and should be validated against measured bifacial response.")
    if rec.capex_delta_vs_ref is not None and rec.capex_delta_vs_ref > 0:
        cons.append("Recommended option carries a structure CAPEX uplift versus reference.")
    if not cons:
        cons.append("No major downside is dominant in current model context; proceed with site-specific verification.")

    return (
        '<section class="page section">'
        f"{_render_section_header('Executive Summary', 'Investor / Management')}"
        f'<div class="callout"><p>{escape(report.executive_summary or "Executive summary was not provided. Review decision snapshot and recommendation sections.")}</p></div>'
        '<div style="margin-top:12px">'
        f"{_render_section_header('Decision Snapshot', 'One-Page Decision')}"
        f'<div class="grid-3">{snapshot_cards}</div>'
        '<div style="margin-top:12px" class="grid-2">'
        '<div class="comparison-card">'
        '<div class="comparison-title">Why This Option</div>'
        f"{_render_compact_list(pros)}"
        "</div>"
        '<div class="comparison-card">'
        f'<div class="comparison-title">Watch-Outs <span class="status-pill {status_class}">{escape(status_class.upper())}</span></div>'
        f"{_render_compact_list(cons)}"
        "</div>"
        "</div>"
        f'<p class="caption">{escape(report.decision_snapshot or "")}</p>'
        "</div>"
        "</section>"
    )


def render_methodology_and_sources(report: ReportInput) -> str:
    method_html = _render_compact_list(report.methodology_overview)
    source_rows = "".join(
        (
            "<tr>"
            f"<td class='strong'>{escape(src.name)}</td>"
            f"<td>{escape(_safe_text(src.provider, '-'))}</td>"
            f"<td>{escape(_safe_text(src.retrieved_at, '-'))}</td>"
            f"<td>{escape(_safe_text(src.note, '-'))}</td>"
            "</tr>"
        )
        for src in report.data_sources
    )
    if not source_rows:
        source_rows = "<tr><td colspan='4'>No source metadata provided.</td></tr>"

    assumption_rows = "".join(
        (
            "<tr>"
            f"<td class='strong'>{escape(a.title)}</td>"
            f"<td>{escape(a.value)}</td>"
            f"<td class='center'><span class='status-pill {escape(a.confidence)}'>{escape(a.confidence.upper())}</span></td>"
            "</tr>"
        )
        for a in report.assumptions
    )
    if not assumption_rows:
        assumption_rows = "<tr><td colspan='3'>No assumptions provided.</td></tr>"

    return (
        '<section class="page section">'
        f"{_render_section_header('Methodology Overview', 'Technical Basis')}"
        f'<div class="block">{method_html}</div>'
        f"{_render_section_header('Data Sources and Assumptions', 'Input Integrity')}"
        '<div class="grid-2">'
        '<div class="table-wrap">'
        "<table><thead><tr><th>Source</th><th>Provider</th><th>Retrieved</th><th>Note</th></tr></thead>"
        f"<tbody>{source_rows}</tbody></table>"
        "</div>"
        '<div class="table-wrap">'
        "<table><thead><tr><th>Assumption</th><th>Value</th><th>Confidence</th></tr></thead>"
        f"<tbody>{assumption_rows}</tbody></table>"
        "</div>"
        "</div>"
        "</section>"
    )


def render_scenario_definition_and_summary(report: ReportInput, ordered: list[ScenarioResult], reference: ScenarioResult) -> str:
    definition_cards = []
    for s in ordered:
        notes = []
        notes.append(f"Purlin count: {s.purlin_count if s.purlin_count is not None else 'N/A'}")
        notes.append("Cross-brace: Yes" if s.cross_brace else "Cross-brace: No")
        if s.rear_blockage_pct is not None:
            notes.append(f"Rear blockage: {_fmt_num(s.rear_blockage_pct, 2)}%")
        if s.structure_cost is not None:
            notes.append(f"Structure cost: {_fmt_currency(s.structure_cost, report.metadata.currency)}")
        definition_cards.append(
            '<div class="comparison-card">'
            f'<div class="comparison-title">{escape(s.label)}</div>'
            f"{_render_compact_list(notes)}"
            "</div>"
        )

    rows = []
    for idx, s in enumerate(ordered, start=1):
        ref_tag = " (REF)" if s.scenario_id == reference.scenario_id else ""
        rows.append(
            "<tr>"
            f"<td class='center strong'>{idx}</td>"
            f"<td class='strong'>{escape(s.label + ref_tag)}</td>"
            f"<td class='center'>{escape(str(s.purlin_count) if s.purlin_count is not None else 'N/A')}</td>"
            f"<td class='center'>{'Yes' if s.cross_brace else 'No'}</td>"
            f"<td class='right'>{_fmt_num(s.annual_total_kwh, 0)}</td>"
            f"<td class='right'>{_fmt_num(s.effective_rear_gain_pct, 2)}</td>"
            f"<td class='right'>{_fmt_num(s.structural_confidence_score, 1)}</td>"
            f"<td class='right'>{_fmt_currency(s.structure_cost, report.metadata.currency)}</td>"
            f"<td class='right'>{_fmt_signed(s.delta_kwh_vs_ref, 0)}</td>"
            "</tr>"
        )

    return (
        '<section class="page section">'
        f"{_render_section_header('Scenario Definitions', 'Alternatives')}"
        f'<div class="grid-2">{"".join(definition_cards) if definition_cards else _render_empty_state("No scenario definition data.")}</div>'
        f"{_render_section_header('Scenario Comparison Summary', 'Side-by-Side')}"
        '<div class="table-wrap">'
        "<table>"
        "<thead><tr><th>#</th><th>Scenario</th><th>Purlin</th><th>Cross Brace</th><th class='right'>Annual Total (kWh)</th><th class='right'>Eff. Rear Gain (%)</th><th class='right'>Structural Score</th><th class='right'>Structure Cost</th><th class='right'>Delta vs Ref (kWh)</th></tr></thead>"
        f"<tbody>{''.join(rows) if rows else '<tr><td colspan=\"9\">No scenario rows available.</td></tr>'}</tbody>"
        "</table>"
        "</div>"
        "</section>"
    )


def render_rear_and_energy_sections(report: ReportInput, ordered: list[ScenarioResult]) -> str:
    rear_block_chart = _render_bar_chart(
        title="Rear-Side Obstruction by Scenario",
        rows=ordered,
        attr="rear_blockage_pct",
        formatter=lambda v: f"{v:.2f}%",
        caption="Higher values indicate stronger backside shading/obstruction effect.",
    )
    rear_gain_chart = _render_bar_chart(
        title="Effective Rear Gain (%)",
        rows=ordered,
        attr="effective_rear_gain_pct",
        formatter=lambda v: f"{v:.2f}%",
        caption="Estimated effective rear-side energy contribution ratio.",
    )
    energy_chart = _render_bar_chart(
        title="Annual Total Energy (kWh)",
        rows=ordered,
        attr="annual_total_kwh",
        formatter=lambda v: f"{v:,.0f}",
        caption="Comparative annual total energy output across purlin alternatives.",
    )

    return (
        '<section class="page section">'
        f"{_render_section_header('Bifacial Rear-Side Impact Analysis', 'Optical / Mismatch')}"
        f'<div class="grid-2">{rear_block_chart}{rear_gain_chart}</div>'
        f"{_render_section_header('Energy Yield Comparison', 'Yield Delta')}"
        f"{energy_chart}"
        "</section>"
    )


def render_structural_and_cost_sections(report: ReportInput, ordered: list[ScenarioResult], reference: ScenarioResult) -> str:
    structural_chart = _render_bar_chart(
        title="Structural Confidence Proxy (0-100)",
        rows=ordered,
        attr="structural_confidence_score",
        formatter=lambda v: f"{v:.1f}",
        caption="Proxy score intended for comparative decision support, not final static approval.",
    )
    cost_chart = _render_bar_chart(
        title=f"Indicative Structure Cost ({report.metadata.currency})",
        rows=ordered,
        attr="structure_cost",
        formatter=lambda v: f"{v:,.0f}",
        caption="Structure CAPEX proxy driven by purlin count and brace usage assumptions.",
    )

    cost_rows = []
    for s in ordered:
        cost_rows.append(
            "<tr>"
            f"<td class='strong'>{escape(s.label)}</td>"
            f"<td class='right'>{_fmt_currency(s.structure_cost, report.metadata.currency)}</td>"
            f"<td class='right'>{_fmt_currency(s.capex_delta_vs_ref, report.metadata.currency)}</td>"
            f"<td class='right'>{_fmt_num(s.lcoe_delta_pct, 2) if s.lcoe_delta_pct is not None else 'N/A'}</td>"
            "</tr>"
        )

    structural_notes = [
        "Structural confidence scores are comparative indicators based on purlin count and brace presence.",
        "Final structural acceptance requires project code checks, geotechnical envelope, and detailed design verification.",
        f"Reference scenario for cost deltas: {reference.label}.",
    ]

    return (
        '<section class="page section">'
        f"{_render_section_header('Structural / Engineering Considerations', 'Engineering')}"
        '<div class="grid-2">'
        f"{structural_chart}"
        f'<div class="note-box"><h3>Engineering Interpretation</h3>{_render_compact_list(structural_notes)}</div>'
        "</div>"
        f"{_render_section_header('Cost and Commercial Comparison', 'Commercial')}"
        '<div class="grid-2">'
        f"{cost_chart}"
        '<div class="table-wrap">'
        "<table><thead><tr><th>Scenario</th><th class='right'>Structure Cost</th><th class='right'>Delta vs Ref</th><th class='right'>LCOE Delta (%)</th></tr></thead>"
        f"<tbody>{''.join(cost_rows) if cost_rows else '<tr><td colspan=\"4\">No cost data available.</td></tr>'}</tbody></table>"
        "</div>"
        "</div>"
        "</section>"
    )


def render_uncertainty_section(report: ReportInput, ordered: list[ScenarioResult]) -> str:
    uncertainty_rows = []
    by_scenario = {u.scenario_id: u for u in report.uncertainty}
    for s in ordered:
        u = by_scenario.get(s.scenario_id)
        uncertainty_rows.append(
            "<tr>"
            f"<td class='strong'>{escape(s.label)}</td>"
            f"<td class='right'>{_fmt_num(u.p90_kwh if u else None, 0)}</td>"
            f"<td class='right'>{_fmt_num(u.p50_kwh if u else s.annual_total_kwh, 0)}</td>"
            f"<td class='right'>{_fmt_num(u.p10_kwh if u else None, 0)}</td>"
            f"<td>{escape(_safe_text(u.note if u else None, '-'))}</td>"
            "</tr>"
        )

    note = (
        "Monte Carlo-based results are interpreted as confidence-aware scenario outcomes. "
        "Values indicate decision-oriented ranges, not deterministic guarantees."
    )
    return (
        '<section class="page section">'
        f"{_render_section_header('Uncertainty / Sensitivity Interpretation', 'Risk Envelope')}"
        '<div class="risk-box">'
        f"<p>{escape(note)}</p>"
        "</div>"
        '<div class="table-wrap" style="margin-top:10px">'
        "<table><thead><tr><th>Scenario</th><th class='right'>P90 (kWh)</th><th class='right'>P50 (kWh)</th><th class='right'>P10 (kWh)</th><th>Interpretation</th></tr></thead>"
        f"<tbody>{''.join(uncertainty_rows) if uncertainty_rows else '<tr><td colspan=\"5\">No uncertainty points available.</td></tr>'}</tbody>"
        "</table></div>"
        "</section>"
    )


def render_tradeoff_and_recommendation(report: ReportInput, ordered: list[ScenarioResult]) -> str:
    rec_id = report.recommendation.recommended_scenario_id or ordered[0].scenario_id
    rec = next((s for s in ordered if s.scenario_id == rec_id), ordered[0])
    rec_rationale = report.recommendation.rationale if report.recommendation.rationale else [
        "Recommendation rationale was not supplied in the input.",
    ]

    return (
        '<section class="page section">'
        f"{_render_section_header('Key Trade-Offs', 'Decision Drivers')}"
        f'<div class="block">{_render_compact_list(report.key_tradeoffs)}</div>'
        f"{_render_section_header('Final Recommendation', 'Decision')}"
        '<div class="recommendation-box">'
        '<div class="recommendation-title">Recommended Scenario</div>'
        f"<h3>{escape(rec.label)}</h3>"
        f"<p>{escape(report.recommendation.summary or 'No recommendation summary provided.')}</p>"
        f"{_render_compact_list(rec_rationale)}"
        f"<p class='footnote'>{escape(_safe_text(report.recommendation.conditional_note, 'No conditional recommendation note provided.'))}</p>"
        f"<p class='footnote'><strong>Investor Interpretation:</strong> {escape(_safe_text(report.recommendation.investor_takeaway, 'N/A'))}</p>"
        "</div>"
        "</section>"
    )


def render_appendix(report: ReportInput, ordered: list[ScenarioResult]) -> str:
    appendix_list = report.appendix_notes[:]
    if report.simulation_stdout:
        appendix_list.append("Simulation console extract is included for traceability.")

    stdout_text = (report.simulation_stdout or "").strip()
    if len(stdout_text) > 4500:
        stdout_text = stdout_text[:4500] + "\n...\n(truncated)"

    scenario_rows = []
    for s in ordered:
        scenario_rows.append(
            "<tr>"
            f"<td class='strong'>{escape(s.scenario_id)}</td>"
            f"<td>{escape(s.label)}</td>"
            f"<td class='center'>{escape(str(s.purlin_count) if s.purlin_count is not None else 'N/A')}</td>"
            f"<td class='center'>{'Yes' if s.cross_brace else 'No'}</td>"
            f"<td class='right'>{_fmt_num(s.rear_blockage_pct, 2)}</td>"
            f"<td class='right'>{_fmt_num(s.mismatch_pct, 2)}</td>"
            f"<td class='right'>{_fmt_num(s.decision_score, 1)}</td>"
            "</tr>"
        )

    return (
        '<section class="page section">'
        f"{_render_section_header('Appendix / Technical Notes', 'Reference')}"
        f'<div class="block">{_render_compact_list(appendix_list)}</div>'
        '<div class="table-wrap" style="margin-top:10px">'
        "<table><thead><tr><th>Scenario ID</th><th>Label</th><th>Purlin</th><th>Cross Brace</th><th class='right'>Rear Blockage (%)</th><th class='right'>Mismatch (%)</th><th class='right'>Decision Score</th></tr></thead>"
        f"<tbody>{''.join(scenario_rows) if scenario_rows else '<tr><td colspan=\"7\">No scenario records.</td></tr>'}</tbody></table>"
        "</div>"
        '<div class="block" style="margin-top:10px">'
        "<h3>Simulation Trace (Excerpt)</h3>"
        f"<pre class='mono small' style='white-space:pre-wrap'>{escape(stdout_text or 'No simulation trace provided.')}</pre>"
        "</div>"
        "</section>"
    )


def build_report_body(report: ReportInput) -> str:
    ordered = _ensure_scenario_order(report)
    reference = _reference_scenario(report, ordered)
    sections = [
        render_cover(report, ordered, reference),
        render_metadata_section(report, ordered, reference),
        render_executive_section(report, ordered, reference),
        render_methodology_and_sources(report),
        render_scenario_definition_and_summary(report, ordered, reference),
        render_rear_and_energy_sections(report, ordered),
        render_structural_and_cost_sections(report, ordered, reference),
        render_uncertainty_section(report, ordered),
        render_tradeoff_and_recommendation(report, ordered),
        render_appendix(report, ordered),
    ]
    return "\n".join(sections)


def build_report_html(report: ReportInput, template_path: Path = DEFAULT_TEMPLATE_PATH, css_path: Path = DEFAULT_CSS_PATH) -> str:
    template = template_path.read_text(encoding="utf-8")
    css = css_path.read_text(encoding="utf-8")
    body = build_report_body(report)
    html = (
        template.replace("__INLINE_CSS__", css)
        .replace("__REPORT_TITLE__", escape(report.metadata.report_title))
        .replace("__REPORT_BODY__", body)
    )
    return html


def export_pdf_playwright(html_path: Path, pdf_path: Path, report: ReportInput) -> None:
    if sync_playwright is None:
        raise RuntimeError("playwright is not available.")

    header_template = (
        "<div style='width:100%;font-size:8px;color:#5f6f7a;padding:0 8px;'>"
        f"<span>{escape(report.metadata.project_name)}</span>"
        "</div>"
    )
    footer_template = (
        "<div style='width:100%;font-size:8px;color:#5f6f7a;padding:0 8px;display:flex;justify-content:space-between;'>"
        "<span>Bifacial PV Decision Report</span>"
        "<span><span class='pageNumber'></span> / <span class='totalPages'></span></span>"
        "</div>"
    )

    pdf_path.parent.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto(html_path.resolve().as_uri(), wait_until="load")
        page.emulate_media(media="print")
        page.pdf(
            path=str(pdf_path),
            format="A4",
            print_background=True,
            display_header_footer=True,
            header_template=header_template,
            footer_template=footer_template,
            margin={
                "top": "16mm",
                "right": "10mm",
                "bottom": "16mm",
                "left": "10mm",
            },
            prefer_css_page_size=False,
        )
        browser.close()


def export_pdf_chrome_fallback(html_path: Path, pdf_path: Path) -> None:
    candidates = [
        Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe"),
        Path(r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"),
        Path(r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"),
        Path(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"),
    ]
    chrome = next((p for p in candidates if p.exists()), None)
    if chrome is None:
        raise RuntimeError("No Chrome/Edge executable found for fallback PDF export.")

    pdf_path.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        str(chrome),
        "--headless=new",
        "--disable-gpu",
        "--allow-file-access-from-files",
        f"--print-to-pdf={pdf_path.resolve()}",
        "--print-to-pdf-no-header",
        html_path.resolve().as_uri(),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"Chrome fallback PDF export failed: {proc.stderr.strip() or proc.stdout.strip()}")


def generate_report_files(
    report: ReportInput,
    *,
    output_html: Path,
    output_pdf: Path | None = None,
    output_json: Path | None = None,
) -> dict[str, Any]:
    output_html.parent.mkdir(parents=True, exist_ok=True)
    html = build_report_html(report)
    output_html.write_text(html, encoding="utf-8")

    if output_json is not None:
        output_json.parent.mkdir(parents=True, exist_ok=True)
        output_json.write_text(json.dumps(report.model_dump(mode="json"), ensure_ascii=False, indent=2), encoding="utf-8")

    pdf_mode = "none"
    if output_pdf is not None:
        try:
            export_pdf_playwright(output_html, output_pdf, report)
            pdf_mode = "playwright"
        except Exception:
            export_pdf_chrome_fallback(output_html, output_pdf)
            pdf_mode = "chrome-fallback"

    return {
        "html_path": str(output_html.resolve()),
        "pdf_path": str(output_pdf.resolve()) if output_pdf else "",
        "json_path": str(output_json.resolve()) if output_json else "",
        "pdf_mode": pdf_mode,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Render premium bifacial decision report from JSON input.")
    parser.add_argument("--input-json", required=True, help="Path to report input JSON.")
    parser.add_argument("--out-html", required=True, help="Output HTML path.")
    parser.add_argument("--out-pdf", default="", help="Output PDF path.")
    parser.add_argument("--out-json", default="", help="Optional normalized JSON output path.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    input_path = Path(args.input_json).expanduser().resolve()
    out_html = Path(args.out_html).expanduser().resolve()
    out_pdf = Path(args.out_pdf).expanduser().resolve() if args.out_pdf else None
    out_json = Path(args.out_json).expanduser().resolve() if args.out_json else None

    if not input_path.exists():
        raise FileNotFoundError(f"Input JSON not found: {input_path}")

    raw = json.loads(input_path.read_text(encoding="utf-8"))
    report = ReportInput.model_validate(raw)
    result = generate_report_files(report, output_html=out_html, output_pdf=out_pdf, output_json=out_json)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
