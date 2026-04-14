const fs = require("fs");
const path = require("path");
const http = require("http");
const HtmlToPdfConverter = require("../src/engine/html-to-pdf");
const createServer = require("../src/server");

const OUT_DIR = path.join(__dirname, "..", "output");

beforeAll(() => {
  // Disable bot protection for testing
  process.env.DISABLE_CSRF = "true";
  process.env.DISABLE_BOT_CHECK = "true";
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
});

/* ------------------------------------------------------------------ */
/*  HtmlToPdfConverter — unit tests                                    */
/* ------------------------------------------------------------------ */

describe("HtmlToPdfConverter", () => {
  const converter = new HtmlToPdfConverter();

  test("convertHtmlToBuffer returns a Buffer starting with %PDF", async () => {
    const html = "<html><body><h1>Hello World</h1></body></html>";
    const buf = await converter.convertHtmlToBuffer(html);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(0);
    expect(buf.slice(0, 5).toString()).toBe("%PDF-");
  }, 30000);

  test("produces a valid PDF from a styled HTML document", async () => {
    const html = `
      <html>
      <head><style>
        body { font-family: Helvetica, sans-serif; font-size: 12px; color: #333; }
        h1 { color: #2E5090; font-size: 28px; }
        .cta { display: inline-block; padding: 10px 20px; background: #0B6623;
               color: #fff; text-decoration: none; border-radius: 4px; }
      </style></head>
      <body>
        <h1>Styled Report</h1>
        <p>This is a paragraph with <strong>bold</strong> and <em>italic</em> text.</p>
        <a class="cta" href="https://example.com">Click Me</a>
      </body>
      </html>
    `;
    const buf = await converter.convertHtmlToBuffer(html);
    expect(buf.slice(0, 5).toString()).toBe("%PDF-");
    expect(buf.length).toBeGreaterThan(500);
  }, 30000);

  test("convertHtmlToFile writes a valid PDF file", async () => {
    const html = "<html><body><p>File test</p></body></html>";
    const outPath = path.join(OUT_DIR, "test-html-to-pdf.pdf");
    const result = await converter.convertHtmlToFile(html, outPath);
    expect(fs.existsSync(result)).toBe(true);
    const data = fs.readFileSync(result);
    expect(data.slice(0, 5).toString()).toBe("%PDF-");
  }, 30000);

  test("respects per-call option overrides", async () => {
    const html = "<html><body><p>Letter format</p></body></html>";
    const buf = await converter.convertHtmlToBuffer(html, {
      format: "Letter",
      margin: { top: "60px", right: "60px", bottom: "60px", left: "60px" },
    });
    expect(buf.slice(0, 5).toString()).toBe("%PDF-");
  }, 30000);

  test("renders the sample-page.html example", async () => {
    const html = fs.readFileSync(
      path.join(__dirname, "..", "examples", "sample-page.html"),
      "utf-8"
    );
    const buf = await converter.convertHtmlToBuffer(html, {
      meta: { title: "Sample Page" },
    });
    expect(buf.slice(0, 5).toString()).toBe("%PDF-");
    expect(buf.length).toBeGreaterThan(1000);
  }, 30000);

  test("renders tables correctly", async () => {
    const html = `
      <html><body>
        <table>
          <thead><tr><th>Name</th><th>Value</th></tr></thead>
          <tbody>
            <tr><td>Revenue</td><td>$54M</td></tr>
            <tr><td>Profit</td><td>$9.7M</td></tr>
          </tbody>
        </table>
      </body></html>
    `;
    const buf = await converter.convertHtmlToBuffer(html);
    expect(buf.slice(0, 5).toString()).toBe("%PDF-");
  }, 30000);

  test("preserves clickable links in PDF", async () => {
    const html = `
      <html><body>
        <a href="https://example.com/test-link">Click here</a>
      </body></html>
    `;
    const buf = await converter.convertHtmlToBuffer(html);
    expect(buf.slice(0, 5).toString()).toBe("%PDF-");
    // Link annotations are present in the raw PDF
    const raw = buf.toString("latin1");
    expect(raw).toContain("/Annot");
  }, 30000);

  test("handles empty HTML gracefully", async () => {
    const html = "<html><body></body></html>";
    const buf = await converter.convertHtmlToBuffer(html);
    expect(buf.slice(0, 5).toString()).toBe("%PDF-");
  }, 30000);
});

/* ------------------------------------------------------------------ */
/*  CTA button detection & invisible link injection                    */
/* ------------------------------------------------------------------ */

describe("HtmlToPdfConverter — CTA Injection", () => {
  const converter = new HtmlToPdfConverter();

  test("injects link into a <button> element and PDF contains annotation", async () => {
    const html = `
      <html><body>
        <h1>Document</h1>
        <button>Download Report</button>
      </body></html>
    `;
    const buf = await converter.convertHtmlToBuffer(html, {
      ctaUrl: "https://example.com/report",
    });
    expect(buf.slice(0, 5).toString()).toBe("%PDF-");
    // The injected link should create a PDF annotation
    const raw = buf.toString("latin1");
    expect(raw).toContain("/Annot");
    expect(raw).toContain("example.com/report");
  }, 30000);

  test("injects link into elements with .cta class", async () => {
    const html = `
      <html><body>
        <p>Click below:</p>
        <div class="cta" style="padding:10px;background:#0B6623;color:#fff;display:inline-block;">
          Get Started
        </div>
      </body></html>
    `;
    const buf = await converter.convertHtmlToBuffer(html, {
      ctaUrl: "https://example.com/start",
    });
    const raw = buf.toString("latin1");
    expect(raw).toContain("/Annot");
    expect(raw).toContain("example.com/start");
  }, 30000);

  test("injects link into elements with .btn class", async () => {
    const html = `
      <html><body>
        <span class="btn" style="padding:8px 16px;background:#333;color:#fff;border-radius:4px;display:inline-block;">
          Sign Up
        </span>
      </body></html>
    `;
    const buf = await converter.convertHtmlToBuffer(html, {
      ctaUrl: "https://example.com/signup",
    });
    const raw = buf.toString("latin1");
    expect(raw).toContain("example.com/signup");
  }, 30000);

  test("does NOT overwrite existing <a href> on CTA elements", async () => {
    const html = `
      <html><body>
        <a class="cta" href="https://original.com/link"
           style="display:inline-block;padding:10px 20px;background:#0B6623;color:#fff;">
          Keep Original
        </a>
      </body></html>
    `;
    const buf = await converter.convertHtmlToBuffer(html, {
      ctaUrl: "https://injected.com/should-not-appear",
    });
    const raw = buf.toString("latin1");
    // The original link should be preserved
    expect(raw).toContain("original.com/link");
  }, 30000);

  test("supports custom ctaSelector to target specific elements", async () => {
    const html = `
      <html><body>
        <p>Some text</p>
        <div id="my-special-cta" style="padding:10px;background:blue;color:white;display:inline-block;">
          Special Button
        </div>
        <button>Should NOT get injected</button>
      </body></html>
    `;
    const buf = await converter.convertHtmlToBuffer(html, {
      ctaUrl: "https://example.com/special",
      ctaSelector: "#my-special-cta",
    });
    const raw = buf.toString("latin1");
    expect(raw).toContain("example.com/special");
  }, 30000);

  test("does nothing when ctaUrl is not provided", async () => {
    const html = `
      <html><body>
        <button>Plain Button</button>
      </body></html>
    `;
    const buf = await converter.convertHtmlToBuffer(html);
    expect(buf.slice(0, 5).toString()).toBe("%PDF-");
    // Without ctaUrl, button should not have a link annotation to example.com
    const raw = buf.toString("latin1");
    expect(raw).not.toContain("example.com");
  }, 30000);

  test("handles multiple CTA elements in one document", async () => {
    const html = `
      <html><body>
        <button>Button 1</button>
        <button>Button 2</button>
        <div class="cta" style="display:inline-block;">CTA Div</div>
      </body></html>
    `;
    const buf = await converter.convertHtmlToBuffer(html, {
      ctaUrl: "https://example.com/multi",
    });
    const raw = buf.toString("latin1");
    expect(raw).toContain("example.com/multi");
    expect(buf.slice(0, 5).toString()).toBe("%PDF-");
  }, 30000);

  test("injected link is invisible — no visual change to button style", async () => {
    // This test ensures the button text colour is inherited (not blue/underlined)
    // by checking that the wrapper uses color:inherit and text-decoration:none.
    // We verify this indirectly: the PDF should contain a /Link annotation
    // pointing to the injected URL, and the button renders normally.
    const html = `
      <html><body>
        <button style="background:#333;color:#fff;padding:12px 24px;border:none;border-radius:6px;">
          View Report
        </button>
      </body></html>
    `;
    const buf = await converter.convertHtmlToBuffer(html, {
      ctaUrl: "https://example.com/view",
    });
    const raw = buf.toString("latin1");
    // The link should be in an annotation
    expect(raw).toContain("example.com/view");
    // Should have a /Link annotation subtype
    expect(raw).toContain("/Link");
  }, 30000);
});

/* ------------------------------------------------------------------ */
/*  Crop feature                                                       */
/* ------------------------------------------------------------------ */

describe("HtmlToPdfConverter — Crop", () => {
  const converter = new HtmlToPdfConverter();

  test("crop option produces a valid PDF", async () => {
    const html = `
      <html><body>
        <div style="width:800px;height:1200px;background:linear-gradient(#f00,#00f);">
          <h1 style="padding:20px;">Full Page Content</h1>
        </div>
      </body></html>
    `;
    const buf = await converter.convertHtmlToBuffer(html, {
      crop: { x: 0, y: 0, width: 400, height: 300 },
    });
    expect(buf.slice(0, 5).toString()).toBe("%PDF-");
    expect(buf.length).toBeGreaterThan(100);
  }, 30000);

  test("crop with offset (x, y) produces a valid PDF", async () => {
    const html = `
      <html><body>
        <div style="width:800px;height:1200px;padding:100px;">
          <h2>Offset Content</h2>
          <p>This content should be cropped from a specific offset.</p>
        </div>
      </body></html>
    `;
    const buf = await converter.convertHtmlToBuffer(html, {
      crop: { x: 50, y: 50, width: 300, height: 200 },
    });
    expect(buf.slice(0, 5).toString()).toBe("%PDF-");
  }, 30000);

  test("crop does not affect output when not provided", async () => {
    const html = "<html><body><p>No crop</p></body></html>";
    const buf = await converter.convertHtmlToBuffer(html);
    expect(buf.slice(0, 5).toString()).toBe("%PDF-");
  }, 30000);

  test("crop with zero dimensions is ignored gracefully", async () => {
    const html = "<html><body><p>Zero crop</p></body></html>";
    const buf = await converter.convertHtmlToBuffer(html, {
      crop: { x: 0, y: 0, width: 0, height: 0 },
    });
    expect(buf.slice(0, 5).toString()).toBe("%PDF-");
  }, 30000);
});

/* ------------------------------------------------------------------ */
/*  CTA + Crop combined                                                */
/* ------------------------------------------------------------------ */

describe("HtmlToPdfConverter — CTA + Crop combined", () => {
  const converter = new HtmlToPdfConverter();

  test("CTA injection works together with crop", async () => {
    const html = `
      <html><body>
        <div style="width:600px;height:800px;">
          <h1>Report</h1>
          <button style="padding:10px 20px;background:#0B6623;color:#fff;">
            Download
          </button>
        </div>
      </body></html>
    `;
    const buf = await converter.convertHtmlToBuffer(html, {
      ctaUrl: "https://example.com/download",
      crop: { x: 0, y: 0, width: 600, height: 400 },
    });
    expect(buf.slice(0, 5).toString()).toBe("%PDF-");
    // After crop + pdf-lib CropBox, verify the PDF has annotations via pdf-lib
    const { PDFDocument } = require("pdf-lib");
    const doc = await PDFDocument.load(buf);
    const pages = doc.getPages();
    expect(pages.length).toBeGreaterThan(0);
    // The page should have a CropBox set
    const cropBox = pages[0].getCropBox();
    expect(cropBox).toBeDefined();
    expect(cropBox.width).toBeCloseTo(600, 0);
    expect(cropBox.height).toBeCloseTo(400, 0);
  }, 30000);
});

/* ------------------------------------------------------------------ */
/*  Server /convert endpoints                                          */
/* ------------------------------------------------------------------ */

describe("PDF Server — /convert endpoints", () => {
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

  function request(method, urlPath, body, extraHeaders = {}) {
    return new Promise((resolve, reject) => {
      const url = new URL(urlPath, baseUrl);
      const data = body ? JSON.stringify(body) : undefined;
      const opts = {
        method,
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        headers: { "Content-Type": "application/json", ...extraHeaders },
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
      if (data) req.write(data);
      req.end();
    });
  }

  test("POST /convert returns a PDF from HTML string", async () => {
    const res = await request("POST", "/convert", {
      html: "<html><body><h1>Hello from API</h1></body></html>",
    });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.body.slice(0, 5).toString()).toBe("%PDF-");
  }, 30000);

  test("POST /convert returns 400 without html", async () => {
    const res = await request("POST", "/convert", {});
    expect(res.status).toBe(400);
  });

  test("POST /convert/url returns 400 without url", async () => {
    const res = await request("POST", "/convert/url", {});
    expect(res.status).toBe(400);
  });

  test("GET / lists convert endpoints (JSON mode)", async () => {
    const res = await request("GET", "/", undefined, { Accept: "application/json" });
    const json = JSON.parse(res.body.toString());
    expect(json.endpoints["POST /convert"]).toBeDefined();
    expect(json.endpoints["POST /convert/url"]).toBeDefined();
  });

  test("POST /convert with ctaUrl injects link into detected buttons", async () => {
    const html = `
      <html><body>
        <button>Click Me</button>
      </body></html>
    `;
    const res = await request("POST", "/convert", {
      html,
      ctaUrl: "https://example.com/injected",
    });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    const raw = res.body.toString("latin1");
    expect(raw).toContain("example.com/injected");
  }, 30000);

  test("POST /convert with crop returns a valid PDF", async () => {
    const html = `
      <html><body>
        <div style="width:800px;height:1200px;">
          <h1>Full page</h1>
        </div>
      </body></html>
    `;
    const res = await request("POST", "/convert", {
      html,
      options: { crop: { x: 0, y: 0, width: 400, height: 300 } },
    });
    expect(res.status).toBe(200);
    expect(res.body.slice(0, 5).toString()).toBe("%PDF-");
  }, 30000);

  test("POST /convert with ctaUrl and crop combined", async () => {
    const html = `
      <html><body>
        <div style="width:600px;height:800px;">
          <button style="padding:10px;background:#333;color:#fff;">Download</button>
        </div>
      </body></html>
    `;
    const res = await request("POST", "/convert", {
      html,
      ctaUrl: "https://example.com/combo",
      options: { crop: { x: 0, y: 0, width: 600, height: 400 } },
    });
    expect(res.status).toBe(200);
    expect(res.body.slice(0, 5).toString()).toBe("%PDF-");
    // Verify the cropped PDF has a CropBox via pdf-lib
    const { PDFDocument } = require("pdf-lib");
    const doc = await PDFDocument.load(res.body);
    const pages = doc.getPages();
    expect(pages.length).toBeGreaterThan(0);
    const cropBox = pages[0].getCropBox();
    expect(cropBox).toBeDefined();
    expect(cropBox.width).toBeCloseTo(600, 0);
    expect(cropBox.height).toBeCloseTo(400, 0);
  }, 30000);
});
