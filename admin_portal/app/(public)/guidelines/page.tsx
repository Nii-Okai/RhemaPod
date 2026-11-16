import { API_BASE_URL, BACKEND_API_PREFIX } from "@/lib/auth/config";

import { LegalHeader } from "../_components/legal-header";
import { LegalList } from "../_components/legal-section";

export const metadata = { title: "Community Guidelines · RhemaPod" };

// Rendered per request, never at build: `next build` must not depend on API uptime, and the
// text lives in the backend (app/content/comment_guidelines.txt), which a portal redeploy
// doesn't track. plans/plan-ad5-amendment-1-guidelines.md G.4.
export const dynamic = "force-dynamic";

const CONTACT_EMAIL = "contact@rhemapod.com";
const SUCCESS_REVALIDATE_SECONDS = 3600;
const FETCH_TIMEOUT_MS = 5000;
const MAX_GUIDELINES_CHARS = 20_000;

async function fetchGuidelines(cache: RequestInit["cache"] | undefined): Promise<string | null> {
  try {
    // No credentials, no forwarded headers. Next stores only 200 responses in the data cache,
    // so a non-2xx never outlives the request; a network error throws and is never cached.
    const res = await fetch(`${API_BASE_URL}${BACKEND_API_PREFIX}/settings/public`, {
      headers: { accept: "application/json" },
      // Render free-tier cold starts can hang; abort falls back to the static text.
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      ...(cache === "no-store"
        ? { cache: "no-store" as const }
        : { next: { revalidate: SUCCESS_REVALIDATE_SECONDS } }),
    });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    const text = (body as { comment_guidelines?: unknown } | null)?.comment_guidelines;
    return typeof text === "string" && text.trim() !== "" && text.length <= MAX_GUIDELINES_CHARS
      ? text
      : null;
  } catch {
    return null;
  }
}

async function loadGuidelines(): Promise<string | null> {
  const cached = await fetchGuidelines(undefined);
  if (cached !== null) return cached;
  // A 200 with an empty field would otherwise sit in the data cache for an hour.
  return fetchGuidelines("no-store");
}

type Block = { kind: "p"; text: string } | { kind: "ul"; items: string[] };

/** Blank-line separated blocks; consecutive `•` lines become one list, other lines a paragraph. */
function toBlocks(body: string): Block[] {
  const blocks: Block[] = [];
  for (const chunk of body.split(/\n\s*\n/)) {
    let list: string[] = [];
    let para: string[] = [];
    const flushPara = () => {
      if (para.length) blocks.push({ kind: "p", text: para.join(" ") });
      para = [];
    };
    const flushList = () => {
      if (list.length) blocks.push({ kind: "ul", items: list });
      list = [];
    };
    for (const raw of chunk.split("\n")) {
      const line = raw.trim();
      if (line === "") continue;
      if (line.startsWith("•")) {
        flushPara();
        list.push(line.replace(/^•\s*/, ""));
      } else {
        flushList();
        para.push(line);
      }
    }
    flushPara();
    flushList();
  }
  return blocks;
}

/** Public Community Guidelines. Server component: no session, no cookies, no headers. */
export default async function GuidelinesPage() {
  const text = await loadGuidelines();

  return (
    <main className="min-h-screen bg-surface px-16 py-[48px] sm:px-[8vw]">
      <div className="mx-auto flex max-w-[680px] flex-col gap-28">
        <LegalHeader />
        <article className="flex flex-col gap-28">
        {text === null ? <Fallback /> : <Guidelines text={text} />}
        </article>
      </div>
    </main>
  );
}

function Guidelines({ text }: { text: string }) {
  const normalized = text.replace(/\r\n?/g, "\n").trim();
  const nl = normalized.indexOf("\n");
  const title = (nl === -1 ? normalized : normalized.slice(0, nl)).trim();
  const blocks = nl === -1 ? [] : toBlocks(normalized.slice(nl + 1));

  return (
    <>
      <header>
        <h1 className="font-serif text-[40px] leading-[1.08] tracking-[-0.025em] text-ink">
          {title}
        </h1>
      </header>
      <div className="flex flex-col gap-12 text-[15px] leading-[1.6] text-ink">
        {blocks.map((b, i) =>
          b.kind === "p" ? (
            <p key={i}>{b.text}</p>
          ) : (
            <LegalList key={i}>
              {b.items.map((item, j) => (
                <li key={j}>{item}</li>
              ))}
            </LegalList>
          ),
        )}
      </div>
    </>
  );
}

function Fallback() {
  return (
    <>
      <header>
        <h1 className="font-serif text-[40px] leading-[1.08] tracking-[-0.025em] text-ink">
          Community Guidelines
        </h1>
      </header>
      <p className="text-[15px] leading-[1.6] text-ink">
        The community guidelines can&rsquo;t be loaded right now. They&rsquo;re also shown in
        the RhemaPod app before you first comment. Questions? Email{" "}
        <a className="font-medium text-clay-600 underline" href={`mailto:${CONTACT_EMAIL}`}>
          {CONTACT_EMAIL}
        </a>
        .
      </p>
    </>
  );
}
