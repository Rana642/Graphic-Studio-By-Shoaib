import Link from "next/link";
import { signOutAction } from "@/lib/actions/auth";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link href="/" className="font-semibold tracking-tight">
            Graphics Studio
          </Link>
          <nav className="flex items-center gap-6 text-sm text-muted">
            <Link href="/brands" className="hover:text-foreground transition-colors">
              Brands
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
