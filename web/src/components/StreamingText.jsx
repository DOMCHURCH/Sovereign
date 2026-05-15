import { useEffect, useRef } from 'react'

export default function StreamingText({ text, isStreaming }) {
  const ref = useRef(null)

  useEffect(() => {
    if (ref.current) {
      ref.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [text])

  return (
    <div ref={ref} className="text-slate-300 leading-relaxed whitespace-pre-wrap">
      {text}
      {isStreaming && (
        <span className="inline-block w-2 h-4 bg-indigo-400 ml-0.5 animate-pulse align-middle" />
      )}
    </div>
  )
}
