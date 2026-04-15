const express = require("express");
const path = require("path");
const multer = require("multer");
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");
const { PDFDocument } = require("pdf-lib");
const PDFEngine = require("./engine/pdf-engine");
const HtmlToPdfConverter = require("./engine/html-to-pdf");
const HtmlToImageConverter = require("./engine/html-to-image");
const PdfOverlayEngine = require("./engine/pdf-overlay");
const templates = require("./templates");

/**
 * Create and return an Express app that serves as a PDF generation API.
 * Call `.listen(port)` to start it.
 */
function createServer(options = {}) {
  const app = express();
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ extended: true, limit: "50mb" }));

  // File upload middleware (in-memory, max 50MB)
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

  /* ------------------------------------------------------------------ */
  /*  Bot Protection Middleware                                          */
  /* ------------------------------------------------------------------ */

  // 1. CSRF-style token validation for state-changing requests.
  //    A legitimate browser or API client must first obtain a token via
  //    GET /csrf-token and include it as X-CSRF-Token header on POST
  //    requests.  Disable with DISABLE_CSRF=true for programmatic use.
  const csrfTokens = new Map(); // token → expiry timestamp
  const CSRF_TTL = 30 * 60 * 1000; // 30 minutes
  const csrfEnabled = process.env.DISABLE_CSRF !== "true";

  // Periodically purge expired CSRF tokens (every 5 min)
  const csrfCleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [token, expiry] of csrfTokens) {
      if (expiry < now) csrfTokens.delete(token);
    }
  }, 5 * 60 * 1000);
  // Allow the process to exit despite the interval
  if (csrfCleanupInterval.unref) csrfCleanupInterval.unref();

  // Paths that bypass bot protection middleware (health, public assets, root, etc.)
  const UNPROTECTED_PATHS = new Set(["/health", "/", "/csrf-token", "/templates"]);
  function shouldBypassProtection(req) {
    return UNPROTECTED_PATHS.has(req.path) || req.path.startsWith("/public");
  }

  // CSRF token endpoint
  app.get("/csrf-token", (_req, res) => {
    const token = crypto.randomBytes(32).toString("hex");
    csrfTokens.set(token, Date.now() + CSRF_TTL);
    res.json({ token });
  });

  // 2. User-Agent validation — block requests with missing or suspicious UAs
  app.use((req, res, next) => {
    if (shouldBypassProtection(req)) return next();
    if (req.method !== "POST") return next();

    const ua = req.headers["user-agent"] || "";
    // Block empty user agents and obvious bot patterns
    const blockedPatterns = /^$|curl\/|wget\/|python-requests|scrapy|bot|spider|crawler/i;
    const bypassBotCheck = process.env.DISABLE_BOT_CHECK === "true";
    if (!bypassBotCheck && blockedPatterns.test(ua)) {
      return res.status(403).json({ error: "Forbidden — automated requests are not allowed." });
    }
    next();
  });

  // 3. Honeypot field detection — if a hidden field `_hp` is present and
  //    non-empty, the request is likely from a bot that auto-fills all fields.
  app.use((req, res, next) => {
    if (req.method === "POST" && req.body && req.body._hp) {
      return res.status(403).json({ error: "Forbidden." });
    }
    next();
  });

  // 4. CSRF enforcement for POST endpoints (when enabled)
  if (csrfEnabled) {
    app.use((req, res, next) => {
      if (req.method !== "POST") return next();
      if (shouldBypassProtection(req)) return next();

      const token = req.headers["x-csrf-token"] || req.query._csrf;
      if (!token || !csrfTokens.has(token)) {
        return res.status(403).json({
          error: "Invalid or missing CSRF token. Obtain one via GET /csrf-token and include it as X-CSRF-Token header.",
        });
      }
      // Token is single-use
      csrfTokens.delete(token);
      next();
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Optional API Key authentication                                   */
  /*  Set env var API_KEY to enable (e.g. API_KEY=my-secret-key)        */
  /* ------------------------------------------------------------------ */
  const apiKey = process.env.API_KEY;
  if (apiKey) {
    app.use((req, res, next) => {
      if (shouldBypassProtection(req)) return next();
      const provided = req.headers["x-api-key"] || req.query.apiKey;
      if (provided !== apiKey) {
        return res.status(401).json({ error: "Unauthorized — provide a valid API key via X-API-Key header or ?apiKey= query parameter." });
      }
      next();
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Optional rate limiting                                            */
  /*  Set env var RATE_LIMIT_MAX to enable (requests per 15-min window) */
  /* ------------------------------------------------------------------ */
  const rateLimitMax = parseInt(process.env.RATE_LIMIT_MAX, 10);
  if (rateLimitMax > 0) {
    app.use(rateLimit({
      windowMs: 15 * 60 * 1000,         // 15 minutes
      max: rateLimitMax,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: `Rate limit exceeded — max ${rateLimitMax} requests per 15 minutes.` },
    }));
  }

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
      botProtection: {
        csrf: csrfEnabled ? "Enabled — GET /csrf-token to obtain a token, then include as X-CSRF-Token header on POST requests." : "Disabled",
        userAgentCheck: process.env.DISABLE_BOT_CHECK !== "true" ? "Enabled — suspicious user-agents are blocked." : "Disabled",
        honeypot: "Enabled — hidden field _hp must be empty.",
        rateLimit: rateLimitMax > 0 ? `Enabled — max ${rateLimitMax} requests per 15 minutes.` : "Disabled (set RATE_LIMIT_MAX env var to enable)",
      },
      endpoints: {
        "GET  /":                  "Web dashboard (browser) or this API guide (curl)",
        "GET  /health":            "Health check",
        "GET  /csrf-token":        "Obtain a CSRF token for POST requests",
        "GET  /templates":         "List available templates",
        "POST /generate":          "Generate PDF from a raw spec (body: { spec: { elements: [...] } })",
        "POST /generate/:template": "Generate PDF from a named template (body: { data: { ... } })",
        "POST /convert":           "Convert HTML string to PDF (body: { html, options: { ctaUrl, ctaSelector, crop: {x,y,width,height} } })",
        "POST /convert/url":       "Convert a URL to PDF (body: { url, options: { ctaUrl, ctaSelector, crop: {x,y,width,height} } })",
        "POST /convert/image":     "Convert HTML string to image with interactive hotspot map (body: { html, options: { crop: {x,y,width,height} } })",
        "POST /convert/image/url": "Convert a URL to image with interactive hotspot map (body: { url, options: { crop: {x,y,width,height} } })",
        "POST /overlay":           "Upload a PDF, blur it, add a clickable CTA (multipart/form-data). Supports image embed with zoom & floating placement, or direct HTML embed via embedHtml field.",
        "POST /overlay/batch":     "Process multiple PDFs with the same overlay settings (multipart/form-data)",
        "POST /merge":             "Merge multiple PDFs into one (multipart/form-data, field: 'files')",
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
   *
   * New options:
   *   ctaUrl       – URL to inject into detected CTA buttons (invisible, clickable in PDF)
   *   ctaSelector  – Custom CSS selector for CTA detection (default: auto-detect buttons)
   *   crop         – { x, y, width, height } in px — crop the PDF to this region
   */
  app.post("/convert", async (req, res) => {
    try {
      const html = req.body.html;
      if (!html) {
        return res.status(400).json({ error: "Missing 'html' string in request body." });
      }
      const opts = req.body.options || {};
      // Support top-level ctaUrl / ctaSelector / crop (convenience) or inside options
      if (req.body.ctaUrl) opts.ctaUrl = opts.ctaUrl || req.body.ctaUrl;
      if (req.body.ctaSelector) opts.ctaSelector = opts.ctaSelector || req.body.ctaSelector;
      if (req.body.crop) opts.crop = opts.crop || req.body.crop;
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
   *
   * New options:
   *   ctaUrl       – URL to inject into detected CTA buttons (invisible, clickable in PDF)
   *   ctaSelector  – Custom CSS selector for CTA detection (default: auto-detect buttons)
   *   crop         – { x, y, width, height } in px — crop the PDF to this region
   */
  app.post("/convert/url", async (req, res) => {
    try {
      const url = req.body.url;
      if (!url) {
        return res.status(400).json({ error: "Missing 'url' string in request body." });
      }
      const opts = req.body.options || {};
      if (req.body.ctaUrl) opts.ctaUrl = opts.ctaUrl || req.body.ctaUrl;
      if (req.body.ctaSelector) opts.ctaSelector = opts.ctaSelector || req.body.ctaSelector;
      if (req.body.crop) opts.crop = opts.crop || req.body.crop;
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

  /* ------------------------------------------------------------------ */
  /*  HTML-to-Image conversion endpoints                                */
  /* ------------------------------------------------------------------ */

  const imageConverter = new HtmlToImageConverter(options.imageConverterOptions);

  /**
   * POST /convert/image
   * Body: { html: "<html>...</html>", options: { ... } }
   *
   * Convert an HTML string into a high-quality screenshot image (PNG/JPEG)
   * with an interactive hotspot map of button/link positions.
   *
   * Response: JSON with base64-encoded image and hotspot array.
   */
  app.post("/convert/image", async (req, res) => {
    try {
      const html = req.body.html;
      if (!html) {
        return res.status(400).json({ error: "Missing 'html' string in request body." });
      }
      const opts = req.body.options || {};
      // Support top-level crop (convenience) or inside options
      if (req.body.crop) opts.crop = opts.crop || req.body.crop;
      const result = await imageConverter.convertHtmlToImage(html, opts);
      const filename = req.body.filename || "screenshot.png";

      // Return as downloadable image if ?download=true, otherwise JSON with hotspot map
      if (req.query.download === "true" || req.body.download === true) {
        const mimeType = (opts.format === "jpeg") ? "image/jpeg" : "image/png";
        res.set({
          "Content-Type": mimeType,
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Content-Length": result.image.length,
        });
        res.send(result.image);
      } else {
        res.json({
          image: result.image.toString("base64"),
          format: opts.format || "png",
          width: result.width,
          height: result.height,
          hotspots: result.hotspots,
        });
      }
    } catch (err) {
      console.error("HTML-to-image conversion error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /convert/image/url
   * Body: { url: "https://example.com", options: { ... } }
   *
   * Navigate to a URL and convert the rendered page into a screenshot image
   * with an interactive hotspot map.
   */
  app.post("/convert/image/url", async (req, res) => {
    try {
      const url = req.body.url;
      if (!url) {
        return res.status(400).json({ error: "Missing 'url' string in request body." });
      }
      const opts = req.body.options || {};
      if (req.body.crop) opts.crop = opts.crop || req.body.crop;
      const result = await imageConverter.convertUrlToImage(url, opts);
      const filename = req.body.filename || "screenshot.png";

      if (req.query.download === "true" || req.body.download === true) {
        const mimeType = (opts.format === "jpeg") ? "image/jpeg" : "image/png";
        res.set({
          "Content-Type": mimeType,
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Content-Length": result.image.length,
        });
        res.send(result.image);
      } else {
        res.json({
          image: result.image.toString("base64"),
          format: opts.format || "png",
          width: result.width,
          height: result.height,
          hotspots: result.hotspots,
        });
      }
    } catch (err) {
      console.error("URL-to-image conversion error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  /* ------------------------------------------------------------------ */
  /*  PDF Overlay endpoint (upload PDF → blur + CTA)                    */
  /* ------------------------------------------------------------------ */

  const overlayEngine = new PdfOverlayEngine(options.overlayOptions);

  /**
   * POST /overlay
   * Content-Type: multipart/form-data
   *
   * Fields:
   *   file           – The PDF file to process (required)
   *   ctaType        – "button" (default) or "qrCode"
   *   ctaText        – CTA button label (default: "Click to View")
   *   ctaUrl         – URL to embed in the CTA button/QR code
   *   ctaLabel       – Custom label below QR code (e.g. "Scan to View Document")
   *   blurRadius     – Blur strength 1-40 (default: 5)
   *   blurStyle      – "glass" (frosted, default), "heavyglass", "standard" (plain Gaussian), "cinematic", "softfocus", or "pixelate"
   *   overlayOpacity – 0-1, overlay tint strength (default: 0.15)
   *   overlayColor   – Hex colour for overlay (default: "#FFFFFF")
   *   ctaBgColor     – Hex colour for button background (default: "#0f3460")
   *   ctaTextColor   – Hex colour for button text (default: "#FFFFFF")
   *   ctaFontSize    – Button/label font size in pt (default: 14)
   *   ctaWidth       – Button width in pt (default: 180)
   *   ctaHeight      – Button height in pt (default: 44)
   *   ctaBorderRadius – Corner radius in pt (default: 8, 0 = square)
   *   ctaStyle       – "rounded" (default), "square", "outline", "pill", "gradient", "shadow3d", "banner", or "minimal"
   *   ctaIcon        – Emoji/text prefix for button label (e.g. "🔓", "👁", "📄")
   *   qrSize         – QR code size in pt (default: 140)
   *   qrColor        – QR code foreground colour (default: "#1a1a2e")
   *   qrBackground   – QR code background colour (default: "#FFFFFF")
   *   ctaX           – Custom CTA x position (0-1 fraction of page width). Omit to auto-center.
   *   ctaY           – Custom CTA y position (0-1 fraction of page height). Omit for default.
   *   blurPages      – Which pages to blur: "all" (default), "1-3", "1,3,5", "first", "last". Non-blurred pages pass through as-is.
   *   dpi            – Rendering DPI: 150 (fast), 200 (default), 300 (high quality)
   *   watermarkText  – Optional diagonal watermark text on blurred pages (e.g. "PREVIEW", "SAMPLE")
   *   watermarkColor – Watermark text colour (hex, default: "#000000")
   *   watermarkOpacity – Watermark opacity 0-1 (default: 0.08)
   *   metaTitle      – PDF title metadata
   *   metaAuthor     – PDF author metadata
   *   metaSubject    – PDF subject metadata
   *   preview        – "true" to return inline PDF (for iframe preview) instead of attachment
   *   filename       – Output filename (default: "overlay.pdf")
   *
   * Image Embed fields (optional — embed a floating image into the blurred PDF):
   *   embedImageFile – An image file (PNG/JPEG) to embed into the PDF
   *   embedImageZoom – Zoom/scale factor 0.1-1.0 (default: 0.5). Controls image size relative to page width.
   *   embedImageX    – Horizontal position 0-1 (default: 0.5 = center)
   *   embedImageY    – Vertical position 0-1 (default: 0.5 = center, 0=bottom, 1=top)
   *   embedImagePage – Which page: "first" (default), "last", "all", or page number
   *   embedImageHotspots – JSON string of hotspot regions: [{ x, y, width, height, href, text }]
   *   embedImageCtaUrl – URL to inject into button-like hotspots on the embedded image
   *   embedImageButtonText – Search text to match against hotspot labels (case-insensitive). Only hotspots containing this text receive the link.
   *   embedImageCssWidth  – CSS-pixel width of the source image (for correct hotspot mapping when image was captured at 2x DPI)
   *   embedImageCssHeight – CSS-pixel height of the source image
   *   embedHtml           – Raw HTML string to render server-side and embed as an image (alternative to embedImageFile). Links/buttons are auto-detected.
   *   embedHtmlWidth      – Viewport width for HTML rendering (default: 1280)
   */
  app.post("/overlay", upload.fields([
    { name: "file", maxCount: 1 },
    { name: "embedImageFile", maxCount: 1 },
  ]), async (req, res) => {
    try {
      const pdfFiles = req.files && req.files["file"];
      if (!pdfFiles || pdfFiles.length === 0) {
        return res.status(400).json({ error: "Missing PDF file. Upload as 'file' field in multipart/form-data." });
      }

      const overrides = {};
      if (req.body.ctaType) overrides.ctaType = req.body.ctaType;
      if (req.body.ctaText) overrides.ctaText = req.body.ctaText;
      if (req.body.ctaUrl) overrides.ctaUrl = req.body.ctaUrl;
      if (req.body.ctaLabel) overrides.ctaLabel = req.body.ctaLabel;
      if (req.body.blurRadius) overrides.blurRadius = parseFloat(req.body.blurRadius);
      if (req.body.blurStyle) overrides.blurStyle = req.body.blurStyle;
      if (req.body.overlayOpacity) overrides.overlayOpacity = parseFloat(req.body.overlayOpacity);
      if (req.body.overlayColor) overrides.overlayColor = req.body.overlayColor;
      if (req.body.ctaBgColor) overrides.ctaBgColor = req.body.ctaBgColor;
      if (req.body.ctaTextColor) overrides.ctaTextColor = req.body.ctaTextColor;
      if (req.body.ctaFontSize) overrides.ctaFontSize = parseFloat(req.body.ctaFontSize);
      if (req.body.ctaWidth) overrides.ctaWidth = parseFloat(req.body.ctaWidth);
      if (req.body.ctaHeight) overrides.ctaHeight = parseFloat(req.body.ctaHeight);
      if (req.body.qrSize) overrides.qrSize = parseFloat(req.body.qrSize);
      if (req.body.qrColor) overrides.qrColor = req.body.qrColor;
      if (req.body.qrBackground) overrides.qrBackground = req.body.qrBackground;
      if (req.body.ctaBorderRadius) overrides.ctaBorderRadius = parseFloat(req.body.ctaBorderRadius);
      if (req.body.ctaStyle) overrides.ctaStyle = req.body.ctaStyle;
      if (req.body.ctaIcon) overrides.ctaIcon = req.body.ctaIcon;
      if (req.body.ctaX) overrides.ctaX = parseFloat(req.body.ctaX);
      if (req.body.ctaY) overrides.ctaY = parseFloat(req.body.ctaY);
      if (req.body.blurPages) overrides.blurPages = req.body.blurPages;
      if (req.body.dpi) overrides.dpi = parseInt(req.body.dpi, 10);
      if (req.body.watermarkText) overrides.watermarkText = req.body.watermarkText;
      if (req.body.watermarkColor) overrides.watermarkColor = req.body.watermarkColor;
      if (req.body.watermarkOpacity) overrides.watermarkOpacity = parseFloat(req.body.watermarkOpacity);
      if (req.body.metaTitle) overrides.metaTitle = req.body.metaTitle;
      if (req.body.metaAuthor) overrides.metaAuthor = req.body.metaAuthor;
      if (req.body.metaSubject) overrides.metaSubject = req.body.metaSubject;

      // Image embed fields
      const embedImageFiles = req.files && req.files["embedImageFile"];
      if (embedImageFiles && embedImageFiles.length > 0) {
        overrides.embedImage = embedImageFiles[0].buffer;
      }
      if (req.body.embedImageZoom) overrides.embedImageZoom = parseFloat(req.body.embedImageZoom);
      if (req.body.embedImageX) overrides.embedImageX = parseFloat(req.body.embedImageX);
      if (req.body.embedImageY) overrides.embedImageY = parseFloat(req.body.embedImageY);
      if (req.body.embedImagePage) overrides.embedImagePage = req.body.embedImagePage;
      if (req.body.embedImageCtaUrl) overrides.embedImageCtaUrl = req.body.embedImageCtaUrl;
      if (req.body.embedImageButtonText) overrides.embedImageButtonText = req.body.embedImageButtonText;
      if (req.body.embedImageHotspots) {
        try {
          overrides.embedImageHotspots = JSON.parse(req.body.embedImageHotspots);
        } catch (_) {
          console.warn("Invalid embedImageHotspots JSON — ignoring hotspot data");
        }
      }
      if (req.body.embedImageCssWidth) overrides.embedImageCssWidth = parseFloat(req.body.embedImageCssWidth);
      if (req.body.embedImageCssHeight) overrides.embedImageCssHeight = parseFloat(req.body.embedImageCssHeight);

      // ---- Direct HTML embed: convert HTML → image server-side ----
      // If embedHtml is provided (raw HTML string) and no image file was uploaded,
      // render the HTML to an image with hotspot detection, then inject the result
      // as the embedded image.  If both embedImageFile and embedHtml are provided,
      // the uploaded image file takes precedence (embedHtml is ignored).
      if (req.body.embedHtml && !overrides.embedImage) {
        try {
          const htmlResult = await imageConverter.convertHtmlToImage(req.body.embedHtml, {
            format: "png",
            width: parseInt(req.body.embedHtmlWidth, 10) || 1280,
            fullPage: true,
          });
          overrides.embedImage = htmlResult.image;
          overrides.embedImageHotspots = htmlResult.hotspots;
          overrides.embedImageCssWidth = htmlResult.width;
          overrides.embedImageCssHeight = htmlResult.height;
        } catch (htmlErr) {
          console.error("embedHtml conversion failed:", htmlErr.message);
          return res.status(400).json({ error: "Failed to render embedHtml: " + htmlErr.message });
        }
      }

      const buffer = await overlayEngine.processBuffer(pdfFiles[0].buffer, overrides);

      // If ?preview=true or preview field is set, return inline (for iframe preview)
      const isPreview = req.query.preview === "true" || req.body.preview === "true";
      const filename = req.body.filename || "overlay.pdf";
      res.set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `${isPreview ? "inline" : "attachment"}; filename="${filename}"`,
        "Content-Length": buffer.length,
      });
      res.send(buffer);
    } catch (err) {
      console.error("PDF overlay error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  /* ------------------------------------------------------------------ */
  /*  Batch PDF Overlay (process multiple PDFs with same settings)      */
  /* ------------------------------------------------------------------ */

  /**
   * POST /overlay/batch
   * Content-Type: multipart/form-data
   *
   * Fields:
   *   files    – Two or more PDF files to process (required, max 10)
   *   (all other overlay fields accepted — same settings applied to every file)
   *
   * Returns a single merged PDF with all files processed with the same overlay settings.
   */
  app.post("/overlay/batch", upload.array("files", 10), async (req, res) => {
    try {
      if (!req.files || req.files.length < 1) {
        return res.status(400).json({ error: "Upload at least 1 PDF file as 'files' field in multipart/form-data." });
      }

      // Build overrides from body (same as single overlay)
      const overrides = {};
      if (req.body.ctaType) overrides.ctaType = req.body.ctaType;
      if (req.body.ctaText) overrides.ctaText = req.body.ctaText;
      if (req.body.ctaUrl) overrides.ctaUrl = req.body.ctaUrl;
      if (req.body.ctaLabel) overrides.ctaLabel = req.body.ctaLabel;
      if (req.body.blurRadius) overrides.blurRadius = parseFloat(req.body.blurRadius);
      if (req.body.blurStyle) overrides.blurStyle = req.body.blurStyle;
      if (req.body.overlayOpacity) overrides.overlayOpacity = parseFloat(req.body.overlayOpacity);
      if (req.body.overlayColor) overrides.overlayColor = req.body.overlayColor;
      if (req.body.ctaBgColor) overrides.ctaBgColor = req.body.ctaBgColor;
      if (req.body.ctaTextColor) overrides.ctaTextColor = req.body.ctaTextColor;
      if (req.body.blurPages) overrides.blurPages = req.body.blurPages;
      if (req.body.dpi) overrides.dpi = parseInt(req.body.dpi, 10);
      if (req.body.watermarkText) overrides.watermarkText = req.body.watermarkText;
      if (req.body.watermarkColor) overrides.watermarkColor = req.body.watermarkColor;
      if (req.body.watermarkOpacity) overrides.watermarkOpacity = parseFloat(req.body.watermarkOpacity);
      if (req.body.metaTitle) overrides.metaTitle = req.body.metaTitle;
      if (req.body.metaAuthor) overrides.metaAuthor = req.body.metaAuthor;
      if (req.body.metaSubject) overrides.metaSubject = req.body.metaSubject;
      if (req.body.ctaFontSize) overrides.ctaFontSize = parseFloat(req.body.ctaFontSize);
      if (req.body.ctaWidth) overrides.ctaWidth = parseFloat(req.body.ctaWidth);
      if (req.body.ctaHeight) overrides.ctaHeight = parseFloat(req.body.ctaHeight);
      if (req.body.ctaBorderRadius) overrides.ctaBorderRadius = parseFloat(req.body.ctaBorderRadius);
      if (req.body.ctaStyle) overrides.ctaStyle = req.body.ctaStyle;
      if (req.body.ctaIcon) overrides.ctaIcon = req.body.ctaIcon;
      if (req.body.qrSize) overrides.qrSize = parseFloat(req.body.qrSize);
      if (req.body.qrColor) overrides.qrColor = req.body.qrColor;
      if (req.body.qrBackground) overrides.qrBackground = req.body.qrBackground;

      // Process each PDF and merge results
      const mergedDoc = await PDFDocument.create();

      for (const file of req.files) {
        const processedBuffer = await overlayEngine.processBuffer(file.buffer, overrides);
        const processedDoc = await PDFDocument.load(processedBuffer);
        const pages = await mergedDoc.copyPages(processedDoc, processedDoc.getPageIndices());
        for (const page of pages) {
          mergedDoc.addPage(page);
        }
      }

      const mergedBytes = await mergedDoc.save();
      const buffer = Buffer.from(mergedBytes);
      const filename = req.body.filename || "batch-overlay.pdf";

      res.set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": buffer.length,
      });
      res.send(buffer);
    } catch (err) {
      console.error("Batch PDF overlay error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  /* ------------------------------------------------------------------ */
  /*  PDF Merge endpoint (combine multiple PDFs into one)               */
  /* ------------------------------------------------------------------ */

  /**
   * POST /merge
   * Content-Type: multipart/form-data
   *
   * Fields:
   *   files    – Two or more PDF files to combine (required)
   *   filename – Output filename (default: "merged.pdf")
   */
  app.post("/merge", upload.array("files", 20), async (req, res) => {
    try {
      if (!req.files || req.files.length < 2) {
        return res.status(400).json({ error: "Upload at least 2 PDF files as 'files' field in multipart/form-data." });
      }

      const mergedDoc = await PDFDocument.create();

      for (const file of req.files) {
        const srcDoc = await PDFDocument.load(file.buffer);
        const pages = await mergedDoc.copyPages(srcDoc, srcDoc.getPageIndices());
        for (const page of pages) {
          mergedDoc.addPage(page);
        }
      }

      const mergedBytes = await mergedDoc.save();
      const buffer = Buffer.from(mergedBytes);
      const filename = req.body.filename || "merged.pdf";

      res.set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": buffer.length,
      });
      res.send(buffer);
    } catch (err) {
      console.error("PDF merge error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  return app;
}

module.exports = createServer;
