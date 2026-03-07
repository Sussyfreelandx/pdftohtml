const { PDFDocument, rgb, StandardFonts, PDFName } = require("pdf-lib");
const PdfOverlayEngine = require("../src/engine/pdf-overlay");
const http = require("http");
const createServer = require("../src/server");

/**
 * Helper: create a simple test PDF with some text content.
 */
async function createTestPdf(pages = 1) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([595.28, 841.89]);
    page.drawText(`Page ${i + 1} - INVOICE #2026-00${i + 1}`, {
      x: 50, y: 750, size: 24, font,
    });
    page.drawText("Amount: $15,000.00", { x: 50, y: 700, size: 16, font });
    page.drawText("This is test content that should be blurred.", {
      x: 50, y: 650, size: 12, font,
    });
  }
  return Buffer.from(await doc.save());
}

describe("PdfOverlayEngine", () => {
  it("should produce a valid PDF from a source PDF", async () => {
    const source = await createTestPdf();
    const engine = new PdfOverlayEngine();
    const result = await engine.processBuffer(source, {
      ctaText: "Click to View",
      ctaUrl: "https://example.com",
    });

    expect(result).toBeInstanceOf(Buffer);
    expect(result.slice(0, 5).toString()).toBe("%PDF-");

    const loaded = await PDFDocument.load(result);
    expect(loaded.getPageCount()).toBe(1);
  });

  it("should preserve original page dimensions", async () => {
    const source = await createTestPdf();
    const engine = new PdfOverlayEngine();
    const result = await engine.processBuffer(source);

    const srcDoc = await PDFDocument.load(source);
    const outDoc = await PDFDocument.load(result);

    const srcSize = srcDoc.getPage(0).getSize();
    const outSize = outDoc.getPage(0).getSize();

    expect(outSize.width).toBeCloseTo(srcSize.width, 1);
    expect(outSize.height).toBeCloseTo(srcSize.height, 1);
  });

  it("should handle multi-page PDFs", async () => {
    const source = await createTestPdf(3);
    const engine = new PdfOverlayEngine();
    const result = await engine.processBuffer(source);

    const loaded = await PDFDocument.load(result);
    expect(loaded.getPageCount()).toBe(3);
  });

  it("should add clickable link annotation when ctaUrl is provided", async () => {
    const source = await createTestPdf();
    const engine = new PdfOverlayEngine();
    const result = await engine.processBuffer(source, {
      ctaText: "Pay Now",
      ctaUrl: "https://pay.example.com/invoice-001",
    });

    const loaded = await PDFDocument.load(result);
    const page = loaded.getPage(0);
    const annots = page.node.get(PDFName.of("Annots"));
    expect(annots).toBeDefined();
  });

  it("should respect custom CTA text and colours", async () => {
    const source = await createTestPdf();
    const engine = new PdfOverlayEngine({
      ctaText: "Unlock Report",
      ctaBgColor: "#FF0000",
      ctaTextColor: "#00FF00",
      overlayOpacity: 0.7,
    });
    const result = await engine.processBuffer(source);

    expect(result).toBeInstanceOf(Buffer);
    expect(result.slice(0, 5).toString()).toBe("%PDF-");
  });

  it("should work without a CTA URL (no link annotation)", async () => {
    const source = await createTestPdf();
    const engine = new PdfOverlayEngine();
    const result = await engine.processBuffer(source, {
      ctaText: "Preview Only",
      ctaUrl: "",
    });

    // The PDF should still be valid
    expect(result).toBeInstanceOf(Buffer);
    expect(result.slice(0, 5).toString()).toBe("%PDF-");

    const loaded = await PDFDocument.load(result);
    expect(loaded.getPageCount()).toBe(1);
  });

  it("should accept per-call overrides", async () => {
    const source = await createTestPdf();
    const engine = new PdfOverlayEngine({ ctaText: "Default" });
    const result = await engine.processBuffer(source, {
      ctaText: "Override Text",
      blurRadius: 20,
      overlayOpacity: 0.3,
    });

    expect(result).toBeInstanceOf(Buffer);
    expect(result.slice(0, 5).toString()).toBe("%PDF-");
  });

  it("should use reduced default CTA size (180×38) and accept custom sizes", async () => {
    const source = await createTestPdf();
    // Verify defaults
    const engine = new PdfOverlayEngine();
    expect(engine.ctaWidth).toBe(180);
    expect(engine.ctaHeight).toBe(38);
    expect(engine.ctaFontSize).toBe(14);

    // Verify custom sizes work
    const result = await engine.processBuffer(source, {
      ctaWidth: 120,
      ctaHeight: 28,
      ctaFontSize: 10,
      ctaTextColor: "#FF0000",
      ctaUrl: "https://example.com",
    });

    expect(result).toBeInstanceOf(Buffer);
    expect(result.slice(0, 5).toString()).toBe("%PDF-");

    const loaded = await PDFDocument.load(result);
    expect(loaded.getPageCount()).toBe(1);
  });

  it("should support QR code CTA type", async () => {
    const source = await createTestPdf();
    const engine = new PdfOverlayEngine();
    const result = await engine.processBuffer(source, {
      ctaType: "qrCode",
      ctaUrl: "https://example.com/view",
      ctaLabel: "Scan to View Document",
      qrSize: 140,
    });

    expect(result).toBeInstanceOf(Buffer);
    expect(result.slice(0, 5).toString()).toBe("%PDF-");

    const loaded = await PDFDocument.load(result);
    expect(loaded.getPageCount()).toBe(1);

    // Should have a clickable annotation
    const page = loaded.getPage(0);
    const annots = page.node.get(PDFName.of("Annots"));
    expect(annots).toBeDefined();
  });

  it("should support QR code CTA with custom label and colors", async () => {
    const source = await createTestPdf();
    const engine = new PdfOverlayEngine({
      ctaType: "qrCode",
      qrColor: "#FF0000",
      qrBackground: "#EEEEEE",
    });
    const result = await engine.processBuffer(source, {
      ctaLabel: "Scan to Pay Invoice",
      ctaUrl: "https://pay.example.com",
      qrSize: 180,
    });

    expect(result).toBeInstanceOf(Buffer);
    expect(result.slice(0, 5).toString()).toBe("%PDF-");
  });

  it("should default to glass blur style", () => {
    const engine = new PdfOverlayEngine();
    expect(engine.blurStyle).toBe("glass");
    expect(engine.ctaType).toBe("button");
    expect(engine.qrSize).toBe(140);
  });

  it("should accept standard blur style override", async () => {
    const source = await createTestPdf();
    const engine = new PdfOverlayEngine();
    const result = await engine.processBuffer(source, {
      blurStyle: "standard",
      blurRadius: 8,
    });

    expect(result).toBeInstanceOf(Buffer);
    expect(result.slice(0, 5).toString()).toBe("%PDF-");
  });

  it("should accept blur radius up to 40", async () => {
    const source = await createTestPdf();
    const engine = new PdfOverlayEngine();
    const result = await engine.processBuffer(source, {
      blurRadius: 40,
      blurStyle: "glass",
    });

    expect(result).toBeInstanceOf(Buffer);
    expect(result.slice(0, 5).toString()).toBe("%PDF-");
  });
});

describe("POST /overlay endpoint", () => {
  let app, server, baseUrl;

  beforeAll((done) => {
    app = createServer();
    server = app.listen(0, () => {
      baseUrl = `http://localhost:${server.address().port}`;
      done();
    });
  });

  afterAll((done) => {
    server.close(done);
  });

  it("should return 400 when no file is uploaded", (done) => {
    const req = http.request(`${baseUrl}/overlay`, { method: "POST" }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        expect(res.statusCode).toBe(400);
        const json = JSON.parse(body);
        expect(json.error).toMatch(/Missing PDF file/i);
        done();
      });
    });
    req.end();
  });

  it("should process a PDF upload and return a blurred PDF", (done) => {
    createTestPdf().then((pdfBuffer) => {
      const boundary = "----TestBoundary" + Date.now();
      const parts = [];

      // File part
      parts.push(`--${boundary}\r\n`);
      parts.push('Content-Disposition: form-data; name="file"; filename="test.pdf"\r\n');
      parts.push("Content-Type: application/pdf\r\n\r\n");
      const header = Buffer.from(parts.join(""));

      const fieldParts = [];
      fieldParts.push(`\r\n--${boundary}\r\n`);
      fieldParts.push('Content-Disposition: form-data; name="ctaText"\r\n\r\n');
      fieldParts.push("Click to View");
      fieldParts.push(`\r\n--${boundary}\r\n`);
      fieldParts.push('Content-Disposition: form-data; name="ctaUrl"\r\n\r\n');
      fieldParts.push("https://example.com");
      fieldParts.push(`\r\n--${boundary}--\r\n`);
      const footer = Buffer.from(fieldParts.join(""));

      const body = Buffer.concat([header, pdfBuffer, footer]);

      const req = http.request(
        `${baseUrl}/overlay`,
        {
          method: "POST",
          headers: {
            "Content-Type": `multipart/form-data; boundary=${boundary}`,
            "Content-Length": body.length,
          },
        },
        (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            expect(res.statusCode).toBe(200);
            expect(res.headers["content-type"]).toBe("application/pdf");
            const result = Buffer.concat(chunks);
            expect(result.slice(0, 5).toString()).toBe("%PDF-");
            done();
          });
        }
      );
      req.write(body);
      req.end();
    });
  });
});
