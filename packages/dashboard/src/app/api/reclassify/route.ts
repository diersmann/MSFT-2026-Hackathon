import {
  assignCopilot,
  copilotActorId,
  createOctokit,
  fetchIssue,
  parseRepo,
  reconcileLabels,
} from '@dispatch/core';
import { NextResponse } from 'next/server';
import { targetRepo } from '@/lib/data';

/**
 * Human override for a routing decision.
 *
 * This is the one write the dashboard performs, and it exists because the
 * classify step is a guess. Overriding has to be cheaper than arguing with the
 * bot, or people will just stop trusting the board.
 *
 * The override is also recorded as a comment on the issue: a disagreement is
 * more valuable evidence than the original classification, and it should live
 * where the team can see it rather than only in a dashboard.
 */
export async function POST(request: Request) {
  let payload: { repo?: string; issue?: number; route?: string };

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'expected a JSON body' }, { status: 400 });
  }

  const route = payload.route;
  if (route !== 'mechanical' && route !== 'judgement') {
    return NextResponse.json(
      { ok: false, error: 'route must be "mechanical" or "judgement"' },
      { status: 400 },
    );
  }
  if (!payload.issue || !Number.isInteger(payload.issue)) {
    return NextResponse.json({ ok: false, error: 'issue must be a number' }, { status: 400 });
  }

  // Only ever write to the configured repo. Accepting an arbitrary repo from the
  // request body would turn this route into an open relay for anyone who finds it.
  // Checked before any server-config check so the boundary holds regardless of
  // how the deployment is configured.
  const allowed = targetRepo();
  if (payload.repo && payload.repo !== allowed) {
    return NextResponse.json(
      { ok: false, error: `this deployment can only modify ${allowed}` },
      { status: 403 },
    );
  }

  if (!process.env.GITHUB_TOKEN) {
    return NextResponse.json(
      { ok: false, error: 'GITHUB_TOKEN is not configured on the server' },
      { status: 500 },
    );
  }

  try {
    const ref = parseRepo(allowed);
    const octokit = createOctokit();
    const issue = await fetchIssue(octokit, ref, payload.issue);

    await reconcileLabels(
      octokit,
      ref,
      payload.issue,
      issue.labels,
      [route],
      [route === 'mechanical' ? 'judgement' : 'mechanical'],
    );

    let assigned = false;
    if (route === 'mechanical') {
      const actorId = await copilotActorId(octokit, ref);
      if (actorId) assigned = await assignCopilot(octokit, ref, payload.issue, actorId);
    } else {
      try {
        await octokit.issues.removeAssignees({
          ...ref,
          issue_number: payload.issue,
          assignees: ['Copilot'],
        });
      } catch {
        // Nothing assigned, or a login mismatch. The label is what the board reads.
      }
    }

    await octokit.issues.createComment({
      ...ref,
      issue_number: payload.issue,
      body: [
        `Reclassified as **${route}** from the dispatcher board.`,
        '',
        route === 'mechanical'
          ? assigned
            ? 'Assigned to the Copilot coding agent.'
            : 'The Copilot coding agent could not be assigned automatically — assign it manually if you want it on this.'
          : 'Left for a human.',
        '',
        '<sub>A human overriding the classifier is better evidence than the classifier agreeing with itself.</sub>',
      ].join('\n'),
    });

    return NextResponse.json({ ok: true, route, assigned });
  } catch (error) {
    return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 500 });
  }
}
