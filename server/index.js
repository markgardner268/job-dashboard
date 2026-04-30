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

KEY STRENGTHS:
- EU AI Act gap assessment and implementation (pioneering work at ServiceNow)
- ISO 27001 Lead Auditor
- TPRM at scale using Interos platform
- Built distributed compliance teams across EMEA and APAC from scratch
- Matrix leadership across global compliance professionals
- C-TPAT and AEO trade compliance (BlackBerry) - rare differentiator
- ISACA member, previous CISA

RED FLAGS:
- Requires SOX or Big Four audit experience
- Financial services regulatory specialism (FCA, PRA, Basel)
- Requires solicitor or legal qualification
- Seniority regression - coordinator or manager-level scope
- No remote or hybrid flexibility
`;

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'Job Dashboard API is running' });
});

// Search jobs
app.get('/api/jobs/search', async (req, res) => {
  try {
    const { keywords = 'compliance director', location = 'uk', remote = true } = req.query;
    const appId = process.env.ADZUNA_APP_ID;
    const apiKey = process.env.ADZUNA_API_KEY;

    const response = await axios.get(
      `https://api.adzuna.com/v1/api/jobs/gb/search/1`,
      {
        params: {
          app_id: appId,
          app_key: apiKey,
          results_per_page: 10,
          what: keywords,
          where: location,
          distance: 50,
          sort_by: 'date',
          full_time: 1,
        }
      }
    );

    const jobs = response.data.results.map(job => ({
      id: job.id,
      title: job.title,
      company: job.company?.display_name || 'Unknown',
      location: job.location?.display_name || 'Unknown',
      salary_min: job.salary_min,
      salary_max: job.salary_max,
      description: job.description,
      url: job.redirect_url,
      created: job.created,
    }));

    res.json({ count: response.data.count, jobs });
  } catch (error) {
    console.error(error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to fetch jobs' });
  }
});

// Scan curated searches
app.get('/api/jobs/scan', async (req, res) => {
  try {
    const appId = process.env.ADZUNA_APP_ID;
    const apiKey = process.env.ADZUNA_API_KEY;

    const searches = [
      { label: 'Head of Compliance', keywords: 'head of compliance' },
      { label: 'Director GRC', keywords: 'director governance risk compliance' },
      { label: 'AI Governance', keywords: 'AI governance director' },
      { label: 'Head of Governance', keywords: 'head of governance assurance' },
    ];

    const results = [];

    for (const search of searches) {
      try {
        const response = await axios.get(
          `https://api.adzuna.com/v1/api/jobs/gb/search/1`,
          {
            params: {
              app_id: appId,
              app_key: apiKey,
              results_per_page: 3,
              what: search.keywords,
              sort_by: 'date',
              full_time: 1,
            }
          }
        );

        const jobs = response.data.results.map(job => ({
          id: job.id,
          title: job.title,
          company: job.company?.display_name || 'Unknown',
          location: job.location?.display_name || 'Unknown',
          salary_min: job.salary_min,
          salary_max: job.salary_max,
          description: job.description,
          url: job.redirect_url,
          created: job.created,
          searchLabel: search.label,
        }));

        results.push(...jobs);
        await new Promise(r => setTimeout(r, 500));
      } catch (e) {
        console.log(`Failed search: ${search.label}`);
      }
    }

    // Deduplicate by id
    const seen = new Set();
    const unique = results.filter(job => {
      if (seen.has(job.id)) return false;
      seen.add(job.id);
      return true;
    });

    res.json(unique);
  } catch (error) {
    res.status(500).json({ error: 'Scan failed' });
  }
});

// AI score and analyse a job
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