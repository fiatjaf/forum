import { createSignal } from "solid-js"

// A single "something changed" signal: views read what they need from the
// in-memory models on each render, and re-render when this fires. Bursts
// (a sync bringing hundreds of events) collapse into one frame.
const [changes, setChanges] = createSignal(0)
let scheduled = false

export function emit() {
  if (scheduled) return
  scheduled = true
  requestAnimationFrame(() => {
    scheduled = false
    setChanges(x => x + 1)
  })
}

// Reading this inside a reactive expression subscribes it to model changes.
export function useChanges(): number {
  return changes()
}
