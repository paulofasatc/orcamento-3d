/**
 * Perfis nomeados de impressora e de filamento, com migração do
 * objeto único antigo (orca3d:settings) e importação/exportação JSON.
 */
import { DEFAULT_SETTINGS, MATERIALS } from "./quote.js";
import { FEE_DEFAULTS } from "./fees.js";

export const LIBRARY_KEY = "orca3d:library";
export const LEGACY_SETTINGS_KEY = "orca3d:settings";
export const PROFILE_EXPORT_VERSION = 1;

export const PRINTER_FIELDS = [
  "printerPowerW",
  "energyPricePerKwh",
  "machineDepreciationPerHour",
  "lineWidthMm",
  "throughputMm3PerS",
  "referenceLayerHeightMm",
  "setupTimeMin",
];

export const JOB_FIELDS = [
  "infillPercent",
  "perimeters",
  "layerHeightMm",
  "laborSetupFee",
  "failureMarginPercent",
  "profitMarginPercent",
  "marketplaceFeePercent",
  "feeMode",
  "mlListingType",
  "mlLogistics",
  "mlPercent",
  "mlFixedOverride",
  "shopeeProgram",
  "shopeeFull",
];

const PRINTER_LIMITS = {
  printerPowerW: [0, 5000, "Potência (W)"],
  energyPricePerKwh: [0, 20, "Preço da energia (R$/kWh)"],
  machineDepreciationPerHour: [0, 1000, "Depreciação (R$/h)"],
  lineWidthMm: [0.1, 1.2, "Largura da linha (mm)"],
  throughputMm3PerS: [0.1, 200, "Vazão (mm³/s)"],
  referenceLayerHeightMm: [0.05, 1.2, "Altura de referência (mm)"],
  setupTimeMin: [0, 240, "Tempo de preparação (min)"],
};

const JOB_LIMITS = {
  infillPercent: [0, 100, "Preenchimento (%)"],
  perimeters: [0, 20, "Paredes"],
  layerHeightMm: [0.05, 1.2, "Altura da camada (mm)"],
  laborSetupFee: [0, 100000, "Mão de obra (R$)"],
  failureMarginPercent: [0, 100, "Margem de falha (%)"],
  profitMarginPercent: [0, 1000, "Margem de lucro (%)"],
  marketplaceFeePercent: [0, 99, "Percentual do marketplace"],
};

const FEE_MODES = ["custom", "none", "mercado-livre", "shopee"];
const ML_TYPES = ["classico", "premium"];
const ML_LOGISTICS = ["me2", "flex", "me1"];
const SHOPEE_PROGRAMS = ["cnpj", "cpf", "cpf-alto"];
const SHOPEE_FULL = ["none", "40", "70"];

export class ProfileError extends Error {
  constructor(message) {
    super(message);
    this.name = "ProfileError";
  }
}

export function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function finiteOrNull(value) {
  if (value == null || value === "") return null;
  const n = Number(String(value).trim().replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function pickNumber(source, key, fallback) {
  const n = finiteOrNull(source?.[key]);
  return n == null ? fallback : n;
}

export function defaultPrinter(partial = {}) {
  return {
    id: partial.id || createId(),
    name: String(partial.name || "Impressora principal").slice(0, 60),
    printerPowerW: pickNumber(partial, "printerPowerW", DEFAULT_SETTINGS.printerPowerW),
    energyPricePerKwh: pickNumber(partial, "energyPricePerKwh", DEFAULT_SETTINGS.energyPricePerKwh),
    machineDepreciationPerHour: pickNumber(
      partial,
      "machineDepreciationPerHour",
      DEFAULT_SETTINGS.machineDepreciationPerHour
    ),
    lineWidthMm: pickNumber(partial, "lineWidthMm", DEFAULT_SETTINGS.lineWidthMm),
    throughputMm3PerS: pickNumber(partial, "throughputMm3PerS", DEFAULT_SETTINGS.throughputMm3PerS),
    referenceLayerHeightMm: pickNumber(
      partial,
      "referenceLayerHeightMm",
      DEFAULT_SETTINGS.referenceLayerHeightMm
    ),
    setupTimeMin: pickNumber(partial, "setupTimeMin", DEFAULT_SETTINGS.setupTimeMin),
  };
}

export function defaultFilament(partial = {}) {
  const material = MATERIALS.some((item) => item.id === partial.material) ? partial.material : DEFAULT_SETTINGS.material;
  const catalog = MATERIALS.find((item) => item.id === material);
  return {
    id: partial.id || createId(),
    name: String(partial.name || catalog?.name || "PLA").slice(0, 60),
    material,
    densityGCm3: pickNumber(partial, "densityGCm3", catalog?.densityGCm3 ?? DEFAULT_SETTINGS.densityGCm3),
    filamentPricePerKg: pickNumber(partial, "filamentPricePerKg", DEFAULT_SETTINGS.filamentPricePerKg),
  };
}

export function defaultJob(partial = {}) {
  const job = {};
  for (const key of JOB_FIELDS) {
    if (key === "feeMode") job.feeMode = FEE_MODES.includes(partial.feeMode) ? partial.feeMode : FEE_DEFAULTS.feeMode;
    else if (key === "mlListingType") job.mlListingType = ML_TYPES.includes(partial.mlListingType) ? partial.mlListingType : FEE_DEFAULTS.mlListingType;
    else if (key === "mlLogistics") job.mlLogistics = ML_LOGISTICS.includes(partial.mlLogistics) ? partial.mlLogistics : FEE_DEFAULTS.mlLogistics;
    else if (key === "shopeeProgram") job.shopeeProgram = SHOPEE_PROGRAMS.includes(partial.shopeeProgram) ? partial.shopeeProgram : FEE_DEFAULTS.shopeeProgram;
    else if (key === "shopeeFull") job.shopeeFull = SHOPEE_FULL.includes(partial.shopeeFull) ? partial.shopeeFull : FEE_DEFAULTS.shopeeFull;
    else if (key === "mlPercent" || key === "mlFixedOverride") job[key] = partial[key] == null ? "" : String(partial[key]);
    else job[key] = pickNumber(partial, key, DEFAULT_SETTINGS[key] ?? FEE_DEFAULTS[key]);
  }
  return job;
}

export function defaultLibrary() {
  const printer = defaultPrinter();
  const filament = defaultFilament();
  return {
    version: PROFILE_EXPORT_VERSION,
    printers: [printer],
    filaments: [filament],
    activePrinterId: printer.id,
    activeFilamentId: filament.id,
    job: defaultJob(),
  };
}

/**
 * Converte o objeto único que as versões antigas gravavam.
 * Campos ausentes ou inválidos caem no padrão; nada é descartado por um número ruim.
 * @param {object} legacy
 */
export function migrateLegacySettings(legacy) {
  const source = legacy && typeof legacy === "object" ? legacy : {};
  const materialId = MATERIALS.some((item) => item.id === source.material) ? source.material : DEFAULT_SETTINGS.material;
  const catalog = MATERIALS.find((item) => item.id === materialId);
  const densityGiven = finiteOrNull(source.densityGCm3);
  const printer = defaultPrinter({
    name: "Impressora salva",
    ...source,
  });
  const filament = defaultFilament({
    name: catalog?.name || "Filamento salvo",
    material: materialId,
    densityGCm3: densityGiven == null ? catalog.densityGCm3 : densityGiven,
    filamentPricePerKg: source.filamentPricePerKg,
  });
  return {
    version: PROFILE_EXPORT_VERSION,
    printers: [printer],
    filaments: [filament],
    activePrinterId: printer.id,
    activeFilamentId: filament.id,
    job: defaultJob(source),
  };
}

function normalizeLibrary(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.printers) || !value.printers.length) {
    return defaultLibrary();
  }
  const printers = value.printers.map((item, index) =>
    defaultPrinter({ ...item, name: cleanName(item?.name, `Impressora ${index + 1}`) })
  );
  const filamentsSource = Array.isArray(value.filaments) && value.filaments.length ? value.filaments : [defaultFilament()];
  const filaments = filamentsSource.map((item, index) =>
    defaultFilament({ ...item, name: cleanName(item?.name, `Filamento ${index + 1}`) })
  );
  ensureUniqueIds(printers);
  ensureUniqueIds(filaments);
  return {
    version: PROFILE_EXPORT_VERSION,
    printers,
    filaments,
    activePrinterId: printers.some((item) => item.id === value.activePrinterId) ? value.activePrinterId : printers[0].id,
    activeFilamentId: filaments.some((item) => item.id === value.activeFilamentId) ? value.activeFilamentId : filaments[0].id,
    job: defaultJob(value.job || {}),
  };
}

function cleanName(value, fallback) {
  const name = String(value ?? "").trim();
  return (name || fallback).slice(0, 60);
}

function ensureUniqueIds(list) {
  const seen = new Set();
  for (const item of list) {
    if (!item.id || seen.has(item.id)) item.id = createId();
    seen.add(item.id);
  }
}

/**
 * @param {Storage} storage
 */
export function loadLibrary(storage) {
  const current = readJson(storage, LIBRARY_KEY);
  if (current) return normalizeLibrary(current);
  const legacy = readJson(storage, LEGACY_SETTINGS_KEY);
  const library = legacy ? migrateLegacySettings(legacy) : defaultLibrary();
  try {
    storage.setItem(LIBRARY_KEY, JSON.stringify(library));
    if (legacy) storage.removeItem(LEGACY_SETTINGS_KEY);
  } catch {
    // segue em memória se o navegador recusar a gravação
  }
  return library;
}

export function saveLibrary(storage, library) {
  storage.setItem(LIBRARY_KEY, JSON.stringify(library));
}

function readJson(storage, key) {
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function activePrinter(library) {
  return library.printers.find((item) => item.id === library.activePrinterId) ?? library.printers[0];
}

export function activeFilament(library) {
  return library.filaments.find((item) => item.id === library.activeFilamentId) ?? library.filaments[0];
}

/**
 * Junta impressora ativa, um filamento e os ajustes da peça.
 * @param {object} library
 * @param {string} [filamentId]
 */
export function settingsFromLibrary(library, filamentId = library.activeFilamentId) {
  const printer = activePrinter(library);
  const filament = library.filaments.find((item) => item.id === filamentId) ?? activeFilament(library);
  return {
    ...DEFAULT_SETTINGS,
    ...FEE_DEFAULTS,
    ...library.job,
    printerPowerW: printer.printerPowerW,
    energyPricePerKwh: printer.energyPricePerKwh,
    machineDepreciationPerHour: printer.machineDepreciationPerHour,
    lineWidthMm: printer.lineWidthMm,
    throughputMm3PerS: printer.throughputMm3PerS,
    referenceLayerHeightMm: printer.referenceLayerHeightMm,
    setupTimeMin: printer.setupTimeMin,
    material: filament.material,
    densityGCm3: filament.densityGCm3,
    filamentPricePerKg: filament.filamentPricePerKg,
  };
}

function replaceProfile(library, kind, id, patch) {
  return {
    ...library,
    [kind]: library[kind].map((item) => (item.id === id ? { ...item, ...patch, id: item.id } : item)),
  };
}

export function updateProfile(library, kind, id, patch) {
  return replaceProfile(library, kind, id, patch);
}

export function setActive(library, kind, id) {
  const key = kind === "printers" ? "activePrinterId" : "activeFilamentId";
  if (!library[kind].some((item) => item.id === id)) return library;
  return { ...library, [key]: id };
}

export function addProfile(library, kind, partial = {}) {
  const created = kind === "printers" ? defaultPrinter(partial) : defaultFilament(partial);
  created.name = uniqueName(library, kind, created.name);
  const key = kind === "printers" ? "activePrinterId" : "activeFilamentId";
  return { ...library, [kind]: [...library[kind], created], [key]: created.id };
}

export function renameProfile(library, kind, id, name) {
  const trimmed = String(name ?? "").trim();
  if (!trimmed) throw new ProfileError("Dê um nome ao perfil.");
  if (trimmed.length > 60) throw new ProfileError("O nome pode ter no máximo 60 caracteres.");
  return replaceProfile(library, kind, id, { name: trimmed });
}

export function duplicateProfile(library, kind, id) {
  const source = library[kind].find((item) => item.id === id);
  if (!source) throw new ProfileError("Não encontrei esse perfil para duplicar.");
  const copy = {
    ...(kind === "printers" ? defaultPrinter(source) : defaultFilament(source)),
    id: createId(),
    name: uniqueName(library, kind, `${source.name} (cópia)`),
  };
  const key = kind === "printers" ? "activePrinterId" : "activeFilamentId";
  return { ...library, [kind]: [...library[kind], copy], [key]: copy.id };
}

export function deleteProfile(library, kind, id) {
  if (library[kind].length <= 1) {
    throw new ProfileError(kind === "printers" ? "Mantenha ao menos uma impressora." : "Mantenha ao menos um filamento.");
  }
  const next = library[kind].filter((item) => item.id !== id);
  const key = kind === "printers" ? "activePrinterId" : "activeFilamentId";
  const active = library[key] === id ? next[0].id : library[key];
  return { ...library, [kind]: next, [key]: active };
}

export function resetActiveProfiles(library) {
  const printer = activePrinter(library);
  const filament = activeFilament(library);
  let next = replaceProfile(library, "printers", printer.id, defaultPrinter({ id: printer.id, name: printer.name }));
  next = replaceProfile(next, "filaments", filament.id, defaultFilament({ id: filament.id, name: filament.name, material: filament.material }));
  next.job = defaultJob();
  return next;
}

function uniqueName(library, kind, base) {
  const names = new Set(library[kind].map((item) => item.name));
  if (!names.has(base)) return base.slice(0, 60);
  let n = 2;
  while (names.has(`${base} ${n}`)) n += 1;
  return `${base} ${n}`.slice(0, 60);
}

export function serializeProfiles(library) {
  return JSON.stringify(
    {
      app: "orca3d",
      kind: "profiles",
      version: PROFILE_EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      printers: library.printers,
      filaments: library.filaments,
      activePrinterId: library.activePrinterId,
      activeFilamentId: library.activeFilamentId,
      job: library.job,
    },
    null,
    2
  );
}

/**
 * Valida um JSON exportado. Mensagens prontas para mostrar na tela.
 * @param {string} text
 */
export function parseProfilesImport(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ProfileError("O arquivo não é um JSON válido. Exporte os perfis pelo Orça3D e tente de novo.");
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new ProfileError("O arquivo precisa ser um objeto JSON com impressoras e filamentos.");
  }
  if (data.app && data.app !== "orca3d") {
    throw new ProfileError("Este JSON não é um arquivo de perfis do Orça3D.");
  }
  if (data.kind && data.kind !== "profiles") {
    throw new ProfileError("Este arquivo não é uma exportação de perfis. Use o JSON gerado em Exportar perfis.");
  }
  if (!Array.isArray(data.printers) || data.printers.length === 0) {
    throw new ProfileError("Nenhuma impressora encontrada. O arquivo precisa ter ao menos um perfil de impressora.");
  }
  if (!Array.isArray(data.filaments) || data.filaments.length === 0) {
    throw new ProfileError("Nenhum filamento encontrado. O arquivo precisa ter ao menos um perfil de filamento.");
  }
  if (data.printers.length > 50) throw new ProfileError("Há impressoras demais neste arquivo (máximo de 50).");
  if (data.filaments.length > 100) throw new ProfileError("Há filamentos demais neste arquivo (máximo de 100).");

  const printers = data.printers.map((item, index) => validatePrinter(item, index));
  const filaments = data.filaments.map((item, index) => validateFilament(item, index));
  const job = data.job == null ? defaultJob() : validateJob(data.job);
  return {
    version: PROFILE_EXPORT_VERSION,
    printers,
    filaments,
    activePrinterId: printers.some((item) => item.id === data.activePrinterId) ? data.activePrinterId : printers[0].id,
    activeFilamentId: filaments.some((item) => item.id === data.activeFilamentId) ? data.activeFilamentId : filaments[0].id,
    job,
  };
}

function requireName(value, label) {
  const name = String(value ?? "").trim();
  if (!name) throw new ProfileError(`${label} está sem nome.`);
  if (name.length > 60) throw new ProfileError(`${label} tem um nome longo demais (máximo de 60 caracteres).`);
  return name;
}

function requireNumber(value, limits, label) {
  const [min, max, field] = limits;
  const n = finiteOrNull(value);
  if (n == null) throw new ProfileError(`${label} tem um valor inválido em “${field}”.`);
  if (n < min || n > max) throw new ProfileError(`${label}: “${field}” precisa ficar entre ${min} e ${max}.`);
  return n;
}

function validatePrinter(item, index) {
  const label = `A impressora ${index + 1}`;
  if (!item || typeof item !== "object") throw new ProfileError(`${label} não é um objeto válido.`);
  const printer = { id: String(item.id || createId()), name: requireName(item.name, label) };
  for (const key of PRINTER_FIELDS) printer[key] = requireNumber(item[key], PRINTER_LIMITS[key], label);
  return printer;
}

function validateFilament(item, index) {
  const label = `O filamento ${index + 1}`;
  if (!item || typeof item !== "object") throw new ProfileError(`${label} não é um objeto válido.`);
  const name = requireName(item.name, label);
  if (!MATERIALS.some((material) => material.id === item.material)) {
    throw new ProfileError(`${label} (“${name}”) usa um material desconhecido. Use PLA, PETG, ABS ou TPU.`);
  }
  const density = requireNumber(item.densityGCm3, [0.1, 8, "Densidade (g/cm³)"], label);
  const price = requireNumber(item.filamentPricePerKg, [0, 5000, "Preço do filamento (R$/kg)"], label);
  return { id: String(item.id || createId()), name, material: item.material, densityGCm3: density, filamentPricePerKg: price };
}

function validateJob(job) {
  if (!job || typeof job !== "object" || Array.isArray(job)) {
    throw new ProfileError("Os ajustes da peça no arquivo não são um objeto válido.");
  }
  const next = defaultJob();
  for (const key of Object.keys(JOB_LIMITS)) {
    if (job[key] == null || job[key] === "") continue;
    next[key] = requireNumber(job[key], JOB_LIMITS[key], "Os ajustes da peça");
  }
  if (job.feeMode != null && !FEE_MODES.includes(job.feeMode)) {
    throw new ProfileError("O modo de taxa do arquivo não é válido.");
  }
  if (job.feeMode) next.feeMode = job.feeMode;
  if (job.mlListingType != null && !ML_TYPES.includes(job.mlListingType)) {
    throw new ProfileError("O tipo de anúncio do Mercado Livre no arquivo não é válido.");
  }
  if (job.mlListingType) next.mlListingType = job.mlListingType;
  if (job.mlLogistics != null && !ML_LOGISTICS.includes(job.mlLogistics)) {
    throw new ProfileError("A logística do Mercado Livre no arquivo não é válida.");
  }
  if (job.mlLogistics) next.mlLogistics = job.mlLogistics;
  if (job.shopeeProgram != null && !SHOPEE_PROGRAMS.includes(job.shopeeProgram)) {
    throw new ProfileError("O tipo de vendedor da Shopee no arquivo não é válido.");
  }
  if (job.shopeeProgram) next.shopeeProgram = job.shopeeProgram;
  if (job.shopeeFull != null && !SHOPEE_FULL.includes(job.shopeeFull)) {
    throw new ProfileError("O programa Full+ da Shopee no arquivo não é válido.");
  }
  if (job.shopeeFull) next.shopeeFull = job.shopeeFull;
  if (job.mlPercent != null) next.mlPercent = String(job.mlPercent);
  if (job.mlFixedOverride != null) next.mlFixedOverride = String(job.mlFixedOverride);
  return next;
}
