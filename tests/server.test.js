const http = require("http");
const createServer = require("../src/server");

describe("PDF Server API", () => {
  let app, server, baseUrl;

  beforeAll((done) => {
    app = createServer();
    server = app.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://localhost:${port}`;
      done();
    });
  });

  afterAll((done) => {
    server.close(done);
  });

  function request(method, path, body, extraHeaders = {}) {
    return new Promise((resolve, reject) => {
      const url = new URL(path, baseUrl);
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

  test("GET / returns JSON API guide when Accept: application/json", async () => {
    const res = await request("GET", "/", undefined, { Accept: "application/json" });
    expect(res.status).toBe(200);
    const json = JSON.parse(res.body.toString());
    expect(json.name).toBe("PDF Engine API");
    expect(json.endpoints).toBeDefined();
    expect(json.templates).toEqual(expect.arrayContaining(["invoice", "resume"]));
  });

  test("GET / returns HTML web dashboard for browsers", async () => {
    const res = await request("GET", "/", undefined, { Accept: "text/html" });
    expect(res.status).toBe(200);
    expect(res.body.toString()).toContain("<!DOCTYPE html>");
  });

  test("GET /health returns ok", async () => {
    const res = await request("GET", "/health");
    expect(res.status).toBe(200);
    const json = JSON.parse(res.body.toString());
    expect(json.status).toBe("ok");
  });

  test("GET /templates lists available templates", async () => {
    const res = await request("GET", "/templates");
    expect(res.status).toBe(200);
    const json = JSON.parse(res.body.toString());
    expect(json.templates).toContain("invoice");
    expect(json.templates).toContain("resume");
  });

  test("POST /generate creates a PDF from raw spec", async () => {
    const res = await request("POST", "/generate", {
      spec: {
        elements: [
          { type: "heading", level: 1, value: "API Test" },
          { type: "link", value: "Click", url: "https://example.com" },
        ],
      },
    });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.body.slice(0, 5).toString()).toBe("%PDF-");
  });

  test("POST /generate returns 400 without elements", async () => {
    const res = await request("POST", "/generate", { spec: {} });
    expect(res.status).toBe(400);
  });

  test("POST /generate/:template creates a PDF from template", async () => {
    const res = await request("POST", "/generate/invoice", {
      data: {
        company: { name: "Test Co" },
        client: { name: "Client" },
        invoiceNumber: "001",
        items: [{ description: "Item", quantity: 1, unitPrice: 100 }],
      },
    });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.body.slice(0, 5).toString()).toBe("%PDF-");
  });

  test("POST /generate/:template returns 400 for unknown template", async () => {
    const res = await request("POST", "/generate/nonexistent", { data: {} });
    expect(res.status).toBe(400);
  });
});
