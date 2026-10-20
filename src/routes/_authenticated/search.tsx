import { Fragment, useEffect, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { format } from "date-fns";
import {
  CheckSquare,
  FileText,
  Gavel,
  Loader2,
  MessageSquareText,
  Search as SearchIcon,
  Sparkles,
  Video,
  type LucideIcon,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { EmptyState, ErrorState, LoadingState, PageHeader, Section } from "@/components/layout";
import { dataKeys, searchWorkspace, type SearchResult, type SearchResultKind } from "@/lib/rpc";

const searchParamsSchema = z.object({
  q: z.string().max(200).optional().catch(undefined),
});

export const Route = createFileRoute("/_authenticated/search")({
  validateSearch: (search: Record<string, unknown>) => searchParamsSchema.parse(search),
  head: () => ({ meta: [{ title: "Search — AI Powered Meeting Companion" }] }),
  component: SearchPage,
});

const MIN_QUERY = 2;
const DEBOUNCE_MS = 300;

const GROUPS: { kind: SearchResultKind; label: string; icon: LucideIcon }[] = [
  { kind: "meeting", label: "Meetings", icon: Video },
  { kind: "transcript", label: "Transcripts", icon: MessageSquareText },
  { kind: "summary", label: "Summaries", icon: Sparkles },
  { kind: "task", label: "Tasks", icon: CheckSquare },
  { kind: "decision", label: "Decisions", icon: Gavel },
];

function SearchPage() {
  const { q = "" } = Route.useSearch();
  const navigate = Route.useNavigate();
  const [input, setInput] = useState(q);
  const lastPushed = useRef(q);

  useEffect(() => {
    if (q !== lastPushed.current) {
      lastPushed.current = q;
      setInput(q);
    }
  }, [q]);

  useEffect(() => {
    const value = input.trim();
    if (value === lastPushed.current) return;
    const timer = window.setTimeout(() => {
      lastPushed.current = value;
      navigate({ search: { q: value || undefined }, replace: true });
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [input, navigate]);

  const term = q.trim();
  const results = useQuery({
    queryKey: dataKeys.search(term),
    queryFn: () => searchWorkspace(term),
    enabled: term.length >= MIN_QUERY,
    staleTime: 30_000,
  });

  const typing = input.trim() !== term;
  const rows = results.data ?? [];

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <PageHeader
        title="Search"
        description="Find meetings, transcript lines, summaries, tasks and decisions."
      />

      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          const value = input.trim();
          lastPushed.current = value;
          navigate({ search: { q: value || undefined }, replace: true });
        }}
      >
        <label htmlFor="search-page-input" className="sr-only">
          Search your workspace
        </label>
        <div className="relative">
          <SearchIcon
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            id="search-page-input"
            type="search"
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Search everything…"
            maxLength={200}
            className="h-11 pl-9 pr-9"
          />
          {(typing || results.isFetching) && input.trim().length >= MIN_QUERY && (
            <Loader2
              className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground"
              aria-hidden
            />
          )}
        </div>
      </form>

      <div aria-live="polite">
        {term.length < MIN_QUERY && (
          <EmptyState
            icon={SearchIcon}
            title="Start typing to search"
            description={`Enter at least ${MIN_QUERY} characters. Results come from your own meetings only.`}
          />
        )}
        {term.length >= MIN_QUERY && results.isLoading && (
          <LoadingState variant="list" rows={4} label="Searching…" />
        )}
        {term.length >= MIN_QUERY && results.isError && (
          <ErrorState
            title="Search failed"
            message={results.error.message}
            onRetry={() => results.refetch()}
          />
        )}
        {term.length >= MIN_QUERY && results.isSuccess && rows.length === 0 && (
          <EmptyState
            icon={FileText}
            title={`No results for "${term}"`}
            description="Try a different word, or check the spelling."
          />
        )}
        {term.length >= MIN_QUERY && results.isSuccess && rows.length > 0 && (
          <div className="space-y-8">
            <p className="text-sm text-muted-foreground">
              {rows.length} result{rows.length === 1 ? "" : "s"} for "{term}"
            </p>
            {GROUPS.map((group) => {
              const items = rows.filter((r) => r.kind === group.kind);
              if (items.length === 0) return null;
              return (
                <Section key={group.kind} title={`${group.label} (${items.length})`}>
                  <ul className="space-y-2">
                    {items.map((r, i) => (
                      <ResultRow
                        key={`${r.meeting_id}-${i}`}
                        result={r}
                        term={term}
                        icon={group.icon}
                      />
                    ))}
                  </ul>
                </Section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function ResultRow({
  result,
  term,
  icon: Icon,
}: {
  result: SearchResult;
  term: string;
  icon: LucideIcon;
}) {
  return (
    <li>
      <Link
        to="/meetings/$id"
        params={{ id: result.meeting_id }}
        className="glass flex gap-3 rounded-2xl p-4 transition hover:shadow-glow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary">
          <Icon className="h-4 w-4" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <span className="truncate font-semibold">
              <Highlight text={result.meeting_title} term={term} />
            </span>
            {result.occurred_at && (
              <span className="shrink-0 text-xs text-muted-foreground">
                {format(new Date(result.occurred_at), "d MMM yyyy")}
              </span>
            )}
          </div>
          {result.kind !== "meeting" && result.snippet && (
            <p className="mt-1 line-clamp-3 text-sm text-muted-foreground">
              <Highlight text={result.snippet} term={term} />
            </p>
          )}
        </div>
      </Link>
    </li>
  );
}

function Highlight({ text, term }: { text: string; term: string }) {
  const needle = term.toLowerCase();
  if (!needle) return <>{text}</>;
  const haystack = text.toLowerCase();
  const parts: { text: string; match: boolean }[] = [];
  let index = 0;
  while (index < text.length) {
    const found = haystack.indexOf(needle, index);
    if (found === -1) {
      parts.push({ text: text.slice(index), match: false });
      break;
    }
    if (found > index) parts.push({ text: text.slice(index, found), match: false });
    parts.push({ text: text.slice(found, found + needle.length), match: true });
    index = found + needle.length;
  }
  return (
    <>
      {parts.map((p, i) =>
        p.match ? (
          <mark key={i} className="rounded bg-primary/25 px-0.5 text-foreground">
            {p.text}
          </mark>
        ) : (
          <Fragment key={i}>{p.text}</Fragment>
        ),
      )}
    </>
  );
}
