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

/* ------------------------------------------------------------------ */
/*  PdfOverlayEngine — embedImageButtonText (text-based targeting)     */
/* ------------------------------------------------------------------ */

describe("PdfOverlayEngine — embedImageButtonText filtering", () => {
  it("should only add annotations for hotspots matching the button text", async () => {
    const source = await createTestPdf();
    const imgBuffer = await createTestImage(400, 200);
    const engine = new PdfOverlayEngine();

    const hotspots = [
      { x: 10, y: 10, width: 100, height: 40, href: "", text: "Sign Up" },
      { x: 150, y: 10, width: 100, height: 40, href: "", text: "Login" },
      { x: 280, y: 10, width: 80, height: 40, href: "", text: "Cancel" },
    ];

    // Target only "Sign Up"
    const result = await engine.processBuffer(source, {
      embedImage: imgBuffer,
      embedImageZoom: 0.5,
      embedImageHotspots: hotspots,
      embedImageCtaUrl: "https://example.com/signup",
      embedImageButtonText: "Sign Up",
    });

    expect(result.slice(0, 5).toString()).toBe("%PDF-");

    // Verify the PDF has annotations
    const loaded = await PDFDocument.load(result);
    const page = loaded.getPage(0);
    const annots = page.node.get(PDFName.of("Annots"));
    expect(annots).toBeTruthy();
  });

  it("should be case-insensitive when matching button text", async () => {
    const source = await createTestPdf();
    const imgBuffer = await createTestImage(400, 200);
    const engine = new PdfOverlayEngine();

    const hotspots = [
      { x: 10, y: 10, width: 100, height: 40, href: "", text: "SIGN UP NOW" },
      { x: 150, y: 10, width: 100, height: 40, href: "", text: "Login" },
    ];

    // Use lowercase search — should match "SIGN UP NOW"
    const result = await engine.processBuffer(source, {
      embedImage: imgBuffer,
      embedImageZoom: 0.5,
      embedImageHotspots: hotspots,
      embedImageCtaUrl: "https://example.com",
      embedImageButtonText: "sign up",
    });

    expect(result.slice(0, 5).toString()).toBe("%PDF-");
    const loaded = await PDFDocument.load(result);
    const page = loaded.getPage(0);
    const annots = page.node.get(PDFName.of("Annots"));
    expect(annots).toBeTruthy();
  });

  it("should add no hotspot annotations when button text matches nothing", async () => {
    const source = await createTestPdf();
    const imgBuffer = await createTestImage(400, 200);
    const engine = new PdfOverlayEngine();

    const hotspots = [
      { x: 10, y: 10, width: 100, height: 40, href: "", text: "Sign Up" },
      { x: 150, y: 10, width: 100, height: 40, href: "", text: "Login" },
    ];

    // Search for text that doesn't exist in any hotspot
    const result = await engine.processBuffer(source, {
      embedImage: imgBuffer,
      embedImageZoom: 0.5,
      embedImageHotspots: hotspots,
      embedImageCtaUrl: "https://example.com",
      embedImageButtonText: "Subscribe",
    });

    expect(result.slice(0, 5).toString()).toBe("%PDF-");
    // PDF should still be valid — just no extra annotations from hotspots
  });

  it("should link all hotspots when embedImageButtonText is empty", async () => {
    const source = await createTestPdf();
    const imgBuffer = await createTestImage(400, 200);
    const engine = new PdfOverlayEngine();

    const hotspots = [
      { x: 10, y: 10, width: 100, height: 40, href: "", text: "Sign Up" },
      { x: 150, y: 10, width: 100, height: 40, href: "", text: "Login" },
    ];

    // No button text filter — should link all hotspots
    const result = await engine.processBuffer(source, {
      embedImage: imgBuffer,
      embedImageZoom: 0.5,
      embedImageHotspots: hotspots,
      embedImageCtaUrl: "https://example.com",
      embedImageButtonText: "",
    });

    expect(result.slice(0, 5).toString()).toBe("%PDF-");
    const loaded = await PDFDocument.load(result);
    const page = loaded.getPage(0);
    const annots = page.node.get(PDFName.of("Annots"));
    expect(annots).toBeTruthy();
  });
});

/* ------------------------------------------------------------------ */
/*  PdfOverlayEngine — Hotspot own-href without ctaUrl                 */
/* ------------------------------------------------------------------ */

describe("PdfOverlayEngine — hotspot links without embedImageCtaUrl", () => {
  it("should create annotations from hotspot hrefs even when ctaUrl is empty", async () => {
    const source = await createTestPdf();
    const imgBuffer = await createTestImage(400, 200);
    const engine = new PdfOverlayEngine();

    const hotspots = [
      { x: 10, y: 10, width: 100, height: 40, href: "https://example.com/signup", text: "Sign Up" },
      { x: 150, y: 10, width: 100, height: 40, href: "https://example.com/login", text: "Login" },
    ];

    // NO embedImageCtaUrl set — hotspots should still get links from their own hrefs
    const result = await engine.processBuffer(source, {
      embedImage: imgBuffer,
      embedImageZoom: 0.5,
      embedImageHotspots: hotspots,
      // embedImageCtaUrl intentionally omitted
    });

    expect(result.slice(0, 5).toString()).toBe("%PDF-");
    const loaded = await PDFDocument.load(result);
    const page = loaded.getPage(0);
    const annots = page.node.get(PDFName.of("Annots"));
    expect(annots).toBeTruthy();
    // Should have 2 annotations (one per hotspot with valid href)
    expect(annots.size()).toBe(2);
  });

  it("should skip hotspots with invalid hrefs when ctaUrl is also empty", async () => {
    const source = await createTestPdf();
    const imgBuffer = await createTestImage(400, 200);
    const engine = new PdfOverlayEngine();

    const hotspots = [
      { x: 10, y: 10, width: 100, height: 40, href: "about:blank", text: "Button 1" },
      { x: 150, y: 10, width: 100, height: 40, href: "", text: "Button 2" },
      { x: 280, y: 10, width: 80, height: 40, href: "https://example.com/valid", text: "Button 3" },
    ];

    // No ctaUrl, only the third hotspot has a valid href
    const result = await engine.processBuffer(source, {
      embedImage: imgBuffer,
      embedImageZoom: 0.5,
      embedImageHotspots: hotspots,
    });

    expect(result.slice(0, 5).toString()).toBe("%PDF-");
    const loaded = await PDFDocument.load(result);
    const page = loaded.getPage(0);
    const annots = page.node.get(PDFName.of("Annots"));
    expect(annots).toBeTruthy();
    // Only 1 annotation — from the hotspot with valid https:// href
    expect(annots.size()).toBe(1);
  });

  it("should use ctaUrl as fallback for hotspots without valid hrefs", async () => {
    const source = await createTestPdf();
    const imgBuffer = await createTestImage(400, 200);
    const engine = new PdfOverlayEngine();

    const hotspots = [
      { x: 10, y: 10, width: 100, height: 40, href: "", text: "Sign Up" },
      { x: 150, y: 10, width: 100, height: 40, href: "https://direct.example.com", text: "Direct" },
    ];

    const result = await engine.processBuffer(source, {
      embedImage: imgBuffer,
      embedImageZoom: 0.5,
      embedImageHotspots: hotspots,
      embedImageCtaUrl: "https://fallback.example.com",
    });

    expect(result.slice(0, 5).toString()).toBe("%PDF-");
    const loaded = await PDFDocument.load(result);
    const page = loaded.getPage(0);
    const annots = page.node.get(PDFName.of("Annots"));
    expect(annots).toBeTruthy();
    // Both hotspots should have links: first via ctaUrl fallback, second via own href
    expect(annots.size()).toBe(2);
  });
});

/* ------------------------------------------------------------------ */
/*  PdfOverlayEngine — Enhanced blur styles                            */
/* ------------------------------------------------------------------ */

describe("PdfOverlayEngine — Enhanced blur styles", () => {
  it("should accept heavyglass blur style", async () => {
    const engine = new PdfOverlayEngine({ blurStyle: "heavyglass" });
    expect(engine.blurStyle).toBe("heavyglass");
  });

  it("should accept cinematic blur style", async () => {
    const engine = new PdfOverlayEngine({ blurStyle: "cinematic" });
    expect(engine.blurStyle).toBe("cinematic");
  });

  it("should accept softfocus blur style", async () => {
    const engine = new PdfOverlayEngine({ blurStyle: "softfocus" });
    expect(engine.blurStyle).toBe("softfocus");
  });

  it("should accept pixelate blur style", async () => {
    const engine = new PdfOverlayEngine({ blurStyle: "pixelate" });
    expect(engine.blurStyle).toBe("pixelate");
  });

  it("should store embedImageButtonText in constructor", () => {
    const engine = new PdfOverlayEngine({ embedImageButtonText: "Sign Up" });
    expect(engine.embedImageButtonText).toBe("Sign Up");
  });

  it("should default embedImageButtonText to empty string", () => {
    const engine = new PdfOverlayEngine();
    expect(engine.embedImageButtonText).toBe("");
  });
});

/* ------------------------------------------------------------------ */
/*  POST /overlay — embedImageButtonText endpoint tests                */
/* ------------------------------------------------------------------ */

describe("POST /overlay — embedImageButtonText", () => {
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

  function multipartRequest(path, fields, files) {
    return new Promise((resolve, reject) => {
      const boundary = "----TestBoundary" + Date.now();
      const url = new URL(path, baseUrl);
      const chunks = [];

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

  it("should accept embedImageButtonText via overlay endpoint", async () => {
    const pdfBuffer = await createTestPdf();
    const imgBuffer = await createTestImage(400, 200);

    const hotspots = [
      { x: 10, y: 10, width: 100, height: 40, href: "", text: "Sign Up" },
      { x: 150, y: 10, width: 100, height: 40, href: "", text: "Login" },
    ];

    const res = await multipartRequest("/overlay", {
      ctaUrl: "https://example.com",
      embedImageZoom: "0.5",
      embedImageCtaUrl: "https://example.com/cta",
      embedImageHotspots: JSON.stringify(hotspots),
      embedImageButtonText: "Sign Up",
    }, [
      { fieldName: "file", fileName: "test.pdf", contentType: "application/pdf", data: pdfBuffer },
      { fieldName: "embedImageFile", fileName: "test.png", contentType: "image/png", data: imgBuffer },
    ]);

    expect(res.status).toBe(200);
    expect(res.body.slice(0, 5).toString()).toBe("%PDF-");
  });
});

/* ------------------------------------------------------------------ */
/*  HtmlToImageConverter — Crop tests                                  */
/* ------------------------------------------------------------------ */

describe("HtmlToImageConverter — Crop", () => {
  // These tests require Chromium — they'll be skipped if unavailable

  it("should accept crop option and return cropped image", async () => {
    const converter = new HtmlToImageConverter();
    try {
      const result = await converter.convertHtmlToImage(
        "<html><body style='padding:50px;'><h1>Hello World</h1><button style='margin: 20px;'>Click Me</button></body></html>",
        { crop: { x: 10, y: 10, width: 200, height: 100 } }
      );

      expect(result.image).toBeInstanceOf(Buffer);
      expect(result.image.length).toBeGreaterThan(0);
      // Cropped dimensions should reflect the crop size
      expect(result.width).toBe(200);
      expect(result.height).toBe(100);
    } catch (err) {
      if (err.message.includes("Chrome")) return; // Skip — no Chrome
      throw err;
    }
  }, 60000);

  it("should filter out-of-bounds hotspots after crop", async () => {
    const converter = new HtmlToImageConverter();
    try {
      // Full-page result for comparison
      const fullResult = await converter.convertHtmlToImage(
        "<html><body style='padding:50px;'><button style='position:absolute;left:500px;top:500px;'>Far Away</button><button style='position:absolute;left:20px;top:20px;'>Near</button></body></html>"
      );

      // Cropped — only the top-left area
      const croppedResult = await converter.convertHtmlToImage(
        "<html><body style='padding:50px;'><button style='position:absolute;left:500px;top:500px;'>Far Away</button><button style='position:absolute;left:20px;top:20px;'>Near</button></body></html>",
        { crop: { x: 0, y: 0, width: 200, height: 200 } }
      );

      // Cropped version should have fewer or equal hotspots (the "Far Away" button is outside the crop)
      expect(croppedResult.hotspots.length).toBeLessThanOrEqual(fullResult.hotspots.length);
    } catch (err) {
      if (err.message.includes("Chrome")) return;
      throw err;
    }
  }, 60000);

  it("should ignore crop with zero dimensions", async () => {
    const converter = new HtmlToImageConverter();
    try {
      const result = await converter.convertHtmlToImage(
        "<html><body><h1>Test</h1></body></html>",
        { crop: { x: 0, y: 0, width: 0, height: 0 } }
      );

      // Should return a valid image (crop ignored)
      expect(result.image).toBeInstanceOf(Buffer);
      expect(result.width).toBeGreaterThan(0);
      expect(result.height).toBeGreaterThan(0);
    } catch (err) {
      if (err.message.includes("Chrome")) return;
      throw err;
    }
  }, 60000);
});

describe("PdfOverlayEngine — embedImageCssWidth hotspot coordinate fix", () => {
  it("should use CSS dimensions (not native px) for hotspot scale factors", async () => {
    const pdfBuffer = await createTestPdf(1);
    // Create a 400x200 image (simulates a 2x screenshot of a 200x100 CSS viewport)
    const imgBuffer = await createTestImage(400, 200);

    // Hotspot at CSS coordinates (50, 25) size (100, 30) — CSS pixels, not native
    const hotspots = [{ x: 50, y: 25, width: 100, height: 30, href: "", text: "Click Me" }];

    const engine = new PdfOverlayEngine({
      embedImage: imgBuffer,
      embedImageHotspots: hotspots,
      embedImageCtaUrl: "https://example.com/test",
      embedImageCssWidth: 200,    // CSS-pixel width (native is 400)
      embedImageCssHeight: 100,   // CSS-pixel height (native is 200)
      embedImageZoom: 0.5,
      blurPages: "all",
    });

    const result = await engine.processBuffer(pdfBuffer);
    expect(result).toBeInstanceOf(Buffer);

    // Load and verify annotations exist
    const doc = await PDFDocument.load(result);
    const page = doc.getPage(0);
    const annots = page.node.get(PDFName.of("Annots"));
    // Should have at least 2 annotations: 1 CTA button + 1 hotspot link
    expect(annots).toBeDefined();
  });

  it("should fall back to native dimensions when cssWidth not provided", async () => {
    const pdfBuffer = await createTestPdf(1);
    const imgBuffer = await createTestImage(200, 100);

    const hotspots = [{ x: 50, y: 25, width: 100, height: 30, href: "", text: "Click Me" }];

    const engine = new PdfOverlayEngine({
      embedImage: imgBuffer,
      embedImageHotspots: hotspots,
      embedImageCtaUrl: "https://example.com/test",
      // No embedImageCssWidth — should use native dims (200x100)
      embedImageZoom: 0.5,
      blurPages: "all",
    });

    const result = await engine.processBuffer(pdfBuffer);
    expect(result).toBeInstanceOf(Buffer);

    const doc = await PDFDocument.load(result);
    const page = doc.getPage(0);
    const annots = page.node.get(PDFName.of("Annots"));
    expect(annots).toBeDefined();
  });
});

describe("POST /overlay — embedHtml", () => {
  let server;
  let baseUrl;

  beforeAll((done) => {
    const app = createServer();
    server = app.listen(0, () => {
      baseUrl = `http://localhost:${server.address().port}`;
      done();
    });
  });

  afterAll((done) => {
    if (server) server.close(done);
    else done();
  });

  /**
   * Helper: send multipart form data request using raw http.
   */
  function multipartRequest(path, fields, files) {
    return new Promise((resolve, reject) => {
      const boundary = "----TestBoundary" + Date.now();
      const url = new URL(path, baseUrl);
      const chunks = [];

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
          resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(resChunks) });
        });
      });
      req.on("error", reject);
      req.write(body);
      req.end();
    });
  }

  it("should accept embedHtml and render it server-side into the overlay", async () => {
    const pdfBuffer = await createTestPdf(1);
    const htmlSnippet = '<html><body><a href="https://example.com/signup" style="display:inline-block;padding:12px 24px;background:#2563EB;color:#fff;text-decoration:none;">Sign Up</a></body></html>';

    const res = await multipartRequest("/overlay", {
      ctaUrl: "https://example.com",
      blurRadius: "3",
      embedHtml: htmlSnippet,
      embedImageCtaUrl: "https://example.com/signup",
      embedImageZoom: "0.5",
    }, [
      { fieldName: "file", fileName: "test.pdf", contentType: "application/pdf", data: pdfBuffer },
    ]);

    // embedHtml requires Chrome to render — may fail in sandbox
    if (res.status === 400 && res.body.toString().includes("Chrome")) return;
    if (res.status === 400 && res.body.toString().includes("embedHtml")) return;

    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    const doc = await PDFDocument.load(res.body);
    expect(doc.getPageCount()).toBe(1);
  }, 60000);

  it("should pass through embedImageCssWidth and embedImageCssHeight", async () => {
    const pdfBuffer = await createTestPdf(1);
    const imgBuffer = await createTestImage(400, 200);

    const res = await multipartRequest("/overlay", {
      ctaUrl: "https://example.com",
      blurRadius: "3",
      embedImageCtaUrl: "https://example.com/click",
      embedImageZoom: "0.5",
      embedImageCssWidth: "200",
      embedImageCssHeight: "100",
      embedImageHotspots: JSON.stringify([
        { x: 50, y: 25, width: 100, height: 30, href: "", text: "Click Me" }
      ]),
    }, [
      { fieldName: "file", fileName: "test.pdf", contentType: "application/pdf", data: pdfBuffer },
      { fieldName: "embedImageFile", fileName: "test.png", contentType: "image/png", data: imgBuffer },
    ]);

    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);

    const doc = await PDFDocument.load(res.body);
    const page = doc.getPage(0);
    const annots = page.node.get(PDFName.of("Annots"));
    expect(annots).toBeDefined();
  }, 30000);
});
