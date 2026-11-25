import { useCallback, useEffect, useMemo, useReducer, useRef } from "react"
import { createInitialState, reduce, resolveOfficeMembers } from "./game/logic"
import { useOtterLive } from "./otter/live"
import OfficeScene from "./scene/OfficeScene"
import type { SceneSnapshot } from "./scene/OfficeScene"
import Hud from "./ui/Hud"

export default function App() {
  const { live, refresh } = useOtterLive()
  const [state, dispatch] = useReducer(reduce, undefined, createInitialState)
  const members = useMemo(() => resolveOfficeMembers(live), [live])

  const snapshotRef = useRef<SceneSnapshot>({
    members,
    state,
    a2a: live.a2a,
    liveOk: live.ok,
    version: live.version,
  })

  useEffect(() => {
    snapshotRef.current = {
      members,
      state,
      a2a: live.a2a,
      liveOk: live.ok,
      version: live.version,
    }
  }, [members, state, live.a2a, live.ok, live.version])

  useEffect(() => {
    if (live.ok && live.inbox.length > 0) {
      dispatch({ type: "syncLive", inbox: live.inbox, members })
    }
  }, [live.ok, live.inbox, members])

  const onSelect = useCallback((id: string) => {
    dispatch({ type: "select", id, focus: true })
  }, [])

  useEffect(() => {
    let last = performance.now()
    const timer = window.setInterval(() => {
      if (document.hidden) {
        last = performance.now()
        return
      }
      const now = performance.now()
      const dt = Math.min(now - last, 500)
      last = now
      dispatch({ type: "tick", dtMs: dt })
    }, 60)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-[#0C111B]">
      <OfficeScene snapshotRef={snapshotRef} onSelect={onSelect} />
      <Hud state={state} members={members} live={live} dispatch={dispatch} onRefresh={refresh} />
    </main>
  )
}
