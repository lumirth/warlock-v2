import { useState } from 'react'

interface SearchMeta {
  query: {
    raw: string
    residual: string
  }
  extraction: {
    hints: Array<{
      type: string
      value: string | number | boolean | { subject?: string; number?: string }
      metadata: { confidence: number; source: string; raw: string }
    }>
  }
  plan: {
    filters: Record<string, unknown>
  }
  ambiguities?: Array<{
    term: string
    chosen: { type: string; value: string; label: string }
    alternatives: { type: string; value: string; label: string }[]
  }>
  timing: {
    extraction_ms: number
    search_ms: number
    total_ms: number
  }
}

interface SearchResponse {
  results: any[]
  meta: SearchMeta
  pagination: { total: number; limit: number; offset: number }
}

function formatHintValue(value: string | number | boolean | { subject?: string; number?: string }): string {
  if (typeof value === 'object' && value !== null) {
    if ('subject' in value && 'number' in value) {
      return `${value.subject} ${value.number}`
    }
    return JSON.stringify(value)
  }
  return String(value)
}

function getHintColor(type: string): string {
  const colors: Record<string, string> = {
    courseCode: '#3b82f6',
    subject: '#8b5cf6',
    instructor: '#10b981',
    gened: '#f59e0b',
    days: '#ef4444',
    time: '#ec4899',
    level: '#6366f1',
    credits: '#14b8a6',
    difficulty: '#f97316',
    online: '#06b6d4',
    status: '#84cc16',
    crn: '#a855f7',
  }
  return colors[type] || '#6b7280'
}

function App() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<any[]>([])
  const [meta, setMeta] = useState<SearchMeta | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSearch = async () => {
    if (!query) return
    setLoading(true)
    setMeta(null)

    try {
      const apiBase = import.meta.env.PROD ? 'https://uiuc-course-search.lumirth.workers.dev' : '';
      const response = await fetch(`${apiBase}/api/search?q=${encodeURIComponent(query)}`)
      const data: SearchResponse = await response.json()
      setResults(data.results || [])
      setMeta(data.meta || null)
    } catch (error) {
      console.error('Search failed:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch()
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
          onKeyDown={handleKeyDown}
          placeholder="e.g., easy cs gened, MWF morning 3 credits"
          style={{ flex: 1, padding: '10px', fontSize: '16px' }}
        />
        <button onClick={handleSearch} style={{ padding: '10px 20px' }}>
          Search
        </button>
      </div>

      {/* Show extraction results after search */}
      {meta && (
        <div style={{ marginBottom: '1rem', padding: '12px', background: '#f8f9fa', borderRadius: '8px' }}>
          {/* Hint chips */}
          {meta.extraction.hints.length > 0 && (
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' }}>
              {meta.extraction.hints.map((hint, i) => (
                <span
                  key={i}
                  style={{
                    background: getHintColor(hint.type),
                    color: 'white',
                    padding: '4px 10px',
                    borderRadius: '16px',
                    fontSize: '12px',
                    fontWeight: 500,
                  }}
                  title={`Source: ${hint.metadata.source}, Confidence: ${(hint.metadata.confidence * 100).toFixed(0)}%`}
                >
                  {hint.type}: <strong>{formatHintValue(hint.value)}</strong>
                </span>
              ))}
            </div>
          )}

          {/* Residual query */}
          {meta.query.residual && (
            <div style={{ fontSize: '12px', color: '#666' }}>
              Semantic search: "{meta.query.residual}"
            </div>
          )}

          {/* Ambiguities */}
          {meta.ambiguities && meta.ambiguities.length > 0 && (
            <div style={{ marginTop: '8px', fontSize: '12px', color: '#666' }}>
              {meta.ambiguities.map((amb, i) => (
                <div key={i}>
                  "{amb.term}" interpreted as <strong>{amb.chosen.label}</strong>
                  {amb.alternatives.length > 0 && (
                    <span> (could also be: {amb.alternatives.map(a => a.label).join(', ')})</span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Timing */}
          <div style={{ fontSize: '11px', color: '#999', marginTop: '6px' }}>
            Extraction: {meta.timing.extraction_ms}ms | Search: {meta.timing.search_ms}ms | Total: {meta.timing.total_ms}ms
          </div>
        </div>
      )}

      <div>
        {loading ? <p>Loading...</p> : (
          results.length === 0 && meta ? (
            <p style={{ color: '#666' }}>No results found.</p>
          ) : (
            results.map((r, i) => (
              <div key={i} style={{ borderBottom: '1px solid #eee', padding: '10px 0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <strong>{r.subject} {r.number}: {r.title}</strong>
                  <span style={{ color: '#0070f3' }}>Score: {r._score?.toFixed(4)}</span>
                </div>
                <div style={{ fontSize: '12px', color: '#666', marginTop: '2px' }}>
                  {r.term} {r.year} | {r.credit_hours} credits
                  {r._historical && <span style={{ color: '#f59e0b', marginLeft: '8px' }}>(historical)</span>}
                </div>
                <p style={{ fontSize: '14px', color: '#444', margin: '5px 0' }}>{r.description?.slice(0, 200)}...</p>
              </div>
            ))
          )
        )}
      </div>
    </div>
  )
}

export default App
