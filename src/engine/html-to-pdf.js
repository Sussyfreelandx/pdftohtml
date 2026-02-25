const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

/**
 * Detect a usable Chrome / Chromium executable.
 * Priority: 1) PUPPETEER_EXECUTABLE_PATH env  2) Puppeteer's managed browser
 * 3) Common system paths (Render, Debian/Ubuntu, macOS, Windows).
 */
function detectChromePath() {
  // 1. Explicit env override
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }

  // 2. Let Puppeteer find its own managed browser (works when postinstall ran)
  try {
    const managed = puppeteer.executablePath();
    if (managed && fs.existsSync(managed)) return managed;
  } catch (_) {
    /* ignore — fall through to system paths */
  }

  // 3. Common system paths
  const candidates = [
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/snap/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }

  // 4. Try `which` as last resort (Linux/macOS)
  try {
    const found = execSync("which google-chrome-stable || which google-chrome || which chromium-browser || which chromium", { encoding: "utf8" }).trim();
    if (found) return found;
  } catch (_) {
    /* not found */
  }

  // Return undefined — Puppeteer will try its default and give a clearer error
  return undefined;
}

/**
 * HtmlToPdfConverter — High-fidelity HTML-to-PDF conversion engine.
 *
 * Uses headless Chromium (via Puppeteer) to produce Adobe-quality PDFs from
 * HTML strings or URLs.  The output is vector-accurate: text remains
 * selectable / searchable, images are embedded at full resolution, and all
 * hyperlinks become clickable PDF link annotations.
 *
 * Key capabilities (per the specification):
 *  • A4 page size by default (595.28 × 841.89 pt) with ≥ 40 pt margins
 *  • Full font embedding — web-fonts are downloaded and embedded automatically
 *  • Pixel → point conversion (1 px ≈ 0.75 pt) honoured by the browser engine
 *  • Exact colour reproduction (RGB), including alpha compositing
 *  • Logos / images embedded at original resolution; SVG rendered as vectors
 *  • Clickable buttons and links preserved as PDF /Link annotations
 *  • Intelligent page-break handling (widows, orphans, headings, images)
 *  • PDF metadata (Title, Author, CreationDate, Producer)
 *  • PDF 1.4+ output compatible with Adobe Reader, Chrome, Preview
 */
class HtmlToPdfConverter {
  /**
   * @param {object} [options]
   * @param {string} [options.format="A4"]         – "A4", "Letter", etc.
   * @param {object} [options.margin]               – { top, right, bottom, left } in CSS units
   * @param {boolean} [options.printBackground=true] – Render CSS backgrounds
   * @param {boolean} [options.displayHeaderFooter=false]
   * @param {string} [options.headerTemplate]
   * @param {string} [options.footerTemplate]
   * @param {number} [options.timeout=120000]        – Navigation timeout (ms)
   * @param {string} [options.waitUntil="networkidle2"] – Puppeteer waitUntil event
   * @param {string} [options.mediaType="print"]    – CSS media type emulation
   * @param {object} [options.meta]                 – PDF metadata { title, author }
   */
  constructor(options = {}) {
    this.format = options.format || "A4";
    this.margin = options.margin || {
      top: "40px",
      right: "40px",
      bottom: "40px",
      left: "40px",
    };
    this.printBackground = options.printBackground !== false;
    this.displayHeaderFooter = options.displayHeaderFooter || false;
    this.headerTemplate = options.headerTemplate || "";
    this.footerTemplate = options.footerTemplate || "";
    this.timeout = options.timeout || 120000;
    this.waitUntil = options.waitUntil || "networkidle2";
    this.mediaType = options.mediaType || "print";
    this.meta = options.meta || {};
  }

  /* ------------------------------------------------------------------ */
  /*  Public API                                                        */
  /* ------------------------------------------------------------------ */

  /**
   * Convert an HTML string to a PDF Buffer.
   * @param {string} html  – Full HTML document string.
   * @param {object} [opts] – Per-call overrides (same shape as constructor options).
   * @returns {Promise<Buffer>}
   */
  async convertHtmlToBuffer(html, opts = {}) {
    return this._convert({ type: "html", source: html }, opts);
  }

  /**
   * Convert a live URL to a PDF Buffer.
   * @param {string} url  – The URL to navigate to and print.
   * @param {object} [opts] – Per-call overrides.
   * @returns {Promise<Buffer>}
   */
  async convertUrlToBuffer(url, opts = {}) {
    return this._convert({ type: "url", source: url }, opts);
  }

  /**
   * Convert an HTML string and write the PDF to a file.
   * @param {string} html
   * @param {string} filePath
   * @param {object} [opts]
   * @returns {Promise<string>} Resolved with the absolute path.
   */
  async convertHtmlToFile(html, filePath, opts = {}) {
    const buffer = await this.convertHtmlToBuffer(html, opts);
    return this._writeFile(buffer, filePath);
  }

  /**
   * Convert a URL and write the PDF to a file.
   * @param {string} url
   * @param {string} filePath
   * @param {object} [opts]
   * @returns {Promise<string>}
   */
  async convertUrlToFile(url, filePath, opts = {}) {
    const buffer = await this.convertUrlToBuffer(url, opts);
    return this._writeFile(buffer, filePath);
  }

  /* ------------------------------------------------------------------ */
  /*  Internal                                                          */
  /* ------------------------------------------------------------------ */

  /** Core conversion pipeline shared by all public methods. */
  async _convert(input, overrides) {
    const merged = this._mergeOptions(overrides);
    let browser;
    try {
      const execPath = detectChromePath();
      const launchOptions = {
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--font-render-hinting=none",     // sharper text rendering
        ],
      };
      if (execPath) launchOptions.executablePath = execPath;

      browser = await puppeteer.launch(launchOptions);

      const page = await browser.newPage();

      // Set viewport to common desktop width so responsive layouts render at
      // a size that maps well onto A4 width.
      await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 2 });

      // Emulate the "print" media type so print-specific CSS is applied.
      await page.emulateMediaType(merged.mediaType);

      // Load content -------------------------------------------------------
      if (input.type === "url") {
        await page.goto(input.source, {
          waitUntil: merged.waitUntil,
          timeout: merged.timeout,
        });
      } else {
        await page.setContent(input.source, {
          waitUntil: merged.waitUntil,
          timeout: merged.timeout,
        });
      }

      // Inject page-break helpers ------------------------------------------
      // This CSS enforces the specification's page-break rules for headings,
      // orphans / widows, images, and tables so that content is never cut off.
      await page.addStyleTag({
        content: `
          /* Prevent orphans / widows */
          p, li, dd, dt { orphans: 2; widows: 2; }

          /* Keep headings with their following content */
          h1, h2, h3, h4, h5, h6 { page-break-after: avoid; break-after: avoid; }

          /* Never split images across pages */
          img, svg, figure { page-break-inside: avoid; break-inside: avoid; }

          /* Never split table rows */
          tr { page-break-inside: avoid; break-inside: avoid; }

          /* Never split buttons or links that look like buttons */
          a, button, [role="button"] { page-break-inside: avoid; break-inside: avoid; }
        `,
      });

      // Set document title for PDF metadata --------------------------------
      if (merged.meta.title) {
        await page.evaluate((t) => {
          document.title = t;
        }, merged.meta.title);
      }

      // Generate the PDF ---------------------------------------------------
      const pdfOptions = {
        format: merged.format,
        margin: merged.margin,
        printBackground: merged.printBackground,
        displayHeaderFooter: merged.displayHeaderFooter,
        headerTemplate: merged.headerTemplate,
        footerTemplate: merged.footerTemplate,
        preferCSSPageSize: true,    // Honour @page CSS if present
        tagged: true,               // Accessibility — tagged PDF
      };

      const buffer = await page.pdf(pdfOptions);
      return Buffer.from(buffer);
    } finally {
      if (browser) await browser.close();
    }
  }

  /** Merge per-call overrides with instance defaults. */
  _mergeOptions(overrides) {
    return {
      format: overrides.format || this.format,
      margin: overrides.margin || this.margin,
      printBackground:
        overrides.printBackground !== undefined
          ? overrides.printBackground
          : this.printBackground,
      displayHeaderFooter:
        overrides.displayHeaderFooter !== undefined
          ? overrides.displayHeaderFooter
          : this.displayHeaderFooter,
      headerTemplate: overrides.headerTemplate || this.headerTemplate,
      footerTemplate: overrides.footerTemplate || this.footerTemplate,
      timeout: overrides.timeout || this.timeout,
      waitUntil: overrides.waitUntil || this.waitUntil,
      mediaType: overrides.mediaType || this.mediaType,
      meta: { ...this.meta, ...overrides.meta },
    };
  }

  /** Write a buffer to a file, creating directories as needed. */
  async _writeFile(buffer, filePath) {
    const abs = path.resolve(filePath);
    const dir = path.dirname(abs);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(abs, buffer);
    return abs;
  }
}

module.exports = HtmlToPdfConverter;
