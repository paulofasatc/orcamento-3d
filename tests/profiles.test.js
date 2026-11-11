/**
 * Migração do ajuste único antigo e validação do JSON de perfis.
 */
import {
  addProfile,
  deleteProfile,
  duplicateProfile,
  loadLibrary,
  migrateLegacySettings,
  parseProfilesImport,
  ProfileError,
  serializeProfiles,
  settingsFromLibrary,
} from "../src/profiles.js";

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

function assertThrows(fn, pattern) {
  try {
    fn();
    assert(false, `deveria falhar (${pattern})`);
  } catch (err) {
    assert(err instanceof ProfileError && pattern.test(err.message), err.message || "erro sem mensagem");
  }
}

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = String(value);
    },
    removeItem: (key) => {
      delete data[key];
    },
    data,
  };
}

console.log("Orça3D — perfis\n");

console.log("Migração do objeto único");
const legacy = {
  material: "PETG",
  densityGCm3: 1.27,
  filamentPricePerKg: 120,
  printerPowerW: 220,
  machineDepreciationPerHour: 4.5,
  throughputMm3PerS: 8,
  infillPercent: 15,
  profitMarginPercent: 80,
  marketplaceFeePercent: 12,
};
const migrated = migrateLegacySettings(legacy);
assert(migrated.printers.length === 1 && migrated.filaments.length === 1, "cria um perfil de cada");
assert(migrated.printers[0].printerPowerW === 220, "guarda a potência antiga");
assert(migrated.printers[0].machineDepreciationPerHour === 4.5, "guarda a depreciação");
assert(migrated.printers[0].throughputMm3PerS === 8, "guarda a vazão");
assert(migrated.filaments[0].material === "PETG", "guarda o material");
assert(migrated.filaments[0].densityGCm3 === 1.27, "guarda a densidade editada");
assert(migrated.filaments[0].filamentPricePerKg === 120, "guarda o preço do kg");
assert(migrated.job.infillPercent === 15 && migrated.job.profitMarginPercent === 80, "guarda preenchimento e lucro");
assert(migrated.job.marketplaceFeePercent === 12 && migrated.job.feeMode === "custom", "a taxa antiga vira percentual único");
const settings = settingsFromLibrary(migrated);
assert(settings.printerPowerW === 220 && settings.material === "PETG" && settings.infillPercent === 15, "o orçamento usa os valores migrados");

const absOnly = migrateLegacySettings({ material: "ABS" });
assert(absOnly.filaments[0].material === "ABS" && absOnly.filaments[0].densityGCm3 === 1.04, "sem densidade, usa a do ABS");

console.log("\nlocalStorage");
const store = memoryStorage({ "orca3d:settings": JSON.stringify(legacy) });
const loaded = loadLibrary(store);
assert(loaded.filaments[0].filamentPricePerKg === 120, "a carga migra o valor salvo");
assert(store.getItem("orca3d:library"), "grava a biblioteca nova");
assert(store.getItem("orca3d:settings") == null, "remove o objeto antigo depois da migração");
store.setItem("orca3d:settings", JSON.stringify({ printerPowerW: 1 }));
const again = loadLibrary(store);
assert(again.printers[0].printerPowerW === 220, "a segunda carga não ressuscita o objeto antigo");

console.log("\nImportação e exportação");
const exported = serializeProfiles(migrated);
const imported = parseProfilesImport(exported);
assert(imported.printers[0].printerPowerW === 220 && imported.filaments[0].material === "PETG", "o JSON faz a volta completa");
assert(imported.job.infillPercent === 15, "os ajustes da peça vão junto");

assertThrows(() => parseProfilesImport("{"), /JSON válido/);
assertThrows(() => parseProfilesImport("[]"), /objeto JSON/);
assertThrows(() => parseProfilesImport("{}"), /impressora/);
assertThrows(
  () =>
    parseProfilesImport(
      JSON.stringify({
        app: "orca3d",
        kind: "profiles",
        printers: [{ name: "Ender", printerPowerW: "alta" }],
        filaments: [{ name: "PLA branco", material: "PLA", densityGCm3: 1.24, filamentPricePerKg: 90 }],
      })
    ),
  /Potência/
);
assertThrows(
  () =>
    parseProfilesImport(
      JSON.stringify({
        printers: [{ name: "Ok", printerPowerW: 100, energyPricePerKwh: 1, machineDepreciationPerHour: 1, lineWidthMm: 0.4, throughputMm3PerS: 5, referenceLayerHeightMm: 0.2, setupTimeMin: 5 }],
        filaments: [],
      })
    ),
  /filamento/
);
assertThrows(
  () =>
    parseProfilesImport(
      JSON.stringify({
        printers: [{ name: "Ok", printerPowerW: 100, energyPricePerKwh: 1, machineDepreciationPerHour: 1, lineWidthMm: 0.4, throughputMm3PerS: 5, referenceLayerHeightMm: 0.2, setupTimeMin: 5 }],
        filaments: [{ name: "Estranho", material: "NYLON", densityGCm3: 1.1, filamentPricePerKg: 80 }],
      })
    ),
  /material desconhecido/
);

console.log("\nCriar, duplicar e excluir");
let library = migrated;
library = addProfile(library, "filaments", { name: "PLA preto", material: "PLA", densityGCm3: 1.24, filamentPricePerKg: 89 });
assert(library.filaments.length === 2 && library.activeFilamentId === library.filaments[1].id, "novo filamento fica ativo");
const copy = duplicateProfile(library, "printers", library.printers[0].id);
assert(copy.printers.length === 2 && copy.printers[1].id !== copy.printers[0].id, "duplicar gera outro id");
assert(copy.printers[1].printerPowerW === 220, "a cópia leva os números");
assertThrows(() => deleteProfile({ ...copy, printers: [copy.printers[0]] }, "printers", copy.printers[0].id), /ao menos uma impressora/);

console.log(`\n${passed} ok, ${failed} falha(s)`);
if (failed > 0) process.exit(1);
