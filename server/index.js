const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
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

// Title keyword filter - drop anything that's clearly not relevant
const RELEVANT_TITLE_KEYWORDS = [
  'compliance', 'governance', 'risk', 'grc', 'assurance',
  'regulatory', 'ai governance', 'data protection', 'privacy',
  'information security', 'cyber', 'audit'
];

function isTitleRelevant(title) {
  const lower = title.toLowerCase();
  return RELEVANT_TITLE_KEYWORDS.some(keyword => lower.includes(keyword));
}

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'Job Dashboard API is running' });
});

// Quick Claude score for filtering
async function quickScore(job) {
  try {
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-sonnet-4-5',
        max_tokens: 200,
        messages: [{
          role: 'user',
          content: `${MARK_PROFILE}

Score this job for Mark on a scale of 1-10. Reply with ONLY a JSON object like {"score": 7}.

Job Title: ${job.title}
Company: ${job.company}
Location: ${job.location}
Salary: ${job.salary_min ? '£' + job.salary_min : 'Not stated'}
Description: ${job.description?.substring(0, 400)}`
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
    const result = JSON.parse(clean);
    return result.score || 0;
  } catch (e) {
    return 0;
  }
}

// Search jobs
app.get('/api/jobs/search', async (req, res) => {
  try {
    const { keywords = 'compliance director' } = req.query;
    const apiKey = process.env.REED_API_KEY;

    const response = await axios.get(
      'https://www.reed.co.uk/api/1.0/search',
      {
        auth: {
          username: apiKey,
          password: ''
        },
        params: {
          keywords: keywords,
          fullTime: true,
          resultsToTake: 20,
        }
      }
    );

    const jobs = response.data.results
      .map(job => ({
        id: job.jobId,
        title: job.jobTitle,
        company: job.employerName || 'Unknown',
        location: job.locationName || 'Unknown',
        salary_min: job.minimumSalary,
        salary_max: job.maximumSalary,
        description: job.jobDescription,
        url: job.jobUrl,
        created: job.date,
      }))
      .filter(job => isTitleRelevant(job.title));

    res.json({ count: jobs.length, jobs });
  } catch (error) {
    console.error(error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to fetch jobs' });
  }
});

// Scan curated searches with title filter and Claude scoring
app.get('/api/jobs/scan', async (req, res) => {
  try {
    const apiKey = process.env.REED_API_KEY;

    const searches = [
      { label: 'Head of Compliance', keywords: 'head of compliance' },
      { label: 'Director GRC', keywords: 'director governance risk compliance' },
      { label: 'AI Governance', keywords: 'AI governance director' },
      { label: 'Head of Governance', keywords: 'head of governance assurance' },
      { label: 'Chief Compliance Officer', keywords: 'chief compliance officer' },
      { label: 'VP Compliance', keywords: 'VP compliance governance' },
      { label: 'Director Risk', keywords: 'director risk compliance technology' },
      { label: 'Head of Risk', keywords: 'head of risk governance' },
    ];

    const rawResults = [];

    for (const search of searches) {
      try {
        const response = await axios.get(
          'https://www.reed.co.uk/api/1.0/search',
          {
            auth: {
              username: apiKey,
              password: ''
            },
            params: {
              keywords: search.keywords,
              fullTime: true,
              resultsToTake: 5,
            }
          }
        );

        const jobs = response.data.results
          .map(job => ({
            id: job.jobId,
            title: job.jobTitle,
            company: job.employerName || 'Unknown',
            location: job.locationName || 'Unknown',
            salary_min: job.minimumSalary,
            salary_max: job.maximumSalary,
            description: job.jobDescription,
            url: job.jobUrl,
            created: job.date,
            searchLabel: search.label,
          }))
          .filter(job => isTitleRelevant(job.title));

        rawResults.push(...jobs);
        await new Promise(r => setTimeout(r, 300));
      } catch (e) {
        console.log(`Failed search: ${search.label}`);
      }
    }

    // Deduplicate by id
    const seen = new Set();
    const unique = rawResults.filter(job => {
      if (seen.has(job.id)) return false;
      seen.add(job.id);
      return true;
    });

    console.log(`${unique.length} relevant jobs after title filter, scoring with Claude...`);

    // Score each job with Claude and filter to 6+
    const scored = [];
    for (const job of unique) {
      const score = await quickScore(job);
      console.log(`${job.title} at ${job.company}: ${score}/10`);
      if (score >= 6) {
        scored.push({ ...job, claudeScore: score });
      }
      await new Promise(r => setTimeout(r, 200));
    }

    // Sort by score descending
    scored.sort((a, b) => b.claudeScore - a.claudeScore);

    console.log(`${scored.length} jobs passed Claude filter`);
    res.json(scored);
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: 'Scan failed' });
  }
});

// AI full analysis of a job
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

app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/build', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Job Dashboard server running on port ${PORT}`);
});