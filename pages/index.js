import dynamic from "next/dynamic";
import React, { useState } from "react";

// Load the liveness component only on the client (it uses camera APIs)
const LivenessChecker = dynamic(() => import("../components/LivenessChecker"), {
  ssr: false,
});

export default function Home() {
  const [latest, setLatest] = useState(null);

  const page = {
    container: {
      maxWidth: 1100,
      margin: "20px auto",
      padding: "12px",
      color: "#e5e7eb",
      fontFamily:
        'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, Arial',
      background: "radial-gradient(1200px 800px at 70% -10%, #1e293b 0%, #0f172a 40%)",
      minHeight: "100vh",
    },
    panel: {
      background: "linear-gradient(180deg,#0b1220,#111827)",
      border: "1px solid #1f2937",
      borderRadius: 16,
      padding: 12,
      marginBottom: 12,
    },
    title: {
      fontWeight: 700,
      letterSpacing: 0.2,
      fontSize: 20,
      margin: 0,
      color: "#e5e7eb",
    },
    small: { color: "#9ca3af", fontSize: 14, lineHeight: 1.4 },
    pre: {
      background: "#0b1220",
      border: "1px solid #1f2937",
      borderRadius: 12,
      padding: "0.75rem",
      overflowX: "auto",
      fontSize: 13,
      color: "#e5e7eb",
    },
  };

  return (
    <div style={page.container}>
      <div style={page.panel}>
        <h1 style={page.title}>Next.js + MediaPipe Face Liveness</h1>
        <p style={page.small}>
          This demo checks two live actions: <b>blink</b> and <b>head turn</b>. When both occur within
          the session window, <code>livenessPassed</code> becomes <b>true</b>.
        </p>
      </div>

      <LivenessChecker
        sessionWindowMs={8000}
        earThreshold={0.18}
        earCloseMinMs={120}
        yawAbsThreshold={0.55}
        yawHoldMinMs={250}
        onChange={setLatest}
      />

      <div style={{ ...page.panel, marginTop: 12 }}>
        <div style={page.title}>Exposed State</div>
        <pre style={page.pre}>{JSON.stringify(latest ?? {}, null, 2)}</pre>
      </div>
    </div>
  );
}
