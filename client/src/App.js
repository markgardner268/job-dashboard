import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import './App.css';

function App() {
  const [keywords, setKeywords] = useState('');
  const [jobs, setJobs] = useState([]);
  const [scannedJobs, setScannedJobs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [scanLoading, setScanLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('scan');
  const [selectedJob, setSelectedJob] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [savedJobs, setSavedJobs] = useState(() => {
    const saved = localStorage.getItem('savedJobs');
    return saved ? JSON.parse(saved) : [];
  });

  const searchJobs = async () => {
    if (!keywords) return;
    setLoading(true);
    try {
      const response = await fetch(`http://localhost:3002/api/jobs/search?keywords=${encodeURIComponent(keywords)}`);
      const data = await response.json();
      setJobs(data.jobs || []);
    } catch (err) {
      console.error('Search failed');
    }
    setLoading(false);
  };

  const scanJobs = async () => {
    setScanLoading(true);
    try {
      const response = await fetch('http://localhost:3002/api/jobs/scan');
      const data = await response.json();
      setScannedJobs(data);
    } catch (err) {
      console.error('Scan failed');
    }
    setScanLoading(false);
  };

  const analyseJob = async (job) => {
    setSelectedJob(job);
    setAnalysis(null);
    setAnalysisLoading(true);
    setActiveTab('analyse');
    try {
      const response = await fetch('http://localhost:3002/api/jobs/analyse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job })
      });
      const data = await response.json();
      setAnalysis(data);
    } catch (err) {
      setAnalysis({ error: 'Analysis failed' });
    }
    setAnalysisLoading(false);
  };

  const saveJob = (job) => {
    if (savedJobs.find(j => j.id === job.id)) return;
    const updated = [...savedJobs, { ...job, savedAt: new Date().toISOString() }];
    setSavedJobs(updated);
    localStorage.setItem('savedJobs', JSON.stringify(updated));
  };

  const removeJob = (id) => {
    const updated = savedJobs.filter(j => j.id !== id);
    setSavedJobs(updated);
    localStorage.setItem('savedJobs', JSON.stringify(updated));
  };

  const getSignalClass = (signal) => {
    if (!signal) return '';
    if (signal === 'Strong Match') return 'positive';
    if (signal === 'Worth Reviewing') return 'neutral';
    if (signal === 'Weak Match' || signal === 'Poor Fit') return 'negative';
    return '';
  };

  const formatSalary = (min, max) => {
    if (!min && !max) return 'Salary not stated';
    if (min && max) return `£${Math.round(min/1000)}k - £${Math.round(max/1000)}k`;
    if (min) return `From £${Math.round(min/1000)}k`;
    return 'Salary not stated';
  };

  const formatDate = (dateStr) => {
    const date = new Date(dateStr);
    const days = Math.floor((new Date() - date) / (1000 * 60 * 60 * 24));
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    return `${days} days ago`;
  };

  const JobCard = ({ job, showAnalyse = true }) => (
    <div className="job-card">
      <div className="job-card-header">
        <div>
          <h3 className="job-title">{job.title}</h3>
          <span className="job-company">{job.company}</span>
        </div>
        {job.searchLabel && <span className="search-label">{job.searchLabel}</span>}
      </div>
      <div className="job-meta">
        <span>📍 {job.location}</span>
        <span>💰 {formatSalary(job.salary_min, job.salary_max)}</span>
        <span>🕐 {formatDate(job.created)}</span>
      </div>
      <p className="job-description">{job.description?.substring(0, 150)}...</p>
      <div className="job-actions">
        {showAnalyse && (
          <button className="analyse-btn" onClick={() => analyseJob(job)}>
            🤖 Analyse for me
          </button>
        )}
        <button className="save-btn" onClick={() => saveJob(job)}>
          📌 Save
        </button>
        <a href={job.url} target="_blank" rel="noreferrer" className="view-btn">
          View Job →
        </a>
      </div>
    </div>
  );

  return (
    <div className="App">
      <header>
        <h1>💼 Job Dashboard</h1>
        <p className="subtitle">AI-powered job discovery and matching</p>
      </header>

      {savedJobs.length > 0 && (
        <div className="watchlist">
          <h3>📌 Saved Jobs ({savedJobs.length})</h3>
          <div className="saved-list">
            {savedJobs.map(job => (
              <div key={job.id} className="saved-item">
                <div className="saved-info">
                  <span className="saved-title">{job.title}</span>
                  <span className="saved-company">{job.company}</span>
                </div>
                <div className="saved-actions">
                  <button className="analyse-btn small" onClick={() => analyseJob(job)}>🤖</button>
                  <a href={job.url} target="_blank" rel="noreferrer" className="view-btn small">→</a>
                  <button className="remove-btn" onClick={() => removeJob(job.id)}>×</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="tabs">
        <button className={activeTab === 'scan' ? 'tab active' : 'tab'} onClick={() => setActiveTab('scan')}>🔍 Job Scanner</button>
        <button className={activeTab === 'search' ? 'tab active' : 'tab'} onClick={() => setActiveTab('search')}>🔎 Search</button>
        {selectedJob && <button className={activeTab === 'analyse' ? 'tab active' : 'tab'} onClick={() => setActiveTab('analyse')}>🤖 Analysis</button>}
      </div>

      {activeTab === 'scan' && (
        <div>
          <div className="scan-header">
            <p>Scan curated searches matched to your profile.</p>
            <button className="scan-btn" onClick={scanJobs} disabled={scanLoading}>
              {scanLoading ? 'Scanning...' : '🔍 Run Job Scan'}
            </button>
          </div>
          <div className="jobs-list">
            {scannedJobs.map(job => <JobCard key={job.id} job={job} />)}
          </div>
        </div>
      )}

      {activeTab === 'search' && (
        <div>
          <div className="search-box">
            <input
              type="text"
              placeholder="e.g. head of compliance, AI governance director"
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && searchJobs()}
            />
            <button onClick={searchJobs}>Search</button>
          </div>
          {loading && <p className="loading">Searching...</p>}
          <div className="jobs-list">
            {jobs.map(job => <JobCard key={job.id} job={job} />)}
          </div>
        </div>
      )}

      {activeTab === 'analyse' && selectedJob && (
        <div className="analysis-panel">
          <h2>{selectedJob.title}</h2>
          <p className="analysis-company">{selectedJob.company} — {selectedJob.location}</p>

          {analysisLoading && <p className="loading">Claude is analysing this role against your profile...</p>}

          {analysis && !analysis.error && (
            <div>
              <div className="score-card">
                <div className="score-circle">
                  <span className="score-number">{analysis.score}</span>
                  <span className="score-label">/10</span>
                </div>
                <div className="score-info">
                  <span className={`signal-badge large ${getSignalClass(analysis.signal)}`}>{analysis.signal}</span>
                  <p className="score-summary">{analysis.summary}</p>
                </div>
              </div>

              {analysis.redFlags && analysis.redFlags !== 'None' && (
                <div className="red-flags">
                  <h4>⚠️ Red Flags</h4>
                  <p>{analysis.redFlags}</p>
                </div>
              )}

              <div className="emphasis-box">
                <h4>💡 What to emphasise if you apply</h4>
                <p>{analysis.emphasis}</p>
              </div>

              <div className="job-actions" style={{marginTop: '20px'}}>
                <button className="save-btn" onClick={() => saveJob(selectedJob)}>📌 Save this role</button>
                <a href={selectedJob.url} target="_blank" rel="noreferrer" className="view-btn">View Full Job →</a>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default App;