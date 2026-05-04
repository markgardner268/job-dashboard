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
  "Newcastle, M62 corridor), hybrid roles, or fully remote UK roles.",
  "London-only or South East office-only roles are low priority but still show them.",
  "SALARY: minimum 110000 GBP. Roles below this should score lower.",
  "NOT interested in: financial services specialist compliance, SOX/Big Four audit,",
  "or legal roles requiring solicitor qualifications.",
  "SCORING GUIDE: add 10 points for northern England, hybrid, or remote-first.",
  "Deduct 10 points for London/South East office-only.",
  "Deduct 15 points if salary appears below 110k GBP.",
  "Deduct 20 points for financial services only."
].join(" ");

const SEARCH_QUERIES = [
  "Director of Compliance technology UK 2025",
  "Head of Compliance remote hybrid UK",
  "Head of GRC technology UK director",
  "Director Governance Risk Compliance UK",
  "Head of Compliance AI governance UK",
  "Compliance Transformation director UK",
  "Director Information Security Governance UK",
  "Head of Compliance automation technology UK",
  "GRC AI governance director UK",
  "Director Governance Technology UK",
  "Head of Compliance hybrid remote UK 110k",
  "COO Head of Operations technology UK remote hybrid",
  "Chief Compliance Officer technology UK",
  "Head of Risk Compliance technology UK",
  "Director GRC hybrid remote UK",
  "AI Governance director UK technology",
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

async function validateUrl(url) {
  if (!url) return false;
  try {
    const response = await fetch(url, {
      method: "HEAD",
      signal: AbortSignal.timeout(5000),
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    return response.status < 400;
  } catch (e) {
    return false;
  }
}

async function searchQuery(query) {
  const prompt = [
    "Search for: \"" + query + "\".",
    "Find 2-3 real, currently advertised Director or Head-level",
    "Compliance, Governance, GRC, Operations, or COO roles in the UK.",
    "Include remote, hybrid, and office-based roles across all UK locations.",
    "Prioritise roles paying 110000 GBP or above.",
    "Return ONLY a valid JSON array with no other text, markdown, or backticks.",
    "Each object must have exactly these fields:",
    "id (short slug string), title (string), company (string), location (string),",
    "salary (string, show range if known or Not specified),",
    "url (string, the EXACT direct job posting URL you found in search results - must be a real working URL),",
    "summary (string, 2 sentences describing the role),",
    "fitScore (integer 0-100 scored against this profile: " + PROFILE + "),",
    "tags (array of 3-4 skill keyword strings).",
    "Director/Head/VP/COO level only. Score honestly.",
    "Financial-services-only roles score below 40.",
    "IMPORTANT: only include jobs where you found a real URL in search results. Do not invent URLs."
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
      system: "You are a job search assistant. You must respond with ONLY a valid JSON array. No explanation, no markdown, no preamble. Just the JSON array starting with [ and ending with ]. Only include jobs where you found real, working URLs in your search results.",
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

  try {
    const clean = text.replace(/```json|```/g, "").trim();
    const match = clean.match(/\[[\s\S]*\]/);
    if (match) {
      return JSON.parse(match[0]);
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
      console.log("[scanner] Got " + results.length + " raw results");
    } catch (e) {
      console.error("[scanner] Query failed:", e.message);
    }
    if (i < SEARCH_QUERIES.length - 1) await sleep(10000);
  }

  const seenThisScan = new Set();
  let newCount = 0;
  let skippedCount = 0;
  const fresh = [];

  for (const job of allFound) {
    if (!job.title || !job.company) continue;
    if (job.url && existingUrls.has(job.url)) continue;
    const key = job.title + "|" + job.company;
    if (existingKeys.has(key) || seenThisScan.has(key)) continue;

    if (job.url) {
      const valid = await validateUrl(job.url);
      if (!valid) {
        console.log("[scanner] Skipping " + job.title + " at " + job.company + " - URL invalid");
        skippedCount++;
        continue;
      }
    }

    seenThisScan.add(key);
    job.id = job.id || (Date.now() + "-" + Math.random().toString(36).substr(2, 5));
    job.isNew = true;
    job.foundAt = new Date().toISOString();
    fresh.push(job);
    newCount++;
  }

  const updated = {
    jobs: [...fresh, ...existing.jobs],
    lastScan: new Date().toISOString(),
    totalFound: (existing.jobs || []).length + newCount,
  };

  saveData(updated);
  console.log("[scanner] Scan complete. " + newCount + " new roles added, " + skippedCount + " skipped (bad URLs). Total: " + updated.jobs.length);
}

runScan();

cron.schedule("0 */6 * * *", () => {
  runScan();
});

console.log("[scanner] Job scanner running. Scans every 6 hours.");