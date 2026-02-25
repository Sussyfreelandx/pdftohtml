/**
 * Certificate / award template.
 *
 * @param {object} data
 * @param {string} data.title         – e.g. "Certificate of Completion"
 * @param {string} data.recipientName
 * @param {string} data.description
 * @param {string} [data.date]
 * @param {string} [data.issuer]
 * @param {string} [data.verifyUrl]   – clickable verification link
 * @returns {object} spec
 */
function certificateTemplate(data) {
  const elements = [];

  elements.push({ type: "spacer", lines: 3 });

  // Decorative border (approximated with a rect)
  elements.push({
    type: "rect",
    x: 30, y: 30,
    width: 535, height: 780,
    stroke: "#B8860B",
    lineWidth: 3,
  });

  elements.push({ type: "spacer", lines: 1 });
  elements.push({ type: "heading", level: 1, value: data.title || "CERTIFICATE", align: "center", color: "#B8860B", fontSize: 30 });
  elements.push({ type: "spacer", lines: 1 });
  elements.push({ type: "text", value: "This is proudly presented to", align: "center", fontSize: 14, color: "#555555" });
  elements.push({ type: "spacer", lines: 0.5 });
  elements.push({ type: "heading", level: 1, value: data.recipientName || "Recipient Name", align: "center", color: "#1B3A5C", fontSize: 28 });
  elements.push({ type: "spacer", lines: 0.5 });
  elements.push({ type: "text", value: data.description || "", align: "center", fontSize: 13, color: "#333333", moveDown: 1 });

  if (data.date) {
    elements.push({ type: "text", value: `Date: ${data.date}`, align: "center", fontSize: 12, color: "#555555" });
  }
  if (data.issuer) {
    elements.push({ type: "text", value: `Issued by: ${data.issuer}`, align: "center", fontSize: 12, color: "#555555", moveDown: 1 });
  }

  if (data.verifyUrl) {
    elements.push({ type: "spacer", lines: 1 });
    elements.push({
      type: "link",
      value: "🔗 Verify this certificate online",
      url: data.verifyUrl,
      align: "center",
      fontSize: 11,
      color: "#0B6623",
    });
  }

  return {
    size: "A4",
    margins: { top: 50, bottom: 50, left: 50, right: 50 },
    meta: { Title: data.title || "Certificate" },
    elements,
  };
}

module.exports = certificateTemplate;
