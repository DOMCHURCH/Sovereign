import { Component } from 'react'

// Generic error boundary. Catches errors thrown while rendering/committing its
// subtree (e.g. WebGL context creation failing deep inside react-globe.gl) so a
// single broken component can't take down the entire app.
//
// Props:
//   fallback  — node rendered after an error is caught (defaults to null)
//   onError   — optional callback (error, info) fired when an error is caught,
//               e.g. to let a parent swap in an alternative view
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, info) {
    // Surface for debugging without crashing the app.
    // eslint-disable-next-line no-console
    console.warn('[ErrorBoundary] caught error:', error, info)
    this.props.onError?.(error, info)
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? null
    }
    return this.props.children
  }
}
