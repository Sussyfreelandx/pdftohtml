/**
 * Resume / CV template.
 *
 * @param {object} data
 * @param {object} data.personal   – { name, title, email, phone, website, linkedin, summary }
 * @param {Array}  data.experience – [{ company, role, dates, bullets }]
 * @param {Array}  data.education  – [{ school, degree, dates }]
 * @param {Array}  data.skills     – ["Skill 1", "Skill 2"]
 * @param {Array}  [data.certifications] – [{ name, link }]
 * @returns {object} spec
 */
function resumeTemplate(data) {
  const p = data.personal || {};
  const elements = [];

  // Name & title
  elements.push({ type: "heading", level: 1, value: p.name || "Your Name", align: "center", color: "#1B3A5C" });
  elements.push({ type: "text", value: p.title || "", align: "center", fontSize: 14, color: "#555555", moveDown: 0.3 });

  // Contact row
  const contactParts = [];
  if (p.email) contactParts.push(p.email);
  if (p.phone) contactParts.push(p.phone);
  if (contactParts.length) {
    elements.push({ type: "text", value: contactParts.join("  |  "), align: "center", fontSize: 10, color: "#333333" });
  }
  if (p.website) {
    elements.push({ type: "link", value: p.website, url: p.website, fontSize: 10, align: "center" });
  }
  if (p.linkedin) {
    elements.push({ type: "link", value: p.linkedin, url: p.linkedin, fontSize: 10, align: "center" });
  }

  elements.push({ type: "divider", color: "#1B3A5C", thickness: 2, spacing: 12 });

  // Summary
  if (p.summary) {
    elements.push({ type: "heading", level: 3, value: "Professional Summary", color: "#1B3A5C" });
    elements.push({ type: "text", value: p.summary, fontSize: 11, color: "#333333", moveDown: 0.5 });
  }

  // Experience
  if (data.experience?.length) {
    elements.push({ type: "heading", level: 3, value: "Experience", color: "#1B3A5C" });
    for (const exp of data.experience) {
      elements.push({ type: "text", value: `${exp.role || ""} — ${exp.company || ""}`, font: "Helvetica-Bold", fontSize: 12 });
      elements.push({ type: "text", value: exp.dates || "", fontSize: 10, color: "#777777" });
      if (exp.bullets?.length) {
        elements.push({ type: "list", items: exp.bullets, fontSize: 11 });
      }
    }
  }

  // Education
  if (data.education?.length) {
    elements.push({ type: "heading", level: 3, value: "Education", color: "#1B3A5C" });
    for (const edu of data.education) {
      elements.push({ type: "text", value: `${edu.degree || ""} — ${edu.school || ""}`, font: "Helvetica-Bold", fontSize: 12 });
      elements.push({ type: "text", value: edu.dates || "", fontSize: 10, color: "#777777", moveDown: 0.3 });
    }
  }

  // Skills
  if (data.skills?.length) {
    elements.push({ type: "heading", level: 3, value: "Skills", color: "#1B3A5C" });
    elements.push({ type: "text", value: data.skills.join("  •  "), fontSize: 11, color: "#333333", moveDown: 0.5 });
  }

  // Certifications (clickable)
  if (data.certifications?.length) {
    elements.push({ type: "heading", level: 3, value: "Certifications", color: "#1B3A5C" });
    elements.push({
      type: "list",
      items: data.certifications.map((c) => (c.link ? { text: c.name, link: c.link } : c.name)),
      fontSize: 11,
    });
  }

  return {
    meta: { Title: `${p.name || "Resume"} — Resume`, Author: p.name },
    pageNumbers: { align: "right", fontSize: 9 },
    elements,
  };
}

module.exports = resumeTemplate;
