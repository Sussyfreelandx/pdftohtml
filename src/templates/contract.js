/**
 * Contract / agreement template.
 *
 * @param {object} data
 * @param {string} data.title          – e.g. "Service Agreement"
 * @param {string} data.date
 * @param {object} data.partyA         – { name, title, company, email }
 * @param {object} data.partyB         – { name, title, company, email }
 * @param {Array}  data.clauses        – [{ heading, body }]
 * @param {string} [data.governingLaw]
 * @param {object} [data.signatures]   – { partyA: "link", partyB: "link" }
 * @returns {object} spec
 */
function contractTemplate(data) {
  const elements = [];

  elements.push({ type: "heading", level: 1, value: data.title || "CONTRACT", align: "center", color: "#222222" });
  elements.push({ type: "text", value: `Effective Date: ${data.date || "___________"}`, align: "center", fontSize: 11, moveDown: 1 });
  elements.push({ type: "divider", thickness: 2, spacing: 15 });

  // Parties
  elements.push({ type: "heading", level: 3, value: "Parties" });
  const partyText = (label, p) => {
    const lines = [`${label}: ${p?.name || "___________"}`];
    if (p?.title) lines.push(`Title: ${p.title}`);
    if (p?.company) lines.push(`Company: ${p.company}`);
    return lines.join("\n");
  };
  elements.push({ type: "text", value: partyText("Party A", data.partyA), fontSize: 11, moveDown: 0.5 });
  if (data.partyA?.email) {
    elements.push({ type: "link", value: data.partyA.email, url: `mailto:${data.partyA.email}`, fontSize: 10 });
  }
  elements.push({ type: "spacer", lines: 0.5 });
  elements.push({ type: "text", value: partyText("Party B", data.partyB), fontSize: 11, moveDown: 0.5 });
  if (data.partyB?.email) {
    elements.push({ type: "link", value: data.partyB.email, url: `mailto:${data.partyB.email}`, fontSize: 10 });
  }
  elements.push({ type: "divider", spacing: 15 });

  // Clauses
  (data.clauses || []).forEach((clause, i) => {
    elements.push({ type: "heading", level: 4, value: `${i + 1}. ${clause.heading || "Clause"}` });
    elements.push({ type: "text", value: clause.body || "", fontSize: 11, lineGap: 2, moveDown: 0.5 });
  });

  // Governing law
  if (data.governingLaw) {
    elements.push({ type: "heading", level: 4, value: "Governing Law" });
    elements.push({ type: "text", value: data.governingLaw, fontSize: 11, moveDown: 1 });
  }

  // Signatures
  elements.push({ type: "divider", spacing: 20 });
  elements.push({ type: "heading", level: 3, value: "Signatures" });

  elements.push({
    type: "columns",
    columns: [
      {
        elements: [
          { type: "text", value: "Party A: ______________________", fontSize: 11, moveDown: 0.3 },
          { type: "text", value: data.partyA?.name || "", fontSize: 11 },
          data.signatures?.partyA
            ? { type: "link", value: "Sign here →", url: data.signatures.partyA, fontSize: 11, color: "#0B6623" }
            : null,
        ].filter(Boolean),
      },
      {
        elements: [
          { type: "text", value: "Party B: ______________________", fontSize: 11, moveDown: 0.3 },
          { type: "text", value: data.partyB?.name || "", fontSize: 11 },
          data.signatures?.partyB
            ? { type: "link", value: "Sign here →", url: data.signatures.partyB, fontSize: 11, color: "#0B6623" }
            : null,
        ].filter(Boolean),
      },
    ],
  });

  return {
    meta: { Title: data.title || "Contract" },
    pageNumbers: { align: "center", fontSize: 9 },
    elements,
  };
}

module.exports = contractTemplate;
