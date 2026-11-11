/**
 * Preço de anúncio com as tabelas confirmadas de Mercado Livre e Shopee.
 */
import { readFileSync } from "node:fs";
import { migrateShippingAmount, solveListingPrice } from "../src/fees.js";

const catalog = JSON.parse(readFileSync(new URL("../data/fees.json", import.meta.url), "utf8"));

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

function almostEqual(a, b, eps = 1e-6) {
  return Math.abs(a - b) <= eps;
}

console.log("Orça3D — taxas de marketplace\n");

console.log("Shopee CNPJ, exemplo oficial de R$ 500");
const shopee500 = solveListingPrice(404, {
  marketplaceId: "shopee",
  programId: "cnpj",
  fullPlus: "none",
}, catalog);
assert(shopee500.ok, "encontrou o preço");
assert(almostEqual(shopee500.listingPrice, 500), "anúncio = R$ 500", `obtido ${shopee500.listingPrice}`);
assert(almostEqual(shopee500.percentFee, 70), "14% de 500 = 70");
assert(almostEqual(shopee500.fixedFee, 26), "fixo R$ 26");
assert(almostEqual(shopee500.net, 404), "líquido R$ 404, como no exemplo da Shopee");
assert(shopee500.confirmed, "faixa confirmada");

console.log("\nShopee muda de faixa quando o fixo empurra o preço");
const shopee100 = solveListingPrice(100, {
  marketplaceId: "shopee",
  programId: "cnpj",
  fullPlus: "none",
}, catalog);
const expected = (100 + 20) / 0.86;
assert(almostEqual(shopee100.listingPrice, expected), "100 líquido cai em 14% + R$ 20", `obtido ${shopee100.listingPrice}`);
assert(shopee100.listingPrice > 100 && shopee100.listingPrice < 200, "o preço resultante está na faixa usada");
assert(almostEqual(shopee100.net, 100), "o líquido fecha no alvo");

console.log("\nShopee CNPJ abaixo de R$ 9");
const cheap = solveListingPrice(2, { marketplaceId: "shopee", programId: "cnpj", fullPlus: "none" }, catalog);
assert(almostEqual(cheap.listingPrice, 2 / 0.3), "20% + metade do preço", `obtido ${cheap.listingPrice}`);
assert(cheap.listingPrice < 9, "permanece abaixo de R$ 9");

console.log("\nShopee CPF de alto volume soma R$ 3");
const cpf = solveListingPrice(63, { marketplaceId: "shopee", programId: "cpf-alto", fullPlus: "none" }, catalog);
assert(almostEqual(cpf.listingPrice, (63 + 19) / 0.86), "o menor anúncio que entrega o líquido inclui R$ 3", `obtido ${cpf.listingPrice}`);
assert(almostEqual(cpf.fixedFee, 19), "fixo 16 + 3 na faixa de R$ 80");
assert(almostEqual(cpf.net, 63), "líquido fecha");

console.log("\nFull+ devolve 2 pontos a partir de R$ 80");
const full = solveListingPrice(68, { marketplaceId: "shopee", programId: "cnpj", fullPlus: "70" }, catalog);
assert(almostEqual(full.listingPrice, (68 + 16) / 0.88), "14% − 2 p.p. + R$ 16", `obtido ${full.listingPrice}`);
assert(almostEqual(full.percent, 12), "percentual efetivo 12%");
assert(almostEqual(full.net, 68), "líquido com Full+ fecha no alvo");

console.log("\nMercado Livre");
const mlShipping = solveListingPrice(88, {
  marketplaceId: "mercado-livre",
  listingType: "classico",
  percent: 12,
  logistics: "me2",
}, catalog);
assert(almostEqual(mlShipping.listingPrice, 100), "Envios sem custo fixo: 88 / 0,88 = 100");
assert(almostEqual(mlShipping.fixedFee, 0), "custo fixo zero");

const mlLow = solveListingPrice(3.04, {
  marketplaceId: "mercado-livre",
  listingType: "classico",
  percent: 12,
  logistics: "flex",
}, catalog);
assert(almostEqual(mlLow.listingPrice, 8, 1e-6), "R$ 8 no Flex: 50% + 12%", `obtido ${mlLow.listingPrice}`);
assert(almostEqual(mlLow.fixedFee, 4, 1e-6), "custo fixo de R$ 4, como no exemplo oficial");

const mlMissing = solveListingPrice(50, {
  marketplaceId: "mercado-livre",
  listingType: "premium",
  percent: null,
  logistics: "me2",
}, catalog);
assert(!mlMissing.ok && /faixa/i.test(mlMissing.message), "sem percentual de categoria, pede o valor e cita a faixa");

const mlOutside = solveListingPrice(88, {
  marketplaceId: "mercado-livre",
  listingType: "classico",
  percent: 8,
  logistics: "me2",
}, catalog);
assert(mlOutside.ok && mlOutside.warnings.some((w) => /fora da faixa/i.test(w)), "percentual fora da faixa oficial gera aviso");

const mlUnknown = solveListingPrice(5, {
  marketplaceId: "mercado-livre",
  listingType: "classico",
  percent: 12,
  logistics: "flex",
}, catalog);
assert(!mlUnknown.ok && mlUnknown.needsFixedFee, "faixa de R$ 12,50 a R$ 79 não inventa o custo fixo");

const mlOverride = solveListingPrice(5, {
  marketplaceId: "mercado-livre",
  listingType: "classico",
  percent: 12,
  logistics: "flex",
  fixedFeeOverride: 6.5,
}, catalog);
assert(mlOverride.ok, "com o custo fixo informado, fecha o preço");
assert(almostEqual(mlOverride.listingPrice, (5 + 6.5) / 0.88), "usa o fixo informado", `obtido ${mlOverride.listingPrice}`);
assert(mlOverride.listingPrice >= 12.5 && mlOverride.listingPrice < 79, "o preço cai na faixa do fixo");
assert(mlOverride.warnings.some((w) => /você informou/i.test(w)), "deixa claro que o valor não é o da página oficial");

console.log("\nFrete pago pelo vendedor");
const around40 = solveListingPrice(40, {
  marketplaceId: "mercado-livre",
  listingType: "classico",
  percent: 12,
  logistics: "me2",
  shipping: { enabled: true },
}, catalog);
assert(almostEqual(around40.listingPrice, (40 + 13.9) / 0.88), "por volta de R$ 40 o frete de R$ 13,90 entra", `obtido ${around40.listingPrice}`);
assert(almostEqual(around40.shippingAmount, 13.9), "padrão é R$ 13,90");
assert(around40.shippingLabel.includes("venda real"), "marca a venda real de nov/2026");

const around100 = solveListingPrice(100, {
  marketplaceId: "mercado-livre",
  listingType: "classico",
  percent: 12,
  logistics: "me2",
  shipping: { enabled: true, overrideAmount: 13.9 },
}, catalog);
assert(almostEqual(around100.listingPrice, (100 + 13.9) / 0.88), "por volta de R$ 100 o mesmo frete entra", `obtido ${around100.listingPrice}`);
assert(around100.listingPrice > 79, "não zera o frete acima de R$ 79");

const customShip = solveListingPrice(40, {
  marketplaceId: "mercado-livre",
  listingType: "classico",
  percent: 12,
  logistics: "me2",
  shipping: { enabled: true, overrideAmount: 10 },
}, catalog);
assert(almostEqual(customShip.shippingAmount, 10) && almostEqual(customShip.listingPrice, (40 + 10) / 0.88), "o valor digitado substitui o padrão de R$ 13,90");

const shipOff = solveListingPrice(40, {
  marketplaceId: "mercado-livre",
  listingType: "classico",
  percent: 12,
  logistics: "me2",
  shipping: { enabled: false, overrideAmount: 13.9 },
}, catalog);
assert(almostEqual(shipOff.listingPrice, 40 / 0.88) && almostEqual(shipOff.shippingAmount, 0), "com o frete desligado, o anúncio não soma o envio");

assert(migrateShippingAmount("6.85") === "13.90", "migra o padrão antigo 6,85");
assert(migrateShippingAmount("6,85") === "13.90", "migra 6,85 com vírgula");
assert(migrateShippingAmount("") === "13.90", "vazio passa a ser o novo padrão");
assert(migrateShippingAmount("10") === "10", "um valor digitado diferente permanece");

const shopeeShip = solveListingPrice(100, {
  marketplaceId: "shopee",
  programId: "cnpj",
  fullPlus: "none",
  shipping: { enabled: true, overrideAmount: 13.9 },
}, catalog);
assert(shopeeShip.ok && almostEqual(shopeeShip.shippingAmount, 0), "Shopee ignora o frete");
assert(shopeeShip.warnings.some((w) => /Shopee não entra/i.test(w)), "deixa explícito que o frete da Shopee não entra");

const sources = catalog.marketplaces.map((item) => item.sourceUrl);
assert(sources.every((url) => url.startsWith("https://")), "cada marketplace tem URL de fonte");
assert(catalog.consultedAt === "2026-11-11", "data da consulta registrada");

console.log(`\n${passed} ok, ${failed} falha(s)`);
if (failed > 0) process.exit(1);
