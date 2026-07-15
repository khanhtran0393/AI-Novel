import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AI Novel & Script Generator - Trình Sinh Kịch Bản Tiểu Thuyết Mạt Thế",
  description: "Trợ lý Biên kịch Sản xuất chuyên nghiệp tối ưu hóa cho tác phẩm sinh tồn, mạt thế áp dụng AI.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="h-full min-h-0 flex flex-col overflow-hidden" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
