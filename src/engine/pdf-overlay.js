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
   * @param {string}  [options.ctaIcon]                   – Emoji/text prefix for button label (e.g. "🔓", "👁", "📄")
   * @param {number}  [options.qrSize=140]                – QR code size in pt
   * @param {string}  [options.qrColor="#1a1a2e"]         – QR code foreground colour
   * @param {string}  [options.qrBackground="#FFFFFF"]    – QR code background colour
   * @param {number}  [options.ctaX]                      – Custom CTA x position (0-1 fraction of page width). Omit to auto-center.
   * @param {number}  [options.ctaY]                      – Custom CTA y position (0-1 fraction of page height, 0=bottom, 1=top). Omit to use default lower-third.
   * @param {string}  [options.blurPages="all"]           – Which pages to blur: "all", "1-3", "1,3,5", "first", "last". Non-blurred pages are copied as-is.
   * @param {number}  [options.dpi=200]                   – Rendering DPI for pdftoppm (150/200/300). Higher = better quality, larger file.
   * @param {string}  [options.watermarkText]              – Optional diagonal watermark text on blurred pages (e.g. "PREVIEW", "SAMPLE")
   * @param {string}  [options.watermarkColor="#000000"]   – Watermark text colour
   * @param {number}  [options.watermarkOpacity=0.08]      – Watermark text opacity (0-1)
   * @param {string}  [options.metaTitle]                  – PDF title metadata
   * @param {string}  [options.metaAuthor]                 – PDF author metadata
   * @param {string}  [options.metaSubject]                – PDF subject metadata
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
    this.ctaIcon = options.ctaIcon || "";
    this.qrSize = options.qrSize ?? 140;
    this.qrColor = options.qrColor || "#1a1a2e";
    this.qrBackground = options.qrBackground || "#FFFFFF";
    this.ctaX = options.ctaX;  // undefined = auto-center
    this.ctaY = options.ctaY;  // undefined = default position
    this.blurPages = options.blurPages || "all";
    this.dpi = options.dpi ?? 200;
    this.watermarkText = options.watermarkText || "";
    this.watermarkColor = options.watermarkColor || "#000000";
    this.watermarkOpacity = options.watermarkOpacity ?? 0.08;
    this.metaTitle = options.metaTitle || "";
    this.metaAuthor = options.metaAuthor || "";
    this.metaSubject = options.metaSubject || "";
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

    // ---- 1b. Determine which pages to blur ----
    const blurSet = PdfOverlayEngine.parsePageRange(opts.blurPages, pageCount);

    // ---- 2. Render only the pages that need blurring as images ----
    const pageImages = await this._renderPagesAsImages(pdfBuffer, srcDoc, opts, blurSet);

    // ---- 3. Create output PDF ----
    const outDoc = await PDFDocument.create();

    // Parse colours once
    const overlayRgb = hexToRgb(opts.overlayColor);
    const ctaBgRgb = hexToRgb(opts.ctaBgColor);
    const ctaTextRgb = hexToRgb(opts.ctaTextColor);

    // Embed a standard font for the CTA text
    const font = await outDoc.embedFont(StandardFonts.HelveticaBold);

    for (let i = 0; i < pageCount; i++) {
      const shouldBlur = blurSet.has(i);

      // Get source page dimensions
      const srcPage = srcDoc.getPage(i);
      const { width, height } = srcPage.getSize();

      if (!shouldBlur) {
        // ---- Copy page as-is (no blur, no overlay, no CTA) ----
        const [copiedPage] = await outDoc.copyPages(srcDoc, [i]);
        outDoc.addPage(copiedPage);
        continue;
      }

      // ---- 4. Build blurred output page ----
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

      // ---- 6. Draw diagonal watermark (if configured) ----
      if (opts.watermarkText) {
        this._drawWatermark(outPage, font, width, height, opts);
      }

      // ---- 7. Draw CTA (button or QR code) ----
      if (opts.ctaType === "qrCode") {
        await this._drawQrCodeCta(outDoc, outPage, font, width, height, opts);
      } else {
        this._drawButtonCta(outDoc, outPage, font, width, height, opts, ctaBgRgb, ctaTextRgb);
      }
    }

    // ---- 8. Set PDF metadata ----
    outDoc.setTitle(opts.metaTitle || "Protected Document");
    if (opts.metaAuthor) outDoc.setAuthor(opts.metaAuthor);
    if (opts.metaSubject) outDoc.setSubject(opts.metaSubject);
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
   * Draw a styled CTA button on the page.
   *
   * Supports eight styles via opts.ctaStyle:
   *   - "rounded"  (default) — filled button with rounded corners
   *   - "square"   — filled button with sharp corners
   *   - "outline"  — transparent button with a coloured border
   *   - "pill"     — fully-rounded pill shape (radius = half height)
   *   - "gradient" — two-tone gradient fill (darker at top, lighter at bottom)
   *   - "shadow3d" — raised 3D button with stronger layered shadow
   *   - "banner"   — full-width page banner
   *   - "minimal"  — clean text-only with subtle underline
   *
   * @private
   */
  _drawButtonCta(outDoc, outPage, font, pageW, pageH, opts, ctaBgRgb, ctaTextRgb) {
    const style = opts.ctaStyle || "rounded";

    // Button dimensions — "banner" uses nearly full page width
    let btnW = style === "banner"
      ? pageW - 40
      : Math.min(opts.ctaWidth, pageW - 80);
    const btnH = opts.ctaHeight;

    // Custom position via ctaX/ctaY (0-1 fractions) or default auto-center
    let btnX, btnY;
    if (opts.ctaX !== undefined && opts.ctaX !== null) {
      btnX = opts.ctaX * pageW - btnW / 2;
      btnX = Math.max(10, Math.min(btnX, pageW - btnW - 10));
    } else {
      btnX = (pageW - btnW) / 2;
    }
    if (opts.ctaY !== undefined && opts.ctaY !== null) {
      btnY = opts.ctaY * pageH - btnH / 2;
      btnY = Math.max(10, Math.min(btnY, pageH - btnH - 10));
    } else {
      btnY = pageH * 0.38 - btnH / 2;
    }

    // Compute corner radius based on style
    let r;
    if (style === "square" || style === "banner" || style === "minimal") {
      r = 0;
    } else if (style === "pill") {
      r = btnH / 2;
    } else {
      r = Math.min(opts.ctaBorderRadius ?? 8, btnH / 2);
    }

    // Prepend icon to button text if set.
    // Standard PDF fonts (Helvetica, etc.) only support WinAnsi encoding,
    // so we strip any non-ASCII characters (emoji) and use ASCII fallbacks.
    let displayText = opts.ctaText;
    if (opts.ctaIcon) {
      // Remove non-ASCII characters from icon and use as prefix if anything remains
      const safeIcon = opts.ctaIcon.replace(/[^\x20-\x7E]/g, "").trim();
      if (safeIcon) {
        displayText = `${safeIcon}  ${opts.ctaText}`;
      }
      // If icon was emoji-only (nothing left after stripping), skip prefix gracefully
    }

    // ---- Draw based on style ----
    if (style === "minimal") {
      this._drawMinimalCta(outPage, font, btnX, btnY, btnW, btnH, displayText, opts, ctaBgRgb);
    } else if (style === "gradient") {
      this._drawGradientCta(outPage, font, btnX, btnY, btnW, btnH, r, displayText, opts, ctaBgRgb, ctaTextRgb);
    } else if (style === "shadow3d") {
      this._drawShadow3dCta(outPage, font, btnX, btnY, btnW, btnH, r, displayText, opts, ctaBgRgb, ctaTextRgb);
    } else {
      this._drawStandardCta(outPage, font, btnX, btnY, btnW, btnH, r, style, displayText, opts, ctaBgRgb, ctaTextRgb);
    }

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
   * Standard button drawing (rounded, square, outline, pill, banner).
   * @private
   */
  _drawStandardCta(outPage, font, btnX, btnY, btnW, btnH, r, style, displayText, opts, ctaBgRgb, ctaTextRgb) {
    if (r > 0) {
      const svgPath = roundedRectSvgPath(btnW, btnH, r);

      // Shadow
      outPage.drawSvgPath(svgPath, {
        x: btnX + 2, y: btnY + btnH - 2,
        color: rgb(0, 0, 0), opacity: 0.15,
      });

      if (style === "outline") {
        outPage.drawSvgPath(svgPath, {
          x: btnX, y: btnY + btnH,
          borderColor: rgb(ctaBgRgb.r, ctaBgRgb.g, ctaBgRgb.b),
          borderWidth: 2, borderOpacity: 1,
          color: rgb(1, 1, 1), opacity: 0,
        });
      } else {
        outPage.drawSvgPath(svgPath, {
          x: btnX, y: btnY + btnH,
          color: rgb(ctaBgRgb.r, ctaBgRgb.g, ctaBgRgb.b), opacity: 1,
          borderColor: rgb(
            Math.max(ctaBgRgb.r - 0.08, 0),
            Math.max(ctaBgRgb.g - 0.08, 0),
            Math.max(ctaBgRgb.b - 0.08, 0)
          ),
          borderWidth: 0.75,
        });
      }
    } else {
      // Sharp rectangle (square / banner)
      outPage.drawRectangle({
        x: btnX + 2, y: btnY - 2, width: btnW, height: btnH,
        color: rgb(0, 0, 0), opacity: 0.15,
      });
      if (style === "outline") {
        outPage.drawRectangle({
          x: btnX, y: btnY, width: btnW, height: btnH,
          borderColor: rgb(ctaBgRgb.r, ctaBgRgb.g, ctaBgRgb.b),
          borderWidth: 2, color: rgb(1, 1, 1), opacity: 0,
        });
      } else {
        outPage.drawRectangle({
          x: btnX, y: btnY, width: btnW, height: btnH,
          color: rgb(ctaBgRgb.r, ctaBgRgb.g, ctaBgRgb.b), opacity: 1,
          borderColor: rgb(
            Math.max(ctaBgRgb.r - 0.08, 0),
            Math.max(ctaBgRgb.g - 0.08, 0),
            Math.max(ctaBgRgb.b - 0.08, 0)
          ),
          borderWidth: 0.75,
        });
      }
    }

    // Text
    const fontSize = opts.ctaFontSize;
    const textWidth = font.widthOfTextAtSize(displayText, fontSize);
    const textX = btnX + (btnW - textWidth) / 2;
    const textY = btnY + (btnH - fontSize) / 2 + 2;
    const textRgb = style === "outline" ? ctaBgRgb : ctaTextRgb;

    outPage.drawText(displayText, {
      x: textX, y: textY, size: fontSize, font,
      color: rgb(textRgb.r, textRgb.g, textRgb.b),
    });
  }

  /**
   * Gradient button: simulated 2-colour gradient using horizontal bands.
   * @private
   */
  _drawGradientCta(outPage, font, btnX, btnY, btnW, btnH, r, displayText, opts, ctaBgRgb, ctaTextRgb) {
    const svgPath = r > 0 ? roundedRectSvgPath(btnW, btnH, r) : null;

    // Shadow
    if (svgPath) {
      outPage.drawSvgPath(svgPath, {
        x: btnX + 2, y: btnY + btnH - 2,
        color: rgb(0, 0, 0), opacity: 0.18,
      });
    } else {
      outPage.drawRectangle({
        x: btnX + 2, y: btnY - 2, width: btnW, height: btnH,
        color: rgb(0, 0, 0), opacity: 0.18,
      });
    }

    // Gradient bands (8 horizontal strips from darker top to lighter bottom)
    const bands = 8;
    const bandH = btnH / bands;
    for (let b = 0; b < bands; b++) {
      const t = b / Math.max(bands - 1, 1); // 0 at top, 1 at bottom
      const bandColor = {
        r: Math.min(ctaBgRgb.r + t * 0.15, 1),
        g: Math.min(ctaBgRgb.g + t * 0.15, 1),
        b: Math.min(ctaBgRgb.b + t * 0.15, 1),
      };
      outPage.drawRectangle({
        x: btnX, y: btnY + (bands - 1 - b) * bandH,
        width: btnW, height: bandH + 0.5,
        color: rgb(bandColor.r, bandColor.g, bandColor.b), opacity: 1,
      });
    }

    // Clean up edges with border
    if (svgPath) {
      outPage.drawSvgPath(svgPath, {
        x: btnX, y: btnY + btnH,
        color: rgb(0, 0, 0), opacity: 0,
        borderColor: rgb(
          Math.max(ctaBgRgb.r - 0.1, 0),
          Math.max(ctaBgRgb.g - 0.1, 0),
          Math.max(ctaBgRgb.b - 0.1, 0)
        ),
        borderWidth: 1.5,
      });
    }

    // Text
    const fontSize = opts.ctaFontSize;
    const textWidth = font.widthOfTextAtSize(displayText, fontSize);
    outPage.drawText(displayText, {
      x: btnX + (btnW - textWidth) / 2,
      y: btnY + (btnH - fontSize) / 2 + 2,
      size: fontSize, font,
      color: rgb(ctaTextRgb.r, ctaTextRgb.g, ctaTextRgb.b),
    });
  }

  /**
   * 3D raised button: layered shadows for depth effect.
   * @private
   */
  _drawShadow3dCta(outPage, font, btnX, btnY, btnW, btnH, r, displayText, opts, ctaBgRgb, ctaTextRgb) {
    const svgPath = r > 0 ? roundedRectSvgPath(btnW, btnH, r) : null;
    const drawShape = (x, y, color, opacity, borderColor, borderWidth) => {
      if (svgPath) {
        const shapeOpts = { x, y: y + btnH, color, opacity };
        if (borderColor) { shapeOpts.borderColor = borderColor; shapeOpts.borderWidth = borderWidth; }
        outPage.drawSvgPath(svgPath, shapeOpts);
      } else {
        const shapeOpts = { x, y, width: btnW, height: btnH, color, opacity };
        if (borderColor) { shapeOpts.borderColor = borderColor; shapeOpts.borderWidth = borderWidth; }
        outPage.drawRectangle(shapeOpts);
      }
    };

    // Three shadow layers for depth
    drawShape(btnX + 4, btnY - 4, rgb(0, 0, 0), 0.08, null, 0);
    drawShape(btnX + 3, btnY - 3, rgb(0, 0, 0), 0.12, null, 0);
    drawShape(btnX + 1.5, btnY - 1.5, rgb(0, 0, 0), 0.18, null, 0);

    // Main body
    drawShape(btnX, btnY, rgb(ctaBgRgb.r, ctaBgRgb.g, ctaBgRgb.b), 1,
      rgb(Math.max(ctaBgRgb.r - 0.12, 0), Math.max(ctaBgRgb.g - 0.12, 0), Math.max(ctaBgRgb.b - 0.12, 0)), 1.2);

    // Top highlight (lighter strip at top 30%)
    const highlightH = btnH * 0.35;
    outPage.drawRectangle({
      x: btnX + 2, y: btnY + btnH - highlightH,
      width: btnW - 4, height: highlightH - 1,
      color: rgb(1, 1, 1), opacity: 0.12,
    });

    // Text
    const fontSize = opts.ctaFontSize;
    const textWidth = font.widthOfTextAtSize(displayText, fontSize);
    outPage.drawText(displayText, {
      x: btnX + (btnW - textWidth) / 2,
      y: btnY + (btnH - fontSize) / 2 + 2,
      size: fontSize, font,
      color: rgb(ctaTextRgb.r, ctaTextRgb.g, ctaTextRgb.b),
    });
  }

  /**
   * Minimal CTA: text-only with a subtle coloured underline.
   * @private
   */
  _drawMinimalCta(outPage, font, btnX, btnY, btnW, btnH, displayText, opts, ctaBgRgb) {
    const fontSize = opts.ctaFontSize;
    const textWidth = font.widthOfTextAtSize(displayText, fontSize);
    const textX = btnX + (btnW - textWidth) / 2;
    const textY = btnY + (btnH - fontSize) / 2 + 2;

    // Text in button colour
    outPage.drawText(displayText, {
      x: textX, y: textY, size: fontSize, font,
      color: rgb(ctaBgRgb.r, ctaBgRgb.g, ctaBgRgb.b),
    });

    // Subtle underline below text
    outPage.drawRectangle({
      x: textX - 4, y: textY - 3,
      width: textWidth + 8, height: 1.5,
      color: rgb(ctaBgRgb.r, ctaBgRgb.g, ctaBgRgb.b),
      opacity: 0.6,
    });
  }

  /**
   * Draw a diagonal watermark text across the page.
   * The text is rendered at a 45° angle, semi-transparent, repeating in a
   * tiled pattern across the full page for professional watermark appearance.
   * @private
   */
  _drawWatermark(outPage, font, pageW, pageH, opts) {
    const text = opts.watermarkText;
    if (!text) return;

    const wmColor = hexToRgb(opts.watermarkColor || "#000000");
    const wmOpacity = opts.watermarkOpacity ?? 0.08;
    const fontSize = Math.min(pageW, pageH) * 0.08; // Auto-size relative to page

    const textWidth = font.widthOfTextAtSize(text, fontSize);

    // Draw tiled watermarks across the page at -45° angle
    const spacingX = textWidth + 80;
    const spacingY = fontSize * 3;

    for (let y = -pageH * 0.5; y < pageH * 1.5; y += spacingY) {
      for (let x = -pageW * 0.3; x < pageW * 1.3; x += spacingX) {
        outPage.drawText(text, {
          x: x,
          y: y,
          size: fontSize,
          font: font,
          color: rgb(wmColor.r, wmColor.g, wmColor.b),
          opacity: wmOpacity,
          rotate: { type: "degrees", angle: -45 },
        });
      }
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
   * @param {Set<number>} blurSet – Set of 0-based page indices to blur (skip others)
   * @returns {Promise<(Buffer|null)[]>} – Array indexed by page number. Contains blurred PNG buffer
   *          for pages in blurSet, or null for pages that should be skipped/use fallback.
   */
  async _renderPagesAsImages(pdfBuffer, srcDoc, opts, blurSet) {
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
        // Skip rendering pages that don't need blurring
        if (!blurSet.has(i)) {
          results.push(null);
          continue;
        }

        const pageNum = i + 1; // pdftoppm uses 1-based page numbers
        const outPrefix = path.join(tmpDir, `page`);

        try {
          // Render this page as a PNG at the configured DPI
          const renderDpi = String(Math.max(100, Math.min(opts.dpi ?? 200, 600)));
          execFileSync("pdftoppm", [
            "-png",
            "-r", renderDpi,
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

  /**
   * Parse a page range string into a Set of 0-based page indices.
   *
   * Supported formats:
   *   - "all"      → all pages (default)
   *   - "first"    → only the first page
   *   - "last"     → only the last page
   *   - "1-3"      → pages 1, 2, 3 (1-based → 0-based internally)
   *   - "1,3,5"    → specific pages 1, 3, 5
   *   - "1-3,7,9"  → mixed ranges and individual pages
   *
   * @param {string} rangeStr  – The page range expression
   * @param {number} pageCount – Total number of pages in the PDF
   * @returns {Set<number>}    – Set of 0-based page indices to blur
   */
  static parsePageRange(rangeStr, pageCount) {
    if (!rangeStr || rangeStr === "all") {
      // All pages
      const set = new Set();
      for (let i = 0; i < pageCount; i++) set.add(i);
      return set;
    }

    if (rangeStr === "first") {
      return new Set([0]);
    }

    if (rangeStr === "last") {
      return new Set([pageCount - 1]);
    }

    const set = new Set();
    const parts = rangeStr.split(",").map(s => s.trim()).filter(Boolean);

    for (const part of parts) {
      if (part.includes("-")) {
        // Range: "2-5" means pages 2,3,4,5 (1-based)
        const [startStr, endStr] = part.split("-");
        const start = Math.max(1, parseInt(startStr, 10) || 1);
        const end = Math.min(pageCount, parseInt(endStr, 10) || pageCount);
        for (let p = start; p <= end; p++) {
          set.add(p - 1); // convert to 0-based
        }
      } else {
        // Single page: "3" means page 3 (1-based)
        const p = parseInt(part, 10);
        if (p >= 1 && p <= pageCount) {
          set.add(p - 1); // convert to 0-based
        }
      }
    }

    // If nothing valid was parsed, fall back to all pages
    if (set.size === 0) {
      for (let i = 0; i < pageCount; i++) set.add(i);
    }

    return set;
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
