const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");

/**
 * PDFEngine — A complete server-side PDF generation engine.
 *
 * Builds any type of PDF from a plain JavaScript object (a "spec").
 * Every piece of text can carry a clickable link and every element is
 * composable so you can mix-and-match to create invoices, resumes,
 * contracts, reports, certificates, letters — or anything else.
 */
class PDFEngine {
  /**
   * @param {object} [options]
   * @param {number} [options.defaultFontSize=12]
   * @param {string} [options.defaultFont="Helvetica"]
   * @param {object} [options.margins]  – { top, bottom, left, right }
   * @param {string} [options.size="A4"] – Any size PDFKit supports
   */
  constructor(options = {}) {
    this.defaultFontSize = options.defaultFontSize || 12;
    this.defaultFont = options.defaultFont || "Helvetica";
    this.margins = options.margins || { top: 50, bottom: 50, left: 50, right: 50 };
    this.size = options.size || "A4";
  }

  /* ------------------------------------------------------------------ */
  /*  Public API                                                        */
  /* ------------------------------------------------------------------ */

  /**
   * Generate a PDF and write it to a file.
   * @param {object}  spec     – Document specification (see README).
   * @param {string}  filePath – Destination path.
   * @returns {Promise<string>} Resolved with the absolute file path.
   */
  generateToFile(spec, filePath) {
    return new Promise((resolve, reject) => {
      const absolutePath = path.resolve(filePath);
      const dir = path.dirname(absolutePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      const doc = this._createDocument(spec);
      const stream = fs.createWriteStream(absolutePath);
      doc.pipe(stream);
      this._render(doc, spec);
      doc.end();
      stream.on("finish", () => resolve(absolutePath));
      stream.on("error", reject);
    });
  }

  /**
   * Generate a PDF and return it as a Buffer (useful for HTTP responses).
   * @param {object} spec – Document specification.
   * @returns {Promise<Buffer>}
   */
  generateToBuffer(spec) {
    return new Promise((resolve, reject) => {
      const doc = this._createDocument(spec);
      const chunks = [];
      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
      this._render(doc, spec);
      doc.end();
    });
  }

  /**
   * Pipe the PDF directly into a writable stream (e.g. an HTTP response).
   * @param {object}   spec   – Document specification.
   * @param {Writable} stream – Any Node.js writable stream.
   * @returns {Promise<void>}
   */
  generateToStream(spec, stream) {
    return new Promise((resolve, reject) => {
      const doc = this._createDocument(spec);
      doc.pipe(stream);
      this._render(doc, spec);
      doc.end();
      stream.on("finish", resolve);
      stream.on("error", reject);
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Internal helpers                                                  */
  /* ------------------------------------------------------------------ */

  /** Create the underlying PDFDocument. */
  _createDocument(spec) {
    const docOpts = {
      size: spec.size || this.size,
      margins: spec.margins || this.margins,
      info: spec.meta || {},
      autoFirstPage: true,
      bufferPages: true,
    };
    return new PDFDocument(docOpts);
  }

  /** Walk the spec and render every element. */
  _render(doc, spec) {
    const elements = spec.elements || spec.content || [];
    for (const el of elements) {
      this._renderElement(doc, el);
    }

    // Add page numbers if requested
    if (spec.pageNumbers) {
      this._addPageNumbers(doc, spec.pageNumbers);
    }
  }

  /** Dispatch a single element to the correct renderer. */
  _renderElement(doc, el) {
    switch (el.type) {
      case "text":       return this._renderText(doc, el);
      case "heading":    return this._renderHeading(doc, el);
      case "link":       return this._renderLink(doc, el);
      case "list":       return this._renderList(doc, el);
      case "table":      return this._renderTable(doc, el);
      case "image":      return this._renderImage(doc, el);
      case "divider":    return this._renderDivider(doc, el);
      case "spacer":     return this._renderSpacer(doc, el);
      case "columns":    return this._renderColumns(doc, el);
      case "rect":       return this._renderRect(doc, el);
      case "overlay":    return this._renderOverlay(doc, el);
      case "stealthLink": return this._renderStealthLink(doc, el);
      case "pageBreak":  return doc.addPage();
      default:
        // Unknown type — silently skip so the engine stays forward-compatible.
        break;
    }
  }

  /* ---------- Element renderers ---------- */

  _applyFont(doc, el) {
    const font = el.font || this.defaultFont;
    const size = el.fontSize || this.defaultFontSize;
    const color = el.color || "#000000";
    doc.font(font).fontSize(size).fillColor(color);
  }

  _renderText(doc, el) {
    this._applyFont(doc, el);
    const opts = this._textOptions(el);
    doc.text(el.value || "", opts);
    if (el.moveDown) doc.moveDown(el.moveDown);
  }

  _renderHeading(doc, el) {
    const level = el.level || 1;
    const sizeMap = { 1: 26, 2: 22, 3: 18, 4: 16, 5: 14, 6: 12 };
    const fontSize = el.fontSize || sizeMap[level] || 18;
    this._applyFont(doc, { ...el, fontSize, font: el.font || "Helvetica-Bold" });
    const opts = this._textOptions(el);
    doc.text(el.value || "", opts);
    doc.moveDown(el.moveDown ?? 0.5);
  }

  _renderLink(doc, el) {
    // If stealth mode is on, delegate to the stealth renderer
    if (el.stealth) {
      return this._renderStealthLink(doc, {
        ...el,
        // Stealth links default to body-text colour so they blend in
        color: el.color || "#000000",
        underline: el.underline ?? false,
      });
    }

    const fontSize = el.fontSize || this.defaultFontSize;
    const color = el.color || "#1a0dab";
    doc.font(el.font || this.defaultFont)
       .fontSize(fontSize)
       .fillColor(color);
    const opts = { ...this._textOptions(el), link: el.url, underline: true };
    doc.text(el.value || el.url, opts);
    doc.fillColor("#000000");
    if (el.moveDown) doc.moveDown(el.moveDown);
  }

  _renderList(doc, el) {
    this._applyFont(doc, el);
    const items = el.items || [];
    const ordered = el.ordered || false;
    const indent = el.indent || 15;
    items.forEach((item, i) => {
      const bullet = ordered ? `${i + 1}. ` : "• ";
      const opts = this._textOptions(el);
      opts.indent = indent;
      if (typeof item === "string") {
        doc.text(`${bullet}${item}`, opts);
      } else {
        // item can be an object { text, link }
        doc.text(`${bullet}${item.text || ""}`, { ...opts, link: item.link, underline: !!item.link });
      }
    });
    doc.moveDown(el.moveDown ?? 0.5);
  }

  _renderTable(doc, el) {
    const headers = el.headers || [];
    const rows = el.rows || [];
    const colWidths = el.columnWidths || this._autoColumnWidths(doc, headers.length);
    const startX = el.x || doc.x;
    const headerFont = el.headerFont || "Helvetica-Bold";
    const bodyFont = el.bodyFont || this.defaultFont;
    const fontSize = el.fontSize || 10;
    const headerBg = el.headerBackground || "#4472C4";
    const headerColor = el.headerColor || "#FFFFFF";
    const rowAltBg = el.alternateRowBackground || "#F2F2F2";
    const cellPadding = el.cellPadding || 5;
    const rowHeight = el.rowHeight || fontSize + cellPadding * 2 + 4;

    let y = doc.y;

    // Header row
    if (headers.length) {
      doc.save();
      doc.rect(startX, y, colWidths.reduce((a, b) => a + b, 0), rowHeight).fill(headerBg);
      doc.restore();
      let x = startX;
      headers.forEach((h, i) => {
        doc.font(headerFont).fontSize(fontSize).fillColor(headerColor);
        doc.text(String(h), x + cellPadding, y + cellPadding, {
          width: colWidths[i] - cellPadding * 2,
          align: "left",
        });
        x += colWidths[i];
      });
      y += rowHeight;
    }

    // Body rows
    rows.forEach((row, ri) => {
      // Check if we need a new page
      if (y + rowHeight > doc.page.height - doc.page.margins.bottom) {
        doc.addPage();
        y = doc.page.margins.top;
      }

      // Alternate row background
      if (ri % 2 === 1) {
        doc.save();
        doc.rect(startX, y, colWidths.reduce((a, b) => a + b, 0), rowHeight).fill(rowAltBg);
        doc.restore();
      }

      let x = startX;
      const cells = Array.isArray(row) ? row : Object.values(row);
      cells.forEach((cell, ci) => {
        const w = colWidths[ci] || 100;
        doc.font(bodyFont).fontSize(fontSize).fillColor("#000000");

        if (typeof cell === "object" && cell !== null && cell.link) {
          doc.fillColor(cell.color || "#1a0dab");
          doc.text(String(cell.text || ""), x + cellPadding, y + cellPadding, {
            width: w - cellPadding * 2,
            link: cell.link,
            underline: true,
          });
          doc.fillColor("#000000");
        } else {
          doc.text(String(cell ?? ""), x + cellPadding, y + cellPadding, {
            width: w - cellPadding * 2,
          });
        }
        x += w;
      });
      y += rowHeight;
    });

    // Draw grid lines
    if (el.gridLines !== false) {
      const totalW = colWidths.reduce((a, b) => a + b, 0);
      const totalRows = (headers.length ? 1 : 0) + rows.length;
      const tableTop = doc.y - 1; // approximate
      doc.strokeColor(el.gridColor || "#CCCCCC").lineWidth(0.5);

      // We'll just draw a bottom border under the table area
      doc.moveTo(startX, y).lineTo(startX + totalW, y).stroke();
    }

    doc.x = startX;
    doc.y = y + 5;
  }

  _renderImage(doc, el) {
    const opts = {};
    if (el.width) opts.width = el.width;
    if (el.height) opts.height = el.height;
    if (el.fit) opts.fit = el.fit;
    if (el.align) opts.align = el.align;
    if (el.valign) opts.valign = el.valign;
    if (el.x !== undefined && el.y !== undefined) {
      doc.image(el.src, el.x, el.y, opts);
    } else {
      doc.image(el.src, opts);
    }
    if (el.link) {
      // Make the image clickable
      const x = el.x || doc.x;
      const imgY = el.y || doc.y;
      const w = el.width || 100;
      const h = el.height || 100;
      doc.link(x, imgY - h, w, h, el.link);
    }
    if (el.moveDown) doc.moveDown(el.moveDown);
  }

  _renderDivider(doc, el) {
    const x = el.x || doc.page.margins.left;
    const w = el.width || (doc.page.width - doc.page.margins.left - doc.page.margins.right);
    const y = doc.y;
    doc.strokeColor(el.color || "#CCCCCC")
       .lineWidth(el.thickness || 1)
       .moveTo(x, y)
       .lineTo(x + w, y)
       .stroke();
    doc.y = y + (el.spacing || 10);
  }

  _renderSpacer(doc, el) {
    doc.moveDown(el.lines || 1);
  }

  _renderColumns(doc, el) {
    const columns = el.columns || [];
    const gap = el.gap || 20;
    const totalWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const colWidth = (totalWidth - gap * (columns.length - 1)) / columns.length;
    const startY = doc.y;
    let maxY = startY;

    columns.forEach((col, i) => {
      const x = doc.page.margins.left + i * (colWidth + gap);
      doc.x = x;
      doc.y = startY;

      const colElements = col.elements || col.content || [];
      for (const child of colElements) {
        // Override width context for text inside columns
        const patched = { ...child, width: colWidth };
        this._renderElement(doc, patched);
      }
      if (doc.y > maxY) maxY = doc.y;
    });

    doc.x = doc.page.margins.left;
    doc.y = maxY;
  }

  _renderRect(doc, el) {
    doc.save();
    if (el.fill) doc.rect(el.x, el.y, el.width, el.height).fill(el.fill);
    if (el.stroke) {
      doc.strokeColor(el.stroke).lineWidth(el.lineWidth || 1);
      doc.rect(el.x, el.y, el.width, el.height).stroke();
    }
    doc.restore();
    if (el.link) {
      doc.link(el.x, el.y, el.width, el.height, el.link);
    }
  }

  /**
   * Render an overlay — a semi-transparent rectangle over the current content
   * area with a prominent clickable call-to-action. Creates a "blurred"/obscured
   * teaser effect that prompts the reader to click a link (e.g. "Click to View",
   * "Unlock Full Report").
   *
   * Properties:
   *   height       – Height of the overlay area in points (default: 200)
   *   color        – Overlay background colour (default: "#FFFFFF")
   *   opacity      – 0-1, how opaque the overlay is (default: 0.85)
   *   label        – The call-to-action text (default: "Click to View")
   *   url          – The clickable URL embedded in the label
   *   labelColor   – Text colour of the label (default: "#1a0dab")
   *   labelSize    – Font size of the label (default: 18)
   *   lines        – Number of faint "redacted" lines to draw (default: 6)
   *   lineColor    – Colour of the redacted lines (default: "#E0E0E0")
   */
  _renderOverlay(doc, el) {
    const pageWidth = doc.page.width;
    const leftMargin = doc.page.margins.left;
    const rightMargin = doc.page.margins.right;
    const contentWidth = pageWidth - leftMargin - rightMargin;
    const overlayHeight = el.height || 200;
    const startY = doc.y;

    // --- Draw faint "redacted" placeholder lines behind the overlay ---
    const lines = el.lines ?? 6;
    const lineColor = el.lineColor || "#E0E0E0";
    const lineGap = overlayHeight / (lines + 2);
    doc.save();
    for (let i = 1; i <= lines; i++) {
      const ly = startY + lineGap * i;
      // Vary line widths to look like obscured text
      const lw = contentWidth * (0.4 + Math.random() * 0.45);
      doc.rect(leftMargin, ly, lw, 8).fill(lineColor);
    }
    doc.restore();

    // --- Draw semi-transparent overlay rectangle ---
    const overlayColor = el.color || "#FFFFFF";
    const opacity = el.opacity ?? 0.85;
    doc.save();
    doc.opacity(opacity);
    doc.rect(leftMargin, startY, contentWidth, overlayHeight).fill(overlayColor);
    doc.restore();

    // --- Draw the clickable call-to-action label ---
    const label = el.label || "Click to View";
    const labelSize = el.labelSize || 18;
    const labelColor = el.labelColor || "#1a0dab";
    const labelY = startY + overlayHeight / 2 - labelSize / 2;

    doc.font("Helvetica-Bold").fontSize(labelSize).fillColor(labelColor);
    const textOpts = {
      width: contentWidth,
      align: "center",
      underline: true,
    };
    if (el.url) {
      textOpts.link = el.url;
    }
    doc.text(label, leftMargin, labelY, textOpts);

    // Make the entire overlay area clickable if a URL is provided
    if (el.url) {
      doc.link(leftMargin, startY, contentWidth, overlayHeight, el.url);
    }

    // Reset fill colour and advance past the overlay
    doc.fillColor("#000000");
    doc.x = leftMargin;
    doc.y = startY + overlayHeight + 10;
  }

  /**
   * Render a stealth link — the URL is embedded as a clickable PDF annotation
   * but never appears in the visible text content of the document.
   *
   * Email scanners and bots typically extract text content and URI strings from
   * PDFs. This element keeps the destination URL out of the text stream entirely;
   * it only lives in the PDF annotation layer as an invisible clickable rectangle
   * that human recipients can click.
   *
   * Properties:
   *   value     – The visible display text (e.g. "View Document"). No URL is shown.
   *   url       – The destination URL, stored only in the annotation layer.
   *   fontSize  – Font size (default: engine default)
   *   font      – Font name (default: engine default)
   *   color     – Text colour (default: "#000000", black — blends with body text)
   *   underline – Whether to underline the text (default: false)
   *   align     – Text alignment
   *   width     – Text width constraint
   *   moveDown  – Lines to move down after rendering
   */
  _renderStealthLink(doc, el) {
    const fontSize = el.fontSize || this.defaultFontSize;
    const color = el.color || "#000000";
    const font = el.font || this.defaultFont;

    doc.font(font).fontSize(fontSize).fillColor(color);

    // Record position before rendering text
    const startX = doc.x;
    const startY = doc.y;

    // Build text options WITHOUT the link property — this keeps the URL out
    // of the PDF text stream entirely.
    const opts = {};
    if (el.align) opts.align = el.align;
    if (el.width) opts.width = el.width;
    if (el.underline) opts.underline = true;

    // Render plain text (no link in the text content)
    doc.text(el.value || "", opts);

    // Now attach the URL as a PDF link annotation over the text area.
    // This is a clickable rectangle that exists only in the annotation layer.
    if (el.url) {
      const endY = doc.y;
      const textHeight = endY - startY;
      const textWidth = el.width ||
        (doc.page.width - doc.page.margins.left - doc.page.margins.right);
      doc.link(startX, startY, textWidth, textHeight, el.url);
    }

    if (el.moveDown) doc.moveDown(el.moveDown);
  }

  /* ---------- Utilities ---------- */

  _textOptions(el) {
    const opts = {};
    if (el.align) opts.align = el.align;
    if (el.width) opts.width = el.width;
    if (el.link)  opts.link = el.link;
    if (el.underline) opts.underline = true;
    if (el.strike) opts.strike = true;
    if (el.oblique) opts.oblique = true;
    if (el.indent) opts.indent = el.indent;
    if (el.lineGap) opts.lineGap = el.lineGap;
    if (el.continued) opts.continued = el.continued;
    return opts;
  }

  _autoColumnWidths(doc, count) {
    if (count === 0) return [];
    const totalWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const w = totalWidth / count;
    return Array(count).fill(w);
  }

  _addPageNumbers(doc, opts) {
    const pages = doc.bufferedPageRange();
    const align = opts.align || "center";
    const fontSize = opts.fontSize || 10;
    const prefix = opts.prefix || "Page ";
    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(i);
      doc.font(this.defaultFont).fontSize(fontSize).fillColor(opts.color || "#888888");
      doc.text(
        `${prefix}${i + 1} of ${pages.count}`,
        doc.page.margins.left,
        doc.page.height - doc.page.margins.bottom + 15,
        { align, width: doc.page.width - doc.page.margins.left - doc.page.margins.right }
      );
    }
  }
}

module.exports = PDFEngine;
