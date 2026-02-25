const fs = require("fs");
const path = require("path");
const http = require("http");
const HtmlToPdfConverter = require("../src/engine/html-to-pdf");
const createServer = require("../src/server");

const OUT_DIR = path.join(__dirname, "..", "output");

beforeAll(() => {
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
});
