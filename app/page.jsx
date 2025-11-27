"use client"
import dynamic from "next/dynamic";

// Import the client component dynamically (ssr: false optional but safe)
const LivenessChecker = dynamic(() => import("./components/LivenessChecker.jsx"), {
  ssr: false,
});

export default function Page() {
  return (
    <main style={{ maxWidth: 1000, margin: "24px auto", padding: "0 16px" }}>
      <div style={{
        background: "linear-gradient(180deg,#0b1220,#0f172a)",
        border: "1px solid #1f2937",
        borderRadius: 14,
        padding: 16,
        color: "#e5e7eb",
        marginBottom: 16
      }}>
        <div style={{ fontSize: 20, fontWeight: 700 }}>
          Next.js + MediaPipe Face Liveness
        </div>
        <div style={{ color: "#94a3b8", marginTop: 6 }}>
          This demo checks randomized live actions with all processing done locally in your browser.
        </div>
      </div>

      <LivenessChecker
        // your existing props (thresholds etc.) still work
        onChange={(s) => {
          // optional: log or expose state
          // console.log("state", s);
        }}
      />
    </main>
  );
}
