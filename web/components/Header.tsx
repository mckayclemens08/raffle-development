"use client";

import Link from "next/link";
import { ConnectButton } from "@rainbow-me/rainbowkit";

function Logo() {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M2 6L24 2V13L2 20V6Z" fill="#1d4ed8" />
      <path d="M2 20L24 13V24L2 26V20Z" fill="#0b0e14" />
    </svg>
  );
}

const NAV_LINKS = [
  { href: "/", label: "Raffle" },
  { href: "/tickets", label: "My Tickets" },
  { href: "/market", label: "Market" },
];

export function Header() {
  return (
    <header className="flex items-center justify-between border-b border-neutral-200 px-6 py-3">
      <div className="flex items-center gap-8">
        <Link href="/" className="flex items-center gap-2">
          <Logo />
          <span className="text-lg font-bold tracking-tight text-neutral-900">Decentralized Lottery</span>
        </Link>
        <nav className="flex items-center gap-6 text-sm font-medium text-neutral-500">
          {NAV_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="transition hover:text-neutral-900">
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
      <ConnectButton />
    </header>
  );
}
