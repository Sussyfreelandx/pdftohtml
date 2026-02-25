const PDFEngine = require("./engine/pdf-engine");
const HtmlToPdfConverter = require("./engine/html-to-pdf");
const templates = require("./templates");
const createServer = require("./server");

module.exports = { PDFEngine, HtmlToPdfConverter, templates, createServer };

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
    console.log(`   GET  /templates            — List templates`);
    console.log(`   POST /generate             — Generate PDF from raw spec`);
    console.log(`   POST /generate/:template   — Generate PDF from template`);
    console.log(`   POST /convert              — Convert HTML string to PDF`);
    console.log(`   POST /convert/url          — Convert a URL to PDF`);
  });
}
