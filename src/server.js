const express = require("express");
const path = require("path");
const PDFEngine = require("./engine/pdf-engine");
const HtmlToPdfConverter = require("./engine/html-to-pdf");
const templates = require("./templates");

/**
 * Create and return an Express app that serves as a PDF generation API.
 * Call `.listen(port)` to start it.
 */
function createServer(options = {}) {
  const app = express();
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ extended: true, limit: "50mb" }));

  // Serve static assets from public/ (but not index.html at root —
  // that is handled by the GET / route to support content negotiation).
  app.use(express.static(path.join(__dirname, "..", "public"), { index: false }));

  const engine = new PDFEngine(options.engineOptions);

  // Root — serve web dashboard (browser) or API guide (curl / programmatic)
  app.get("/", (_req, res) => {
    // If the client accepts HTML (i.e. a browser), serve the web dashboard
    if (_req.accepts("html")) {
      return res.sendFile(path.join(__dirname, "..", "public", "index.html"));
    }
    // Otherwise return the JSON API guide (for curl, Postman, etc.)
    res.json({
      name: "PDF Engine API",
      version: "1.0.0",
      description: "Server-side PDF generation engine — build any type of PDF from scratch.",
      endpoints: {
        "GET  /":                  "Web dashboard (browser) or this API guide (curl)",
        "GET  /health":            "Health check",
        "GET  /templates":         "List available templates",
        "POST /generate":          "Generate PDF from a raw spec (body: { spec: { elements: [...] } })",
        "POST /generate/:template": "Generate PDF from a named template (body: { data: { ... } })",
        "POST /convert":           "Convert HTML string to PDF (body: { html: '...', options: {} })",
        "POST /convert/url":       "Convert a URL to PDF (body: { url: '...', options: {} })",
      },
      templates: Object.keys(templates),
    });
  });

  // Health check
  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  // List available templates
  app.get("/templates", (_req, res) => {
    res.json({ templates: Object.keys(templates) });
  });

  /**
   * POST /generate
   * Body: { spec: { ... } }
   *
   * Generate a PDF from a raw spec object.
   * Returns the PDF as a downloadable binary.
   */
  app.post("/generate", async (req, res) => {
    try {
      const spec = req.body.spec || req.body;
      if (!spec || (!spec.elements && !spec.content)) {
        return res.status(400).json({ error: "Missing 'spec' with 'elements' array." });
      }
      const buffer = await engine.generateToBuffer(spec);
      const filename = req.body.filename || "document.pdf";
      res.set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": buffer.length,
      });
      res.send(buffer);
    } catch (err) {
      console.error("PDF generation error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /generate/:template
   * Body: { data: { ... } }
   *
   * Generate a PDF using a named template (invoice, resume, report, contract, certificate, letter).
   */
  app.post("/generate/:template", async (req, res) => {
    try {
      const templateName = req.params.template;
      const templateFn = templates[templateName];
      if (!templateFn) {
        return res.status(400).json({
          error: `Unknown template "${templateName}". Available: ${Object.keys(templates).join(", ")}`,
        });
      }
      const data = req.body.data || req.body;
      const spec = templateFn(data);
      const buffer = await engine.generateToBuffer(spec);
      const filename = req.body.filename || `${templateName}.pdf`;
      res.set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": buffer.length,
      });
      res.send(buffer);
    } catch (err) {
      console.error("PDF generation error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  /* ------------------------------------------------------------------ */
  /*  HTML-to-PDF conversion endpoints                                  */
  /* ------------------------------------------------------------------ */

  const converter = new HtmlToPdfConverter(options.converterOptions);

  /**
   * POST /convert
   * Body: { html: "<html>...</html>", options: { ... } }
   *
   * Convert an HTML string into a high-fidelity PDF.
   * Options may override format, margin, printBackground, meta, etc.
   */
  app.post("/convert", async (req, res) => {
    try {
      const html = req.body.html;
      if (!html) {
        return res.status(400).json({ error: "Missing 'html' string in request body." });
      }
      const opts = req.body.options || {};
      const buffer = await converter.convertHtmlToBuffer(html, opts);
      const filename = req.body.filename || "converted.pdf";
      res.set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": buffer.length,
      });
      res.send(buffer);
    } catch (err) {
      console.error("HTML-to-PDF conversion error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /convert/url
   * Body: { url: "https://example.com", options: { ... } }
   *
   * Navigate to a URL and convert the rendered page into a PDF.
   */
  app.post("/convert/url", async (req, res) => {
    try {
      const url = req.body.url;
      if (!url) {
        return res.status(400).json({ error: "Missing 'url' string in request body." });
      }
      const opts = req.body.options || {};
      const buffer = await converter.convertUrlToBuffer(url, opts);
      const filename = req.body.filename || "converted.pdf";
      res.set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": buffer.length,
      });
      res.send(buffer);
    } catch (err) {
      console.error("URL-to-PDF conversion error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  return app;
}

module.exports = createServer;
