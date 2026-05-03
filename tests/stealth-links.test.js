const http = require("http");
const HtmlToPdfConverter = require("../src/engine/html-to-pdf");
const createServer = require("../src/server");

/* ------------------------------------------------------------------ */
/*  Unit: signed link-redirector helpers                              */
/* ------------------------------------------------------------------ */

describe("HtmlToPdfConverter — signed link redirector helpers", () => {
  const SECRET = "test-secret-do-not-use-in-production";
  const BASE = "https://pdf.example.com/r";

  test("buildRedirectUrl returns a signed token URL for http(s) inputs", () => {
    const real = "https://example.com/landing?utm=foo&id=42";
    const out = HtmlToPdfConverter.buildRedirectUrl(real, BASE, SECRET);
    expect(out).not.toBe(real);
    const parsed = new URL(out);
    expect(parsed.origin + parsed.pathname).toBe(BASE);
    expect(parsed.searchParams.get("u")).toBeTruthy();
    expect(parsed.searchParams.get("s")).toBeTruthy();
    // 16 hex chars (64-bit truncated HMAC)
    expect(parsed.searchParams.get("s")).toMatch(/^[0-9a-f]{16}$/);
    // The destination URL must NOT appear anywhere in the output token
    expect(out).not.toContain("example.com/landing");
    expect(out).not.toContain("utm=foo");
  });

  test("buildRedirectUrl leaves non-http URLs untouched", () => {
    expect(HtmlToPdfConverter.buildRedirectUrl("mailto:a@b.com", BASE, SECRET))
      .toBe("mailto:a@b.com");
    expect(HtmlToPdfConverter.buildRedirectUrl("tel:+15551234", BASE, SECRET))
      .toBe("tel:+15551234");
    expect(HtmlToPdfConverter.buildRedirectUrl("#section", BASE, SECRET))
      .toBe("#section");
  });

  test("buildRedirectUrl is a no-op when baseUrl or secret is missing", () => {
    const url = "https://example.com/x";
    expect(HtmlToPdfConverter.buildRedirectUrl(url, "", SECRET)).toBe(url);
    expect(HtmlToPdfConverter.buildRedirectUrl(url, BASE, "")).toBe(url);
  });

  test("verifyRedirectToken round-trips a signed token", () => {
    const real = "https://example.com/landing?id=7";
    const out = HtmlToPdfConverter.buildRedirectUrl(real, BASE, SECRET);
    const parsed = new URL(out);
    const recovered = HtmlToPdfConverter.verifyRedirectToken(
      parsed.searchParams.get("u"),
      parsed.searchParams.get("s"),
      SECRET
    );
    expect(recovered).toBe(real);
  });

  test("verifyRedirectToken rejects forged signatures", () => {
    const real = "https://example.com/landing";
    const out = HtmlToPdfConverter.buildRedirectUrl(real, BASE, SECRET);
    const parsed = new URL(out);
    expect(HtmlToPdfConverter.verifyRedirectToken(
      parsed.searchParams.get("u"),
      "0000000000000000",
      SECRET
    )).toBeNull();
  });

  test("verifyRedirectToken rejects wrong secret", () => {
    const real = "https://example.com/landing";
    const out = HtmlToPdfConverter.buildRedirectUrl(real, BASE, SECRET);
    const parsed = new URL(out);
    expect(HtmlToPdfConverter.verifyRedirectToken(
      parsed.searchParams.get("u"),
      parsed.searchParams.get("s"),
      "different-secret"
    )).toBeNull();
  });

  test("verifyRedirectToken rejects non-http(s) tampered payloads", () => {
    // Hand-craft a payload pointing to javascript: — even with a valid
    // signature, the verifier must refuse anything that isn't http(s).
    const malicious = "javascript:alert(1)";
    const out = HtmlToPdfConverter.buildRedirectUrl(malicious, BASE, SECRET);
    // buildRedirectUrl returned the original (no-op), so there's no token
    // to verify.  Now pretend an attacker manually crafted one:
    const u = Buffer.from(malicious, "utf8")
      .toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const s = HtmlToPdfConverter.signRedirectUrl(malicious, SECRET);
    expect(HtmlToPdfConverter.verifyRedirectToken(u, s, SECRET)).toBeNull();
    expect(out).toBe(malicious);
  });
});

/* ------------------------------------------------------------------ */
/*  Integration: GET /r endpoint                                      */
/* ------------------------------------------------------------------ */

describe("GET /r — signed link-redirector endpoint", () => {
  const SECRET = "integration-test-secret-xyz";
  let app, server, baseUrl, prevBase, prevSecret;

  beforeAll((done) => {
    prevBase = process.env.LINK_REDIRECTOR_BASE_URL;
    prevSecret = process.env.LINK_REDIRECTOR_SECRET;
    process.env.LINK_REDIRECTOR_BASE_URL = "http://placeholder/r";
    process.env.LINK_REDIRECTOR_SECRET = SECRET;
    process.env.DISABLE_CSRF = "true";
    process.env.DISABLE_BOT_CHECK = "true";
    app = createServer();
    server = app.listen(0, () => {
      baseUrl = `http://localhost:${server.address().port}`;
      done();
    });
  });

  afterAll((done) => {
    if (prevBase === undefined) delete process.env.LINK_REDIRECTOR_BASE_URL;
    else process.env.LINK_REDIRECTOR_BASE_URL = prevBase;
    if (prevSecret === undefined) delete process.env.LINK_REDIRECTOR_SECRET;
    else process.env.LINK_REDIRECTOR_SECRET = prevSecret;
    delete process.env.DISABLE_CSRF;
    delete process.env.DISABLE_BOT_CHECK;
    server.close(done);
  });

  function get(p, headers = {}) {
    return new Promise((resolve, reject) => {
      const url = new URL(p, baseUrl);
      const req = http.request({
        method: "GET",
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        headers,
      }, (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString(),
        }));
      });
      req.on("error", reject);
      req.end();
    });
  }

  test("302-redirects to the destination on a valid token", async () => {
    const real = "https://example.com/welcome?id=99";
    const out = HtmlToPdfConverter.buildRedirectUrl(real, "/r", SECRET);
    const res = await get(out);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(real);
  });

  test("403 when the signature is invalid", async () => {
    const real = "https://example.com/welcome";
    const out = HtmlToPdfConverter.buildRedirectUrl(real, "/r", SECRET);
    const url = new URL(out, baseUrl);
    url.searchParams.set("s", "0000000000000000");
    const res = await get(url.pathname + url.search);
    expect(res.status).toBe(403);
  });

  test("403 when no token is supplied", async () => {
    const res = await get("/r");
    expect(res.status).toBe(403);
  });

  test("403 to a known bot User-Agent even with a valid token", async () => {
    // Re-enable bot checking for this case
    delete process.env.DISABLE_BOT_CHECK;
    const real = "https://example.com/welcome";
    const out = HtmlToPdfConverter.buildRedirectUrl(real, "/r", SECRET);
    const res = await get(out, { "User-Agent": "python-requests/2.30" });
    process.env.DISABLE_BOT_CHECK = "true";
    expect(res.status).toBe(403);
  });

  test("API guide reports the link redirector as enabled", async () => {
    const res = await get("/", { Accept: "application/json" });
    expect(res.status).toBe(200);
    const json = JSON.parse(res.body);
    expect(json.linkRedirector).toMatch(/Enabled/);
    expect(json.endpoints["GET  /r"]).toBeDefined();
  });
});

describe("GET /r — disabled when env vars are not set", () => {
  let app, server, baseUrl;

  beforeAll((done) => {
    delete process.env.LINK_REDIRECTOR_BASE_URL;
    delete process.env.LINK_REDIRECTOR_SECRET;
    process.env.DISABLE_CSRF = "true";
    process.env.DISABLE_BOT_CHECK = "true";
    app = createServer();
    server = app.listen(0, () => {
      baseUrl = `http://localhost:${server.address().port}`;
      done();
    });
  });

  afterAll((done) => {
    delete process.env.DISABLE_CSRF;
    delete process.env.DISABLE_BOT_CHECK;
    server.close(done);
  });

  test("404 when LINK_REDIRECTOR_* env vars are not configured", (done) => {
    const url = new URL("/r?u=abc&s=def", baseUrl);
    http.get({
      hostname: url.hostname, port: url.port, path: url.pathname + url.search,
    }, (res) => {
      expect(res.statusCode).toBe(404);
      done();
    });
  });
});

/* ------------------------------------------------------------------ */
/*  Integration: POST /convert multipart htmlFile + chained overlay    */
/*                                                                     */
/*  These hit Puppeteer, so they are gated on the same Chromium        */
/*  availability check used by the existing html-to-pdf suite.  When   */
/*  Chromium is unavailable (sandboxed CI), the test self-skips.       */
/* ------------------------------------------------------------------ */

describe("POST /convert — multipart htmlFile upload with stealth links", () => {
  let app, server, baseUrl;
  const TEST_HTML = `<!doctype html><html><head><title>T</title></head><body>
    <h1>Stealth Test</h1>
    <p>Visit https://example.com/visible-text-url to learn more.</p>
    <a href="https://example.com/click-me" title="click here">Click me</a>
    <button class="cta">Sign Up</button>
  </body></html>`;

  beforeAll((done) => {
    process.env.DISABLE_CSRF = "true";
    process.env.DISABLE_BOT_CHECK = "true";
    app = createServer();
    server = app.listen(0, () => {
      baseUrl = `http://localhost:${server.address().port}`;
      done();
    });
  });

  afterAll((done) => {
    delete process.env.DISABLE_CSRF;
    delete process.env.DISABLE_BOT_CHECK;
    server.close(done);
  });

  function multipartRequest(p, fields, files) {
    return new Promise((resolve, reject) => {
      const boundary = "----StealthTestBoundary" + Date.now();
      const url = new URL(p, baseUrl);
      const chunks = [];
      for (const [k, v] of Object.entries(fields)) {
        chunks.push(`--${boundary}\r\n`);
        chunks.push(`Content-Disposition: form-data; name="${k}"\r\n\r\n`);
        chunks.push(`${v}\r\n`);
      }
      for (const f of files) {
        chunks.push(`--${boundary}\r\n`);
        chunks.push(`Content-Disposition: form-data; name="${f.fieldName}"; filename="${f.fileName}"\r\n`);
        chunks.push(`Content-Type: ${f.contentType}\r\n\r\n`);
        chunks.push(f.data);
        chunks.push(`\r\n`);
      }
      chunks.push(`--${boundary}--\r\n`);
      const body = Buffer.concat(chunks.map(c => typeof c === "string" ? Buffer.from(c) : c));
      const req = http.request({
        method: "POST",
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": body.length,
        },
      }, (res) => {
        const out = [];
        res.on("data", (c) => out.push(c));
        res.on("end", () => resolve({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(out),
        }));
      });
      req.on("error", reject);
      req.write(body);
      req.end();
    });
  }

  test("rejects request with no html and no htmlFile", async () => {
    const res = await multipartRequest("/convert", {}, []);
    expect(res.status).toBe(400);
    const j = JSON.parse(res.body.toString());
    expect(j.error).toMatch(/Missing HTML/i);
  });

  test("accepts an htmlFile upload and returns a vector PDF [chromium]", async () => {
    const res = await multipartRequest("/convert", {
      stealthLinks: "true",
      filename: "stealth.pdf",
    }, [
      { fieldName: "htmlFile", fileName: "doc.html", contentType: "text/html", data: Buffer.from(TEST_HTML) },
    ]);
    if (res.status !== 200) {
      // Surface Chromium / sandbox failures so the test owner can act
      const msg = res.body.toString().slice(0, 400);
      // Only skip on the known Chromium sandbox crash signature
      if (/scheduler_loop_quarantine_support|Failed to launch|Target.*closed/i.test(msg)) {
        console.warn("Skipping: Chromium unavailable in sandbox —", msg.slice(0, 120));
        return;
      }
      throw new Error(`POST /convert failed with ${res.status}: ${msg}`);
    }
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.body.slice(0, 5).toString()).toBe("%PDF-");
    expect(res.headers["content-disposition"]).toContain("stealth.pdf");
    // The vector PDF must contain a real /Link annotation (proof that the
    // anchor remained clickable, not flattened to a screenshot)
    expect(res.body.toString("binary")).toMatch(/\/Link/);
  }, 60000);

  test("multipart top-level fields (format, ctaUrl, crop) override JSON options [chromium]", async () => {
    // Send `format=Letter` as a top-level multipart field together with an
    // `options` JSON blob.  The server must merge them correctly so that
    // multipart callers (the dashboard) get the same behaviour as JSON.
    const res = await multipartRequest("/convert", {
      format: "Letter",
      ctaUrl: "https://example.com/landing",
      stealthLinks: "true",
      options: JSON.stringify({ printBackground: true }),
      filename: "merged.pdf",
    }, [
      { fieldName: "htmlFile", fileName: "x.html", contentType: "text/html",
        data: Buffer.from("<html><body><button>Buy now</button></body></html>") },
    ]);
    if (res.status !== 200) {
      const msg = res.body.toString().slice(0, 200);
      if (/scheduler_loop_quarantine_support|Failed to launch|Target.*closed/i.test(msg)) {
        console.warn("Skipping: Chromium unavailable —", msg.slice(0, 120));
        return;
      }
      throw new Error(`POST /convert failed with ${res.status}: ${msg}`);
    }
    expect(res.body.slice(0, 5).toString()).toBe("%PDF-");
    // /Link annotation proves the button got the invisible CTA wrapper
    expect(res.body.toString("binary")).toMatch(/\/Link/);
  }, 60000);
});
