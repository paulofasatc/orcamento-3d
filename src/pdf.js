/**
 * PDF do orçamento para o cliente. Não inclui custo interno.
 * O construtor do jsPDF é injetado para o arquivo continuar testável
 * e para o navegador carregar a biblioteca só na hora de baixar.
 */

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function formatPdfMoney(value) {
  return money.format(Number(value) || 0).replace(/\u00a0/g, " ");
}

export function formatDateBR(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  if (!match) return "";
  return `${match[3]}/${match[2]}/${match[1]}`;
}

export function addDaysIso(iso, days) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  if (!match) return "";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  const extra = Number.isFinite(Number(days)) ? Math.round(Number(days)) : 0;
  date.setUTCDate(date.getUTCDate() + extra);
  return date.toISOString().slice(0, 10);
}

/**
 * @param {Array<{description?: string, quantity?: number, unitPrice?: number}>} items
 */
function cents(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export function quoteLineItems(items) {
  const lines = (Array.isArray(items) ? items : []).map((item, index) => {
    const quantity = Math.max(1, Math.round(Number(item?.quantity) || 1));
    const unitPrice = cents(Math.max(0, Number(item?.unitPrice) || 0));
    return {
      description: String(item?.description || `Item ${index + 1}`).slice(0, 180),
      quantity,
      unitPrice,
      total: cents(quantity * unitPrice),
    };
  });
  const total = cents(lines.reduce((sum, line) => sum + line.total, 0));
  return { lines, total };
}

/**
 * @param {new (...args: unknown[]) => object} JsPDF
 * @param {object} input
 */
export function buildQuoteDocument(JsPDF, input) {
  const doc = new JsPDF({ unit: "mm", format: "a4" });
  const { lines, total } = quoteLineItems(input.items);
  const margin = 16;
  const pageWidth = 210;
  const right = pageWidth - margin;

  doc.setFillColor(194, 74, 22);
  doc.rect(0, 0, pageWidth, 32, "F");
  doc.setTextColor(255, 250, 243);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("Orçamento", margin, 16);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(input.quoteNumber ? `Nº ${input.quoteNumber}` : "Sem número", margin, 24);

  let y = 42;
  if (input.logoDataUrl) {
    try {
      const format = /image\/png/i.test(input.logoDataUrl) ? "PNG" : "JPEG";
      doc.addImage(input.logoDataUrl, format, margin, y, 22, 22);
    } catch {
      // logo ilegível não impede o PDF
    }
  }
  const textX = input.logoDataUrl ? margin + 28 : margin;
  doc.setTextColor(28, 22, 18);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(input.businessName || "Orçamento de impressão 3D", textX, y + 6);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(63, 56, 50);
  const contact = doc.splitTextToSize(input.businessContact || "", 120);
  if (contact.length) doc.text(contact, textX, y + 12);
  y = Math.max(y + 28, y + 12 + contact.length * 4.5);

  const validUntil = addDaysIso(input.quoteDate, input.validityDays ?? 7);
  const meta = [
    ["Data", formatDateBR(input.quoteDate) || "—"],
    ["Validade", validUntil ? `${formatDateBR(validUntil)} (${input.validityDays ?? 7} dias)` : "—"],
    ["Cliente", input.customerName || "—"],
    ["Contato", input.customerContact || "—"],
  ];
  y += 4;
  doc.setDrawColor(227, 219, 207);
  doc.setFillColor(247, 241, 232);
  doc.roundedRect(margin, y, right - margin, 28, 2, 2, "F");
  doc.setFontSize(9);
  meta.forEach((entry, index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const x = margin + 4 + col * 88;
    const lineY = y + 8 + row * 12;
    doc.setTextColor(122, 114, 106);
    doc.text(entry[0], x, lineY);
    doc.setTextColor(28, 22, 18);
    doc.text(doc.splitTextToSize(entry[1], 80)[0] || "—", x, lineY + 4.5);
  });
  y += 36;

  doc.setFillColor(28, 22, 18);
  doc.rect(margin, y, right - margin, 8, "F");
  doc.setTextColor(255, 250, 243);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("Item", margin + 2, y + 5.4);
  doc.text("Qtd", 122, y + 5.4);
  doc.text("Unitário", 142, y + 5.4);
  doc.text("Total", right - 2, y + 5.4, { align: "right" });
  y += 8;

  doc.setFont("helvetica", "normal");
  doc.setTextColor(28, 22, 18);
  if (!lines.length) {
    y += 8;
    doc.setTextColor(122, 114, 106);
    doc.text("Nenhum item neste orçamento.", margin + 2, y);
    y += 6;
  }
  for (const line of lines) {
    const description = doc.splitTextToSize(line.description, 96);
    const rowHeight = Math.max(8, description.length * 4.4 + 3);
    if (y + rowHeight > 250) {
      doc.addPage();
      y = 20;
    }
    doc.setFillColor(255, 250, 243);
    doc.rect(margin, y, right - margin, rowHeight, "F");
    doc.setTextColor(28, 22, 18);
    doc.text(description, margin + 2, y + 5);
    doc.text(String(line.quantity), 122, y + 5);
    doc.text(formatPdfMoney(line.unitPrice), 142, y + 5);
    doc.text(formatPdfMoney(line.total), right - 2, y + 5, { align: "right" });
    y += rowHeight;
  }

  y += 4;
  doc.setFillColor(253, 230, 216);
  doc.roundedRect(120, y, right - 120, 14, 2, 2, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(154, 56, 16);
  doc.text("Total", 126, y + 9);
  doc.text(formatPdfMoney(total), right - 4, y + 9, { align: "right" });
  y += 22;

  if (input.notes) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(28, 22, 18);
    doc.text("Observações", margin, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(63, 56, 50);
    const notes = doc.splitTextToSize(String(input.notes), right - margin);
    doc.text(notes, margin, y + 5);
    y += 8 + notes.length * 4.4;
  }

  doc.setFontSize(8);
  doc.setTextColor(122, 114, 106);
  const footer = doc.splitTextToSize(
    "Documento para o cliente. Os valores são o preço de venda, sem o detalhamento interno de filamento, energia, máquina ou taxas.",
    right - margin
  );
  doc.text(footer, margin, Math.min(285, Math.max(y + 8, 270)));
  return doc;
}
