import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CFU Plate Reader",
  description: "Colony forming unit plate counting and analysis",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
