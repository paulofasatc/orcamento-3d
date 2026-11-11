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
import {
  JOB_FIELDS,
  PRINTER_FIELDS,
  activeFilament,
  addProfile,
  deleteProfile,
  duplicateProfile,
  loadLibrary,
  parseProfilesImport,
  renameProfile,
  resetActiveProfiles,
  saveLibrary,
  serializeProfiles,
  setActive,
  settingsFromLibrary,
  updateProfile,
} from "./profiles.js";
import { parseSliceBuffer, resolveSliceMass } from "./slice.js";
import {
  bandsForSelection,
  getMarketplace,
  selectionFromSettings,
  solveListingPrice,
} from "./fees.js";
import { buildQuoteDocument } from "./pdf.js";
import { StlPreview } from "./preview.js";

const MANUAL_KEY = "orca3d:manual";
const QUOTE_DOC_KEY = "orca3d:quote-doc";

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
  feeMode: document.getElementById("fee-mode"),
  feeCustom: document.getElementById("fee-custom"),
  feeMl: document.getElementById("fee-ml"),
  feeShopee: document.getElementById("fee-shopee"),
  feeSource: document.getElementById("fee-source"),
  feeBands: document.getElementById("fee-bands"),
  feeNotes: document.getElementById("fee-notes"),
  feeNotesList: document.getElementById("fee-notes-list"),
  feeWarning: document.getElementById("fee-warning"),
  feeBreakdown: document.getElementById("fee-breakdown"),
  mlListingType: document.getElementById("ml-listing-type"),
  mlLogistics: document.getElementById("ml-logistics"),
  mlPercent: document.getElementById("ml-percent"),
  mlFixed: document.getElementById("ml-fixed"),
  shopeeProgram: document.getElementById("shopee-program"),
  shopeeFull: document.getElementById("shopee-full"),
  printerSelect: document.getElementById("printer-select"),
  filamentSelect: document.getElementById("filament-select"),
  filamentName: document.getElementById("filament-name"),
  profilesMessage: document.getElementById("profiles-message"),
  nameDialog: document.getElementById("name-dialog"),
  nameTitle: document.getElementById("name-dialog-title"),
  nameInput: document.getElementById("name-dialog-input"),
  confirmDialog: document.getElementById("confirm-dialog"),
  confirmText: document.getElementById("confirm-text"),
  profilesImport: document.getElementById("profiles-import"),
  logoPreview: document.getElementById("logo-preview"),
  logoInput: document.getElementById("logo-input"),
  logoRemove: document.getElementById("logo-remove"),
  bizName: document.getElementById("biz-name"),
  bizContact: document.getElementById("biz-contact"),
  customerName: document.getElementById("customer-name"),
  customerContact: document.getElementById("customer-contact"),
  quoteNumber: document.getElementById("quote-number"),
  quoteDate: document.getElementById("quote-date"),
  quoteValidity: document.getElementById("quote-validity"),
  quoteNotes: document.getElementById("quote-notes"),
  downloadPdf: document.getElementById("download-pdf"),
  pdfMessage: document.getElementById("pdf-message"),
  advancedToggle: document.getElementById("advanced-toggle"),
  advanced: document.getElementById("advanced"),
};

let library = null;
let feeCatalog = null;
let feeCatalogError = "";
let geometry = null;
let stlLabel = "";
let sliceRaw = null;
let sliceLabel = "";
let partTitle = "";
let logoDataUrl = "";
let preview = null;

function persistFromForm() {
  const settings = readFormSettings();
  if (!library) return settings;
  const filamentName = (els.filamentName.value || "").trim() || "Filamento";
  const printerPatch = {};
  for (const key of PRINTER_FIELDS) printerPatch[key] = settings[key];
  library = updateProfile(library, "printers", library.activePrinterId, printerPatch);
  library = updateProfile(library, "filaments", library.activeFilamentId, {
    name: filamentName,
    material: settings.material,
    densityGCm3: settings.densityGCm3,
    filamentPricePerKg: settings.filamentPricePerKg,
  });
  const job = {};
  for (const key of JOB_FIELDS) job[key] = settings[key];
  library = { ...library, job };
  try {
    saveLibrary(localStorage, library);
  } catch {
    setProfileMessage("Não foi possível salvar os perfis neste navegador.", true);
  }
  const option = els.filamentSelect.querySelector(`option[value="${CSS.escape(library.activeFilamentId)}"]`);
  if (option) option.textContent = filamentName;
  return settingsFromLibrary(library);
}

function applyLibraryToForm() {
  const settings = settingsFromLibrary(library);
  populateMaterials(settings.material);
  fillForm(settings);
  els.filamentName.value = activeFilament(library).name;
  refreshProfileSelects();
}

function refreshProfileSelects() {
  els.printerSelect.innerHTML = library.printers
    .map(
      (item) =>
        `<option value="${escapeHtml(item.id)}"${item.id === library.activePrinterId ? " selected" : ""}>${escapeHtml(item.name)}</option>`
    )
    .join("");
  els.filamentSelect.innerHTML = library.filaments
    .map(
      (item) =>
        `<option value="${escapeHtml(item.id)}"${item.id === library.activeFilamentId ? " selected" : ""}>${escapeHtml(item.name)}</option>`
    )
    .join("");
}

function setProfileMessage(text, isError = false) {
  els.profilesMessage.textContent = text || "";
  els.profilesMessage.classList.toggle("is-error", Boolean(isError) && Boolean(text));
}

function askName(title, initial) {
  els.nameTitle.textContent = title;
  els.nameInput.value = initial || "";
  return new Promise((resolve) => {
    const onClose = () => {
      els.nameDialog.removeEventListener("close", onClose);
      resolve(els.nameDialog.returnValue === "ok" ? els.nameInput.value.trim() : "");
    };
    els.nameDialog.addEventListener("close", onClose);
    els.nameDialog.showModal();
  });
}

function askConfirm(text) {
  els.confirmText.textContent = text;
  return new Promise((resolve) => {
    const onClose = () => {
      els.confirmDialog.removeEventListener("close", onClose);
      resolve(els.confirmDialog.returnValue === "ok");
    };
    els.confirmDialog.addEventListener("close", onClose);
    els.confirmDialog.showModal();
  });
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
  settings.feeMode = els.feeMode.value || "custom";
  settings.mlListingType = els.mlListingType.value || "classico";
  settings.mlLogistics = els.mlLogistics.value || "me2";
  settings.mlPercent = els.mlPercent.value;
  settings.mlFixedOverride = els.mlFixed.value;
  settings.shopeeProgram = els.shopeeProgram.value || "cnpj";
  settings.shopeeFull = els.shopeeFull.value || "none";
  return settings;
}

function fillForm(settings) {
  for (const key of SETTING_FIELDS) {
    const input = els.form.elements.namedItem(key);
    if (!input) continue;
    input.value = settings[key];
  }
  els.feeMode.value = settings.feeMode || "custom";
  els.mlListingType.value = settings.mlListingType || "classico";
  els.mlLogistics.value = settings.mlLogistics || "me2";
  els.mlPercent.value = settings.mlPercent ?? "";
  els.mlFixed.value = settings.mlFixedOverride ?? "";
  els.shopeeProgram.value = settings.shopeeProgram || "cnpj";
  els.shopeeFull.value = settings.shopeeFull || "none";
  syncFeePanels();
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
  if (els.feeBreakdown) els.feeBreakdown.hidden = true;
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
  const settings = persistFromForm();
  syncFeePanels();
  const sliceView = currentSliceView();
  renderSliceBanner(sliceView);
  const measured = combineUsageSources(readManual(), measuredFromSlice(sliceView));

  if (!geometry && !measured) {
    renderEmpty();
    paintFeePanel(settings, null);
    return;
  }

  const quoteSettings =
    settings.feeMode && settings.feeMode !== "custom"
      ? { ...settings, marketplaceFeePercent: 0 }
      : settings;
  const quote = calculateQuote(geometry, quoteSettings, measured);
  const feeResult = priceWithFeeTable(quote.suggestedPrice, settings);
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
  if (feeResult?.ok) {
    setText("price-listing", moneyFmt.format(feeResult.listingPrice));
    setText("price-net", moneyFmt.format(feeResult.net));
  } else if (feeResult && !feeResult.ok) {
    setText("price-listing", "—");
    setText("price-net", "—");
  } else {
    setText("price-listing", moneyFmt.format(quote.listingPrice));
    setText("price-net", moneyFmt.format(quote.netAfterFee));
  }

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
  if (feeResult?.ok) {
    setText("listing-label", `Preço de anúncio (${feeResult.marketplaceName})`);
    els.feeBreakdown.hidden = false;
    els.feeBreakdown.textContent = `Comissão ${moneyFmt.format(feeResult.percentFee)} (${numberFmt.format(feeResult.percent)}%) + fixo ${moneyFmt.format(feeResult.fixedFee)}. ${feeResult.bandLabel}.`;
  } else if (settings.feeMode === "none") {
    setText("listing-label", "Preço de anúncio (sem taxa)");
    els.feeBreakdown.hidden = true;
  } else if (feeResult && !feeResult.ok) {
    setText("listing-label", "Preço de anúncio");
    els.feeBreakdown.hidden = true;
  } else {
    setText(
      "listing-label",
      fee > 0 ? `Preço de anúncio (taxa de ${numberFmt.format(fee)}%)` : "Preço de anúncio (sem taxa)"
    );
    els.feeBreakdown.hidden = true;
  }
  paintFeePanel(settings, feeResult);
}

function syncFeePanels() {
  const mode = els.feeMode.value || "custom";
  els.feeCustom.hidden = mode !== "custom";
  els.feeMl.hidden = mode !== "mercado-livre";
  els.feeShopee.hidden = mode !== "shopee";
}

function priceWithFeeTable(target, settings) {
  const selection = selectionFromSettings(settings);
  if (!selection) return null;
  if (!feeCatalog) {
    return {
      ok: false,
      marketplaceName: "",
      message: feeCatalogError || "A tabela de taxas ainda não carregou.",
      warnings: [],
    };
  }
  return solveListingPrice(target, selection, feeCatalog);
}

function formatIsoDate(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  return match ? `${match[3]}/${match[2]}/${match[1]}` : "";
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function paintFeePanel(settings, solved) {
  const mode = settings.feeMode || "custom";
  const wantsTable = mode === "mercado-livre" || mode === "shopee";
  if (wantsTable && !feeCatalog) {
    els.feeBands.innerHTML = "";
    els.feeNotes.hidden = true;
    els.feeSource.textContent = feeCatalogError || "A tabela de taxas ainda não carregou.";
    els.feeWarning.hidden = false;
    els.feeWarning.textContent = els.feeSource.textContent;
    return;
  }
  const market = wantsTable ? getMarketplace(feeCatalog, mode) : null;
  if (!market) {
    els.feeBands.innerHTML = "";
    els.feeNotes.hidden = true;
    els.feeNotesList.innerHTML = "";
    els.feeWarning.hidden = true;
    els.feeSource.textContent =
      mode === "none"
        ? "Sem comissão de marketplace. O preço de anúncio fica igual ao preço sugerido."
        : "Percentual único, para quando você já sabe a taxa da sua conta.";
    return;
  }
  if (!feeCatalog) {
    els.feeSource.textContent = feeCatalogError || "Não foi possível carregar a tabela de taxas.";
    els.feeBands.innerHTML = "";
    els.feeWarning.hidden = false;
    els.feeWarning.textContent = els.feeSource.textContent;
    return;
  }
  const consulted = formatIsoDate(feeCatalog.consultedAt);
  const links = [`<a href="${market.sourceUrl}" target="_blank" rel="noopener noreferrer">${escapeHtml(market.name)}</a>`];
  if (market.secondarySourceUrl) {
    links.push(
      `<a href="${market.secondarySourceUrl}" target="_blank" rel="noopener noreferrer">fonte complementar</a>`
    );
  }
  els.feeSource.innerHTML = `Fonte: ${links.join(" · ")}. ${escapeHtml(market.updatedAtLabel || "")}${consulted ? ` Consultado em ${consulted}.` : ""}`;
  const bands = bandsForSelection(market, selectionFromSettings(settings));
  els.feeBands.innerHTML = bands
    .map((band) => `<li>${escapeHtml(band.label)}${band.confirmed === false ? " — valor não confirmado" : ""}</li>`)
    .join("");
  els.feeNotes.hidden = !(market.notes || []).length;
  els.feeNotesList.innerHTML = (market.notes || []).map((note) => `<li>${escapeHtml(note)}</li>`).join("");
  const warnings = [];
  if (solved && !solved.ok && solved.message) warnings.push(solved.message);
  if (solved?.warnings?.length) warnings.push(...solved.warnings);
  if (!solved?.ok && solved?.confirmed === false) {
    // já coberto pela mensagem
  }
  els.feeWarning.hidden = warnings.length === 0;
  els.feeWarning.textContent = warnings.join(" ");
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
    if (!partTitle) partTitle = name.replace(/\.(gcode\.3mf|3mf|gcode)$/i, "");
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
    partTitle = name.replace(/\.stl$/i, "");
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
    partTitle = "";
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

async function loadFeeCatalog() {
  try {
    const response = await fetch(new URL("../data/fees.json", import.meta.url));
    if (!response.ok) throw new Error("falha");
    feeCatalog = await response.json();
    feeCatalogError = "";
  } catch {
    feeCatalog = null;
    feeCatalogError = "Não foi possível carregar a tabela de taxas. Use o percentual único por enquanto.";
  }
}

async function init() {
  library = loadLibrary(localStorage);
  applyLibraryToForm();

  els.material.addEventListener("change", () => {
    const mat = getMaterial(els.material.value);
    els.density.value = String(mat.densityGCm3);
    render();
  });

  els.form.addEventListener("input", () => render());
  els.form.addEventListener("change", () => render());

  els.reset.addEventListener("click", () => {
    library = resetActiveProfiles(library);
    applyLibraryToForm();
    setProfileMessage("Os perfis ativos voltaram aos valores padrão.", false);
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
  bindProfiles();
  bindQuoteDocument();
  await loadFeeCatalog();
  render();
}

function todayIso() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function setPdfMessage(text, isError = false) {
  els.pdfMessage.textContent = text || "";
  els.pdfMessage.classList.toggle("is-error", Boolean(isError) && Boolean(text));
}

function readQuoteDoc() {
  const days = Math.round(Number(els.quoteValidity.value));
  return {
    businessName: els.bizName.value.trim(),
    businessContact: els.bizContact.value.trim(),
    customerName: els.customerName.value.trim(),
    customerContact: els.customerContact.value.trim(),
    quoteNumber: els.quoteNumber.value.trim(),
    quoteDate: els.quoteDate.value || todayIso(),
    validityDays: Number.isFinite(days) ? Math.min(365, Math.max(1, days)) : 7,
    notes: els.quoteNotes.value.trim(),
  };
}

function saveQuoteDoc() {
  try {
    localStorage.setItem(QUOTE_DOC_KEY, JSON.stringify({ ...readQuoteDoc(), logoDataUrl }));
  } catch {
    setPdfMessage("Não foi possível guardar os dados do PDF neste navegador. A logo pode ser grande demais.", true);
  }
}

function loadQuoteDoc() {
  const today = todayIso();
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(QUOTE_DOC_KEY) || "{}") || {};
  } catch {
    saved = {};
  }
  els.bizName.value = saved.businessName || "";
  els.bizContact.value = saved.businessContact || "";
  els.customerName.value = saved.customerName || "";
  els.customerContact.value = saved.customerContact || "";
  els.quoteDate.value = saved.quoteDate || today;
  els.quoteNumber.value = saved.quoteNumber || `ORC-${(saved.quoteDate || today).replace(/-/g, "")}-01`;
  els.quoteValidity.value = String(saved.validityDays || 7);
  els.quoteNotes.value = saved.notes || "";
  logoDataUrl = typeof saved.logoDataUrl === "string" && saved.logoDataUrl.startsWith("data:image/") ? saved.logoDataUrl : "";
  paintLogo();
}

function paintLogo() {
  const hasLogo = Boolean(logoDataUrl);
  els.logoPreview.hidden = !hasLogo;
  els.logoPreview.src = hasLogo ? logoDataUrl : "";
  els.logoRemove.hidden = !hasLogo;
}

function fileToLogo(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error("Escolha uma imagem."));
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      reject(new Error("A logo precisa ter no máximo 2 MB."));
      return;
    }
    if (!/^image\/(png|jpeg|webp)$/.test(file.type) && !/\.(png|jpe?g|webp)$/i.test(file.name)) {
      reject(new Error("Use uma imagem PNG, JPEG ou WebP."));
      return;
    }
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      const scale = Math.min(1, 480 / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
      if (dataUrl.length > 500_000) {
        reject(new Error("A logo ficou grande demais para salvar no navegador. Tente uma imagem menor."));
        return;
      }
      resolve(dataUrl);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Não foi possível ler essa imagem."));
    };
    image.src = url;
  });
}

function currentQuoteSnapshot() {
  const settings = persistFromForm();
  const measured = combineUsageSources(readManual(), measuredFromSlice(currentSliceView()));
  if (!geometry && !measured) return null;
  const quoteSettings =
    settings.feeMode && settings.feeMode !== "custom" ? { ...settings, marketplaceFeePercent: 0 } : settings;
  return calculateQuote(geometry, quoteSettings, measured);
}

function itemDescription() {
  if (partTitle) return partTitle;
  const fromSlice = sliceLabel.split(" · ")[0]?.replace(/\.(gcode\.3mf|3mf|gcode)$/i, "");
  return fromSlice || "Peça impressa em 3D";
}

async function loadJsPDF() {
  if (globalThis.jspdf?.jsPDF) return globalThis.jspdf.jsPDF;
  await new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = new URL("../vendor/jspdf.umd.min.js", import.meta.url).href;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Não foi possível carregar o gerador de PDF."));
    document.head.appendChild(script);
  });
  if (!globalThis.jspdf?.jsPDF) throw new Error("O gerador de PDF não iniciou.");
  return globalThis.jspdf.jsPDF;
}

function bindQuoteDocument() {
  loadQuoteDoc();
  const fields = [els.bizName, els.bizContact, els.customerName, els.customerContact, els.quoteNumber, els.quoteDate, els.quoteValidity, els.quoteNotes];
  for (const field of fields) field.addEventListener("input", () => saveQuoteDoc());
  els.logoInput.addEventListener("change", async () => {
    const file = els.logoInput.files?.[0];
    els.logoInput.value = "";
    if (!file) return;
    try {
      logoDataUrl = await fileToLogo(file);
      paintLogo();
      saveQuoteDoc();
      setPdfMessage("Logo pronta para o PDF.", false);
    } catch (err) {
      setPdfMessage(err.message || "Não foi possível usar essa logo.", true);
    }
  });
  els.logoRemove.addEventListener("click", () => {
    logoDataUrl = "";
    paintLogo();
    saveQuoteDoc();
  });
  els.downloadPdf.addEventListener("click", async () => {
    const quote = currentQuoteSnapshot();
    if (!quote) {
      setPdfMessage("Informe um STL, um arquivo fatiado ou o peso e o tempo antes de gerar o PDF.", true);
      return;
    }
    const details = readQuoteDoc();
    try {
      const JsPDF = await loadJsPDF();
      const doc = buildQuoteDocument(JsPDF, {
        ...details,
        logoDataUrl,
        items: [{ description: itemDescription(), quantity: 1, unitPrice: quote.suggestedPrice }],
      });
      const fileName = `${(details.quoteNumber || "orcamento").replace(/[^\w.-]+/g, "-")}.pdf`;
      doc.save(fileName);
      setPdfMessage("PDF gerado com o preço sugerido, sem o custo interno.", false);
    } catch (err) {
      setPdfMessage(err?.message || "Não foi possível gerar o PDF.", true);
    }
  });
}

function bindProfiles() {
  const switchProfile = (kind, select) => {
    persistFromForm();
    library = setActive(library, kind, select.value);
    applyLibraryToForm();
    setProfileMessage("", false);
    render();
  };
  els.printerSelect.addEventListener("change", () => switchProfile("printers", els.printerSelect));
  els.filamentSelect.addEventListener("change", () => switchProfile("filaments", els.filamentSelect));

  document.getElementById("printer-new").addEventListener("click", () => createProfile("printers", "Nova impressora"));
  document.getElementById("filament-new").addEventListener("click", () => createProfile("filaments", "Novo filamento"));
  document.getElementById("printer-duplicate").addEventListener("click", () => copyProfile("printers"));
  document.getElementById("filament-duplicate").addEventListener("click", () => copyProfile("filaments"));
  document.getElementById("printer-rename").addEventListener("click", () => renameActive("printers", "Nome da impressora"));
  document.getElementById("filament-rename").addEventListener("click", () => renameActive("filaments", "Nome do filamento"));
  document.getElementById("printer-delete").addEventListener("click", () => removeProfile("printers"));
  document.getElementById("filament-delete").addEventListener("click", () => removeProfile("filaments"));
  document.getElementById("profiles-export").addEventListener("click", exportProfiles);
  els.profilesImport.addEventListener("change", () => {
    const file = els.profilesImport.files?.[0];
    els.profilesImport.value = "";
    if (file) importProfiles(file);
  });
}

function createProfile(kind, name) {
  persistFromForm();
  library = addProfile(library, kind, { name });
  applyLibraryToForm();
  setProfileMessage(kind === "printers" ? "Impressora criada." : "Filamento criado.", false);
  render();
}

function copyProfile(kind) {
  persistFromForm();
  const id = kind === "printers" ? library.activePrinterId : library.activeFilamentId;
  library = duplicateProfile(library, kind, id);
  applyLibraryToForm();
  setProfileMessage("Perfil duplicado.", false);
  render();
}

async function renameActive(kind, title) {
  const id = kind === "printers" ? library.activePrinterId : library.activeFilamentId;
  const current = library[kind].find((item) => item.id === id);
  const name = await askName(title, current?.name || "");
  if (!name) return;
  try {
    library = renameProfile(library, kind, id, name);
  } catch (err) {
    setProfileMessage(err.message, true);
    return;
  }
  if (kind === "filaments") els.filamentName.value = name;
  applyLibraryToForm();
  setProfileMessage("Nome atualizado.", false);
  render();
}

function removeProfile(kind) {
  const id = kind === "printers" ? library.activePrinterId : library.activeFilamentId;
  try {
    library = deleteProfile(library, kind, id);
  } catch (err) {
    setProfileMessage(err.message, true);
    return;
  }
  applyLibraryToForm();
  setProfileMessage("Perfil excluído.", false);
  render();
}

function exportProfiles() {
  persistFromForm();
  const blob = new Blob([serializeProfiles(library)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "orca3d-perfis.json";
  link.click();
  URL.revokeObjectURL(link.href);
  setProfileMessage("Arquivo de perfis gerado.", false);
}

async function importProfiles(file) {
  try {
    const text = await file.text();
    if (text.length > 1_000_000) {
      setProfileMessage("O arquivo é grande demais (máximo de 1 MB).", true);
      return;
    }
    const next = parseProfilesImport(text);
    const ok = await askConfirm(
      "Isso substitui as impressoras, os filamentos e os ajustes salvos neste navegador. Os arquivos STL deste orçamento não são alterados."
    );
    if (!ok) return;
    library = next;
    applyLibraryToForm();
    setProfileMessage(`Perfis importados: ${next.printers.length} impressora(s) e ${next.filaments.length} filamento(s).`, false);
    render();
  } catch (err) {
    setProfileMessage(err?.message || "Não foi possível importar os perfis.", true);
  }
}

init();
