from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import BaseModel, Field, field_validator


LOCKED_REPORT_AUTHOR = "Mustafa Ünal"


class ReportMetadata(BaseModel):
    report_title: str = "Bifacial PV Mounting Decision Report"
    project_name: str = "Unnamed Project"
    project_code: str | None = None
    client_name: str | None = None
    prepared_by: str = LOCKED_REPORT_AUTHOR
    report_date: date = Field(default_factory=date.today)
    report_version: str = "1.0"
    currency: str = "USD"

    @field_validator("prepared_by", mode="before")
    @classmethod
    def lock_prepared_by(cls, _value: str | None) -> str:
        return LOCKED_REPORT_AUTHOR


class SiteInfo(BaseModel):
    site_name: str | None = None
    country: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    annual_albedo: float | None = None
    annual_ghi_kwh_m2: float | None = None
    climate_note: str | None = None


class DataSource(BaseModel):
    name: str
    provider: str | None = None
    url: str | None = None
    retrieved_at: str | None = None
    note: str | None = None


class AssumptionItem(BaseModel):
    title: str
    value: str
    confidence: Literal["high", "medium", "low"] = "medium"


class ScenarioResult(BaseModel):
    scenario_id: str
    label: str
    purlin_count: int | None = None
    cross_brace: bool = False
    annual_total_kwh: float | None = None
    annual_rear_kwh: float | None = None
    effective_rear_gain_pct: float | None = None
    rear_blockage_pct: float | None = None
    rear_blockage_std_pct: float | None = None
    mismatch_pct: float | None = None
    structural_confidence_score: float | None = None
    structure_cost: float | None = None
    capex_delta_vs_ref: float | None = None
    delta_kwh_vs_ref: float | None = None
    delta_pct_vs_ref: float | None = None
    lcoe_delta_pct: float | None = None
    decision_score: float | None = None
    engineering_notes: list[str] = Field(default_factory=list)
    commercial_notes: list[str] = Field(default_factory=list)


class UncertaintyPoint(BaseModel):
    scenario_id: str
    p50_kwh: float | None = None
    p90_kwh: float | None = None
    p10_kwh: float | None = None
    note: str | None = None


class Recommendation(BaseModel):
    recommended_scenario_id: str | None = None
    summary: str = ""
    rationale: list[str] = Field(default_factory=list)
    conditional_note: str | None = None
    investor_takeaway: str | None = None


class ReportInput(BaseModel):
    metadata: ReportMetadata
    site: SiteInfo = Field(default_factory=SiteInfo)
    executive_summary: str = ""
    decision_snapshot: str = ""
    methodology_overview: list[str] = Field(default_factory=list)
    data_sources: list[DataSource] = Field(default_factory=list)
    assumptions: list[AssumptionItem] = Field(default_factory=list)
    scenarios: list[ScenarioResult]
    reference_scenario_id: str | None = None
    uncertainty: list[UncertaintyPoint] = Field(default_factory=list)
    key_tradeoffs: list[str] = Field(default_factory=list)
    recommendation: Recommendation = Field(default_factory=Recommendation)
    appendix_notes: list[str] = Field(default_factory=list)
    simulation_stdout: str | None = None

    @field_validator("scenarios")
    @classmethod
    def validate_scenarios(cls, value: list[ScenarioResult]) -> list[ScenarioResult]:
        if not value:
            raise ValueError("At least one scenario is required.")
        ids = [s.scenario_id for s in value]
        if len(set(ids)) != len(ids):
            raise ValueError("Scenario IDs must be unique.")
        return value
