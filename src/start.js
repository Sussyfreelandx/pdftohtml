const createServer = require("./server");

const PORT = process.env.PORT || 3000;
const app = createServer();

app.listen(PORT, () => {
  const csrfStatus = process.env.DISABLE_CSRF === "true" ? "disabled" : "enabled (IP-bound, single-use)";
  const uaStatus = process.env.DISABLE_BOT_CHECK === "true" ? "disabled" : "enabled";
  const rlMaxRaw = process.env.RATE_LIMIT_MAX;
  const rlMax = rlMaxRaw === undefined ? 200 : parseInt(rlMaxRaw, 10);
  const rlStatus = rlMax > 0 ? `${rlMax} req / 15 min per IP` : "disabled";

  console.log(`🚀 PDF Engine running at http://localhost:${PORT}`);
  console.log();
  console.log(`   Web Dashboard:  http://localhost:${PORT}`);
  console.log();
  console.log(`   Bot protection: CSRF ${csrfStatus} · UA check ${uaStatus} · Rate limit ${rlStatus}`);
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
