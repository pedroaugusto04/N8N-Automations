import type { Metadata } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: 'KB Notes',
  description: 'Cliente web do workflow de knowledge base via n8n.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
