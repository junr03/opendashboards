/** The line under the app: what it's built with, linking to the open-source OpenUI project. */
export function Footer() {
  return (
    <footer className="flex h-8 shrink-0 items-center justify-center text-xs text-muted-foreground">
      <a
        href="https://github.com/thesysdev/openui"
        target="_blank"
        rel="noopener"
        className="rounded-sm hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        Self-hosted · Built with OpenUI
      </a>
    </footer>
  );
}
