/**
 * Módulo puro de orçamento de impressão 3D.
 * Não depende de DOM, Three.js ou arquivos — só de geometria + parâmetros.
 * Pode ser reutilizado no futuro como API paga (Node/servidor).
 *
 * Estimativas:
 * - Material (g): casca (área × espessura das paredes) + interior × % de preenchimento.
 * - Tempo: volume de material / vazão volumétrica, ajustada pela altura de camada,
 *   mais um tempo fixo de aquecimento/preparação.
 * Peso e tempo são aproximações e devem ser apresentados como tal.
 */

/**
 * @typedef {Object} QuoteGeometry
 * @property {number} volumeMm3
 * @property {number} surfaceAreaMm2
 * @property {{size?: {x:number,y:number,z:number}}} [boundingBox]
 */

/**
 * @typedef {Object} QuoteSettings
 * @property {string} material
 * @property {number} densityGCm3
 * @property {number} infillPercent
 * @property {number} perimeters
 * @property {number} lineWidthMm
 * @property {number} layerHeightMm
 * @property {number} filamentPricePerKg
 * @property {number} printerPowerW
 * @property {number} energyPricePerKwh
 * @property {number} machineDepreciationPerHour
 * @property {number} laborSetupFee
 * @property {number} failureMarginPercent
 * @property {number} profitMarginPercent
 * @property {number} marketplaceFeePercent
 * @property {number} throughputMm3PerS
 * @property {number} referenceLayerHeightMm
 * @property {number} setupTimeMin
 */

/**
 * Densidades típicas de filamento (g/cm³).
 */
export const MATERIALS = [
  { id: "PLA", name: "PLA", densityGCm3: 1.24 },
  { id: "PETG", name: "PETG", densityGCm3: 1.27 },
  { id: "ABS", name: "ABS", densityGCm3: 1.04 },
  { id: "TPU", name: "TPU", densityGCm3: 1.21 },
];

/**
 * Padrões pensados para um maker no Brasil (preços em R$).
 */
export const DEFAULT_SETTINGS = Object.freeze({
  material: "PLA",
  densityGCm3: 1.24,
  infillPercent: 20,
  perimeters: 2,
  lineWidthMm: 0.4,
  layerHeightMm: 0.2,
  filamentPricePerKg: 99,
  printerPowerW: 150,
  energyPricePerKwh: 0.95,
  machineDepreciationPerHour: 3,
  laborSetupFee: 10,
  failureMarginPercent: 10,
  profitMarginPercent: 50,
  marketplaceFeePercent: 16,
  throughputMm3PerS: 6,
  referenceLayerHeightMm: 0.2,
  setupTimeMin: 5,
});

/**
 * @param {string} materialId
 * @returns {{id:string,name:string,densityGCm3:number}}
 */
export function getMaterial(materialId) {
  return MATERIALS.find((m) => m.id === materialId) ?? MATERIALS[0];
}

/**
 * Espessura equivalente das paredes (perímetros × largura da linha).
 * @param {Pick<QuoteSettings, "perimeters"|"lineWidthMm">} settings
 */
export function wallThicknessMm(settings) {
  const perimeters = Math.max(0, Number(settings.perimeters) || 0);
  const lineWidth = Math.max(0, Number(settings.lineWidthMm) || 0);
  return perimeters * lineWidth;
}

/**
 * Aproxima o volume de filamento: casca + preenchimento do interior.
 * A casca é área de superfície × espessura, limitada ao volume sólido.
 *
 * @param {QuoteGeometry} geometry
 * @param {Pick<QuoteSettings, "perimeters"|"lineWidthMm"|"infillPercent">} settings
 */
export function estimateMaterialVolume(geometry, settings) {
  const solid = Math.max(0, Number(geometry.volumeMm3) || 0);
  const area = Math.max(0, Number(geometry.surfaceAreaMm2) || 0);
  const thickness = wallThicknessMm(settings);
  const infill = clamp(Number(settings.infillPercent) || 0, 0, 100) / 100;

  const shellVolumeMm3 = Math.min(solid, area * thickness);
  const interiorMm3 = Math.max(0, solid - shellVolumeMm3);
  const infillVolumeMm3 = interiorMm3 * infill;
  const materialVolumeMm3 = shellVolumeMm3 + infillVolumeMm3;

  return {
    solidVolumeMm3: solid,
    shellVolumeMm3,
    interiorMm3,
    infillVolumeMm3,
    materialVolumeMm3,
    wallThicknessMm: thickness,
  };
}

/**
 * Massa em gramas: (mm³ / 1000) × densidade g/cm³.
 * @param {number} volumeMm3
 * @param {number} densityGCm3
 */
export function massGramsFromVolume(volumeMm3, densityGCm3) {
  const density = Math.max(0, Number(densityGCm3) || 0);
  return (Math.max(0, Number(volumeMm3) || 0) / 1000) * density;
}

/**
 * Tempo de impressão (s): volume de material / vazão efetiva + preparação.
 * A vazão escala com a altura de camada em relação à altura de referência
 * (camadas mais altas → mais material por passe → mais rápido).
 *
 * @param {number} materialVolumeMm3
 * @param {Pick<QuoteSettings, "throughputMm3PerS"|"layerHeightMm"|"referenceLayerHeightMm"|"setupTimeMin">} settings
 */
export function estimatePrintTimeSeconds(materialVolumeMm3, settings) {
  const volume = Math.max(0, Number(materialVolumeMm3) || 0);
  const baseRate = Math.max(0, Number(settings.throughputMm3PerS) || 0);
  const layer = Math.max(0.01, Number(settings.layerHeightMm) || 0.2);
  const reference = Math.max(0.01, Number(settings.referenceLayerHeightMm) || 0.2);
  const setupMin = Math.max(0, Number(settings.setupTimeMin) || 0);

  const effectiveRate = baseRate * (layer / reference);
  const extrusionSeconds = effectiveRate > 0 ? volume / effectiveRate : 0;
  return extrusionSeconds + setupMin * 60;
}

/**
 * Número explícito, inclusive 0. null/undefined/NaN significam "não informado".
 * @param {unknown} value
 * @returns {number|null}
 */
export function explicitNumber(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Calcula o orçamento completo a partir da geometria e dos parâmetros.
 * `measured.massGrams` e `measured.printTimeSeconds`, quando forem números,
 * substituem a estimativa (peso e tempo lidos do fatiador ou digitados).
 *
 * Taxa de marketplace: o preço de anúncio é reajustado para que, depois da
 * comissão percentual, o valor líquido seja o preço sugerido (lucro incluído).
 * listingPrice = suggestedPrice / (1 - fee/100)
 * Tabelas com taxa fixa ficam em src/fees.js.
 *
 * @param {QuoteGeometry|null|undefined} geometry
 * @param {QuoteSettings} settings
 * @param {{massGrams?: number|null, printTimeSeconds?: number|null, massSource?: string, timeSource?: string}} [measured]
 */
export function calculateQuote(geometry, settings, measured) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  const geom = geometry && typeof geometry === "object" ? geometry : { volumeMm3: 0, surfaceAreaMm2: 0 };
  const material = estimateMaterialVolume(geom, s);
  const estimatedMassGrams = massGramsFromVolume(material.materialVolumeMm3, s.densityGCm3);
  const estimatedPrintTimeSeconds = estimatePrintTimeSeconds(material.materialVolumeMm3, s);
  const measuredMass = explicitNumber(measured?.massGrams);
  const measuredTime = explicitNumber(measured?.printTimeSeconds);
  const hasGeometry = !!(geometry && typeof geometry === "object");
  const massGrams = measuredMass != null ? Math.max(0, measuredMass) : estimatedMassGrams;
  const printTimeSeconds = measuredTime != null ? Math.max(0, measuredTime) : estimatedPrintTimeSeconds;
  const printTimeHours = printTimeSeconds / 3600;

  const filamentCost = (massGrams / 1000) * Math.max(0, Number(s.filamentPricePerKg) || 0);
  const energyCost =
    printTimeHours * (Math.max(0, Number(s.printerPowerW) || 0) / 1000) * Math.max(0, Number(s.energyPricePerKwh) || 0);
  const machineCost = printTimeHours * Math.max(0, Number(s.machineDepreciationPerHour) || 0);
  const laborCost = Math.max(0, Number(s.laborSetupFee) || 0);

  const baseCost = filamentCost + energyCost + machineCost + laborCost;
  const failureMargin = clamp(Number(s.failureMarginPercent) || 0, 0, 100) / 100;
  const failureCost = baseCost * failureMargin;
  const costTotal = baseCost + failureCost;

  const profitMargin = Math.max(0, Number(s.profitMarginPercent) || 0) / 100;
  const suggestedPrice = costTotal * (1 + profitMargin);

  const fee = clamp(Number(s.marketplaceFeePercent) || 0, 0, 99) / 100;
  const listingPrice = fee < 1 ? suggestedPrice / (1 - fee) : suggestedPrice;
  const marketplaceFeeAmount = listingPrice - suggestedPrice;
  const netAfterFee = listingPrice - marketplaceFeeAmount;

  return {
    material,
    massGrams,
    printTimeSeconds,
    printTimeHours,
    massSource: measuredMass != null ? measured?.massSource || "measured" : hasGeometry ? "estimate" : "none",
    timeSource: measuredTime != null ? measured?.timeSource || "measured" : hasGeometry ? "estimate" : "none",
    estimatedMassGrams,
    estimatedPrintTimeSeconds,
    costs: {
      filament: filamentCost,
      energy: energyCost,
      machine: machineCost,
      labor: laborCost,
      failure: failureCost,
    },
    baseCost,
    costTotal,
    suggestedPrice,
    listingPrice,
    marketplaceFeeAmount,
    marketplaceFeePercent: fee * 100,
    netAfterFee,
  };
}

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 */
export function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}
