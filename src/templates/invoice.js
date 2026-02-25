/**
 * Invoice template — generates a professional invoice PDF spec.
 *
 * @param {object} data
 * @param {object} data.company       – { name, address, phone, email, website }
 * @param {object} data.client        – { name, address, email }
 * @param {string} data.invoiceNumber
 * @param {string} data.date
 * @param {string} data.dueDate
 * @param {Array}  data.items         – [{ description, quantity, unitPrice }]
 * @param {number} [data.taxRate]     – e.g. 0.1 for 10 %
 * @param {string} [data.notes]
 * @param {object} [data.payment]     – { method, details, link }
 * @returns {object} spec ready for PDFEngine
 */
function invoiceTemplate(data) {
  const items = data.items || [];
  const taxRate = data.taxRate || 0;
  const subtotal = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
  const tax = subtotal * taxRate;
  const total = subtotal + tax;
  const fmt = (n) => `$${n.toFixed(2)}`;

  const elements = [];

  // Header columns: company info + invoice info
  elements.push({
    type: "columns",
    columns: [
      {
        elements: [
          { type: "heading", level: 2, value: data.company?.name || "Company Name", color: "#2E5090" },
          { type: "text", value: data.company?.address || "", fontSize: 10, color: "#555555" },
          { type: "text", value: data.company?.phone || "", fontSize: 10, color: "#555555" },
          data.company?.email
            ? { type: "link", value: data.company.email, url: `mailto:${data.company.email}`, fontSize: 10 }
            : null,
          data.company?.website
            ? { type: "link", value: data.company.website, url: data.company.website, fontSize: 10 }
            : null,
        ].filter(Boolean),
      },
      {
        elements: [
          { type: "heading", level: 1, value: "INVOICE", align: "right", color: "#2E5090" },
          { type: "text", value: `Invoice #: ${data.invoiceNumber || "0001"}`, align: "right", fontSize: 11 },
          { type: "text", value: `Date: ${data.date || new Date().toLocaleDateString()}`, align: "right", fontSize: 11 },
          { type: "text", value: `Due: ${data.dueDate || "On receipt"}`, align: "right", fontSize: 11 },
        ],
      },
    ],
  });

  elements.push({ type: "divider", color: "#2E5090", thickness: 2, spacing: 15 });

  // Bill-to
  elements.push({ type: "heading", level: 4, value: "Bill To:", color: "#2E5090" });
  elements.push({ type: "text", value: data.client?.name || "", fontSize: 11 });
  elements.push({ type: "text", value: data.client?.address || "", fontSize: 10, color: "#555555" });
  if (data.client?.email) {
    elements.push({ type: "link", value: data.client.email, url: `mailto:${data.client.email}`, fontSize: 10 });
  }
  elements.push({ type: "spacer", lines: 1 });

  // Items table
  const rows = items.map((item) => [
    item.description,
    String(item.quantity),
    fmt(item.unitPrice),
    fmt(item.quantity * item.unitPrice),
  ]);
  // Totals rows
  rows.push(["", "", "Subtotal", fmt(subtotal)]);
  if (taxRate) rows.push(["", "", `Tax (${(taxRate * 100).toFixed(0)}%)`, fmt(tax)]);
  rows.push(["", "", "Total", fmt(total)]);

  elements.push({
    type: "table",
    headers: ["Description", "Qty", "Unit Price", "Amount"],
    rows,
    headerBackground: "#2E5090",
    fontSize: 10,
  });

  elements.push({ type: "spacer", lines: 1 });

  // Payment link
  if (data.payment?.link) {
    elements.push({
      type: "link",
      value: `💳 Pay Now — ${data.payment.method || "Online"}`,
      url: data.payment.link,
      fontSize: 12,
      color: "#0B6623",
    });
    elements.push({ type: "spacer", lines: 0.5 });
  }

  // Notes
  if (data.notes) {
    elements.push({ type: "heading", level: 5, value: "Notes", color: "#2E5090" });
    elements.push({ type: "text", value: data.notes, fontSize: 10, color: "#555555" });
  }

  return {
    meta: { Title: `Invoice ${data.invoiceNumber || ""}`, Author: data.company?.name },
    pageNumbers: { align: "center", fontSize: 9 },
    elements,
  };
}

module.exports = invoiceTemplate;
