import { useState, useEffect } from 'react'
import { extractQuery } from './lib/extractor'
import type { ExtractedQuery } from '@uiuc-course-search/query-types'

function App() {
  const [query, setQuery] = useState('')
  const [extracted, setExtracted] = useState<ExtractedQuery | null>(null)
  const [results, setResults] = useState<any[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (query.trim()) {
      setExtracted(extractQuery(query))
    } else {
      setExtracted(null)
    }
  }, [query])

  const handleSearch = async () => {
    if (!query) return
    setLoading(true)
    
    try {
      const apiBase = import.meta.env.PROD ? 'https://uiuc-course-search.lumirth.workers.dev' : '';
      const response = await fetch(`${apiBase}/api/search?q=${encodeURIComponent(query)}`, {
        headers: {
          'X-Search-Hints': JSON.stringify(extracted)
        }
      })
      const data = await response.json()
      setResults(data.results || [])
    } catch (error) {
      console.error('Search failed:', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ padding: '2rem', maxWidth: '800px', margin: '0 auto', fontFamily: 'system-ui' }}>
      <h1>UIUC Smart Course Search</h1>
      
      <div style={{ display: 'flex', gap: '10px', marginBottom: '1rem' }}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g., cs 225 with fagen"
          style={{ flex: 1, padding: '10px', fontSize: '16px' }}
        />
        <button onClick={handleSearch} style={{ padding: '10px 20px' }}>
          Search
        </button>
      </div>

      {extracted && extracted.hints.length > 0 && (
        <div style={{ marginBottom: '1rem', display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
          {extracted.hints.map((hint, i) => (
            <span key={i} style={{ 
              background: '#e0e0e0', 
              padding: '2px 8px', 
              borderRadius: '12px',
              fontSize: '12px'
            }}>
              {hint.type}: <strong>{hint.value}</strong>
            </span>
          ))}
          <span style={{ fontSize: '12px', color: '#666', marginLeft: '10px' }}>
            Residual: "{extracted.residual}"
          </span>
        </div>
      )}

      <div>
        {loading ? <p>Loading...</p> : (
          results.map((r, i) => (
            <div key={i} style={{ borderBottom: '1px solid #eee', padding: '10px 0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <strong>{r.subject} {r.number}: {r.title}</strong>
                <span style={{ color: '#0070f3' }}>Score: {r._score?.toFixed(4)}</span>
              </div>
              <p style={{ fontSize: '14px', color: '#444', margin: '5px 0' }}>{r.description?.slice(0, 200)}...</p>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export default App
