import { useState, useEffect, useRef, useCallback } from 'preact/hooks'

function fmt(s) {
  s = Number(s) || 0
  const m = Math.floor(s / 60)
  return m + ':' + (s % 60).toFixed(1).padStart(4, '0')
}

function Header({ url, setUrl, onSubmit, busy }) {
  return (
    <header class="sticky top-0 z-20 border-b border-neutral-200 dark:border-neutral-800 backdrop-blur-xl bg-white/65 dark:bg-black/65 supports-[backdrop-filter]:bg-white/45">
      <div class="max-w-[1200px] mx-auto px-6 py-4">
        <h1 class="text-[1.375rem] font-bold tracking-[-0.02em] leading-tight">motion</h1>
        <p class="text-[0.8125rem] text-neutral-500 mt-0.5">Paste a link → mp3 → transcript.</p>
        <form class="flex gap-2 mt-3" onSubmit={onSubmit}>
          <input
            type="url" required autocomplete="off"
            class="flex-1 min-w-0 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3.5 py-2.5 text-[0.9375rem] outline-none focus:border-neutral-900 dark:focus:border-white transition-colors"
            placeholder="https://instagram.com/… or x.com/…"
            value={url} onInput={e => setUrl(e.target.value)}
          />
          <button
            type="submit" disabled={busy}
            class="rounded-xl bg-neutral-900 dark:bg-white text-white dark:text-black px-4.5 py-2.5 text-[0.875rem] font-semibold shrink-0 active:scale-[0.97] transition-transform disabled:opacity-40"
          >Transcribe</button>
        </form>
      </div>
    </header>
  )
}

function Queue({ jobs }) {
  if (!jobs.length) return null
  return (
    <div class="mb-8">
      <h2 class="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-neutral-400 mb-2.5">Queue</h2>
      {jobs.map(j => (
        <div key={j.id} class="rounded-2xl border border-neutral-200 dark:border-neutral-800 p-4 mb-3 bg-white dark:bg-neutral-950">
          <a href={j.url} target="_blank" rel="noopener" class="text-[0.8125rem] break-all text-neutral-900 dark:text-white no-underline hover:underline">{j.url}</a>
          <p class="text-[0.8125rem] text-neutral-500 mt-1">{j.status} — {j.message || ''}</p>
        </div>
      ))}
    </div>
  )
}

function Player({ src, segments, onSegmentChange }) {
  const audioRef = useRef(null)
  const trackRef = useRef(null)
  const fillRef = useRef(null)
  const knobRef = useRef(null)
  const timeRef = useRef(null)
  const playing = useRef(false)
  const scrubbing = useRef(false)
  const hist = useRef([])
  const raf = useRef(null)

  const seek = useCallback((time) => {
    const a = audioRef.current
    if (!a) return
    a.currentTime = time
    a.play().catch(() => {})
  }, [])

  useEffect(() => {
    const handler = (e) => { if (e.detail?.seek != null) seek(e.detail.seek) }
    document.addEventListener('motion-seek', handler)
    return () => document.removeEventListener('motion-seek', handler)
  }, [seek])

  // expose seek on the audio element itself for sidebar clicks
  useEffect(() => {
    if (audioRef.current) audioRef.current._seek = seek
  }, [seek])

  const rubberband = (overshoot, dim, c = 0.55) =>
    (overshoot * dim * c) / (dim + c * Math.abs(overshoot))

  function paint() {
    const a = audioRef.current
    if (!a || !trackRef.current) return
    const dur = isFinite(a.duration) ? a.duration : 0
    const cur = a.currentTime || 0
    const frac = dur ? cur / dur : 0
    if (fillRef.current) fillRef.current.style.transform = `scaleX(${Math.min(1, frac)})`
    if (knobRef.current) knobRef.current.style.left = `${Math.min(100, frac * 100)}%`
    if (timeRef.current) timeRef.current.textContent = `${fmt(cur)} / ${fmt(dur)}`

    if (segments && segments.length) {
      let activeIdx = 0
      for (let i = 0; i < segments.length; i++) {
        const s = segments[i]
        const next = segments[i + 1]?.start ?? Infinity
        if (cur >= s.start && cur < next) { activeIdx = i; break }
      }
      onSegmentChange?.(activeIdx)
    }

    if (!scrubbing.current) raf.current = requestAnimationFrame(paint)
  }

  useEffect(() => {
    const a = audioRef.current
    if (!a) return
    const onPlay = () => { playing.current = true; paint() }
    const onPause = () => { playing.current = false }
    const onMeta = () => paint()
    a.addEventListener('play', onPlay)
    a.addEventListener('pause', onPause)
    a.addEventListener('loadedmetadata', onMeta)
    return () => { a.removeEventListener('play', onPlay); a.removeEventListener('pause', onPause); a.removeEventListener('loadedmetadata', onMeta); cancelAnimationFrame(raf.current) }
  }, [])

  function seekFromEvent(e) {
    const track = trackRef.current
    const a = audioRef.current
    if (!track || !a) return
    const r = track.getBoundingClientRect()
    const dur = isFinite(a.duration) ? a.duration : 0
    let frac = (e.clientX - r.left) / r.width
    if (frac < 0 || frac > 1) {
      const over = frac < 0 ? frac * r.width : (frac - 1) * r.width
      const rb = rubberband(over, r.width)
      frac = frac < 0 ? rb / r.width : 1 + rb / r.width
    }
    frac = Math.max(-0.04, Math.min(1.04, frac))
    const t = Math.max(0, Math.min(dur, frac * dur))
    a.currentTime = t
    if (fillRef.current) fillRef.current.style.transform = `scaleX(${Math.min(1, frac)})`
    if (knobRef.current) knobRef.current.style.left = `${Math.min(100, frac * 100)}%`
    if (timeRef.current) timeRef.current.textContent = `${fmt(t)} / ${fmt(dur)}`
  }

  function onPointerDown(e) {
    const track = trackRef.current
    if (!track) return
    track.setPointerCapture(e.pointerId)
    scrubbing.current = true
    track.classList.add('scrubbing')
    hist.current = [{ x: e.clientX, t: performance.now() }]
    seekFromEvent(e)
  }

  function onPointerMove(e) {
    if (!scrubbing.current) return
    hist.current.push({ x: e.clientX, t: performance.now() })
    if (hist.current.length > 6) hist.current.shift()
    seekFromEvent(e)
  }

  function onPointerUp() {
    scrubbing.current = false
    trackRef.current?.classList.remove('scrubbing')
    paint()
  }

  function togglePlay() {
    const a = audioRef.current
    if (!a) return
    if (a.paused) a.play().catch(() => {})
    else a.pause()
  }

  const activeSeg = useRef(-1)
  const onSegChange = useCallback((idx) => {
    if (idx !== activeSeg.current) {
      activeSeg.current = idx
      document.dispatchEvent(new CustomEvent('motion-seg-active', { detail: { index: idx } }))
    }
  }, [])

  return (
    <div class="flex items-center gap-3 my-3">
      <audio ref={audioRef} preload="metadata" src={src} />
      <button
        onClick={togglePlay}
        class="w-11 h-11 rounded-full bg-neutral-900 dark:bg-white text-white dark:text-black shrink-0 grid place-items-center active:scale-[0.94] transition-transform"
        aria-label={playing.current ? 'Pause' : 'Play'}
      >
        <svg class="w-4 h-4" viewBox="0 0 16 16" fill="currentColor">
          {playing.current
            ? <><rect x="3" y="2.5" width="3.4" height="11" /><rect x="9.1" y="2.5" width="3.4" height="11" /></>
            : <path d="M4 2.5v11l9-5.5z" />
          }
        </svg>
      </button>
      <div
        ref={trackRef}
        class="relative flex-1 h-7 flex items-center cursor-pointer group"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        role="slider" aria-label="Seek" tabindex="0"
      >
        <div class="relative h-1 w-full rounded-full bg-neutral-200 dark:bg-neutral-800 overflow-hidden">
          <div ref={fillRef} class="absolute inset-0 bg-neutral-900 dark:bg-white rounded-full origin-left will-change-[transform]" style={{ transform: 'scaleX(0)' }} />
        </div>
        <div ref={knobRef} class="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-neutral-900 dark:bg-white -translate-x-1/2 pointer-events-none scale-[0.6] group-hover:scale-100 transition-transform" />
      </div>
      <span ref={timeRef} class="text-[0.75rem] text-neutral-500 font-[tabular-nums] whitespace-nowrap w-[90px] text-right">0:00.0 / 0:00.0</span>
    </div>
  )
}

function TranscriptCard({ e, index, isSelected, onSelect }) {
  const [copied, setCopied] = useState(false)
  const [expanded, setExpanded] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(e.full_text || '')
      setCopied(true)
      try { navigator.vibrate?.(10) } catch {}
      setTimeout(() => setCopied(false), 1200)
    } catch {}
  }

  const handleSegmentClick = (time) => {
    // find the audio in this card and seek it
    const card = document.querySelector(`[data-card="${index}"]`)
    const audio = card?.querySelector('audio')
    if (audio?._seek) audio._seek(time)
    else if (audio) { audio.currentTime = time; audio.play().catch(() => {}) }
  }

  return (
    <article
      data-card={index}
      onClick={() => onSelect(index)}
      class={`rounded-2xl border p-4 mb-3 bg-white dark:bg-neutral-950 transition-colors cursor-pointer ${
        isSelected
          ? 'border-neutral-900 dark:border-white'
          : 'border-neutral-200 dark:border-neutral-800 hover:border-neutral-300 dark:hover:border-neutral-700'
      }`}
    >
      <a href={e.url} target="_blank" rel="noopener" class="text-[0.8125rem] break-all text-neutral-900 dark:text-white no-underline hover:underline" onClick={ev => ev.stopPropagation()}>
        {e.url}
      </a>
      <div class="text-[0.75rem] text-neutral-400 mt-1 font-[tabular-nums]">
        {e.language || '?'} · {e.duration ?? '?'}s · {e.model || ''} · {(e.transcribed_at || '').slice(0, 16).replace('T', ' ')}
      </div>

      {e.audio_file && (
        <Player
          src={`/${e.audio_file}`}
          segments={e.segments}
        />
      )}

      <p class="text-[0.9375rem] leading-relaxed whitespace-pre-wrap mt-3">{e.full_text || ''}</p>

      <div class="flex items-center gap-2 mt-3">
        <button
          onClick={(ev) => { ev.stopPropagation(); handleCopy() }}
          class={`rounded-full border px-4 py-1.5 text-[0.8125rem] font-semibold active:scale-[0.97] transition-all ${
            copied
              ? 'border-neutral-900 dark:border-white bg-neutral-900 dark:bg-white text-white dark:text-black'
              : 'border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white hover:border-neutral-900 dark:hover:border-white'
          }`}
        >{copied ? 'Copied ✓' : 'Copy'}</button>
      </div>

      <button
        onClick={(ev) => { ev.stopPropagation(); setExpanded(!expanded) }}
        class="mt-3 text-[0.8125rem] text-neutral-500 hover:text-neutral-900 dark:hover:text-white transition-colors flex items-center gap-1.5"
      >
        <span class={`inline-block text-[0.625rem] transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}>▶</span>
        Segments ({(e.segments || []).length})
      </button>

      <div class={`grid transition-[grid-template-rows,opacity] duration-200 ${expanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
        <div class="overflow-hidden">
          {(e.segments || []).map((s, si) => (
            <div key={si} class="flex gap-2.5 py-2.5 border-t border-neutral-100 dark:border-neutral-800 first:border-t-0 items-baseline">
              <button
                onClick={(ev) => { ev.stopPropagation(); handleSegmentClick(s.start) }}
                class="shrink-0 bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-900 hover:text-white dark:hover:bg-white dark:hover:text-black rounded-full px-2.5 py-0.5 text-[0.75rem] font-[tabular-nums] transition-colors"
              >{fmt(s.start)}</button>
              <p class="text-[0.875rem] leading-snug m-0">{s.text}</p>
            </div>
          ))}
        </div>
      </div>
    </article>
  )
}

function SegmentsPanel({ transcript, activeSegIdx, onClose }) {
  const panelRef = useRef(null)
  const activeRef = useRef(null)

  useEffect(() => {
    if (activeRef.current) {
      activeRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [activeSegIdx])

  if (!transcript) return null

  const handleSeek = (time) => {
    // Find the audio element of the corresponding card
    const idx = transcript._index
    const card = document.querySelector(`[data-card="${idx}"]`)
    const audio = card?.querySelector('audio')
    if (audio?._seek) audio._seek(time)
    else if (audio) { audio.currentTime = time; audio.play().catch(() => {}) }
  }

  return (
    <aside
      ref={panelRef}
      class="w-[360px] shrink-0 border-l border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 h-[calc(100vh-57px)] sticky top-[57px] overflow-y-auto hidden lg:block"
    >
      <div class="p-5">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-neutral-400">Segments</h3>
          <button onClick={onClose} class="text-neutral-400 hover:text-neutral-900 dark:hover:text-white text-sm transition-colors">✕</button>
        </div>
        <p class="text-[0.875rem] leading-relaxed whitespace-pre-wrap text-neutral-700 dark:text-neutral-300 mb-5">{transcript.full_text || ''}</p>
        {(transcript.segments || []).map((s, i) => (
          <div
            key={i}
            ref={i === activeSegIdx ? activeRef : null}
            class={`flex gap-2.5 py-2.5 border-t border-neutral-200 dark:border-neutral-800 first:border-t-0 items-baseline transition-colors duration-200 ${
              i === activeSegIdx ? 'bg-neutral-200/60 dark:bg-neutral-800/60 -mx-2 px-2 rounded-lg' : ''
            }`}
          >
            <button
              onClick={() => handleSeek(s.start)}
              class={`shrink-0 rounded-full px-2.5 py-0.5 text-[0.75rem] font-[tabular-nums] transition-colors ${
                i === activeSegIdx
                  ? 'bg-neutral-900 dark:bg-white text-white dark:text-black'
                  : 'bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-900 hover:text-white dark:hover:bg-white dark:hover:text-black'
              }`}
            >{fmt(s.start)}</button>
            <p class="text-[0.875rem] leading-snug m-0">{s.text}</p>
          </div>
        ))}
      </div>
    </aside>
  )
}

export default function App() {
  const [url, setUrl] = useState('')
  const [jobs, setJobs] = useState([])
  const [data, setData] = useState([])
  const [query, setQuery] = useState('')
  const [selectedIdx, setSelectedIdx] = useState(null)
  const [activeSegIdx, setActiveSegIdx] = useState(-1)

  const refresh = useCallback(async () => {
    try {
      const [jr, tr] = await Promise.all([fetch('/api/jobs'), fetch('/api/transcripts')])
      const j = await jr.json()
      const d = await tr.json()
      setJobs(Array.isArray(j) ? j : [])
      setData(Array.isArray(d) ? d : [])
    } catch {}
  }, [])

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, 2000)
    return () => clearInterval(id)
  }, [refresh])

  const onSubmit = async (e) => {
    e.preventDefault()
    const u = url.trim()
    if (!u) return
    try {
      const r = await fetch('/api/add', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: u }) })
      if (!r.ok) { const j = await r.json(); throw new Error(j.error || r.status) }
      setUrl('')
      await refresh()
    } catch (err) { alert(err.message) }
  }

  const order = [...data.keys()].reverse().filter(i => {
    if (!query) return true
    const q = query.toLowerCase()
    return ((data[i].url || '') + ' ' + (data[i].full_text || '')).toLowerCase().includes(q)
  })

  const selectedTranscript = selectedIdx != null ? { ...data[selectedIdx], _index: selectedIdx } : null

  return (
    <div class="min-h-screen flex flex-col">
      <Header url={url} setUrl={setUrl} onSubmit={onSubmit} busy={false} />
      <div class="flex-1 flex">
        <main class="flex-1 min-w-0 max-w-[820px] mx-auto px-6 py-6">
          <Queue jobs={jobs} />
          <div class="flex items-center justify-between mb-2.5">
            <h2 class="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-neutral-400">
              Transcripts {data.length ? `· ${data.length}` : ''}
            </h2>
          </div>
          <input
            type="search" placeholder="Search…"
            class="w-full rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3.5 py-2.5 text-[0.875rem] outline-none focus:border-neutral-900 dark:focus:border-white transition-colors mb-4"
            value={query} onInput={e => setQuery(e.target.value)}
          />
          {!order.length
            ? <p class="text-center text-neutral-400 text-[0.875rem] py-16">No transcripts yet.</p>
            : order.map(i => (
                <TranscriptCard
                  key={i}
                  e={data[i]}
                  index={i}
                  isSelected={selectedIdx === i}
                  onSelect={setSelectedIdx}
                />
              ))
          }
        </main>
        <SegmentsPanel
          transcript={selectedTranscript}
          activeSegIdx={activeSegIdx}
          onClose={() => setSelectedIdx(null)}
        />
      </div>
    </div>
  )
}
