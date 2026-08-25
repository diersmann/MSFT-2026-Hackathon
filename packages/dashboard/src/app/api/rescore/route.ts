import {
  azureConfigured,
  clearTreeCache,
  createOctokit,
  ensureLabel,
  fetchIssue,
  parseRepo,
  planLabels,
  READINESS_MARKER,
  reconcileLabels,
  renderComment,
  scoreReadiness,
  upsertComment,
} from '@dispatch/core';
import { NextResponse } from 'next/server';
import { targetRepo } from '@/lib/data';

/**
 * Re-scores one issue live.
 *
 * Uses the same engine and the same MODEL_SCORE deployment as the Actions bot.
 * That is not incidental: if the dashboard scored differently from the comment
 * on the issue, the demo would be contradicting itself on stage.
 */
export async function POST(request: Request) {
  let payload: { issue?: number; force?: boolean };

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'expected a JSON body' }, { status: 400 });
  }

  if (!payload.issue || !Number.isInteger(payload.issue)) {
    return NextResponse.json({ ok: false, error: 'issue must be a number' }, { status: 400 });
  }
  if (!azureConfigured()) {
    return NextResponse.json(
      { ok: false, error: 'Azure OpenAI is not configured on the server' },
      { status: 500 },
    );
  }
  if (!process.env.GITHUB_TOKEN) {
    return NextResponse.json(
      { ok: false, error: 'GITHUB_TOKEN is not configured on the server' },
      { status: 500 },
    );
  }

  try {
    const ref = parseRepo(targetRepo());
    const octokit = createOctokit();
    const issue = await fetchIssue(octokit, ref, payload.issue);

    // The tree cache lives for the lifetime of the server process, so a
    // re-score after a push would otherwise verify paths against a stale tree —
    // and on stage that reads as the tool being wrong.
    clearTreeCache();

    const result = await scoreReadiness(octokit, ref, issue, { force: payload.force ?? false });

    if (result.status === 'skipped') {
      return NextResponse.json({ ok: true, status: 'skipped', reason: result.reason });
    }

    const comment = renderComment(result);
    if (comment) {
      await upsertComment(octokit, ref, payload.issue, READINESS_MARKER, comment);
    }

    const plan = planLabels(result);
    if (plan.add.includes('agent-ready')) {
      await ensureLabel(
        octokit,
        ref,
        'agent-ready',
        '0e8a16',
        'Scored 4/4 by the readiness linter — safe to hand to a coding agent',
      );
    }
    if (plan.add.includes('readiness: unscored')) {
      await ensureLabel(
        octokit,
        ref,
        'readiness: unscored',
        'ededed',
        'The readiness linter could not score this confidently',
      );
    }
    await reconcileLabels(octokit, ref, payload.issue, issue.labels, plan.add, plan.remove);

    return NextResponse.json({
      ok: true,
      status: result.status,
      score: result.status === 'scored' ? result.score : null,
      reason: result.status === 'abstained' ? result.reason : null,
      promptVersion: result.promptVersion,
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 500 });
  }
}
