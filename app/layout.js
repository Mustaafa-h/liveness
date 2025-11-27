import "./globals.css";


export const metadata = {
  title: "Next.js + MediaPipe Face Liveness",
  description: "Randomized liveness demo (blink/turn/lean) — all local",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head />
      <body style={{ margin: 0, background: "#0b1220" }}>
        {/* App-wide CSS */}
        <link rel="preload" href="/favicon.ico" as="image" />
        {children}
      </body>
    </html>
  );
}
