/**
 * Formal letter template.
 *
 * @param {object} data
 * @param {object} data.sender    – { name, address, email, phone }
 * @param {object} data.recipient – { name, address }
 * @param {string} data.date
 * @param {string} data.subject
 * @param {string} data.body      – The main letter text
 * @param {string} [data.closing] – e.g. "Sincerely,"
 * @param {string} [data.ps]
 * @returns {object} spec
 */
function letterTemplate(data) {
  const elements = [];

  // Sender info
  elements.push({ type: "text", value: data.sender?.name || "", font: "Helvetica-Bold", fontSize: 13 });
  elements.push({ type: "text", value: data.sender?.address || "", fontSize: 10, color: "#555555" });
  if (data.sender?.email) {
    elements.push({ type: "link", value: data.sender.email, url: `mailto:${data.sender.email}`, fontSize: 10 });
  }
  if (data.sender?.phone) {
    elements.push({ type: "text", value: data.sender.phone, fontSize: 10, color: "#555555" });
  }
  elements.push({ type: "spacer", lines: 1 });

  // Date
  elements.push({ type: "text", value: data.date || new Date().toLocaleDateString(), fontSize: 11, moveDown: 1 });

  // Recipient
  elements.push({ type: "text", value: data.recipient?.name || "", font: "Helvetica-Bold", fontSize: 12 });
  elements.push({ type: "text", value: data.recipient?.address || "", fontSize: 10, color: "#555555", moveDown: 1 });

  // Subject
  if (data.subject) {
    elements.push({ type: "text", value: `Re: ${data.subject}`, font: "Helvetica-Bold", fontSize: 12, moveDown: 0.5 });
  }

  // Greeting
  elements.push({ type: "text", value: `Dear ${data.recipient?.name || "Sir/Madam"},`, fontSize: 11, moveDown: 0.5 });

  // Body
  elements.push({ type: "text", value: data.body || "", fontSize: 11, lineGap: 3, moveDown: 1 });

  // Closing
  elements.push({ type: "text", value: data.closing || "Sincerely,", fontSize: 11, moveDown: 2 });
  elements.push({ type: "text", value: data.sender?.name || "", font: "Helvetica-Bold", fontSize: 11 });

  // P.S.
  if (data.ps) {
    elements.push({ type: "spacer", lines: 1 });
    elements.push({ type: "text", value: `P.S. ${data.ps}`, fontSize: 10, color: "#555555" });
  }

  return {
    meta: { Title: data.subject || "Letter" },
    pageNumbers: { align: "right", fontSize: 9 },
    elements,
  };
}

module.exports = letterTemplate;
