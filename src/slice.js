/**
 * Lê peso (g) e tempo de impressão que o fatiador gravou no G-code
 * ou num 3MF fatiado (.gcode.3mf). Não estima: só interpreta o arquivo.
 */
import { gunzipSync, strFromU8, unzipSync } from "../vendor/fflate.js";

const SLICER_PATTERNS = [
  { id: "orca", name: "OrcaSlicer", re: /OrcaSlicer\s+v?([0-9][0-9A-Za-z.+-]*)/i },
  { id: "bambu", name: "Bambu Studio", re: /Bambu\s*Studio\s+v?([0-9][0-9A-Za-z.+-]*)|BambuStudio\s+v?([0-9][0-9A-Za-z.+-]*)/i },
  { id: "superslicer", name: "SuperSlicer", re: /SuperSlicer\s+v?([0-9][0-9A-Za-z.+-]*)/i },
  { id: "prusa", name: "PrusaSlicer", re: /PrusaSlicer\s+v?([0-9][0-9A-Za-z.+-]*)/i },
  { id: "cura", name: "Cura", re: /Cura_SteamEngine\s+v?([0-9][0-9A-Za-z.+-]*)|Ultimaker\s+Cura\s+v?([0-9][0-9A-Za-z.+-]*)/i },
];

/**
 * @param {string} token
 * @returns {number|null}
 */
export function parseLocaleNumber(token) {
  let text = String(token ?? "").trim().replace(/\s/g, "");
  if (!text) return null;
  const hasComma = text.includes(",");
  const hasDot = text.includes(".");
  if (hasComma && hasDot) {
    if (text.lastIndexOf(",") > text.lastIndexOf(".")) {
      text = text.replace(/\./g, "").replace(",", ".");
    } else {
      text = text.replace(/,/g, "");
    }
  } else if (hasComma) {
    const parts = text.split(",");
    if (parts.length > 2) text = parts.join("");
    else text = text.replace(",", ".");
  }
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/**
 * "1h 2m 3s", "2d 3h", "45s", "0h 12m 30s".
 * @param {string} input
 * @returns {number|null} segundos
 */
export function parseDurationToSeconds(input) {
  const text = String(input ?? "");
  if (!/[dhms]/i.test(text)) return null;
  const re = /(\d+(?:[.,]\d+)?)\s*([dhms])/gi;
  let match;
  let seconds = 0;
  let found = false;
  const mult = { d: 86400, h: 3600, m: 60, s: 1 };
  while ((match = re.exec(text))) {
    const value = parseLocaleNumber(match[1]);
    if (value == null) continue;
    found = true;
    seconds += value * mult[match[2].toLowerCase()];
  }
  return found ? seconds : null;
}

/**
 * Comprimento em milímetros. Unidade ausente conta como mm.
 * @param {string} token
 * @returns {number|null}
 */
export function parseLengthToMm(token) {
  const match = String(token ?? "")
    .trim()
    .match(/^([+-]?\d+(?:[.,]\d+)?)\s*(mm|cm|m)?$/i);
  if (!match) return null;
  const value = parseLocaleNumber(match[1]);
  if (value == null) return null;
  const unit = (match[2] || "mm").toLowerCase();
  if (unit === "m") return value * 1000;
  if (unit === "cm") return value * 10;
  return value;
}

/**
 * @param {number} lengthMm
 * @param {number} diameterMm
 * @param {number} densityGCm3
 */
export function gramsFromFilamentLength(lengthMm, diameterMm, densityGCm3) {
  const length = Math.max(0, Number(lengthMm) || 0);
  const diameter = Math.max(0, Number(diameterMm) || 0);
  const density = Math.max(0, Number(densityGCm3) || 0);
  const radius = diameter / 2;
  const volumeCm3 = (length * Math.PI * radius * radius) / 1000;
  return volumeCm3 * density;
}

function sumNumbers(list) {
  const values = (list || []).filter((n) => Number.isFinite(n));
  if (!values.length) return null;
  return values.reduce((acc, n) => acc + n, 0);
}

function numberList(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return [];
  const pieces = text.split(/\s*[,;]\s*/).filter(Boolean);
  if (
    pieces.length === 2 &&
    /^\d+$/.test(pieces[0]) &&
    /^\d+$/.test(pieces[1]) &&
    text.includes(",") &&
    !text.includes(" ") &&
    !text.includes(".")
  ) {
    const single = parseLocaleNumber(text);
    return single == null ? [] : [single];
  }
  return pieces.map(parseLocaleNumber).filter((n) => n != null);
}

function firstVersion(match) {
  if (!match) return null;
  for (let i = 1; i < match.length; i += 1) {
    if (match[i]) return match[i];
  }
  return null;
}

/**
 * @param {string} text
 */
export function detectSlicer(text) {
  const source = String(text ?? "");
  for (const pattern of SLICER_PATTERNS) {
    const match = pattern.re.exec(source);
    if (match) {
      return { id: pattern.id, name: pattern.name, version: firstVersion(match) };
    }
  }
  if (/^;TIME:\s*\d+/im.test(source) && /;\s*Filament used:/i.test(source)) {
    return { id: "cura", name: "Cura", version: null };
  }
  if (/estimated printing time/i.test(source) && /filament used \[/i.test(source)) {
    return { id: "prusa-family", name: "PrusaSlicer (ou compatível)", version: null };
  }
  if (/HEADER_BLOCK_START/i.test(source) && /total estimated time/i.test(source)) {
    return { id: "bambu-or-orca", name: "Bambu Studio ou OrcaSlicer", version: null };
  }
  return { id: "unknown", name: "Fatiador não identificado", version: null };
}

/**
 * Soma os números. Se alguma linha casa com "total", usa só essas
 * (evita somar o detalhe de cada extrusora com o total).
 * @param {string} text
 * @param {RegExp} pattern grupo 1 = lista de números
 */
function collectMeasure(text, pattern) {
  const totals = [];
  const parts = [];
  const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
  let match;
  while ((match = re.exec(text))) {
    const nums = numberList(match[1]);
    if (/total/i.test(match[0])) totals.push(...nums);
    else parts.push(...nums);
  }
  return sumNumbers(totals.length ? totals : parts);
}

function collectDurations(text, pattern) {
  const values = [];
  const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
  let match;
  while ((match = re.exec(text))) {
    const seconds = parseDurationToSeconds(match[1]);
    if (seconds != null) values.push(seconds);
  }
  return values;
}

/**
 * @param {string} text
 * @returns {number|null}
 */
export function parseGcodeTimeSeconds(text) {
  const source = String(text ?? "");
  const total = collectDurations(source, /total estimated time:\s*([0-9dhms\s.,]+)/gi);
  if (total.length) return total[0];

  const normal = collectDurations(
    source,
    /estimated printing time\s*\(normal mode\)\s*=\s*([0-9dhms\s.,]+)/gi
  );
  if (normal.length) return normal[0];

  const generic = [];
  const genericRe = /;\s*estimated printing time(?![^\n]*first layer)[^\n=]*=\s*([0-9dhms\s.,]+)/gi;
  let match;
  while ((match = genericRe.exec(source))) {
    const seconds = parseDurationToSeconds(match[1]);
    if (seconds != null) generic.push(seconds);
  }
  if (generic.length) return generic[0];

  const model = collectDurations(source, /model printing time:\s*([0-9dhms\s.,]+)/gi);
  if (model.length) return model[0];

  const cura = source.match(/^;TIME:\s*(\d+)\s*$/im);
  if (cura) return Number(cura[1]);
  return null;
}

function collectCuraLengthsMm(text) {
  const lengths = [];
  const re = /;\s*Filament used:\s*([^\n]+)/gi;
  let match;
  while ((match = re.exec(text))) {
    const tokens = match[1].split(/\s*,\s*/);
    for (const token of tokens) {
      const mm = parseLengthToMm(token.trim());
      if (mm != null) lengths.push(mm);
    }
  }
  return lengths;
}

/**
 * Interpreta um G-code em texto.
 * Gramas do arquivo vencem volume e comprimento.
 * Comprimento vira gramas só com diâmetro e densidade (do arquivo ou das opções).
 *
 * @param {string} text
 * @param {{densityGCm3?: number, diameterMm?: number}} [options]
 */
export function parseGcode(text, options = {}) {
  const source = String(text ?? "");
  const warnings = [];
  if (!source.trim()) {
    warnings.push("O G-code está vazio.");
  }
  const slicer = detectSlicer(source);

  const massFromFileGrams = collectMeasure(
    source,
    /;\s*(?:total\s+)?filament (?:used|weight) \[g\]\s*[=:]\s*([0-9.,+\-eE\s]+)/gi
  );

  const filamentVolumeCm3 = collectMeasure(
    source,
    /;\s*(?:total\s+)?filament (?:used \[cm3\]|volume \[cm\^3\])\s*[=:]\s*([0-9.,+\-eE\s]+)/gi
  );

  const labeledLength = collectMeasure(
    source,
    /;\s*(?:total\s+)?filament (?:used|length) \[mm\]\s*[=:]\s*([0-9.,+\-eE\s]+)/gi
  );
  const curaLengths = labeledLength == null ? collectCuraLengthsMm(source) : [];
  const filamentLengthMm = labeledLength ?? sumNumbers(curaLengths);

  const densities = numberList(
    (source.match(/;\s*filament_density\s*[=:]\s*([^\n]+)/i) || [])[1] || ""
  );
  const diameters = numberList(
    (source.match(/;\s*filament_diameter\s*[=:]\s*([^\n]+)/i) || [])[1] || ""
  );
  const densityFromFile = densities.find((n) => n > 0) ?? null;
  const diameterFromFile = diameters.find((n) => n > 0) ?? null;

  const printTimeSeconds = parseGcodeTimeSeconds(source);

  const parsed = {
    format: "gcode",
    slicer,
    printTimeSeconds,
    massFromFileGrams,
    filamentVolumeCm3,
    filamentLengthMm,
    densityGCm3: densityFromFile,
    diameterMm: diameterFromFile,
    warnings,
    plateCount: 1,
  };
  return finishSlice(parsed, options);
}

/**
 * Completa a massa quando o arquivo não trouxe gramas.
 * @param {ReturnType<typeof parseGcode>} parsed
 * @param {{densityGCm3?: number, diameterMm?: number}} [fallback]
 */
export function resolveSliceMass(parsed, fallback = {}) {
  const warnings = [];
  const density = parsed?.densityGCm3 ?? finiteOrNull(fallback.densityGCm3);
  const diameter = parsed?.diameterMm ?? finiteOrNull(fallback.diameterMm) ?? 1.75;

  if (parsed?.massFromFileGrams != null) {
    return {
      massGrams: parsed.massFromFileGrams,
      massSource: "grams",
      usedDensityGCm3: density,
      usedDiameterMm: parsed?.diameterMm ?? null,
      warnings,
    };
  }

  if (parsed?.filamentVolumeCm3 != null) {
    if (density == null) {
      warnings.push(
        "O arquivo informa o volume do filamento, mas não a densidade. Escolha o material para converter em gramas."
      );
      return { massGrams: null, massSource: null, usedDensityGCm3: null, usedDiameterMm: diameter, warnings };
    }
    return {
      massGrams: parsed.filamentVolumeCm3 * density,
      massSource: "volume",
      usedDensityGCm3: density,
      usedDiameterMm: diameter,
      warnings,
    };
  }

  if (parsed?.filamentLengthMm != null) {
    if (density == null) {
      warnings.push(
        "O arquivo só informa o comprimento do filamento. Informe a densidade para converter em gramas."
      );
      return { massGrams: null, massSource: null, usedDensityGCm3: null, usedDiameterMm: diameter, warnings };
    }
    if (!parsed?.diameterMm && fallback.diameterMm == null) {
      warnings.push("O diâmetro não veio no arquivo. A conversão usou 1,75 mm.");
    }
    return {
      massGrams: gramsFromFilamentLength(parsed.filamentLengthMm, diameter, density),
      massSource: "length",
      usedDensityGCm3: density,
      usedDiameterMm: diameter,
      warnings,
    };
  }

  if (parsed && parsed.massFromFileGrams == null && parsed.printTimeSeconds == null) {
    warnings.push("Não encontrei peso nem tempo neste arquivo.");
  } else if (parsed && parsed.massFromFileGrams == null) {
    warnings.push("O tempo foi lido, mas o arquivo não informa o peso do filamento.");
  }
  return { massGrams: null, massSource: null, usedDensityGCm3: density, usedDiameterMm: diameter, warnings };
}

function finishSlice(parsed, options) {
  const resolved = resolveSliceMass(parsed, options);
  return {
    ...parsed,
    massGrams: resolved.massGrams,
    massSource: resolved.massSource,
    baseWarnings: parsed.warnings,
    warnings: [...parsed.warnings, ...resolved.warnings],
  };
}

function finiteOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function decodeXml(value) {
  return String(value)
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function tagAttrs(tag) {
  const attrs = {};
  const re = /([A-Za-z_][\w:.-]*)\s*=\s*"([^"]*)"/g;
  let match;
  while ((match = re.exec(tag))) attrs[match[1]] = decodeXml(match[2]);
  return attrs;
}

/**
 * @param {string} xml
 */
export function parseSliceInfoConfig(xml) {
  const source = String(xml ?? "");
  const warnings = [];
  let version = null;
  const headerRe = /<header_item\b[^>]*>/gi;
  let headerMatch;
  while ((headerMatch = headerRe.exec(source))) {
    const attrs = tagAttrs(headerMatch[0]);
    if (attrs.key === "X-BBL-Client-Version" && attrs.value) version = attrs.value;
  }

  let printTimeSeconds = 0;
  let weight = 0;
  let usedGrams = 0;
  let timePlates = 0;
  let weightPlates = 0;
  let plateCount = 0;
  const plateRe = /<plate\b[^>]*>([\s\S]*?)<\/plate>/gi;
  let plateMatch;
  while ((plateMatch = plateRe.exec(source))) {
    plateCount += 1;
    const body = plateMatch[1];
    const metaRe = /<metadata\b[^>]*\/?>/gi;
    let metaMatch;
    while ((metaMatch = metaRe.exec(body))) {
      const attrs = tagAttrs(metaMatch[0]);
      if (attrs.key === "prediction") {
        const seconds = parseLocaleNumber(attrs.value);
        if (seconds != null) {
          printTimeSeconds += seconds;
          timePlates += 1;
        }
      }
      if (attrs.key === "weight") {
        const grams = parseLocaleNumber(attrs.value);
        if (grams != null) {
          weight += grams;
          weightPlates += 1;
        }
      }
    }
    const filamentRe = /<filament\b[^>]*\/?>/gi;
    let filamentMatch;
    while ((filamentMatch = filamentRe.exec(body))) {
      const attrs = tagAttrs(filamentMatch[0]);
      const grams = parseLocaleNumber(attrs.used_g);
      if (grams != null) usedGrams += grams;
    }
  }

  const massFromFileGrams = weightPlates > 0 && weight > 0 ? weight : usedGrams > 0 ? usedGrams : weightPlates > 0 ? weight : null;
  if (plateCount === 0) warnings.push("O slice_info.config não tem placas.");

  return {
    format: "slice-info",
    slicer: version
      ? { id: "bambu-or-orca", name: "Bambu Studio ou OrcaSlicer", version }
      : { id: "bambu-or-orca", name: "Bambu Studio ou OrcaSlicer", version: null },
    printTimeSeconds: timePlates > 0 ? printTimeSeconds : null,
    massFromFileGrams,
    filamentVolumeCm3: null,
    filamentLengthMm: null,
    densityGCm3: null,
    diameterMm: null,
    warnings,
    plateCount,
  };
}

function normalizeZipPath(path) {
  return String(path || "").replace(/\\/g, "/").replace(/^\/+/, "");
}

function findZipEntries(entries, suffixRe) {
  const found = [];
  for (const [path, data] of Object.entries(entries)) {
    const normal = normalizeZipPath(path);
    if (suffixRe.test(normal)) found.push({ path: normal, data });
  }
  found.sort((a, b) => a.path.localeCompare(b.path, "en"));
  return found;
}

/**
 * @param {Uint8Array|ArrayBuffer} data
 * @param {{densityGCm3?: number, diameterMm?: number}} [options]
 */
export function parse3mf(data, options = {}) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let entries;
  try {
    entries = unzipSync(bytes);
  } catch {
    throw new Error("Não foi possível abrir este 3MF. O arquivo não é um ZIP válido.");
  }

  const sliceInfos = findZipEntries(entries, /(^|\/)slice_info\.config$/i);
  const plateGcodes = findZipEntries(entries, /(^|\/)plate_\d+\.gcode$/i);
  const plateGz = findZipEntries(entries, /(^|\/)plate_\d+\.gcode\.gz$/i);

  /** @type {string[]} */
  const gcodeTexts = [];
  for (const entry of plateGcodes) {
    gcodeTexts.push(strFromU8(entry.data));
  }
  for (const entry of plateGz) {
    try {
      gcodeTexts.push(strFromU8(gunzipSync(entry.data)));
    } catch {
      throw new Error(`Não foi possível descompactar ${entry.path}.`);
    }
  }

  if (!sliceInfos.length && !gcodeTexts.length) {
    throw new Error(
      "Este 3MF não traz dados de fatiamento. Exporte o .gcode.3mf (Orca ou Bambu Studio) ou um G-code em texto."
    );
  }

  const fromXml = sliceInfos.length ? parseSliceInfoConfig(strFromU8(sliceInfos[0].data)) : null;
  const gcodeParsed = gcodeTexts.length
    ? parseGcode(gcodeTexts.join("\n"), options)
    : null;

  let slicer = gcodeParsed?.slicer?.id && gcodeParsed.slicer.id !== "unknown"
    ? gcodeParsed.slicer
    : fromXml?.slicer || { id: "unknown", name: "Fatiador não identificado", version: null };

  if (fromXml?.slicer?.version && slicer.version == null) {
    slicer = { ...slicer, version: fromXml.slicer.version };
  }

  const printTimeSeconds = fromXml?.printTimeSeconds ?? gcodeParsed?.printTimeSeconds ?? null;
  const massFromFileGrams = fromXml?.massFromFileGrams ?? gcodeParsed?.massFromFileGrams ?? null;
  const warnings = [...(fromXml?.warnings || []), ...(gcodeParsed?.warnings || [])];

  const parsed = {
    format: "3mf",
    slicer,
    printTimeSeconds,
    massFromFileGrams,
    filamentVolumeCm3: massFromFileGrams == null ? gcodeParsed?.filamentVolumeCm3 ?? null : null,
    filamentLengthMm: massFromFileGrams == null ? gcodeParsed?.filamentLengthMm ?? null : null,
    densityGCm3: gcodeParsed?.densityGCm3 ?? null,
    diameterMm: gcodeParsed?.diameterMm ?? null,
    warnings,
    plateCount: fromXml?.plateCount || gcodeTexts.length || 1,
  };
  return finishSlice(parsed, options);
}

/**
 * @param {ArrayBuffer|Uint8Array} buffer
 * @param {string} filename
 * @param {{densityGCm3?: number, diameterMm?: number}} [options]
 */
export function parseSliceBuffer(buffer, filename, options = {}) {
  const name = String(filename || "").toLowerCase();
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (name.endsWith(".gcode")) {
    if (looksBinary(bytes)) {
      throw new Error("Este G-code parece binário (.bgcode). Exporte o G-code em texto.");
    }
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    return parseGcode(text, options);
  }
  if (name.endsWith(".3mf")) {
    return parse3mf(bytes, options);
  }
  throw new Error("Envie um G-code (.gcode) ou um 3MF fatiado (.3mf, .gcode.3mf).");
}

function looksBinary(bytes) {
  const head = bytes.subarray(0, 16);
  if (head.length >= 4) {
    const magic = String.fromCharCode(head[0], head[1], head[2], head[3]);
    if (magic === "GCDE") return true;
  }
  const sample = bytes.subarray(0, Math.min(bytes.length, 512));
  let zeros = 0;
  for (const byte of sample) if (byte === 0) zeros += 1;
  return zeros > 8;
}
