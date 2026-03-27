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

  it("should use correct default CTA size and accept custom sizes", async () => {
    const source = await createTestPdf();
    // Verify defaults
    const engine = new PdfOverlayEngine();
    expect(engine.ctaWidth).toBe(180);
    expect(engine.ctaHeight).toBe(44);
    expect(engine.ctaFontSize).toBe(14);
    expect(engine.ctaBorderRadius).toBe(8);
    expect(engine.ctaStyle).toBe("rounded");

    // Verify custom sizes and style overrides work
    const result = await engine.processBuffer(source, {
      ctaWidth: 120,
      ctaHeight: 28,
      ctaFontSize: 10,
      ctaBorderRadius: 16,
      ctaStyle: "outline",
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

  it("should support ctaStyle 'square' (sharp corners)", async () => {
    const source = await createTestPdf();
    const engine = new PdfOverlayEngine();
    const result = await engine.processBuffer(source, {
      ctaStyle: "square",
      ctaBorderRadius: 0,
      ctaUrl: "https://example.com",
    });

    expect(result).toBeInstanceOf(Buffer);
    expect(result.slice(0, 5).toString()).toBe("%PDF-");
  });

  it("should support ctaStyle 'outline' (border only)", async () => {
    const source = await createTestPdf();
    const engine = new PdfOverlayEngine();
    const result = await engine.processBuffer(source, {
      ctaStyle: "outline",
      ctaBorderRadius: 12,
      ctaUrl: "https://example.com",
    });

    expect(result).toBeInstanceOf(Buffer);
    expect(result.slice(0, 5).toString()).toBe("%PDF-");
  });

  it("should support ctaStyle 'rounded' with custom border radius", async () => {
    const source = await createTestPdf();
    const engine = new PdfOverlayEngine();
    const result = await engine.processBuffer(source, {
      ctaStyle: "rounded",
      ctaBorderRadius: 20,
      ctaUrl: "https://example.com",
    });

    expect(result).toBeInstanceOf(Buffer);
    expect(result.slice(0, 5).toString()).toBe("%PDF-");
  });

  it("should use solid background in fallback mode (no pdftoppm)", async () => {
    const source = await createTestPdf();
    // Force fallback by caching pdftoppm as unavailable
    const origValue = PdfOverlayEngine._pdftoppmAvailable;
    PdfOverlayEngine._pdftoppmAvailable = false;

    try {
      const engine = new PdfOverlayEngine();
      const result = await engine.processBuffer(source, {
        ctaUrl: "https://example.com",
      });
      expect(result).toBeInstanceOf(Buffer);
      expect(result.slice(0, 5).toString()).toBe("%PDF-");
      const loaded = await PDFDocument.load(result);
      expect(loaded.getPageCount()).toBe(1);
    } finally {
      PdfOverlayEngine._pdftoppmAvailable = origValue;
    }
  });

  it("should handle 5+ page PDFs correctly", async () => {
    const source = await createTestPdf(7);
    const engine = new PdfOverlayEngine();
    const result = await engine.processBuffer(source, {
      ctaText: "View Full Document",
      ctaUrl: "https://example.com",
    });

    expect(result).toBeInstanceOf(Buffer);
    const loaded = await PDFDocument.load(result);
    expect(loaded.getPageCount()).toBe(7);

    // Verify every page has CTA annotation
    for (let i = 0; i < 7; i++) {
      const page = loaded.getPage(i);
      const annots = page.node.get(PDFName.of("Annots"));
      expect(annots).toBeDefined();
    }
  });

  it("should accept custom ctaX and ctaY position (0-1 fractions)", async () => {
    const source = await createTestPdf();
    const engine = new PdfOverlayEngine();
    const result = await engine.processBuffer(source, {
      ctaText: "Custom Position",
      ctaUrl: "https://example.com",
      ctaX: 0.25,
      ctaY: 0.75,
    });

    expect(result).toBeInstanceOf(Buffer);
    expect(result.slice(0, 5).toString()).toBe("%PDF-");

    const loaded = await PDFDocument.load(result);
    expect(loaded.getPageCount()).toBe(1);
    // Verify annotation exists
    const page = loaded.getPage(0);
    const annots = page.node.get(PDFName.of("Annots"));
    expect(annots).toBeDefined();
  });

  it("should accept ctaX/ctaY for QR code CTA type", async () => {
    const source = await createTestPdf();
    const engine = new PdfOverlayEngine();
    const result = await engine.processBuffer(source, {
      ctaType: "qrCode",
      ctaUrl: "https://example.com/view",
      ctaLabel: "Scan Here",
      ctaX: 0.7,
      ctaY: 0.6,
    });

    expect(result).toBeInstanceOf(Buffer);
    const loaded = await PDFDocument.load(result);
    expect(loaded.getPageCount()).toBe(1);
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

  // ---- Page Range Selection Tests ----

  describe("parsePageRange", () => {
    it('should return all pages for "all"', () => {
      const set = PdfOverlayEngine.parsePageRange("all", 5);
      expect(set.size).toBe(5);
      expect([...set]).toEqual([0, 1, 2, 3, 4]);
    });

    it("should return all pages for undefined/null/empty", () => {
      expect(PdfOverlayEngine.parsePageRange(undefined, 3).size).toBe(3);
      expect(PdfOverlayEngine.parsePageRange(null, 3).size).toBe(3);
      expect(PdfOverlayEngine.parsePageRange("", 3).size).toBe(3);
    });

    it('should return only first page for "first"', () => {
      const set = PdfOverlayEngine.parsePageRange("first", 5);
      expect(set.size).toBe(1);
      expect(set.has(0)).toBe(true);
    });

    it('should return only last page for "last"', () => {
      const set = PdfOverlayEngine.parsePageRange("last", 5);
      expect(set.size).toBe(1);
      expect(set.has(4)).toBe(true);
    });

    it("should parse a range like '1-3'", () => {
      const set = PdfOverlayEngine.parsePageRange("1-3", 5);
      expect(set.size).toBe(3);
      expect(set.has(0)).toBe(true); // page 1 → index 0
      expect(set.has(1)).toBe(true); // page 2 → index 1
      expect(set.has(2)).toBe(true); // page 3 → index 2
      expect(set.has(3)).toBe(false);
    });

    it("should parse specific pages like '1,3,5'", () => {
      const set = PdfOverlayEngine.parsePageRange("1,3,5", 5);
      expect(set.size).toBe(3);
      expect(set.has(0)).toBe(true);  // page 1
      expect(set.has(2)).toBe(true);  // page 3
      expect(set.has(4)).toBe(true);  // page 5
      expect(set.has(1)).toBe(false); // page 2 not selected
    });

    it("should parse mixed ranges '1-2,5'", () => {
      const set = PdfOverlayEngine.parsePageRange("1-2,5", 5);
      expect(set.size).toBe(3);
      expect(set.has(0)).toBe(true);
      expect(set.has(1)).toBe(true);
      expect(set.has(4)).toBe(true);
    });

    it("should clamp out-of-range pages", () => {
      const set = PdfOverlayEngine.parsePageRange("1-100", 3);
      expect(set.size).toBe(3);
    });

    it("should fall back to all pages for invalid input", () => {
      const set = PdfOverlayEngine.parsePageRange("abc", 3);
      expect(set.size).toBe(3);
    });
  });

  it("should only blur selected pages and copy others as-is", async () => {
    const source = await createTestPdf(3);
    const engine = new PdfOverlayEngine();

    const result = await engine.processBuffer(source, {
      ctaText: "View Full Document",
      ctaUrl: "https://example.com",
      blurPages: "1", // Only blur page 1
    });

    expect(result).toBeInstanceOf(Buffer);
    expect(result.length).toBeGreaterThan(0);
    const outDoc = await PDFDocument.load(result);
    expect(outDoc.getPageCount()).toBe(3); // All 3 pages present
  });

  // ---- New feature tests ----

  it("should apply diagonal watermark text on blurred pages", async () => {
    const source = await createTestPdf();
    const engine = new PdfOverlayEngine();
    const result = await engine.processBuffer(source, {
      watermarkText: "PREVIEW",
      watermarkColor: "#FF0000",
      watermarkOpacity: 0.12,
    });
    expect(result).toBeInstanceOf(Buffer);
    expect(result.length).toBeGreaterThan(0);
    const outDoc = await PDFDocument.load(result);
    expect(outDoc.getPageCount()).toBe(1);
  });

  it("should set PDF metadata (title, author, subject)", async () => {
    const source = await createTestPdf();
    const engine = new PdfOverlayEngine();
    const result = await engine.processBuffer(source, {
      metaTitle: "My Invoice",
      metaAuthor: "Test Company",
      metaSubject: "Protected Document",
    });
    const outDoc = await PDFDocument.load(result);
    expect(outDoc.getTitle()).toBe("My Invoice");
    expect(outDoc.getAuthor()).toBe("Test Company");
    expect(outDoc.getSubject()).toBe("Protected Document");
  });

  it("should accept custom DPI setting", async () => {
    const source = await createTestPdf();
    const engine = new PdfOverlayEngine({ dpi: 150 });
    expect(engine.dpi).toBe(150);
    const result = await engine.processBuffer(source, { dpi: 300 });
    expect(result).toBeInstanceOf(Buffer);
    expect(result.length).toBeGreaterThan(0);
  });

  it("should accept watermark defaults in constructor", async () => {
    const engine = new PdfOverlayEngine({
      watermarkText: "SAMPLE",
      watermarkColor: "#0000FF",
      watermarkOpacity: 0.1,
      metaTitle: "Default Title",
      metaAuthor: "Default Author",
      dpi: 300,
    });
    expect(engine.watermarkText).toBe("SAMPLE");
    expect(engine.watermarkColor).toBe("#0000FF");
    expect(engine.watermarkOpacity).toBe(0.1);
    expect(engine.metaTitle).toBe("Default Title");
    expect(engine.metaAuthor).toBe("Default Author");
    expect(engine.dpi).toBe(300);
  });
});
