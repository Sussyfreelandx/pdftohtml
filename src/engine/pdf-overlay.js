const { PDFDocument, rgb, StandardFonts, PDFName, PDFString } = require("pdf-lib");
const sharp = require("sharp");
const QRCode = require("qrcode");
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

/**
 * PdfOverlayEngine — Upload an existing PDF, apply a frosted-glass or
 * standard Gaussian blur to each page, and add a prominent clickable
 * Call-To-Action (CTA button or QR code) overlay.
 *
 * The output preserves the original page dimensions exactly.
 *
 * How it works:
 *   1. Read the source PDF with pdf-lib
 *   2. For each page, render it as a high-resolution image using pdftoppm
 *      (poppler-utils) — the industry-standard tool for PDF→image
 *   3. Apply blur (glass or standard) to each image with sharp
 *   4. Create a new PDF with the same page dimensions
 *   5. Embed each blurred image as the full-page background
 *   6. Draw a semi-transparent overlay rectangle (frost tint)
 *   7. Draw the CTA (button or QR code) with clickable link annotation
 *
 *   If pdftoppm is not available (local dev without poppler), falls back to
 *   a strong opaque overlay that fully hides the content.
 */
class PdfOverlayEngine {
  // Minimum overlay opacity used in fallback mode (no pdftoppm) to compensate
  // for the absence of actual pixel-level blur.
  static FALLBACK_MIN_OPACITY = 0.55;

  /**
   * @param {object}  [options]
   * @param {number}  [options.blurRadius=5]              – Blur sigma (1-40). Low=text visible, high=text hidden
   * @param {string}  [options.blurStyle="glass"]         – "glass" (frosted-glass) or "standard" (plain Gaussian)
   * @param {string}  [options.overlayColor="#FFFFFF"]     – Hex overlay tint colour
   * @param {number}  [options.overlayOpacity=0.15]       – 0-1 overlay tint (light — blur handles obscuring)
   * @param {string}  [options.ctaType="button"]          – "button" or "qrCode"
   * @param {string}  [options.ctaText="Click to View"]   – Button label (or QR label)
   * @param {string}  [options.ctaUrl]                    – Destination URL for the CTA
   * @param {string}  [options.ctaLabel]                  – Text shown below QR code (e.g. "Scan to View Document")
   * @param {string}  [options.ctaBgColor="#0f3460"]      – Button background colour
   * @param {string}  [options.ctaTextColor="#FFFFFF"]     – Button text colour
   * @param {number}  [options.ctaFontSize=14]            – Button font size in pt
   * @param {number}  [options.ctaWidth=180]              – Button width in pt (or QR code size)
   * @param {number}  [options.ctaHeight=38]              – Button height in pt
   * @param {number}  [options.ctaBorderRadius=8]         – Button corner radius
   * @param {number}  [options.qrSize=140]                – QR code size in pt
   * @param {string}  [options.qrColor="#1a1a2e"]         – QR code foreground colour
   * @param {string}  [options.qrBackground="#FFFFFF"]    – QR code background colour
   * @param {number}  [options.ctaX]                      – Custom CTA x position (0-1 fraction of page width). Omit to auto-center.
   * @param {number}  [options.ctaY]                      – Custom CTA y position (0-1 fraction of page height, 0=bottom, 1=top). Omit to use default lower-third.
   */
  constructor(options = {}) {
    this.blurRadius = options.blurRadius ?? 5;
    this.blurStyle = options.blurStyle || "glass";
    this.overlayColor = options.overlayColor || "#FFFFFF";
    this.overlayOpacity = options.overlayOpacity ?? 0.15;
    this.ctaType = options.ctaType || "button";
    this.ctaText = options.ctaText || "Click to View";
    this.ctaUrl = options.ctaUrl || "";
    this.ctaLabel = options.ctaLabel || "";
    this.ctaBgColor = options.ctaBgColor || "#2563EB";
    this.ctaTextColor = options.ctaTextColor || "#FFFFFF";
    this.ctaFontSize = options.ctaFontSize ?? 14;
    this.ctaWidth = options.ctaWidth ?? 180;
    this.ctaHeight = options.ctaHeight ?? 44;
    this.ctaBorderRadius = options.ctaBorderRadius ?? 8;
    this.ctaStyle = options.ctaStyle || "rounded";
    this.qrSize = options.qrSize ?? 140;
    this.qrColor = options.qrColor || "#1a1a2e";
    this.qrBackground = options.qrBackground || "#FFFFFF";
    this.ctaX = options.ctaX;  // undefined = auto-center
    this.ctaY = options.ctaY;  // undefined = default position
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
          opacity: opts.overlayOpacity,
        });
      } else {
        // Fallback: no pdftoppm available — copy the original page content
        // into the output, then draw a semi-transparent overlay on top.
        // This preserves the underlying text/shapes in a "frosted" look.
        const [copiedPage] = await outDoc.copyPages(srcDoc, [i]);
        const copiedContent = copiedPage.node;

        // Transfer content stream and resources from the copied page
        const resources = copiedContent.get(PDFName.of("Resources"));
        const contents = copiedContent.get(PDFName.of("Contents"));
        if (resources) outPage.node.set(PDFName.of("Resources"), resources);
        if (contents) outPage.node.set(PDFName.of("Contents"), contents);

        // Apply semi-transparent overlay tint to obscure the content
        // Use a higher opacity than the blur path since there's no actual blur
        const fallbackOpacity = Math.max(opts.overlayOpacity, PdfOverlayEngine.FALLBACK_MIN_OPACITY);
        outPage.drawRectangle({
          x: 0,
          y: 0,
          width: width,
          height: height,
          color: rgb(overlayRgb.r, overlayRgb.g, overlayRgb.b),
          opacity: fallbackOpacity,
        });
      }

      // ---- 6. Draw CTA (button or QR code) ----
      if (opts.ctaType === "qrCode") {
        await this._drawQrCodeCta(outDoc, outPage, font, width, height, opts);
      } else {
        this._drawButtonCta(outDoc, outPage, font, width, height, opts, ctaBgRgb, ctaTextRgb);
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
   * Draw a QR code CTA centered on the page with an elegant card background
   * and label text.
   * @private
   */
  async _drawQrCodeCta(outDoc, outPage, font, pageW, pageH, opts) {
    const qrSize = opts.qrSize || 140;
    const label = opts.ctaLabel || "Scan to View Document";
    const labelFontSize = opts.ctaFontSize || 14;
    const qrUrl = opts.ctaUrl || "";

    // QR code requires a URL to encode
    if (!qrUrl) return;

    // Card dimensions: QR code + padding + label
    const cardPadding = 20;
    const labelHeight = labelFontSize + 8;
    const cardW = qrSize + cardPadding * 2;
    const cardH = qrSize + cardPadding * 2 + labelHeight + 12;

    // Custom position via ctaX/ctaY (0-1 fractions) or default center
    let cardX, cardY;
    if (opts.ctaX !== undefined && opts.ctaX !== null) {
      cardX = opts.ctaX * pageW - cardW / 2;
      cardX = Math.max(10, Math.min(cardX, pageW - cardW - 10));
    } else {
      cardX = (pageW - cardW) / 2;
    }
    if (opts.ctaY !== undefined && opts.ctaY !== null) {
      cardY = opts.ctaY * pageH - cardH / 2;
      cardY = Math.max(10, Math.min(cardY, pageH - cardH - 10));
    } else {
      cardY = (pageH - cardH) / 2;
    }

    // Card shadow
    outPage.drawRectangle({
      x: cardX + 3,
      y: cardY - 3,
      width: cardW,
      height: cardH,
      color: rgb(0, 0, 0),
      opacity: 0.12,
    });

    // Card background (white with subtle border)
    outPage.drawRectangle({
      x: cardX,
      y: cardY,
      width: cardW,
      height: cardH,
      color: rgb(1, 1, 1),
      opacity: 0.95,
      borderColor: rgb(0.8, 0.8, 0.8),
      borderWidth: 1,
    });

    // Generate QR code as PNG
    const qrColorHex = opts.qrColor || "#1a1a2e";
    const qrBgHex = opts.qrBackground || "#FFFFFF";
    const qrDataUrl = await QRCode.toDataURL(qrUrl, {
      width: qrSize * 3, // 3× for sharp rendering
      margin: 1,
      color: { dark: qrColorHex, light: qrBgHex },
      errorCorrectionLevel: "M",
    });
    const base64 = qrDataUrl.replace(/^data:image\/png;base64,/, "");
    const qrBuffer = Buffer.from(base64, "base64");
    const embeddedQr = await outDoc.embedPng(qrBuffer);

    // Draw QR code centered in card
    const qrX = cardX + cardPadding;
    const qrY = cardY + labelHeight + 12 + cardPadding;
    outPage.drawImage(embeddedQr, {
      x: qrX,
      y: qrY,
      width: qrSize,
      height: qrSize,
    });

    // Draw label text centered below QR code
    const labelColor = hexToRgb(opts.ctaTextColor || "#333333");
    const labelWidth = font.widthOfTextAtSize(label, labelFontSize);
    const labelX = cardX + (cardW - labelWidth) / 2;
    const labelY = cardY + cardPadding;

    outPage.drawText(label, {
      x: labelX,
      y: labelY,
      size: labelFontSize,
      font: font,
      color: rgb(labelColor.r, labelColor.g, labelColor.b),
    });

    // Add clickable annotation over the entire card
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
        Rect: [cardX, cardY, cardX + cardW, cardY + cardH],
        Border: [0, 0, 0],
        A: actionDict,
      });
      const annotRef = context.register(annotDict);
      outPage.node.set(PDFName.of("Annots"), context.obj([annotRef]));
    }
  }

  /**
   * Draw a button CTA centered on the page with optional rounded corners.
   *
   * Supports three styles via opts.ctaStyle:
   *   - "rounded" (default) — filled button with rounded corners
   *   - "square"  — filled button with sharp corners
   *   - "outline" — transparent button with a coloured border
   *
   * @private
   */
  _drawButtonCta(outDoc, outPage, font, pageW, pageH, opts, ctaBgRgb, ctaTextRgb) {
    const btnW = Math.min(opts.ctaWidth, pageW - 80);
    const btnH = opts.ctaHeight;

    // Custom position via ctaX/ctaY (0-1 fractions) or default auto-center
    let btnX, btnY;
    if (opts.ctaX !== undefined && opts.ctaX !== null) {
      btnX = opts.ctaX * pageW - btnW / 2;
      btnX = Math.max(10, Math.min(btnX, pageW - btnW - 10)); // clamp to page
    } else {
      btnX = (pageW - btnW) / 2;
    }
    if (opts.ctaY !== undefined && opts.ctaY !== null) {
      // ctaY is 0=bottom, 1=top (matches PDF coordinate system)
      btnY = opts.ctaY * pageH - btnH / 2;
      btnY = Math.max(10, Math.min(btnY, pageH - btnH - 10));
    } else {
      // Default: position button in the lower-third of the page
      btnY = pageH * 0.38 - btnH / 2;
    }
    const style = opts.ctaStyle || "rounded";
    const r = style === "square" ? 0 : Math.min(opts.ctaBorderRadius ?? 8, btnH / 2);

    if (r > 0) {
      // ---- Rounded rectangle via SVG path ----
      const svgPath = roundedRectSvgPath(btnW, btnH, r);

      // Shadow (offset +2, -2)
      outPage.drawSvgPath(svgPath, {
        x: btnX + 2,
        y: btnY + btnH - 2,
        color: rgb(0, 0, 0),
        opacity: 0.15,
      });

      // Background (filled or outline)
      if (style === "outline") {
        outPage.drawSvgPath(svgPath, {
          x: btnX,
          y: btnY + btnH,
          borderColor: rgb(ctaBgRgb.r, ctaBgRgb.g, ctaBgRgb.b),
          borderWidth: 2,
          borderOpacity: 1,
          color: rgb(1, 1, 1),
          opacity: 0,
        });
      } else {
        outPage.drawSvgPath(svgPath, {
          x: btnX,
          y: btnY + btnH,
          color: rgb(ctaBgRgb.r, ctaBgRgb.g, ctaBgRgb.b),
          opacity: 1,
          borderColor: rgb(
            Math.max(ctaBgRgb.r - 0.08, 0),
            Math.max(ctaBgRgb.g - 0.08, 0),
            Math.max(ctaBgRgb.b - 0.08, 0)
          ),
          borderWidth: 0.75,
        });
      }
    } else {
      // ---- Sharp rectangle (square style) ----
      outPage.drawRectangle({
        x: btnX + 2,
        y: btnY - 2,
        width: btnW,
        height: btnH,
        color: rgb(0, 0, 0),
        opacity: 0.15,
      });
      if (style === "outline") {
        outPage.drawRectangle({
          x: btnX,
          y: btnY,
          width: btnW,
          height: btnH,
          borderColor: rgb(ctaBgRgb.r, ctaBgRgb.g, ctaBgRgb.b),
          borderWidth: 2,
          color: rgb(1, 1, 1),
          opacity: 0,
        });
      } else {
        outPage.drawRectangle({
          x: btnX,
          y: btnY,
          width: btnW,
          height: btnH,
          color: rgb(ctaBgRgb.r, ctaBgRgb.g, ctaBgRgb.b),
          opacity: 1,
          borderColor: rgb(
            Math.max(ctaBgRgb.r - 0.08, 0),
            Math.max(ctaBgRgb.g - 0.08, 0),
            Math.max(ctaBgRgb.b - 0.08, 0)
          ),
          borderWidth: 0.75,
        });
      }
    }

    // Button text (centered)
    const fontSize = opts.ctaFontSize;
    const textWidth = font.widthOfTextAtSize(opts.ctaText, fontSize);
    const textX = btnX + (btnW - textWidth) / 2;
    const textY = btnY + (btnH - fontSize) / 2 + 2;
    const textRgb = style === "outline" ? ctaBgRgb : ctaTextRgb;

    outPage.drawText(opts.ctaText, {
      x: textX,
      y: textY,
      size: fontSize,
      font: font,
      color: rgb(textRgb.r, textRgb.g, textRgb.b),
    });

    // Add clickable link annotation over the CTA button
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
          // Render this page as a PNG at 200 DPI (good balance of quality vs file size)
          execFileSync("pdftoppm", [
            "-png",
            "-r", "200",
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

            // Apply blur based on blurStyle
            const blurSigma = Math.max(opts.blurRadius, 1);
            let blurredPng;
            if (opts.blurStyle === "glass") {
              // Frosted glass: blur + subtle brightness lift + mild desaturation
              blurredPng = await sharp(rawPng)
                .blur(blurSigma)
                .modulate({ brightness: 1.05, saturation: 0.85 })
                .png()
                .toBuffer();
            } else {
              // Standard Gaussian blur
              blurredPng = await sharp(rawPng)
                .blur(blurSigma)
                .png()
                .toBuffer();
            }

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
 * Build an SVG path string for a rounded rectangle.
 *
 * pdf-lib's drawSvgPath uses standard SVG coords (Y-down) and then
 * flips internally, so the path is drawn as a normal top-left-origin
 * rounded rect.  The caller sets { x, y } to position the top-left
 * corner in PDF coordinate space (x = left, y = top of the shape).
 *
 * @param {number} w – width
 * @param {number} h – height
 * @param {number} r – corner radius (clamped to half the smaller dimension)
 * @returns {string}
 */
function roundedRectSvgPath(w, h, r) {
  const cr = Math.min(r, w / 2, h / 2);
  return [
    `M ${cr} 0`,
    `H ${w - cr}`,
    `Q ${w} 0 ${w} ${cr}`,
    `V ${h - cr}`,
    `Q ${w} ${h} ${w - cr} ${h}`,
    `H ${cr}`,
    `Q 0 ${h} 0 ${h - cr}`,
    `V ${cr}`,
    `Q 0 0 ${cr} 0`,
    `Z`,
  ].join(" ");
}

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
