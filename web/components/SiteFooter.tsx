import Link from "next/link";

/// Licence conditions require the responsible-gambling route and support links
/// to be visible from anywhere in the product, not buried one page deep.
export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-neutral-200 px-4 py-8 text-sm sm:px-6">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <Link className="text-neutral-500 hover:text-neutral-900" href="/responsible-gambling">
            Responsible gambling
          </Link>
          <Link className="text-neutral-500 hover:text-neutral-900" href="/rules">
            Game rules &amp; odds
          </Link>
          <Link className="text-neutral-500 hover:text-neutral-900" href="/terms">
            Terms
          </Link>
          <Link className="text-neutral-500 hover:text-neutral-900" href="/privacy">
            Privacy
          </Link>
          <Link className="text-neutral-500 hover:text-neutral-900" href="/verify">
            Verify identity
          </Link>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-neutral-500">
          <span className="rounded border border-neutral-300 px-1.5 py-0.5 font-semibold">18+</span>
          <span>Gambling involves risk. Never play with money you can&apos;t afford to lose.</span>
        </div>

        <p className="text-xs text-neutral-400">
          Not currently licensed. This build is a development preview and does not accept real money.
        </p>
      </div>
    </footer>
  );
}
