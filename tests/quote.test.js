/**
 * Testes do parser STL e do módulo de orçamento.
 * Gera um cubo de 20 mm e verifica volume = 8000 mm³.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildGeometry,
  cubeTriangles,
  parseStl,
  trianglesToAsciiStl,
  trianglesToBinaryStl,
} from "../src/stl.js";
import {
  DEFAULT_SETTINGS,
  calculateQuote,
  estimateMaterialVolume,
  estimatePrintTimeSeconds,
  massGramsFromVolume,
} from "../src/quote.js";

const dir = dirname(fileURLToPath(import.meta.url));
let passed = 0;
let failed = 0;

function assert(condition, message, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  ok  ${message}`);
  } else {
    failed += 1;
    console.error(`  FAIL  ${message}${detail ? `\n        ${detail}` : ""}`);
  }
}

function almostEqual(a, b, eps = 1e-4) {
  return Math.abs(a - b) <= eps;
}

console.log("Orça3D — testes\n");

const SIZE = 20;
const EXPECTED_VOLUME = 20 * 20 * 20; // 8000 mm³
const EXPECTED_AREA = 6 * 20 * 20; // 2400 mm²
const triangles = cubeTriangles(SIZE);

const ascii = trianglesToAsciiStl(triangles, "cube20mm");
const asciiPath = join(dir, "cube.stl");
writeFileSync(asciiPath, ascii, "utf8");

const binaryBuffer = trianglesToBinaryStl(triangles, "cube20mm binary");
const binaryPath = join(dir, "cube-binary.stl");
writeFileSync(binaryPath, Buffer.from(binaryBuffer));

console.log("Geometria do cubo de 20 mm");
const built = buildGeometry(triangles);
assert(
  almostEqual(built.volumeMm3, EXPECTED_VOLUME, 1e-3),
  `volume direto = 8000 mm³`,
  `obtido ${built.volumeMm3}`
);
assert(built.signedVolumeMm3 > 0, "volume com sinal positivo (normais para fora)");
assert(
  almostEqual(built.surfaceAreaMm2, EXPECTED_AREA, 1e-3),
  `área de superfície = 2400 mm²`,
  `obtido ${built.surfaceAreaMm2}`
);
assert(
  almostEqual(built.boundingBox.size.x, 20) &&
    almostEqual(built.boundingBox.size.y, 20) &&
    almostEqual(built.boundingBox.size.z, 20),
  "caixa delimitadora 20 × 20 × 20 mm"
);

console.log("\nParser STL ASCII");
function toArrayBuffer(data) {
  const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
}

const asciiGeom = parseStl(toArrayBuffer(Buffer.from(ascii, "utf8")), "cube.stl");
assert(asciiGeom.format === "ascii", `formato ASCII detectado (foi ${asciiGeom.format})`);
assert(
  almostEqual(asciiGeom.volumeMm3, EXPECTED_VOLUME, 1e-3),
  "volume ASCII = 8000 mm³",
  `obtido ${asciiGeom.volumeMm3}`
);

console.log("\nParser STL binário");
const binGeom = parseStl(binaryBuffer, "cube-binary.stl");
assert(binGeom.format === "binary", `formato binário detectado (foi ${binGeom.format})`);
assert(
  almostEqual(binGeom.volumeMm3, EXPECTED_VOLUME, 1e-3),
  "volume binário = 8000 mm³",
  `obtido ${binGeom.volumeMm3}`
);
assert(binGeom.triangleCount === 12, `12 triângulos (foi ${binGeom.triangleCount})`);

console.log("\nOrçamento (casca + preenchimento e custos)");
const material = estimateMaterialVolume(asciiGeom, DEFAULT_SETTINGS);
// Espessura = 2 * 0.4 = 0.8 mm; casca = min(8000, 2400*0.8) = 1920
// interior = 6080; infill 20% = 1216; material = 3136 mm³
assert(almostEqual(material.wallThicknessMm, 0.8), "espessura das paredes = 0,8 mm");
assert(almostEqual(material.shellVolumeMm3, 1920, 1e-3), "volume da casca = 1920 mm³", `obtido ${material.shellVolumeMm3}`);
assert(almostEqual(material.infillVolumeMm3, 1216, 1e-3), "volume do preenchimento = 1216 mm³", `obtido ${material.infillVolumeMm3}`);
assert(almostEqual(material.materialVolumeMm3, 3136, 1e-3), "volume de material = 3136 mm³", `obtido ${material.materialVolumeMm3}`);

const mass = massGramsFromVolume(3136, 1.24);
assert(almostEqual(mass, 3.88864, 1e-6), "massa PLA = 3,88864 g", `obtido ${mass}`);

const timeS = estimatePrintTimeSeconds(3136, DEFAULT_SETTINGS);
// 3136 / 6 mm³/s + 5*60 = 522.666... + 300 = 822.666...
assert(almostEqual(timeS, 3136 / 6 + 300, 1e-6), "tempo = volume/vazão + preparação", `obtido ${timeS}`);

const quote = calculateQuote(asciiGeom, DEFAULT_SETTINGS);
assert(almostEqual(quote.massGrams, mass, 1e-8), "massa no orçamento bate com a fórmula");
assert(almostEqual(quote.printTimeSeconds, timeS, 1e-8), "tempo no orçamento bate com a fórmula");

const filament = (mass / 1000) * 99;
const energy = (timeS / 3600) * (150 / 1000) * 0.95;
const machine = (timeS / 3600) * 3;
const labor = 10;
const base = filament + energy + machine + labor;
const failure = base * 0.1;
const total = base + failure;
const suggested = total * 1.5;
const listing = suggested / (1 - 0.16);

assert(almostEqual(quote.costs.filament, filament, 1e-8), "custo de filamento");
assert(almostEqual(quote.costs.energy, energy, 1e-8), "custo de energia");
assert(almostEqual(quote.costs.machine, machine, 1e-8), "custo da máquina");
assert(almostEqual(quote.costs.labor, labor, 1e-8), "mão de obra");
assert(almostEqual(quote.costs.failure, failure, 1e-8), "reserva para falhas");
assert(almostEqual(quote.costTotal, total, 1e-8), "custo total");
assert(almostEqual(quote.suggestedPrice, suggested, 1e-8), "preço sugerido (custo + lucro)");
assert(almostEqual(quote.listingPrice, listing, 1e-8), "preço de anúncio reajustado pela taxa");
assert(almostEqual(quote.netAfterFee, suggested, 1e-8), "líquido após taxa = preço sugerido");

const noFee = calculateQuote(asciiGeom, { ...DEFAULT_SETTINGS, marketplaceFeePercent: 0 });
assert(almostEqual(noFee.listingPrice, noFee.suggestedPrice, 1e-8), "sem taxa, anúncio = preço sugerido");
assert(quote.massSource === "estimate" && quote.timeSource === "estimate", "sem medição, a origem é a estimativa");

console.log("\nPeso e tempo informados substituem a estimativa");
const measured = calculateQuote(asciiGeom, DEFAULT_SETTINGS, {
  massGrams: 10,
  printTimeSeconds: 3600,
  massSource: "slicer",
  timeSource: "slicer",
});
const measuredFilament = (10 / 1000) * 99;
const measuredEnergy = 1 * (150 / 1000) * 0.95;
const measuredMachine = 1 * 3;
assert(almostEqual(measured.massGrams, 10), "massa medida = 10 g");
assert(almostEqual(measured.printTimeSeconds, 3600), "tempo medido = 1 h");
assert(measured.massSource === "slicer" && measured.timeSource === "slicer", "origem marcada como fatiador");
assert(almostEqual(measured.costs.filament, measuredFilament, 1e-8), "filamento usa a massa medida");
assert(almostEqual(measured.costs.energy, measuredEnergy, 1e-8), "energia usa o tempo medido");
assert(almostEqual(measured.costs.machine, measuredMachine, 1e-8), "máquina usa o tempo medido");
assert(almostEqual(measured.estimatedMassGrams, mass, 1e-6), "a estimativa original continua disponível");

const onlyMass = calculateQuote(asciiGeom, DEFAULT_SETTINGS, { massGrams: 10 });
assert(almostEqual(onlyMass.massGrams, 10), "só a massa é substituída");
assert(almostEqual(onlyMass.printTimeSeconds, timeS, 1e-6), "o tempo segue a estimativa");

const manualOnly = calculateQuote(null, DEFAULT_SETTINGS, { massGrams: 4, printTimeSeconds: 600 });
assert(almostEqual(manualOnly.massGrams, 4) && almostEqual(manualOnly.printTimeSeconds, 600), "orçamento sem STL, só com valores informados");
assert(manualOnly.costTotal > 0, "custo sem STL é positivo");

console.log("\nSTL inválido");
let threw = false;
try {
  parseStl(new TextEncoder().encode("not an stl").buffer);
} catch {
  threw = true;
}
assert(threw, "arquivo inválido lança erro");

console.log(`\n${passed} ok, ${failed} falha(s)`);
if (failed > 0) {
  process.exit(1);
}
