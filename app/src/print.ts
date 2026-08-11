/**
 * Printing and PDF export.
 *
 * The rendered document is loaded into a hidden same-origin iframe and printed
 * from there, so the print output is the *document* — not the editor chrome,
 * gutters and status bar that `window.print()` on the main window would capture.
 *
 * PDF goes through the same path: Windows offers "Microsoft Print to PDF" (and
 * Chromium offers "Save as PDF") in the print dialog. WebView2 does expose a
 * direct print-to-PDF API, but Tauri does not surface it, so routing through the
 * dialog is the honest option rather than a half-working custom renderer.
 */

/** Resolves once the print dialog has been dismissed and the frame cleaned up. */
export function printHtml(html: string): Promise<void> {
  return new Promise((resolve) => {
    const frame = document.createElement('iframe')
    frame.setAttribute('aria-hidden', 'true')
    Object.assign(frame.style, {
      position: 'fixed',
      right: '0',
      bottom: '0',
      width: '0',
      height: '0',
      border: '0',
      visibility: 'hidden',
    })

    let done = false
    const cleanup = () => {
      if (done) return
      done = true
      // Deferred: removing the frame while the dialog is still tearing down can
      // cancel the job on some printer drivers.
      setTimeout(() => frame.remove(), 1000)
      resolve()
    }

    frame.onload = () => {
      const win = frame.contentWindow
      if (!win) return cleanup()
      try {
        win.addEventListener('afterprint', cleanup, { once: true })
        win.focus()
        win.print()
        // afterprint is unreliable across drivers; guarantee cleanup regardless.
        setTimeout(cleanup, 60_000)
      } catch {
        cleanup()
      }
    }

    // srcdoc keeps the frame same-origin, which the app's CSP allows and a
    // blob: URL would not.
    frame.srcdoc = html
    document.body.appendChild(frame)
  })
}
