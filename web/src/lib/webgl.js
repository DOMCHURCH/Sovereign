// WebGL capability detection.
//
// Some environments — hardware acceleration disabled, sandboxed GPUs, headless
// browsers, old drivers, certain VMs — cannot create a WebGL context. When
// react-globe.gl / three.js hits one of these, it throws "Error creating WebGL
// context" during init, which (uncaught) crashes the whole app. We probe up
// front so we can render a 2D fallback instead of white-screening.
//
// Note: a passing probe is NOT a guarantee. On some drivers `getContext` returns
// a context that then fails when three.js actually renders (e.g. the AMD
// "BindToCurrentSequence failed" case). That's why the globe is *also* wrapped in
// an error boundary — this probe just catches the clear-cut "no WebGL" cases fast.

export function isWebGLAvailable() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false
  try {
    if (!window.WebGLRenderingContext) return false
    const canvas = document.createElement('canvas')
    const gl =
      canvas.getContext('webgl') ||
      canvas.getContext('experimental-webgl')
    if (!gl) return false
    // Best-effort release of the probe context so we don't hold a GPU slot.
    try {
      const lose = gl.getExtension && gl.getExtension('WEBGL_lose_context')
      if (lose) lose.loseContext()
    } catch { /* ignore */ }
    return true
  } catch {
    return false
  }
}
