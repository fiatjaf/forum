import { useEffect, useState } from "preact/hooks"

// A single "something changed" signal: views read what they need from the
// in-memory models on each render, and re-render when this fires. Bursts
// (a sync bringing hundreds of events) collapse into one frame.
const subscribers = new Set<() => void>()
let scheduled = false

export function emit() {
  if (scheduled) return
  scheduled = true
  requestAnimationFrame(() => {
    scheduled = false
    for (const fn of subscribers) fn()
  })
}

export function useChanges(): number {
  const [n, setN] = useState(0)
  useEffect(() => {
    const fn = () => setN(x => x + 1)
    subscribers.add(fn)
    return () => {
      subscribers.delete(fn)
    }
  }, [])
  return n
}
