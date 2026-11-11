/**
 * Preço de anúncio para o líquido desejado, com as tabelas de
 * Mercado Livre e Shopee em data/fees.json.
 *
 * A taxa fixa depende da faixa do próprio preço de anúncio, então cada
 * faixa é testada em fórmula fechada: preço = (líquido + fixo) / (1 - alíquota).
 * Só vale a faixa em que o preço resultante cai.
 */

export const FEE_DEFAULTS = Object.freeze({
  feeMode: "custom",
  mlListingType: "classico",
  mlLogistics: "me2",
  mlPercent: "",
  mlFixedOverride: "",
  shopeeProgram: "cnpj",
  shopeeFull: "none",
});

/**
 * @param {object} settings
 */
export function selectionFromSettings(settings) {
  const mode = settings?.feeMode || "custom";
  if (mode !== "mercado-livre" && mode !== "shopee") return null;
  const percent = settings.mlPercent === "" || settings.mlPercent == null ? null : Number(settings.mlPercent);
  const override =
    settings.mlFixedOverride === "" || settings.mlFixedOverride == null
      ? null
      : Number(settings.mlFixedOverride);
  return {
    marketplaceId: mode,
    programId: settings.shopeeProgram || "cnpj",
    fullPlus: settings.shopeeFull || "none",
    percent: Number.isFinite(percent) ? percent : null,
    logistics: settings.mlLogistics || "me2",
    fixedFeeOverride: Number.isFinite(override) ? override : null,
    listingType: settings.mlListingType || "classico",
  };
}

/**
 * @param {object} catalog
 * @param {string} id
 */
export function getMarketplace(catalog, id) {
  return catalog?.marketplaces?.find((item) => item.id === id) ?? null;
}

function blankResult(market, extra = {}) {
  return {
    ok: false,
    marketplaceId: market?.id ?? null,
    marketplaceName: market?.name ?? "",
    listingPrice: null,
    percent: null,
    percentFee: null,
    fixedFee: null,
    feeTotal: null,
    net: null,
    bandLabel: "",
    confirmed: false,
    needsFixedFee: false,
    warnings: [],
    message: "",
    sourceUrl: market?.sourceUrl ?? "",
    secondarySourceUrl: market?.secondarySourceUrl ?? "",
    updatedAt: market?.updatedAt ?? null,
    updatedAtLabel: market?.updatedAtLabel ?? "",
    notes: market?.notes ?? [],
    bands: [],
    ...extra,
  };
}

function programOf(market, programId) {
  return market.programs?.find((item) => item.id === programId) ?? market.programs?.[0] ?? null;
}

function fullPlusOf(market, id) {
  return market.fullPlus?.find((item) => item.id === id) ?? market.fullPlus?.[0] ?? { adjustments: [] };
}

/**
 * Faixas visíveis para o programa escolhido, já com o ajuste do Full+.
 * @param {object} market
 * @param {{programId?: string, fullPlus?: string, percent?: number|null, logistics?: string}} selection
 */
export function bandsForSelection(market, selection) {
  if (!market) return [];
  if (market.id === "mercado-livre") {
    const logistics = market.logistics?.find((item) => item.id === selection.logistics) ?? market.logistics?.[0];
    const percent = selection.percent;
    if (!logistics?.chargesFixedFee) {
      return [
        {
          min: 0,
          max: null,
          percent,
          fixedKind: "amount",
          fixed: 0,
          confirmed: true,
          label: `${logistics?.name || "Esta logística"}: sem custo fixo, só o percentual da categoria`,
        },
      ];
    }
    return (market.fixedFeeRules || []).map((rule) => ({ ...rule, percent }));
  }

  const programId = selection.programId || market.programs?.[0]?.id;
  const base = (market.bands || []).filter((band) => !band.programs || band.programs.includes(programId));
  const adjustments = fullPlusOf(market, selection.fullPlus || "none").adjustments || [];
  return splitByAdjustments(base, adjustments);
}

function splitByAdjustments(bands, adjustments) {
  if (!adjustments.length) return bands.map((band) => ({ ...band }));
  const cuts = new Set();
  for (const band of bands) {
    cuts.add(band.min);
    if (band.max != null) cuts.add(band.max);
  }
  for (const adjustment of adjustments) {
    cuts.add(adjustment.min);
    if (adjustment.max != null) cuts.add(adjustment.max);
  }
  const points = [...cuts].sort((a, b) => a - b);
  const pieces = [];
  for (let i = 0; i < points.length; i += 1) {
    const min = points[i];
    const max = i + 1 < points.length ? points[i + 1] : null;
    const band = bands.find((item) => min >= item.min && (item.max == null || min < item.max));
    if (!band) continue;
    if (max != null && max <= band.min) continue;
    const pieceMax = band.max == null ? max : max == null ? band.max : Math.min(max, band.max);
    if (pieceMax != null && pieceMax <= min) continue;
    const delta = adjustments.reduce(
      (sum, item) => (min >= item.min && (item.max == null || min < item.max) ? sum + item.delta : sum),
      0
    );
    const percent = Math.round((band.percent + delta) * 1000) / 1000;
    const label = delta
      ? `${band.label} · Full+ ${delta > 0 ? "+" : ""}${formatDelta(delta)} p.p.`
      : band.label;
    pieces.push({ ...band, min, max: pieceMax, percent, label });
  }
  return pieces;
}

function formatDelta(delta) {
  return Number.isInteger(delta) ? String(delta) : String(delta).replace(".", ",");
}

function inBand(price, band) {
  const max = band.max == null ? Infinity : band.max;
  return price >= band.min - 1e-6 && price < max - 1e-6;
}

export const SELLER_SHIPPING_DEFAULT = 13.9;
export const PREVIOUS_SHIPPING_DEFAULT = 6.85;

/**
 * Se o navegador ainda tem o padrão antigo de R$ 6,85, passa para R$ 13,90.
 * Outros valores digitados pelo vendedor são mantidos.
 * @param {unknown} value
 * @returns {string}
 */
export function migrateShippingAmount(value) {
  if (value == null || String(value).trim() === "") return SELLER_SHIPPING_DEFAULT.toFixed(2);
  const n = Number(String(value).trim().replace(",", "."));
  if (Number.isFinite(n) && Math.abs(n - PREVIOUS_SHIPPING_DEFAULT) < 0.001) {
    return SELLER_SHIPPING_DEFAULT.toFixed(2);
  }
  return String(value).trim();
}

/**
 * Frete pago pelo vendedor. Com o frete ligado, o mesmo valor entra em
 * qualquer faixa de preço. A Shopee não tem esse custo aqui.
 */
export function resolveShipping(market, _price, options = {}) {
  if (!options.enabled) {
    return {
      amount: 0,
      applied: false,
      confirmed: true,
      sellerReported: false,
      needsOverride: false,
      excluded: false,
      label: "Frete desligado",
    };
  }
  const shipping = market?.shipping;
  if (!shipping) {
    return {
      amount: 0,
      applied: false,
      confirmed: true,
      sellerReported: false,
      needsOverride: false,
      excluded: true,
      label: "O frete da Shopee não entra neste cálculo",
    };
  }
  const fallback = Number(shipping.defaultAmount);
  const amount = options.overrideAmount == null || !Number.isFinite(Number(options.overrideAmount))
    ? (Number.isFinite(fallback) ? fallback : SELLER_SHIPPING_DEFAULT)
    : Math.max(0, Number(options.overrideAmount));
  return {
    amount,
    applied: true,
    confirmed: true,
    sellerReported: false,
    needsOverride: false,
    excluded: false,
    label: shipping.label || shipping.sourceNote || "Frete pago pelo vendedor",
  };
}

/**
 * @param {number} targetNet
 * @param {object} selection
 * @param {object} catalog
 */
export function solveListingPrice(targetNet, selection, catalog) {
  const market = getMarketplace(catalog, selection?.marketplaceId);
  if (!market) return blankResult(null, { message: "Marketplace não encontrado na tabela." });

  const target = Number(targetNet);
  if (!Number.isFinite(target) || target < 0) {
    return blankResult(market, { message: "O preço que você quer receber precisa ser um número válido." });
  }

  const warnings = [];
  let extraFixed = 0;
  if (market.id === "shopee") {
    const program = programOf(market, selection.programId);
    if (!program) return blankResult(market, { message: "Escolha o tipo de vendedor na Shopee." });
    extraFixed = Number(program.extraFixed) || 0;
  }

  let percentForRange = null;
  if (market.id === "mercado-livre") {
    const listing = market.listingTypes.find((item) => item.id === selection.listingType) ?? market.listingTypes[0];
    const percent = selection.percent;
    if (percent == null || !Number.isFinite(percent) || percent < 0 || percent >= 100) {
      return blankResult(market, {
        message: `Informe o percentual da categoria. No ${listing.name} a página oficial só publica a faixa de ${listing.percentMin}% a ${listing.percentMax}%, não o valor de cada categoria.`,
        bands: market.fixedFeeRules || [],
      });
    }
    percentForRange = listing;
    if (percent < listing.percentMin || percent > listing.percentMax) {
      warnings.push(
        `${percent}% está fora da faixa oficial de ${listing.percentMin}% a ${listing.percentMax}% do anúncio ${listing.name}. A conta usa o percentual que você informou.`
      );
    }
  }

  const shippingOptions = {
    enabled: Boolean(selection.shipping?.enabled),
    weightGrams: selection.shipping?.weightGrams,
    overrideAmount:
      selection.shipping?.overrideAmount == null || selection.shipping.overrideAmount === ""
        ? null
        : Number(selection.shipping.overrideAmount),
    logistics: selection.logistics,
  };
  if (shippingOptions.overrideAmount != null && !Number.isFinite(shippingOptions.overrideAmount)) {
    shippingOptions.overrideAmount = null;
  }
  const bands = bandsForSelection(market, selection);
  const ship = resolveShipping(market, 0, shippingOptions);
  const override = selection.fixedFeeOverride;
  /** @type {object[]} */
  const candidates = [];

  for (const band of bands) {
    const solved = solveBand(band, target, extraFixed, override, ship.amount || 0);
    if (!solved) continue;
    if (!inBand(solved.listingPrice, band)) continue;
    candidates.push({ ...solved, band, shipping: ship });
  }

  const firm = candidates.filter((item) => !item.assumedUnknownFixed);
  if (!firm.length) {
    const unknown = bands.find((band) => band.fixedKind === "unknown");
    return blankResult(market, {
      needsFixedFee: Boolean(unknown),
      needsShipping: false,
      message: unknown
        ? "O anúncio cai na faixa em que o Mercado Livre não publica o custo fixo. Informe o valor do simulador de custos para fechar o preço."
        : "Não foi possível achar um preço de anúncio compatível com as faixas desta tabela.",
      warnings,
      bands,
    });
  }

  firm.sort((a, b) => a.listingPrice - b.listingPrice);
  const best = firm[0];
  const confirmed = best.confirmed && warnings.length === 0 && best.band.confirmed !== false;

  if (market.id === "shopee" && (selection.programId === "cpf" || selection.programId === "cpf-alto") && best.listingPrice < 12) {
    warnings.push(
      "Abaixo de R$ 12 a Shopee diz que a taxa por item do CPF é regressiva, mas não publica a fórmula. A conta usa a faixa da tabela e pode ficar acima do valor real."
    );
  }
  if (best.assumedUnknownFixed) {
    warnings.push(
      "O custo fixo desta faixa não está na página oficial e não foi informado. Ele ficou de fora da conta."
    );
  }
  if (override != null && best.band.fixedKind === "unknown") {
    warnings.push("O custo fixo usado foi o que você informou. A página oficial não publica esse valor.");
  }
  if (best.shipping?.sellerReported) {
    warnings.push(`${best.shipping.label} Não confirmado na tabela oficial.`);
  }
  if (best.shipping?.excluded) {
    warnings.push(best.shipping.label);
  }
  if (best.netAboveTarget) {
    warnings.push("O líquido fica um pouco acima do alvo: a faixa de frete muda de uma vez e não existe preço que feche exatamente.");
  }

  return {
    ok: true,
    marketplaceId: market.id,
    marketplaceName: market.name,
    listingPrice: best.listingPrice,
    percent: best.percent,
    percentFee: best.percentFee,
    fixedFee: best.fixedFee,
    shippingAmount: best.shippingAmount || 0,
    shippingLabel: best.shipping?.label || "",
    shippingConfirmed: best.shipping ? best.shipping.confirmed !== false && !best.shipping.sellerReported : true,
    feeTotal: best.percentFee + best.fixedFee + (best.shippingAmount || 0),
    net: best.net,
    bandLabel: best.band.label,
    confirmed: best.band.confirmed !== false && !best.assumedUnknownFixed && (percentForRange ? percentForRange.confirmed : true),
    needsFixedFee: false,
    warnings,
    message: "",
    sourceUrl: market.sourceUrl,
    secondarySourceUrl: market.secondarySourceUrl || "",
    updatedAt: market.updatedAt,
    updatedAtLabel: market.updatedAtLabel || "",
    notes: market.notes || [],
    bands,
    listingTypeName: percentForRange?.name || "",
  };
}

function solveBand(band, target, extraFixed, override, shippingAmount = 0) {
  let rate = Number(band.percent) / 100;
  let fixed = extraFixed + Math.max(0, Number(shippingAmount) || 0);
  let assumedUnknownFixed = false;
  if (!Number.isFinite(rate) || rate < 0) return null;
  if (band.fixedKind === "amount") fixed += Number(band.fixed) || 0;
  else if (band.fixedKind === "percent_of_price") rate += (Number(band.fixedPercent) || 0) / 100;
  else if (band.fixedKind === "unknown") {
    if (override == null) assumedUnknownFixed = true;
    else fixed += override;
  } else return null;
  if (rate >= 0.999) return null;
  const listingPrice = (target + fixed) / (1 - rate);
  if (!Number.isFinite(listingPrice) || listingPrice < 0) return null;
  const percentFee = listingPrice * (Number(band.percent) / 100);
  const ship = Math.max(0, Number(shippingAmount) || 0);
  const fixedFee = listingPrice - target - percentFee - ship;
  return {
    listingPrice,
    percent: band.percent,
    percentFee,
    fixedFee,
    shippingAmount: ship,
    net: listingPrice - percentFee - fixedFee - ship,
    assumedUnknownFixed,
    confirmed: band.confirmed !== false && !assumedUnknownFixed,
  };
}

