/**
 * L2 grounding: the model judges, this module supplies facts.
 *
 * We extract every path-like string an issue mentions and check it against the
 * real git tree. That turns "Context" from a guess into evidence, and catches a
 * failure mode pure text analysis cannot see: an issue naming a file that no
 * longer exists is *stale*, and handing it to a coding agent produces confident
 * flailing. Worse than a vague issue, and invisible without this check.
 */
import type { Octokit } from '@octokit/rest';
import type { TreeContext, VerifiedPath } from './schema.js';

/** Extensions we treat as strong evidence of a real file reference. */
const CODE_EXTENSIONS = [
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'py',
  'rb',
  'go',
  'rs',
  'java',
  'kt',
  'swift',
  'c',
  'h',
  'cpp',
  'hpp',
  'cs',
  'php',
  'sh',
  'bash',
  'sql',
  'graphql',
  'gql',
  'json',
  'yml',
  'yaml',
  'toml',
  'ini',
  'env',
  'md',
  'mdx',
  'txt',
  'css',
  'scss',
  'sass',
  'less',
  'html',
  'vue',
  'svelte',
  'tf',
  'proto',
  'lock',
  'xml',
  'gradle',
  'dockerfile',
];

const EXTENSION_GROUP = CODE_EXTENSIONS.join('|');

/**
 * Path-like: at least one slash OR a known code extension, no spaces.
 * Deliberately conservative — a false path costs the author a confusing
 * "NOT FOUND" line, which is worse than silence.
 */
const PATH_PATTERNS: RegExp[] = [
  new RegExp(`\\b[\\w.@-]+(?:/[\\w.@-]+)+\\.(?:${EXTENSION_GROUP})\\b`, 'gi'),
  new RegExp(`(?:^|[\\s(\`"'])((?:\\./)?[\\w.-]+\\.(?:${EXTENSION_GROUP}))\\b`, 'gi'),
  /\b[\w.-]+(?:\/[\w.-]+)+\/?\b/g,
];

/** Words that look path-ish but are almost always prose or URLs. */
const DENY = new Set([
  'and/or',
  'n/a',
  'w/',
  'i/o',
  'ci/cd',
  'a/b',
  'http',
  'https',
  'e.g',
  'i.e',
  'etc',
  'vs',
]);

function looksLikeUrl(candidate: string, body: string): boolean {
  const index = body.indexOf(candidate);
  if (index < 0) return false;
  const before = body.slice(Math.max(0, index - 12), index);
  return /https?:\/\/[^\s]*$/.test(before) || /@$/.test(before);
}

function plausible(candidate: string): boolean {
  const lower = candidate.toLowerCase();
  if (DENY.has(lower)) return false;
  if (candidate.length < 3 || candidate.length > 200) return false;
  if (/^\d+\/\d+$/.test(candidate)) return false; // "3/4", a score not a path
  if (/^[./]+$/.test(candidate)) return false;

  const hasSlash = candidate.includes('/');
  const extension = /\.([a-z0-9]+)$/i.exec(candidate)?.[1]?.toLowerCase();
  const hasKnownExtension = extension ? CODE_EXTENSIONS.includes(extension) : false;

  if (!hasSlash && !hasKnownExtension) return false;

  // Bare slashed phrases need a directory-ish shape to qualify; this rejects
  // "human/machine" and "planning/tracking" while keeping "src/auth".
  if (hasSlash && !hasKnownExtension) {
    const segments = candidate.split('/').filter(Boolean);
    if (segments.length < 2) return false;
    if (segments.some((s) => s.length > 40)) return false;
    const dirLike = /^(src|lib|app|test|tests|spec|packages|docs|scripts|api|components|pages|public|config|server|client|internal|cmd|pkg|\.github|node_modules|dist|build)$/i;
    if (!dirLike.test(segments[0] ?? '')) return false;
  }

  return true;
}

export function extractPathCandidates(body: string): string[] {
  if (!body) return [];

  // Backticked spans are the strongest signal an author meant a real path.
  const found = new Set<string>();
  for (const match of body.matchAll(/`([^`\n]{2,200})`/g)) {
    const inner = (match[1] ?? '').trim();
    if (plausible(inner) && !looksLikeUrl(inner, body)) found.add(inner.replace(/^\.\//, ''));
  }

  for (const pattern of PATH_PATTERNS) {
    for (const match of body.matchAll(pattern)) {
      const raw = (match[1] ?? match[0] ?? '').trim().replace(/[.,;:)]+$/, '');
      const cleaned = raw.replace(/^\.\//, '');
      if (plausible(cleaned) && !looksLikeUrl(cleaned, body)) found.add(cleaned);
    }
  }

  // Drop candidates that are a suffix of a longer candidate: if the issue says
  // `src/auth/login.ts`, we do not also want a bare `login.ts` row.
  const all = [...found];
  const kept = all.filter(
    (candidate) => !all.some((other) => other !== candidate && other.endsWith(`/${candidate}`)),
  );

  return kept.sort().slice(0, 25);
}

export type TreeCacheEntry = {
  paths: Set<string>;
  directories: Set<string>;
  context: TreeContext;
};

const treeCache = new Map<string, TreeCacheEntry>();

/**
 * Empties the tree cache.
 *
 * The cache is process-level and keyed by commit sha, which is right for a
 * one-shot CLI run but wrong for a long-lived server: a pushed commit would not
 * be picked up until restart. Tests need it too, so a truncated-tree case cannot
 * be answered from an earlier non-truncated fetch.
 */
export function clearTreeCache(): void {
  treeCache.clear();
}

/**
 * Fetches the repo tree once per commit sha. Pinning to a sha is what keeps
 * scores explainable later: repo contents drift, and a score recorded against
 * `treeSha` can still be reasoned about weeks afterward.
 */
export async function loadTree(
  octokit: Octokit,
  owner: string,
  repo: string,
  ref?: string,
): Promise<TreeCacheEntry | null> {
  try {
    let sha = ref;
    if (!sha) {
      const { data } = await octokit.repos.get({ owner, repo });
      sha = data.default_branch;
    }

    const { data: commit } = await octokit.repos.getCommit({ owner, repo, ref: sha });
    const treeSha = commit.sha;

    const cacheKey = `${owner}/${repo}@${treeSha}`;
    const cached = treeCache.get(cacheKey);
    if (cached) return cached;

    const { data: tree } = await octokit.git.getTree({
      owner,
      repo,
      tree_sha: treeSha,
      recursive: 'true',
    });

    const paths = new Set<string>();
    const directories = new Set<string>();
    const topLevel = new Set<string>();

    for (const entry of tree.tree) {
      if (!entry.path) continue;
      paths.add(entry.path);
      if (entry.type === 'tree') directories.add(entry.path);

      const first = entry.path.split('/')[0];
      if (first) topLevel.add(entry.type === 'tree' || entry.path.includes('/') ? `${first}/` : first);
    }

    const entry: TreeCacheEntry = {
      paths,
      directories,
      context: {
        treeSha,
        topLevelPaths: [...topLevel].sort(),
        treeTruncated: Boolean(tree.truncated),
      },
    };

    treeCache.set(cacheKey, entry);
    return entry;
  } catch {
    // Grounding is an enhancement, never a hard dependency. A private repo, a
    // missing token or an empty repo must degrade to L0 rather than fail the run.
    return null;
  }
}

function resolve(candidate: string, tree: TreeCacheEntry): boolean {
  const normalized = candidate.replace(/\/$/, '');
  if (tree.paths.has(normalized) || tree.directories.has(normalized)) return true;

  // A bare filename counts as found if exactly one file in the tree carries it.
  if (!normalized.includes('/')) {
    let hits = 0;
    for (const path of tree.paths) {
      if (path.endsWith(`/${normalized}`)) {
        hits += 1;
        if (hits > 1) break;
      }
    }
    return hits === 1;
  }

  // Tolerate a repo-name or ./ prefix the author may have included.
  for (const path of tree.paths) {
    if (path.endsWith(`/${normalized}`)) return true;
  }

  return false;
}

export type Grounding = {
  paths: VerifiedPath[];
  topLevelPaths: string[];
  treeSha: string | null;
  treeTruncated: boolean;
};

export const EMPTY_GROUNDING: Grounding = {
  paths: [],
  topLevelPaths: [],
  treeSha: null,
  treeTruncated: false,
};

export async function groundPaths(
  octokit: Octokit,
  owner: string,
  repo: string,
  body: string,
): Promise<Grounding> {
  const candidates = extractPathCandidates(body);
  const tree = await loadTree(octokit, owner, repo);

  if (!tree) {
    // Report candidates without a verdict rather than claiming they are missing.
    return { ...EMPTY_GROUNDING, paths: [] };
  }

  return {
    paths: candidates.map((path) => ({ path, exists: resolve(path, tree) })),
    topLevelPaths: tree.context.topLevelPaths,
    treeSha: tree.context.treeSha,
    treeTruncated: tree.context.treeTruncated,
  };
}
