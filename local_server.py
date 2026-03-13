#!/usr/bin/env python3
"""
Local web server for Bifacial Reporter.

- Serves static project files from repository root (including /web/)
- Proxies NASA POWER and PVGIS requests to avoid browser CORS issues
- Generates premium report HTML/PDF in background with progress endpoints
"""

from __future__ import annotations

import argparse
import json
import os
import threading
import time
from datetime import datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlencode, urlparse
from urllib.request import Request, urlopen
from uuid import uuid4


REPO_ROOT = Path(__file__).resolve().parent
HOST = os.environ.get("HOST", "0.0.0.0")
OUTPUTS_DIR = REPO_ROOT / "outputs"
REPORT_JOBS_LOCK = threading.Lock()
REPORT_JOBS: dict[str, dict] = {}
MAX_REPORT_JOBS = 30
REPORT_OUTPUT_PATTERNS = (
    "report_cfg_*.json",
    "report_input_*.json",
    "simulation_*.csv",
    "otomatik_rapor_*.html",
    "otomatik_rapor_*.docx",
    "otomatik_rapor_*.pdf",
    "otomatik_rapor_*.json",
)


def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def trim_report_jobs() -> None:
    with REPORT_JOBS_LOCK:
        if len(REPORT_JOBS) <= MAX_REPORT_JOBS:
            return
        oldest = sorted(REPORT_JOBS.items(), key=lambda kv: kv[1].get("created_ts", 0))
        for job_id, _ in oldest[: max(0, len(REPORT_JOBS) - MAX_REPORT_JOBS)]:
            REPORT_JOBS.pop(job_id, None)


def init_report_job() -> str:
    job_id = uuid4().hex
    with REPORT_JOBS_LOCK:
        REPORT_JOBS[job_id] = {
            "job_id": job_id,
            "status": "queued",
            "progress": 0,
            "step": "Kuyruk",
            "message": "Rapor işi kuyruğa alındı.",
            "created_at": now_iso(),
            "updated_at": now_iso(),
            "created_ts": time.time(),
            "result": {},
            "error": "",
        }
    trim_report_jobs()
    return job_id


def update_report_job(job_id: str, **updates: object) -> None:
    with REPORT_JOBS_LOCK:
        job = REPORT_JOBS.get(job_id)
        if not job:
            return
        job.update(updates)
        job["updated_at"] = now_iso()


def get_report_job(job_id: str) -> dict | None:
    with REPORT_JOBS_LOCK:
        job = REPORT_JOBS.get(job_id)
        if not job:
            return None
        copy = dict(job)
        copy.pop("created_ts", None)
        return copy


def list_report_output_files() -> list[Path]:
    OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)
    files: list[Path] = []
    seen: set[Path] = set()
    for pattern in REPORT_OUTPUT_PATTERNS:
        for item in OUTPUTS_DIR.glob(pattern):
            if not item.is_file():
                continue
            resolved = item.resolve()
            if resolved in seen:
                continue
            seen.add(resolved)
            files.append(resolved)
    files.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    return files


def cleanup_report_outputs(keep_latest: int = 0) -> dict[str, object]:
    keep_n = max(0, int(keep_latest))
    all_files = list_report_output_files()
    target = all_files[keep_n:]
    removed_names: list[str] = []
    failed: list[str] = []

    for item in target:
        try:
            item.unlink()
            removed_names.append(item.name)
        except OSError as exc:
            failed.append(f"{item.name}: {exc}")

    return {
        "total_candidates": len(all_files),
        "kept_count": min(keep_n, len(all_files)),
        "removed_count": len(removed_names),
        "failed_count": len(failed),
        "removed_files": removed_names[:40],
        "failed_files": failed[:20],
    }


def run_report_job(job_id: str, payload: dict) -> None:
    try:
        update_report_job(job_id, status="running", progress=3, step="Hazırlık", message="Rapor üretimi başlatıldı.")

        from generate_case_report import (
            build_openai_commentary,
            build_rule_based_commentary,
            compute_metrics,
            run_simulation,
        )
        from reporting.adapters import build_report_input_from_analysis
        from reporting.render_report import generate_report_files
        from reporting.schema import LOCKED_REPORT_AUTHOR

        update_report_job(job_id, progress=8, step="Girdi", message="Rapor girdileri hazırlanıyor.")
        OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        cleanup_summary = {
            "total_candidates": 0,
            "kept_count": 0,
            "removed_count": 0,
            "failed_count": 0,
            "removed_files": [],
            "failed_files": [],
        }

        cleanup_previous = bool(payload.get("cleanup_previous_outputs", True))
        if cleanup_previous:
            update_report_job(job_id, progress=11, step="Temizlik", message="Önceki çıktı dosyaları temizleniyor.")
            cleanup_summary = cleanup_report_outputs(keep_latest=0)

        project_name = str(payload.get("project_name", "")).strip() or "Eğimli ve Sert Zeminli GES"
        use_openai = bool(payload.get("use_openai", False))
        openai_model = str(payload.get("openai_model", "gpt-4.1-mini"))

        requested_cfg = payload.get("config")
        if isinstance(requested_cfg, dict):
            cfg_path = OUTPUTS_DIR / f"report_cfg_{job_id}_{ts}.json"
            cfg_path.write_text(json.dumps(requested_cfg, ensure_ascii=False, indent=2), encoding="utf-8")
            cfg_for_report = requested_cfg
        else:
            cfg_path = REPO_ROOT / "example_config.json"
            cfg_for_report = json.loads(cfg_path.read_text(encoding="utf-8"))

        csv_path = OUTPUTS_DIR / f"simulation_{job_id}_{ts}.csv"
        out_input_json = OUTPUTS_DIR / f"report_input_{job_id}_{ts}.json"
        out_html = OUTPUTS_DIR / f"otomatik_rapor_{job_id}_{ts}.html"
        out_pdf = OUTPUTS_DIR / f"otomatik_rapor_{job_id}_{ts}.pdf"

        update_report_job(job_id, progress=22, step="Simülasyon", message="Senaryo simülasyonu çalıştırılıyor.")
        rows, simulation_stdout = run_simulation(cfg_path, csv_path)

        update_report_job(job_id, progress=44, step="Analiz", message="Metrikler hesaplanıyor.")
        metrics = compute_metrics(rows)
        template_context = ""

        update_report_job(job_id, progress=58, step="Yorum", message="Teknik yorum hazırlanıyor.")
        analysis_text = None
        ai_mode = "rule-based"
        if use_openai:
            try:
                analysis_text = build_openai_commentary(
                    metrics=metrics,
                    template_context=template_context,
                    project_name=project_name,
                    model=openai_model,
                )
                if analysis_text:
                    ai_mode = f"openai:{openai_model}"
            except Exception:
                analysis_text = None
        if not analysis_text:
            analysis_text = build_rule_based_commentary(metrics, template_context, project_name)

        update_report_job(job_id, progress=72, step="Rapor", message="Premium rapor şablonu oluşturuluyor.")
        report_input = build_report_input_from_analysis(
            project_name=project_name,
            config=cfg_for_report,
            rows=rows,
            metrics=metrics,
            commentary_text=analysis_text,
            simulation_stdout=simulation_stdout,
            payload=payload,
        )

        update_report_job(job_id, progress=90, step="PDF", message="PDF çıktısı üretiliyor.")
        render_result = generate_report_files(
            report_input,
            output_html=out_html,
            output_pdf=out_pdf,
            output_json=out_input_json,
        )
        pdf_mode = str(render_result.get("pdf_mode", "unknown"))

        rel_pdf = "/" + out_pdf.resolve().relative_to(REPO_ROOT).as_posix()
        rel_html = "/" + out_html.resolve().relative_to(REPO_ROOT).as_posix()
        rel_csv = "/" + csv_path.resolve().relative_to(REPO_ROOT).as_posix()

        update_report_job(
            job_id,
            status="done",
            progress=100,
            step="Tamamlandı",
            message="Rapor hazır. İndirebilirsiniz.",
            result={
                "pdf_path": str(out_pdf.resolve()),
                "docx_path": "",
                "html_path": str(out_html.resolve()),
                "csv_path": str(csv_path.resolve()),
                "download_url": rel_pdf,
                "docx_url": "",
                "html_url": rel_html,
                "csv_url": rel_csv,
                "ai_mode": ai_mode,
                "pdf_export_mode": pdf_mode,
                "author": LOCKED_REPORT_AUTHOR,
                "best_scenario": metrics["best"]["scenario"],
                "reference_scenario": metrics["reference"]["scenario"],
                "spread_kwh": metrics["spread_kwh"],
                "cleanup": cleanup_summary,
            },
        )
    except Exception as exc:
        update_report_job(
            job_id,
            status="error",
            progress=100,
            step="Hata",
            message="Rapor üretimi başarısız.",
            error=str(exc),
        )


def parse_coord(value: str, name: str, low: float, high: float) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{name} must be a number.") from exc
    if parsed < low or parsed > high:
        raise ValueError(f"{name} out of range [{low}, {high}].")
    return parsed


class LocalHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(REPO_ROOT), **kwargs)

    def end_headers(self) -> None:
        # Keep local dev deterministic: always serve fresh assets.
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path in {"", "/"}:
            self.send_response(302)
            self.send_header("Location", "/web/")
            self.end_headers()
            return
        if parsed.path == "/health":
            self.handle_health()
            return
        if parsed.path == "/api/nasa-albedo":
            self.handle_nasa_albedo(parsed.query)
            return
        if parsed.path == "/api/pvgis-tmy":
            self.handle_pvgis_tmy(parsed.query)
            return
        if parsed.path == "/api/report/status":
            self.handle_report_status(parsed.query)
            return
        super().do_GET()

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/report/start":
            self.handle_report_start()
            return
        if parsed.path == "/api/report/cleanup":
            self.handle_report_cleanup()
            return
        self.send_error_json(404, f"Unknown endpoint: {parsed.path}")

    def send_json(self, status_code: int, payload: bytes) -> None:
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(payload)

    def send_json_obj(self, status_code: int, obj: dict) -> None:
        self.send_json(status_code, json.dumps(obj, ensure_ascii=False).encode("utf-8"))

    def send_error_json(self, status_code: int, message: str) -> None:
        self.send_json_obj(status_code, {"error": message})

    def read_json_body(self) -> dict:
        length_text = self.headers.get("Content-Length", "0")
        try:
            length = int(length_text)
        except ValueError:
            raise ValueError("Invalid Content-Length header.")
        if length < 0 or length > 2_000_000:
            raise ValueError("Request body too large.")
        raw = self.rfile.read(length) if length else b"{}"
        try:
            payload = json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError as exc:
            raise ValueError(f"Invalid JSON body: {exc}") from exc
        if not isinstance(payload, dict):
            raise ValueError("JSON body must be an object.")
        return payload

    def proxy_json(self, target_url: str) -> None:
        request = Request(
            target_url,
            headers={
                "Accept": "application/json",
                "User-Agent": "bifacialreporter-local/1.0",
            },
        )
        try:
            with urlopen(request, timeout=35) as response:
                body = response.read()
                status_code = getattr(response, "status", 200)
                self.send_json(status_code, body)
        except HTTPError as exc:
            upstream_body = exc.read()
            if not upstream_body:
                upstream_body = json.dumps({"error": f"Upstream HTTP {exc.code}"}).encode("utf-8")
            self.send_json(exc.code, upstream_body)
        except URLError as exc:
            self.send_error_json(502, f"Upstream request failed: {exc.reason}")

    def handle_nasa_albedo(self, query: str) -> None:
        params = parse_qs(query)
        try:
            lat = parse_coord(params.get("latitude", [""])[0], "latitude", -90, 90)
            lon = parse_coord(params.get("longitude", [""])[0], "longitude", -180, 180)
        except ValueError as exc:
            self.send_error_json(400, str(exc))
            return

        target = (
            "https://power.larc.nasa.gov/api/temporal/climatology/point?"
            + urlencode(
                {
                    "parameters": "ALLSKY_SRF_ALB",
                    "community": "RE",
                    "longitude": lon,
                    "latitude": lat,
                    "format": "JSON",
                }
            )
        )
        self.proxy_json(target)

    def handle_pvgis_tmy(self, query: str) -> None:
        params = parse_qs(query)
        try:
            lat = parse_coord(params.get("lat", [""])[0], "lat", -90, 90)
            lon = parse_coord(params.get("lon", [""])[0], "lon", -180, 180)
        except ValueError as exc:
            self.send_error_json(400, str(exc))
            return

        target = (
            "https://re.jrc.ec.europa.eu/api/v5_2/tmy?"
            + urlencode(
                {
                    "lat": lat,
                    "lon": lon,
                    "outputformat": "json",
                }
            )
        )
        self.proxy_json(target)

    def handle_report_start(self) -> None:
        try:
            payload = self.read_json_body()
        except ValueError as exc:
            self.send_error_json(400, str(exc))
            return

        job_id = init_report_job()
        worker = threading.Thread(target=run_report_job, args=(job_id, payload), daemon=True)
        worker.start()
        self.send_json_obj(
            202,
            {
                "job_id": job_id,
                "status": "queued",
                "message": "Rapor üretimi başlatıldı.",
                "status_url": f"/api/report/status?job_id={job_id}",
            },
        )

    def handle_report_status(self, query: str) -> None:
        params = parse_qs(query)
        job_id = params.get("job_id", [""])[0].strip()
        if not job_id:
            self.send_error_json(400, "job_id is required.")
            return
        job = get_report_job(job_id)
        if not job:
            self.send_error_json(404, "Report job not found.")
            return
        self.send_json_obj(200, job)

    def handle_report_cleanup(self) -> None:
        try:
            payload = self.read_json_body()
        except ValueError as exc:
            self.send_error_json(400, str(exc))
            return

        keep_latest_raw = payload.get("keep_latest", 0)
        try:
            keep_latest = int(keep_latest_raw)
        except (TypeError, ValueError):
            self.send_error_json(400, "keep_latest must be an integer.")
            return

        summary = cleanup_report_outputs(keep_latest=keep_latest)
        self.send_json_obj(
            200,
            {
                "status": "ok",
                "message": f"{summary['removed_count']} dosya temizlendi.",
                "summary": summary,
            },
        )

    def handle_health(self) -> None:
        self.send_json_obj(200, {"status": "ok", "service": "bifacialreporter"})


def main() -> None:
    parser = argparse.ArgumentParser(description="Local server for bifacialreporter web app.")
    parser.add_argument("--host", default=HOST, help="Host to bind (default from HOST env or 0.0.0.0).")
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", "8000")), help="Port to bind (default from PORT env or 8000).")
    args = parser.parse_args()

    with ThreadingHTTPServer((args.host, args.port), LocalHandler) as server:
        print(f"Serving on http://{args.host}:{args.port}/web/")
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
