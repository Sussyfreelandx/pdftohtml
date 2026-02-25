/**
 * Business / technical report template.
 *
 * @param {object} data
 * @param {string} data.title
 * @param {string} [data.subtitle]
 * @param {string} [data.author]
 * @param {string} [data.date]
 * @param {Array}  data.sections – [{ heading, body, bullets, table, links }]
 * @returns {object} spec
 */
function reportTemplate(data) {
  const elements = [];

  // Cover-page-style header
  elements.push({ type: "spacer", lines: 4 });
  elements.push({ type: "heading", level: 1, value: data.title || "Report", align: "center", color: "#003366" });
  if (data.subtitle) {
    elements.push({ type: "text", value: data.subtitle, align: "center", fontSize: 16, color: "#555555", moveDown: 1 });
  }
  if (data.author) {
    elements.push({ type: "text", value: `Prepared by: ${data.author}`, align: "center", fontSize: 12, color: "#333333" });
  }
  if (data.date) {
    elements.push({ type: "text", value: data.date, align: "center", fontSize: 12, color: "#333333" });
  }

  // New page for content
  elements.push({ type: "pageBreak" });

  // Table of Contents (clickable internal headings are not supported by PDFKit,
  // but we list section titles so the reader knows what's inside)
  if (data.sections?.length) {
    elements.push({ type: "heading", level: 2, value: "Table of Contents", color: "#003366" });
    elements.push({
      type: "list",
      ordered: true,
      items: data.sections.map((s) => s.heading || "Untitled Section"),
      fontSize: 12,
    });
    elements.push({ type: "divider", spacing: 15 });
  }

  // Sections
  for (const sec of data.sections || []) {
    elements.push({ type: "heading", level: 2, value: sec.heading || "", color: "#003366" });
    if (sec.body) {
      elements.push({ type: "text", value: sec.body, fontSize: 11, lineGap: 3, moveDown: 0.5 });
    }
    if (sec.bullets?.length) {
      elements.push({ type: "list", items: sec.bullets, fontSize: 11 });
    }
    if (sec.table) {
      elements.push({ type: "table", ...sec.table, fontSize: 10 });
    }
    if (sec.links?.length) {
      for (const lnk of sec.links) {
        elements.push({ type: "link", value: lnk.text || lnk.url, url: lnk.url, fontSize: 10 });
      }
    }
    elements.push({ type: "spacer", lines: 0.5 });
  }

  return {
    meta: { Title: data.title, Author: data.author },
    pageNumbers: { align: "center", prefix: "Page ", fontSize: 9 },
    elements,
  };
}

module.exports = reportTemplate;
