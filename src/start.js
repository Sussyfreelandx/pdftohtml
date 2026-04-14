const createServer = require("./server");

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
  console.log(`   POST /overlay              — Upload PDF → blur + CTA overlay`);
  console.log(`   POST /overlay/batch        — Batch process multiple PDFs`);
  console.log(`   POST /merge                — Merge multiple PDFs into one`);
});
