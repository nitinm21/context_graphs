'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV_ITEMS = [
  { href: '/', label: 'Ask' },
  { href: '/how-it-works', label: 'How It Works' },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function SiteNav() {
  const pathname = usePathname() ?? '/';

  return (
    <nav className="site-nav" aria-label="Primary">
      {NAV_ITEMS.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link key={item.href} href={item.href} aria-current={active ? 'page' : undefined}>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
