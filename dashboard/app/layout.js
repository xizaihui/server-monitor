export const metadata = {
  title: 'Server Monitor Dashboard',
  description: 'Lightweight infra monitoring dashboard',
};

import './globals.css';

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
