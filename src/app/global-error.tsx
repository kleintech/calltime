"use client";

/** Last resort when the root layout itself fails: plain HTML, no app chrome or fonts to depend on. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: "3rem 1rem", maxWidth: 480, margin: "0 auto", lineHeight: 1.5 }}>
        <main role="alert">
          <h1 style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>Calltime hit a problem</h1>
          <p>We couldn&apos;t load the app. Try again, or come back in a few minutes.</p>
          <p style={{ marginTop: "1.5rem", display: "flex", gap: "0.75rem" }}>
            <button type="button" onClick={reset} style={{ minHeight: 44, padding: "0 1.25rem", borderRadius: 999, border: "1px solid currentColor", background: "transparent", color: "inherit", font: "inherit", fontWeight: 600, cursor: "pointer" }}>
              Try again
            </button>
            <a href="/home" style={{ minHeight: 44, display: "inline-flex", alignItems: "center", padding: "0 1.25rem", fontWeight: 600 }}>
              Back to Calls
            </a>
          </p>
          {error.digest ? <p style={{ marginTop: "1.5rem", fontSize: "0.8rem", opacity: 0.7 }}>Reference {error.digest}</p> : null}
        </main>
      </body>
    </html>
  );
}
