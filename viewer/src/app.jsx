import { useState, useEffect, useRef, useCallback } from 'preact/hooks'

function fmt(s) {
  s = Number(s) || 0
  const m = Math.floor(s / 60)
  return m + ':' + (s % 60).toFixed(1).padStart(4, '0')
}

function Header({ url, setUrl, onSubmit, busy }) {
  return (
    <header class="sticky top-0 z-20 border-b border-neutral-200/60 backdrop-blur-xl bg-white/70 supports-[backdrop-filter]:bg-white/50">
      <div class="max-w-[1200px] mx-auto px-6 py-4">
        <h1 class="text-[1.375rem] font-bold tracking-[-0.02em] leading-tight">motion</h1>
        <p class="text-[0.8125rem] text-neutral-400 mt-0.5">Paste a link → mp3 → transcript.</p>
        <form class="flex gap-2 mt-3" onSubmit={onSubmit}>
          <input
            type="url" required autocomplete="off"
            class="flex-1 min-w-0 rounded-xl border border-neutral-200 bg-white px-3.5 py-2.5 text-[0.9375rem] outline-none focus:border-neutral-900 transition-colors"
            placeholder="https://instagram.com/… or x.com/…"
            value={url} onInput={e => setUrl(e.target.value)}
          />
          <button
            type="submit" disabled={busy}
            class="rounded-xl bg-neutral-900 text-white px-5 py-2.5 text-[0.875rem] font-semibold shrink-0 active:scale-[0.97] transition-transform disabled:opacity-40"
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
        <div key={j.id} class="rounded-2xl border border-neutral-200 p-4 mb-3 bg-white">
          <a href={j.url} target="_blank" rel="noopener" class="text-[0.8125rem] break-all text-neutral-900 no-underline hover:underline">{j.url}</a>
          <p class="text-[0.8125rem] text-neutral-400 mt-1">{j.status} — {j.message || ''}</p>
        </div>
      ))}
    </div>
  )
}

function Player({ src, segments, onSegActive }) {
  const audioRef = useRef(null)
  const trackRef = useRef(null)
  const fillRef = useRef(null)
  const knobRef = useRef(null)
  const timeRef = useRef(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const scrubbing = useRef(false)
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

  useEffect(() => {
    if (audioRef.current) audioRef.current._seek = seek
  }, [seek])

  const rubberband = (o, dim, c = 0.55) => (o * dim * c) / (dim + c * Math.abs(o))

  function paint() {
    const a = audioRef.current
    if (!a || !trackRef.current) return
    const dur = isFinite(a.duration) ? a.duration : 0
    const cur = a.currentTime || 0
    const frac = dur ? cur / dur : 0
    if (fillRef.current) fillRef.current.style.transform = `scaleX(${Math.min(1, frac)})`
    if (knobRef.current) knobRef.current.style.left = `${Math.min(100, frac * 100)}%`
    if (timeRef.current) timeRef.current.textContent = `${fmt(cur)} / ${fmt(dur)}`
    if (segments?.length && onSegActive) {
      let idx = 0
      for (let i = 0; i < segments.length; i++) {
        const next = segments[i + 1]?.start ?? Infinity
        if (cur >= segments[i].start && cur < next) { idx = i; break }
      }
      onSegActive(idx)
    }
    if (!scrubbing.current) raf.current = requestAnimationFrame(paint)
  }

  useEffect(() => {
    const a = audioRef.current
    if (!a) return
    const onPlay = () => { setIsPlaying(true); paint() }
    const onPause = () => setIsPlaying(false)
    const onMeta = () => paint()
    const onError = () => console.error('audio load error', a.error, src)
    a.addEventListener('play', onPlay)
    a.addEventListener('pause', onPause)
    a.addEventListener('loadedmetadata', onMeta)
    a.addEventListener('error', onError)
    return () => { a.removeEventListener('play', onPlay); a.removeEventListener('pause', onPause); a.removeEventListener('loadedmetadata', onMeta); a.removeEventListener('error', onError); cancelAnimationFrame(raf.current) }
  }, [src])

  function seekFromEvent(e) {
    const track = trackRef.current
    const a = audioRef.current
    if (!track || !a) return
    const r = track.getBoundingClientRect()
    const dur = isFinite(a.duration) ? a.duration : 0
    let frac = (e.clientX - r.left) / r.width
    if (frac < 0 || frac > 1) {
      const over = frac < 0 ? frac * r.width : (frac - 1) * r.width
      frac = frac < 0 ? rubberband(over, r.width) / r.width : 1 + rubberband(over, r.width) / r.width
    }
    frac = Math.max(-0.04, Math.min(1.04, frac))
    const t = Math.max(0, Math.min(dur, frac * dur))
    a.currentTime = t
    if (fillRef.current) fillRef.current.style.transform = `scaleX(${Math.min(1, frac)})`
    if (knobRef.current) knobRef.current.style.left = `${Math.min(100, frac * 100)}%`
    if (timeRef.current) timeRef.current.textContent = `${fmt(t)} / ${fmt(dur)}`
  }

  function onPointerDown(e) {
    trackRef.current?.setPointerCapture(e.pointerId)
    scrubbing.current = true
    seekFromEvent(e)
  }
  function onPointerMove(e) { if (scrubbing.current) seekFromEvent(e) }
  function onPointerUp() { scrubbing.current = false; paint() }

  function togglePlay() {
    const a = audioRef.current
    if (!a) return
    if (a.paused) a.play().catch(() => {})
    else a.pause()
  }

  return (
    <div class="flex items-center gap-3 my-3 rounded-2xl border border-neutral-200/80 bg-neutral-50 px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
      <audio ref={audioRef} preload="metadata" src={src} />
      <button
        onClick={togglePlay}
        aria-label={isPlaying ? 'Pause' : 'Play'}
        class="w-10 h-10 rounded-full bg-neutral-900 text-white shrink-0 grid place-items-center shadow-sm ring-1 ring-neutral-900/10 hover:bg-neutral-700 active:scale-[0.94] transition-all"
      >
        <svg class="w-4 h-4" viewBox="0 0 16 16" fill="currentColor">
          {isPlaying
            ? <><rect x="3" y="2.5" width="3.4" height="11" rx="1" /><rect x="9.1" y="2.5" width="3.4" height="11" rx="1" /></>
            : <path d="M4.5 2.8v10.4c0 .5.6.9 1 .6l7.6-5.2c.4-.3.4-.9 0-1.2L5.5 2.2c-.4-.3-1 0-1 .6z" />
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
        <div class="relative h-1.5 w-full rounded-full bg-neutral-200/80 overflow-hidden group-hover:h-2 transition-all">
          <div ref={fillRef} class="absolute inset-0 bg-neutral-900 rounded-full origin-left will-change-[transform]" style={{ transform: 'scaleX(0)' }} />
        </div>
        <div ref={knobRef} class="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-white border-[3px] border-neutral-900 shadow -translate-x-1/2 pointer-events-none scale-[0.6] group-hover:scale-100 transition-transform" />
      </div>
      <span ref={timeRef} class="text-[11px] leading-none text-neutral-500 bg-white border border-neutral-200/80 rounded-md px-2 py-1.5 font-mono tabular-nums whitespace-nowrap">0:00.0 / 0:00.0</span>
    </div>
  )
}

function TranscriptCard({ e, index, isSelected, onSelect, onSegActive }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(e.full_text || '')
      setCopied(true)
      try { navigator.vibrate?.(10) } catch {}
      setTimeout(() => setCopied(false), 1200)
    } catch {}
  }

  return (
    <article
      data-card={index}
      onClick={() => onSelect(index)}
      class={`rounded-2xl border p-4 mb-3 bg-white transition-all cursor-pointer ${
        isSelected
          ? 'border-neutral-900 shadow-[0_0_0_1px_rgba(0,0,0,0.05)]'
          : 'border-neutral-200 hover:border-neutral-300'
      }`}
    >
      <a href={e.url} target="_blank" rel="noopener" class="text-[0.8125rem] break-all text-neutral-900 no-underline hover:underline" onClick={ev => ev.stopPropagation()}>
        {e.url}
      </a>
      <div class="text-[0.75rem] text-neutral-400 mt-1 font-sans tabular-nums">
        {e.language || '?'} · {e.duration ?? '?'}s · {e.model || ''} · {(e.transcribed_at || '').slice(0, 16).replace('T', ' ')}
      </div>

      {e.audio_file && <Player src={`/${String(e.audio_file).replace(/\\/g, '/')}`} segments={e.segments} onSegActive={isSelected ? onSegActive : undefined} />}

      <p class="text-[0.9375rem] leading-relaxed whitespace-pre-wrap mt-3">{e.full_text || ''}</p>

      <div class="flex items-center gap-2 mt-3">
        <button
          onClick={(ev) => { ev.stopPropagation(); handleCopy() }}
          class={`rounded-full border px-4 py-1.5 text-[0.8125rem] font-semibold active:scale-[0.97] transition-all ${
            copied
              ? 'border-neutral-900 bg-neutral-900 text-white'
              : 'border-neutral-200 bg-white text-neutral-900 hover:border-neutral-900'
          }`}
        >{copied ? 'Copied ✓' : 'Copy'}</button>
      </div>
    </article>
  )
}

function SegmentsPanel({ transcript, activeSegIdx, onClose }) {
  const activeRef = useRef(null)

  useEffect(() => {
    if (activeRef.current) activeRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [activeSegIdx])

  if (!transcript) return null

  const handleSeek = (time) => {
    const card = document.querySelector(`[data-card="${transcript._index}"]`)
    const audio = card?.querySelector('audio')
    if (audio?._seek) audio._seek(time)
    else if (audio) { audio.currentTime = time; audio.play().catch(() => {}) }
  }

  return (
    <aside class="w-[360px] shrink-0 border-l border-neutral-200 bg-white h-[calc(100vh-57px)] sticky top-[57px] overflow-y-auto hidden lg:block">
      <div class="p-5">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-neutral-400">Segments</h3>
          <button onClick={onClose} class="text-neutral-300 hover:text-neutral-900 text-sm transition-colors">✕</button>
        </div>
        <p class="text-[0.875rem] leading-relaxed whitespace-pre-wrap text-neutral-600 mb-5">{transcript.full_text || ''}</p>
        {(transcript.segments || []).map((s, i) => (
          <div
            key={i}
            ref={i === activeSegIdx ? activeRef : null}
            class={`flex gap-3 px-2.5 py-2.5 rounded-xl items-baseline transition-all duration-200 ${
              i === activeSegIdx ? 'bg-neutral-900/[0.04] ring-1 ring-neutral-900/10' : 'hover:bg-neutral-100/80'
            }`}
          >
            <button
              onClick={() => handleSeek(s.start)}
              class={`shrink-0 rounded-md border px-2 py-1 text-[11px] font-mono font-medium tabular-nums active:scale-[0.96] transition-all ${
                i === activeSegIdx
                  ? 'bg-neutral-900 text-white border-neutral-900'
                  : 'bg-neutral-100 text-neutral-600 border-neutral-200/60 hover:bg-neutral-900 hover:text-white hover:border-neutral-900'
              }`}
            >{fmt(s.start)}</button>
            <p class="text-[0.875rem] leading-snug m-0 text-neutral-700">{s.text}</p>
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
    <div class="min-h-screen flex flex-col bg-white">
      <Header url={url} setUrl={setUrl} onSubmit={onSubmit} busy={false} />
      <div class="flex-1 flex">
        <main class="flex-1 min-w-0 max-w-[820px] mx-auto px-6 py-6">
          <Queue jobs={jobs} />
          <h2 class="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-neutral-400 mb-2.5">
            Transcripts {data.length ? `· ${data.length}` : ''}
          </h2>
          <input
            type="search" placeholder="Search…"
            class="w-full rounded-xl border border-neutral-200 bg-white px-3.5 py-2.5 text-[0.875rem] outline-none focus:border-neutral-900 transition-colors mb-4"
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
                  onSelect={(idx) => { setSelectedIdx(idx); setActiveSegIdx(0) }}
                  onSegActive={setActiveSegIdx}
                />
              ))
          }
        </main>
        <SegmentsPanel transcript={selectedTranscript} activeSegIdx={activeSegIdx} onClose={() => setSelectedIdx(null)} />
      </div>
    </div>
  )
}
