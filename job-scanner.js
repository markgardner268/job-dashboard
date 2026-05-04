require("dotenv").config();
const fs = require("fs");
const path = require("path");
const cron = require("node-cron");

const DATA_FILE = path.join(__dirname, "jobs-data.json");
const API_KEY = process.env.ANTHROPIC_API_KEY;

const PROFILE = [
  "Senior Manager at ServiceNow with 10 years experience.",
  "Background in GRC, compliance, information security, AI governance (EU AI Act),",
  "ISO 27001 Lead Auditor, TPRM (Interos), team building, and operational leadership.",
  "Seeking Director or Head of Compliance/Governance/GRC/Operations roles. Tech sector background.",
  "Based in Bradford, West Yorkshire.",
  "LOCATION PRIORITY: Northern England (Yorkshire, Leeds, Manchester, Sheffield, Liverpool,",
  "Newcastle, M62 corridor) or fully remote UK roles.",
  "London-only or South East office-based roles are low priority.",
  "SALARY: minimum 110000 GBP. Roles below this should score lower.",
  "NOT interested in: financial services specialist compliance, SOX/Big Four audit,",
  "or legal roles requiring solicitor qualifications.",
  "SCORING GUIDE: add 10 points for northern England or remote-first.",
  "Deduct 15 points for London/South East office-only.",
  "Deduct 15 points if salary appears below 110k GBP.",
  "Deduct 20 points for financial services only."
].join(" ");

const SEARCH_QUERIES = [
  "Director Compliance technology remote UK salary 110000",
  "Head Governance Risk Compliance Yorkshire Manchester Leeds director",
  "Head Compliance AI governance technology remote UK 110k",
  "Director Information Security Governance remote UK north",
  "Head GRC technology northern England remote 2025",
  "Head Compliance automation technology remote UK senior",
  "GRC AI governance director remote UK north",
  "Compliance Transformation director remote northern England",
  "Director Governance Technology Leeds Manchester Sheffield remote",
  "Compliance CISO director technology UK remote 110k",
  "Head Operations regulated tech remote UK north England",
  "COO scale-up technology remote UK north England salary",
];

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    }
  } catch (e) {
    console.error("[scanner] Failed to load data file:", e.message);
  }
  return { jobs: [], lastScan: null };
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function searchQuery(query) {
  const prompt = [
    "Search for: \"" + query + "\".",
    "Find 2-3 real, currently advertised Director or Head-level",
    "Compliance, Governance, GRC, Operations, or COO roles in the UK.",
    "Prioritise roles in northern England or that are fully remote.",
    "Prioritise roles paying 110000 GBP or above.",
    "Return ONLY a valid JSON array with no other text, markdown, or backticks.",
    "Each object must have exactly these fields:",
    "id (short slug string), title (string), company (string), location (string),",
    "salary (string, show range if known or Not specified),",
    "url (string, the direct job posting URL),",
    "summary (string, 2 sentences describing the role),",
    "fitScore (integer 0-100 scored against this profile: " + PROFILE + "),",
    "tags (array of 3-4 skill keyword strings).",
    "Director/Head/VP/COO level only. Score honestly.",
    "London-only office roles score below 55. Financial-services-only roles score below 40."
  ].join(" ");

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 1000,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const data = await response.json();

  if (data.error) {
    console.error("[scanner] API error:", JSON.stringify(data.error));
    return [];
  }

  const text = (data.content || [])
    .filter(b => b.type === "text")
    .map(b => b.text)
    .join("");

  console.log("[scanner] Content types:", JSON.stringify((data.content || []).map(b => b.type)));
  console.log("[scanner] Raw response snippet:", text.substring(0, 300));

  try {
    const clean = text.replace(/```json|```/g, "").trim();
    const match = clean.match(/\[[\s\S]*\]/);
    if (match) {
      return JSON.parse(match[0]);
    } else {
      console.log("[scanner] No JSON array found in response");
    }
  } catch (e) {
    console.error("[scanner] JSON parse error:", e.message);
  }
  return [];
}

async function runScan() {
  console.log("[scanner] Starting scan at " + new Date().toISOString());

  const existing = loadData();
  const existingUrls = new Set(existing.jobs.map(j => j.url).filter(Boolean));
  const existingKeys = new Set(existing.jobs.map(j => j.title + "|" + j.company));

  let allFound = [];

  for (let i = 0; i < SEARCH_QUERIES.length; i++) {
    const query = SEARCH_QUERIES[i];
    console.log("[scanner] Query " + (i + 1) + "/" + SEARCH_QUERIES.length + ": " + query);
    try {
      const results = await searchQuery(query);
      allFound = allFound.concat(results);
      console.log("[scanner] Got " + results.length + " results");
    } catch (e) {
      console.error("[scanner] Query failed:", e.message);
    }
    if (i < SEARCH_QUERIES.length - 1) await sleep(2000);
  }

  const seenThisScan = new Set();
  let newCount = 0;
  const fresh = [];

  allFound.forEach(job => {
    if (!job.title || !job.company) return;
    if (job.url && existingUrls.has(job.url)) return;
    const key = job.title + "|" + job.company;
    if (existingKeys.has(key) || seenThisScan.has(key)) return;
    seenThisScan.add(key);
    job.id = job.id || (Date.now() + "-" + Math.random().toString(36).substr(2, 5));
    job.isNew = true;
    job.foundAt = new Date().toISOString();
    fresh.push(job);
    newCount++;
  });

  const updated = {
    jobs: [...fresh, ...existing.jobs],
    lastScan: new Date().toISOString(),
    totalFound: (existing.jobs || []).length + newCount,
  };

  saveData(updated);
  console.log("[scanner] Scan complete. " + newCount + " new roles found. Total: " + updated.jobs.length);
}

runScan();

cron.schedule("0 */6 * * *", () => {
  runScan();
});

console.log("[scanner] Job scanner running. Scans every 6 hours.");