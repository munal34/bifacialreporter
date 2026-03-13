#!/usr/bin/env python3
"""
Automatic report generator for the bifacial project.

Flow:
1) Run simulation with bifacial_support_compare.py and collect CSV output.
2) Read template DOCX and append an automatically generated analysis appendix.
3) Add AI commentary (OpenAI) if OPENAI_API_KEY is available, otherwise use rule-based commentary.
4) Export final DOCX and PDF.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import subprocess
import sys
import textwrap
from datetime import datetime
from pathlib import Path
from typing import Any

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Pt, RGBColor

try:
    from docx2pdf import convert as docx_to_pdf
except Exception:
    docx_to_pdf = None

try:
    from openai import OpenAI
except Exception:
    OpenAI = None

try:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.pdfgen import canvas
except Exception:
    colors = None
    A4 = None
    mm = None
    canvas = None


AUTO_APPENDIX_MARKERS = (
    "otomatik veri işleme ve ai değerlendirme eki",
    "bifacial teknik simülasyon raporu eki",
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate case-study report from DOCX template.")
    parser.add_argument("--template", required=True, help="Path to DOCX template.")
    parser.add_argument("--config", default="example_config.json", help="Simulation config JSON.")
    parser.add_argument("--out-dir", default="outputs", help="Output directory.")
    parser.add_argument("--openai-model", default="gpt-4.1-mini", help="OpenAI model for commentary.")
    parser.add_argument("--project-name", default="Eğimli ve Sert Zeminli GES", help="Project title.")
    parser.add_argument("--no-openai", action="store_true", help="Disable OpenAI commentary.")
    return parser.parse_args()


def run_simulation(config_path: Path, csv_path: Path) -> tuple[list[dict[str, str]], str]:
    cmd = [
        sys.executable,
        "bifacial_support_compare.py",
        "--config",
        str(config_path),
        "--out-csv",
        str(csv_path),
    ]
    proc = subprocess.run(cmd, check=True, capture_output=True, text=True, encoding="utf-8")
    with csv_path.open("r", encoding="utf-8", newline="") as f:
        rows = list(csv.DictReader(f))
    if not rows:
        raise RuntimeError("Simulation CSV is empty.")
    return rows, proc.stdout


def as_float(row: dict[str, str], key: str) -> float:
    try:
        return float(row.get(key, "0") or 0)
    except ValueError:
        return 0.0


def as_bool(row: dict[str, str], key: str) -> bool:
    return str(row.get(key, "")).strip().lower() in {"1", "true", "yes"}


def compute_metrics(rows: list[dict[str, str]]) -> dict[str, Any]:
    parsed: list[dict[str, Any]] = []
    for row in rows:
        parsed.append(
            {
                "scenario": row.get("scenario", "").strip() or "Senaryo",
                "purlin_count": int(float(row.get("purlin_count", "0") or 0)),
                "cross_brace": as_bool(row, "cross_brace"),
                "mean_blockage_pct": as_float(row, "mean_blockage_pct"),
                "std_blockage_pct": as_float(row, "std_blockage_pct"),
                "mismatch_pct": as_float(row, "mismatch_pct"),
                "effective_rear_gain_pct": as_float(row, "effective_rear_gain_pct"),
                "annual_total_kwh": as_float(row, "annual_total_kwh"),
                "annual_rear_kwh": as_float(row, "annual_rear_kwh"),
                "delta_vs_ref_kwh": as_float(row, "delta_vs_ref_kwh"),
                "delta_vs_ref_pct": as_float(row, "delta_vs_ref_pct"),
            }
        )

    ranked = sorted(parsed, key=lambda r: r["annual_total_kwh"], reverse=True)
    for idx, row in enumerate(ranked, start=1):
        row["rank"] = idx

    ref = next((r for r in ranked if r["purlin_count"] == 0 and not r["cross_brace"]), ranked[0])
    best = ranked[0]
    worst = ranked[-1]
    ref_energy = ref["annual_total_kwh"] if ref["annual_total_kwh"] > 0 else 1.0
    best_vs_ref_kwh = best["annual_total_kwh"] - ref["annual_total_kwh"]
    worst_vs_ref_kwh = worst["annual_total_kwh"] - ref["annual_total_kwh"]

    return {
        "rows": ranked,
        "reference": ref,
        "best": best,
        "worst": worst,
        "spread_kwh": best["annual_total_kwh"] - worst["annual_total_kwh"],
        "best_vs_ref_kwh": best_vs_ref_kwh,
        "best_vs_ref_pct": 100.0 * (best["annual_total_kwh"] / ref_energy - 1.0),
        "worst_vs_ref_kwh": worst_vs_ref_kwh,
        "worst_vs_ref_pct": 100.0 * (worst["annual_total_kwh"] / ref_energy - 1.0),
    }


def extract_template_context(template_path: Path, max_paragraphs: int = 45) -> str:
    doc = Document(str(template_path))
    cleaned = [p.text.strip() for p in doc.paragraphs if p.text.strip()]
    return "\n".join(cleaned[:max_paragraphs])


def build_rule_based_commentary(metrics: dict[str, Any], _template_context: str, project_name: str) -> str:
    ref = metrics["reference"]
    best = metrics["best"]
    worst = metrics["worst"]
    spread = metrics["spread_kwh"]
    best_vs_ref_kwh = metrics["best_vs_ref_kwh"]
    best_vs_ref_pct = metrics["best_vs_ref_pct"]

    lines: list[str] = []
    lines.append("1) Veri Özeti")
    lines.append(
        f"{project_name} için arka taşıyıcı gölgelenme etkisi karşılaştırılmış, referans senaryo '{ref['scenario']}' "
        f"ve en iyi enerji sonucu '{best['scenario']}' olarak belirlenmiştir."
    )
    lines.append(
        f"Yıllık toplam enerji bandı {worst['annual_total_kwh']:,.0f} - {best['annual_total_kwh']:,.0f} kWh olup "
        f"senaryo yayılımı {spread:,.0f} kWh seviyesindedir."
    )
    lines.append(
        f"En iyi senaryonun referansa göre farkı {best_vs_ref_kwh:+,.0f} kWh (%{best_vs_ref_pct:+.2f}) olarak hesaplanmıştır."
    )

    lines.append("")
    lines.append("2) Teknik Yorum")
    lines.append(
        f"En iyi senaryoda arka blokaj %{best['mean_blockage_pct']:.2f}, mismatch %{best['mismatch_pct']:.2f} ve "
        f"etkili arka kazanç %{best['effective_rear_gain_pct']:.2f} düzeyindedir."
    )
    lines.append(
        "Aşık/çapraz eleman yoğunluğu arttıkça mekanik rijitlik kazanımı ile arka yüz ışınım kaybı birlikte artabilir; "
        "nihai seçim enerji, montaj riski ve statik gereksinimlerin ortak optimizasyonu ile yapılmalıdır."
    )

    lines.append("")
    lines.append("3) Tasarım Optimizasyon Önerileri")
    lines.append(
        "Referans + 2 alternatif senaryo için çok kriterli karar matrisi kurulmalı; enerji, montaj zorluğu ve yapısal güvenlik birlikte puanlanmalıdır."
    )
    lines.append(
        "Kritik eğim bölgelerinde segmentasyon (ör. 2x26 yerine 2x13) ile lokal kolon boyu ve sahadaki uygulama riski düşürülebilir."
    )
    lines.append(
        "Uygulama öncesi, yüksek sertlik sınıfında ön delgi/kazık stratejisi ve ekipman erişimi için ayrı bir saha doğrulaması yapılmalıdır."
    )

    lines.append("")
    lines.append("4) Riskler ve Kontrol Planı")
    lines.append(
        "Sahada lokal topografya farklarının yüksek olduğu bölgeler için kolon boyu, bağlantı kotu ve erişilebilirlik kontrolleri ayrı hold-point olarak yönetilmelidir."
    )
    lines.append(
        "Devreye alma öncesinde pilot bölgede ölçüm alınarak model kalibrasyonu yapılmalı ve gerekirse seçilen senaryo revize edilmelidir."
    )

    lines.append("")
    lines.append("5) Sonuç")
    lines.append(
        f"Model sonuçları enerji açısından '{best['scenario']}' senaryosunu öne çıkarmaktadır; nihai karar saha uygulanabilirliği ve statik emniyet ile birlikte verilmelidir."
    )
    return "\n".join(lines)


def build_openai_commentary(
    metrics: dict[str, Any],
    template_context: str,
    project_name: str,
    model: str,
) -> str | None:
    if OpenAI is None:
        return None
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        return None

    payload = {
        "project": project_name,
        "reference": metrics["reference"],
        "best": metrics["best"],
        "worst": metrics["worst"],
        "spread_kwh": metrics["spread_kwh"],
        "scenarios": metrics["rows"],
    }
    user_prompt = (
        "Aşağıdaki verilerden teknik, kısa ve karar odaklı bir Türkçe mühendislik değerlendirmesi yaz.\n"
        "Biçim: 1) Veri Özeti 2) Teknik Yorum 3) Tasarım Optimizasyon Önerileri 4) Riskler ve Kontrol Planı 5) Sonuç\n"
        "Sayıları uydurma; verilen metrikleri kullan.\n\n"
        f"Şablon bağlamı (özet):\n{template_context[:5500]}\n\n"
        f"Metrikler JSON:\n{json.dumps(payload, ensure_ascii=False, indent=2)}"
    )

    client = OpenAI(api_key=api_key)
    response = client.responses.create(
        model=model,
        temperature=0.2,
        input=[
            {
                "role": "system",
                "content": [
                    {
                        "type": "input_text",
                        "text": "Kıdemli güneş enerjisi ve saha uygulama mühendisisin. Net, teknik ve uygulanabilir yaz.",
                    }
                ],
            },
            {"role": "user", "content": [{"type": "input_text", "text": user_prompt}]},
        ],
    )
    text = (response.output_text or "").strip()
    return text or None


def set_table_style(table: Any, style_name: str) -> None:
    try:
        table.style = style_name
    except Exception:
        return


def set_cell_text(cell: Any, value: str, *, bold: bool = False) -> None:
    cell.text = str(value)
    if not cell.paragraphs:
        return
    para = cell.paragraphs[0]
    if para.runs:
        para.runs[0].bold = bold


def format_signed(value: float, digits: int = 2) -> str:
    sign = "+" if value >= 0 else ""
    return f"{sign}{value:,.{digits}f}"


def strip_previous_auto_appendix(doc: Document) -> int:
    body = doc.element.body
    nodes = list(body)
    start_idx: int | None = None
    for idx, node in enumerate(nodes):
        if not node.tag.endswith("}p"):
            continue
        text = "".join(node.itertext()).strip().lower()
        if any(marker in text for marker in AUTO_APPENDIX_MARKERS):
            start_idx = idx
            break
    if start_idx is None:
        return 0
    for node in nodes[start_idx:]:
        body.remove(node)
    return len(nodes) - start_idx


def clear_document_content(doc: Document) -> int:
    body = doc.element.body
    nodes = list(body)
    removed = 0
    for node in nodes:
        if node.tag.endswith("}sectPr"):
            continue
        body.remove(node)
        removed += 1
    return removed


def add_title_block(doc: Document, metrics: dict[str, Any], project_name: str, clean_note: str | None = None) -> None:
    title = doc.add_paragraph()
    title.alignment = WD_ALIGN_PARAGRAPH.LEFT
    run = title.add_run("Bifacial Teknik Simulasyon Raporu Eki")
    run.bold = True
    run.font.size = Pt(18)
    run.font.color.rgb = RGBColor(16, 62, 95)

    subtitle = doc.add_paragraph()
    subtitle_run = subtitle.add_run(project_name)
    subtitle_run.bold = True
    subtitle_run.font.size = Pt(11)
    subtitle_run.font.color.rgb = RGBColor(54, 66, 77)

    if clean_note:
        clean_note_p = doc.add_paragraph(clean_note)
        clean_note_run = clean_note_p.runs[0] if clean_note_p.runs else clean_note_p.add_run("")
        clean_note_run.italic = True
        clean_note_run.font.color.rgb = RGBColor(106, 54, 28)

    meta = doc.add_table(rows=6, cols=2)
    set_table_style(meta, "Light List Accent 1")
    items = [
        ("Rapor Uretim Zamani", datetime.now().strftime("%Y-%m-%d %H:%M")),
        ("Referans Senaryo", metrics["reference"]["scenario"]),
        ("Enerjiye Gore En Iyi Senaryo", metrics["best"]["scenario"]),
        ("Ref'e Gore En Iyi Fark (kWh)", format_signed(metrics["best_vs_ref_kwh"], 0)),
        ("Ref'e Gore En Iyi Fark (%)", format_signed(metrics["best_vs_ref_pct"], 2)),
        ("Senaryo Yayilimi (kWh)", f"{metrics['spread_kwh']:,.0f}"),
    ]
    for idx, (label, value) in enumerate(items):
        set_cell_text(meta.rows[idx].cells[0], label, bold=True)
        set_cell_text(meta.rows[idx].cells[1], str(value))


def append_analysis_to_docx(
    template_path: Path,
    out_docx_path: Path,
    metrics: dict[str, Any],
    analysis_text: str,
    simulation_stdout: str,
    project_name: str = "Eğimli ve Sert Zeminli GES",
    clear_existing_content: bool = True,
) -> None:
    doc = Document(str(template_path))
    clean_note: str | None = None

    if clear_existing_content:
        removed_blocks = clear_document_content(doc)
        clean_note = (
            f"Not: Sablonun onceki metin icerigi temizlendi (silinen blok: {removed_blocks})."
            if removed_blocks > 0
            else "Not: Sablonda silinecek ek metin bulunamadi."
        )
    else:
        removed_blocks = strip_previous_auto_appendix(doc)
        if removed_blocks > 0:
            clean_note = f"Not: Onceki otomatik ek bolumleri temizlendi (silinen blok: {removed_blocks})."
        doc.add_page_break()

    add_title_block(doc, metrics, project_name, clean_note)
    add_kpi_table(doc, metrics)
    add_results_table(doc, metrics["rows"], metrics["reference"]["scenario"])
    add_analysis_sections(doc, analysis_text)
    add_assumptions_table(doc)
    add_console_snippet(doc, simulation_stdout)

    out_docx_path.parent.mkdir(parents=True, exist_ok=True)
    doc.save(str(out_docx_path))


def add_kpi_table(doc: Document, metrics: dict[str, Any]) -> None:
    doc.add_heading("Performans Gostergeleri", level=2)
    best = metrics["best"]
    worst = metrics["worst"]
    table = doc.add_table(rows=5, cols=2)
    set_table_style(table, "Medium Shading 1 Accent 1")
    pairs = [
        ("En iyi yillik toplam enerji (kWh)", f"{best['annual_total_kwh']:,.0f}"),
        ("En kotu yillik toplam enerji (kWh)", f"{worst['annual_total_kwh']:,.0f}"),
        ("En iyi senaryoda arka blokaj (%)", f"{best['mean_blockage_pct']:.2f}"),
        ("En iyi senaryoda mismatch (%)", f"{best['mismatch_pct']:.2f}"),
        ("En iyi senaryoda etkili arka kazanc (%)", f"{best['effective_rear_gain_pct']:.2f}"),
    ]
    for idx, (label, value) in enumerate(pairs):
        set_cell_text(table.rows[idx].cells[0], label, bold=True)
        set_cell_text(table.rows[idx].cells[1], value)


def add_results_table(doc: Document, rows: list[dict[str, Any]], reference_name: str) -> None:
    doc.add_heading("Senaryo Siralama Tablosu", level=2)
    table = doc.add_table(rows=1, cols=11)
    set_table_style(table, "Light Shading Accent 1")
    headers = [
        "Sira",
        "Senaryo",
        "Asik",
        "Capraz",
        "Arka Blokaj (%)",
        "Std Blokaj (%)",
        "Mismatch (%)",
        "Etkili Arka Kazanc (%)",
        "Yillik Toplam (kWh)",
        "Ref Fark (kWh)",
        "Ref Fark (%)",
    ]
    for idx, header in enumerate(headers):
        set_cell_text(table.rows[0].cells[idx], header, bold=True)

    for r in rows:
        cells = table.add_row().cells
        scenario_label = f"{r['scenario']} (Ref)" if r["scenario"] == reference_name else r["scenario"]
        values = [
            str(r.get("rank", "-")),
            scenario_label,
            str(r["purlin_count"]),
            "Evet" if r["cross_brace"] else "Hayir",
            f"{r['mean_blockage_pct']:.2f}",
            f"{r['std_blockage_pct']:.2f}",
            f"{r['mismatch_pct']:.2f}",
            f"{r['effective_rear_gain_pct']:.2f}",
            f"{r['annual_total_kwh']:,.0f}",
            format_signed(r["delta_vs_ref_kwh"], 0),
            format_signed(r["delta_vs_ref_pct"], 2),
        ]
        for idx, value in enumerate(values):
            set_cell_text(cells[idx], value, bold=bool(r.get("rank") == 1 and idx in (0, 1, 8)))


def add_analysis_sections(doc: Document, body: str) -> None:
    doc.add_heading("Muhendislik Degerlendirmesi", level=2)
    for raw in body.splitlines():
        line = raw.strip()
        if not line:
            continue
        section = re.match(r"^(\d+)\)\s*(.+)$", line)
        if section:
            h = doc.add_heading(f"{section.group(1)}. {section.group(2)}", level=3)
            if h.runs:
                h.runs[0].font.color.rgb = RGBColor(16, 62, 95)
            continue
        p = doc.add_paragraph(line)
        if p.runs:
            p.runs[0].font.size = Pt(10.5)


def add_assumptions_table(doc: Document) -> None:
    doc.add_heading("Model Varsayimlari ve Sinirlari", level=2)
    table = doc.add_table(rows=4, cols=2)
    set_table_style(table, "Light List Accent 1")
    assumptions = [
        ("Isinim Yaklasimi", "Cosine-agirlikli hemisferik ornekleme ile izotropik arka isinim proxysi kullanilmistir."),
        ("Geometri Temsili", "Tasiyicilar eksenlere hizali kutu prizma olarak modellenmistir."),
        ("Uyumsuzluk Modeli", "Hucresel non-uniformite etkisi ampirik mismatch katsayisi ile temsilen eklenmistir."),
        ("Kullanim Notu", "Mutlak degerlerden cok senaryolar arasi goreli farklar karar amacli kullanilmalidir."),
    ]
    for idx, (name, detail) in enumerate(assumptions):
        set_cell_text(table.rows[idx].cells[0], name, bold=True)
        set_cell_text(table.rows[idx].cells[1], detail)


def add_console_snippet(doc: Document, simulation_stdout: str) -> None:
    doc.add_heading("Simulasyon Konsol Ozeti", level=2)
    snippet = simulation_stdout.strip()
    if len(snippet) > 9000:
        snippet = snippet[:9000] + "\n...\n(ozet kesildi)"
    para = doc.add_paragraph()
    run = para.add_run(snippet or "Konsol ciktisi bulunamadi.")
    run.font.name = "Consolas"
    run.font.size = Pt(8.5)


def fallback_pdf_from_text(pdf_path: Path, title: str, text_body: str) -> None:
    if canvas is None or A4 is None or mm is None:
        raise RuntimeError("Neither docx2pdf nor reportlab is available for PDF export.")

    pdf_path.parent.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(pdf_path), pagesize=A4)
    width, height = A4
    x = 16 * mm
    y = height - 18 * mm
    line_h = 5.2 * mm

    if colors is not None:
        c.setFillColor(colors.HexColor("#0E3E61"))
    else:
        c.setFillColorRGB(0.055, 0.243, 0.38)
    c.rect(0, height - 30 * mm, width, 30 * mm, fill=1, stroke=0)
    if colors is not None:
        c.setFillColor(colors.white)
    else:
        c.setFillColorRGB(1, 1, 1)
    c.setFont("Helvetica-Bold", 14)
    c.drawString(x, y, title)
    y -= line_h * 1.15
    c.setFont("Helvetica", 9)
    c.drawString(x, y, datetime.now().strftime("Uretim Zamani: %Y-%m-%d %H:%M"))

    if colors is not None:
        c.setFillColor(colors.black)
    else:
        c.setFillColorRGB(0, 0, 0)
    y = height - 38 * mm
    c.setFont("Helvetica", 10)

    for para in text_body.splitlines():
        wrapped = textwrap.wrap(para, width=105) or [""]
        for line in wrapped:
            if y <= 18 * mm:
                c.showPage()
                if colors is not None:
                    c.setFillColor(colors.black)
                else:
                    c.setFillColorRGB(0, 0, 0)
                c.setFont("Helvetica", 10)
                y = height - 20 * mm
            if re.match(r"^\d+\)", line):
                c.setFont("Helvetica-Bold", 10)
            else:
                c.setFont("Helvetica", 10)
            c.drawString(x, y, line)
            y -= line_h
    c.save()


def export_pdf(out_docx_path: Path, out_pdf_path: Path, fallback_text: str) -> str:
    if docx_to_pdf is not None:
        try:
            docx_to_pdf(str(out_docx_path), str(out_pdf_path))
            if out_pdf_path.exists():
                return "docx2pdf"
        except Exception:
            pass

    fallback_pdf_from_text(out_pdf_path, "Otomatik Rapor (Fallback PDF)", fallback_text)
    return "reportlab-fallback"


def main() -> None:
    args = parse_args()
    template_path = Path(args.template).expanduser().resolve()
    config_path = Path(args.config).expanduser().resolve()
    out_dir = Path(args.out_dir).expanduser().resolve()

    if not template_path.exists():
        raise FileNotFoundError(f"Template not found: {template_path}")
    if not config_path.exists():
        raise FileNotFoundError(f"Config not found: {config_path}")

    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    csv_path = out_dir / f"simulation_{ts}.csv"
    out_docx = out_dir / f"otomatik_rapor_{ts}.docx"
    out_pdf = out_dir / f"otomatik_rapor_{ts}.pdf"
    out_meta = out_dir / f"otomatik_rapor_{ts}.json"

    rows, simulation_stdout = run_simulation(config_path, csv_path)
    metrics = compute_metrics(rows)
    template_context = extract_template_context(template_path)

    analysis_text: str | None = None
    ai_mode = "rule-based"
    if not args.no_openai:
        try:
            analysis_text = build_openai_commentary(
                metrics=metrics,
                template_context=template_context,
                project_name=args.project_name,
                model=args.openai_model,
            )
            if analysis_text:
                ai_mode = f"openai:{args.openai_model}"
        except Exception:
            analysis_text = None

    if not analysis_text:
        analysis_text = build_rule_based_commentary(metrics, template_context, args.project_name)

    append_analysis_to_docx(
        template_path=template_path,
        out_docx_path=out_docx,
        metrics=metrics,
        analysis_text=analysis_text,
        simulation_stdout=simulation_stdout,
        project_name=args.project_name,
    )

    fallback_text = (
        f"{args.project_name}\n"
        f"Referans: {metrics['reference']['scenario']}\n"
        f"En iyi: {metrics['best']['scenario']}\n"
        f"Ref'e gore en iyi fark: {format_signed(metrics['best_vs_ref_kwh'], 0)} kWh "
        f"({format_signed(metrics['best_vs_ref_pct'], 2)}%)\n"
        f"Yayilim: {metrics['spread_kwh']:,.0f} kWh\n\n"
        f"{analysis_text}"
    )
    export_mode = export_pdf(out_docx, out_pdf, fallback_text)

    meta = {
        "template": str(template_path),
        "config": str(config_path),
        "output_docx": str(out_docx),
        "output_pdf": str(out_pdf),
        "output_csv": str(csv_path),
        "ai_mode": ai_mode,
        "pdf_export_mode": export_mode,
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "best_scenario": metrics["best"]["scenario"],
        "reference_scenario": metrics["reference"]["scenario"],
        "spread_kwh": metrics["spread_kwh"],
    }
    out_meta.parent.mkdir(parents=True, exist_ok=True)
    out_meta.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

    print(json.dumps(meta, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
