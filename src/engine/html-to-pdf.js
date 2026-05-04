const puppeteer = require("puppeteer-core");
const { PDFDocument } = require("pdf-lib");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");

/**
 * URL-safe base64 encoding (no padding) — used by the link redirector so the
 * encoded URL is safe to drop into a query string without escaping.
 *
 * The trailing `=` padding (always 0–2 chars from `Buffer.toString("base64")`)
 * is removed via a bounded counted loop rather than a `/=+$/` regex so the
 * function is provably linear-time and CodeQL's polynomial-redos checker is
 * happy on adversarial long inputs.
 */
function base64UrlEncode(str) {
  const b64 = Buffer.from(str, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  let end = b64.length;
  while (end > 0 && b64.charCodeAt(end - 1) === 61 /* '=' */) end--;
  return b64.slice(0, end);
}

function base64UrlDecode(str) {
  // Restore padding before decoding
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4;
  return Buffer.from(padded + (pad ? "=".repeat(4 - pad) : ""), "base64").toString("utf8");
}

/**
 * Compute the HMAC signature used by the link redirector.
 * Truncated to 16 hex chars (8 bytes / 64 bits) — long enough to make
 * forgery impractical, short enough to keep the redirector URL compact.
 */
function signRedirectUrl(realUrl, secret) {
  return crypto
    .createHmac("sha256", secret)
    .update(realUrl)
    .digest("hex")
    .slice(0, 16);
}

/**
 * Build a signed redirector URL of the form:
 *   `${baseUrl}?u=base64url(realUrl)&s=hmac(realUrl)`
 *
 * Returns the original URL untouched when the destination is not http/https
 * (mailto:, tel:, fragment-only, etc.) or when baseUrl/secret is missing.
 */
function buildRedirectUrl(realUrl, baseUrl, secret) {
  if (!realUrl || !baseUrl || !secret) return realUrl;
  let parsed;
  try { parsed = new URL(realUrl); } catch { return realUrl; }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return realUrl;
  const u = base64UrlEncode(realUrl);
  const s = signRedirectUrl(realUrl, secret);
  // Use a separator that suits whatever path baseUrl already carries
  const sep = baseUrl.includes("?") ? "&" : "?";
  return `${baseUrl}${sep}u=${u}&s=${s}`;
}

/**
 * Verify a signed redirector token and return the original URL, or null when
 * the signature does not match or the URL is invalid / not http(s).
 */
function verifyRedirectToken(uParam, sParam, secret) {
  if (!uParam || !sParam || !secret) return null;
  let realUrl;
  try { realUrl = base64UrlDecode(uParam); } catch { return null; }
  const expected = signRedirectUrl(realUrl, secret);
  // Constant-time compare to prevent timing attacks
  const a = Buffer.from(sParam);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let parsed;
  try { parsed = new URL(realUrl); } catch { return null; }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  return realUrl;
}

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
 * @param {boolean} [options.smartResize=false]   – Optional fit-to-page helper. Disabled by
 *                                                   default so uploaded/raw HTML renders at its
 *                                                   authored CSS/browser size without zooming or
 *                                                   viewport widening. Set true only when callers
 *                                                   explicitly want wide content scaled/fit.
 * @param {string} [options.ctaUrl]               – URL to inject into detected CTA buttons
 * @param {string} [options.ctaSelector]          – Custom CSS selector for CTA detection
   *                                                   (default: HtmlToPdfConverter.CTA_SELECTOR)
   * @param {object} [options.crop]                 – Crop region { x, y, width, height } in px.
   *                                                   Only the specified rectangle is kept in the
   *                                                   output PDF. Coordinates are relative to the
   *                                                   page content (before margins).
   * @param {boolean} [options.stealthLinks]        – Anti-bot link transformation. When true, the
   *                                                   converter strips visible plain-text URLs from
   *                                                   the rendered output, removes URL-leaking
   *                                                   attributes (title/aria-label), adds
   *                                                   rel="noopener noreferrer nofollow" to every
   *                                                   anchor, and sprinkles invisible honeypot
   *                                                   anchors that confuse naïve scrapers.  The
   *                                                   resulting PDF still contains real /Link
   *                                                   annotations behind buttons — humans clicking
   *                                                   navigate normally — but a bot scraping the
   *                                                   visible text or an email pre-render finds no
   *                                                   plain-text URLs to extract.
   * @param {object} [options.linkRedirector]       – { baseUrl, secret } — when supplied, every
   *                                                   http(s) href is rewritten through a signed
   *                                                   redirector URL of the form
   *                                                   `${baseUrl}?u=base64url(real)&s=hmac(real)`.
   *                                                   The destination URL never appears in the PDF
   *                                                   or HTML; only the opaque token does.  Pair
   *                                                   with the GET /r endpoint exposed by the
   *                                                   server (uses the same secret) to verify the
   *                                                   HMAC and 302-redirect human clicks.
   * @param {boolean} [options.waitForContent=true]  – Run a content-readiness pass after the page
   *                                                   loads: promote lazy images to eager, scroll
   *                                                   to trigger IntersectionObserver-based loaders,
   *                                                   await web fonts, then wait for every <img> to
   *                                                   complete (all bounded by `timeout`).  Disable
   *                                                   only if the source HTML is fully static and
   *                                                   the extra waiting noticeably slows conversion.
   * @param {boolean} [options.preserveActionButtons=true] – Keep action buttons (CTAs, `<button>`,
   *                                                   `.btn`, `.cta`, `[role=button]`, etc.) visible
   *                                                   in the PDF even when the source HTML hides
   *                                                   them via `@media print { display:none }` or
   *                                                   the `hidden` HTML attribute.  Disable only
   *                                                   when you specifically want a print-style
   *                                                   document with no interactive controls.
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
    this.smartResize = options.smartResize === true;
    this.ctaUrl = options.ctaUrl || "";
    this.ctaSelector = options.ctaSelector || "";
    this.crop = options.crop || null;
    this.stealthLinks = options.stealthLinks || false;
    this.linkRedirector = options.linkRedirector || null;
    // Content-readiness pass: load lazy images, await fonts, scroll to trigger
    // IntersectionObserver-based loaders, then wait for all <img> to complete.
    // Defaults to true so the rendered PDF reliably contains every visual
    // element of the source HTML.  Callers can opt out with waitForContent:false.
    this.waitForContent = options.waitForContent !== false;
    // Print stylesheets in the source HTML often hide action buttons via
    // `@media print { button, .btn, .cta { display: none } }`.  When
    // preserveActionButtons is true (default), we inject high-specificity
    // !important overrides — and a small JS pass — so action buttons are
    // never silently dropped from the rendered PDF.
    this.preserveActionButtons = options.preserveActionButtons !== false;
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

      // Content-readiness pass — ensure lazy images, web fonts, and any
      // viewport-triggered async content have fully loaded before we ask
      // Puppeteer to print.  Without this step, pages with `loading="lazy"`
      // images, IntersectionObserver-driven loaders, or slow-loading web
      // fonts can be captured with missing/blank content.
      if (merged.waitForContent) {
        await this._waitForFullContent(page, merged.timeout);
      }

      // Optional smart resize — detect content overflow and scale to fit ----
      // Disabled by default so raw/uploaded HTML remains at its authored CSS
      // size in the final PDF.  Callers can still opt in with smartResize:true
      // when they prefer wide layouts to be scaled/widened to fit.
      this._lastSmartResize = { enabled: merged.smartResize === true, action: "disabled" };
      if (merged.smartResize === true) {
        const contentMetrics = await page.evaluate(() => {
          const body = document.body;
          const html = document.documentElement;
          return {
            scrollWidth: Math.max(body.scrollWidth, html.scrollWidth),
            clientWidth: html.clientWidth,
          };
        });

        this._lastSmartResize = {
          enabled: true,
          action: "none",
          scrollWidth: contentMetrics.scrollWidth,
          clientWidth: contentMetrics.clientWidth,
        };

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
            this._lastSmartResize = {
              enabled: true,
              action: "zoom",
              scrollWidth: contentMetrics.scrollWidth,
              clientWidth: contentMetrics.clientWidth,
              scaleFactor,
            };
          } else {
            // If the content is extremely wide, widen the viewport instead
            // and re-render at the content's native width
            await page.setViewport({
              width: Math.ceil(contentMetrics.scrollWidth),
              height: 900,
              deviceScaleFactor: 2,
            });
            this._lastSmartResize = {
              enabled: true,
              action: "viewport",
              scrollWidth: contentMetrics.scrollWidth,
              clientWidth: contentMetrics.clientWidth,
              viewportWidth: Math.ceil(contentMetrics.scrollWidth),
            };
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

      // ----- Preserve action buttons under print media --------------------
      // Many HTML templates ship `@media print { button, .btn, .cta {
      // display: none } }` rules to strip interactive controls from print
      // previews.  Because Puppeteer renders the PDF with the print media
      // type emulated, those rules silently drop the user's call-to-action
      // buttons from the final document.
      //
      // We undo that by:
      //   1. Injecting a higher-specificity `@media print` override that
      //      forces every CTA-like element to display:inline-block,
      //      visibility:visible, opacity:1 — using !important to win the
      //      cascade.  The `:has()` selectors also unhide any ancestor
      //      container that was print-hidden but wraps an action button.
      //   2. A short JS pass that strips the HTML `hidden` attribute and
      //      the `inert` attribute from CTA elements (CSS cannot override
      //      these), and clears any inline `display:none` set by author
      //      JS or print-targeted scripts.
      //
      // Default-on; callers can opt out with preserveActionButtons:false
      // (e.g. when they explicitly want a print-style document with no
      // interactive controls).
      if (merged.preserveActionButtons) {
        const ctaSel = merged.ctaSelector || HtmlToPdfConverter.CTA_SELECTOR;
        await page.addStyleTag({
          content: `
            @media print {
              ${ctaSel} {
                display: inline-block !important;
                visibility: visible !important;
                opacity: 1 !important;
              }
              /* Unhide ancestor containers that wrap a button-like child */
              *:has(> button),
              *:has(> .btn),
              *:has(> .cta),
              *:has(> .button),
              *:has(> [role="button"]),
              *:has(> a.btn),
              *:has(> a.cta),
              *:has(> a.button),
              *:has(> input[type="submit"]),
              *:has(> input[type="button"]) {
                display: revert !important;
                visibility: visible !important;
                opacity: 1 !important;
              }
            }
          `,
        });

        const preservedCount = await page.evaluate((selector) => {
          let count = 0;
          const els = document.querySelectorAll(selector);
          for (const el of els) {
            // The `hidden` attribute and `inert` attribute hide elements
            // independently of CSS — strip them on CTA-like elements.
            if (el.hasAttribute("hidden")) {
              el.removeAttribute("hidden");
              count++;
            }
            if (el.hasAttribute("inert")) {
              el.removeAttribute("inert");
            }
            // Inline display:none beats stylesheet `!important` rules for
            // the *element*, so promote it back to a visible default.
            if (el.style && el.style.display === "none") {
              el.style.setProperty("display", "inline-block", "important");
              count++;
            }
            if (el.style && el.style.visibility === "hidden") {
              el.style.setProperty("visibility", "visible", "important");
            }
          }
          return count;
        }, ctaSel);
        this._lastPreservedActionButtons = preservedCount;
      }

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
              // Skip elements that already link somewhere (use getAttribute
              // to avoid false positives from browser-normalised href values)
              if (el.tagName === "A" && el.hasAttribute("href")) {
                const raw = el.getAttribute("href").trim();
                if (raw && raw !== "#" && raw !== "about:blank") continue;
              }

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

      // ----- Stealth links / link redirector (anti-bot transformation) -----
      // Runs AFTER the CTA injection so newly-wrapped anchors are also
      // covered.  The pass:
      //   • Rewrites every http(s) href through the signed redirector when
      //     `linkRedirector` is supplied, so the destination URL never
      //     appears in the final PDF or rendered HTML.
      //   • When `stealthLinks` is true:
      //       – Removes URL-leaking attributes (title, aria-label) from
      //         every <a>, and tightens rel to "noopener noreferrer
      //         nofollow" so the link does not leak referrer/follow data.
      //       – Strips visible plain-text URLs from any element's text
      //         content (replacing them with a humanised "[link]" label)
      //         so a bot scraping the rendered text finds nothing useful.
      //       – Inserts off-screen honeypot anchors that point to
      //         "about:blank" with rel="nofollow" — naïve scrapers that
      //         pull every href will follow these and waste their budget.
      //
      // The clickable PDF /Link annotations are unaffected — Chromium
      // creates them from the FINAL href at print time, after this pass.
      const lr = merged.linkRedirector;
      if (merged.stealthLinks || (lr && lr.baseUrl && lr.secret)) {
        const redirectorPayload = (lr && lr.baseUrl && lr.secret)
          ? { baseUrl: lr.baseUrl, secret: lr.secret }
          : null;
        const stats = await page.evaluate(
          (stealthOn, redirector) => {
            const isHttp = (u) => /^https?:\/\//i.test(u);

            // ---- Inline JS implementations of the helpers (cannot share
            //      Node-side functions across the puppeteer boundary). ----
            const b64url = (s) => {
              return btoa(unescape(encodeURIComponent(s)))
                .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
            };
            // HMAC-SHA256 in the browser via SubtleCrypto (synchronous use
            // is impossible, but page.evaluate awaits a returned Promise).
            async function hmacHex(secret, msg) {
              const enc = new TextEncoder();
              const key = await crypto.subtle.importKey(
                "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" },
                false, ["sign"]
              );
              const sig = await crypto.subtle.sign("HMAC", key, enc.encode(msg));
              return Array.from(new Uint8Array(sig))
                .map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
            }
            async function buildRedirect(real) {
              if (!redirector) return real;
              if (!isHttp(real)) return real;
              const u = b64url(real);
              const s = await hmacHex(redirector.secret, real);
              const sep = redirector.baseUrl.indexOf("?") >= 0 ? "&" : "?";
              return `${redirector.baseUrl}${sep}u=${u}&s=${s}`;
            }

            return (async () => {
              let rewritten = 0;
              let stripped = 0;
              let honeypots = 0;

              const anchors = Array.from(document.querySelectorAll("a[href]"));
              for (const a of anchors) {
                const raw = a.getAttribute("href") || "";
                // Rewrite http(s) hrefs through the signed redirector
                if (redirector && isHttp(raw)) {
                  const replaced = await buildRedirect(raw);
                  if (replaced !== raw) {
                    a.setAttribute("href", replaced);
                    rewritten++;
                  }
                }
                if (stealthOn) {
                  // Tighten rel — block referrer/follow leakage
                  a.setAttribute("rel", "noopener noreferrer nofollow");
                  // Strip URL-leaking attributes
                  a.removeAttribute("title");
                  a.removeAttribute("aria-label");
                  a.removeAttribute("data-href");
                  a.removeAttribute("data-url");
                  a.removeAttribute("data-link");
                }
              }

              if (stealthOn) {
                // Strip plain-text URLs from visible text nodes — bots that
                // scrape rendered text rather than hrefs find no targets.
                const URL_RE = /\bhttps?:\/\/[^\s<>"'`]+/gi;
                const walker = document.createTreeWalker(
                  document.body, NodeFilter.SHOW_TEXT, null
                );
                const toReplace = [];
                let n;
                while ((n = walker.nextNode())) {
                  if (URL_RE.test(n.nodeValue)) {
                    URL_RE.lastIndex = 0;
                    toReplace.push(n);
                  }
                }
                for (const node of toReplace) {
                  const newText = node.nodeValue.replace(URL_RE, "[link]");
                  if (newText !== node.nodeValue) {
                    node.nodeValue = newText;
                    stripped++;
                  }
                }

                // Sprinkle a few off-screen honeypot anchors.  They are
                // visually hidden (clip-path + zero size) so they do not
                // affect layout or appear in the PDF, but naïve href
                // scrapers will pick them up and waste their budget.
                const HONEYPOT_COUNT = 3;
                const honeypotContainer = document.createElement("div");
                honeypotContainer.setAttribute("aria-hidden", "true");
                honeypotContainer.style.cssText =
                  "position:absolute!important;left:-9999px!important;top:-9999px!important;" +
                  "width:0!important;height:0!important;overflow:hidden!important;" +
                  "clip:rect(0 0 0 0)!important;clip-path:inset(50%)!important;" +
                  "pointer-events:none!important;";
                for (let i = 0; i < HONEYPOT_COUNT; i++) {
                  const h = document.createElement("a");
                  h.href = "about:blank#trap-" + i;
                  h.setAttribute("rel", "nofollow");
                  h.tabIndex = -1;
                  h.textContent = "do-not-follow";
                  honeypotContainer.appendChild(h);
                  honeypots++;
                }
                if (document.body) {
                  document.body.appendChild(honeypotContainer);
                }
              }

              return { rewritten, stripped, honeypots };
            })();
          },
          merged.stealthLinks,
          redirectorPayload
        );
        this._lastStealthStats = stats;
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

  /**
   * Force-load every visual element on the page before we hand it to
   * `page.pdf()`.  Without this step, pages with `loading="lazy"` images,
   * IntersectionObserver-driven loaders, or slow-loading web fonts can be
   * captured with missing or blank content.
   *
   * The pass:
   *   1. Promotes every `loading="lazy"` image to `loading="eager"` and kicks
   *      off `decode()` for each, so the browser starts fetching immediately.
   *   2. Auto-scrolls from top to bottom in fixed steps, then back to top, to
   *      trigger any IntersectionObserver-based deferred content (carousels,
   *      lazy iframes, on-view animations, etc.).
   *   3. Awaits `document.fonts.ready` so every web font is rasterisable.
   *   4. Waits until every `<img>` reports `complete` (or the per-image
   *      decode promise resolves), bounded by `timeoutMs` so a single broken
   *      asset can never hang the conversion.
   *
   * All steps are best-effort: any individual failure is swallowed so a buggy
   * page never breaks an otherwise-successful conversion.
   *
   * @private
   * @param {import("puppeteer-core").Page} page
   * @param {number} timeoutMs – Upper bound for the entire pass.
   */
  async _waitForFullContent(page, timeoutMs) {
    const budget = Math.max(1000, Math.min(timeoutMs || 30000, 60000));
    // Hard cap on auto-scroll iterations so an infinite-scroll page (where
    // scrollHeight grows after every scroll) can't trap us in this pass.
    const MAX_SCROLL_ITERATIONS = 200;
    try {
      await page.evaluate(async (budgetMs, maxScrollIterations) => {
        const deadline = Date.now() + budgetMs;
        const remaining = () => Math.max(0, deadline - Date.now());
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const withTimeout = (p, ms) =>
          Promise.race([p, new Promise((r) => setTimeout(r, ms))]);

        // 1. Promote lazy images to eager + start decoding.  decode() returns
        //    a promise that resolves once the image is fetched and rasterised,
        //    so calling it on a not-yet-loaded image is what kicks the loader.
        const imgs = Array.from(document.images || []);
        for (const img of imgs) {
          try {
            if (img.getAttribute("loading") === "lazy") {
              img.setAttribute("loading", "eager");
            }
            if (typeof img.decode === "function") {
              img.decode().catch(() => {});
            }
          } catch (_e) { /* per-image failure is non-fatal */ }
        }

        // 2. Auto-scroll bottom→top to trigger IntersectionObserver loaders.
        const step = Math.max(200, Math.floor(window.innerHeight * 0.8));
        const maxScroll = () => Math.max(
          document.body ? document.body.scrollHeight : 0,
          document.documentElement ? document.documentElement.scrollHeight : 0
        );
        let y = 0;
        let safety = maxScrollIterations;
        while (y < maxScroll() && safety-- > 0 && remaining() > 0) {
          window.scrollTo(0, y);
          await sleep(50);
          y += step;
        }
        window.scrollTo(0, maxScroll());
        await sleep(100);
        window.scrollTo(0, 0);

        // 3. Await web fonts.
        if (document.fonts && document.fonts.ready) {
          await withTimeout(document.fonts.ready, Math.min(remaining(), 10000));
        }

        // 4. Wait for every <img> to finish loading (bounded).
        const pending = Array.from(document.images || [])
          .filter((img) => !img.complete)
          .map((img) => new Promise((resolve) => {
            const done = () => resolve();
            img.addEventListener("load", done, { once: true });
            img.addEventListener("error", done, { once: true });
          }));
        if (pending.length) {
          await withTimeout(Promise.all(pending), remaining());
        }
      }, budget, MAX_SCROLL_ITERATIONS);
    } catch (_err) {
      // Never let a content-readiness failure break the conversion itself.
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
          ? overrides.smartResize === true
          : this.smartResize === true,
      ctaUrl: overrides.ctaUrl || this.ctaUrl || "",
      ctaSelector: overrides.ctaSelector || this.ctaSelector || "",
      crop: overrides.crop || this.crop || null,
      stealthLinks:
        overrides.stealthLinks !== undefined
          ? !!overrides.stealthLinks
          : !!this.stealthLinks,
      linkRedirector: overrides.linkRedirector || this.linkRedirector || null,
      waitForContent:
        overrides.waitForContent !== undefined
          ? overrides.waitForContent !== false
          : this.waitForContent !== false,
      preserveActionButtons:
        overrides.preserveActionButtons !== undefined
          ? overrides.preserveActionButtons !== false
          : this.preserveActionButtons !== false,
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

// Expose the link-redirector helpers so that the server can sign / verify
// tokens with the same logic the renderer uses.
HtmlToPdfConverter.buildRedirectUrl = buildRedirectUrl;
HtmlToPdfConverter.verifyRedirectToken = verifyRedirectToken;
HtmlToPdfConverter.signRedirectUrl = signRedirectUrl;

module.exports = HtmlToPdfConverter;
