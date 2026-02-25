#!/usr/bin/env node

/**
 * CLI entry-point for PDF generation.
 *
 * Usage:
 *   node src/cli.js --template invoice --data invoice-data.json --output invoice.pdf
 *   node src/cli.js --spec raw-spec.json --output custom.pdf
 *   node src/cli.js --html page.html --output page.pdf
 *   node src/cli.js --url https://example.com --output example.pdf
 */

const fs = require("fs");
const path = require("path");
const PDFEngine = require("./engine/pdf-engine");
const HtmlToPdfConverter = require("./engine/html-to-pdf");
const templates = require("./templates");

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--template" || argv[i] === "-t") args.template = argv[++i];
    else if (argv[i] === "--data" || argv[i] === "-d") args.data = argv[++i];
    else if (argv[i] === "--spec" || argv[i] === "-s") args.spec = argv[++i];
    else if (argv[i] === "--html") args.html = argv[++i];
    else if (argv[i] === "--url") args.url = argv[++i];
    else if (argv[i] === "--output" || argv[i] === "-o") args.output = argv[++i];
    else if (argv[i] === "--format") args.format = argv[++i];
    else if (argv[i] === "--help" || argv[i] === "-h") args.help = true;
  }
  return args;
}

function showHelp() {
  console.log(`
PDF Engine CLI
==============

Generate a PDF from a template + data, a raw spec file, an HTML file, or a URL.

Options:
  --template, -t   Template name (invoice, resume, report, contract, certificate, letter)
  --data,     -d   Path to a JSON file with template data
  --spec,     -s   Path to a JSON file with a raw PDFEngine spec (use instead of --template)
  --html           Path to an HTML file to convert to PDF
  --url            URL of a web page to convert to PDF
  --output,   -o   Output PDF file path (default: output.pdf)
  --format         Page format for HTML/URL conversion (default: A4)
  --help,     -h   Show this help message

Examples:
  node src/cli.js --template invoice --data examples/invoice-data.json --output invoice.pdf
  node src/cli.js --spec examples/raw-spec.json --output custom.pdf
  node src/cli.js --html examples/sample-page.html --output page.pdf
  node src/cli.js --url https://example.com --output example.pdf
`);
}

async function main() {
  const args = parseArgs(process.argv);

  if (args.help || (!args.template && !args.spec && !args.html && !args.url)) {
    showHelp();
    process.exit(args.help ? 0 : 1);
  }

  const outputPath = args.output || "output.pdf";

  // --- HTML-to-PDF conversion ---
  if (args.html || args.url) {
    const converter = new HtmlToPdfConverter({
      format: args.format || "A4",
    });

    if (args.html) {
      const htmlPath = path.resolve(args.html);
      const html = fs.readFileSync(htmlPath, "utf-8");
      const result = await converter.convertHtmlToFile(html, outputPath);
      console.log(`✅ PDF generated from HTML: ${result}`);
    } else {
      const result = await converter.convertUrlToFile(args.url, outputPath);
      console.log(`✅ PDF generated from URL: ${result}`);
    }
    return;
  }

  // --- Spec / template-based generation ---
  const engine = new PDFEngine();

  let spec;
  if (args.spec) {
    spec = JSON.parse(fs.readFileSync(path.resolve(args.spec), "utf-8"));
  } else {
    const templateFn = templates[args.template];
    if (!templateFn) {
      console.error(`Unknown template: ${args.template}`);
      console.error(`Available: ${Object.keys(templates).join(", ")}`);
      process.exit(1);
    }
    const dataPath = args.data;
    if (!dataPath) {
      console.error("Please provide --data <json-file> when using --template.");
      process.exit(1);
    }
    const data = JSON.parse(fs.readFileSync(path.resolve(dataPath), "utf-8"));
    spec = templateFn(data);
  }

  const result = await engine.generateToFile(spec, outputPath);
  console.log(`✅ PDF generated: ${result}`);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
