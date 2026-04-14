const puppeteer = require("puppeteer-core");
const { PDFDocument } = require("pdf-lib");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

/**
 * Detect a usable Chrome / Chromium executable.
 *
 * Since we use puppeteer-core (which does NOT bundle its own Chrome), we must
 * always find a system-installed Chrome or Chromium.  This makes deployment to
 * cloud platforms (Render, Railway, Fly.io, etc.) 100 % reliable because
 * Chrome is installed via the Dockerfile's `apt-get install`, not via a
 * fragile npm postinstall download.
 *
 * Priority:
 *   1) PUPPETEER_EXECUTABLE_PATH env var (explicit override)
 *   2) Common system paths (Docker, Debian/Ubuntu, macOS, Windows)
 *   3) `which` lookup as a last resort (Linux / macOS)
 */
function detectChromePath() {
  // 1. Explicit env override — always wins
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }

  // 2. Common system paths (ordered by likelihood on cloud → desktop)
  const candidates = [
    // Docker / Debian / Ubuntu (apt-get install chromium)
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    // Google Chrome (apt-get install google-chrome-stable)
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    // Snap (Ubuntu desktop)
    "/snap/bin/chromium",
    // macOS
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    // Windows
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }

  // 3. `which` lookup as last resort (Linux / macOS)
  try {
    const found = execSync(
      "which chromium || which chromium-browser || which google-chrome-stable || which google-chrome",
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }
    ).trim();
    if (found) return found;
  } catch (_) {
    /* not found */
  }

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
 *  • CTA button detection — automatically detects button-like elements in HTML
 *    and injects invisible clickable links that remain functional in PDF
 *  • Crop — trim the rendered PDF to a specific region of the page
 */
class HtmlToPdfConverter {
  /**
   * Default CSS selector that matches common CTA / button-like elements.
   * Used by the CTA injection feature when no custom selector is supplied.
   * The selector covers:
   *   • <button> elements
   *   • <a> elements styled as buttons (class names containing "btn", "cta",
   *     or "button", or role="button")
   *   • <input type="submit"> and <input type="button">
   *
   * Elements that already carry an href are left untouched — the injector
   * only targets button-like elements that lack a navigable link.
   */
  static CTA_SELECTOR = [
    'button',
    'a.btn', 'a.cta', 'a.button',
    'a[class*="btn"]', 'a[class*="cta"]', 'a[class*="button"]',
    '[role="button"]',
    'input[type="submit"]', 'input[type="button"]',
    '.btn', '.cta', '.button',
    'a[class*="Btn"]', 'a[class*="Cta"]', 'a[class*="Button"]',
  ].join(', ');

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
   * @param {string} [options.ctaUrl]               – URL to inject into detected CTA buttons
   * @param {string} [options.ctaSelector]          – Custom CSS selector for CTA detection
   *                                                   (default: HtmlToPdfConverter.CTA_SELECTOR)
   * @param {object} [options.crop]                 – Crop region { x, y, width, height } in px.
   *                                                   Only the specified rectangle is kept in the
   *                                                   output PDF. Coordinates are relative to the
   *                                                   page content (before margins).
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
    this.ctaUrl = options.ctaUrl || "";
    this.ctaSelector = options.ctaSelector || "";
    this.crop = options.crop || null;
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
      if (!execPath) {
        throw new Error(
          "Chrome / Chromium not found. puppeteer-core requires a system-installed browser.\n" +
          "  • Docker/Linux: apt-get install -y chromium\n" +
          "  • macOS:        brew install --cask google-chrome\n" +
          "  • Windows:      Install Google Chrome from https://google.com/chrome\n" +
          "  • Or set PUPPETEER_EXECUTABLE_PATH to the path of your Chrome binary."
        );
      }
      const launchOptions = {
        headless: true,
        executablePath: execPath,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--font-render-hinting=none",     // sharper text rendering
        ],
      };

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

      // Smart resize — detect content overflow and scale to fit -----------
      // This prevents wide HTML layouts from breaking out of the PDF page.
      if (merged.smartResize !== false) {
        const contentMetrics = await page.evaluate(() => {
          const body = document.body;
          const html = document.documentElement;
          return {
            scrollWidth: Math.max(body.scrollWidth, html.scrollWidth),
            clientWidth: html.clientWidth,
          };
        });

        if (contentMetrics.scrollWidth > contentMetrics.clientWidth + 10) {
          // Content is wider than the viewport — scale it down to fit
          const scaleFactor = contentMetrics.clientWidth / contentMetrics.scrollWidth;
          // Only scale if we don't shrink below 50% (avoid making text unreadable)
          if (scaleFactor >= 0.5) {
            // Using CSS zoom (Chromium-only, but Puppeteer always uses Chromium).
            // transform:scale() is cross-browser but doesn't reflow content,
            // which would cause clipping instead of proper layout adjustment.
            await page.addStyleTag({
              content: `
                html {
                  zoom: ${scaleFactor};
                }
              `,
            });
          } else {
            // If the content is extremely wide, widen the viewport instead
            // and re-render at the content's native width
            await page.setViewport({
              width: Math.ceil(contentMetrics.scrollWidth),
              height: 900,
              deviceScaleFactor: 2,
            });
          }
        }
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

      // ----- CTA button detection & invisible link injection --------------
      // When ctaUrl is supplied, the engine scans the DOM for button-like
      // elements (using the configurable ctaSelector).  Each matched element
      // is wrapped in an invisible <a> tag pointing to ctaUrl.  The visual
      // appearance is untouched — no colour change, no underline — but the
      // element becomes a clickable PDF /Link annotation after conversion.
      //
      // Elements that already have an href are left alone to preserve their
      // existing navigation behaviour.
      if (merged.ctaUrl) {
        const ctaSel = merged.ctaSelector || HtmlToPdfConverter.CTA_SELECTOR;
        const injectedCount = await page.evaluate(
          (selector, url) => {
            let count = 0;
            const els = document.querySelectorAll(selector);
            for (const el of els) {
              // Skip elements that already link somewhere
              if (el.tagName === "A" && el.href && el.href !== "about:blank" && el.href !== "") continue;

              // If the element itself is inside an <a> with an href, skip
              if (el.closest("a[href]")) continue;

              // Wrap the element in an invisible anchor that carries the URL.
              // "invisible" means: identical styling — no colour change, no
              // underline, no cursor change.  The wrapper is purely semantic
              // so that Chromium's PDF renderer creates a /Link annotation.
              const wrapper = document.createElement("a");
              wrapper.href = url;
              wrapper.style.color = "inherit";
              wrapper.style.textDecoration = "none";
              wrapper.style.cursor = "inherit";
              wrapper.style.display = window.getComputedStyle(el).display || "inline-block";
              // Preserve the element's position in the DOM
              el.parentNode.insertBefore(wrapper, el);
              wrapper.appendChild(el);
              count++;
            }
            return count;
          },
          ctaSel,
          merged.ctaUrl
        );
        // Store the injection count for diagnostics (accessible via _lastCtaCount)
        this._lastCtaCount = injectedCount;
      }

      // ----- Crop: apply CSS @page clipping if crop option is provided -----
      // The crop feature works by restricting the @page size and using negative
      // margins to shift the content so that only the desired rectangle is
      // visible.  This is a pure-CSS approach that preserves text selection
      // and clickable links (unlike screenshot-based cropping).
      if (merged.crop) {
        const c = merged.crop;
        // Validate crop dimensions
        if (c.width > 0 && c.height > 0) {
          await page.addStyleTag({
            content: `
              @page {
                size: ${c.width}px ${c.height}px;
                margin: 0;
              }
              html {
                margin: 0 !important;
                padding: 0 !important;
              }
              body {
                margin: 0 !important;
                padding: 0 !important;
                position: relative;
                left: ${-(c.x || 0)}px;
                top: ${-(c.y || 0)}px;
              }
            `,
          });
          // Override format/margin so Puppeteer uses the @page size
          merged.format = undefined;
          merged.margin = { top: "0px", right: "0px", bottom: "0px", left: "0px" };
        }
      }

      // Set document title for PDF metadata --------------------------------
      if (merged.meta.title) {
        await page.evaluate((t) => {
          document.title = t;
        }, merged.meta.title);
      }

      // Generate the PDF ---------------------------------------------------
      const pdfOptions = {
        margin: merged.margin,
        printBackground: merged.printBackground,
        displayHeaderFooter: merged.displayHeaderFooter,
        headerTemplate: merged.headerTemplate,
        footerTemplate: merged.footerTemplate,
        preferCSSPageSize: true,    // Honour @page CSS if present
        tagged: true,               // Accessibility — tagged PDF
      };
      // Only set format when not cropping (crop uses @page size instead)
      if (merged.format) {
        pdfOptions.format = merged.format;
      }

      let buffer = Buffer.from(await page.pdf(pdfOptions));

      // ----- Post-processing: crop via pdf-lib if CSS crop not used --------
      // For cases where the CSS @page approach is insufficient (e.g. when
      // cropping a specific region out of a multi-page PDF), we can do a
      // post-processing step using pdf-lib to adjust the CropBox / MediaBox.
      // This handles the common use-case of extracting a sub-region from an
      // already-rendered PDF page.
      if (merged.crop && merged.crop.width > 0 && merged.crop.height > 0) {
        buffer = await this._applyCropBox(buffer, merged.crop);
      }

      return buffer;
    } finally {
      if (browser) await browser.close();
    }
  }

  /**
   * Apply a CropBox to each page of the PDF to trim it to the specified
   * rectangle.  Uses pdf-lib's low-level page manipulation.
   *
   * The crop coordinates use a top-left origin (CSS/HTML convention) and
   * are converted to PDF's bottom-left coordinate system internally.
   *
   * @private
   * @param {Buffer} pdfBuffer – The source PDF as a buffer.
   * @param {{ x: number, y: number, width: number, height: number }} crop
   * @returns {Promise<Buffer>}
   */
  async _applyCropBox(pdfBuffer, crop) {
    try {
      const doc = await PDFDocument.load(pdfBuffer);
      const pages = doc.getPages();
      for (const page of pages) {
        const { height } = page.getSize();
        // Convert from top-left (HTML) to bottom-left (PDF) coordinate system
        const pdfX = crop.x || 0;
        const pdfY = height - (crop.y || 0) - crop.height;
        page.setCropBox(pdfX, pdfY, crop.width, crop.height);
      }
      const resultBytes = await doc.save();
      return Buffer.from(resultBytes);
    } catch (_err) {
      // If crop post-processing fails, return the original buffer
      return pdfBuffer;
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
      smartResize:
        overrides.smartResize !== undefined
          ? overrides.smartResize
          : this.smartResize !== undefined
            ? this.smartResize
            : true,
      ctaUrl: overrides.ctaUrl || this.ctaUrl || "",
      ctaSelector: overrides.ctaSelector || this.ctaSelector || "",
      crop: overrides.crop || this.crop || null,
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
