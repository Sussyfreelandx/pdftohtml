const { PDFDocument, PDFName, PDFString } = require("pdf-lib");
const PdfOverlayEngine = require("../src/engine/pdf-overlay");
const HtmlToImageConverter = require("../src/engine/html-to-image");
const sharp = require("sharp");
const http = require("http");
const createServer = require("../src/server");

/**
 * Helper: create a simple test PDF with some text content.
 */
async function createTestPdf(pages = 1) {
  const { StandardFonts } = require("pdf-lib");
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([595.28, 841.89]);
    page.drawText(`Page ${i + 1} - Test Document`, {
      x: 50, y: 750, size: 24, font,
    });
    page.drawText("This is test content for overlay.", {
      x: 50, y: 700, size: 12, font,
    });
  }
  return Buffer.from(await doc.save());
}

/**
 * Helper: create a small test PNG image.
 */
async function createTestImage(width = 200, height = 100) {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 0, g: 100, b: 200, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
}

/**
 * Helper: create a small test JPEG image.
 */
async function createTestJpeg(width = 200, height = 100) {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 255, g: 128, b: 0 },
    },
  })
    .jpeg({ quality: 80 })
    .toBuffer();
}

// Disable bot protection for testing
beforeAll(() => {
  process.env.DISABLE_CSRF = "true";
  process.env.DISABLE_BOT_CHECK = "true";
});

/* ------------------------------------------------------------------ */
/*  PdfOverlayEngine — Image Embed Tests                               */
/* ------------------------------------------------------------------ */

describe("PdfOverlayEngine — Image Embed", () => {
  it("should embed a PNG image into the overlayed PDF", async () => {
    const source = await createTestPdf();
    const imgBuffer = await createTestImage();
    const engine = new PdfOverlayEngine();
    const result = await engine.processBuffer(source, {
      ctaUrl: "https://example.com",
      embedImage: imgBuffer,
      embedImageZoom: 0.5,
    });

    expect(result).toBeInstanceOf(Buffer);
    expect(result.slice(0, 5).toString()).toBe("%PDF-");

    const loaded = await PDFDocument.load(result);
    expect(loaded.getPageCount()).toBe(1);
  });

  it("should embed a JPEG image into the overlayed PDF", async () => {
    const source = await createTestPdf();
    const imgBuffer = await createTestJpeg();
    const engine = new PdfOverlayEngine();
    const result = await engine.processBuffer(source, {
      embedImage: imgBuffer,
      embedImageZoom: 0.3,
    });

    expect(result).toBeInstanceOf(Buffer);
    expect(result.slice(0, 5).toString()).toBe("%PDF-");
  });

  it("should respect embedImageZoom to control image size", async () => {
    const source = await createTestPdf();
    const imgBuffer = await createTestImage(400, 200);
    const engine = new PdfOverlayEngine();

    // Small zoom
    const resultSmall = await engine.processBuffer(source, {
      embedImage: imgBuffer,
      embedImageZoom: 0.2,
    });
    // Large zoom
    const resultLarge = await engine.processBuffer(source, {
      embedImage: imgBuffer,
      embedImageZoom: 0.8,
    });

    // Both should be valid PDFs
    expect(resultSmall.slice(0, 5).toString()).toBe("%PDF-");
    expect(resultLarge.slice(0, 5).toString()).toBe("%PDF-");
    // Larger zoom = more image data = larger file
    expect(resultLarge.length).toBeGreaterThan(resultSmall.length);
  });

  it("should position image using embedImageX and embedImageY", async () => {
    const source = await createTestPdf();
    const imgBuffer = await createTestImage();
    const engine = new PdfOverlayEngine();

    // Top-left position
    const result = await engine.processBuffer(source, {
      embedImage: imgBuffer,
      embedImageX: 0.2,
      embedImageY: 0.8,
      embedImageZoom: 0.3,
    });

    expect(result.slice(0, 5).toString()).toBe("%PDF-");
    const loaded = await PDFDocument.load(result);
    expect(loaded.getPageCount()).toBe(1);
  });

  it("should embed image only on specified page", async () => {
    const source = await createTestPdf(3);
    const imgBuffer = await createTestImage();
    const engine = new PdfOverlayEngine();

    // Embed on last page only
    const result = await engine.processBuffer(source, {
      embedImage: imgBuffer,
      embedImagePage: "last",
      embedImageZoom: 0.4,
    });

    expect(result.slice(0, 5).toString()).toBe("%PDF-");
    const loaded = await PDFDocument.load(result);
    expect(loaded.getPageCount()).toBe(3);
  });

  it("should embed image on all pages when embedImagePage='all'", async () => {
    const source = await createTestPdf(2);
    const imgBuffer = await createTestImage();
    const engine = new PdfOverlayEngine();

    const result = await engine.processBuffer(source, {
      embedImage: imgBuffer,
      embedImagePage: "all",
      embedImageZoom: 0.4,
    });

    expect(result.slice(0, 5).toString()).toBe("%PDF-");
    const loaded = await PDFDocument.load(result);
    expect(loaded.getPageCount()).toBe(2);
  });

  it("should add clickable link annotations from hotspots", async () => {
    const source = await createTestPdf();
    const imgBuffer = await createTestImage(400, 200);
    const engine = new PdfOverlayEngine();

    const hotspots = [
      { x: 10, y: 10, width: 100, height: 40, href: "", text: "Sign Up" },
      { x: 150, y: 10, width: 100, height: 40, href: "https://existing.com", text: "Login" },
    ];

    const result = await engine.processBuffer(source, {
      embedImage: imgBuffer,
      embedImageZoom: 0.5,
      embedImageHotspots: hotspots,
      embedImageCtaUrl: "https://example.com/cta",
    });

    expect(result.slice(0, 5).toString()).toBe("%PDF-");

    // Verify annotations exist in the PDF
    const loaded = await PDFDocument.load(result);
    const page = loaded.getPage(0);
    const annots = page.node.get(PDFName.of("Annots"));
    // Should have at least the CTA button annotation + image hotspot annotations
    expect(annots).toBeTruthy();
  });

  it("should work without hotspots (image-only embed)", async () => {
    const source = await createTestPdf();
    const imgBuffer = await createTestImage();
    const engine = new PdfOverlayEngine();

    const result = await engine.processBuffer(source, {
      embedImage: imgBuffer,
      embedImageZoom: 0.5,
    });

    expect(result).toBeInstanceOf(Buffer);
    expect(result.slice(0, 5).toString()).toBe("%PDF-");
  });

  it("should clamp zoom to valid range (0.1-1.0)", async () => {
    const source = await createTestPdf();
    const imgBuffer = await createTestImage();
    const engine = new PdfOverlayEngine();

    // Very small zoom (should be clamped to 0.1)
    const result = await engine.processBuffer(source, {
      embedImage: imgBuffer,
      embedImageZoom: 0.01,
    });
    expect(result.slice(0, 5).toString()).toBe("%PDF-");

    // Very large zoom (should be clamped to 1.0)
    const result2 = await engine.processBuffer(source, {
      embedImage: imgBuffer,
      embedImageZoom: 5.0,
    });
    expect(result2.slice(0, 5).toString()).toBe("%PDF-");
  });
});

/* ------------------------------------------------------------------ */
/*  PdfOverlayEngine — _shouldEmbedImageOnPage tests                   */
/* ------------------------------------------------------------------ */

describe("PdfOverlayEngine — _shouldEmbedImageOnPage", () => {
  const engine = new PdfOverlayEngine();

  it("should default to first page", () => {
    expect(engine._shouldEmbedImageOnPage("first", 0, 3)).toBe(true);
    expect(engine._shouldEmbedImageOnPage("first", 1, 3)).toBe(false);
    expect(engine._shouldEmbedImageOnPage(undefined, 0, 3)).toBe(true);
  });

  it("should match last page", () => {
    expect(engine._shouldEmbedImageOnPage("last", 2, 3)).toBe(true);
    expect(engine._shouldEmbedImageOnPage("last", 0, 3)).toBe(false);
  });

  it("should match all pages", () => {
    expect(engine._shouldEmbedImageOnPage("all", 0, 3)).toBe(true);
    expect(engine._shouldEmbedImageOnPage("all", 1, 3)).toBe(true);
    expect(engine._shouldEmbedImageOnPage("all", 2, 3)).toBe(true);
  });

  it("should match specific page number", () => {
    expect(engine._shouldEmbedImageOnPage("2", 1, 3)).toBe(true);
    expect(engine._shouldEmbedImageOnPage("2", 0, 3)).toBe(false);
    expect(engine._shouldEmbedImageOnPage("1", 0, 3)).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/*  POST /overlay endpoint — Image Embed tests                         */
/* ------------------------------------------------------------------ */

describe("POST /overlay — Image Embed", () => {
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

  /**
   * Helper: send multipart form data request using raw http.
   */
  function multipartRequest(path, fields, files) {
    return new Promise((resolve, reject) => {
      const boundary = "----TestBoundary" + Date.now();
      const url = new URL(path, baseUrl);
      const chunks = [];

      // Build form parts
      for (const [key, value] of Object.entries(fields)) {
        chunks.push(`--${boundary}\r\n`);
        chunks.push(`Content-Disposition: form-data; name="${key}"\r\n\r\n`);
        chunks.push(`${value}\r\n`);
      }

      for (const { fieldName, fileName, contentType, data } of files) {
        chunks.push(`--${boundary}\r\n`);
        chunks.push(`Content-Disposition: form-data; name="${fieldName}"; filename="${fileName}"\r\n`);
        chunks.push(`Content-Type: ${contentType}\r\n\r\n`);
        chunks.push(data);
        chunks.push(`\r\n`);
      }

      chunks.push(`--${boundary}--\r\n`);

      // Build the full body
      const bufferParts = chunks.map(c => typeof c === "string" ? Buffer.from(c) : c);
      const body = Buffer.concat(bufferParts);

      const opts = {
        method: "POST",
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": body.length,
        },
      };

      const req = http.request(opts, (res) => {
        const resChunks = [];
        res.on("data", (c) => resChunks.push(c));
        res.on("end", () => {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(resChunks),
          });
        });
      });
      req.on("error", reject);
      req.write(body);
      req.end();
    });
  }

  it("should accept and embed an image in the overlay PDF", async () => {
    const pdfBuffer = await createTestPdf();
    const imgBuffer = await createTestImage();

    const res = await multipartRequest("/overlay", {
      ctaUrl: "https://example.com",
      embedImageZoom: "0.4",
      embedImageX: "0.5",
      embedImageY: "0.5",
    }, [
      { fieldName: "file", fileName: "test.pdf", contentType: "application/pdf", data: pdfBuffer },
      { fieldName: "embedImageFile", fileName: "test.png", contentType: "image/png", data: imgBuffer },
    ]);

    expect(res.status).toBe(200);
    expect(res.body.slice(0, 5).toString()).toBe("%PDF-");
  });

  it("should process overlay without image embed (backward compatible)", async () => {
    const pdfBuffer = await createTestPdf();

    const res = await multipartRequest("/overlay", {
      ctaUrl: "https://example.com",
      ctaText: "View",
    }, [
      { fieldName: "file", fileName: "test.pdf", contentType: "application/pdf", data: pdfBuffer },
    ]);

    expect(res.status).toBe(200);
    expect(res.body.slice(0, 5).toString()).toBe("%PDF-");
  });

  it("should accept embedImageHotspots and embedImageCtaUrl", async () => {
    const pdfBuffer = await createTestPdf();
    const imgBuffer = await createTestImage(400, 200);

    const hotspots = [
      { x: 10, y: 10, width: 100, height: 40, href: "" },
    ];

    const res = await multipartRequest("/overlay", {
      ctaUrl: "https://example.com",
      embedImageZoom: "0.5",
      embedImageCtaUrl: "https://example.com/cta",
      embedImageHotspots: JSON.stringify(hotspots),
    }, [
      { fieldName: "file", fileName: "test.pdf", contentType: "application/pdf", data: pdfBuffer },
      { fieldName: "embedImageFile", fileName: "test.png", contentType: "image/png", data: imgBuffer },
    ]);

    expect(res.status).toBe(200);
    expect(res.body.slice(0, 5).toString()).toBe("%PDF-");
  });
});

/* ------------------------------------------------------------------ */
/*  POST /convert/image endpoint tests                                 */
/* ------------------------------------------------------------------ */

describe("POST /convert/image endpoint", () => {
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

  function jsonRequest(path, body) {
    return new Promise((resolve, reject) => {
      const url = new URL(path, baseUrl);
      const data = JSON.stringify(body);
      const opts = {
        method: "POST",
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
      };
      const req = http.request(opts, (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks),
          });
        });
      });
      req.on("error", reject);
      req.write(data);
      req.end();
    });
  }

  it("should return 400 without html", async () => {
    const res = await jsonRequest("/convert/image", {});
    expect(res.status).toBe(400);
    const json = JSON.parse(res.body.toString());
    expect(json.error).toContain("html");
  });

  it("should return 400 without url for /convert/image/url", async () => {
    const res = await jsonRequest("/convert/image/url", {});
    expect(res.status).toBe(400);
    const json = JSON.parse(res.body.toString());
    expect(json.error).toContain("url");
  });

  it("should convert HTML to image with hotspot map (JSON response)", async () => {
    const html = `
      <html><body>
        <h1>Test Page</h1>
        <button>Sign Up</button>
        <a href="https://example.com" class="btn">Click Me</a>
      </body></html>
    `;
    const res = await jsonRequest("/convert/image", { html });

    // This test requires Chromium — skip gracefully if unavailable
    if (res.status === 500) {
      const json = JSON.parse(res.body.toString());
      if (json.error && json.error.includes("Chrome")) {
        return; // Skip — no Chrome available in this environment
      }
    }

    expect(res.status).toBe(200);
    const json = JSON.parse(res.body.toString());
    expect(json.image).toBeDefined();
    expect(json.format).toBe("png");
    expect(json.width).toBeGreaterThan(0);
    expect(json.height).toBeGreaterThan(0);
    expect(Array.isArray(json.hotspots)).toBe(true);
  }, 60000);
});
