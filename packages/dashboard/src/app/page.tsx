import { DispatcherBoard } from '@/components/DispatcherBoard';
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
      <header className="border-b border-edge pb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-50">Dispatch</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
          A project board as a dispatcher between human and machine work, rather than a list. Issues
          are scored for agent-readiness on arrival; epics are split into real sub-issues and the
          mechanical ones handed to the Copilot coding agent.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-muted">
          <span>
            repo{' '}
            <a
              href={`https://github.com/${board.repo}`}
              target="_blank"
              rel="noreferrer"
              className="text-slate-300 hover:text-machine hover:underline"
            >
              {board.repo}
            </a>
          </span>
          <span>{board.cards.length} issues</span>
          <span>
            <span className="text-machine">{machine}</span> agent ·{' '}
            <span className="text-human">{human}</span> human
          </span>
        </div>
      </header>

      {board.error ? (
        <div className="mt-8 rounded-xl border border-bad/40 bg-bad/5 p-5">
          <h2 className="text-sm font-semibold text-bad">Could not load the board</h2>
          <p className="mt-1 text-sm text-slate-300">{board.error}</p>
          <p className="mt-3 text-xs text-muted">
            The dashboard reads live from the GitHub GraphQL API. It needs{' '}
            <code className="text-slate-300">GITHUB_TOKEN</code> with read access to{' '}
            {board.repo}, and <code className="text-slate-300">DISPATCH_TARGET_REPO</code> to point
            at the right repository.
          </p>
        </div>
      ) : (
        <div className="mt-8 space-y-12">
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
