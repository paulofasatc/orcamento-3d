import { parseStl } from "./stl.js";
import {
  MATERIALS,
  DEFAULT_SETTINGS,
  getMaterial,
  calculateQuote,
  combineUsageSources,
  explicitNumber,
  manualTimeSeconds,
} from "./quote.js";
import { parseSliceBuffer, resolveSliceMass } from "./slice.js";
import { StlPreview } from "./preview.js";

const STORAGE_KEY = "orca3d:settings";
const MANUAL_KEY = "orca3d:manual";

const SETTING_FIELDS = [
  "material",
  "densityGCm3",
  "infillPercent",
  "perimeters",
  "lineWidthMm",
  "layerHeightMm",
  "filamentPricePerKg",
  "printerPowerW",
  "energyPricePerKwh",
  "machineDepreciationPerHour",
  "laborSetupFee",
  "failureMarginPercent",
  "profitMarginPercent",
  "marketplaceFeePercent",
  "throughputMm3PerS",
  "referenceLayerHeightMm",
  "setupTimeMin",
];

const numberFmt = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
const numberFmt1 = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const numberFmt0 = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const moneyFmt = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const els = {
  form: document.getElementById("settings-form"),
  drop: document.getElementById("dropzone"),
  file: document.getElementById("file-input"),
  fileName: document.getElementById("file-name"),
  preview: document.getElementById("preview"),
  previewEmpty: document.getElementById("preview-empty"),
  error: document.getElementById("error"),
  sliceInfo: document.getElementById("slice-info"),
  sliceSummary: document.getElementById("slice-summary"),
  sliceWarnings: document.getElementById("slice-warnings"),
  sliceClear: document.getElementById("slice-clear"),
  manualMass: document.getElementById("manual-mass"),
  manualHours: document.getElementById("manual-hours"),
  manualMinutes: document.getElementById("manual-minutes"),
  manualClear: document.getElementById("manual-clear"),
  usageSource: document.getElementById("usage-source"),
  material: document.getElementById("material"),
  density: document.getElementById("densityGCm3"),
  reset: document.getElementById("reset-settings"),
  advancedToggle: document.getElementById("advanced-toggle"),
  advanced: document.getElementById("advanced"),
};

let geometry = null;
let stlLabel = "";
let sliceRaw = null;
let sliceLabel = "";
let preview = null;

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const saved = JSON.parse(raw);
    return { ...DEFAULT_SETTINGS, ...saved };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // storage cheio ou bloqueado — a ferramenta continua funcionando
  }
}

function readFormSettings() {
  const data = new FormData(els.form);
  const settings = { ...DEFAULT_SETTINGS };
  for (const key of SETTING_FIELDS) {
    const raw = data.get(key);
    if (raw == null || raw === "") continue;
    if (key === "material") {
      settings.material = String(raw);
    } else {
      const n = Number(String(raw).replace(",", "."));
      if (Number.isFinite(n)) settings[key] = n;
    }
  }
  const mat = getMaterial(settings.material);
  // Se o usuário escolheu um material padrão e não editou a densidade à parte,
  // usamos a densidade do material. Densidade fica editável.
  if (MATERIALS.some((m) => m.id === settings.material)) {
    // keep density from form if present
    if (!data.get("densityGCm3")) settings.densityGCm3 = mat.densityGCm3;
  }
  return settings;
}

function fillForm(settings) {
  for (const key of SETTING_FIELDS) {
    const input = els.form.elements.namedItem(key);
    if (!input) continue;
    input.value = settings[key];
  }
}

function populateMaterials(selected) {
  els.material.innerHTML = MATERIALS.map(
    (m) =>
      `<option value="${m.id}" ${m.id === selected ? "selected" : ""}>${m.name} (${numberFmt.format(m.densityGCm3)} g/cm³)</option>`
  ).join("");
}

function showError(message) {
  if (!message) {
    els.error.hidden = true;
    els.error.textContent = "";
    return;
  }
  els.error.hidden = false;
  els.error.textContent = message;
}

function formatMm(n) {
  return `${numberFmt.format(n)} mm`;
}

function formatTime(seconds) {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) {
    return m > 0 ? `${h} h ${m} min` : `${h} h`;
  }
  if (m > 0) {
    return sec > 0 && m < 5 ? `${m} min ${sec} s` : `${m} min`;
  }
  return `${sec} s`;
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function currentSliceView() {
  if (!sliceRaw) return null;
  const settings = readFormSettings();
  const resolved = resolveSliceMass(sliceRaw, { densityGCm3: settings.densityGCm3 });
  return {
    ...sliceRaw,
    massGrams: resolved.massGrams,
    massSource: resolved.massSource,
    warnings: [...(sliceRaw.baseWarnings || []), ...resolved.warnings],
    usedDensityGCm3: resolved.usedDensityGCm3,
    usedDiameterMm: resolved.usedDiameterMm,
  };
}

function readManual() {
  return {
    massGrams: explicitNumber(els.manualMass.value),
    printTimeSeconds: manualTimeSeconds(els.manualHours.value, els.manualMinutes.value),
  };
}

function saveManual() {
  try {
    localStorage.setItem(
      MANUAL_KEY,
      JSON.stringify({
        mass: els.manualMass.value,
        hours: els.manualHours.value,
        minutes: els.manualMinutes.value,
      })
    );
  } catch {
    // o orçamento segue na memória
  }
}

function loadManual() {
  try {
    const raw = localStorage.getItem(MANUAL_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (saved.mass != null) els.manualMass.value = String(saved.mass);
    if (saved.hours != null) els.manualHours.value = String(saved.hours);
    if (saved.minutes != null) els.manualMinutes.value = String(saved.minutes);
  } catch {
    // valor antigo ilegível
  }
}

function measuredFromSlice(view) {
  if (!view) return null;
  const measured = {};
  if (view.massGrams != null) measured.massGrams = view.massGrams;
  if (view.printTimeSeconds != null) measured.printTimeSeconds = view.printTimeSeconds;
  return measured.massGrams != null || measured.printTimeSeconds != null ? measured : null;
}

function renderSliceBanner(view) {
  if (!view) {
    els.sliceInfo.hidden = true;
    els.sliceSummary.textContent = "";
    els.sliceWarnings.hidden = true;
    return;
  }
  const version = view.slicer?.version ? ` ${view.slicer.version}` : "";
  const plates = view.plateCount > 1 ? ` · ${view.plateCount} placas` : "";
  const mass =
    view.massGrams != null ? `${numberFmt.format(view.massGrams)} g` : "peso não encontrado";
  const time = view.printTimeSeconds != null ? formatTime(view.printTimeSeconds) : "tempo não encontrado";
  let how = "";
  if (view.massSource === "length") {
    how = ` Peso convertido do comprimento (${numberFmt.format(view.usedDiameterMm)} mm, ${numberFmt.format(view.usedDensityGCm3)} g/cm³).`;
  } else if (view.massSource === "volume") {
    how = ` Peso convertido do volume (${numberFmt.format(view.usedDensityGCm3)} g/cm³).`;
  }
  const replaces =
    view.massGrams != null && view.printTimeSeconds != null
      ? "Eles substituem a estimativa do STL."
      : "O que foi encontrado substitui a estimativa correspondente.";
  els.sliceInfo.hidden = false;
  els.sliceSummary.textContent = `${view.slicer?.name || "Fatiador"}${version}${plates}: ${mass} · ${time}.${how} ${replaces}`;
  const warnings = (view.warnings || []).filter(Boolean);
  els.sliceWarnings.hidden = warnings.length === 0;
  els.sliceWarnings.textContent = warnings.join(" ");
}

function renderEmpty() {
  document.getElementById("results").classList.add("is-empty");
  setText("mass-label", "Peso estimado");
  setText("time-label", "Tempo estimado");
  els.usageSource.hidden = true;
  setText("stat-volume", "—");
  setText("stat-size", "—");
  setText("stat-area", "—");
  setText("stat-triangles", "—");
  setText("out-mass", "—");
  setText("out-time", "—");
  setText("cost-filament", "—");
  setText("cost-energy", "—");
  setText("cost-machine", "—");
  setText("cost-labor", "—");
  setText("cost-failure", "—");
  setText("cost-total", "—");
  setText("price-suggested", "—");
  setText("price-listing", "—");
  setText("price-net", "—");
  setText("out-material-detail", "Envie um STL ou um arquivo fatiado para ver o orçamento.");
}

function render() {
  const settings = readFormSettings();
  saveSettings(settings);
  const sliceView = currentSliceView();
  renderSliceBanner(sliceView);
  const measured = combineUsageSources(readManual(), measuredFromSlice(sliceView));

  if (!geometry && !measured) {
    renderEmpty();
    return;
  }

  const quote = calculateQuote(geometry, settings, measured);
  const box = geometry?.boundingBox?.size;

  document.getElementById("results").classList.remove("is-empty");
  if (geometry && box) {
    setText("stat-volume", `${numberFmt.format(geometry.volumeMm3)} mm³`);
    setText(
      "stat-size",
      `${numberFmt1.format(box.x)} × ${numberFmt1.format(box.y)} × ${numberFmt1.format(box.z)} mm`
    );
    setText("stat-area", `${numberFmt.format(geometry.surfaceAreaMm2)} mm²`);
    setText("stat-triangles", numberFmt0.format(geometry.triangleCount));
  } else {
    setText("stat-volume", "—");
    setText("stat-size", "—");
    setText("stat-area", "—");
    setText("stat-triangles", "—");
  }

  const massLabels = { slicer: "Peso do fatiador", manual: "Peso informado", estimate: "Peso estimado" };
  const timeLabels = { slicer: "Tempo do fatiador", manual: "Tempo informado", estimate: "Tempo estimado" };
  setText("mass-label", massLabels[quote.massSource] || "Peso");
  setText("time-label", timeLabels[quote.timeSource] || "Tempo");
  els.usageSource.hidden = false;
  els.usageSource.textContent = describeUsage(quote, sliceView);

  setText("out-mass", `${numberFmt.format(quote.massGrams)} g`);
  setText("out-time", formatTime(quote.printTimeSeconds));
  setText("cost-filament", moneyFmt.format(quote.costs.filament));
  setText("cost-energy", moneyFmt.format(quote.costs.energy));
  setText("cost-machine", moneyFmt.format(quote.costs.machine));
  setText("cost-labor", moneyFmt.format(quote.costs.labor));
  setText("cost-failure", moneyFmt.format(quote.costs.failure));
  setText("cost-total", moneyFmt.format(quote.costTotal));
  setText("price-suggested", moneyFmt.format(quote.suggestedPrice));
  setText("price-listing", moneyFmt.format(quote.listingPrice));
  setText("price-net", moneyFmt.format(quote.netAfterFee));

  const mat = quote.material;
  if (!geometry) {
    setText("out-material-detail", "Sem STL: o orçamento usa o peso e o tempo informados.");
  } else if (quote.massSource === "estimate" && quote.timeSource === "estimate") {
    setText(
      "out-material-detail",
      `Casca ${numberFmt.format(mat.shellVolumeMm3)} mm³ · preenchimento ${numberFmt.format(mat.infillVolumeMm3)} mm³ · total ${numberFmt.format(mat.materialVolumeMm3)} mm³ de filamento (estimativa).`
    );
  } else {
    const origin =
      quote.massSource === "manual" || quote.timeSource === "manual" ? "o valor manual" : "o arquivo fatiado";
    setText(
      "out-material-detail",
      `A estimativa do STL seria ${numberFmt.format(quote.estimatedMassGrams)} g e ${formatTime(quote.estimatedPrintTimeSeconds)}. O cálculo usa ${origin}.`
    );
  }

  const fee = settings.marketplaceFeePercent;
  setText(
    "listing-label",
    fee > 0
      ? `Preço de anúncio (taxa de ${numberFmt.format(fee)}%)`
      : "Preço de anúncio (sem taxa)"
  );
}

function describeUsage(quote, sliceView) {
  const slicerName = sliceView?.slicer?.name || "o fatiador";
  const part = (source, kind) => {
    if (source === "manual") return `${kind} informado manualmente`;
    if (source === "slicer") return `${kind} de ${slicerName}`;
    if (source === "estimate") return `${kind} estimado pelo STL`;
    return "";
  };
  return [part(quote.massSource, "Peso"), part(quote.timeSource, "Tempo")].filter(Boolean).join(". ") + ".";
}

function refreshFileLabel() {
  const parts = [stlLabel, sliceLabel].filter(Boolean);
  els.fileName.textContent = parts.join(" · ") || "Nenhum arquivo selecionado";
}

async function loadSliceFile(file) {
  showError("");
  const name = file.name || "fatiado.gcode";
  try {
    const buffer = await file.arrayBuffer();
    const settings = readFormSettings();
    sliceRaw = parseSliceBuffer(buffer, name, { densityGCm3: settings.densityGCm3 });
    sliceLabel = `${name} · ${formatFileSize(file.size)}`;
    refreshFileLabel();
    render();
  } catch (err) {
    showError(err?.message || "Não foi possível ler este arquivo fatiado.");
  }
}

async function loadStlFile(file) {
  showError("");
  const name = file.name || "modelo.stl";
  if (!/\.stl$/i.test(name) && file.type && !/stl|model/i.test(file.type)) {
    showError("Envie um STL (.stl), um G-code (.gcode) ou um 3MF fatiado (.3mf).");
    return;
  }

  try {
    const buffer = await file.arrayBuffer();
    geometry = parseStl(buffer, name);
    stlLabel = `${name} · ${formatFileSize(file.size)} · ${geometry.format === "binary" ? "binário" : "ASCII"}`;
    refreshFileLabel();
    els.previewEmpty.hidden = true;
    if (!preview) {
      preview = new StlPreview(els.preview);
    }
    preview.load(geometry.triangles, geometry.boundingBox.size, geometry.boundingBox.min);
    render();
  } catch (err) {
    geometry = null;
    stlLabel = "";
    refreshFileLabel();
    els.previewEmpty.hidden = false;
    preview?.clear();
    render();
    showError(err?.message || "Não foi possível ler este STL.");
  }
}

async function loadFile(file) {
  if (!file) return;
  const name = file.name || "";
  if (/\.(gcode|3mf)$/i.test(name)) {
    await loadSliceFile(file);
    return;
  }
  await loadStlFile(file);
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${numberFmt1.format(bytes / 1024)} KB`;
  return `${numberFmt1.format(bytes / (1024 * 1024))} MB`;
}

function initDropzone() {
  const zone = els.drop;
  const prevent = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  ["dragenter", "dragover"].forEach((type) => {
    zone.addEventListener(type, (e) => {
      prevent(e);
      zone.classList.add("is-dragover");
    });
  });
  ["dragleave", "drop"].forEach((type) => {
    zone.addEventListener(type, (e) => {
      prevent(e);
      zone.classList.remove("is-dragover");
    });
  });
  zone.addEventListener("drop", (e) => {
    const files = [...(e.dataTransfer?.files || [])];
    for (const file of files) loadFile(file);
  });
  zone.addEventListener("click", (e) => {
    if (e.target.closest("button, input, label")) return;
    els.file.click();
  });
  zone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      els.file.click();
    }
  });
  els.file.addEventListener("change", () => {
    const files = [...(els.file.files || [])];
    for (const file of files) loadFile(file);
    els.file.value = "";
  });
}

function init() {
  const settings = loadSettings();
  populateMaterials(settings.material);
  fillForm(settings);

  els.material.addEventListener("change", () => {
    const mat = getMaterial(els.material.value);
    els.density.value = String(mat.densityGCm3);
    render();
  });

  els.form.addEventListener("input", () => render());
  els.form.addEventListener("change", () => render());

  els.reset.addEventListener("click", () => {
    fillForm(DEFAULT_SETTINGS);
    populateMaterials(DEFAULT_SETTINGS.material);
    els.density.value = String(DEFAULT_SETTINGS.densityGCm3);
    saveSettings(DEFAULT_SETTINGS);
    render();
  });

  els.advancedToggle.addEventListener("click", () => {
    const open = els.advanced.hasAttribute("hidden") || els.advanced.hidden;
    els.advanced.hidden = !open;
    els.advancedToggle.setAttribute("aria-expanded", String(open));
    els.advancedToggle.textContent = open ? "Ocultar ajustes avançados" : "Ajustes avançados";
  });

  els.sliceClear.addEventListener("click", () => {
    sliceRaw = null;
    sliceLabel = "";
    refreshFileLabel();
    render();
  });

  loadManual();
  const onManual = () => {
    saveManual();
    render();
  };
  els.manualMass.addEventListener("input", onManual);
  els.manualHours.addEventListener("input", onManual);
  els.manualMinutes.addEventListener("input", onManual);
  els.manualClear.addEventListener("click", () => {
    els.manualMass.value = "";
    els.manualHours.value = "";
    els.manualMinutes.value = "";
    saveManual();
    render();
  });

  initDropzone();
  render();
}

init();
