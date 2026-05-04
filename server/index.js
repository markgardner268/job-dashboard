const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3002;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../client/build')));

const MARK_PROFILE = `
You are evaluating job roles for Mark Gardner, a Senior Manager with 20 years experience in compliance, governance, and risk at global technology companies (ServiceNow, BlackBerry, Accenture, CSC).

TARGET ROLES: Director or Head of Compliance, Governance, GRC, or AI Governance. Senior Manager considered if scope is genuinely Director-level.

GEOGRAPHY: Remote strongly preferred. Hybrid within M62 corridor (Bradford-based) acceptable. On-site only roles are a poor fit.

SECTOR: Technology companies strongly preferred. Financial services possible but not ideal. Legal roles, public sector, or roles requiring Big Four/SOX background are mismatches.

SALARY: Minimum £110,000. Flag any role that appears to be below this as a red flag.

KEY STRENGTHS:
- EU AI Act gap assessment and implementation (pioneering work at ServiceNow)
- ISO 27001 Lead Auditor
- TPRM at scale using Interos platform
- Built distributed compliance teams across EMEA and APAC from scratch
- Matrix leadership across global compliance professionals
- C-TPAT and AEO trade compliance (BlackBerry) - rare differentiator
- ISACA member, previous CISA

RED FLAGS:
- Salary below £110,000 or appears to be junior/mid-level scope
- Requires SOX or Big Four audit experience
- Financial services regulatory specialism (FCA, PRA, Basel)
- Requires solicitor or legal qualification
- Seniority regression - coordinator or manager-level scope
- No remote or hybrid flexibility
- Role is not compliance, governance, GRC or AI governance related
`;

const RELEVANT_TITLE_KEYWORDS = [
  'compliance', 'governance', 'risk', 'grc', 'assurance',
  'regulatory', 'ai governance', 'data protection', 'privacy',
  'information security', 'cyber', 'audit', 'ethics'
];

function isTitleRelevant(title) {
  if (!title) return false;
  const lower = title.toLowerCase();
  return RELEVANT_TITLE_KEYWORDS.some(keyword => lower.includes(keyword));
}

app.get('/api/health', (req, res) => {
  res.json({ status: 'Job Dashboard API is running' });
});

async function fetchReed(keywords) {
  try {
    const response = await axios.get(
      'https://www.reed.co.uk/api/1.0/search',
      {
        auth: { username: process.env.REED_API_KEY, password: '' },
        params: { keywords, fullTime: true, resultsToTake: 10 }
      }
    );
    return response.data.results.map(job => ({
      id: `reed_${job.jobId}`,
      title: job.jobTitle,
      company: job.employerName || 'Unknown',
      location: job.locationName || 'Unknown',
      salary_min: job.minimumSalary,
      salary_max: job.maximumSalary,
      description: job.jobDescription,
      url: job.jobUrl,
      created: job.date,
      source: 'Reed',
    }));
  } catch (e) {
    console.log('Reed fetch failed:', e.message);
    return [];
  }
}

async function fetchJooble(keywords) {
  try {
    const response = await axios.post(
      `https://jooble.org/api/${process.env.JOOBLE_API_KEY}`,
      {
        keywords: keywords,
        location: 'United Kingdom',
        page: 1,
        resultonpage: 10,
      }
    );
    return (response.data.jobs || []).map(job => ({
      id: `jooble_${job.id}`,
      title: job.title,
      company: job.company || 'Unknown',
      location: job.location || 'Unknown',
      salary_min: null,
      salary_max: null,
      description: job.snippet,
      url: job.link,
      created: job.updated,
      source: 'Jooble',
    }));
  } catch (e) {
    console.log('Jooble fetch failed:', e.message);
    return [];
  }
}

async function fetchTheirStack(titlePatterns) {
  try {
    const response = await axios.post(
      'https://api.theirstack.com/v1/jobs/search',
      {
        page: 0,
        limit: 10,
        job_title_or: titlePatterns,
        job_country_code_or: ['GB'],
        posted_at_max_age_days: 30,
        job_seniority_or: ['c_level', 'staff', 'senior'],
        employment_statuses_or: ['full_time'],
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.THEIRSTACK_API_KEY}`,
          'Content-Type': 'application/json',
        }
      }
    );
    return (response.data.data || []).map(job => ({
      id: `ts_${job.id}`,
      title: job.job_title,
      company: job.company || 'Unknown',
      location: job.location || 'Unknown',
      salary_min: job.min_annual_salary,
      salary_max: job.max_annual_salary,
      description: job.description?.substring(0, 500),
      url: job.url || job.final_url,
      created: job.date_posted,
      source: 'TheirStack',
    }));
  } catch (e) {
    console.log('TheirStack fetch failed:', e.message);
    return [];
  }
}

app.get('/api/jobs/search', async (req, res) => {
  try {
    const { keywords = 'compliance director' } = req.query;
    const [reedJobs, joobleJobs] = await Promise.all([
      fetchReed(keywords),
      fetchJooble(keywords),
    ]);
    const all = [...reedJobs, ...joobleJobs].filter(job => isTitleRelevant(job.title));
    res.json({ count: all.length, jobs: all });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: 'Failed to fetch jobs' });
  }
});

app.get('/api/jobs/scan', async (req, res) => {
  try {
    const reedSearches = [
      'head of compliance',
      'director governance risk compliance',
      'chief compliance officer',
      'head of governance assurance',
    ];
    const joobleSearches = [
      'Head of Compliance Director',
      'Director GRC governance',
      'AI Governance Director',
      'Chief Compliance Officer',
    ];
    const theirStackTitles = [
      'Head of Compliance',
      'Director of Compliance',
      'Chief Compliance Officer',
      'Director of Governance',
      'Head of Governance',
      'AI Governance Director',
      'Director GRC',
    ];

    const [theirStackJobs, ...reedResults] = await Promise.all([
      fetchTheirStack(theirStackTitles),
      ...reedSearches.map(kw => fetchReed(kw)),
    ]);

    const joobleResults = [];
    for (const kw of joobleSearches) {
      const jobs = await fetchJooble(kw);
      joobleResults.push(...jobs);
      await new Promise(r => setTimeout(r, 300));
    }

    const allJobs = [...theirStackJobs, ...reedResults.flat(), ...joobleResults];
    const seen = new Set();
    const unique = allJobs.filter(job => {
      if (seen.has(job.id)) return false;
      seen.add(job.id);
      return true;
    });
    const relevant = unique.filter(job => isTitleRelevant(job.title));
    res.json(relevant);
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: 'Scan failed' });
  }
});

app.post('/api/jobs/analyse', async (req, res) => {
  try {
    const { job } = req.body;
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-sonnet-4-5',
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: `${MARK_PROFILE}

Analyse this job for Mark and provide:
1. A match score out of 10
2. A signal: "Strong Match", "Worth Reviewing", "Weak Match", or "Poor Fit"
3. 2-3 sentences on why it's a good or bad fit
4. Any red flags to watch out for
5. One thing Mark should emphasise in his application if he applies

Job Title: ${job.title}
Company: ${job.company}
Location: ${job.location}
Salary: ${job.salary_min ? '£' + job.salary_min + ' - £' + job.salary_max : 'Not stated'}
Description: ${job.description?.substring(0, 800)}
Source: ${job.source}

Respond in this exact JSON format:
{
  "score": 8,
  "signal": "Strong Match",
  "summary": "Your analysis here",
  "redFlags": "Any red flags or none",
  "emphasis": "What to emphasise in application"
}`
        }]
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        }
      }
    );
    const text = response.data.content[0].text;
    const clean = text.replace(/```json|```/g, '').trim();
    const analysis = JSON.parse(clean);
    res.json(analysis);
  } catch (error) {
    console.error(error.response?.data || error.message);
    res.status(500).json({ error: 'Analysis failed' });
  }
});

app.get('/api/jobs', (req, res) => {
  try {
    const dataFile = path.join(__dirname, '../jobs-data.json');
    if (fs.existsSync(dataFile)) {
      const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
      res.json(data);
    } else {
      res.json({ jobs: [], lastScan: null });
    }
  } catch (e) {
    res.status(500).json({ error: 'Failed to read jobs data' });
  }
});

app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/build', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Job Dashboard server running on port ${PORT}`);
});