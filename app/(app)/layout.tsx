import Link from "next/link";
import { signOutAction } from "@/lib/actions/auth";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link href="/" className="font-serif italic text-xl tracking-tight">
            graphic studio by shoaib
            <span className="text-accent not-italic font-sans font-bold">.</span>
          </Link>
          <nav className="flex items-center gap-6 text-sm text-muted">
            <Link href="/brands" className="hover:text-foreground transition-colors">
              Brands
            </Link>
            <Link href="/generate" className="hover:text-foreground transition-colors">
              Generate
            </Link>
            <Link href="/generate/subject" className="hover:text-foreground transition-colors">
              Subject Edit
            </Link>
            <Link href="/generate/asset-locked" className="hover:text-foreground transition-colors">
              Real Estate/Event
            </Link>
            <Link href="/batches" className="hover:text-foreground transition-colors">
              Batches
            </Link>
            <Link href="/videos" className="hover:text-foreground transition-colors">
              Videos
            </Link>
            <Link href="/costs" className="hover:text-foreground transition-colors">
              Costs
            </Link>
            <form action={signOutAction}>
              <button type="submit" className="hover:text-foreground transition-colors">
                Sign out
              </button>
            </form>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">{children}</main>
    </div>
  );
}
