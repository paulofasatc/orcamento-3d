/**
 * Totais do PDF e uma geração mínima com o jsPDF vendido.
 */
import { createRequire } from "node:module";
import {
  addDaysIso,
  buildQuoteDocument,
  formatDateBR,
  formatPdfMoney,
  quoteLineItems,
} from "../src/pdf.js";

globalThis.self = globalThis;
const require = createRequire(import.meta.url);
require("../vendor/jspdf.umd.min.js");
const { jsPDF } = globalThis.jspdf;

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

console.log("Orça3D — PDF\n");

assert(formatDateBR("2026-11-11") === "11/11/2026", "data em pt-BR");
assert(addDaysIso("2026-11-11", 7) === "2026-11-18", "validade de 7 dias");
assert(addDaysIso("2026-12-30", 5) === "2027-01-04", "validade atravessa o ano");
assert(formatPdfMoney(10.5).includes("10,50"), "moeda com vírgula", formatPdfMoney(10.5));

const quoted = quoteLineItems([
  { description: "Suporte", quantity: 2, unitPrice: 15.5 },
  { description: "", quantity: 0, unitPrice: 10 },
]);
assert(quoted.lines[0].total === 31, "quantidade vezes preço");
assert(quoted.lines[1].quantity === 1, "quantidade vazia vira 1");
assert(quoted.total === 41, "total do PDF soma as linhas");

const doc = buildQuoteDocument(jsPDF, {
  businessName: "Oficina do Paulo",
  businessContact: "paulo@example.com · (11) 90000-0000",
  customerName: "Cliente Exemplo",
  customerContact: "contato@cliente.com",
  quoteNumber: "ORC-20261111-01",
  quoteDate: "2026-11-11",
  validityDays: 7,
  notes: "Peça em PLA. Prazo após a aprovação.",
  items: [{ description: "Suporte de câmera", quantity: 2, unitPrice: 40 }],
});
const bytes = Buffer.from(doc.output("arraybuffer"));
assert(bytes.subarray(0, 5).toString() === "%PDF-", "arquivo começa como PDF");
assert(bytes.length > 1000, "PDF tem conteúdo");

console.log(`\n${passed} ok, ${failed} falha(s)`);
if (failed > 0) process.exit(1);
