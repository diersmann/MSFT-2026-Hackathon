import { Octokit } from '@octokit/rest';

export type RepoRef = { owner: string; repo: string };

export function parseRepo(nameWithOwner: string): RepoRef {
  const [owner, repo] = nameWithOwner.split('/');
  if (!owner || !repo) {
    throw new Error(`Expected owner/repo, got "${nameWithOwner}"`);
  }
  return { owner, repo };
}

export function createOctokit(token?: string): Octokit {
  const auth = token ?? process.env.GITHUB_TOKEN;
  if (!auth) {
    throw new Error('GITHUB_TOKEN is not set. Needed to read issues and post comments.');
  }
  return new Octokit({ auth });
}

export type IssueSnapshot = {
  number: number;
  title: string;
  body: string | null;
  labels: string[];
  state: string;
  isPullRequest: boolean;
  authorType: string;
  createdAt: string;
  closedAt: string | null;
  htmlUrl: string;
};

function labelNames(labels: unknown): string[] {
  if (!Array.isArray(labels)) return [];
  return labels
    .map((label) => (typeof label === 'string' ? label : (label as { name?: string })?.name))
    .filter((name): name is string => Boolean(name));
}

export async function fetchIssue(
  octokit: Octokit,
  ref: RepoRef,
  issueNumber: number,
): Promise<IssueSnapshot> {
  const { data } = await octokit.issues.get({ ...ref, issue_number: issueNumber });
  return {
    number: data.number,
    title: data.title,
    body: data.body ?? null,
    labels: labelNames(data.labels),
    state: data.state,
    isPullRequest: Boolean(data.pull_request),
    authorType: data.user?.type ?? 'User',
    createdAt: data.created_at,
    closedAt: data.closed_at ?? null,
    htmlUrl: data.html_url,
  };
}

export async function listIssues(
  octokit: Octokit,
  ref: RepoRef,
  options: { state?: 'open' | 'closed' | 'all'; limit?: number } = {},
): Promise<IssueSnapshot[]> {
  const limit = options.limit ?? 200;
  const out: IssueSnapshot[] = [];

  for await (const response of octokit.paginate.iterator(octokit.issues.listForRepo, {
    ...ref,
    state: options.state ?? 'all',
    per_page: 100,
  })) {
    for (const data of response.data) {
      if (data.pull_request) continue;
      out.push({
        number: data.number,
        title: data.title,
        body: data.body ?? null,
        labels: labelNames(data.labels),
        state: data.state,
        isPullRequest: false,
        authorType: data.user?.type ?? 'User',
        createdAt: data.created_at,
        closedAt: data.closed_at ?? null,
        htmlUrl: data.html_url,
      });
      if (out.length >= limit) return out;
    }
  }

  return out;
}

/**
 * Posts or updates the single bot comment identified by `marker`.
 *
 * Idempotent by design: on `issues.edited` we must replace the previous verdict
 * rather than stack a new one. A linter that comments five times on one issue is
 * the reason people mute bots.
 */
export async function upsertComment(
  octokit: Octokit,
  ref: RepoRef,
  issueNumber: number,
  marker: string,
  body: string,
): Promise<{ action: 'created' | 'updated'; id: number; url: string }> {
  const existing = await octokit.paginate(octokit.issues.listComments, {
    ...ref,
    issue_number: issueNumber,
    per_page: 100,
  });

  const mine = existing.find((comment) => comment.body?.includes(marker));

  if (mine) {
    const { data } = await octokit.issues.updateComment({
      ...ref,
      comment_id: mine.id,
      body,
    });
    return { action: 'updated', id: data.id, url: data.html_url };
  }

  const { data } = await octokit.issues.createComment({
    ...ref,
    issue_number: issueNumber,
    body,
  });
  return { action: 'created', id: data.id, url: data.html_url };
}

export async function ensureLabel(
  octokit: Octokit,
  ref: RepoRef,
  name: string,
  color: string,
  description: string,
): Promise<void> {
  try {
    await octokit.issues.getLabel({ ...ref, name });
  } catch {
    try {
      await octokit.issues.createLabel({ ...ref, name, color, description });
    } catch {
      // Racing another workflow run, or no permission. Labelling is cosmetic
      // relative to the comment, so never let it break the run.
    }
  }
}

/** Applies `add` and removes `remove`, tolerating labels that are already correct. */
export async function reconcileLabels(
  octokit: Octokit,
  ref: RepoRef,
  issueNumber: number,
  current: string[],
  add: string[],
  remove: string[],
): Promise<void> {
  const toAdd = add.filter((label) => !current.includes(label));
  const toRemove = remove.filter((label) => current.includes(label));

  if (toAdd.length) {
    try {
      await octokit.issues.addLabels({ ...ref, issue_number: issueNumber, labels: toAdd });
    } catch {
      // ignore
    }
  }

  for (const label of toRemove) {
    try {
      await octokit.issues.removeLabel({ ...ref, issue_number: issueNumber, name: label });
    } catch {
      // ignore
    }
  }
}

export async function getReactionTally(
  octokit: Octokit,
  ref: RepoRef,
  commentId: number,
): Promise<Record<string, number>> {
  const tally: Record<string, number> = {};
  try {
    const reactions = await octokit.paginate(octokit.reactions.listForIssueComment, {
      ...ref,
      comment_id: commentId,
      per_page: 100,
    });
    for (const reaction of reactions) {
      tally[reaction.content] = (tally[reaction.content] ?? 0) + 1;
    }
  } catch {
    // ignore
  }
  return tally;
}
