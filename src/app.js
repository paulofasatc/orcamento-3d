import { parseStl } from "./stl.js";
import {
  MATERIALS,
  DEFAULT_SETTINGS,
  getMaterial,
  calculateQuote,
} from "./quote.js";
import { StlPreview } from "./preview.js";

const STORAGE_KEY = "orca3d:settings";

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
  material: document.getElementById("material"),
  density: document.getElementById("densityGCm3"),
  reset: document.getElementById("reset-settings"),
  advancedToggle: document.getElementById("advanced-toggle"),
  advanced: document.getElementById("advanced"),
};

let geometry = null;
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

function renderEmpty() {
  document.getElementById("results").classList.add("is-empty");
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
  setText("out-material-detail", "Envie um STL para ver o orçamento.");
}

function render() {
  if (!geometry) {
    renderEmpty();
    return;
  }

  const settings = readFormSettings();
  saveSettings(settings);
  const quote = calculateQuote(geometry, settings);
  const box = geometry.boundingBox.size;

  document.getElementById("results").classList.remove("is-empty");
  setText("stat-volume", `${numberFmt.format(geometry.volumeMm3)} mm³`);
  setText(
    "stat-size",
    `${numberFmt1.format(box.x)} × ${numberFmt1.format(box.y)} × ${numberFmt1.format(box.z)} mm`
  );
  setText("stat-area", `${numberFmt.format(geometry.surfaceAreaMm2)} mm²`);
  setText("stat-triangles", numberFmt0.format(geometry.triangleCount));

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
  setText(
    "out-material-detail",
    `Casca ${numberFmt.format(mat.shellVolumeMm3)} mm³ · preenchimento ${numberFmt.format(mat.infillVolumeMm3)} mm³ · total ${numberFmt.format(mat.materialVolumeMm3)} mm³ de filamento (estimativa).`
  );

  const fee = settings.marketplaceFeePercent;
  setText(
    "listing-label",
    fee > 0
      ? `Preço de anúncio (taxa de ${numberFmt.format(fee)}%)`
      : "Preço de anúncio (sem taxa)"
  );
}

async function loadFile(file) {
  showError("");
  if (!file) return;
  const name = file.name || "modelo.stl";
  if (!/\.stl$/i.test(name) && file.type && !/stl|model/i.test(file.type)) {
    showError("Envie um arquivo no formato STL (.stl).");
    return;
  }

  try {
    const buffer = await file.arrayBuffer();
    geometry = parseStl(buffer, name);
    els.fileName.textContent = `${name} · ${formatFileSize(file.size)} · ${geometry.format === "binary" ? "binário" : "ASCII"}`;
    els.previewEmpty.hidden = true;
    if (!preview) {
      preview = new StlPreview(els.preview);
    }
    preview.load(geometry.triangles, geometry.boundingBox.size, geometry.boundingBox.min);
    render();
  } catch (err) {
    geometry = null;
    els.fileName.textContent = "";
    els.previewEmpty.hidden = false;
    preview?.clear();
    renderEmpty();
    showError(err?.message || "Não foi possível ler este STL.");
  }
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
    const file = e.dataTransfer?.files?.[0];
    if (file) loadFile(file);
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
    const file = els.file.files?.[0];
    if (file) loadFile(file);
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

  initDropzone();
  renderEmpty();
}

init();
