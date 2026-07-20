export const metadata = {
  title: 'AI Novel Telegram Bridge',
  description: 'Commercial license webhook (internal)',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="vi">
      <body style={{ fontFamily: 'system-ui', padding: 24 }}>{children}</body>
    </html>
  );
}
