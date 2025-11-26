import React from "react";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "sans-serif", margin: 0, padding: 24, background: "#0b1220", color: "#e6edf3" }}>
        <header style={{ marginBottom: 24 }}>
          <h1>AI Coding Team Dashboard</h1>
          <p style={{ opacity: 0.7 }}>Rust machinery + TypeScript orchestration</p>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
