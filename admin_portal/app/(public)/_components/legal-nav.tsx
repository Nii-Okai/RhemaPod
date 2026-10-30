const LINKS = [
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: "/support", label: "Support" },
  { href: "/delete-account", label: "Delete account" },
] as const;

/** Links the four public pages. Relative hrefs: the pages share one host. */
export function LegalNav() {
  return (
    <nav aria-label="Legal" data-testid="legal-nav">
      <ul className="flex flex-wrap gap-x-16 gap-y-4 text-[14px]">
        {LINKS.map((l) => (
          <li key={l.href}>
            <a className="font-medium text-clay-600 underline" href={l.href}>
              {l.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
