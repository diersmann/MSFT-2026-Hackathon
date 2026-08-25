import type { SplitTree } from '@/lib/data';

export function SplitTrees({ trees }: { trees: SplitTree[] }) {
  if (trees.length === 0) {
    return (
      <section>
        <h2 className="text-lg font-semibold text-slate-100">Split trees</h2>
        <p className="mt-1 text-sm text-muted">
          Nothing split yet. Comment <code className="text-slate-300">/split</code> on an epic and
          its sub-issues will appear here with the native progress rollup.
        </p>
      </section>
    );
  }

  return (
    <section>
      <h2 className="text-lg font-semibold text-slate-100">Split trees</h2>
      <p className="mt-1 text-sm text-muted">
        Real sub-issues, not checklists — so the parent gets its progress bar from GitHub rather than
        from us.
      </p>

      <div className="mt-4 space-y-4">
        {trees.map((tree) => {
          const done = tree.children.filter((c) => c.state === 'CLOSED').length;
          const machine = tree.children.filter((c) => c.lane === 'machine').length;
          const percent = Math.round((done / tree.children.length) * 100);

          return (
            <div key={tree.parent.number} className="rounded-xl border border-edge bg-panel/40 p-4">
              <div className="flex items-start justify-between gap-4">
                <a
                  href={tree.parent.url}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-slate-100 hover:text-machine hover:underline"
                >
                  <span className="text-muted">#{tree.parent.number}</span> {tree.parent.title}
                </a>
                <span className="shrink-0 text-xs text-muted">
                  {done}/{tree.children.length} done
                </span>
              </div>

              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-edge/40">
                <div className="h-full rounded-full bg-good" style={{ width: `${percent}%` }} />
              </div>

              <p className="mt-2 text-xs text-muted">
                {machine} of {tree.children.length} routed to the agent
              </p>

              <ul className="mt-3 space-y-1.5 border-l border-edge pl-4">
                {tree.children.map((child) => (
                  <li key={child.number} className="flex items-center gap-2 text-sm">
                    <span
                      title={child.lane === 'machine' ? 'Copilot agent' : 'Human'}
                      className="shrink-0 text-xs"
                    >
                      {child.lane === 'machine' ? '🤖' : '🧑'}
                    </span>
                    <a
                      href={child.url}
                      target="_blank"
                      rel="noreferrer"
                      className={`hover:underline ${
                        child.state === 'CLOSED'
                          ? 'text-muted line-through'
                          : 'text-slate-300 hover:text-machine'
                      }`}
                    >
                      <span className="text-muted">#{child.number}</span> {child.title}
                    </a>
                    {child.disputed && (
                      <span className="shrink-0 rounded bg-bad/20 px-1 text-[10px] text-bad">
                        disputed
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}
