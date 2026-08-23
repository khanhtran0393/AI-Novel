import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Novel & Script Generator - Trình Sinh Kịch Bản / Narration YouTube",
  description: "Trợ lý Biên kịch Sản xuất chuyên nghiệp — bám Setup chủ đề/phong cách, tối ưu kịch bản narration YouTube với AI.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi" className="h-full antialiased" suppressHydrationWarning>
      <body className="h-full min-h-0 flex flex-col overflow-hidden" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
