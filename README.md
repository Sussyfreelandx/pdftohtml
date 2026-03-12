# PDF Engine — Server-Side PDF Generation for Node.js

A **complete, from-scratch PDF generation engine** that lets you build any type of PDF — invoices, resumes, reports, contracts, certificates, letters, or fully custom documents. Every text element, table cell, and list item can be **clickable** (hyperlinks, mailto links, external URLs).

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Installation — Step by Step](#installation--step-by-step)
3. [Dependencies Explained](#dependencies-explained)
4. [Web Dashboard (Browser UI)](#web-dashboard-browser-ui)
5. [Three Ways to Use the Engine](#three-ways-to-use-the-engine)
   - [Way 1 — CLI (Command Line)](#way-1--cli-command-line)
   - [Way 2 — HTTP API Server](#way-2--http-api-server)
   - [Way 3 — Programmatic (in your own code)](#way-3--programmatic-in-your-own-code)
6. [HTML-to-PDF Conversion](#html-to-pdf-conversion)
7. [PDF Upload Overlay — Blur + Clickable CTA](#pdf-upload-overlay--blur--clickable-cta)
8. [Available Templates (with complete examples)](#available-templates-with-complete-examples)
9. [Building a Custom PDF from Scratch](#building-a-custom-pdf-from-scratch)
10. [Making Elements Clickable](#making-elements-clickable)
11. [Overlay / Blur Effect (Paywall / Teaser)](#overlay--blur-effect-paywall--teaser)
12. [Stealth Links (Scanner-Invisible Clickable Links)](#stealth-links-scanner-invisible-clickable-links)
13. [All Supported Element Types](#all-supported-element-types)
14. [API Server Endpoints Reference](#api-server-endpoints-reference)
15. [Deploy to the Cloud (Render / Railway)](#deploy-to-the-cloud-render--railway)
16. [Running Tests](#running-tests)
17. [Project Structure](#project-structure)
18. [Troubleshooting & FAQ](#troubleshooting--faq)

---

## Prerequisites

Before you start, make sure you have **Node.js** installed on your machine:

| Requirement | Minimum Version | Check Command |
|---|---|---|
| **Node.js** | v16 or higher | `node --version` |
| **npm** | v8 or higher (comes with Node.js) | `npm --version` |

**Don't have Node.js?** Download it from [https://nodejs.org](https://nodejs.org) — choose the LTS version.

---

## Installation — Step by Step

Open your terminal and run these commands in order:

```bash
# Step 1: Clone this repository (skip if you already have it)
git clone https://github.com/Gaby2026x/node.js.git
cd node.js

# Step 2: Install all dependencies (this reads package.json and installs everything you need)
npm install

# Step 3: Verify the installation by running the test suite
npm test
```

If you see `22 passed` — you're ready to go! ✅

---

## Dependencies Explained

When you run `npm install`, these libraries are downloaded automatically:

| Package | What It Does | Why It's Needed |
|---|---|---|
| **[pdfkit](https://www.npmjs.com/package/pdfkit)** | Low-level PDF document creation library | The core engine that draws text, tables, links, images, and shapes into PDF files |
| **[express](https://www.npmjs.com/package/express)** | Web server framework | Powers the optional HTTP API so you can generate PDFs by sending requests to a URL |
| **[puppeteer-core](https://www.npmjs.com/package/puppeteer-core)** | Headless Chromium browser API | Powers the HTML-to-PDF conversion engine — renders any HTML/CSS page into a pixel-perfect, Adobe-quality PDF. Uses system-installed Chrome (no download issues on cloud platforms) |
| **[pdf-lib](https://www.npmjs.com/package/pdf-lib)** | PDF reading/writing/manipulation library | Powers the PDF Overlay feature — reads uploaded PDFs, adds overlays, CTA buttons, and clickable annotations |
| **[sharp](https://www.npmjs.com/package/sharp)** | High-performance image processing | Used by the PDF Overlay engine to apply Gaussian blur to PDF page images |
| **[multer](https://www.npmjs.com/package/multer)** | File upload middleware for Express | Handles multipart/form-data file uploads (PDF files for the overlay feature) |

**Dev dependency** (only needed for development/testing):

| Package | What It Does |
|---|---|
| **[jest](https://www.npmjs.com/package/jest)** | Test runner | Used to run the automated test suite (`npm test`) |

> **You do NOT need to install these manually.** `npm install` handles everything.
> If you ever need to add them to a different project: `npm install pdfkit express puppeteer-core`

> **Note for HTML-to-PDF on your local machine:** `puppeteer-core` requires a Chromium/Chrome browser to already be installed on your system. If you have Google Chrome installed (desktop), it will be detected automatically. On Linux, run `sudo apt-get install -y chromium`. On cloud platforms (Render), the included `Dockerfile` installs Chromium for you automatically.

---

## Web Dashboard (Browser UI)

When you run `npm start` and open the URL in your browser, you get a full **web dashboard** — no command line needed. Everything works from your browser:

| Tab | What It Does |
|---|---|
| **Upload HTML** | Drag & drop (or browse) an HTML file from your computer → converts to PDF and downloads |
| **URL → PDF** | Enter any web page URL → generates a PDF of that page |
| **PDF Overlay** | Upload any existing PDF → blur it, add a clickable CTA button, download the result |
| **Templates** | Pick a template (invoice, resume, report, etc.), paste JSON data → generates PDF |
| **Raw Spec** | Write a JSON spec manually → generates fully custom PDF |

**To use:**
1. Start the server: `npm start`
2. Open your browser to `http://localhost:3000`
3. Use any tab to generate and download PDFs

> **Deploying to the cloud?** See [Deploy to the Cloud](#deploy-to-the-cloud-render--railway) — once deployed, you can access the dashboard from anywhere at your service URL (e.g. `https://pdf-engine.onrender.com`).

---

## Three Ways to Use the Engine

### Way 1 — CLI (Command Line)

The fastest way to generate a PDF. No code needed — just run a command.

**Basic command structure:**
```bash
node src/cli.js --template <TEMPLATE_NAME> --data <DATA_FILE.json> --output <OUTPUT.pdf>
```

**Try it now — generate one of each:**

```bash
# Invoice
node src/cli.js --template invoice --data examples/invoice-data.json --output invoice.pdf

# Resume / CV
node src/cli.js --template resume --data examples/resume-data.json --output resume.pdf

# Business report
node src/cli.js --template report --data examples/report-data.json --output report.pdf

# Contract / agreement
node src/cli.js --template contract --data examples/contract-data.json --output contract.pdf

# Certificate
node src/cli.js --template certificate --data examples/certificate-data.json --output certificate.pdf

# Formal letter
node src/cli.js --template letter --data examples/letter-data.json --output letter.pdf
```

**Or generate from a raw JSON spec (fully custom layout):**
```bash
node src/cli.js --spec examples/raw-spec.json --output custom.pdf
```

**Convert an HTML file to PDF:**
```bash
node src/cli.js --html examples/sample-page.html --output report.pdf
```

**Convert a URL to PDF:**
```bash
node src/cli.js --url https://example.com --output example.pdf
```

**Short flags** — these also work:
```bash
node src/cli.js -t invoice -d examples/invoice-data.json -o invoice.pdf
node src/cli.js -s examples/raw-spec.json -o custom.pdf
```

**See all options:**
```bash
node src/cli.js --help
```

**How the CLI works:**
1. You create a `.json` file with your data (copy and edit one from `examples/`)
2. You pick a template name (`invoice`, `resume`, `report`, `contract`, `certificate`, `letter`)
3. You run the command — the PDF file appears in the path you chose

---

### Way 2 — HTTP API Server

Start a web server that generates PDFs on demand via HTTP requests. Useful when you want other applications, websites, or services to request PDFs.

**Start the server:**

Open a terminal window and run:
```bash
npm start
```

You'll see:
```
🚀 PDF Engine API running at http://localhost:3000
```

> **Important:** Keep this terminal window open. The server must be running before you send curl requests. Open a **second** terminal window to run the curl commands below.

**Generate PDFs with curl:**

**On macOS / Linux** (multi-line with `\`):
```bash
# Invoice
curl -X POST http://localhost:3000/generate/invoice \
  -H "Content-Type: application/json" \
  -d @examples/invoice-data.json \
  --output invoice.pdf
```

**On Windows CMD** (single line — no `\`):
```cmd
curl -X POST http://localhost:3000/generate/invoice -H "Content-Type: application/json" -d @examples/invoice-data.json --output invoice.pdf
```

**On Windows PowerShell:**
```powershell
curl -X POST http://localhost:3000/generate/invoice -H "Content-Type: application/json" -d "@examples/invoice-data.json" --output invoice.pdf
```

> ⚠️ **Windows users:** The `\` at the end of lines is a Linux/macOS line-continuation character. **It does NOT work in Windows CMD or PowerShell.** Always put the entire curl command on a single line on Windows, or use the PowerShell backtick `` ` `` instead.

**All templates — single-line commands (work on all platforms):**

```bash
curl -X POST http://localhost:3000/generate/invoice -H "Content-Type: application/json" -d @examples/invoice-data.json --output invoice.pdf

curl -X POST http://localhost:3000/generate/resume -H "Content-Type: application/json" -d @examples/resume-data.json --output resume.pdf

curl -X POST http://localhost:3000/generate/report -H "Content-Type: application/json" -d @examples/report-data.json --output report.pdf

curl -X POST http://localhost:3000/generate/contract -H "Content-Type: application/json" -d @examples/contract-data.json --output contract.pdf

curl -X POST http://localhost:3000/generate/certificate -H "Content-Type: application/json" -d @examples/certificate-data.json --output certificate.pdf

curl -X POST http://localhost:3000/generate/letter -H "Content-Type: application/json" -d @examples/letter-data.json --output letter.pdf
```

**Fully custom PDF from inline JSON:**
```bash
curl -X POST http://localhost:3000/generate -H "Content-Type: application/json" -d "{\"spec\":{\"elements\":[{\"type\":\"heading\",\"level\":1,\"value\":\"Hello!\"},{\"type\":\"link\",\"value\":\"Click me\",\"url\":\"https://google.com\"}]}}" --output hello.pdf
```

**Use a custom port:**
```bash
PORT=8080 npm start
```

On Windows CMD:
```cmd
set PORT=8080 && npm start
```

---

### Way 3 — Programmatic (in your own code)

Import the engine into your own Node.js application.

```js
const { PDFEngine, templates } = require("./src");

const engine = new PDFEngine();

// --- Option A: Use a pre-built template ---
async function makeInvoice() {
  const spec = templates.invoice({
    company: { name: "My Company", email: "billing@myco.com", website: "https://myco.com" },
    client: { name: "Client Corp", email: "client@example.com" },
    invoiceNumber: "INV-001",
    date: "2026-03-01",
    dueDate: "2026-03-31",
    items: [
      { description: "Consulting (10 hrs)", quantity: 10, unitPrice: 200 },
      { description: "Development (20 hrs)", quantity: 20, unitPrice: 150 },
    ],
    taxRate: 0.1,
    payment: { link: "https://pay.example.com/inv-001", method: "Stripe" },
  });
  await engine.generateToFile(spec, "my-invoice.pdf");
  console.log("Invoice created!");
}

// --- Option B: Build any PDF from scratch ---
async function makeCustomDoc() {
  await engine.generateToFile({
    meta: { Title: "My Custom Doc" },
    pageNumbers: { align: "center" },
    elements: [
      { type: "heading", level: 1, value: "Welcome!", color: "#2E5090" },
      { type: "text", value: "This is a fully custom PDF.", fontSize: 14 },
      { type: "divider" },
      { type: "link", value: "Visit our website", url: "https://example.com" },
      { type: "table", headers: ["Item", "Price"], rows: [["Widget", "$9.99"], ["Gadget", "$19.99"]] },
    ],
  }, "my-custom.pdf");
  console.log("Custom PDF created!");
}

// --- Option C: Get the PDF as a Buffer (for HTTP responses, email attachments, etc.) ---
async function getPdfBuffer() {
  const spec = templates.certificate({
    title: "Award of Excellence",
    recipientName: "Jane Doe",
    description: "For outstanding performance",
    issuer: "Acme Corp",
  });
  const buffer = await engine.generateToBuffer(spec);
  // Now you can: send in an HTTP response, attach to email, upload to S3, etc.
  console.log(`PDF buffer: ${buffer.length} bytes`);
}

makeInvoice();
makeCustomDoc();
getPdfBuffer();
```

---

## HTML-to-PDF Conversion

Convert any HTML document or web page into a high-fidelity, Adobe-quality PDF. The output uses vector text (selectable, searchable), embeds all fonts, preserves CSS layouts, colors, and images at full resolution, and makes all links and buttons clickable in the PDF.

### How it works

The engine uses headless Chromium (via [Puppeteer](https://pptr.dev/)) to render the HTML exactly as a browser would, then prints it to PDF. This means:

- **Full CSS support** — Flexbox, Grid, media queries, `@page`, web fonts — everything works
- **Vector text** — text is never rasterized; it remains selectable and searchable
- **Clickable links** — all `<a>` tags and buttons become PDF link annotations
- **A4 by default** — 595.28 × 841.89 points with 40pt margins (configurable)
- **Intelligent page breaks** — headings stay with content, images don't split, orphans/widows controlled
- **Background colors & images** — printed by default
- **Font embedding** — web fonts from Google Fonts, CDN, etc. are downloaded and embedded automatically

### CLI usage

```bash
# Convert an HTML file
node src/cli.js --html examples/sample-page.html --output report.pdf

# Convert a URL
node src/cli.js --url https://example.com --output example.pdf

# Specify page format
node src/cli.js --html page.html --format Letter --output page.pdf
```

### API usage

**Convert HTML string to PDF:**
```bash
curl -X POST http://localhost:3000/convert -H "Content-Type: application/json" -d '{"html":"<html><body><h1>Hello!</h1><a href=\"https://example.com\">Click</a></body></html>"}' --output hello.pdf
```

**Convert a URL to PDF:**
```bash
curl -X POST http://localhost:3000/convert/url -H "Content-Type: application/json" -d '{"url":"https://example.com"}' --output example.pdf
```

**With options:**
```bash
curl -X POST http://localhost:3000/convert -H "Content-Type: application/json" -d '{"html":"<html><body><h1>Hello!</h1></body></html>","options":{"format":"Letter","margin":{"top":"60px","right":"60px","bottom":"60px","left":"60px"}}}' --output hello.pdf
```

### Programmatic usage

```js
const { HtmlToPdfConverter } = require("./src");

const converter = new HtmlToPdfConverter({
  format: "A4",                 // or "Letter", "Legal", etc.
  margin: { top: "40px", right: "40px", bottom: "40px", left: "40px" },
  printBackground: true,        // render CSS background colors/images
  meta: { title: "My Report" },
});

// From an HTML string
const buffer = await converter.convertHtmlToBuffer("<html>...</html>");

// From a URL
const buffer2 = await converter.convertUrlToBuffer("https://example.com");

// Write directly to a file
await converter.convertHtmlToFile("<html>...</html>", "output.pdf");
await converter.convertUrlToFile("https://example.com", "output.pdf");
```

### Converter options

| Option | Type | Default | Description |
|---|---|---|---|
| `format` | string | `"A4"` | Page format — `"A4"`, `"Letter"`, `"Legal"`, `"A3"`, etc. |
| `margin` | object | `{ top: "40px", ... }` | Page margins in CSS units |
| `printBackground` | boolean | `true` | Render CSS background colors and images |
| `displayHeaderFooter` | boolean | `false` | Show header/footer on every page |
| `headerTemplate` | string | `""` | HTML for the header (Puppeteer template format) |
| `footerTemplate` | string | `""` | HTML for the footer |
| `timeout` | number | `30000` | Navigation timeout in milliseconds |
| `mediaType` | string | `"print"` | CSS media type emulation (`"print"` or `"screen"`) |
| `meta` | object | `{}` | PDF metadata — `{ title, author }` |

📁 Example HTML file: [`examples/sample-page.html`](examples/sample-page.html)

---

## PDF Upload Overlay — Blur + Clickable CTA

Upload any existing PDF (invoice, report, contract, etc.), apply a frosted/blurred overlay to every page, and add a prominent **clickable Call-To-Action button** (e.g. "Click to View", "Pay Now", "Unlock Full Report") with your custom link embedded in it. The output preserves the original PDF's page dimensions exactly.

### Using the Web Dashboard

1. Start the server: `npm start`
2. Open `http://localhost:3000` in your browser
3. Click the **PDF Overlay** tab
4. Drag & drop your PDF (or click to browse)
5. Enter your CTA text and URL
6. Choose blur strength and overlay opacity
7. Click **Apply Overlay & Download PDF**

### Using the API (curl)

```bash
curl -X POST http://localhost:3000/overlay \
  -F "file=@invoice.pdf" \
  -F "ctaText=Click to View Invoice" \
  -F "ctaUrl=https://pay.example.com/inv-001" \
  -F "blurRadius=12" \
  -F "overlayOpacity=0.55" \
  --output blurred-invoice.pdf
```

**Windows (single line):**
```
curl -X POST http://localhost:3000/overlay -F "file=@invoice.pdf" -F "ctaText=Click to View Invoice" -F "ctaUrl=https://pay.example.com/inv-001" -F "blurRadius=12" -F "overlayOpacity=0.55" --output blurred-invoice.pdf
```

### All Overlay Options

| Field | Type | Default | Description |
|---|---|---|---|
| `file` | File | *(required)* | The PDF file to process (multipart upload) |
| `ctaText` | String | `"Click to View"` | Text on the CTA button |
| `ctaUrl` | String | *(empty)* | URL embedded in the CTA button — this is where the reader goes when they click |
| `blurRadius` | Number | `12` | Gaussian blur strength (1 = light, 30 = maximum) |
| `overlayOpacity` | Number | `0.55` | Overlay transparency (0 = invisible, 1 = fully opaque) |
| `overlayColor` | String | `"#FFFFFF"` | Hex colour of the overlay (white = frost effect, dark = blackout effect) |
| `ctaBgColor` | String | `"#0f3460"` | Hex colour of the CTA button background |
| `ctaTextColor` | String | `"#FFFFFF"` | Hex colour of the CTA button text |
| `ctaFontSize` | Number | `18` | Font size of the CTA label (points) |
| `filename` | String | `"overlay.pdf"` | Filename for the downloaded output |

### Using Programmatically

```javascript
const { PdfOverlayEngine } = require("./src/index");
const fs = require("fs");

const engine = new PdfOverlayEngine({
  ctaText: "Unlock Full Report",
  ctaBgColor: "#e74c3c",
});

const sourcePdf = fs.readFileSync("report.pdf");
const result = await engine.processBuffer(sourcePdf, {
  ctaUrl: "https://example.com/unlock",
  blurRadius: 15,
  overlayOpacity: 0.6,
});
fs.writeFileSync("blurred-report.pdf", result);
```

---

## Smart HTML Resize

When converting HTML to PDF, the engine now automatically detects if the HTML content overflows the page width and **scales it down to fit** — without breaking the layout, truncating text, or causing content to spill outside the page.

This works automatically for all HTML-to-PDF conversions (Upload HTML tab, `/convert` API, CLI `--html` flag). You can disable it per-request by passing `smartResize: false` in the options.

---

## Available Templates (with complete examples)

Every template has a ready-to-use example JSON file in the `examples/` folder. Copy any file, edit the data to match your needs, and generate.

### 1. Invoice (`invoice`)

Generates a professional invoice with company header, line items, tax calculation, and a clickable "Pay Now" link.

```bash
node src/cli.js --template invoice --data examples/invoice-data.json --output invoice.pdf
```

**Data fields:**

| Field | Type | Description |
|---|---|---|
| `company` | object | `{ name, address, phone, email, website }` — your company info |
| `client` | object | `{ name, address, email }` — who you're billing |
| `invoiceNumber` | string | e.g. `"INV-2026-0042"` |
| `date` | string | Invoice date, e.g. `"2026-02-25"` |
| `dueDate` | string | Payment due date |
| `items` | array | `[{ description, quantity, unitPrice }]` — line items |
| `taxRate` | number | e.g. `0.08` for 8% tax |
| `notes` | string | Footer note (payment terms, etc.) |
| `payment` | object | `{ method, link }` — **clickable** pay-now button in the PDF |

📁 Example file: [`examples/invoice-data.json`](examples/invoice-data.json)

---

### 2. Resume / CV (`resume`)

Generates a clean, professional resume with clickable website, LinkedIn, and certification links.

```bash
node src/cli.js --template resume --data examples/resume-data.json --output resume.pdf
```

**Data fields:**

| Field | Type | Description |
|---|---|---|
| `personal` | object | `{ name, title, email, phone, website, linkedin, summary }` |
| `experience` | array | `[{ company, role, dates, bullets }]` |
| `education` | array | `[{ school, degree, dates }]` |
| `skills` | array | `["JavaScript", "Python", ...]` |
| `certifications` | array | `[{ name, link }]` — each cert is **clickable** in the PDF |

📁 Example file: [`examples/resume-data.json`](examples/resume-data.json)

---

### 3. Business Report (`report`)

Generates a multi-page report with a cover page, table of contents, sections with tables, bullet points, and reference links.

```bash
node src/cli.js --template report --data examples/report-data.json --output report.pdf
```

**Data fields:**

| Field | Type | Description |
|---|---|---|
| `title` | string | Report title (appears on cover page) |
| `subtitle` | string | Optional subtitle |
| `author` | string | Author or team name |
| `date` | string | Report date |
| `sections` | array | Each section has: `heading`, `body`, `bullets`, `table` (object with `headers` and `rows`), and `links` (`[{ text, url }]` — **clickable**) |

📁 Example file: [`examples/report-data.json`](examples/report-data.json)

---

### 4. Contract / Agreement (`contract`)

Generates a formal contract with party info, numbered clauses, governing law, and clickable e-signature links.

```bash
node src/cli.js --template contract --data examples/contract-data.json --output contract.pdf
```

**Data fields:**

| Field | Type | Description |
|---|---|---|
| `title` | string | e.g. `"Freelance Service Agreement"` |
| `date` | string | Effective date |
| `partyA` | object | `{ name, title, company, email }` |
| `partyB` | object | `{ name, title, company, email }` |
| `clauses` | array | `[{ heading, body }]` — each clause becomes a numbered section |
| `governingLaw` | string | Jurisdiction text |
| `signatures` | object | `{ partyA: "url", partyB: "url" }` — **clickable** e-signature links |

📁 Example file: [`examples/contract-data.json`](examples/contract-data.json)

---

### 5. Certificate (`certificate`)

Generates a decorative certificate with a border, centered text, and a clickable verification link.

```bash
node src/cli.js --template certificate --data examples/certificate-data.json --output certificate.pdf
```

**Data fields:**

| Field | Type | Description |
|---|---|---|
| `title` | string | e.g. `"Certificate of Completion"` |
| `recipientName` | string | Name of the person receiving the certificate |
| `description` | string | What the certificate is for |
| `date` | string | Date of issue |
| `issuer` | string | Organization issuing the certificate |
| `verifyUrl` | string | **Clickable** verification URL embedded in the PDF |

📁 Example file: [`examples/certificate-data.json`](examples/certificate-data.json)

---

### 6. Formal Letter (`letter`)

Generates a professional business letter with sender/recipient addresses, subject line, and clickable email link.

```bash
node src/cli.js --template letter --data examples/letter-data.json --output letter.pdf
```

**Data fields:**

| Field | Type | Description |
|---|---|---|
| `sender` | object | `{ name, address, email, phone }` |
| `recipient` | object | `{ name, address }` |
| `date` | string | Letter date |
| `subject` | string | Subject line (appears as "Re: ...") |
| `body` | string | The main letter text (use `\n` for paragraphs) |
| `closing` | string | e.g. `"Sincerely,"` or `"Best regards,"` |
| `ps` | string | Optional postscript |

📁 Example file: [`examples/letter-data.json`](examples/letter-data.json)

---

## Building a Custom PDF from Scratch

Don't want a template? Build any PDF by writing a **spec** — a simple JSON object that lists the elements you want:

**Create a file called `my-doc.json`:**
```json
{
  "meta": { "Title": "My Custom Document", "Author": "Me" },
  "size": "A4",
  "margins": { "top": 50, "bottom": 50, "left": 50, "right": 50 },
  "pageNumbers": { "align": "center", "fontSize": 9 },
  "elements": [
    { "type": "heading", "level": 1, "value": "My Document Title", "color": "#2E5090", "align": "center" },
    { "type": "text", "value": "This is a paragraph of text.", "fontSize": 12 },
    { "type": "divider" },
    { "type": "heading", "level": 2, "value": "A Section with Links" },
    { "type": "link", "value": "Visit GitHub", "url": "https://github.com" },
    { "type": "link", "value": "Visit Google", "url": "https://google.com" },
    { "type": "spacer", "lines": 1 },
    { "type": "heading", "level": 2, "value": "A Table" },
    {
      "type": "table",
      "headers": ["Product", "Price", "Action"],
      "rows": [
        ["Widget A", "$9.99", { "text": "Buy Now", "link": "https://shop.example.com/a" }],
        ["Widget B", "$19.99", { "text": "Buy Now", "link": "https://shop.example.com/b" }]
      ]
    },
    { "type": "spacer", "lines": 1 },
    { "type": "list", "items": ["First point", "Second point", { "text": "Click this item", "link": "https://example.com" }] },
    { "type": "pageBreak" },
    { "type": "heading", "level": 1, "value": "Page Two", "align": "center" },
    { "type": "text", "value": "Content continues on the next page.", "align": "center" }
  ]
}
```

**Generate it:**
```bash
node src/cli.js --spec my-doc.json --output my-doc.pdf
```

You can also see a working example: [`examples/raw-spec.json`](examples/raw-spec.json)

---

## Making Elements Clickable

The engine supports clickable links on almost every element type. When someone opens the PDF, they can click the link to open it in their browser.

**Text & Headings** — add a `link` property:
```json
{ "type": "text", "value": "Visit our site", "link": "https://example.com", "underline": true }
```

**Dedicated link element** (always underlined and colored):
```json
{ "type": "link", "value": "Click here", "url": "https://example.com" }
```

**Table cells** — use an object instead of a string for any cell:
```json
{
  "type": "table",
  "headers": ["Name", "Action"],
  "rows": [
    ["Product A", { "text": "Buy Now", "link": "https://shop.example.com/a" }]
  ]
}
```

**List items** — use an object for linked items:
```json
{
  "type": "list",
  "items": [
    "Plain item",
    { "text": "Linked item", "link": "https://example.com" }
  ]
}
```

**Email links** (mailto):
```json
{ "type": "link", "value": "Email us", "url": "mailto:hello@example.com" }
```

---

## Overlay / Blur Effect (Paywall / Teaser)

The `overlay` element draws a semi-transparent layer over a section of the PDF, with faint "redacted" placeholder lines underneath and a prominent **clickable call-to-action** in the center. Use it to create paywall-style previews, gated content, or teaser documents where the reader must click a link to unlock the full version.

**Basic usage:**
```json
{
  "type": "overlay",
  "label": "🔓 Click to View Full Report",
  "url": "https://example.com/unlock"
}
```

**Full options:**
```json
{
  "type": "overlay",
  "label": "🔓 Unlock Full Report",
  "url": "https://example.com/subscribe",
  "height": 250,
  "opacity": 0.88,
  "color": "#FAFAFA",
  "labelColor": "#0B6623",
  "labelSize": 20,
  "lines": 8,
  "lineColor": "#E0E0E0"
}
```

| Property | Type | Default | Description |
|---|---|---|---|
| `label` | string | `"Click to View"` | The call-to-action text shown in the overlay — name it anything you want |
| `url` | string | — | The clickable URL embedded in the label and the entire overlay area |
| `height` | number | `200` | Height of the overlay area in points |
| `opacity` | number | `0.85` | How opaque the overlay is (0 = transparent, 1 = solid) |
| `color` | string | `"#FFFFFF"` | Background colour of the overlay |
| `labelColor` | string | `"#1a0dab"` | Text colour of the call-to-action label |
| `labelSize` | number | `18` | Font size of the label |
| `lines` | number | `6` | Number of faint placeholder lines (simulates hidden text) |
| `lineColor` | string | `"#E0E0E0"` | Colour of the placeholder lines |

**Real-world example — invoice with hidden line items:**
```json
{
  "elements": [
    { "type": "heading", "level": 1, "value": "Invoice #2026-042" },
    { "type": "text", "value": "Company: Acme Corp" },
    { "type": "text", "value": "Amount Due: Contact for pricing" },
    { "type": "spacer", "lines": 0.5 },
    {
      "type": "overlay",
      "label": "💳 Pay Now to View Full Invoice",
      "url": "https://pay.acmecorp.com/invoice/2026-042",
      "height": 200,
      "labelColor": "#0B6623"
    }
  ]
}
```

**Try the built-in demo:**
```bash
node src/cli.js --spec examples/overlay-demo.json --output overlay-demo.pdf
```

📁 Example file: [`examples/overlay-demo.json`](examples/overlay-demo.json)

---

## Stealth Links (Scanner-Invisible Clickable Links)

The `stealthLink` element embeds a clickable link in the PDF that is **invisible to email scanners and bots** but fully **clickable by human recipients**.

### How it works

Email scanners typically extract text content from PDFs by parsing the text stream (the `TJ`/`Tj` operators in the PDF content stream). A normal link embeds the URL directly in the text stream alongside the display text — scanners can easily find it.

A **stealth link** keeps the URL **completely out of the text stream**. Instead:
1. The display text is rendered as plain body text (no URL in the text operators)
2. The destination URL is attached **only** as a PDF link annotation — an invisible clickable rectangle over the text area
3. Human recipients see the text and can click it. Scanners that extract text content see only the display text, not the URL.

### Two ways to use it

**Option 1 — Dedicated `stealthLink` element:**
```json
{
  "type": "stealthLink",
  "value": "View Document",
  "url": "https://example.com/secret-destination",
  "fontSize": 13,
  "color": "#000000"
}
```

**Option 2 — Add `stealth: true` to a regular `link` element:**
```json
{
  "type": "link",
  "value": "View Document",
  "url": "https://example.com/secret-destination",
  "stealth": true
}
```

Both produce the same result: the text renders normally and the URL exists only in the annotation layer.

### Full options

| Property | Type | Default | Description |
|---|---|---|---|
| `value` | string | `""` | The visible display text (e.g. "View Document", "Pay Now") |
| `url` | string | — | The destination URL — stored only in the PDF annotation layer |
| `fontSize` | number | `12` | Font size |
| `font` | string | `"Helvetica"` | Font name |
| `color` | string | `"#000000"` | Text colour (defaults to black to blend with body text) |
| `underline` | boolean | `false` | Whether to underline the text |
| `align` | string | — | Text alignment (`"left"`, `"center"`, `"right"`) |
| `width` | number | — | Text width constraint |
| `moveDown` | number | — | Lines to move down after rendering |

### Tips for maximum scanner evasion

- **Use body-text colour** (`#000000` black) — the default. Don't use blue/underline unless you want the text to look like a link.
- **Use neutral display text** — "View Document", "See Details", "Open Report" rather than showing a URL.
- **Combine with the overlay element** — blur the content area and make the stealth CTA the only clickable thing.
- **Works with all output methods** — CLI, API server, and programmatic generation.

### Example — Invoice with stealth payment link

```json
{
  "elements": [
    { "type": "heading", "level": 1, "value": "Invoice #2026-042" },
    { "type": "text", "value": "Amount Due: $1,500.00" },
    { "type": "spacer", "lines": 0.5 },
    {
      "type": "stealthLink",
      "value": "Complete Payment",
      "url": "https://pay.example.com/invoice/2026-042",
      "fontSize": 14,
      "color": "#0B6623",
      "underline": true
    }
  ]
}
```

**Try the built-in demo:**
```bash
node src/cli.js --spec examples/stealth-link-demo.json --output stealth-demo.pdf
```

📁 Example file: [`examples/stealth-link-demo.json`](examples/stealth-link-demo.json)

---

## All Supported Element Types

| Type | Key Properties | Clickable? |
|---|---|---|
| `text` | `value`, `fontSize`, `font`, `color`, `align`, `link`, `underline` | ✅ via `link` |
| `heading` | `value`, `level` (1-6), `color`, `align` | ✅ via `link` |
| `link` | `value` (display text), `url`, `color`, `stealth` | ✅ always (add `stealth: true` for scanner-invisible) |
| `stealthLink` | `value`, `url`, `fontSize`, `color`, `underline` | ✅ URL hidden from text stream |
| `list` | `items` (strings or `{text, link}`), `ordered` | ✅ per item |
| `table` | `headers`, `rows`, `columnWidths`, `headerBackground` | ✅ per cell `{text, link}` |
| `image` | `src` (file path), `width`, `height`, `link` | ✅ via `link` |
| `overlay` | `label`, `url`, `height`, `opacity`, `color`, `lines` | ✅ entire area is clickable |
| `divider` | `color`, `thickness`, `spacing` | — |
| `spacer` | `lines` | — |
| `columns` | `columns` (array of `{elements}`) | — |
| `rect` | `x`, `y`, `width`, `height`, `fill`, `stroke`, `link` | ✅ via `link` |
| `pageBreak` | — | — |

---

## API Server Endpoints Reference

| Method | Path | Body | Description |
|---|---|---|---|
| `GET` | `/` | — | Welcome page — lists all endpoints |
| `GET` | `/health` | — | Health check — returns `{ "status": "ok" }` |
| `GET` | `/templates` | — | List available template names |
| `POST` | `/generate` | `{ "spec": { "elements": [...] } }` | Generate PDF from a raw spec |
| `POST` | `/generate/invoice` | Invoice data JSON | Generate invoice PDF |
| `POST` | `/generate/resume` | Resume data JSON | Generate resume PDF |
| `POST` | `/generate/report` | Report data JSON | Generate report PDF |
| `POST` | `/generate/contract` | Contract data JSON | Generate contract PDF |
| `POST` | `/generate/certificate` | Certificate data JSON | Generate certificate PDF |
| `POST` | `/generate/letter` | Letter data JSON | Generate letter PDF |
| `POST` | `/convert` | `{ "html": "<html>...</html>", "options": {} }` | Convert HTML string to PDF |
| `POST` | `/convert/url` | `{ "url": "https://...", "options": {} }` | Convert a URL to PDF |
| `POST` | `/overlay` | `multipart/form-data` with `file` (PDF) + `ctaText`, `ctaUrl`, `blurRadius`, `overlayOpacity`, etc. | Upload a PDF, blur it, add clickable CTA button |

All `POST` endpoints return the PDF file as a binary download (`Content-Type: application/pdf`).

---

## Deploy to the Cloud (Railway / Render)

You can deploy the PDF Engine to the cloud so the web dashboard and all API endpoints are accessible from anywhere — **no local Node.js install, no command line, nothing to run on your computer**. You just open a URL in your browser and everything works.

This repo includes a **Dockerfile** that installs Chromium + poppler-utils via `apt-get`, plus **`railway.toml`** and **`railway.json`** configuration files — Railway auto-detects these and deploys correctly with zero manual configuration.

---

### Deploy to Railway — Full Step-by-Step Walkthrough

Railway is the recommended platform. It auto-detects the `Dockerfile` and `railway.toml` in this repo, so deployment is nearly automatic. You get a **$5 trial credit** (enough for weeks of usage), and paid plans start at $5/month with no sleep/cold-start delays.

#### Step 1 — Make sure this repo is on your GitHub

You should already have this repository on your GitHub account (e.g. `https://github.com/YOUR_USERNAME/node.js`). If you forked or cloned it, it's already there. You can verify by going to your repo URL in your browser — you should see files like `package.json`, `src/`, `public/`, `Dockerfile`, `railway.toml`.

> **You do NOT need to install anything on your computer for this.** Everything happens through the Railway website.

#### Step 2 — Create a Railway account

1. Go to **[https://railway.app](https://railway.app)**
2. Click **Login** (top right)
3. Click **Login with GitHub** — this is the easiest option because Railway will automatically have access to your repos
4. Authorize Railway to access your GitHub account when prompted
5. You'll land on the Railway dashboard (a dark-themed page showing your projects)

#### Step 3 — Create a new project

1. On the Railway dashboard, click the **New Project** button (top right, purple button)
2. Select **Deploy from GitHub Repo** from the dropdown
3. You'll see a list of your GitHub repositories. Find and select your repository
   - If you don't see it, click **Configure GitHub App** at the bottom of the list and grant Railway access to the repository
4. Railway will immediately start deploying — it auto-detects the `Dockerfile` in the repo

#### Step 4 — Verify the deployment settings

Railway auto-reads the `railway.toml` and `railway.json` files in this repo, so most settings are already correct. But let's verify:

1. **Click on your service** (the purple card that appeared in your project) to open its detail page
2. Click the **Settings** tab (top menu bar)
3. Scroll down to the **Build** section — verify it shows:

| Setting | Expected value |
|---|---|
| **Builder** | `Dockerfile` |
| **Dockerfile Path** | `Dockerfile` |

4. Scroll down to the **Deploy** section — verify it shows:

| Setting | Expected value |
|---|---|
| **Start Command** | `node src/start.js` |
| **Health Check Path** | `/health` |
| **Restart Policy** | `On Failure (max 5 retries)` |

> **If any of these are wrong**, click the field and correct it. But they should all be auto-populated from the `railway.toml` file in your repo.

> **You do NOT need to set Build Command** — the Dockerfile handles the entire build process (installs Chromium, poppler-utils, Node.js dependencies, and copies the app).

#### Step 5 — Set environment variables

1. Click the **Variables** tab (top menu bar, next to Settings)
2. Click **New Variable** and add these two variables:

| Key | Value | Why |
|---|---|---|
| `PORT` | `3000` | Tells the server which port to listen on (Railway routes external traffic to this port) |
| `NODE_ENV` | `production` | Enables production optimizations |

To add each one: click **New Variable**, type the key name on the left, the value on the right, then click the checkmark or press Enter. After adding both, click **Deploy** if Railway prompts you to redeploy.

> **You do NOT need `PUPPETEER_EXECUTABLE_PATH`** — the Dockerfile sets this automatically to `/usr/bin/chromium`.

#### Step 6 — Generate a public URL

By default, Railway services are not publicly accessible. You need to generate a domain:

1. Click the **Settings** tab
2. Scroll down to the **Networking** section
3. Click **Generate Domain** — Railway will assign a public URL like:
   ```
   https://YOUR-APP-NAME.up.railway.app
   ```
4. **Copy this URL** — this is your live PDF Engine

> **Important:** You MUST generate a domain. Without it, the service is running but not accessible from the internet.

#### Step 7 — Wait for the build to complete

1. Click the **Deployments** tab to watch the build progress
2. You'll see a **build log** that looks like this:
   ```
   ======= Build started =======
   Step 1/9 : FROM node:22-slim
   Step 2/9 : RUN apt-get update && apt-get install -y chromium poppler-utils ...
   Step 3/9 : ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
   ...
   Step 8/9 : COPY . .
   Step 9/9 : CMD ["node", "src/start.js"]
   ======= Build completed =======
   🚀 PDF Engine running at http://localhost:3000
   ```
3. The build takes **3–8 minutes** (most of the time is downloading the Docker image and installing Chromium). Be patient.
4. When it's done, the deployment status will show a **green checkmark** ✅

#### Step 8 — Access your live service

1. **Open your generated URL** in a browser (e.g. `https://YOUR-APP-NAME.up.railway.app`)
2. You'll see the **PDF Engine Web Dashboard** — the same interface you'd see on localhost
3. Everything works from this URL:
   - **Upload HTML** tab: drag and drop an HTML file from your desktop, click Generate → PDF downloads
   - **URL → PDF** tab: enter any website URL, click Generate → PDF of that page downloads
   - **Templates** tab: select a template like Invoice, click "Load example data", click Generate → PDF downloads
   - **Raw Spec** tab: paste a JSON spec, click Generate → fully custom PDF downloads
   - **PDF Overlay** tab: upload a PDF, blur it, add a CTA button/QR code → modified PDF downloads
   - **Merge PDFs** tab: upload multiple PDFs, combine into one → merged PDF downloads

> **Bookmark this URL** — it's your PDF generation service. You can share it with others too.

#### Railway billing and usage

- **Trial credit:** New accounts get a **$5 trial credit** — this is typically enough for 2–4 weeks of moderate usage.
- **No cold starts:** Unlike Render's free tier, Railway does **not** put your service to sleep. It stays running 24/7 — no 30-second wake-up delays.
- **Hobby plan:** $5/month gives you 8GB RAM, 8 vCPU, and $5 of resource usage included — more than enough for a PDF engine.
- **Usage-based:** You pay only for what you use (CPU time + memory + network). A PDF engine sitting idle costs very little.

---

### Deploy to Render (alternative)

Render has a **free tier** (750 hours/month) but services sleep after 15 minutes of inactivity (30-second wake-up on first request). Use Docker runtime for Chromium support.

1. Go to **[https://render.com](https://render.com)** and sign up with GitHub
2. Click **New +** → **Web Service** → select your repository → click **Connect**
3. Set these settings:

| Setting | Value |
|---|---|
| **Name** | `pdf-engine` |
| **Runtime** | **`Docker`** (important — not Node) |
| **Instance Type** | `Free` |

4. Add environment variables: `PORT` = `3000`, `NODE_ENV` = `production`
5. **Leave Build Command and Start Command empty** — the Dockerfile handles everything
6. Click **Create Web Service** — wait 3–8 minutes for the build
7. Your URL will be `https://pdf-engine-xxxx.onrender.com`

> **Important:** You MUST select **Docker** as the runtime, not Node. The Dockerfile installs Chromium via `apt-get`. If you chose Node runtime and get "Could not find Chrome", go to Settings → Build & Deploy → change Runtime dropdown from `Node` to `Docker` → clear Build/Start commands → Save → Manual Deploy.

---

### Troubleshooting deployment

**"Could not find Chrome" or "Cannot find Chromium"**
This means the Docker runtime is not being used. On Railway, check Settings → Build and verify the Builder is `Dockerfile`. On Render, change Runtime from Node to Docker in Settings → Build & Deploy.

**The service shows "502 Bad Gateway" or "Service Unavailable"**
The build succeeded but the server crashed on startup. Check the **Logs** (Railway: Deployments tab → click the deployment → View Logs; Render: Logs tab). Common causes:
- Port mismatch: make sure `PORT` environment variable is set to `3000`
- Missing dependency: check the build log for errors

**"Application exited early" or "Process exited with code 1"**
Check that `PORT` environment variable is set. Without it, the server defaults to port 3000, which should work — but Railway sometimes requires it explicitly. Also verify the Start Command is `node src/start.js`.

**Template / spec generation works but HTML-to-PDF doesn't**
HTML-to-PDF requires Chromium. Verify the build log shows `apt-get install -y chromium` — this confirms Docker is installing Chromium. If you don't see this line, the Docker builder is not being used.

**I updated my code — how do I redeploy?**
Both Railway and Render auto-deploy whenever you push to the connected branch. Just push your changes to GitHub and it will rebuild automatically. On Railway you can also click **Deploy** on the Deployments tab.

**Build is failing with "no space left on device"**
The Docker image is large (~500MB) because it includes Chromium. On Railway's trial tier this should not be an issue. On Render's free tier, this can occasionally happen — try redeploying (Manual Deploy → Deploy latest commit).

---

### After deployment — how to use each feature

Once your service is live (at `https://YOUR-APP.up.railway.app` or `https://YOUR-APP.onrender.com`):

| What you want to do | How to do it |
|---|---|
| Convert an HTML file to PDF | Open dashboard → **Upload HTML** tab → drag your `.html` file into the box → click **Generate PDF** → it downloads |
| Convert a web page to PDF | Open dashboard → **URL → PDF** tab → paste the URL → click **Generate PDF** → it downloads |
| Generate an invoice/resume/etc. | Open dashboard → **Templates** tab → select template → click **Load example data** (or paste your own JSON) → click **Generate PDF** |
| Build a completely custom PDF | Open dashboard → **Raw Spec** tab → paste your JSON spec → click **Generate PDF** |
| Blur a PDF and add a CTA | Open dashboard → **PDF Overlay** tab → upload a PDF → set CTA text/URL/blur → click **Generate** |
| Merge multiple PDFs | Open dashboard → **Merge PDFs** tab → upload 2+ PDFs → click **Merge** → combined PDF downloads |
| Use the API from code/curl | Send HTTP requests to your URL + endpoint path (e.g. `/generate/invoice`, `/convert`, `/overlay`) |

All features work identically whether you're on localhost or the deployed URL. The only difference is the domain name.

---

## Running Tests

```bash
# Run all tests
npm test
```

The test suite covers:
- Core engine (text, links, tables, lists, columns, page numbers, overlay, all element types)
- All 6 templates (each generates a valid PDF)
- Overlay/blur element (default settings, custom styling, with/without URL)
- Stealth links (scanner-invisible clickable links)
- HTML-to-PDF conversion (styled HTML, tables, clickable links, file output, options)
- API server (all endpoints including `/convert` and `/convert/url`)

---

## Project Structure

```
├── public/
│   └── index.html              # Web dashboard UI (served at /)
├── src/
│   ├── engine/
│   │   ├── pdf-engine.js      # Core PDF rendering engine (spec-based)
│   │   ├── html-to-pdf.js     # HTML-to-PDF conversion engine (puppeteer-core) with smart resize
│   │   └── pdf-overlay.js     # PDF upload overlay engine (blur + CTA)
│   ├── templates/
│   │   ├── index.js            # Template registry
│   │   ├── invoice.js          # Invoice template
│   │   ├── resume.js           # Resume/CV template
│   │   ├── report.js           # Report template
│   │   ├── contract.js         # Contract template
│   │   ├── certificate.js      # Certificate template
│   │   └── letter.js           # Letter template
│   ├── server.js               # Express API server factory
│   ├── start.js                # Server entry point (npm start)
│   ├── cli.js                  # CLI tool (node src/cli.js)
│   └── index.js                # Main module export
├── examples/
│   ├── invoice-data.json       # Sample invoice data
│   ├── resume-data.json        # Sample resume data
│   ├── report-data.json        # Sample report data
│   ├── contract-data.json      # Sample contract data
│   ├── certificate-data.json   # Sample certificate data
│   ├── letter-data.json        # Sample letter data
│   ├── raw-spec.json           # Sample raw spec (custom PDF)
│   ├── overlay-demo.json       # Overlay / blur teaser demo
│   ├── stealth-link-demo.json  # Stealth link demo (scanner-invisible links)
│   └── sample-page.html        # Sample HTML page for conversion demo
├── tests/
│   ├── pdf-engine.test.js      # Engine, template, overlay & stealth link tests
│   ├── server.test.js          # API server tests
│   ├── html-to-pdf.test.js     # HTML-to-PDF converter & /convert endpoint tests
│   └── pdf-overlay.test.js     # PDF upload overlay engine & /overlay endpoint tests
├── Dockerfile                  # Docker image for cloud deployment (installs Chromium)
├── .dockerignore               # Docker build exclusions
├── render.yaml                 # Render deployment config (one-click deploy)
├── package.json
└── README.md
```

---

## Troubleshooting & FAQ

**Q: curl says "Failed to connect to localhost port 3000" or "Bad hostname"**
This means either:
1. **The server is not running.** You must run `npm start` in one terminal and keep it open, then use curl in a **second** terminal.
2. **You're on Windows and used `\` line breaks.** The `\` character is a Linux/macOS line-continuation. On Windows, put the entire curl command on a **single line**:
```cmd
curl -X POST http://localhost:3000/generate/invoice -H "Content-Type: application/json" -d @examples/invoice-data.json --output invoice.pdf
```
See the [HTTP API Server](#way-2--http-api-server) section for Windows-specific commands.

**Q: I get `command not found: node`**
Node.js is not installed. Download it from [https://nodejs.org](https://nodejs.org) (choose LTS), install it, then try again.

**Q: `npm install` fails with permission errors**
On macOS/Linux, try: `sudo npm install`
Or better: use [nvm](https://github.com/nvm-sh/nvm) to manage Node.js without sudo.

**Q: How do I change the paper size?**
Add `"size": "LETTER"` (or `"A3"`, `"A5"`, `"LEGAL"`, etc.) to the top level of your spec JSON. The default is `"A4"`.

**Q: How do I change the margins?**
Add `"margins": { "top": 30, "bottom": 30, "left": 40, "right": 40 }` to the top level of your spec JSON.

**Q: How do I add page numbers?**
Add `"pageNumbers": { "align": "center", "fontSize": 9 }` to the top level of your spec JSON. Options for `align`: `"left"`, `"center"`, `"right"`.

**Q: Can I use custom fonts?**
PDFKit supports the built-in PDF fonts: `Helvetica`, `Helvetica-Bold`, `Helvetica-Oblique`, `Helvetica-BoldOblique`, `Courier`, `Courier-Bold`, `Courier-Oblique`, `Courier-BoldOblique`, `Times-Roman`, `Times-Bold`, `Times-Italic`, `Times-BoldItalic`, `Symbol`, `ZapfDingbats`. Specify the font name in any element's `font` property.

**Q: The API server port 3000 is already in use**
Start on a different port: `PORT=8080 npm start` (Linux/macOS) or `set PORT=8080 && npm start` (Windows CMD).

**Q: HTML-to-PDF conversion times out ("Timed out after waiting 30000ms")**
The default timeout has been increased to 120 seconds (2 minutes). For very large or complex HTML files with lots of external resources, you can increase it further:
- **CLI:** Not yet configurable — edit the timeout in `src/engine/html-to-pdf.js` if needed.
- **API:** Pass `"options": { "timeout": 180000 }` in the request body (180s = 3 minutes).
- **Programmatic:** `new HtmlToPdfConverter({ timeout: 180000 })`
- **Best fix:** Use the **web dashboard** instead of the CLI — it handles large files better and gives you visual feedback.

**Q: Can I deploy this so I don't need to run anything locally?**
Yes! See [Deploy to the Cloud](#deploy-to-the-cloud-render--railway). Deploy to Render (free) or Railway and use the web dashboard from any browser. No local install needed.

**Q: How do I use this in my existing Express/Node.js app?**
```js
const { PDFEngine, HtmlToPdfConverter, templates } = require("./src");
const engine = new PDFEngine();
const converter = new HtmlToPdfConverter();
// Use engine.generateToBuffer(spec) or converter.convertHtmlToBuffer(html)
```

**Q: Where do the generated PDFs go?**
Wherever you specify with `--output` (CLI) or `filename` (API). If you don't specify, the CLI defaults to `output.pdf` in the current directory. The web dashboard downloads them directly to your browser's download folder.
