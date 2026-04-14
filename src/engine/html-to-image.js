const puppeteer = require("puppeteer-core");
const { PDFDocument, PDFName, PDFString } = require("pdf-lib");
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

/**
 * Detect a usable Chrome / Chromium executable.
 * (Same logic as html-to-pdf.js — shared for consistency.)
 */
function detectChromePath() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  const candidates = [
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/snap/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
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
 * HtmlToImageConverter — Convert HTML to a high-quality screenshot image
 * with interactive hotspot map for preserving button/link interactivity.
 *
 * Uses headless Chromium (via Puppeteer) to:
 *   1. Render the HTML at high resolution
 *   2. Take a full-page or viewport screenshot as PNG
 *   3. Scan the DOM for interactive elements (buttons, links)
 *   4. Return the image buffer + a hotspot map of clickable regions
 *
 * The hotspot map contains bounding boxes for each interactive element,
 * enabling downstream consumers (like PdfOverlayEngine) to overlay
 * invisible clickable link annotations at the correct positions.
 */
class HtmlToImageConverter {
  /**
   * Default selector for interactive elements to include in the hotspot map.
   */
  static INTERACTIVE_SELECTOR = [
    'a[href]',
    'button',
    '[role="button"]',
    'input[type="submit"]', 'input[type="button"]',
    '.btn', '.cta', '.button',
    'a[class*="btn"]', 'a[class*="cta"]', 'a[class*="button"]',
    'a[class*="Btn"]', 'a[class*="Cta"]', 'a[class*="Button"]',
  ].join(', ');

  /**
   * @param {object} [options]
   * @param {number} [options.width=1280]          – Viewport width in pixels
   * @param {number} [options.height=900]          – Viewport height in pixels
   * @param {number} [options.deviceScaleFactor=2] – Device pixel ratio (2 = Retina)
   * @param {boolean} [options.fullPage=true]       – Capture the full scrollable page
   * @param {string} [options.format="png"]         – Image format: "png" or "jpeg"
   * @param {number} [options.quality=90]           – JPEG quality (1-100), ignored for PNG
   * @param {number} [options.timeout=120000]       – Navigation timeout (ms)
   * @param {string} [options.waitUntil="networkidle2"] – Puppeteer waitUntil event
   */
  constructor(options = {}) {
    this.width = options.width || 1280;
    this.height = options.height || 900;
    this.deviceScaleFactor = options.deviceScaleFactor || 2;
    this.fullPage = options.fullPage !== false;
    this.format = options.format || "png";
    this.quality = options.quality || 90;
    this.timeout = options.timeout || 120000;
    this.waitUntil = options.waitUntil || "networkidle2";
  }

  /* ------------------------------------------------------------------ */
  /*  Public API                                                        */
  /* ------------------------------------------------------------------ */

  /**
   * Convert an HTML string to an image.
   *
   * @param {string} html – Full HTML document string.
   * @param {object} [opts] – Per-call overrides.
   * @returns {Promise<{ image: Buffer, hotspots: Array, width: number, height: number }>}
   *   - image: The screenshot as a Buffer (PNG or JPEG)
   *   - hotspots: Array of { x, y, width, height, href, text } for each interactive element
   *   - width: Image width in CSS pixels (before deviceScaleFactor)
   *   - height: Image height in CSS pixels
   */
  async convertHtmlToImage(html, opts = {}) {
    return this._convert({ type: "html", source: html }, opts);
  }

  /**
   * Convert a live URL to an image.
   *
   * @param {string} url – The URL to navigate to and screenshot.
   * @param {object} [opts] – Per-call overrides.
   * @returns {Promise<{ image: Buffer, hotspots: Array, width: number, height: number }>}
   */
  async convertUrlToImage(url, opts = {}) {
    return this._convert({ type: "url", source: url }, opts);
  }

  /**
   * Convert HTML to image and write to a file.
   * @param {string} html
   * @param {string} filePath
   * @param {object} [opts]
   * @returns {Promise<{ path: string, hotspots: Array, width: number, height: number }>}
   */
  async convertHtmlToFile(html, filePath, opts = {}) {
    const result = await this.convertHtmlToImage(html, opts);
    const abs = path.resolve(filePath);
    const dir = path.dirname(abs);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(abs, result.image);
    return { path: abs, hotspots: result.hotspots, width: result.width, height: result.height };
  }

  /* ------------------------------------------------------------------ */
  /*  Internal                                                          */
  /* ------------------------------------------------------------------ */

  /** Core conversion pipeline. */
  async _convert(input, overrides) {
    const merged = { ...this, ...overrides };
    let browser;
    try {
      const execPath = detectChromePath();
      if (!execPath) {
        throw new Error(
          "Chrome / Chromium not found. puppeteer-core requires a system-installed browser.\n" +
          "  • Docker/Linux: apt-get install -y chromium\n" +
          "  • macOS:        brew install --cask google-chrome\n" +
          "  • Or set PUPPETEER_EXECUTABLE_PATH to the path of your Chrome binary."
        );
      }

      browser = await puppeteer.launch({
        headless: true,
        executablePath: execPath,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--font-render-hinting=none",
        ],
      });

      const page = await browser.newPage();
      await page.setViewport({
        width: merged.width,
        height: merged.height,
        deviceScaleFactor: merged.deviceScaleFactor,
      });

      // Load content
      if (input.type === "url") {
        // Validate URL to prevent SSRF attacks — only allow http/https protocols
        const parsedUrl = new URL(input.source);
        if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
          throw new Error("Invalid URL protocol. Only http and https URLs are allowed.");
        }
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

      // Scan for interactive elements (hotspot map)
      const hotspots = await page.evaluate((selector) => {
        const elements = document.querySelectorAll(selector);
        const results = [];
        for (const el of elements) {
          const rect = el.getBoundingClientRect();
          if (rect.width < 1 || rect.height < 1) continue;

          // Get href — from the element itself or its closest <a> ancestor
          let href = "";
          if (el.tagName === "A" && el.href) {
            href = el.href;
          } else if (el.closest("a[href]")) {
            href = el.closest("a[href]").href;
          }

          // Get visible text
          const text = (el.textContent || el.value || "").trim().slice(0, 100);

          results.push({
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            href: href,
            text: text,
            tagName: el.tagName.toLowerCase(),
          });
        }
        return results;
      }, HtmlToImageConverter.INTERACTIVE_SELECTOR);

      // Get page dimensions
      const dimensions = await page.evaluate(() => ({
        width: Math.max(document.body.scrollWidth, document.documentElement.scrollWidth),
        height: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight),
      }));

      // Take screenshot
      const screenshotOpts = {
        fullPage: merged.fullPage,
        type: merged.format === "jpeg" ? "jpeg" : "png",
      };
      if (merged.format === "jpeg") {
        screenshotOpts.quality = merged.quality;
      }

      const screenshot = await page.screenshot(screenshotOpts);
      const image = Buffer.from(screenshot);

      return {
        image,
        hotspots,
        width: dimensions.width,
        height: dimensions.height,
      };
    } finally {
      if (browser) await browser.close();
    }
  }
}

module.exports = HtmlToImageConverter;
