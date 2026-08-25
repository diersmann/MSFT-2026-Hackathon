import type { Distribution } from '@/lib/data';

export function ReadinessDistribution({ data }: { data: Distribution }) {
  const max = Math.max(1, ...data.buckets.map((b) => b.count));

  return (
    <section>
      <h2 className="text-lg font-semibold text-slate-100">Readiness distribution</h2>
      <p className="mt-1 text-sm text-muted">
        If every issue landed on the same number, the rubric would be a thermometer in a sealed room.
        Spread is the point. Open issues only.
      </p>

      <div className="mt-4">
        <div className="rounded-xl border border-edge bg-panel/40 p-4 shadow-card">
          <ul className="space-y-2.5">
            {data.buckets.map((bucket) => (
              <li key={String(bucket.score)} className="flex items-center gap-3">
                <span className="w-16 shrink-0 text-xs text-muted">
                  {bucket.score === 'unscored' ? 'unscored' : `${bucket.score}/4`}
                </span>
                <div className="h-4 flex-1 overflow-hidden rounded-full bg-edge/40">
                  <div
                    className={`h-full rounded-full transition-[width] duration-500 ease-out ${
                      bucket.score === 4
                        ? 'bg-gradient-to-r from-good/70 to-good'
                        : bucket.score === 'unscored'
                          ? 'bg-muted/50'
                          : 'bg-gradient-to-r from-machine/70 to-machine'
                    }`}
                    style={{ width: `${(bucket.count / max) * 100}%` }}
                  />
                </div>
                <span className="w-6 text-right text-xs text-muted">{bucket.count}</span>
              </li>
            ))}
          </ul>

          {data.disputed > 0 && (
            <p className="mt-4 border-t border-edge pt-3 text-xs text-muted">
              <span className="text-bad">{data.disputed}</span> verdict
              {data.disputed === 1 ? '' : 's'} disputed by a human 👎 — the honest measure of whether
              the rubric works.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
