import type { Metadata } from 'next';
import Link from 'next/link';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Emerging Domain Radar',
  description: 'Emerging technology keyword and .com research dashboard',
};

const NAV_ITEMS = [['Dashboard', '/'], ['Search', '/search'], ['Watchlist', '/watchlist'], ['About', '/about']] as const;

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-background text-foreground">
        <header className="border-b border-zinc-200 dark:border-zinc-800">
          <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
            <Link href="/" className="cursor-pointer text-base font-semibold tracking-tight focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">Emerging Domain Radar</Link>
            <nav aria-label="Main navigation" className="-mx-2 flex flex-wrap text-sm">
              {NAV_ITEMS.map(([label, href]) => <Link key={href} href={href} className="flex min-h-10 cursor-pointer items-center rounded-md px-3 font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50">{label}</Link>)}
            </nav>
          </div>
        </header>
        <main className="flex-1">{children}</main>
        <footer className="border-t border-zinc-200 dark:border-zinc-800">
          <div className="mx-auto w-full max-w-7xl px-4 py-5 text-xs text-zinc-600 sm:px-6 lg:px-8 dark:text-zinc-400">このツールから購入はできません（調査専用）</div>
        </footer>
      </body>
    </html>
  );
}
