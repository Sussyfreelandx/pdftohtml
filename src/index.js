const PDFEngine = require("./engine/pdf-engine");
const HtmlToPdfConverter = require("./engine/html-to-pdf");
const HtmlToImageConverter = require("./engine/html-to-image");
const PdfOverlayEngine = require("./engine/pdf-overlay");
const templates = require("./templates");
const createServer = require("./server");

module.exports = { PDFEngine, HtmlToPdfConverter, HtmlToImageConverter, PdfOverlayEngine, templates, createServer };

// Auto-start the server when this file is run directly (e.g. `node src/index.js`)
// This ensures compatibility with hosts like Render that use the package.json "main" field
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  const app = createServer();

  app.listen(PORT, () => {
    console.log(`🚀 PDF Engine running at http://localhost:${PORT}`);
    console.log();
    console.log(`   Web Dashboard:  http://localhost:${PORT}`);
    console.log();
    console.log("   API endpoints:");
    console.log(`   GET  /health              — Health check`);
    console.log(`   GET  /csrf-token          — Get CSRF token for POST requests`);
    console.log(`   GET  /templates            — List templates`);
    console.log(`   POST /generate             — Generate PDF from raw spec`);
    console.log(`   POST /generate/:template   — Generate PDF from template`);
    console.log(`   POST /convert              — Convert HTML string to PDF`);
    console.log(`   POST /convert/url          — Convert a URL to PDF`);
    console.log(`   POST /convert/image        — Convert HTML string to image (with hotspot map)`);
    console.log(`   POST /convert/image/url    — Convert a URL to image (with hotspot map)`);
    console.log(`   POST /overlay              — Upload PDF → blur + CTA overlay`);
    console.log(`   POST /overlay/batch        — Batch process multiple PDFs`);
    console.log(`   POST /merge                — Merge multiple PDFs into one`);
  });
}
