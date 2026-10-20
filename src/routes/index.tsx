import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Sparkles,
  Video,
  FileText,
  ListChecks,
  Search,
  Mail,
  CalendarDays,
  Bot,
  ArrowRight,
  Check,
  Play,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/auth";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "AI Powered Meeting Companion — The Complete AI Workspace for Your Meetings" },
      {
        name: "description",
        content:
          "AI Powered Meeting Companion records, transcribes, summarizes and organizes every online meeting. Never miss a decision, action item or insight again.",
      },
      {
        property: "og:title",
        content: "AI Powered Meeting Companion — The Complete AI Workspace for Your Meetings",
      },
      {
        property: "og:description",
        content:
          "Real-time transcription, AI summaries, semantic search and action tracking across every meeting.",
      },
    ],
  }),
  component: Landing,
});

const FEATURES = [
  {
    icon: Video,
    title: "Capture Any Meeting",
    desc: "Record from your microphone or a shared meeting tab in Google Meet, Teams or any browser call.",
  },
  {
    icon: FileText,
    title: "Real-Time Transcripts",
    desc: "Live captions with speaker labels and timestamps you can pause, resume and download.",
  },
  {
    icon: Sparkles,
    title: "AI Summaries",
    desc: "Executive summary, key points, decisions, risks and follow-ups in beautiful cards.",
  },
  {
    icon: ListChecks,
    title: "Action Items",
    desc: "Automatically extract tasks, owners and deadlines and track them to completion.",
  },
  {
    icon: Search,
    title: "Semantic Search",
    desc: "Ask 'What did we decide about pricing?' and jump to the exact moment.",
  },
  {
    icon: Mail,
    title: "Email Automation",
    desc: "Draft polished recap emails and send via Gmail with one click.",
  },
];

const WORKFLOW = [
  {
    step: "1",
    title: "Connect",
    desc: "Link Google Meet, Microsoft Teams or paste any meeting URL.",
  },
  {
    step: "2",
    title: "Meet",
    desc: "Start capturing from your microphone or meeting tab and watch the transcript build live.",
  },
  {
    step: "3",
    title: "Review",
    desc: "Get a full summary, action items and a searchable transcript minutes later.",
  },
  {
    step: "4",
    title: "Act",
    desc: "Send recap emails, assign tasks and search across every meeting instantly.",
  },
];

const PLANS = [
  {
    name: "Free",
    price: "$0",
    tag: "Try AI Powered Meeting Companion",
    features: ["5 meetings / month", "Live transcription", "Basic AI summary", "Community support"],
    cta: "Get Started",
  },
  {
    name: "Pro",
    price: "$19",
    tag: "Most popular",
    features: [
      "Unlimited meetings",
      "Advanced summaries",
      "AI chat over history",
      "Gmail & Calendar",
      "Priority support",
    ],
    cta: "Start Pro",
    featured: true,
  },
  {
    name: "Enterprise",
    price: "Custom",
    tag: "For teams",
    features: [
      "SSO / SAML",
      "Admin controls",
      "Retention policies",
      "Dedicated support",
      "SLA & security review",
    ],
    cta: "Contact Sales",
  },
];

const FAQS = [
  {
    q: "How does AI Powered Meeting Companion capture my meetings?",
    a: "It doesn't join as a bot. You start capture from your browser, using your microphone or by sharing the meeting tab, and the app transcribes and summarizes the session.",
  },
  {
    q: "Where is my data stored?",
    a: "All transcripts and summaries live in your encrypted workspace. You control retention and can delete any meeting at any time.",
  },
  {
    q: "Can I search across all past meetings?",
    a: "Yes. AI Powered Meeting Companion indexes every transcript and lets you ask natural-language questions like 'Who owns the auth refactor?'.",
  },
  {
    q: "Do you integrate with Gmail and Calendar?",
    a: "AI Powered Meeting Companion drafts recap emails you can send via Gmail and syncs upcoming meetings from Google Calendar.",
  },
];

function Landing() {
  const { session } = useSession();
  return (
    <div className="min-h-screen">
      {/* Nav */}
      <header className="sticky top-0 z-30 border-b border-border backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-4 lg:px-8">
          <Link to="/" className="flex min-w-0 items-center gap-2">
            <div className="gradient-bg grid h-9 w-9 shrink-0 place-items-center rounded-xl shadow-glow">
              <Sparkles className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="truncate text-base font-bold tracking-tight sm:text-lg">
              AI Meeting Companion
            </span>
          </Link>
          <nav className="hidden items-center gap-8 text-sm text-muted-foreground md:flex">
            <a href="#features" className="hover:text-foreground">
              Features
            </a>
            <a href="#workflow" className="hover:text-foreground">
              How it works
            </a>
            <a href="#pricing" className="hover:text-foreground">
              Pricing
            </a>
            <a href="#faq" className="hover:text-foreground">
              FAQ
            </a>
          </nav>
          <div className="flex shrink-0 items-center gap-2">
            {session ? (
              <Button asChild variant="brand">
                <Link to="/dashboard">Open app</Link>
              </Button>
            ) : (
              <>
                <Link
                  to="/auth"
                  className="hidden text-sm text-muted-foreground hover:text-foreground sm:inline"
                >
                  Sign in
                </Link>
                <Button asChild variant="brand">
                  <Link to="/auth" search={{ mode: "signup" }}>
                    Get started
                  </Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative mx-auto max-w-7xl px-4 pb-20 pt-16 lg:px-8 lg:pt-28">
        <div className="mx-auto max-w-4xl text-center">
          <div className="glass mx-auto mb-6 inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs">
            <Sparkles className="h-3.5 w-3.5" /> Your AI meeting assistant
          </div>
          <h1 className="text-4xl font-black tracking-tight sm:text-6xl lg:text-7xl">
            <span className="gradient-text">AI Powered Meeting Companion</span> — The Complete AI
            Workspace for Your Meetings
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
            AI Powered Meeting Companion automatically transcribes, summarizes and organizes every
            meeting so your team never loses a decision, action item or insight again.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button asChild size="lg" variant="brand" className="px-8">
              <Link to="/auth" search={{ mode: "signup" }}>
                Get started <ArrowRight />
              </Link>
            </Button>
            <Button asChild size="lg" variant="glass" className="px-8">
              <a href="#workflow">
                <Play /> See how it works
              </a>
            </Button>
          </div>
        </div>

        {/* Hero preview */}
        <div className="glass mx-auto mt-16 max-w-5xl overflow-hidden rounded-3xl p-2 shadow-soft">
          <div className="rounded-2xl border border-border bg-surface-1/60 p-4 sm:p-6">
            <div className="mb-4 flex items-center gap-2">
              <span className="h-3 w-3 rounded-full bg-destructive/70" />
              <span className="h-3 w-3 rounded-full bg-warning/70" />
              <span className="h-3 w-3 rounded-full bg-success/70" />
              <span className="ml-3 truncate text-xs text-muted-foreground">
                Example preview · meeting / product-sync
              </span>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="md:col-span-2 space-y-3">
                {[
                  { s: "Product lead", t: "Let's ship the new auth flow this Friday." },
                  { s: "Engineer", t: "I'll own the migration. QA can start Wednesday." },
                  { s: "Support lead", t: "Risk: legacy SSO customers may need a re-invite." },
                ].map((m, i) => (
                  <div key={i} className="glass rounded-2xl p-3 text-sm">
                    <div className="text-xs text-muted-foreground">{m.s}</div>
                    <div>{m.t}</div>
                  </div>
                ))}
              </div>
              <div className="glass rounded-2xl p-4">
                <div className="text-xs uppercase tracking-widest text-muted-foreground">
                  AI Summary
                </div>
                <div className="mt-2 text-sm font-semibold">Ship new auth by Friday</div>
                <ul className="mt-3 space-y-1.5 text-xs text-muted-foreground">
                  <li>• Engineer owns migration</li>
                  <li>• QA starts Wednesday</li>
                  <li>• Risk: SSO re-invite for legacy</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="mx-auto max-w-7xl px-4 py-20 lg:px-8">
        <div className="mb-12 text-center">
          <h2 className="text-3xl font-bold sm:text-4xl">
            Everything you need after "You're on mute."
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-muted-foreground">
            Every feature is tuned for teams that live in meetings.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="glass rounded-2xl p-6 transition hover:-translate-y-0.5 hover:shadow-glow"
            >
              <div className="gradient-bg mb-4 grid h-11 w-11 place-items-center rounded-xl">
                <f.icon className="h-5 w-5 text-primary-foreground" />
              </div>
              <h3 className="text-lg font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Workflow */}
      <section id="workflow" className="mx-auto max-w-7xl px-4 py-20 lg:px-8">
        <div className="mb-12 text-center">
          <h2 className="text-3xl font-bold sm:text-4xl">From invite to insight in four steps</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-4">
          {WORKFLOW.map((w) => (
            <div key={w.step} className="glass rounded-2xl p-6">
              <div className="gradient-text text-4xl font-black">{w.step}</div>
              <h3 className="mt-2 text-lg font-semibold">{w.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{w.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Benefits */}
      <section className="mx-auto max-w-7xl px-4 py-20 lg:px-8">
        <div className="glass rounded-3xl p-8 md:p-12">
          <div className="grid gap-8 md:grid-cols-2 md:items-center">
            <div>
              <h2 className="text-3xl font-bold sm:text-4xl">
                Reclaim <span className="gradient-text">10+ hours</span> a week
              </h2>
              <p className="mt-4 text-muted-foreground">
                Stop rewatching recordings and rewriting notes. AI Powered Meeting Companion handles
                it, so your team ships faster and forgets nothing.
              </p>
              <ul className="mt-6 space-y-3 text-sm">
                {[
                  "No more note-taking during calls",
                  "Instant recap emails after each meeting",
                  "Every decision searchable in seconds",
                  "Onboard new teammates with meeting memory",
                ].map((b) => (
                  <li key={b} className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-primary" /> {b}
                  </li>
                ))}
              </ul>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {[
                { icon: Bot, k: "24/7", v: "AI assistant" },
                { icon: FileText, k: "99%", v: "Transcription accuracy" },
                { icon: CalendarDays, k: "0 min", v: "Setup time" },
                { icon: Search, k: "1s", v: "Search any meeting" },
              ].map((s) => (
                <div key={s.v} className="glass rounded-2xl p-5">
                  <s.icon className="h-5 w-5 text-primary" />
                  <div className="mt-3 text-2xl font-bold">{s.k}</div>
                  <div className="text-xs text-muted-foreground">{s.v}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="mx-auto max-w-7xl px-4 py-20 lg:px-8">
        <div className="mb-12 text-center">
          <h2 className="text-3xl font-bold sm:text-4xl">Simple pricing that scales with you</h2>
        </div>
        <div className="grid gap-6 md:grid-cols-3">
          {PLANS.map((p) => (
            <div
              key={p.name}
              className={
                "glass rounded-3xl p-8 " + (p.featured ? "shadow-glow ring-1 ring-primary" : "")
              }
            >
              <div className="text-xs uppercase tracking-widest text-muted-foreground">{p.tag}</div>
              <div className="mt-1 text-2xl font-bold">{p.name}</div>
              <div className="mt-4 flex items-baseline gap-1">
                <span className="text-4xl font-black">{p.price}</span>
                {p.price !== "Custom" && <span className="text-sm text-muted-foreground">/mo</span>}
              </div>
              <ul className="mt-6 space-y-2 text-sm">
                {p.features.map((f) => (
                  <li key={f} className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-primary" /> {f}
                  </li>
                ))}
              </ul>
              <Button asChild className="mt-8 w-full" variant={p.featured ? "brand" : "glass"}>
                <Link to="/auth" search={{ mode: "signup" }}>
                  {p.cta}
                </Link>
              </Button>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="mx-auto max-w-3xl px-4 py-20 lg:px-8">
        <div className="mb-8 text-center">
          <h2 className="text-3xl font-bold sm:text-4xl">Frequently asked questions</h2>
        </div>
        <Accordion type="single" collapsible className="glass rounded-2xl px-4">
          {FAQS.map((f, i) => (
            <AccordionItem key={i} value={"i" + i} className="border-border">
              <AccordionTrigger className="text-left">{f.q}</AccordionTrigger>
              <AccordionContent className="text-muted-foreground">{f.a}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-5xl px-4 py-16 lg:px-8">
        <div className="glass gradient-bg rounded-3xl p-10 text-center shadow-glow">
          <h2 className="text-3xl font-black text-primary-foreground sm:text-4xl">
            Meet smarter. Ship faster.
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-primary-foreground/90">
            Join the teams using AI Powered Meeting Companion to make every meeting count.
          </p>
          <Button
            asChild
            size="lg"
            className="mt-6 rounded-full bg-background text-foreground hover:bg-background/90"
          >
            <Link to="/auth" search={{ mode: "signup" }}>
              Get started free
            </Link>
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-6 px-4 py-10 md:flex-row md:items-center lg:px-8">
          <div>
            <div className="flex items-center gap-2">
              <div className="gradient-bg grid h-8 w-8 place-items-center rounded-lg">
                <Sparkles className="h-4 w-4 text-primary-foreground" />
              </div>
              <span className="font-bold">AI Powered Meeting Companion</span>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              © {new Date().getFullYear()} AI Powered Meeting Companion.
            </p>
          </div>
          <nav
            aria-label="Footer"
            className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground"
          >
            <a href="#features" className="hover:text-foreground">
              Features
            </a>
            <a href="#workflow" className="hover:text-foreground">
              How it works
            </a>
            <a href="#faq" className="hover:text-foreground">
              FAQ
            </a>
            <Link to="/auth" className="hover:text-foreground">
              Sign in
            </Link>
            <Link to="/auth" search={{ mode: "signup" }} className="hover:text-foreground">
              Create account
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
