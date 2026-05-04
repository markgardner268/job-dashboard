import { useState, useEffect } from 'react';
import './App.css';

const API = process.env.REACT_APP_API_URL || 'http://localhost:3002';

function fitColor(score) {
  if (score >= 75) return '#1D9E75';
  if (score >= 55) return '#BA7517';
  return '#D85A30';
}

function initials(company = '?') {
  return company.substring(0, 2).toUpperCase();
}

export default function App() {
  const [allJobs, setAllJobs] = useState([]);
  const [savedIds, setSavedIds] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('savedIds') || '[]')); }
    catch { return new Set(); }
  });
  const [dismissedIds, setDismissedIds] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('dismissedIds') || '[]')); }
    catch { return new Set(); }
  });
  const [tab, setTab] = useState('new');
  const [loading, setLoading] = useState(true);
  const [lastScan, setLastScan] = useState(null);
  const [status, setStatus] = useState('Loading...');

  useEffect(() => {
    fetchJobs();
  }, []);

  async function fetchJobs() {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/jobs`);
      const data = await res.json();
      setAllJobs(data.jobs || []);
      setLastScan(data.lastScan);
      const n = (data.jobs || []).length;
      setStatus(`${n} role${n !== 1 ? 's' : ''} in pipeline.`);
    } catch (e) {
      setStatus('Failed to load jobs.');
    }
    setLoading(false);
  }

  function persist(saved, dismissed) {
    localStorage.setItem('savedIds', JSON.stringify([...saved]));
    localStorage.setItem('dismissedIds', JSON.stringify([...dismissed]));
  }

  function saveJob(id) {
    const next = new Set(savedIds);
    next.add(id);
    setSavedIds(next);
    persist(next, dismissedIds);
  }

  function dismissJob(id) {
    const nextD = new Set(dismissedIds);
    nextD.add(id);
    const nextS = new Set(savedIds);
    nextS.delete(id);
    setDismissedIds(nextD);
    setSavedIds(nextS);
    persist(nextS, nextD);
  }

  function restoreJob(id) {
    const next = new Set(dismissedIds);
    next.delete(id);
    setDismissedIds(next);
    persist(savedIds, next);
  }

  const byScore = (a, b) => (b.fitScore || 0) - (a.fitScore || 0);
  const newJobs = allJobs.filter(j => !savedIds.has(j.id) && !dismissedIds.has(j.id)).sort(byScore);
  const savedJobs = allJobs.filter(j => savedIds.has(j.id)).sort(byScore);
  const dismissedJobs = allJobs.filter(j => dismissedIds.has(j.id)).sort(byScore);
  const visible = tab === 'new' ? newJobs : tab === 'saved' ? savedJobs : dismissedJobs;

  const tabs = [
    { key: 'new', label: 'New', count: newJobs.length, highlight: true },
    { key: 'saved', label: 'Saved', count: savedJobs.length },
    { key: 'dismissed', label: 'Dismissed', count: dismissedJobs.length },
  ];

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '1.5rem 1rem', fontFamily: 'system-ui, sans-serif' }}>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 600, color: '#111' }}>Job discovery</div>
          <div style={{ fontSize: 13, color: '#666', marginTop: 2 }}>
            Director &amp; Head — Compliance / GRC / Governance · North England &amp; remote · £110k+
          </div>
        </div>
        <button onClick={fetchJobs} disabled={loading} style={{
          background: '#111', color: '#fff', border: 'none', borderRadius: 8,
          padding: '8px 16px', fontSize: 13, fontWeight: 500,
          cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.5 : 1,
        }}>
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      <div style={{ fontSize: 12, color: '#888', marginBottom: '1.25rem' }}>
        {status}{lastScan && ` Last scan: ${new Date(lastScan).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}`}
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: '1.25rem', borderBottom: '1px solid #e5e5e5' }}>
        {tabs.map(t => (
          <div key={t.key} onClick={() => setTab(t.key)} style={{
            fontSize: 13, padding: '6px 12px', cursor: 'pointer',
            color: tab === t.key ? '#111' : '#888',
            borderBottom: tab === t.key ? '2px solid #111' : '2px solid transparent',
            marginBottom: -1, fontWeight: tab === t.key ? 600 : 400,
          }}>
            {t.label}{' '}
            <span style={{
              background: t.highlight && t.count > 0 ? '#dbeafe' : '#f3f4f6',
              color: t.highlight && t.count > 0 ? '#1d4ed8' : '#666',
              borderRadius: 999, padding: '1px 6px', fontSize: 11,
            }}>{t.count}</span>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {visible.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem 1rem', color: '#888', fontSize: 13 }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>○</div>
            {tab === 'new' ? 'No new roles. Scanner runs every 6 hours.'
              : tab === 'saved' ? 'No saved roles yet.'
              : 'Nothing dismissed.'}
          </div>
        ) : visible.map(job => {
          const score = job.fitScore || 0;
          const color = fitColor(score);
          const isSaved = savedIds.has(job.id);
          return (
            <div key={job.id} style={{
              background: '#fff',
              borderLeft: job.isNew ? '3px solid #3b82f6' : '1px solid #e5e5e5',
              border: '1px solid #e5e5e5',
              borderRadius: 12, padding: '1rem 1.25rem', position: 'relative',
            }}>
              {job.isNew && (
                <span style={{
                  position: 'absolute', top: 12, right: 12,
                  fontSize: 10, fontWeight: 600, background: '#dbeafe', color: '#1d4ed8',
                  padding: '2px 7px', borderRadius: 999,
                }}>New</span>
              )}

              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 8, border: '1px solid #e5e5e5',
                  background: '#f9fafb', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 12, fontWeight: 600, color: '#666', flexShrink: 0,
                }}>{initials(job.company)}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#111', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {job.title}
                  </div>
                  <div style={{ fontSize: 12, color: '#666' }}>
                    {job.company} · {job.location}
                    {job.salary && job.salary !== 'Not specified' && (
                      <span style={{ marginLeft: 8, color: '#1D9E75', fontWeight: 600 }}>{job.salary}</span>
                    )}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '8px 0 6px' }}>
                <span style={{ fontSize: 11, color: '#888', width: 50, flexShrink: 0 }}>Fit score</span>
                <div style={{ flex: 1, height: 4, background: '#f3f4f6', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ width: `${score}%`, height: '100%', background: color, borderRadius: 2, transition: 'width 0.6s ease' }} />
                </div>
                <span style={{ fontSize: 12, fontWeight: 600, color, width: 32, textAlign: 'right', flexShrink: 0 }}>{score}%</span>
              </div>

              <div style={{ fontSize: 12, color: '#555', lineHeight: 1.5, marginBottom: 10 }}>
                {job.summary}
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 10 }}>
                {(job.tags || []).map(tag => (
                  <span key={tag} style={{
                    fontSize: 11, padding: '2px 8px', borderRadius: 999,
                    background: '#f3f4f6', color: '#555', border: '1px solid #e5e5e5',
                  }}>{tag}</span>
                ))}
              </div>

              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                {tab !== 'dismissed' && (
                  <>
                    <button onClick={() => saveJob(job.id)} style={{
                      fontSize: 12, padding: '5px 12px', borderRadius: 8,
                      border: '1px solid #d1d5db', background: 'transparent',
                      color: '#111', cursor: 'pointer',
                    }}>{isSaved ? 'Saved ✓' : 'Save'}</button>
                    <button onClick={() => dismissJob(job.id)} style={{
                      fontSize: 12, padding: '5px 12px', borderRadius: 8,
                      border: '1px solid #e5e5e5', background: 'transparent',
                      color: '#888', cursor: 'pointer',
                    }}>Dismiss</button>
                  </>
                )}
                {tab === 'dismissed' && (
                  <button onClick={() => restoreJob(job.id)} style={{
                    fontSize: 12, padding: '5px 12px', borderRadius: 8,
                    border: '1px solid #d1d5db', background: 'transparent',
                    color: '#111', cursor: 'pointer',
                  }}>Restore</button>
                )}
                {job.url && (
                  <a href={job.url} target="_blank" rel="noreferrer" style={{
                    fontSize: 12, padding: '5px 12px', borderRadius: 8,
                    border: '1px solid #e5e5e5', background: 'transparent',
                    color: '#1d4ed8', textDecoration: 'none', marginLeft: 'auto',
                  }}>View role →</a>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}