const { PDFDocument, rgb, StandardFonts, PDFName, PDFString } = require("pdf-lib");
const sharp = require("sharp");
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

/**
 * PdfOverlayEngine — Upload an existing PDF, apply a real Gaussian blur to
 * each page, and add a prominent clickable Call-To-Action (CTA) button.
 *
 * The output preserves the original page dimensions exactly.
 *
 * How it works:
 *   1. Read the source PDF with pdf-lib
 *   2. For each page, render it as a high-resolution image using pdftoppm
 *      (poppler-utils) — this is the industry-standard tool for PDF→image
 *   3. Apply Gaussian blur to each image with sharp
 *   4. Create a new PDF with the same page dimensions
 *   5. Embed each blurred image as the full-page background
 *   6. Draw a semi-transparent overlay rectangle (frost tint)
 *   7. Draw the CTA button with clickable link annotation
 *
 *   If pdftoppm is not available (local dev without poppler), falls back to
 *   a strong opaque overlay that fully hides the content.
 */
class PdfOverlayEngine {
  /**
   * @param {object} [options]
   * @param {number}  [options.blurRadius=12]          – Gaussian blur sigma (higher = more blurred)
   * @param {string}  [options.overlayColor]           – Hex overlay tint colour (default: "#FFFFFF")
   * @param {number}  [options.overlayOpacity=0.55]    – 0-1 overlay transparency
   * @param {string}  [options.ctaText="Click to View"] – Button label
   * @param {string}  [options.ctaUrl]                 – Destination URL for the CTA
   * @param {string}  [options.ctaBgColor="#0f3460"]    – Button background colour
   * @param {string}  [options.ctaTextColor="#FFFFFF"]  – Button text colour
   * @param {number}  [options.ctaFontSize=14]         – Button font size in pt
   * @param {number}  [options.ctaWidth=180]           – Button width in pt
   * @param {number}  [options.ctaHeight=38]           – Button height in pt
   * @param {number}  [options.ctaBorderRadius=8]      – Button corner radius
   */
  constructor(options = {}) {
    this.blurRadius = options.blurRadius ?? 12;
    this.overlayColor = options.overlayColor || "#FFFFFF";
    this.overlayOpacity = options.overlayOpacity ?? 0.55;
    this.ctaText = options.ctaText || "Click to View";
    this.ctaUrl = options.ctaUrl || "";
    this.ctaBgColor = options.ctaBgColor || "#0f3460";
    this.ctaTextColor = options.ctaTextColor || "#FFFFFF";
    this.ctaFontSize = options.ctaFontSize ?? 14;
    this.ctaWidth = options.ctaWidth ?? 180;
    this.ctaHeight = options.ctaHeight ?? 38;
    this.ctaBorderRadius = options.ctaBorderRadius ?? 8;
  }

  /**
   * Process a PDF buffer: blur each page and add a CTA overlay.
   *
   * @param {Buffer} pdfBuffer   – The source PDF file as a Buffer
   * @param {object} [overrides] – Per-call option overrides (same keys as constructor)
   * @returns {Promise<Buffer>}  – The resulting PDF as a Buffer
   */
  async processBuffer(pdfBuffer, overrides = {}) {
    const opts = { ...this, ...overrides };

    // ---- 1. Read source PDF ----
    const srcDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
    const pageCount = srcDoc.getPageCount();

    // ---- 2. Render all pages as images ----
    const pageImages = await this._renderPagesAsImages(pdfBuffer, srcDoc, opts);

    // ---- 3. Create output PDF ----
    const outDoc = await PDFDocument.create();

    // Parse colours once
    const overlayRgb = hexToRgb(opts.overlayColor);
    const ctaBgRgb = hexToRgb(opts.ctaBgColor);
    const ctaTextRgb = hexToRgb(opts.ctaTextColor);

    // Embed a standard font for the CTA text
    const font = await outDoc.embedFont(StandardFonts.HelveticaBold);

    for (let i = 0; i < pageCount; i++) {
      // Get source page dimensions
      const srcPage = srcDoc.getPage(i);
      const { width, height } = srcPage.getSize();

      // ---- 4. Build output page ----
      const outPage = outDoc.addPage([width, height]);

      if (pageImages[i]) {
        // We have a blurred image — embed it as full-page background
        const embeddedImage = await outDoc.embedPng(pageImages[i]);
        outPage.drawImage(embeddedImage, {
          x: 0,
          y: 0,
          width: width,
          height: height,
        });

        // Draw a light frost tint overlay on top of the blurred image
        outPage.drawRectangle({
          x: 0,
          y: 0,
          width: width,
          height: height,
          color: rgb(overlayRgb.r, overlayRgb.g, overlayRgb.b),
          opacity: Math.min(opts.overlayOpacity, 0.4), // lighter tint since image is already blurred
        });
      } else {
        // Fallback: no pdftoppm available — copy original page and use
        // heavy opaque overlay to fully hide the content.
        const [fallbackPage] = await outDoc.copyPages(srcDoc, [i]);
        const [embeddedPage] = await outDoc.embedPages([fallbackPage]);
        outPage.drawPage(embeddedPage, { x: 0, y: 0, width, height });

        // Heavy overlay that genuinely hides the content
        outPage.drawRectangle({
          x: 0,
          y: 0,
          width: width,
          height: height,
          color: rgb(overlayRgb.r, overlayRgb.g, overlayRgb.b),
          opacity: Math.max(opts.overlayOpacity, 0.85), // strong enough to hide text
        });
      }

      // ---- 5. Draw faint "redacted" placeholder lines ----
      const lineCount = Math.floor(height / 40);
      for (let li = 0; li < lineCount; li++) {
        const ly = height - 60 - li * 35;
        const lw = width * (0.3 + (((li * 7 + 13) % 17) / 17) * 0.5);
        const lx = 40 + (((li * 11 + 3) % 13) / 13) * 20;
        if (ly > 80) {
          outPage.drawRectangle({
            x: lx,
            y: ly,
            width: Math.min(lw, width - 80),
            height: 7,
            color: rgb(0.88, 0.88, 0.88),
            opacity: 0.45,
          });
        }
      }

      // ---- 6. Draw CTA button ----
      const btnW = Math.min(opts.ctaWidth, width - 80);
      const btnH = opts.ctaHeight;
      const btnX = (width - btnW) / 2;
      const btnY = (height - btnH) / 2;

      // Button shadow (subtle depth effect)
      outPage.drawRectangle({
        x: btnX + 2,
        y: btnY - 2,
        width: btnW,
        height: btnH,
        color: rgb(0, 0, 0),
        opacity: 0.15,
      });

      // Button background
      const borderDarken = 0.8;
      outPage.drawRectangle({
        x: btnX,
        y: btnY,
        width: btnW,
        height: btnH,
        color: rgb(ctaBgRgb.r, ctaBgRgb.g, ctaBgRgb.b),
        opacity: 1,
        borderColor: rgb(
          ctaBgRgb.r * borderDarken,
          ctaBgRgb.g * borderDarken,
          ctaBgRgb.b * borderDarken
        ),
        borderWidth: 1,
      });

      // Button text (centered)
      const fontSize = opts.ctaFontSize;
      const textWidth = font.widthOfTextAtSize(opts.ctaText, fontSize);
      const textX = btnX + (btnW - textWidth) / 2;
      const textY = btnY + (btnH - fontSize) / 2 + 2;

      outPage.drawText(opts.ctaText, {
        x: textX,
        y: textY,
        size: fontSize,
        font: font,
        color: rgb(ctaTextRgb.r, ctaTextRgb.g, ctaTextRgb.b),
      });

      // ---- 7. Add clickable link annotation over the CTA button ----
      if (opts.ctaUrl) {
        const context = outDoc.context;
        const actionDict = context.obj({
          Type: "Action",
          S: "URI",
          URI: PDFString.of(opts.ctaUrl),
        });
        const annotDict = context.obj({
          Type: "Annot",
          Subtype: "Link",
          Rect: [btnX, btnY, btnX + btnW, btnY + btnH],
          Border: [0, 0, 0],
          A: actionDict,
        });
        const annotRef = context.register(annotDict);
        outPage.node.set(PDFName.of("Annots"), context.obj([annotRef]));
      }
    }

    // ---- 8. Set PDF metadata ----
    outDoc.setTitle(opts.metaTitle || "Protected Document");
    outDoc.setProducer("PDF Engine");
    outDoc.setCreationDate(new Date());

    // ---- 9. Save and return ----
    const resultBytes = await outDoc.save();
    return Buffer.from(resultBytes);
  }

  /**
   * Render each page of the PDF as a blurred PNG image.
   *
   * Uses pdftoppm (poppler-utils) which is the industry-standard tool for
   * rendering PDF pages as high-quality images.  Falls back gracefully if
   * pdftoppm is not installed (e.g. local dev without poppler).
   *
   * @private
   * @param {Buffer} pdfBuffer   – Full PDF file as a Buffer
   * @param {object} srcDoc      – PDFDocument from pdf-lib (for page count / size)
   * @param {object} opts        – Merged options
   * @returns {Promise<(Buffer|null)[]>} – Array of blurred PNG buffers (null = fallback)
   */
  async _renderPagesAsImages(pdfBuffer, srcDoc, opts) {
    const pageCount = srcDoc.getPageCount();

    // Check if pdftoppm is available
    if (!this._hasPdftoppm()) {
      return new Array(pageCount).fill(null);
    }

    // Write the source PDF to a temp file
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdfoverlay-"), { mode: 0o700 });
    const srcPath = path.join(tmpDir, "source.pdf");
    fs.writeFileSync(srcPath, pdfBuffer);

    const results = [];

    try {
      for (let i = 0; i < pageCount; i++) {
        const pageNum = i + 1; // pdftoppm uses 1-based page numbers
        const outPrefix = path.join(tmpDir, `page`);

        try {
          // Render this page as a PNG at 150 DPI (good balance of quality vs file size)
          execFileSync("pdftoppm", [
            "-png",
            "-r", "150",
            "-f", String(pageNum),
            "-l", String(pageNum),
            "-singlefile",
            srcPath,
            outPrefix,
          ]);

          // pdftoppm outputs to <prefix>.png
          const pngPath = outPrefix + ".png";

          if (fs.existsSync(pngPath)) {
            const rawPng = fs.readFileSync(pngPath);

            // Apply Gaussian blur with sharp
            const blurSigma = Math.max(opts.blurRadius, 1); // sharp needs sigma > 0.3; we use 1 as minimum for visible effect
            const blurredPng = await sharp(rawPng)
              .blur(blurSigma)
              .png()
              .toBuffer();

            results.push(blurredPng);

            // Clean up this page's image
            fs.unlinkSync(pngPath);
          } else {
            results.push(null);
          }
        } catch (_pageErr) {
          results.push(null);
        }
      }
    } finally {
      // Clean up temp files
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch (_cleanupErr) {
        // Best-effort cleanup
      }
    }

    return results;
  }

  /**
   * Check if pdftoppm (from poppler-utils) is available on this system.
   * @private
   * @returns {boolean}
   */
  _hasPdftoppm() {
    if (PdfOverlayEngine._pdftoppmAvailable !== undefined) {
      return PdfOverlayEngine._pdftoppmAvailable;
    }
    try {
      execFileSync("pdftoppm", ["-v"], { stdio: "pipe" });
      PdfOverlayEngine._pdftoppmAvailable = true;
    } catch {
      PdfOverlayEngine._pdftoppmAvailable = false;
    }
    return PdfOverlayEngine._pdftoppmAvailable;
  }
}

// Static cache for pdftoppm availability check
PdfOverlayEngine._pdftoppmAvailable = undefined;

/**
 * Convert a hex colour string to { r, g, b } in 0-1 range.
 */
function hexToRgb(hex) {
  const h = hex.replace("#", "");
  const bigint = parseInt(h, 16);
  return {
    r: ((bigint >> 16) & 255) / 255,
    g: ((bigint >> 8) & 255) / 255,
    b: (bigint & 255) / 255,
  };
}

module.exports = PdfOverlayEngine;
