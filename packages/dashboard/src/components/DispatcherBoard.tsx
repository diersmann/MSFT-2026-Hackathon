'use client';

import { useState } from 'react';
import type { BoardCard, Lane } from '@/lib/data';

const LANES: Array<{ id: Lane; title: string; blurb: string; accent: string; dot: string }> = [
  {
    id: 'machine',
    title: 'Copilot agent',
    blurb: 'Outcome determined, diff checkable without opinion',
    accent: 'border-machine/60',
    dot: 'bg-machine',
  },
  {
    id: 'human',
    title: 'Humans',
    blurb: 'Needs taste, a decision, or a conversation',
    accent: 'border-human/60',
    dot: 'bg-human',
  },
  {
    id: 'unsure',
    title: 'Not scored',
    blurb: "The bot said it couldn't judge, rather than inventing a number",
    accent: 'border-edge',
    dot: 'bg-muted',
  },
];

function ScorePips({ score }: { score: number | null }) {
  if (score === null) return <span className="text-xs text-muted">no score</span>;
  return (
    <span className="flex gap-0.5" title={`${score}/4 agent-readiness`}>
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className={`h-1.5 w-3 rounded-full transition-colors ${i < score ? 'bg-good' : 'bg-edge'}`}
        />
      ))}
    </span>
  );
}

function Card({
  card,
  onOverride,
  busy,
}: {
  card: BoardCard;
  onOverride: (card: BoardCard, route: 'mechanical' | 'judgement') => void;
  busy: boolean;
}) {
  const target = card.lane === 'machine' ? 'judgement' : 'mechanical';

  return (
    <li className="group rounded-lg border border-edge bg-panel p-3 shadow-card transition duration-150 hover:-translate-y-0.5 hover:border-slate-500 hover:shadow-lift">
      <div className="flex items-start justify-between gap-2">
        <a
          href={card.url}
          target="_blank"
          rel="noreferrer"
          className="text-sm font-medium leading-snug text-slate-100 transition-colors hover:text-machine hover:underline"
        >
          <span className="text-muted">#{card.number}</span> {card.title}
        </a>
        {card.disputed && (
          <span
            title="A human reacted 👎 to the bot's verdict"
            className="shrink-0 rounded bg-bad/20 px-1.5 py-0.5 text-[10px] font-medium text-bad"
          >
            disputed
          </span>
        )}
      </div>

      <div className="mt-2 flex items-center gap-3">
        <ScorePips score={card.readiness} />
        {card.parent !== null && (
          <span className="text-[11px] text-muted">split from #{card.parent}</span>
        )}
      </div>

      {card.assignees.length > 0 && (
        <div className="mt-1.5 text-[11px] text-muted">{card.assignees.join(', ')}</div>
      )}

      <button
        type="button"
        disabled={busy}
        onClick={() => onOverride(card, target)}
        className="mt-2 w-full rounded border border-edge px-2 py-1 text-[11px] text-muted opacity-0 transition duration-150 focus-visible:opacity-100 group-hover:opacity-100 hover:border-slate-400 hover:bg-panel2 hover:text-slate-200 disabled:opacity-50"
      >
        {busy ? 'working…' : `move to ${target === 'mechanical' ? 'Copilot' : 'humans'}`}
      </button>
    </li>
  );
}

export function DispatcherBoard({ cards, repo }: { cards: BoardCard[]; repo: string }) {
  const [local, setLocal] = useState(cards);
  const [busy, setBusy] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function onOverride(card: BoardCard, route: 'mechanical' | 'judgement') {
    setBusy(card.number);
    setNote(null);

    // Optimistic: the point of an override is that it feels instant. If the
    // request fails we put the card back and say so.
    const previous = local;
    setLocal((cards) =>
      cards.map((c) =>
        c.number === card.number ? { ...c, lane: route === 'mechanical' ? 'machine' : 'human' } : c,
      ),
    );

    try {
      const response = await fetch('/api/reclassify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo, issue: card.number, route }),
      });
      const json = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !json.ok) throw new Error(json.error ?? 'the request failed');
      setNote(`#${card.number} is now ${route}. The override is recorded on the issue.`);
    } catch (error) {
      setLocal(previous);
      setNote(`Could not move #${card.number}: ${(error as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section>
      <div className="mb-4 flex items-baseline justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Dispatcher</h2>
          <p className="mt-1 text-sm text-muted">
            Not a list of work — a split between who should do it. Every card is one click from the
            other lane, because the routing is a guess.
          </p>
        </div>
      </div>

      {note && (
        <div className="animate-fade-in mb-4 rounded border border-edge bg-panel px-3 py-2 text-sm text-slate-300 shadow-card">
          {note}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        {LANES.map((lane) => {
          const items = local.filter((c) => c.lane === lane.id);
          return (
            <div
              key={lane.id}
              className={`rounded-xl border-t-2 ${lane.accent} bg-panel/40 p-3 shadow-card`}
            >
              <div className="mb-1 flex items-center justify-between">
                <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-100">
                  <span className={`h-1.5 w-1.5 rounded-full ${lane.dot}`} />
                  {lane.title}
                </h3>
                <span className="rounded-full bg-panel2 px-2 py-0.5 text-xs text-muted">
                  {items.length}
                </span>
              </div>
              <p className="mb-3 text-[11px] leading-snug text-muted">{lane.blurb}</p>
              <ul className="space-y-2">
                {items.map((card) => (
                  <Card
                    key={card.number}
                    card={card}
                    onOverride={onOverride}
                    busy={busy === card.number}
                  />
                ))}
                {items.length === 0 && (
                  <li className="rounded border border-dashed border-edge px-3 py-6 text-center text-xs text-muted">
                    nothing here
                  </li>
                )}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}
