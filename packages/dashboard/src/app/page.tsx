import { DispatcherBoard } from '@/components/DispatcherBoard';
import { Logo } from '@/components/Logo';
import { ReadinessDistribution } from '@/components/ReadinessDistribution';
import { SplitTrees } from '@/components/SplitTrees';
import { distribution, loadBoard, splitTrees } from '@/lib/data';

export const dynamic = 'force-dynamic';

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ repo?: string }>;
}) {
  const params = await searchParams;
  const board = await loadBoard(params.repo);
  const stats = distribution(board.cards);
  const trees = splitTrees(board.cards);

  const machine = board.cards.filter((c) => c.lane === 'machine').length;
  const human = board.cards.filter((c) => c.lane === 'human').length;

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="sticky top-0 z-20 -mx-6 mb-8 flex items-center gap-2.5 border-b border-edge bg-ink/85 px-6 py-2.5 text-sm backdrop-blur supports-[backdrop-filter]:bg-ink/70">
        <Logo className="h-5 w-5 shrink-0" />
        <span className="font-semibold text-slate-100">GitSolutions</span>
        <span className="text-edge">/</span>
        <a
          href={`https://github.com/${board.repo}`}
          target="_blank"
          rel="noreferrer"
          className="truncate text-slate-300 transition-colors hover:text-machine hover:underline"
        >
          {board.repo}
        </a>
      </div>

      <header className="animate-fade-in border-b border-edge pb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-50">GitSolutions</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">
          A project board as a dispatcher between human and machine work, rather than a list. Issues
          are scored for agent-readiness on arrival; epics are split into real sub-issues and the
          mechanical ones handed to the Copilot coding agent.
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-2 text-xs text-muted">
          <span className="rounded-full border border-edge bg-panel px-3 py-1">
            {board.cards.length} issues
          </span>
          <span className="flex items-center gap-1.5 rounded-full border border-edge bg-panel px-3 py-1">
            <span className="h-1.5 w-1.5 rounded-full bg-machine" />
            <span className="text-machine">{machine}</span> agent
            <span className="mx-0.5 text-edge">·</span>
            <span className="h-1.5 w-1.5 rounded-full bg-human" />
            <span className="text-human">{human}</span> human
          </span>
        </div>
      </header>

      {board.error ? (
        <div className="animate-fade-in mt-8 rounded-xl border border-bad/40 bg-bad/5 p-5 shadow-card">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-bad">
            <span aria-hidden>⚠</span> Could not load the board
          </h2>
          <p className="mt-1 text-sm text-slate-300">{board.error}</p>
          <p className="mt-3 text-xs text-muted">
            The dashboard reads live from the GitHub GraphQL API. It needs{' '}
            <code className="rounded bg-panel px-1 py-0.5 text-slate-300">GITHUB_TOKEN</code> with
            read access to {board.repo}, and{' '}
            <code className="rounded bg-panel px-1 py-0.5 text-slate-300">DISPATCH_TARGET_REPO</code>{' '}
            to point at the right repository.
          </p>
        </div>
      ) : (
        <div className="animate-fade-in mt-8 space-y-12">
          <DispatcherBoard cards={board.cards} repo={board.repo} />
          <ReadinessDistribution data={stats} />
          <SplitTrees trees={trees} />
        </div>
      )}

      <footer className="mt-14 border-t border-edge pt-5 text-xs leading-relaxed text-muted">
        <p>
          The classify step is the risky one. An agent that assigns itself a design decision produces
          a confident, wrong pull request — so routing is biased hard toward humans whenever the
          classifier is unsure, and every card here is one click from the other lane.
        </p>
        <p className="mt-2">Read live at {new Date(board.generatedAt).toUTCString()}.</p>
      </footer>
    </main>
  );
}
