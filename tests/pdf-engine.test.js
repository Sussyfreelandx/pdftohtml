const fs = require("fs");
const path = require("path");
const PDFEngine = require("../src/engine/pdf-engine");
const templates = require("../src/templates");

const OUT_DIR = path.join(__dirname, "..", "output");

beforeAll(() => {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
});

describe("PDFEngine", () => {
  const engine = new PDFEngine();

  test("generateToBuffer returns a Buffer starting with %PDF", async () => {
    const spec = {
      elements: [{ type: "text", value: "Hello World" }],
    };
    const buf = await engine.generateToBuffer(spec);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(0);
    expect(buf.slice(0, 5).toString()).toBe("%PDF-");
  });

  test("generateToFile writes a valid PDF file", async () => {
    const spec = {
      elements: [
        { type: "heading", level: 1, value: "Test PDF" },
        { type: "text", value: "Body text" },
      ],
    };
    const outPath = path.join(OUT_DIR, "test-basic.pdf");
    const result = await engine.generateToFile(spec, outPath);
    expect(fs.existsSync(result)).toBe(true);
    const data = fs.readFileSync(result);
    expect(data.slice(0, 5).toString()).toBe("%PDF-");
  });

  test("generateToStream pipes to a writable stream", async () => {
    const spec = { elements: [{ type: "text", value: "Streamed" }] };
    const outPath = path.join(OUT_DIR, "test-stream.pdf");
    const stream = fs.createWriteStream(outPath);
    await engine.generateToStream(spec, stream);
    expect(fs.existsSync(outPath)).toBe(true);
  });

  test("supports links (clickable text)", async () => {
    const spec = {
      elements: [
        { type: "link", value: "Click me", url: "https://example.com" },
      ],
    };
    const buf = await engine.generateToBuffer(spec);
    expect(buf.length).toBeGreaterThan(0);
  });

  test("supports tables with clickable cells", async () => {
    const spec = {
      elements: [
        {
          type: "table",
          headers: ["Name", "Link"],
          rows: [
            ["Google", { text: "Visit", link: "https://google.com" }],
          ],
        },
      ],
    };
    const buf = await engine.generateToBuffer(spec);
    expect(buf.length).toBeGreaterThan(0);
  });

  test("supports lists with clickable items", async () => {
    const spec = {
      elements: [
        {
          type: "list",
          items: [
            "Plain item",
            { text: "Linked item", link: "https://example.com" },
          ],
        },
      ],
    };
    const buf = await engine.generateToBuffer(spec);
    expect(buf.length).toBeGreaterThan(0);
  });

  test("page numbers are added when requested", async () => {
    const spec = {
      pageNumbers: { align: "center" },
      elements: [
        { type: "text", value: "Page 1 content" },
        { type: "pageBreak" },
        { type: "text", value: "Page 2 content" },
      ],
    };
    const buf = await engine.generateToBuffer(spec);
    expect(buf.length).toBeGreaterThan(0);
  });

  test("all element types render without errors", async () => {
    const spec = {
      elements: [
        { type: "heading", level: 1, value: "H1" },
        { type: "heading", level: 2, value: "H2" },
        { type: "text", value: "Normal text" },
        { type: "link", value: "Link", url: "https://example.com" },
        { type: "list", items: ["a", "b"], ordered: true },
        { type: "divider" },
        { type: "spacer", lines: 2 },
        { type: "columns", columns: [
          { elements: [{ type: "text", value: "Col A" }] },
          { elements: [{ type: "text", value: "Col B" }] },
        ]},
        { type: "table", headers: ["A", "B"], rows: [["1", "2"]] },
        { type: "pageBreak" },
        { type: "text", value: "After page break" },
      ],
    };
    const buf = await engine.generateToBuffer(spec);
    expect(buf.length).toBeGreaterThan(0);
  });

  test("unknown element types are silently skipped", async () => {
    const spec = {
      elements: [
        { type: "unknownWidget", foo: "bar" },
        { type: "text", value: "Still works" },
      ],
    };
    const buf = await engine.generateToBuffer(spec);
    expect(buf.length).toBeGreaterThan(0);
  });

  test("overlay element renders with default settings", async () => {
    const spec = {
      elements: [
        { type: "text", value: "Visible content above" },
        { type: "overlay", url: "https://example.com/unlock" },
        { type: "text", value: "Visible content below" },
      ],
    };
    const buf = await engine.generateToBuffer(spec);
    expect(buf.length).toBeGreaterThan(0);
    expect(buf.slice(0, 5).toString()).toBe("%PDF-");
  });

  test("overlay element renders with custom label and styling", async () => {
    const spec = {
      elements: [
        { type: "text", value: "Preview content" },
        {
          type: "overlay",
          label: "🔓 Unlock Full Report",
          url: "https://pay.example.com/report",
          height: 250,
          opacity: 0.9,
          color: "#F5F5F5",
          labelColor: "#0B6623",
          labelSize: 22,
          lines: 8,
          lineColor: "#D0D0D0",
        },
      ],
    };
    const buf = await engine.generateToBuffer(spec);
    expect(buf.length).toBeGreaterThan(0);
    expect(buf.slice(0, 5).toString()).toBe("%PDF-");
  });

  test("overlay element works without a URL", async () => {
    const spec = {
      elements: [
        { type: "overlay", label: "Content Hidden" },
      ],
    };
    const buf = await engine.generateToBuffer(spec);
    expect(buf.length).toBeGreaterThan(0);
  });

  test("overlay element generates to file", async () => {
    const spec = {
      elements: [
        { type: "heading", level: 1, value: "Premium Report" },
        { type: "text", value: "This is the free preview section." },
        { type: "overlay", label: "Click to View Full Report", url: "https://example.com/buy" },
      ],
    };
    const outPath = path.join(OUT_DIR, "test-overlay.pdf");
    const result = await engine.generateToFile(spec, outPath);
    expect(fs.existsSync(result)).toBe(true);
    const data = fs.readFileSync(result);
    expect(data.slice(0, 5).toString()).toBe("%PDF-");
  });

  test("stealthLink element renders a valid PDF with clickable area", async () => {
    const spec = {
      elements: [
        {
          type: "stealthLink",
          value: "View Document",
          url: "https://example.com/secret",
        },
      ],
    };
    const buf = await engine.generateToBuffer(spec);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.slice(0, 5).toString()).toBe("%PDF-");
    // The URL lives only in the PDF annotation layer (/S /URI), not in the
    // text content stream, so scanners that extract text won't see it.
    const pdfRaw = buf.toString("latin1");
    // The annotation layer must contain the URI for clickability
    expect(pdfRaw).toContain("/URI (https://example.com/secret)");
  });

  test("stealthLink element renders without URL", async () => {
    const spec = {
      elements: [
        { type: "stealthLink", value: "Just text, no link" },
      ],
    };
    const buf = await engine.generateToBuffer(spec);
    expect(buf.length).toBeGreaterThan(0);
    expect(buf.slice(0, 5).toString()).toBe("%PDF-");
  });

  test("stealthLink element supports custom styling", async () => {
    const spec = {
      elements: [
        {
          type: "stealthLink",
          value: "Click here for details",
          url: "https://example.com/details",
          fontSize: 14,
          font: "Helvetica-Bold",
          color: "#333333",
          underline: true,
          align: "center",
        },
      ],
    };
    const buf = await engine.generateToBuffer(spec);
    expect(buf.length).toBeGreaterThan(0);
    expect(buf.slice(0, 5).toString()).toBe("%PDF-");
  });

  test("stealthLink generates to file", async () => {
    const spec = {
      elements: [
        { type: "heading", level: 1, value: "Confidential Report" },
        { type: "text", value: "Please review the attached information." },
        {
          type: "stealthLink",
          value: "View Full Report",
          url: "https://example.com/report/secret-123",
          fontSize: 14,
          color: "#0066CC",
        },
      ],
    };
    const outPath = path.join(OUT_DIR, "test-stealth-link.pdf");
    const result = await engine.generateToFile(spec, outPath);
    expect(fs.existsSync(result)).toBe(true);
    const fileData = fs.readFileSync(result);
    expect(fileData.slice(0, 5).toString()).toBe("%PDF-");
  });

  test("link element with stealth:true behaves like stealthLink", async () => {
    const spec = {
      elements: [
        {
          type: "link",
          value: "View Report",
          url: "https://example.com/hidden-link",
          stealth: true,
        },
      ],
    };
    const buf = await engine.generateToBuffer(spec);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.slice(0, 5).toString()).toBe("%PDF-");
    // The annotation layer must contain the URI for clickability
    const pdfRaw = buf.toString("latin1");
    expect(pdfRaw).toContain("/URI (https://example.com/hidden-link)");
  });

  test("link element without stealth remains a normal link", async () => {
    const spec = {
      elements: [
        {
          type: "link",
          value: "Normal Link",
          url: "https://example.com/visible",
        },
      ],
    };
    const buf = await engine.generateToBuffer(spec);
    expect(buf.slice(0, 5).toString()).toBe("%PDF-");
  });

  test("stealthLink mixed with other elements", async () => {
    const spec = {
      elements: [
        { type: "heading", level: 1, value: "Invoice" },
        { type: "text", value: "Amount due: $500" },
        { type: "stealthLink", value: "Pay Now", url: "https://pay.example.com/inv-001" },
        { type: "divider" },
        { type: "text", value: "Thank you for your business." },
      ],
    };
    const buf = await engine.generateToBuffer(spec);
    expect(buf.length).toBeGreaterThan(0);
    expect(buf.slice(0, 5).toString()).toBe("%PDF-");
  });
});

describe("Templates", () => {
  const engine = new PDFEngine();

  test("invoice template generates a valid PDF", async () => {
    const data = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "examples", "invoice-data.json"), "utf-8"));
    const spec = templates.invoice(data);
    expect(spec.elements.length).toBeGreaterThan(0);
    const buf = await engine.generateToBuffer(spec);
    expect(buf.slice(0, 5).toString()).toBe("%PDF-");
  });

  test("resume template generates a valid PDF", async () => {
    const data = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "examples", "resume-data.json"), "utf-8"));
    const spec = templates.resume(data);
    expect(spec.elements.length).toBeGreaterThan(0);
    const buf = await engine.generateToBuffer(spec);
    expect(buf.slice(0, 5).toString()).toBe("%PDF-");
  });

  test("report template generates a valid PDF", async () => {
    const spec = templates.report({
      title: "Q1 Report",
      author: "Test",
      sections: [
        { heading: "Overview", body: "This is the overview." },
        { heading: "Data", bullets: ["Point A", "Point B"] },
      ],
    });
    const buf = await engine.generateToBuffer(spec);
    expect(buf.slice(0, 5).toString()).toBe("%PDF-");
  });

  test("contract template generates a valid PDF with signature links", async () => {
    const spec = templates.contract({
      title: "Service Agreement",
      date: "2026-01-01",
      partyA: { name: "Alice", email: "alice@example.com" },
      partyB: { name: "Bob", email: "bob@example.com" },
      clauses: [{ heading: "Scope", body: "Party A will provide services." }],
      signatures: {
        partyA: "https://sign.example.com/alice",
        partyB: "https://sign.example.com/bob",
      },
    });
    const buf = await engine.generateToBuffer(spec);
    expect(buf.slice(0, 5).toString()).toBe("%PDF-");
  });

  test("certificate template generates a valid PDF with verify link", async () => {
    const spec = templates.certificate({
      title: "Certificate of Excellence",
      recipientName: "Jane Doe",
      description: "For outstanding contributions",
      issuer: "Acme Corp",
      verifyUrl: "https://verify.acmecorp.com/cert/12345",
    });
    const buf = await engine.generateToBuffer(spec);
    expect(buf.slice(0, 5).toString()).toBe("%PDF-");
  });

  test("letter template generates a valid PDF", async () => {
    const spec = templates.letter({
      sender: { name: "John", address: "123 St", email: "john@example.com" },
      recipient: { name: "Jane", address: "456 Ave" },
      subject: "Proposal",
      body: "I am writing to propose...",
    });
    const buf = await engine.generateToBuffer(spec);
    expect(buf.slice(0, 5).toString()).toBe("%PDF-");
  });

  test("all templates are exported", () => {
    expect(typeof templates.invoice).toBe("function");
    expect(typeof templates.resume).toBe("function");
    expect(typeof templates.report).toBe("function");
    expect(typeof templates.contract).toBe("function");
    expect(typeof templates.certificate).toBe("function");
    expect(typeof templates.letter).toBe("function");
  });
});
