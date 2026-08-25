import { createOctokit, parseRepo, type RepoRef } from '@dispatch/core';

export type Lane = 'machine' | 'human' | 'unsure';

export type BoardCard = {
  number: number;
  title: string;
  url: string;
  labels: string[];
  state: string;
  assignees: string[];
  lane: Lane;
  /** Derived from the agent-ready / readiness: unscored labels. */
  readiness: number | null;
  unscored: boolean;
  parent: number | null;
  createdAt: string;
  /** Someone reacted 👎 to the bot's verdict. */
  disputed: boolean;
};

export type BoardData = {
  repo: string;
  generatedAt: string;
  cards: BoardCard[];
  error?: string;
};

export function targetRepo(): string {
  return process.env.DISPATCH_TARGET_REPO ?? 'diersmann/MSFT-2026-Hackathon';
}

/**
 * Lane assignment reads the labels the bot wrote, rather than re-running the
 * model. The board and the issues must agree — a dashboard that disagrees with
 * the comment thread is worse than no dashboard.
 */
function laneFor(labels: string[], assignees: string[]): Lane {
  const assignedToAgent = assignees.some((a) => /copilot/i.test(a));
  if (labels.includes('mechanical') || assignedToAgent) return 'machine';
  if (labels.includes('judgement')) return 'human';
  if (labels.includes('readiness: unscored')) return 'unsure';
  if (labels.includes('agent-ready')) return 'machine';
  return 'human';
}

type GraphQlIssue = {
  number: number;
  title: string;
  url: string;
  state: string;
  createdAt: string;
  labels: { nodes: Array<{ name: string }> };
  assignees: { nodes: Array<{ login: string }> };
  parent: { number: number } | null;
  comments: {
    nodes: Array<{
      body: string;
      reactions: { nodes: Array<{ content: string }> };
    }>;
  };
};

/**
 * One GraphQL query rather than a REST fan-out. Sub-issue parentage and comment
 * reactions are only available here, and they are what make the board more than
 * a list.
 */
const QUERY = `
query($owner:String!, $repo:String!) {
  repository(owner:$owner, name:$repo) {
    issues(first:100, states:[OPEN, CLOSED], orderBy:{field:CREATED_AT, direction:DESC}) {
      nodes {
        number
        title
        url
        state
        createdAt
        labels(first:20) { nodes { name } }
        assignees(first:10) { nodes { login } }
        parent { number }
        comments(last:20) {
          nodes {
            body
            reactions(first:20) { nodes { content } }
          }
        }
      }
    }
  }
}`;

function readinessFromComments(comments: GraphQlIssue['comments']['nodes']): {
  score: number | null;
  unscored: boolean;
  disputed: boolean;
} {
  const botComment = comments.find((c) => c.body.includes('<!-- dispatch:readiness -->'));
  if (!botComment) return { score: null, unscored: false, disputed: false };

  const match = /Agent-readiness (\d)\/4/.exec(botComment.body);
  const unscored = botComment.body.includes('not scored');
  const disputed = botComment.reactions.nodes.some((r) => r.content === 'THUMBS_DOWN');

  return {
    score: match?.[1] ? Number(match[1]) : null,
    unscored,
    disputed,
  };
}

export async function loadBoard(repoArg?: string): Promise<BoardData> {
  const repo = repoArg ?? targetRepo();
  const generatedAt = new Date().toISOString();

  let ref: RepoRef;
  try {
    ref = parseRepo(repo);
  } catch (error) {
    return { repo, generatedAt, cards: [], error: (error as Error).message };
  }

  if (!process.env.GITHUB_TOKEN) {
    return {
      repo,
      generatedAt,
      cards: [],
      error: 'GITHUB_TOKEN is not set, so there is nothing to show. Set it and reload.',
    };
  }

  try {
    const octokit = createOctokit();
    const result = await octokit.graphql<{
      repository: { issues: { nodes: GraphQlIssue[] } };
    }>(QUERY, { owner: ref.owner, repo: ref.repo });

    const cards: BoardCard[] = result.repository.issues.nodes.map((issue) => {
      const labels = issue.labels.nodes.map((l) => l.name);
      const assignees = issue.assignees.nodes.map((a) => a.login);
      const { score, unscored, disputed } = readinessFromComments(issue.comments.nodes);

      return {
        number: issue.number,
        title: issue.title,
        url: issue.url,
        labels,
        state: issue.state,
        assignees,
        lane: laneFor(labels, assignees),
        readiness: score,
        unscored,
        parent: issue.parent?.number ?? null,
        createdAt: issue.createdAt,
        disputed,
      };
    });

    return { repo, generatedAt, cards };
  } catch (error) {
    return { repo, generatedAt, cards: [], error: (error as Error).message };
  }
}

export type Distribution = {
  buckets: Array<{ score: number | 'unscored'; count: number }>;
  total: number;
  disputed: number;
};

/**
 * The dispatcher lanes are a to-do list, so a closed issue is noise there. Split
 * trees and the distribution deliberately keep them: a tree without its finished
 * children reports the wrong progress, and a distribution of only open issues
 * would flatter the rubric by hiding everything already dealt with.
 */
export function openOnly(cards: BoardCard[]): BoardCard[] {
  return cards.filter((card) => card.state !== 'CLOSED');
}

export function distribution(cards: BoardCard[]): Distribution {
  const scored = cards.filter((c) => c.readiness !== null);

  const buckets: Distribution['buckets'] = [0, 1, 2, 3, 4].map((score) => ({
    score,
    count: scored.filter((c) => c.readiness === score).length,
  }));
  buckets.push({ score: 'unscored', count: cards.filter((c) => c.unscored).length });

  return {
    buckets,
    total: scored.length,
    disputed: cards.filter((c) => c.disputed).length,
  };
}

export type SplitTree = {
  parent: BoardCard;
  /** Open children only — what is left to do. */
  children: BoardCard[];
  /** Counts over every child, so the progress bar matches GitHub's own rollup. */
  total: number;
  done: number;
};

export function splitTrees(cards: BoardCard[]): SplitTree[] {
  const byNumber = new Map(cards.map((c) => [c.number, c]));
  const grouped = new Map<number, BoardCard[]>();

  for (const card of cards) {
    if (card.parent === null) continue;
    const list = grouped.get(card.parent) ?? [];
    list.push(card);
    grouped.set(card.parent, list);
  }

  const trees: SplitTree[] = [];
  for (const [parentNumber, children] of grouped) {
    const parent = byNumber.get(parentNumber);
    if (!parent) continue;

    // done and total span every child, including the closed ones now hidden
    // below. A tree that counted only what it displays would sit at 0/2 forever
    // and report the opposite of progress.
    trees.push({
      parent,
      children: openOnly(children).sort((a, b) => a.number - b.number),
      total: children.length,
      done: children.filter((c) => c.state === 'CLOSED').length,
    });
  }

  // An epic whose children are all closed is finished, so it drops off the board
  // along with them.
  return trees
    .filter((tree) => tree.children.length > 0)
    .sort((a, b) => b.parent.number - a.parent.number);
}
