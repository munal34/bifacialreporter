(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));
  const DEG = Math.PI / 180;

  const state = {
    currentStep: 0,
    previewScenarioIndex: 0,
    scenarios: [],
    results: [],
    siteData: null,
    siteFetchToken: 0,
    map: null,
    mapMarker: null,
    mapInitialized: false,
    pendingSitePoint: null,
    reportPollTimer: 0,
    reportJobId: "",
  };

  const MONTH_KEYS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const MONTH_LABELS = ["Oca", "Sub", "Mar", "Nis", "May", "Haz", "Tem", "Agu", "Eyl", "Eki", "Kas", "Ara"];

  const defaultScenarios = [
    { name: "Arka taşıyıcı yok", purlin_count: 0, cross_brace: false },
    { name: "2 arka aşık", purlin_count: 2, cross_brace: false },
    { name: "3 arka aşık", purlin_count: 3, cross_brace: false },
    { name: "2 aşık + çapraz", purlin_count: 2, cross_brace: true },
  ];

  const elements = {
    pages: $$(".step-page"),
    chips: $$(".step-chip"),
    stepLabel: $("stepLabel"),
    prevStepBtn: $("prevStepBtn"),
    nextStepBtn: $("nextStepBtn"),
    addScenarioBtn: $("addScenarioBtn"),
    resetScenarioBtn: $("resetScenarioBtn"),
    scenarioList: $("scenarioList"),
    previewScenarioName: $("previewScenarioName"),
    runBtn: $("runBtn"),
    downloadCsvBtn: $("downloadCsvBtn"),
    statusLine: $("statusLine"),
    resultBody: $("resultBody"),
    bars: $("bars"),
    mRef: $("mRef"),
    mBest: $("mBest"),
    mWorst: $("mWorst"),
    mSpread: $("mSpread"),
    generateReportBtn: $("generateReportBtn"),
    downloadReportBtn: $("downloadReportBtn"),
    reportProjectName: $("reportProjectName"),
    reportClientName: $("reportClientName"),
    reportAuthor: $("reportAuthor"),
    reportAutoClean: $("reportAutoClean"),
    cleanReportOutputsBtn: $("cleanReportOutputsBtn"),
    reportProgressBar: $("reportProgressBar"),
    reportProgressText: $("reportProgressText"),
    reportStepText: $("reportStepText"),
    reportStatusLine: $("reportStatusLine"),
    panelPreviewCanvas: $("panelPreviewCanvas"),
    panelPreviewMeta: $("panelPreviewMeta"),
    frontViewCanvas: $("frontViewCanvas"),
    frontMeta: $("frontMeta"),
    sideViewCanvas: $("sideViewCanvas"),
    sideMeta: $("sideMeta"),
    topViewCanvas: $("topViewCanvas"),
    topMeta: $("topMeta"),
    isoViewCanvas: $("isoViewCanvas"),
    isoMeta: $("isoMeta"),
    structureNodeBoard: $("structureNodeBoard"),
    scenarioPreviewCanvas: $("scenarioPreviewCanvas"),
    openSiteDataDialogBtn: $("openSiteDataDialogBtn"),
    siteQuickSummary: $("siteQuickSummary"),
    siteDataModal: $("siteDataModal"),
    closeSiteDataModalBtn: $("closeSiteDataModalBtn"),
    doneSiteDataModalBtn: $("doneSiteDataModalBtn"),
    siteLat: $("siteLat"),
    siteLon: $("siteLon"),
    openSiteMapBtn: $("openSiteMapBtn"),
    modalGoFromMainBtn: $("modalGoFromMainBtn"),
    fetchSiteDataBtn: $("fetchSiteDataBtn"),
    useGpsBtn: $("useGpsBtn"),
    siteStatus: $("siteStatus"),
    siteMapModal: $("siteMapModal"),
    closeSiteMapBtn: $("closeSiteMapBtn"),
    cancelSiteMapBtn: $("cancelSiteMapBtn"),
    applySiteMapBtn: $("applySiteMapBtn"),
    modalLat: $("modalLat"),
    modalLon: $("modalLon"),
    modalGoBtn: $("modalGoBtn"),
    modalMapError: $("modalMapError"),
    siteMap: $("siteMap"),
    annualAlbedo: $("annualAlbedo"),
    annualGhi: $("annualGhi"),
    avgTemp: $("avgTemp"),
    avgWind: $("avgWind"),
    albedoMonthly: $("albedoMonthly"),
    climateMonthly: $("climateMonthly"),
    geomSummary: $("geomSummary"),
    geomLiveDetails: $("geomLiveDetails"),
  };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function fmt(value, digits = 2) {
    return Number(value).toLocaleString("en-US", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function csvEscape(value) {
    const text = String(value);
    if (text.includes(",") || text.includes('"') || text.includes("\n")) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  }

  function fmtSigned(value, digits = 4) {
    return Number(value).toLocaleString("en-US", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  }

  function safeText(value, fallback = "-") {
    return Number.isFinite(value) ? String(value) : fallback;
  }

  function monthCell(label, htmlValue) {
    return `<div class="month-cell"><div class="m">${label}</div><div class="v">${htmlValue}</div></div>`;
  }

  function setSiteStatus(text) {
    if (elements.siteStatus) elements.siteStatus.textContent = text;
  }

  function modalVisible(node) {
    return Boolean(node && !node.hidden);
  }

  function syncModalBodyLock() {
    const anyModalOpen = modalVisible(elements.siteDataModal) || modalVisible(elements.siteMapModal);
    document.body.classList.toggle("modal-open", anyModalOpen);
  }

  function updateSiteQuickSummary() {
    if (!elements.siteQuickSummary) return;
    const lat = Number(elements.siteLat?.value);
    const lon = Number(elements.siteLon?.value);
    const hasCoords = Number.isFinite(lat) && Number.isFinite(lon);
    const coordText = hasCoords ? `${fmtSigned(lat, 4)}, ${fmtSigned(lon, 4)}` : "ayarlı değil";
    if (!state.siteData) {
      elements.siteQuickSummary.textContent = `Saha: ${coordText} | İklim verisi henüz yüklenmedi.`;
      return;
    }
    const albedoPct = fmt(100 * state.siteData.albedo.annual, 1);
    const ghi = fmt(state.siteData.climate.annualGhiKWhM2, 0);
    elements.siteQuickSummary.textContent = `Saha: ${coordText} | Albedo ${albedoPct}% | GHI ${ghi} kWh/m²`;
  }

  function readSiteCoordinatesStrict() {
    const lat = Number(elements.siteLat.value);
    const lon = Number(elements.siteLon.value);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) throw new Error("Enlem [-90, 90] aralığında olmalı.");
    if (!Number.isFinite(lon) || lon < -180 || lon > 180) throw new Error("Boylam [-180, 180] aralığında olmalı.");
    return { lat, lon };
  }

  function writeSiteCoordinates(lat, lon) {
    elements.siteLat.value = fmtSigned(lat, 5);
    elements.siteLon.value = fmtSigned(lon, 5);
    updateSiteQuickSummary();
  }

  function writeModalCoordinates(lat, lon) {
    if (!elements.modalLat || !elements.modalLon) return;
    elements.modalLat.value = fmtSigned(lat, 6);
    elements.modalLon.value = fmtSigned(lon, 6);
  }

  function readModalCoordinatesStrict() {
    const lat = Number(elements.modalLat.value);
    const lon = Number(elements.modalLon.value);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) throw new Error("Pencere enlemi [-90, 90] aralığında olmalı.");
    if (!Number.isFinite(lon) || lon < -180 || lon > 180) throw new Error("Pencere boylamı [-180, 180] aralığında olmalı.");
    return { lat, lon };
  }

  function setPendingSitePoint(lat, lon) {
    state.pendingSitePoint = { lat, lon };
    writeModalCoordinates(lat, lon);
  }

  function resetSitePanels() {
    elements.annualAlbedo.textContent = "-";
    elements.annualGhi.textContent = "-";
    elements.avgTemp.textContent = "-";
    elements.avgWind.textContent = "-";
    elements.albedoMonthly.innerHTML = MONTH_LABELS.map((label) => monthCell(label, "-")).join("");
    elements.climateMonthly.innerHTML = MONTH_LABELS.map((label) => monthCell(label, "-")).join("");
    updateSiteQuickSummary();
  }

  function renderSitePanels() {
    if (!state.siteData) {
      resetSitePanels();
      return;
    }
    const { albedo, climate } = state.siteData;
    elements.annualAlbedo.textContent = `${fmt(100 * albedo.annual, 1)} %`;
    elements.annualGhi.textContent = `${fmt(climate.annualGhiKWhM2, 0)} kWh/m²`;
    elements.avgTemp.textContent = `${fmt(climate.avgTempC, 1)} °C`;
    elements.avgWind.textContent = `${fmt(climate.avgWindMs, 2)} m/s`;

    elements.albedoMonthly.innerHTML = MONTH_LABELS
      .map((label, idx) => monthCell(label, `${fmt(100 * albedo.monthly[idx], 1)}%`))
      .join("");

    elements.climateMonthly.innerHTML = MONTH_LABELS
      .map((label, idx) => {
        const row = climate.monthly[idx];
        const html = `GHI ${fmt(row.ghiKWhM2, 0)}<br>T ${fmt(row.tempC, 1)}°C<br>W ${fmt(row.windMs, 2)}`;
        return monthCell(label, html);
      })
      .join("");
    updateSiteQuickSummary();
  }

  function safeNumber(id, fallback) {
    const value = Number($(id).value);
    return Number.isFinite(value) ? value : fallback;
  }

  function strictNumber(id, message) {
    const value = Number($(id).value);
    if (!Number.isFinite(value)) {
      throw new Error(message);
    }
    return value;
  }

  function getConfigSafe() {
    const moduleWidth = Math.max(0.1, safeNumber("panelWidth", 1.134));
    const moduleHeight = Math.max(0.1, safeNumber("panelHeight", 2.278));
    const countVertical = clamp(Math.round(safeNumber("panelCountX", 2)), 1, 20);
    const countHorizontal = clamp(Math.round(safeNumber("panelCountY", 13)), 1, 20);
    return {
      panel: {
        moduleWidth,
        moduleHeight,
        countVertical,
        countHorizontal,
        // canonical axes used by drawing/model routines
        countX: countHorizontal,
        countY: countVertical,
        width: moduleWidth * countHorizontal,
        height: moduleHeight * countVertical,
        tiltDeg: clamp(safeNumber("tiltDeg", 16), 0, 85),
        clearance: Math.max(0.05, safeNumber("groundClearance", 0.7)),
      },
      energy: {
        frontAnnualKWh: Math.max(1, safeNumber("frontEnergy", 1000000)),
        idealRearGainPct: clamp(safeNumber("idealGain", 12), 0, 70),
        baseMismatchPct: clamp(safeNumber("baseMismatch", 10), 0, 80),
        mismatchFactor: clamp(safeNumber("mismatchFactor", 35), 0, 300),
      },
      geom: {
        pDepth: Math.max(0.001, safeNumber("pDepth", 0.04)),
        pThick: Math.max(0.001, safeNumber("pThick", 0.05)),
        pOffset: Math.max(0.001, safeNumber("pOffset", 0.06)),
        pMargin: Math.max(0.001, safeNumber("pMargin", 0.15)),
        braceThick: Math.max(0.001, safeNumber("braceThick", 0.03)),
        braceSeg: Math.max(1, Math.round(safeNumber("braceSeg", 22))),
        braceZStart: Math.max(0.001, safeNumber("braceZStart", 0.06)),
        braceZEnd: Math.max(0.001, safeNumber("braceZEnd", 0.18)),
        rowPitch: Math.max(0.1, safeNumber("rowPitch", 6.4)),
        tableWidth: Math.max(0.1, safeNumber("tableWidth", 4.2)),
        sunElevation: clamp(safeNumber("sunElevation", 35), 1, 89),
        sunAzimuth: clamp(safeNumber("sunAzimuth", 150), 0, 359),
      },
      sim: {
        pointsX: Math.max(1, Math.round(safeNumber("pointsX", 10))),
        pointsY: Math.max(1, Math.round(safeNumber("pointsY", 20))),
        raysPerPoint: Math.max(1, Math.round(safeNumber("raysPerPoint", 600))),
        seed: Math.round(safeNumber("seed", 42)),
      },
      site: {
        lat: clamp(safeNumber("siteLat", 39.9208), -90, 90),
        lon: clamp(safeNumber("siteLon", 32.8541), -180, 180),
      },
      braceXRel: [0.35, 0.65],
    };
  }

  function getConfigStrict() {
    const panelWidth = strictNumber("panelWidth", "Modül genişliği geçersiz.");
    const panelHeight = strictNumber("panelHeight", "Modül yüksekliği geçersiz.");
    const panelCountX = strictNumber("panelCountX", "Dikey panel adedi geçersiz.");
    const panelCountY = strictNumber("panelCountY", "Yatay panel adedi geçersiz.");
    const frontEnergy = strictNumber("frontEnergy", "Yıllık ön yüz enerjisi geçersiz.");
    const idealGain = strictNumber("idealGain", "İdeal arka kazanç geçersiz.");
    const baseMismatch = strictNumber("baseMismatch", "Temel uyumsuzluk değeri geçersiz.");
    const mismatchFactor = strictNumber("mismatchFactor", "Uyumsuzluk katsayısı geçersiz.");
    const pointsX = strictNumber("pointsX", "Panel nokta X değeri geçersiz.");
    const pointsY = strictNumber("pointsY", "Panel nokta Y değeri geçersiz.");
    const raysPerPoint = strictNumber("raysPerPoint", "Nokta başına ışın sayısı geçersiz.");
    const seed = strictNumber("seed", "Seed değeri geçersiz.");

    const cfg = getConfigSafe();
    cfg.panel.moduleWidth = panelWidth;
    cfg.panel.moduleHeight = panelHeight;
    cfg.panel.countVertical = clamp(Math.round(panelCountX), 1, 20);
    cfg.panel.countHorizontal = clamp(Math.round(panelCountY), 1, 20);
    cfg.panel.countX = cfg.panel.countHorizontal;
    cfg.panel.countY = cfg.panel.countVertical;
    cfg.panel.width = cfg.panel.moduleWidth * cfg.panel.countHorizontal;
    cfg.panel.height = cfg.panel.moduleHeight * cfg.panel.countVertical;
    cfg.energy.frontAnnualKWh = frontEnergy;
    cfg.energy.idealRearGainPct = idealGain;
    cfg.energy.baseMismatchPct = baseMismatch;
    cfg.energy.mismatchFactor = mismatchFactor;
    cfg.sim.pointsX = Math.round(pointsX);
    cfg.sim.pointsY = Math.round(pointsY);
    cfg.sim.raysPerPoint = Math.round(raysPerPoint);
    cfg.sim.seed = Math.round(seed);

    if (cfg.panel.moduleWidth <= 0 || cfg.panel.moduleHeight <= 0) throw new Error("Panel ölçüleri pozitif olmalıdır.");
    if (cfg.panel.countVertical <= 0 || cfg.panel.countHorizontal <= 0) throw new Error("Panel adetleri pozitif olmalıdır.");
    if (cfg.energy.frontAnnualKWh <= 0) throw new Error("Yıllık ön yüz enerjisi pozitif olmalıdır.");
    if (cfg.sim.pointsX <= 0 || cfg.sim.pointsY <= 0 || cfg.sim.raysPerPoint <= 0) throw new Error("Simülasyon değerleri pozitif olmalıdır.");
    if (cfg.geom.pMargin * 2 >= cfg.panel.height) throw new Error("Aşık kenar payı panel yüksekliği için çok büyük.");

    return cfg;
  }

  function selectScenario() {
    if (!state.scenarios.length) return { name: "Senaryo yok", purlin_count: 0, cross_brace: false };
    state.previewScenarioIndex = clamp(state.previewScenarioIndex, 0, state.scenarios.length - 1);
    return state.scenarios[state.previewScenarioIndex];
  }

  function updateStepUi() {
    elements.pages.forEach((page, idx) => page.classList.toggle("active", idx === state.currentStep));
    elements.chips.forEach((chip, idx) => chip.classList.toggle("active", idx === state.currentStep));
    elements.prevStepBtn.disabled = state.currentStep === 0;
    elements.nextStepBtn.disabled = state.currentStep === elements.pages.length - 1;
    elements.stepLabel.textContent = `${state.currentStep + 1} / ${elements.pages.length}`;
  }

  function setStep(nextStep) {
    state.currentStep = clamp(nextStep, 0, elements.pages.length - 1);
    updateStepUi();
    // Re-draw after visibility switch so hidden canvases get correct dimensions.
    window.requestAnimationFrame(renderVisuals);
    window.setTimeout(renderVisuals, 120);
    if (state.currentStep === 0 && state.map) {
      window.setTimeout(() => state.map.invalidateSize(), 0);
    }
  }

  function purlinPositions(panelHeight, count, margin) {
    if (count <= 0) return [];
    if (count === 1) return [0.5 * panelHeight];
    const usable = panelHeight - 2 * margin;
    if (usable <= 0) return [];
    const step = usable / (count - 1);
    return Array.from({ length: count }, (_, i) => margin + i * step);
  }

  function buildSupportLayout(cfg, scenario) {
    const theta = cfg.panel.tiltDeg * DEG;
    const run = Math.max(0.15, cfg.panel.height * Math.cos(theta));
    const rise = cfg.panel.height * Math.sin(theta);
    const width = cfg.panel.width;
    const frameCount = clamp(Math.round(width / Math.max(1.8, cfg.geom.tableWidth)) + 1, 2, 8);
    const frameXs = Array.from({ length: frameCount }, (_, i) => {
      if (frameCount === 1) return 0.5 * width;
      return (width * i) / (frameCount - 1);
    });

    const beamDepths = [0.24 * run, 0.76 * run];
    const columns = [];
    frameXs.forEach((xValue, frameIdx) => {
      beamDepths.forEach((depth, depthIdx) => {
        const ratio = run > 1e-6 ? depth / run : 0;
        const zTop = cfg.panel.clearance + ratio * rise;
        columns.push({
          id: `C${frameIdx + 1}.${depthIdx + 1}`,
          frameIdx,
          x: xValue,
          depth,
          zBase: 0,
          zTop,
        });
      });
    });

    const beams = beamDepths.map((depth, idx) => {
      const ratio = run > 1e-6 ? depth / run : 0;
      return {
        id: `K${idx + 1}`,
        depth,
        z: cfg.panel.clearance + ratio * rise,
      };
    });

    const purlinS = purlinPositions(cfg.panel.height, scenario.purlin_count, cfg.geom.pMargin);
    const purlins = purlinS.map((sValue, idx) => {
      const ratio = cfg.panel.height > 1e-6 ? sValue / cfg.panel.height : 0;
      return {
        id: `P${idx + 1}`,
        s: sValue,
        depth: ratio * run,
        z: cfg.panel.clearance + ratio * rise + cfg.geom.pOffset,
      };
    });

    return {
      run,
      rise,
      width,
      frameXs,
      beamDepths,
      columns,
      beams,
      purlins,
    };
  }

  function fitCanvas(canvas) {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(20, Math.round(rect.width));
    const height = Math.max(20, Math.round(rect.height));
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    return { ctx, width, height };
  }

  function drawPaperGrid(ctx, width, height) {
    ctx.save();
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);

    const minor = 20;
    const major = 100;
    for (let x = 0; x <= width; x += minor) {
      const isMajor = x % major === 0;
      ctx.strokeStyle = isMajor ? "rgba(31, 41, 55, 0.14)" : "rgba(31, 41, 55, 0.06)";
      ctx.lineWidth = isMajor ? 1.1 : 1;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, height);
      ctx.stroke();
    }
    for (let y = 0; y <= height; y += minor) {
      const isMajor = y % major === 0;
      ctx.strokeStyle = isMajor ? "rgba(31, 41, 55, 0.14)" : "rgba(31, 41, 55, 0.06)";
      ctx.lineWidth = isMajor ? 1.1 : 1;
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(width, y + 0.5);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawDimensionHorizontal(ctx, x1, x2, y, label) {
    ctx.save();
    ctx.strokeStyle = "#0f172a";
    ctx.fillStyle = "#0f172a";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x1, y);
    ctx.lineTo(x2, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x1, y);
    ctx.lineTo(x1 + 6, y - 3);
    ctx.moveTo(x1, y);
    ctx.lineTo(x1 + 6, y + 3);
    ctx.moveTo(x2, y);
    ctx.lineTo(x2 - 6, y - 3);
    ctx.moveTo(x2, y);
    ctx.lineTo(x2 - 6, y + 3);
    ctx.stroke();
    ctx.font = "11px IBM Plex Mono, monospace";
    ctx.textAlign = "center";
    ctx.fillText(label, 0.5 * (x1 + x2), y - 6);
    ctx.restore();
  }

  function drawDimensionVertical(ctx, y1, y2, x, label) {
    ctx.save();
    ctx.strokeStyle = "#0f172a";
    ctx.fillStyle = "#0f172a";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y1);
    ctx.lineTo(x, y2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y1);
    ctx.lineTo(x - 3, y1 + 6);
    ctx.moveTo(x, y1);
    ctx.lineTo(x + 3, y1 + 6);
    ctx.moveTo(x, y2);
    ctx.lineTo(x - 3, y2 - 6);
    ctx.moveTo(x, y2);
    ctx.lineTo(x + 3, y2 - 6);
    ctx.stroke();
    ctx.font = "11px IBM Plex Mono, monospace";
    ctx.translate(x + 8, 0.5 * (y1 + y2));
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    ctx.fillText(label, 0, -2);
    ctx.restore();
  }

  function drawHollowRectProfile(ctx, x, y, w, h, options = {}) {
    const stroke = options.stroke || "#0f172a";
    const innerStroke = options.innerStroke || "rgba(15, 23, 42, 0.65)";
    const minSide = Math.max(2, Math.min(w, h));
    const wall = clamp(minSide * 0.22, 1, Math.max(1, minSide * 0.42));
    const iw = Math.max(1, w - 2 * wall);
    const ih = Math.max(1, h - 2 * wall);

    ctx.save();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.25;
    ctx.strokeRect(x + 0.5, y + 0.5, Math.max(1, w - 1), Math.max(1, h - 1));
    if (iw > 2 && ih > 2) {
      ctx.strokeStyle = innerStroke;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + wall + 0.5, y + wall + 0.5, iw - 1, ih - 1);
    }
    ctx.restore();
  }

  function drawCProfileSegment(ctx, a, b, depthPx, options = {}) {
    const [x1, y1] = a;
    const [x2, y2] = b;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len < 1) return;

    const color = options.color || "#334155";
    const webColor = options.webColor || "rgba(15, 23, 42, 0.92)";
    const flip = options.flip ? -1 : 1;
    const ux = dx / len;
    const uy = dy / len;
    const nx = -uy * flip;
    const ny = ux * flip;
    const half = Math.max(2, depthPx * 0.5);
    const lip = clamp(depthPx * 0.30, 1.2, Math.max(1.2, half - 0.6));
    const webOff = half - lip;

    const t1 = [x1 + nx * half, y1 + ny * half];
    const t2 = [x2 + nx * half, y2 + ny * half];
    const w1 = [x1 + nx * webOff, y1 + ny * webOff];
    const w2 = [x2 + nx * webOff, y2 + ny * webOff];
    const b1 = [x1 - nx * half, y1 - ny * half];
    const b2 = [x2 - nx * half, y2 - ny * half];

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(t1[0], t1[1]);
    ctx.lineTo(t2[0], t2[1]);
    ctx.moveTo(b1[0], b1[1]);
    ctx.lineTo(b2[0], b2[1]);
    ctx.stroke();

    ctx.strokeStyle = webColor;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(w1[0], w1[1]);
    ctx.lineTo(w2[0], w2[1]);
    // short connector strokes to emphasize channel profile edges
    ctx.moveTo(t1[0], t1[1]);
    ctx.lineTo(w1[0], w1[1]);
    ctx.moveTo(t2[0], t2[1]);
    ctx.lineTo(w2[0], w2[1]);
    ctx.stroke();
    ctx.restore();
  }

  function drawBoxProfileSegment(ctx, a, b, depthPx, options = {}) {
    const [x1, y1] = a;
    const [x2, y2] = b;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len < 1) return;
    const stroke = options.stroke || "#0f172a";
    const innerStroke = options.innerStroke || "rgba(15, 23, 42, 0.62)";
    const ux = dx / len;
    const uy = dy / len;
    const nx = -uy;
    const ny = ux;
    const half = Math.max(2, depthPx * 0.5);
    const innerHalf = Math.max(1, half * 0.55);

    const o1 = [x1 + nx * half, y1 + ny * half];
    const o2 = [x2 + nx * half, y2 + ny * half];
    const o3 = [x2 - nx * half, y2 - ny * half];
    const o4 = [x1 - nx * half, y1 - ny * half];

    const i1 = [x1 + nx * innerHalf, y1 + ny * innerHalf];
    const i2 = [x2 + nx * innerHalf, y2 + ny * innerHalf];
    const i3 = [x2 - nx * innerHalf, y2 - ny * innerHalf];
    const i4 = [x1 - nx * innerHalf, y1 - ny * innerHalf];

    ctx.save();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(o1[0], o1[1]);
    ctx.lineTo(o2[0], o2[1]);
    ctx.lineTo(o3[0], o3[1]);
    ctx.lineTo(o4[0], o4[1]);
    ctx.closePath();
    ctx.stroke();

    ctx.strokeStyle = innerStroke;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(i1[0], i1[1]);
    ctx.lineTo(i2[0], i2[1]);
    ctx.lineTo(i3[0], i3[1]);
    ctx.lineTo(i4[0], i4[1]);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  function drawFrontTechnical(ctx, region, cfg, scenario, options = {}) {
    const x0 = region.x;
    const y0 = region.y;
    const rw = region.w;
    const rh = region.h;
    const showDimensions = options.showDimensions !== false;

    const margin = 32;
    const scale = Math.min((rw - 2 * margin) / Math.max(0.01, cfg.panel.width), (rh - 2 * margin) / Math.max(0.01, cfg.panel.height));
    const pw = cfg.panel.width * scale;
    const ph = cfg.panel.height * scale;
    const px = x0 + (rw - pw) * 0.5;
    const py = y0 + (rh - ph) * 0.5;
    const support = buildSupportLayout(cfg, scenario);

    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, rw, rh);
    ctx.clip();

    ctx.strokeStyle = "#111827";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(px, py, pw, ph);

    const moduleCols = Math.max(1, cfg.panel.countX || 1);
    const moduleRows = Math.max(1, cfg.panel.countY || 1);
    const moduleWidthPx = pw / moduleCols;
    const moduleHeightPx = ph / moduleRows;

    // Module boundaries.
    ctx.strokeStyle = "#1f2937";
    ctx.lineWidth = 1.2;
    for (let mx = 1; mx < moduleCols; mx += 1) {
      const gx = px + mx * moduleWidthPx;
      ctx.beginPath();
      ctx.moveTo(gx, py);
      ctx.lineTo(gx, py + ph);
      ctx.stroke();
    }
    for (let my = 1; my < moduleRows; my += 1) {
      const gy = py + my * moduleHeightPx;
      ctx.beginPath();
      ctx.moveTo(px, gy);
      ctx.lineTo(px + pw, gy);
      ctx.stroke();
    }

    // Sub-cell mesh (light).
    ctx.strokeStyle = "rgba(55, 65, 81, 0.22)";
    ctx.lineWidth = 0.8;
    for (let mx = 0; mx < moduleCols; mx += 1) {
      const baseX = px + mx * moduleWidthPx;
      for (let c = 1; c < 6; c += 1) {
        const gx = baseX + (moduleWidthPx * c) / 6;
        ctx.beginPath();
        ctx.moveTo(gx, py);
        ctx.lineTo(gx, py + ph);
        ctx.stroke();
      }
    }
    for (let my = 0; my < moduleRows; my += 1) {
      const baseY = py + my * moduleHeightPx;
      for (let r = 1; r < 12; r += 1) {
        const gy = baseY + (moduleHeightPx * r) / 12;
        ctx.beginPath();
        ctx.moveTo(px, gy);
        ctx.lineTo(px + pw, gy);
        ctx.stroke();
      }
    }

    const purlinYs = purlinPositions(cfg.panel.height, scenario.purlin_count, cfg.geom.pMargin);
    const purlinThicknessPx = Math.max(1.4, cfg.geom.pThick * scale);
    purlinYs.forEach((yM) => {
      const yPx = py + yM * scale;
      ctx.strokeStyle = "#0f172a";
      ctx.lineWidth = purlinThicknessPx;
      ctx.beginPath();
      ctx.moveTo(px - 2, yPx);
      ctx.lineTo(px + pw + 2, yPx);
      ctx.stroke();
    });

    // Beam profiles and column profiles (front technical overlay).
    const beamYs = support.beamDepths.map((depth) => {
      const ratio = support.run > 1e-6 ? depth / support.run : 0;
      return py + ratio * ph;
    });
    const beamProfileDepthPx = clamp(cfg.geom.pDepth * scale * 1.2, 6, 15);
    beamYs.forEach((yPx) => {
      drawCProfileSegment(
        ctx,
        [px - 1, yPx],
        [px + pw + 1, yPx],
        beamProfileDepthPx,
        { color: "#334155", webColor: "rgba(15, 23, 42, 0.92)", flip: true }
      );
    });

    const columnXs = support.frameXs.map((xM) => px + (xM / Math.max(0.001, support.width)) * pw);
    const colTopY = Math.max(py + 8, Math.min(py + ph - 10, beamYs[1] || (py + ph * 0.75)));
    const colWidth = clamp(cfg.geom.pThick * scale * 1.5, 7, 15);
    columnXs.forEach((cx, idx) => {
      const ch = Math.max(10, py + ph - colTopY);
      drawHollowRectProfile(ctx, cx - 0.5 * colWidth, colTopY, colWidth, ch, {
        stroke: "#0f172a",
        innerStroke: "rgba(15, 23, 42, 0.62)",
      });

      if (idx === 0 || idx === columnXs.length - 1 || idx === Math.floor(columnXs.length / 2)) {
        ctx.fillStyle = "#0f172a";
        ctx.beginPath();
        ctx.arc(cx, colTopY + 1.5, 2.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = "10px IBM Plex Mono, monospace";
        ctx.fillText(`C${idx + 1}`, cx + 5, colTopY - 6);
      }
    });

    if (beamYs.length >= 2 && columnXs.length >= 2) {
      const leftX = columnXs[0];
      const rightX = columnXs[columnXs.length - 1];
      ctx.fillStyle = "#0f172a";
      ctx.font = "10px IBM Plex Mono, monospace";
      ctx.fillText("K1", leftX + 5, beamYs[0] - 8);
      ctx.fillText("K2", rightX - 20, beamYs[1] - 8);
    }

    if (scenario.cross_brace) {
      const yMargin = Math.min(0.22, Math.max(0.03, cfg.geom.pMargin * 0.65));
      [0.35, 0.65].forEach((rel) => {
        const xc = px + rel * pw;
        const w = Math.max(6, pw * 0.05);
        const yTop = py + yMargin * scale;
        const yBottom = py + ph - yMargin * scale;

        ctx.strokeStyle = "#111827";
        ctx.lineWidth = Math.max(1.2, cfg.geom.braceThick * scale);
        ctx.beginPath();
        ctx.moveTo(xc - 0.5 * w, yTop);
        ctx.lineTo(xc + 0.5 * w, yBottom);
        ctx.moveTo(xc + 0.5 * w, yTop);
        ctx.lineTo(xc - 0.5 * w, yBottom);
        ctx.stroke();
      });
    }

    if (showDimensions) {
      drawDimensionHorizontal(ctx, px, px + pw, py + ph + 22, `${fmt(cfg.panel.width, 3)} m`);
      drawDimensionVertical(ctx, py, py + ph, px - 24, `${fmt(cfg.panel.height, 3)} m`);
      drawDimensionHorizontal(ctx, px, px + moduleWidthPx, py - 10, `${fmt(cfg.panel.moduleWidth, 3)} m`);
      drawDimensionVertical(ctx, py, py + moduleHeightPx, px + pw + 18, `${fmt(cfg.panel.moduleHeight, 3)} m`);
      ctx.fillStyle = "#111827";
      ctx.font = "11px IBM Plex Mono, monospace";
      ctx.fillText(`Dizi: ${cfg.panel.countVertical}D x ${cfg.panel.countHorizontal}Y`, px + 8, py + 14);
      ctx.fillText(`Aşık: ${scenario.purlin_count} | Çapraz: ${scenario.cross_brace ? "evet" : "hayır"}`, px + 8, py + 28);
      ctx.fillStyle = "rgba(31, 41, 55, 0.86)";
      ctx.font = "10px IBM Plex Mono, monospace";
      ctx.fillText("ID: C*=kolon, K*=kiriş, P*=aşık", px + 8, py + ph - 8);
    }

    ctx.restore();
  }

  function renderGeometryDetails(cfg, scenario) {
    if (!elements.geomLiveDetails) return;
    elements.geomLiveDetails.innerHTML = `
      <div class="section-head"><h3>Canlı Parametre Detayları</h3><span class="mono small">Otomatik güncellenir</span></div>
      <div class="param-grid">
        <div class="param-item"><span>Aşık Çekirdeği (Zp / Op / Ep)</span><strong>${fmt(cfg.geom.pDepth, 3)} / ${fmt(cfg.geom.pOffset, 3)} / ${fmt(cfg.geom.pMargin, 3)} m</strong></div>
        <div class="param-item"><span>Yerleşim (S / B)</span><strong>${fmt(cfg.geom.rowPitch, 2)} / ${fmt(cfg.geom.tableWidth, 2)} m</strong></div>
        <div class="param-item"><span>Güneş (Alpha / Gamma)</span><strong>${fmt(cfg.geom.sunElevation, 1)}° / ${fmt(cfg.geom.sunAzimuth, 0)}°</strong></div>
        <div class="param-item"><span>Senaryo (P# / X)</span><strong>${scenario.purlin_count} / ${scenario.cross_brace ? "aktif" : "pasif"}</strong></div>
        <div class="param-item"><span>Dizi Yerleşimi</span><strong>${cfg.panel.countVertical}D x ${cfg.panel.countHorizontal}Y</strong></div>
        <div class="param-item"><span>İleri Özet</span><strong>Tp ${fmt(cfg.geom.pThick, 3)} | Tx ${fmt(cfg.geom.braceThick, 3)} | Nx ${cfg.geom.braceSeg}</strong></div>
      </div>
    `;
  }

  function renderViewMeta(cfg, scenario) {
    const support = buildSupportLayout(cfg, scenario);
    const k1 = support.beams[0];
    const k2 = support.beams[1];
    const cCount = support.columns.length;
    const pCount = support.purlins.length;
    const commonMap = "ID haritası: C* = kolon, K* = kiriş, P* = aşık.";
    const inputMap = "Girdiler: W,H,Nv,Nh,Theta,C0,B + P# / Ep / Op + Alpha / Gamma.";

    if (elements.panelPreviewMeta) {
      elements.panelPreviewMeta.innerHTML = `
        <div class="meta-head">Boyutlar ${fmt(cfg.panel.width, 3)} m x ${fmt(cfg.panel.height, 3)} m | Dizi ${cfg.panel.countVertical}D x ${cfg.panel.countHorizontal}Y</div>
        <div>${commonMap}</div>
        <div class="meta-note">${inputMap}</div>
      `;
    }

    if (elements.frontMeta) {
      elements.frontMeta.innerHTML = `
        <div class="meta-head">Ön görünüm ID: C1..C${Math.max(1, support.frameXs.length)} | K1,K2 | P1..P${Math.max(1, pCount)}</div>
        <div>K1 d=${k1 ? fmt(k1.depth, 2) : "-"} m, K2 d=${k2 ? fmt(k2.depth, 2) : "-"} m</div>
        <div>C*: x konumu Modül Genişliği x Yatay Panel ile belirlenir (tablo toplam genişliği).</div>
        <div>K*: derinlik/yükseklik Modül Yüksekliği + Eğim + Zemin Boşluğu ile belirlenir.</div>
        <div>P*: adet/konum Senaryo Aşık Adedi + Aşık Kenar Payı + Aşık Z Ofseti ile belirlenir.</div>
        <div class="meta-note">${commonMap}</div>
      `;
    }

    if (elements.sideMeta) {
      elements.sideMeta.innerHTML = `
        <div class="meta-head">Yan: boşluk ${fmt(cfg.panel.clearance, 2)} m | eğim ${fmt(cfg.panel.tiltDeg, 1)}° | ofset ${fmt(cfg.geom.pOffset, 3)} m</div>
        <div>Bifacial ışınlar: direkt + arka yüze yansıma (güneş yükseklik/azimut kontrollü).</div>
        <div>${commonMap}</div>
      `;
    }

    if (elements.topMeta) {
      elements.topMeta.innerHTML = `
        <div class="meta-head">Üst: sıra aralığı ${fmt(cfg.geom.rowPitch, 2)} m | tablo genişliği ${fmt(cfg.geom.tableWidth, 2)} m | güneş ${fmt(cfg.geom.sunAzimuth, 0)}°</div>
        <div>Düğümler: Kolon ${cCount} | Kiriş ${support.beams.length} | Aşık ${pCount}</div>
        <div>${commonMap}</div>
      `;
    }

    if (elements.isoMeta) {
      elements.isoMeta.innerHTML = `
        <div class="meta-head">İzometrik 3B sabit çizim ölçeği kullanır (boyuta göre otomatik zoom yok).</div>
        <div>Sadece ölçüler/düğümler girdi ve panel adedine göre güncellenir.</div>
        <div>Güncel düğümler: Kolon ${cCount} | Kiriş ${support.beams.length} | Aşık ${pCount}</div>
      `;
    }
  }

  function renderStructureNodeBoard(cfg, scenario) {
    if (!elements.structureNodeBoard) return;
    const support = buildSupportLayout(cfg, scenario);
    const columnRows = support.columns.slice(0, 8).map((row) =>
      `<li>${row.id}: x ${fmt(row.x, 2)} m, d ${fmt(row.depth, 2)} m, z ${fmt(row.zTop, 2)} m</li>`
    ).join("");
    const beamRows = support.beams.map((row) =>
      `<li>${row.id}: d ${fmt(row.depth, 2)} m, z ${fmt(row.z, 2)} m</li>`
    ).join("");
    const purlinRows = (support.purlins.length ? support.purlins : [{ id: "P0", s: 0, depth: 0, z: 0 }]).map((row) =>
      row.id === "P0"
        ? "<li>Güncel senaryoda aşık yok.</li>"
        : `<li>${row.id}: s ${fmt(row.s, 2)} m, d ${fmt(row.depth, 2)} m, z ${fmt(row.z, 2)} m</li>`
    ).join("");

    elements.structureNodeBoard.innerHTML = `
      <article class="node-col">
        <h4>Kolon Düğümleri (C*)</h4>
        <p class="node-note">Kontrol edenler: Modül Genişliği, Yatay Panel, Tablo Genişliği, Eğim, Zemin Boşluğu.</p>
        <ul class="node-list">${columnRows}</ul>
      </article>
      <article class="node-col">
        <h4>Kiriş Düğümleri (K*)</h4>
        <p class="node-note">Kontrol edenler: Modül Yüksekliği, Eğim, Zemin Boşluğu.</p>
        <ul class="node-list">${beamRows}</ul>
      </article>
      <article class="node-col">
        <h4>Aşık Düğümleri (P*)</h4>
        <p class="node-note">Kontrol edenler: Aşık Adedi (Senaryo), Aşık Kenar Payı, Aşık Z Ofseti.</p>
        <ul class="node-list">${purlinRows}</ul>
      </article>
    `;
  }

  function drawSideTechnical(ctx, region, cfg, scenario) {
    const x0 = region.x;
    const y0 = region.y;
    const rw = region.w;
    const rh = region.h;

    const theta = cfg.panel.tiltDeg * DEG;
    const panelRise = cfg.panel.height * Math.sin(theta);
    const panelRun = cfg.panel.height * Math.cos(theta);
    const tx = Math.cos(theta);
    const ty = Math.sin(theta);
    const nx = -Math.sin(theta);
    const ny = Math.cos(theta);

    // Model extents in meters, then centered into canvas region.
    const xMin = -0.45;
    const xMax = panelRun + 0.85;
    const yMin = -0.05;
    const yMax = cfg.panel.clearance + panelRise + cfg.geom.pOffset + cfg.geom.pDepth + 0.45;
    const margin = 24;
    const scale = Math.min((rw - 2 * margin) / (xMax - xMin), (rh - 2 * margin) / (yMax - yMin));
    const drawW = (xMax - xMin) * scale;
    const drawH = (yMax - yMin) * scale;
    const ox = x0 + 0.5 * (rw - drawW) - xMin * scale;
    const oy = y0 + 0.5 * (rh - drawH) + yMax * scale;
    const toPx = (xM, yM) => [ox + xM * scale, oy - yM * scale];

    const low = [0, cfg.panel.clearance];
    const high = [panelRun, cfg.panel.clearance + panelRise];
    const thicknessM = 0.035;
    const support = buildSupportLayout(cfg, scenario);
    const drawArrow = (start, end, color, width = 2.2, head = 12, dashed = false) => {
      const [x1, y1] = start;
      const [x2, y2] = end;
      const ang = Math.atan2(y2 - y1, x2 - x1);
      const hx = head * Math.cos(ang);
      const hy = head * Math.sin(ang);
      ctx.save();
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = width;
      if (dashed) ctx.setLineDash([8, 5]);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - hx + 0.42 * hy, y2 - hy - 0.42 * hx);
      ctx.lineTo(x2 - hx - 0.42 * hy, y2 - hy + 0.42 * hx);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    };

    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, rw, rh);
    ctx.clip();

    // Ground line
    {
      const g1 = toPx(xMin + 0.08, 0);
      const g2 = toPx(xMax - 0.08, 0);
      ctx.strokeStyle = "#111827";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(g1[0], g1[1]);
      ctx.lineTo(g2[0], g2[1]);
      ctx.stroke();
    }

    // Panel outline
    {
      const p1 = toPx(low[0] + nx * thicknessM, low[1] + ny * thicknessM);
      const p2 = toPx(high[0] + nx * thicknessM, high[1] + ny * thicknessM);
      const p3 = toPx(high[0] - nx * thicknessM, high[1] - ny * thicknessM);
      const p4 = toPx(low[0] - nx * thicknessM, low[1] - ny * thicknessM);
      ctx.strokeStyle = "#1f2937";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(p1[0], p1[1]);
      ctx.lineTo(p2[0], p2[1]);
      ctx.lineTo(p3[0], p3[1]);
      ctx.lineTo(p4[0], p4[1]);
      ctx.closePath();
      ctx.stroke();
    }

    // Module split lines along tilted length (rows).
    ctx.strokeStyle = "rgba(31, 41, 55, 0.8)";
    ctx.lineWidth = 1;
    for (let i = 1; i < Math.max(1, cfg.panel.countVertical); i += 1) {
      const s = cfg.panel.moduleHeight * i;
      const cx = low[0] + tx * s;
      const cy = low[1] + ty * s;
      const a = toPx(cx + nx * thicknessM, cy + ny * thicknessM);
      const b = toPx(cx - nx * thicknessM, cy - ny * thicknessM);
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
    }

    // Rear posts (columns) from beam depths as box profiles.
    const postS = support.beamDepths.map((depth) => (support.run > 1e-6 ? (depth / support.run) * cfg.panel.height : 0.5 * cfg.panel.height));
    const colProfileW = clamp(cfg.geom.pThick * scale * 1.8, 7, 16);
    postS.forEach((s, idx) => {
      const pTop = toPx(low[0] + tx * s, low[1] + ty * s);
      const pBottom = toPx(low[0] + tx * s, 0);
      const height = Math.max(8, pBottom[1] - pTop[1]);
      drawHollowRectProfile(ctx, pTop[0] - 0.5 * colProfileW, pTop[1], colProfileW, height, {
        stroke: "#0f172a",
        innerStroke: "rgba(15, 23, 42, 0.62)",
      });

      ctx.fillStyle = "#0f172a";
      ctx.beginPath();
      ctx.arc(pTop[0], pTop[1] + 1.5, 2.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = "10px IBM Plex Mono, monospace";
      ctx.fillText(`C${idx + 1}`, pTop[0] + 4, pTop[1] - 4);
    });

    // Girder between column tops as C-profile.
    if (postS.length >= 2) {
      const leftTop = toPx(low[0] + tx * postS[0], low[1] + ty * postS[0]);
      const rightTop = toPx(low[0] + tx * postS[postS.length - 1], low[1] + ty * postS[postS.length - 1]);
      const beamProfileDepthPx = clamp(cfg.geom.pDepth * scale * 1.35, 7, 16);
      drawCProfileSegment(ctx, leftTop, rightTop, beamProfileDepthPx, { color: "#334155", webColor: "rgba(15, 23, 42, 0.9)" });
      ctx.fillStyle = "#334155";
      ctx.font = "10px IBM Plex Mono, monospace";
      ctx.fillText("K1", leftTop[0] + 6, leftTop[1] - 10);
    }

    // Purlin axes on side view (aşık points/segments).
    const purlinYs = purlinPositions(cfg.panel.height, scenario.purlin_count, cfg.geom.pMargin);
    ctx.strokeStyle = "#0b7660";
    ctx.lineWidth = Math.max(1.2, cfg.geom.pDepth * scale * 0.8);
    purlinYs.forEach((sM, idx) => {
      const half = Math.min(0.12, 0.08 + 0.02 * cfg.geom.pDepth);
      const x = low[0] + tx * sM + nx * (cfg.geom.pOffset + 0.5 * cfg.geom.pDepth);
      const y = low[1] + ty * sM + ny * (cfg.geom.pOffset + 0.5 * cfg.geom.pDepth);
      const a = toPx(x - tx * half, y - ty * half);
      const b = toPx(x + tx * half, y + ty * half);
      const p = toPx(x, y);
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();

      ctx.fillStyle = "#0b7660";
      ctx.beginPath();
      ctx.arc(p[0], p[1], 2.6, 0, Math.PI * 2);
      ctx.fill();
      if (idx < 3) {
        ctx.font = "10px IBM Plex Mono, monospace";
        ctx.fillText(`P${idx + 1}`, p[0] + 4, p[1] - 2);
      }
    });

    if (scenario.cross_brace) {
      const yMargin = Math.min(0.22, Math.max(0.03, cfg.geom.pMargin * 0.65));
      const s1 = yMargin;
      const s2 = cfg.panel.height - yMargin;
      const a1 = toPx(low[0] + tx * s1 + nx * (cfg.geom.braceZStart + cfg.geom.pOffset), low[1] + ty * s1 + ny * (cfg.geom.braceZStart + cfg.geom.pOffset));
      const a2 = toPx(low[0] + tx * s2 + nx * (cfg.geom.braceZEnd + cfg.geom.pOffset), low[1] + ty * s2 + ny * (cfg.geom.braceZEnd + cfg.geom.pOffset));
      const b1 = toPx(low[0] + tx * s2 + nx * (cfg.geom.braceZStart + cfg.geom.pOffset), low[1] + ty * s2 + ny * (cfg.geom.braceZStart + cfg.geom.pOffset));
      const b2 = toPx(low[0] + tx * s1 + nx * (cfg.geom.braceZEnd + cfg.geom.pOffset), low[1] + ty * s1 + ny * (cfg.geom.braceZEnd + cfg.geom.pOffset));
      ctx.strokeStyle = "#111827";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(a1[0], a1[1]);
      ctx.lineTo(a2[0], a2[1]);
      ctx.moveTo(b1[0], b1[1]);
      ctx.lineTo(b2[0], b2[1]);
      ctx.stroke();
    }

    // Bifacial ray sketch: direct beam to ground and reflected beam to rear side.
    const elev = cfg.geom.sunElevation * DEG;
    const bounce = [low[0] + 0.67 * panelRun, 0.03];
    const rearHitS = clamp(0.46 * cfg.panel.height, 0.12, cfg.panel.height - 0.12);
    const rearHit = [low[0] + tx * rearHitS, low[1] + ty * rearHitS];
    const directLen = clamp(0.26 * cfg.panel.height, 0.8, 1.55);
    const directStart = [bounce[0] + Math.cos(elev) * directLen, bounce[1] + Math.sin(elev) * directLen];
    const directStartPx = toPx(directStart[0], directStart[1]);
    const bouncePx = toPx(bounce[0], bounce[1]);
    const rearHitPx = toPx(rearHit[0], rearHit[1]);
    const rayColor = "rgba(34, 197, 94, 0.96)";
    const rayGlow = "rgba(34, 197, 94, 0.2)";

    // Soft guide bundle near top-right for incoming radiation direction.
    ctx.save();
    ctx.strokeStyle = "rgba(17, 24, 39, 0.24)";
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 1;
    for (let i = 0; i < 4; i += 1) {
      const start = [directStart[0] - 0.08 * i, directStart[1] - 0.07 * i];
      const end = [start[0] - 0.85 * Math.cos(elev), start[1] - 0.85 * Math.sin(elev)];
      const a = toPx(start[0], start[1]);
      const b = toPx(end[0], end[1]);
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
    }
    ctx.restore();

    // Primary bifacial rays.
    ctx.save();
    ctx.strokeStyle = rayGlow;
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(directStartPx[0], directStartPx[1]);
    ctx.lineTo(bouncePx[0], bouncePx[1]);
    ctx.lineTo(rearHitPx[0], rearHitPx[1]);
    ctx.stroke();
    ctx.restore();
    drawArrow(directStartPx, bouncePx, rayColor, 2.8, 13, false);
    drawArrow(bouncePx, rearHitPx, rayColor, 2.8, 13, false);

    ctx.fillStyle = "#166534";
    ctx.font = "10px IBM Plex Mono, monospace";
    ctx.fillText("Direkt", 0.5 * (directStartPx[0] + bouncePx[0]) - 16, 0.5 * (directStartPx[1] + bouncePx[1]) - 8);
    ctx.fillText("Arkaya yansıyan", 0.5 * (rearHitPx[0] + bouncePx[0]) - 24, 0.5 * (rearHitPx[1] + bouncePx[1]) - 8);

    // Minimal title text (detailed numeric block moved below the canvas).
    ctx.fillStyle = "#166534";
    ctx.font = "10.5px IBM Plex Mono, monospace";
    ctx.fillText("Bifacial ışınlar: direkt + arkaya yansıyan", x0 + 12, y0 + 16);

    const lowPx = toPx(low[0], low[1]);
    const groundPx = toPx(low[0], 0);
    const highPx = toPx(high[0], 0);
    drawDimensionVertical(ctx, lowPx[1], groundPx[1], lowPx[0] - 24, `${fmt(cfg.panel.clearance, 2)} m`);
    drawDimensionHorizontal(ctx, lowPx[0], highPx[0], groundPx[1] + 22, `${fmt(cfg.panel.height, 2)} m`);

    ctx.restore();
  }

  function drawTopTechnical(ctx, region, cfg, scenario = selectScenario()) {
    const x0 = region.x;
    const y0 = region.y;
    const rw = region.w;
    const rh = region.h;
    const support = buildSupportLayout(cfg, scenario);

    const tilt = cfg.panel.tiltDeg * DEG;
    const rowDepth = Math.max(0.2, cfg.panel.height * Math.cos(tilt));
    const shadowLen = (cfg.panel.height * Math.sin(tilt)) / Math.max(0.2, Math.tan(cfg.geom.sunElevation * DEG));
    const tableWidthM = Math.max(cfg.geom.tableWidth, cfg.panel.width);
    const rangeM = Math.max(cfg.geom.rowPitch * 3, tableWidthM + shadowLen + 2);
    const scale = Math.min((rw - 100) / Math.max(tableWidthM + shadowLen + 1.5, 3), (rh - 70) / rangeM);

    const centerX = x0 + rw * 0.5;
    const centerY = y0 + rh * 0.5;
    const rows = [-1, 0, 1];
    const az = cfg.geom.sunAzimuth * DEG;
    const shadowVx = -Math.sin(az) * shadowLen * scale;
    const shadowVy = Math.cos(az) * shadowLen * scale;

    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, rw, rh);
    ctx.clip();

    rows.forEach((idx) => {
      const rowY = centerY + idx * cfg.geom.rowPitch * scale;
      const rx = centerX - 0.5 * tableWidthM * scale;
      const ry = rowY - 0.5 * rowDepth * scale;
      const rwPx = tableWidthM * scale;
      const rhPx = rowDepth * scale;

      ctx.strokeStyle = "#1f2937";
      ctx.lineWidth = 1.2;
      ctx.strokeRect(rx, ry, rwPx, rhPx);

      // Shadow projection as dashed technical contour.
      ctx.strokeStyle = "rgba(17, 24, 39, 0.35)";
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(rx, ry);
      ctx.lineTo(rx + rwPx, ry);
      ctx.lineTo(rx + rwPx + shadowVx, ry + shadowVy);
      ctx.lineTo(rx + shadowVx, ry + shadowVy);
      ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);

      // Module boundaries on top layout.
      ctx.strokeStyle = "rgba(31, 41, 55, 0.75)";
      ctx.lineWidth = 1;
      const moduleWpx = cfg.panel.moduleWidth * scale;
      const moduleDpx = cfg.panel.moduleHeight * Math.cos(tilt) * scale;
      for (let c = 1; c < Math.max(1, cfg.panel.countX); c += 1) {
        const gx = rx + c * moduleWpx;
        if (gx > rx && gx < rx + rwPx) {
          ctx.beginPath();
          ctx.moveTo(gx, ry);
          ctx.lineTo(gx, ry + rhPx);
          ctx.stroke();
        }
      }
      for (let r = 1; r < Math.max(1, cfg.panel.countY); r += 1) {
        const gy = ry + r * moduleDpx;
        if (gy > ry && gy < ry + rhPx) {
          ctx.beginPath();
          ctx.moveTo(rx, gy);
          ctx.lineTo(rx + rwPx, gy);
          ctx.stroke();
        }
      }

      if (idx === 0) {
        // Beam axes and column points for current table.
        support.beamDepths.forEach((depth, beamIdx) => {
          const ratio = support.run > 1e-6 ? depth / support.run : 0.5;
          const gy = ry + ratio * rhPx;
          const beamStrip = clamp(cfg.geom.pDepth * scale * 0.95, 5, 12);
          drawCProfileSegment(ctx, [rx, gy], [rx + rwPx, gy], beamStrip, {
            color: "#334155",
            webColor: "rgba(15, 23, 42, 0.88)",
            flip: beamIdx % 2 === 1,
          });
          ctx.fillStyle = "#111827";
          ctx.font = "10px IBM Plex Mono, monospace";
          ctx.fillText(`K${beamIdx + 1}`, rx + 6, gy - 8);
        });

        support.frameXs.forEach((xValue, colIdx) => {
          const gx = rx + (xValue / Math.max(0.001, support.width)) * rwPx;
          support.beamDepths.forEach((depth, rowIdx) => {
            const ratio = support.run > 1e-6 ? depth / support.run : 0.5;
            const gy = ry + ratio * rhPx;
            const colBox = clamp(cfg.geom.pThick * scale * 1.6, 6, 12);
            drawHollowRectProfile(ctx, gx - 0.5 * colBox, gy - 0.5 * colBox, colBox, colBox, {
              stroke: "#0f172a",
              innerStroke: "rgba(15, 23, 42, 0.62)",
            });
            if (colIdx < 2 && rowIdx === 0) {
              ctx.font = "9.5px IBM Plex Mono, monospace";
              ctx.fillStyle = "#0f172a";
              ctx.fillText(`C${colIdx + 1}`, gx + 4, gy - 6);
            }
          });
        });

        support.purlins.forEach((purlin, pIdx) => {
          const ratio = support.run > 1e-6 ? purlin.depth / support.run : 0.5;
          const gy = ry + ratio * rhPx;
          ctx.strokeStyle = "rgba(11, 118, 96, 0.72)";
          ctx.setLineDash([5, 3]);
          ctx.lineWidth = 1.1;
          ctx.beginPath();
          ctx.moveTo(rx, gy);
          ctx.lineTo(rx + rwPx, gy);
          ctx.stroke();
          ctx.setLineDash([]);
          if (pIdx < 2) {
            ctx.fillStyle = "#0b7660";
            ctx.font = "9.5px IBM Plex Mono, monospace";
            ctx.fillText(`P${pIdx + 1}`, rx + rwPx - 22, gy - 3);
          }
        });
      }
    });

    ctx.strokeStyle = "#111827";
    ctx.fillStyle = "#111827";
    ctx.lineWidth = 1.2;
    const sunX = x0 + rw - 76;
    const sunY = y0 + 42;
    const arrowLen = 55;
    const ax = Math.sin(az) * arrowLen;
    const ay = -Math.cos(az) * arrowLen;
    ctx.beginPath();
    ctx.moveTo(sunX, sunY);
    ctx.lineTo(sunX + ax, sunY + ay);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(sunX, sunY, 6, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#111827";
    ctx.font = "10.5px IBM Plex Mono, monospace";
    ctx.fillText("Üst düğüm haritası (C/K/P ID)", x0 + 12, y0 + 16);
    ctx.restore();
  }

  function drawIsometricTechnical(ctx, region, cfg, scenario) {
    const x0 = region.x;
    const y0 = region.y;
    const rw = region.w;
    const rh = region.h;
    const support = buildSupportLayout(cfg, scenario);
    const run = support.run;
    const rise = support.rise;
    const width = support.width;
    // Fixed drawing scale reference (prevents auto zoom when dimensions change).
    const refWidth = 16;
    const refRun = 6;
    const refZ = 3.2;
    const margin = 18;
    const isoX = 0.92;
    const isoY = 0.28;
    const scale = Math.min(
      (rw - 2 * margin) / Math.max(1, (refWidth + refRun) * isoX),
      (rh - 2 * margin) / Math.max(0.5, refZ + (refWidth + refRun) * isoY)
    );
    const raw = (xValue, depth, zValue) => [
      (xValue - depth) * isoX,
      -zValue + (xValue + depth) * isoY,
    ];
    const refPoints = [
      raw(0, 0, 0),
      raw(refWidth, 0, 0),
      raw(refWidth, refRun, 0),
      raw(0, refRun, 0),
      raw(0, 0, refZ),
      raw(refWidth, refRun, refZ),
    ];
    const refMinX = Math.min(...refPoints.map((p) => p[0]));
    const refMaxX = Math.max(...refPoints.map((p) => p[0]));
    const refMinY = Math.min(...refPoints.map((p) => p[1]));
    const refMaxY = Math.max(...refPoints.map((p) => p[1]));
    const ox = x0 + 0.5 * (rw - (refMaxX - refMinX) * scale) - refMinX * scale;
    const oy = y0 + 0.5 * (rh - (refMaxY - refMinY) * scale) - refMinY * scale;
    const proj = (xValue, depth, zValue) => {
      const [rx, ry] = raw(xValue, depth, zValue);
      const px = ox + rx * scale;
      const py = oy + ry * scale;
      return [px, py];
    };

    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, rw, rh);
    ctx.clip();

    // Ground frame.
    const g1 = proj(0, 0, 0);
    const g2 = proj(width, 0, 0);
    const g3 = proj(width, run, 0);
    const g4 = proj(0, run, 0);
    ctx.strokeStyle = "rgba(17, 24, 39, 0.32)";
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(g1[0], g1[1]);
    ctx.lineTo(g2[0], g2[1]);
    ctx.lineTo(g3[0], g3[1]);
    ctx.lineTo(g4[0], g4[1]);
    ctx.closePath();
    ctx.stroke();

    // Panel surface.
    const p1 = proj(0, 0, cfg.panel.clearance);
    const p2 = proj(width, 0, cfg.panel.clearance);
    const p3 = proj(width, run, cfg.panel.clearance + rise);
    const p4 = proj(0, run, cfg.panel.clearance + rise);
    ctx.fillStyle = "rgba(148, 163, 184, 0.20)";
    ctx.strokeStyle = "#1f2937";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(p1[0], p1[1]);
    ctx.lineTo(p2[0], p2[1]);
    ctx.lineTo(p3[0], p3[1]);
    ctx.lineTo(p4[0], p4[1]);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Beams.
    support.beams.forEach((beam, idx) => {
      const a = proj(0, beam.depth, beam.z);
      const b = proj(width, beam.depth, beam.z);
      const beamDepthPx = clamp(cfg.geom.pDepth * scale * 1.45, 8, 18);
      drawCProfileSegment(ctx, a, b, beamDepthPx, {
        color: "#334155",
        webColor: "rgba(15, 23, 42, 0.9)",
        flip: idx % 2 === 1,
      });
      ctx.fillStyle = "#334155";
      ctx.font = "10px IBM Plex Mono, monospace";
      ctx.fillText(beam.id, a[0] + 4, a[1] - 5 - idx * 2);
    });

    // Columns.
    support.columns.forEach((col, idx) => {
      const base = proj(col.x, col.depth, col.zBase);
      const top = proj(col.x, col.depth, col.zTop);
      const colDepthPx = clamp(cfg.geom.pThick * scale * 1.9, 7, 16);
      drawBoxProfileSegment(ctx, base, top, colDepthPx, {
        stroke: "#0f172a",
        innerStroke: "rgba(15, 23, 42, 0.62)",
      });
      ctx.fillStyle = "#0f172a";
      ctx.beginPath();
      ctx.arc(top[0], top[1] + 1.2, 2.1, 0, Math.PI * 2);
      ctx.fill();
      if (idx < 4) {
        ctx.font = "9.5px IBM Plex Mono, monospace";
        ctx.fillText(col.id, top[0] + 3, top[1] - 2);
      }
    });

    // Purlin axes.
    support.purlins.forEach((purlin, idx) => {
      const a = proj(0, purlin.depth, purlin.z);
      const b = proj(width, purlin.depth, purlin.z);
      ctx.strokeStyle = "rgba(11, 118, 96, 0.8)";
      ctx.setLineDash([5, 3]);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
      ctx.setLineDash([]);
      if (idx < 2) {
        ctx.fillStyle = "#0b7660";
        ctx.font = "9.5px IBM Plex Mono, monospace";
        ctx.fillText(purlin.id, b[0] - 20, b[1] - 3);
      }
    });

    // Braces.
    if (scenario.cross_brace && support.frameXs.length >= 2 && support.beams.length >= 2) {
      const xA = support.frameXs[1];
      const xB = support.frameXs[support.frameXs.length - 2];
      const y1 = support.beams[0].depth;
      const y2 = support.beams[1].depth;
      const z1 = support.beams[0].z;
      const z2 = support.beams[1].z;
      const a1 = proj(xA, y1, z1);
      const a2 = proj(xB, y2, z2);
      const b1 = proj(xA, y2, z2);
      const b2 = proj(xB, y1, z1);
      ctx.strokeStyle = "#7c2d12";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(a1[0], a1[1]);
      ctx.lineTo(a2[0], a2[1]);
      ctx.moveTo(b1[0], b1[1]);
      ctx.lineTo(b2[0], b2[1]);
      ctx.stroke();
    }

    ctx.fillStyle = "#111827";
    ctx.font = "10.5px IBM Plex Mono, monospace";
    ctx.fillText("İzometrik düğüm modeli (sabit ölçek)", x0 + 10, y0 + 16);
    ctx.restore();
  }

  function drawPanelPreview(cfg) {
    const { ctx, width, height } = fitCanvas(elements.panelPreviewCanvas);
    drawPaperGrid(ctx, width, height);
    drawFrontTechnical(ctx, { x: 12, y: 12, w: width - 24, h: height - 24 }, cfg, selectScenario(), { showDimensions: true });
  }

  function drawGeometryViews(cfg, scenario) {
    {
      const { ctx, width, height } = fitCanvas(elements.frontViewCanvas);
      drawPaperGrid(ctx, width, height);
      drawFrontTechnical(ctx, { x: 10, y: 10, w: width - 20, h: height - 20 }, cfg, scenario, { showDimensions: true });
    }
    {
      const { ctx, width, height } = fitCanvas(elements.sideViewCanvas);
      drawPaperGrid(ctx, width, height);
      drawSideTechnical(ctx, { x: 10, y: 10, w: width - 20, h: height - 20 }, cfg, scenario);
    }
    {
      const { ctx, width, height } = fitCanvas(elements.topViewCanvas);
      drawPaperGrid(ctx, width, height);
      drawTopTechnical(ctx, { x: 10, y: 10, w: width - 20, h: height - 20 }, cfg, scenario);
    }
    if (elements.isoViewCanvas) {
      const { ctx, width, height } = fitCanvas(elements.isoViewCanvas);
      drawPaperGrid(ctx, width, height);
      drawIsometricTechnical(ctx, { x: 10, y: 10, w: width - 20, h: height - 20 }, cfg, scenario);
    }
  }

  function drawScenarioPreview(cfg, scenario) {
    const { ctx, width, height } = fitCanvas(elements.scenarioPreviewCanvas);
    drawPaperGrid(ctx, width, height);

    const pad = 12;
    const topHeight = Math.round((height - 3 * pad) * 0.48);
    const leftWidth = Math.round((width - 3 * pad) * 0.58);
    const rightWidth = width - leftWidth - 3 * pad;
    const bottomHeight = height - topHeight - 3 * pad;

    drawFrontTechnical(ctx, { x: pad, y: pad, w: leftWidth, h: topHeight }, cfg, scenario, { showDimensions: true });
    drawSideTechnical(ctx, { x: pad + leftWidth + pad, y: pad, w: rightWidth, h: topHeight }, cfg, scenario);
    drawTopTechnical(ctx, { x: pad, y: pad + topHeight + pad, w: width - 2 * pad, h: bottomHeight }, cfg, scenario);

    ctx.fillStyle = "#111827";
    ctx.font = "12px IBM Plex Mono, monospace";
    ctx.fillText(`Senaryo: ${scenario.name}`, pad + 8, height - 10);
  }

  async function fetchJsonWithFallback(proxyUrl, directUrl, sourceLabel) {
    let lastError = null;
    for (const url of [proxyUrl, directUrl]) {
      try {
        const response = await fetch(url.toString());
        if (!response.ok) throw new Error(`${response.status}`);
        return await response.json();
      } catch (error) {
        lastError = error;
      }
    }
    throw new Error(`${sourceLabel} isteği başarısız (${lastError?.message || "bilinmeyen hata"})`);
  }

  async function fetchNasaAlbedo(lat, lon) {
    const proxyUrl = new URL("/api/nasa-albedo", window.location.origin);
    proxyUrl.searchParams.set("latitude", String(lat));
    proxyUrl.searchParams.set("longitude", String(lon));

    const directUrl = new URL("https://power.larc.nasa.gov/api/temporal/climatology/point");
    directUrl.searchParams.set("parameters", "ALLSKY_SRF_ALB");
    directUrl.searchParams.set("community", "RE");
    directUrl.searchParams.set("longitude", String(lon));
    directUrl.searchParams.set("latitude", String(lat));
    directUrl.searchParams.set("format", "JSON");

    const payload = await fetchJsonWithFallback(proxyUrl, directUrl, "NASA");
    const data = payload?.properties?.parameter?.ALLSKY_SRF_ALB;
    if (!data) throw new Error("NASA albedo verisi eksik.");
    const monthly = MONTH_KEYS.map((key) => {
      const value = Number(data[key]);
      return Number.isFinite(value) ? value : 0;
    });
    const annualRaw = Number(data.ANN);
    const annual = Number.isFinite(annualRaw) ? annualRaw : mean(monthly);
    return { monthly, annual };
  }

  async function fetchPvgisClimate(lat, lon) {
    const proxyUrl = new URL("/api/pvgis-tmy", window.location.origin);
    proxyUrl.searchParams.set("lat", String(lat));
    proxyUrl.searchParams.set("lon", String(lon));

    const directUrl = new URL("https://re.jrc.ec.europa.eu/api/v5_2/tmy");
    directUrl.searchParams.set("lat", String(lat));
    directUrl.searchParams.set("lon", String(lon));
    directUrl.searchParams.set("outputformat", "json");

    const payload = await fetchJsonWithFallback(proxyUrl, directUrl, "PVGIS");
    const rows = payload?.outputs?.tmy_hourly;
    if (!Array.isArray(rows) || !rows.length) throw new Error("PVGIS iklim verisi eksik.");

    const monthlyBuckets = Array.from({ length: 12 }, () => ({
      ghiKWhM2: 0,
      tempSum: 0,
      windSum: 0,
      count: 0,
    }));
    let totalTemp = 0;
    let totalWind = 0;
    let totalCount = 0;

    rows.forEach((row) => {
      const stamp = String(row["time(UTC)"] || "");
      const month = Number(stamp.slice(4, 6));
      if (!Number.isFinite(month) || month < 1 || month > 12) return;
      const bucket = monthlyBuckets[month - 1];

      const ghiWm2 = Number(row["G(h)"]);
      if (Number.isFinite(ghiWm2)) {
        bucket.ghiKWhM2 += ghiWm2 / 1000;
      }

      const temp = Number(row.T2m);
      const wind = Number(row.WS10m);
      if (Number.isFinite(temp)) {
        bucket.tempSum += temp;
        totalTemp += temp;
      }
      if (Number.isFinite(wind)) {
        bucket.windSum += wind;
        totalWind += wind;
      }
      bucket.count += 1;
      totalCount += 1;
    });

    const monthly = monthlyBuckets.map((bucket) => ({
      ghiKWhM2: bucket.ghiKWhM2,
      tempC: bucket.count ? bucket.tempSum / bucket.count : 0,
      windMs: bucket.count ? bucket.windSum / bucket.count : 0,
    }));

    return {
      monthly,
      annualGhiKWhM2: monthly.reduce((acc, row) => acc + row.ghiKWhM2, 0),
      avgTempC: totalCount ? totalTemp / totalCount : 0,
      avgWindMs: totalCount ? totalWind / totalCount : 0,
    };
  }

  async function fetchSiteData(lat, lon) {
    const token = ++state.siteFetchToken;
    setSiteStatus(`${fmtSigned(lat, 4)}, ${fmtSigned(lon, 4)} için NASA + PVGIS getiriliyor...`);
    try {
      const [albedo, climate] = await Promise.all([
        fetchNasaAlbedo(lat, lon),
        fetchPvgisClimate(lat, lon),
      ]);
      if (token !== state.siteFetchToken) return;
      state.siteData = { lat, lon, albedo, climate };
      renderSitePanels();
      setSiteStatus(`${fmtSigned(lat, 4)}, ${fmtSigned(lon, 4)} için veriler yüklendi.`);
    } catch (error) {
      if (token !== state.siteFetchToken) return;
      state.siteData = null;
      renderSitePanels();
      setSiteStatus(`Konum verisi hatası: ${error.message}`);
    }
  }

  function moveMapMarker(lat, lon, pan = false) {
    if (!state.mapMarker) return;
    state.mapMarker.setLatLng([lat, lon]);
    if (pan && state.map) state.map.panTo([lat, lon]);
  }

  function applySiteLocation(lat, lon, options = {}) {
    const fetchData = options.fetchData !== false;
    const panMap = options.panMap === true;
    writeSiteCoordinates(lat, lon);
    setPendingSitePoint(lat, lon);
    moveMapMarker(lat, lon, panMap);
    if (fetchData) fetchSiteData(lat, lon);
  }

  function ensureSiteMapInitialized() {
    if (state.mapInitialized) return true;
    if (!elements.siteMap) return false;
    if (!window.L) {
      setSiteStatus("Leaflet yüklenemedi. Harita kutucukları için internet erişimini kontrol edin.");
      if (elements.modalMapError) {
        elements.modalMapError.textContent = "Harita kütüphanesi yüklenemedi. Bu pencereyi kapatıp koordinatları manuel girebilirsiniz.";
      }
      return false;
    }
    if (elements.modalMapError) elements.modalMapError.textContent = "";

    let defaultLat = 39.9208;
    let defaultLon = 32.8541;
    try {
      const coords = readSiteCoordinatesStrict();
      defaultLat = coords.lat;
      defaultLon = coords.lon;
    } catch {
      writeSiteCoordinates(defaultLat, defaultLon);
    }

    const osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors",
    });
    const satellite = L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      {
        maxZoom: 19,
        attribution: "Tiles &copy; Esri",
      }
    );

    state.map = L.map(elements.siteMap, { zoomControl: true, preferCanvas: true });
    satellite.addTo(state.map);
    L.control.layers({ Uydu: satellite, OpenStreetMap: osm }).addTo(state.map);
    state.map.setView([defaultLat, defaultLon], 12);
    state.mapMarker = L.marker([defaultLat, defaultLon], { draggable: true }).addTo(state.map);

    state.map.on("click", (event) => {
      const lat = event.latlng.lat;
      const lon = event.latlng.lng;
      setPendingSitePoint(lat, lon);
      moveMapMarker(lat, lon, false);
    });

    state.mapMarker.on("dragend", () => {
      const point = state.mapMarker.getLatLng();
      setPendingSitePoint(point.lat, point.lng);
    });

    state.mapInitialized = true;
    return true;
  }

  function openSiteMapModal() {
    let lat = 39.9208;
    let lon = 32.8541;
    try {
      const coords = readSiteCoordinatesStrict();
      lat = coords.lat;
      lon = coords.lon;
    } catch {
      // fall back to defaults
    }
    elements.siteMapModal.hidden = false;
    elements.siteMapModal.removeAttribute("hidden");
    elements.siteMapModal.style.display = "";
    elements.siteMapModal.style.pointerEvents = "";
    syncModalBodyLock();
    if (elements.modalMapError) elements.modalMapError.textContent = "";
    if (!ensureSiteMapInitialized()) {
      setSiteStatus("Harita kütüphanesi başlatılamadı. Koordinatları yine de manuel girebilirsiniz.");
      return;
    }
    setPendingSitePoint(lat, lon);
    moveMapMarker(lat, lon, true);
    window.setTimeout(() => {
      if (state.map) state.map.invalidateSize();
    }, 60);
  }

  function closeSiteMapModal(ev) {
    if (!elements.siteMapModal || elements.siteMapModal.hidden) return;
    if (ev && ev.target && ev.target !== elements.siteMapModal) return;
    elements.siteMapModal.hidden = true;
    elements.siteMapModal.setAttribute("hidden", "hidden");
    elements.siteMapModal.style.display = "none";
    elements.siteMapModal.style.pointerEvents = "none";
    syncModalBodyLock();
  }

  function openSiteDataModal() {
    if (!elements.siteDataModal) return;
    elements.siteDataModal.hidden = false;
    elements.siteDataModal.removeAttribute("hidden");
    elements.siteDataModal.style.display = "";
    elements.siteDataModal.style.pointerEvents = "";
    syncModalBodyLock();
    updateSiteQuickSummary();
  }

  function closeSiteDataModal(ev) {
    if (!elements.siteDataModal || elements.siteDataModal.hidden) return;
    if (ev && ev.target && ev.target !== elements.siteDataModal) return;
    elements.siteDataModal.hidden = true;
    elements.siteDataModal.setAttribute("hidden", "hidden");
    elements.siteDataModal.style.display = "none";
    elements.siteDataModal.style.pointerEvents = "none";
    syncModalBodyLock();
  }

  window.__openSiteLocationModal = openSiteMapModal;
  window.__closeSiteLocationModal = closeSiteMapModal;
  window.forceCloseSiteModal = closeSiteMapModal;

  function initializeSiteMap() {
    resetSitePanels();
    let defaultLat = 39.9208;
    let defaultLon = 32.8541;
    try {
      const coords = readSiteCoordinatesStrict();
      defaultLat = coords.lat;
      defaultLon = coords.lon;
    } catch {
      writeSiteCoordinates(defaultLat, defaultLon);
    }
    setPendingSitePoint(defaultLat, defaultLon);
    fetchSiteData(defaultLat, defaultLon);
  }

  function wireSiteActions() {
    if (elements.openSiteDataDialogBtn) {
      elements.openSiteDataDialogBtn.addEventListener("click", openSiteDataModal);
    }
    if (elements.closeSiteDataModalBtn) {
      elements.closeSiteDataModalBtn.addEventListener("click", closeSiteDataModal);
    }
    if (elements.doneSiteDataModalBtn) {
      elements.doneSiteDataModalBtn.addEventListener("click", closeSiteDataModal);
    }
    if (elements.siteDataModal) {
      elements.siteDataModal.addEventListener("click", (event) => {
        if (event.target === elements.siteDataModal) closeSiteDataModal();
      });
    }

    elements.openSiteMapBtn.addEventListener("click", openSiteMapModal);

    elements.modalGoFromMainBtn.addEventListener("click", () => {
      try {
        const { lat, lon } = readSiteCoordinatesStrict();
        setPendingSitePoint(lat, lon);
        openSiteMapModal();
      } catch (error) {
        setSiteStatus(error.message);
      }
    });

    elements.closeSiteMapBtn.addEventListener("click", closeSiteMapModal);
    elements.cancelSiteMapBtn.addEventListener("click", closeSiteMapModal);

    elements.siteMapModal.addEventListener("click", (event) => {
      if (event.target === elements.siteMapModal) closeSiteMapModal();
    });

    window.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (!elements.siteMapModal.hidden) {
        closeSiteMapModal();
        return;
      }
      if (elements.siteDataModal && !elements.siteDataModal.hidden) {
        closeSiteDataModal();
      }
    });

    elements.modalGoBtn.addEventListener("click", () => {
      try {
        const { lat, lon } = readModalCoordinatesStrict();
        setPendingSitePoint(lat, lon);
        moveMapMarker(lat, lon, true);
      } catch (error) {
        setSiteStatus(error.message);
      }
    });

    [elements.modalLat, elements.modalLon].forEach((input) => {
      input.addEventListener("change", () => {
        try {
          const { lat, lon } = readModalCoordinatesStrict();
          setPendingSitePoint(lat, lon);
          moveMapMarker(lat, lon, true);
        } catch {
          // keep values until valid
        }
      });
    });

    elements.applySiteMapBtn.addEventListener("click", () => {
      let lat;
      let lon;
      try {
        ({ lat, lon } = readModalCoordinatesStrict());
      } catch {
        if (!state.pendingSitePoint) {
          setSiteStatus("Lütfen önce haritada bir nokta seçin.");
          return;
        }
        lat = state.pendingSitePoint.lat;
        lon = state.pendingSitePoint.lon;
      }
      applySiteLocation(lat, lon, { fetchData: true, panMap: false });
      closeSiteMapModal();
    });

    elements.fetchSiteDataBtn.addEventListener("click", () => {
      try {
        const { lat, lon } = readSiteCoordinatesStrict();
        moveMapMarker(lat, lon, true);
        fetchSiteData(lat, lon);
      } catch (error) {
        setSiteStatus(error.message);
      }
    });

    [elements.siteLat, elements.siteLon].forEach((input) => {
      input.addEventListener("change", () => {
        try {
          const { lat, lon } = readSiteCoordinatesStrict();
          moveMapMarker(lat, lon, true);
          setPendingSitePoint(lat, lon);
        } catch {
          // keep current marker until a valid coordinate is entered
        }
      });
    });

    elements.useGpsBtn.addEventListener("click", () => {
      if (!navigator.geolocation) {
        setSiteStatus("Tarayıcı konum özelliği kullanılamıyor.");
        return;
      }
      setSiteStatus("Tarayıcıdan GPS konumu isteniyor...");
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const lat = position.coords.latitude;
          const lon = position.coords.longitude;
          if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
            setSiteStatus("GPS geçersiz koordinat döndürdü.");
            return;
          }
          applySiteLocation(lat, lon, { fetchData: true, panMap: true });
          closeSiteMapModal();
        },
        (error) => {
          setSiteStatus(`GPS hatası: ${error.message}`);
        },
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 120000 }
      );
    });
  }

  function renderVisuals() {
    try {
      const cfg = getConfigSafe();
      const scenario = selectScenario();
      const support = buildSupportLayout(cfg, scenario);
      elements.previewScenarioName.textContent = scenario.name;
      elements.geomSummary.textContent = `Geometri özeti: ${cfg.panel.countVertical}D x ${cfg.panel.countHorizontal}Y modül, ${fmt(cfg.panel.width, 2)} m x ${fmt(cfg.panel.height, 2)} m | Kolon ${support.columns.length} / Kiriş ${support.beams.length} / Aşık ${support.purlins.length}`;
      renderGeometryDetails(cfg, scenario);
      renderViewMeta(cfg, scenario);
      renderStructureNodeBoard(cfg, scenario);
      drawPanelPreview(cfg);
      drawGeometryViews(cfg, scenario);
      drawScenarioPreview(cfg, scenario);
    } catch (error) {
      if (elements.geomSummary) {
        elements.geomSummary.textContent = `Geometri hatası: ${error.message}`;
      }
      if (elements.geomLiveDetails) {
        elements.geomLiveDetails.textContent = `Geometri detay hatası: ${error.message}`;
      }
      if (elements.structureNodeBoard) {
        elements.structureNodeBoard.textContent = `Taşıyıcı düğüm hatası: ${error.message}`;
      }
      if (elements.statusLine) {
        elements.statusLine.textContent = `Çizim hatası: ${error.message}`;
      }
      console.error(error);
    }
  }

  function renderScenarioCards() {
    elements.scenarioList.innerHTML = "";
    state.scenarios.forEach((scenario, idx) => {
      const card = document.createElement("div");
      card.className = "scenario-card";
      card.innerHTML = `
        <div class="scenario-head">
          <label class="field">
            <span>Senaryo Adı (Sid)</span>
            <input type="text" data-key="name" value="${escapeHtml(scenario.name)}">
          </label>
          <button class="btn remove" data-action="remove" ${state.scenarios.length === 1 ? "disabled" : ""}>Kaldır</button>
        </div>
        <div class="grid-2">
          <label class="field">
            <span>Aşık Adedi P#</span>
            <input type="number" min="0" step="1" data-key="purlin_count" value="${scenario.purlin_count}">
          </label>
          <label class="toggle">
            <input type="checkbox" data-key="cross_brace" ${scenario.cross_brace ? "checked" : ""}>
            Çapraz X
          </label>
          <label class="toggle">
            <input type="radio" name="previewScenario" data-action="preview" ${idx === state.previewScenarioIndex ? "checked" : ""}>
            Bu Senaryoyu Önizle
          </label>
        </div>
      `;

      card.querySelectorAll("input").forEach((input) => {
        input.addEventListener("input", () => {
          const key = input.dataset.key;
          if (key === "name") {
            state.scenarios[idx].name = input.value || `Senaryo ${idx + 1}`;
          } else if (key === "purlin_count") {
            state.scenarios[idx].purlin_count = Math.max(0, Math.round(Number(input.value) || 0));
          } else if (key === "cross_brace") {
            state.scenarios[idx].cross_brace = input.checked;
          }
          renderVisuals();
        });
      });

      const removeBtn = card.querySelector('[data-action="remove"]');
      if (removeBtn) {
        removeBtn.addEventListener("click", () => {
          state.scenarios.splice(idx, 1);
          if (state.previewScenarioIndex >= state.scenarios.length) {
            state.previewScenarioIndex = state.scenarios.length - 1;
          }
          renderScenarioCards();
          renderVisuals();
        });
      }

      const previewRadio = card.querySelector('[data-action="preview"]');
      previewRadio.addEventListener("change", () => {
        state.previewScenarioIndex = idx;
        renderVisuals();
      });

      elements.scenarioList.appendChild(card);
    });
  }

  function sampleCosineHemisphere(rng) {
    const u1 = rng();
    const u2 = rng();
    const r = Math.sqrt(u1);
    const theta = 2 * Math.PI * u2;
    return [r * Math.cos(theta), r * Math.sin(theta), Math.sqrt(Math.max(0, 1 - u1))];
  }

  function randomSeeded(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function rayHitsAABB(origin, direction, box) {
    const EPS = 1e-9;
    let tMin = EPS;
    let tMax = Number.POSITIVE_INFINITY;
    const axes = [
      [origin[0], direction[0], box.min_x, box.max_x],
      [origin[1], direction[1], box.min_y, box.max_y],
      [origin[2], direction[2], box.min_z, box.max_z],
    ];
    for (const [o, d, bMin, bMax] of axes) {
      if (Math.abs(d) < EPS) {
        if (o < bMin || o > bMax) return false;
        continue;
      }
      const invD = 1 / d;
      let t1 = (bMin - o) * invD;
      let t2 = (bMax - o) * invD;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tMin = Math.max(tMin, t1);
      tMax = Math.min(tMax, t2);
      if (tMax < tMin) return false;
    }
    return true;
  }

  function segmentToBoxes(params) {
    const boxes = [];
    const segments = Math.max(1, params.segments);
    for (let i = 0; i < segments; i += 1) {
      const t0 = i / segments;
      const t1 = (i + 1) / segments;
      const yc0 = params.y0 + (params.y1 - params.y0) * t0;
      const zc0 = params.z0 + (params.z1 - params.z0) * t0;
      const yc1 = params.y0 + (params.y1 - params.y0) * t1;
      const zc1 = params.z0 + (params.z1 - params.z0) * t1;
      const yCenter = 0.5 * (yc0 + yc1);
      const zCenter = 0.5 * (zc0 + zc1);
      const halfY = 0.5 * Math.abs(yc1 - yc0) + 0.5 * params.thickness;
      const halfZ = 0.5 * Math.abs(zc1 - zc0) + 0.5 * params.thickness;
      const halfX = 0.5 * params.thickness;
      boxes.push({
        min_x: params.xCenter - halfX,
        max_x: params.xCenter + halfX,
        min_y: yCenter - halfY,
        max_y: yCenter + halfY,
        min_z: zCenter - halfZ,
        max_z: zCenter + halfZ,
      });
    }
    return boxes;
  }

  function buildPurlinBoxes(cfg, scenario) {
    const count = Math.max(0, Math.round(scenario.purlin_count));
    if (!count) return [];
    const positions = purlinPositions(cfg.panel.height, count, cfg.geom.pMargin);
    const overhang = 0.02;
    return positions.map((yValue) => ({
      min_x: -overhang,
      max_x: cfg.panel.width + overhang,
      min_y: yValue - 0.5 * cfg.geom.pThick,
      max_y: yValue + 0.5 * cfg.geom.pThick,
      min_z: cfg.geom.pOffset,
      max_z: cfg.geom.pOffset + cfg.geom.pDepth,
    }));
  }

  function buildBraceBoxes(cfg, scenario) {
    if (!scenario.cross_brace) return [];
    const yMargin = Math.min(0.22, Math.max(0.03, cfg.geom.pMargin * 0.65));
    const yLow = yMargin;
    const yHigh = cfg.panel.height - yMargin;
    if (yHigh <= yLow) return [];
    const boxes = [];
    cfg.braceXRel.forEach((rel) => {
      const xCenter = cfg.panel.width * rel;
      boxes.push(
        ...segmentToBoxes({
          xCenter,
          y0: yLow,
          z0: cfg.geom.braceZStart,
          y1: yHigh,
          z1: cfg.geom.braceZEnd,
          thickness: cfg.geom.braceThick,
          segments: cfg.geom.braceSeg,
        }),
        ...segmentToBoxes({
          xCenter,
          y0: yHigh,
          z0: cfg.geom.braceZStart,
          y1: yLow,
          z1: cfg.geom.braceZEnd,
          thickness: cfg.geom.braceThick,
          segments: cfg.geom.braceSeg,
        })
      );
    });
    return boxes;
  }

  function estimatePointBlockage(origin, members, raysPerPoint, rng) {
    if (!members.length) return 0;
    let blocked = 0;
    for (let i = 0; i < raysPerPoint; i += 1) {
      const direction = sampleCosineHemisphere(rng);
      let hit = false;
      for (let j = 0; j < members.length; j += 1) {
        if (rayHitsAABB(origin, direction, members[j])) {
          hit = true;
          break;
        }
      }
      if (hit) blocked += 1;
    }
    return blocked / raysPerPoint;
  }

  function mean(values) {
    if (!values.length) return 0;
    return values.reduce((acc, value) => acc + value, 0) / values.length;
  }

  function pstdev(values, avg) {
    if (!values.length) return 0;
    let accum = 0;
    for (let i = 0; i < values.length; i += 1) {
      const diff = values[i] - avg;
      accum += diff * diff;
    }
    return Math.sqrt(accum / values.length);
  }

  async function runScenarioSimulation(cfg, scenario, scenarioIndex) {
    const members = [...buildPurlinBoxes(cfg, scenario), ...buildBraceBoxes(cfg, scenario)];
    const rng = randomSeeded(cfg.sim.seed + scenarioIndex * 9173);
    const pointValues = [];
    const total = cfg.sim.pointsX * cfg.sim.pointsY;
    let completed = 0;
    const progressStep = Math.max(8, Math.round(total / 12));

    for (let ix = 0; ix < cfg.sim.pointsX; ix += 1) {
      const x = cfg.panel.width * (ix + 0.5) / cfg.sim.pointsX;
      for (let iy = 0; iy < cfg.sim.pointsY; iy += 1) {
        const y = cfg.panel.height * (iy + 0.5) / cfg.sim.pointsY;
        pointValues.push(estimatePointBlockage([x, y, 0], members, cfg.sim.raysPerPoint, rng));
        completed += 1;
        if (completed % progressStep === 0) {
          elements.statusLine.textContent = `${scenario.name} çalışıyor • örnek ${completed}/${total}`;
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }
    }

    const meanBlockage = mean(pointValues);
    const stdBlockage = pstdev(pointValues, meanBlockage);
    const mismatchPct = clamp(cfg.energy.baseMismatchPct + cfg.energy.mismatchFactor * stdBlockage, 0, 80);
    const rearIdealKWh = cfg.energy.frontAnnualKWh * (cfg.energy.idealRearGainPct / 100);
    const rearAfterOptical = rearIdealKWh * (1 - meanBlockage);
    const rearAfterMismatch = rearAfterOptical * (1 - mismatchPct / 100);
    const annualTotal = cfg.energy.frontAnnualKWh + rearAfterMismatch;

    return {
      name: scenario.name,
      purlin_count: scenario.purlin_count,
      cross_brace: scenario.cross_brace,
      mean_blockage_ratio: meanBlockage,
      std_blockage_ratio: stdBlockage,
      mismatch_pct: mismatchPct,
      effective_rear_gain_pct: (100 * rearAfterMismatch) / cfg.energy.frontAnnualKWh,
      annual_total_kwh: annualTotal,
      delta_kwh: 0,
      delta_pct: 0,
    };
  }

  function chooseReference(results) {
    const direct = results.findIndex((row) => row.purlin_count === 0 && !row.cross_brace);
    if (direct >= 0) return direct;
    return results.reduce((best, row, idx) => (row.mean_blockage_ratio < results[best].mean_blockage_ratio ? idx : best), 0);
  }

  function renderResults(results, refIndex) {
    elements.resultBody.innerHTML = "";
    elements.bars.innerHTML = "";
    const refEnergy = results[refIndex].annual_total_kwh;
    const totals = results.map((row) => row.annual_total_kwh);
    const maxTotal = Math.max(...totals);
    const minTotal = Math.min(...totals);

    results.forEach((row, idx) => {
      row.delta_kwh = row.annual_total_kwh - refEnergy;
      row.delta_pct = 100 * (row.annual_total_kwh / refEnergy - 1);
      const tr = document.createElement("tr");
      if (idx === refIndex) tr.classList.add("ref-row");
      tr.innerHTML = `
        <td>${escapeHtml(row.name)}</td>
        <td>${row.purlin_count}</td>
        <td>${row.cross_brace ? "evet" : "hayır"}</td>
        <td>${fmt(100 * row.mean_blockage_ratio, 2)}</td>
        <td>${fmt(100 * row.std_blockage_ratio, 2)}</td>
        <td>${fmt(row.mismatch_pct, 2)}</td>
        <td>${fmt(row.effective_rear_gain_pct, 2)}</td>
        <td>${fmt(row.annual_total_kwh, 0)}</td>
        <td class="${row.delta_kwh < 0 ? "neg" : "pos"}">${fmt(row.delta_kwh, 0)}</td>
        <td class="${row.delta_pct < 0 ? "neg" : "pos"}">${fmt(row.delta_pct, 2)}</td>
      `;
      elements.resultBody.appendChild(tr);

      const barRow = document.createElement("div");
      barRow.className = "bar-row";
      const widthPct = Math.max(3, (100 * row.annual_total_kwh) / maxTotal);
      barRow.innerHTML = `
        <div>${escapeHtml(row.name)}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${widthPct}%"></div></div>
        <div class="${row.delta_pct < 0 ? "neg" : "pos"}">${fmt(row.delta_pct, 2)}%</div>
      `;
      elements.bars.appendChild(barRow);
    });

    elements.mRef.textContent = results[refIndex].name;
    elements.mBest.textContent = fmt(maxTotal, 0);
    elements.mWorst.textContent = fmt(minTotal, 0);
    elements.mSpread.textContent = fmt(maxTotal - minTotal, 0);
  }

  async function runComparison() {
    try {
      const cfg = getConfigStrict();
      if (!state.scenarios.length) throw new Error("Lütfen en az bir senaryo ekleyin.");

      const t0 = performance.now();
      elements.statusLine.textContent = "Simülasyon hazırlanıyor...";
      const results = [];
      for (let i = 0; i < state.scenarios.length; i += 1) {
        elements.statusLine.textContent = `Senaryo ${i + 1}/${state.scenarios.length}: ${state.scenarios[i].name}`;
        const row = await runScenarioSimulation(cfg, state.scenarios[i], i + 1);
        results.push(row);
      }
      const refIndex = chooseReference(results);
      state.results = results;
      renderResults(results, refIndex);
      const sec = ((performance.now() - t0) / 1000).toFixed(2);
      elements.statusLine.textContent = `${sec}s içinde tamamlandı. Referans: ${results[refIndex].name}`;
    } catch (error) {
      elements.statusLine.textContent = `Hata: ${error.message}`;
    }
  }

  function downloadCsv() {
    if (!state.results.length) {
      elements.statusLine.textContent = "CSV dışa aktarmak için önce simülasyonu çalıştırın.";
      return;
    }
    const header = [
      "scenario",
      "purlin_count",
      "cross_brace",
      "mean_blockage_pct",
      "std_blockage_pct",
      "mismatch_pct",
      "effective_rear_gain_pct",
      "annual_total_kwh",
      "delta_ref_kwh",
      "delta_ref_pct",
    ];
    const lines = [header.join(",")];
    state.results.forEach((row) => {
      lines.push([
        csvEscape(row.name),
        row.purlin_count,
        row.cross_brace ? "true" : "false",
        (100 * row.mean_blockage_ratio).toFixed(6),
        (100 * row.std_blockage_ratio).toFixed(6),
        row.mismatch_pct.toFixed(6),
        row.effective_rear_gain_pct.toFixed(6),
        row.annual_total_kwh.toFixed(6),
        row.delta_kwh.toFixed(6),
        row.delta_pct.toFixed(6),
      ].join(","));
    });
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bifacial_support_results_${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    elements.statusLine.textContent = "CSV indirildi.";
  }

  function setReportProgress(progress, step, message) {
    if (elements.reportProgressBar) {
      const p = clamp(Number(progress) || 0, 0, 100);
      elements.reportProgressBar.style.width = `${p}%`;
    }
    if (elements.reportProgressText) {
      const p = clamp(Number(progress) || 0, 0, 100);
      elements.reportProgressText.textContent = `%${Math.round(p)}`;
    }
    if (elements.reportStepText) {
      elements.reportStepText.textContent = step || "Bekliyor";
    }
    if (elements.reportStatusLine && message) {
      elements.reportStatusLine.textContent = message;
    }
  }

  function stopReportPolling() {
    if (state.reportPollTimer) {
      window.clearInterval(state.reportPollTimer);
      state.reportPollTimer = 0;
    }
  }

  async function cleanReportOutputs(options = {}) {
    const silent = !!options.silent;
    const keepLatest = Number.isFinite(Number(options.keepLatest)) ? Math.max(0, Math.round(Number(options.keepLatest))) : 0;
    const btn = elements.cleanReportOutputsBtn;
    if (btn) btn.disabled = true;
    if (!silent) {
      setReportProgress(2, "Temizlik", "Eski rapor çıktıları temizleniyor...");
    }
    try {
      const res = await fetch("/api/report/cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keep_latest: keepLatest }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

      if (!silent) {
        const removed = Number(data?.summary?.removed_count || 0);
        const failed = Number(data?.summary?.failed_count || 0);
        const msg = failed > 0
          ? `Temizlik tamamlandı: ${removed} dosya silindi, ${failed} dosya silinemedi.`
          : `Temizlik tamamlandı: ${removed} dosya silindi.`;
        setReportProgress(6, "Temizlik", msg);
      }
      return data;
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function buildReportConfig(cfg) {
    const annualAlbedo = state.siteData?.albedo?.annual;
    const annualGhi = state.siteData?.climate?.annualGhiKWhM2;
    const avgTemp = state.siteData?.climate?.avgTempC;
    const avgWind = state.siteData?.climate?.avgWindMs;
    return {
      project: {
        name: (elements.reportProjectName?.value || "").trim() || "Bifacial Otomatik Rapor",
      },
      site: {
        lat: cfg.site.lat,
        lon: cfg.site.lon,
        annual_albedo: Number.isFinite(Number(annualAlbedo)) ? Number(annualAlbedo) : null,
        annual_ghi_kwh_m2: Number.isFinite(Number(annualGhi)) ? Number(annualGhi) : null,
        climate_note: Number.isFinite(Number(avgTemp)) && Number.isFinite(Number(avgWind))
          ? `PVGIS iklim özeti: ortalama sıcaklık ${fmt(avgTemp, 1)} C, ortalama rüzgar ${fmt(avgWind, 1)} m/s.`
          : "",
      },
      panel: {
        width_m: cfg.panel.moduleWidth,
        height_m: cfg.panel.moduleHeight,
      },
      energy_model: {
        annual_front_energy_kwh: cfg.energy.frontAnnualKWh,
        ideal_bifacial_gain_pct: cfg.energy.idealRearGainPct,
        base_rear_mismatch_pct: cfg.energy.baseMismatchPct,
        mismatch_from_nonuniformity_factor: cfg.energy.mismatchFactor,
      },
      simulation: {
        panel_points_x: cfg.sim.pointsX,
        panel_points_y: cfg.sim.pointsY,
        rays_per_point: cfg.sim.raysPerPoint,
        seed: cfg.sim.seed,
      },
      geometry_defaults: {
        purlin_depth_z_m: cfg.geom.pDepth,
        purlin_thickness_y_m: cfg.geom.pThick,
        purlin_z_offset_m: cfg.geom.pOffset,
        purlin_edge_margin_m: cfg.geom.pMargin,
        purlin_overhang_x_m: 0.02,
        brace_thickness_m: cfg.geom.braceThick,
        brace_z_start_m: cfg.geom.braceZStart,
        brace_z_end_m: cfg.geom.braceZEnd,
        brace_edge_margin_m: 0.10,
        brace_segments: cfg.geom.braceSeg,
        brace_x_rel_positions: [0.35, 0.65],
      },
      scenarios: state.scenarios.map((s, idx) => ({
        name: (s.name || `Senaryo ${idx + 1}`).trim(),
        purlin_count: Math.max(0, Math.round(Number(s.purlin_count) || 0)),
        cross_brace: !!s.cross_brace,
      })),
    };
  }

  async function pollReportStatus(jobId) {
    try {
      const res = await fetch(`/api/report/status?job_id=${encodeURIComponent(jobId)}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

      setReportProgress(data.progress || 0, data.step || "İşleniyor", data.message || "Rapor hazırlanıyor...");

      if (data.status === "done") {
        stopReportPolling();
        if (elements.generateReportBtn) elements.generateReportBtn.disabled = false;
        if (elements.generateReportBtn) elements.generateReportBtn.textContent = "Rapor Oluştur ve İndir";
        const link = data.result?.download_url || "";
        if (elements.downloadReportBtn && link) {
          elements.downloadReportBtn.href = link;
          elements.downloadReportBtn.hidden = false;
          elements.downloadReportBtn.download = "";
        }
        const cleaned = Number(data?.result?.cleanup?.removed_count || 0);
        if (elements.reportStatusLine && cleaned > 0) {
          elements.reportStatusLine.textContent = `Rapor hazır. Eski çıktılardan ${cleaned} dosya temizlendi.`;
        }
        return;
      }

      if (data.status === "error") {
        stopReportPolling();
        if (elements.generateReportBtn) elements.generateReportBtn.disabled = false;
        if (elements.generateReportBtn) elements.generateReportBtn.textContent = "Rapor Oluştur ve İndir";
        const err = data.error ? `Hata: ${data.error}` : "Rapor oluşturma başarısız.";
        setReportProgress(100, "Hata", err);
      }
    } catch (error) {
      stopReportPolling();
      if (elements.generateReportBtn) elements.generateReportBtn.disabled = false;
      if (elements.generateReportBtn) elements.generateReportBtn.textContent = "Rapor Oluştur ve İndir";
      setReportProgress(100, "Bağlantı Hatası", `Sunucuya ulaşılamadı: ${error.message}`);
    }
  }

  async function startReportGeneration() {
    if (!elements.generateReportBtn) return;
    if (elements.generateReportBtn.disabled) return;
    try {
      const cfg = getConfigStrict();
      if (!state.scenarios.length) throw new Error("Rapor için en az bir senaryo ekleyin.");

      stopReportPolling();
      state.reportJobId = "";
      elements.generateReportBtn.disabled = true;
      elements.generateReportBtn.textContent = "Rapor Oluşturuluyor...";
      if (elements.downloadReportBtn) elements.downloadReportBtn.hidden = true;
      setReportProgress(4, "Başlatılıyor", "Rapor işi sunucuya gönderiliyor...");

      const payload = {
        project_name: (elements.reportProjectName?.value || "").trim() || "Bifacial Otomatik Rapor",
        client_name: (elements.reportClientName?.value || "").trim(),
        prepared_by: (elements.reportAuthor?.value || "Mustafa Ünal").trim(),
        cleanup_previous_outputs: !!elements.reportAutoClean?.checked,
        use_openai: false,
        config: buildReportConfig(cfg),
      };

      const res = await fetch("/api/report/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 501 || res.status === 405 || res.status === 404) {
          throw new Error("Rapor API aktif değil. `python local_server.py --port 8000` ile sunucuyu yeniden başlatın ve `http://127.0.0.1:8000/web/` adresini açın.");
        }
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      if (!data.job_id) throw new Error("job_id alınamadı.");

      state.reportJobId = data.job_id;
      setReportProgress(8, "Kuyruk", data.message || "Rapor kuyruğa alındı.");
      await pollReportStatus(state.reportJobId);
      state.reportPollTimer = window.setInterval(() => {
        pollReportStatus(state.reportJobId);
      }, 1200);
    } catch (error) {
      if (elements.generateReportBtn) {
        elements.generateReportBtn.disabled = false;
        elements.generateReportBtn.textContent = "Rapor Oluştur ve İndir";
      }
      setReportProgress(100, "Hata", `Rapor başlatılamadı: ${error.message}`);
    }
  }

  function wireReportActions() {
    if (!elements.generateReportBtn) return;
    elements.generateReportBtn.addEventListener("click", startReportGeneration);
    if (elements.cleanReportOutputsBtn) {
      elements.cleanReportOutputsBtn.addEventListener("click", async () => {
        try {
          await cleanReportOutputs();
        } catch (error) {
          setReportProgress(100, "Hata", `Temizlik başarısız: ${error.message}`);
        }
      });
    }
  }

  function debounce(fn, waitMs) {
    let timer = 0;
    return (...args) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => fn(...args), waitMs);
    };
  }

  function wireStepNavigation() {
    elements.chips.forEach((chip) => {
      chip.addEventListener("click", () => {
        const step = Number(chip.dataset.step);
        if (Number.isFinite(step)) setStep(step);
      });
    });
    elements.prevStepBtn.addEventListener("click", () => setStep(state.currentStep - 1));
    elements.nextStepBtn.addEventListener("click", () => setStep(state.currentStep + 1));
  }

  function wireScenarioButtons() {
    elements.addScenarioBtn.addEventListener("click", () => {
      state.scenarios.push({ name: `Senaryo ${state.scenarios.length + 1}`, purlin_count: 2, cross_brace: false });
      state.previewScenarioIndex = state.scenarios.length - 1;
      renderScenarioCards();
      renderVisuals();
    });
    elements.resetScenarioBtn.addEventListener("click", () => {
      state.scenarios = clone(defaultScenarios);
      state.previewScenarioIndex = 0;
      renderScenarioCards();
      renderVisuals();
      elements.statusLine.textContent = "Senaryolar sıfırlandı.";
    });
  }

  function wireInputsForVisuals() {
    const inputIds = [
      "panelWidth", "panelHeight", "panelCountX", "panelCountY", "tiltDeg", "groundClearance",
      "frontEnergy", "idealGain", "baseMismatch", "mismatchFactor",
      "pDepth", "pThick", "pOffset", "pMargin",
      "braceThick", "braceSeg", "braceZStart", "braceZEnd",
      "rowPitch", "tableWidth", "sunElevation", "sunAzimuth",
      "pointsX", "pointsY", "raysPerPoint", "seed",
    ];
    inputIds.forEach((id) => $(id).addEventListener("input", renderVisuals));
  }

  function wireActions() {
    elements.runBtn.addEventListener("click", runComparison);
    elements.downloadCsvBtn.addEventListener("click", downloadCsv);
  }

  function initialize() {
    state.scenarios = clone(defaultScenarios);
    state.previewScenarioIndex = 0;
    wireSiteActions();
    wireStepNavigation();
    wireScenarioButtons();
    wireReportActions();
    wireInputsForVisuals();
    wireActions();
    initializeSiteMap();
    renderScenarioCards();
    updateStepUi();
    renderVisuals();
    setReportProgress(0, "Bekliyor", "Henüz rapor oluşturulmadı.");
    openSiteDataModal();
    window.addEventListener("resize", debounce(renderVisuals, 120));
    window.addEventListener("beforeunload", stopReportPolling);
  }

  initialize();
})();
