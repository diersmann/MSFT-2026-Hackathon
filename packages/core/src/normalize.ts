/**
 * Turns a raw GitHub issue body into something worth scoring.
 *
 * Issue-form output is not prose. It carries hint boilerplate, organizer
 * notices, and a literal `_No response_` marker where the author skipped a
 * field. Feed that raw to a model and it scores the wrong text — so this module
 * does the unglamorous work that decides whether the rubric means anything.
 */

/** GitHub renders exactly this for a skipped optional issue-form field. */
const NO_RESPONSE = '_No response_';

export const MAX_BODY_CHARS = 8000;

export type NormalizedBody = {
  body: string;
  sections: Record<string, string>;
  emptySections: string[];
  images: number;
  links: string[];
  truncated: boolean;
};

/** Strips `<!-- ... -->`, including the multi-line hints issue forms leave behind. */
function stripHtmlComments(input: string): string {
  return input.replace(/<!--[\s\S]*?-->/g, '');
}

/**
 * Removes GitHub alert blocks whose content is meta-commentary about the
 * repository rather than the work. Every seeded issue in the organizer repo
 * opens with "Example issue, seeded by the organizers" — scoring that text
 * measures the hackathon, not the issue.
 */
function stripMetaAlerts(input: string): string {
  const lines = input.split('\n');
  const out: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? '';
    const alertStart = /^>\s*\[!(NOTE|IMPORTANT|WARNING|TIP|CAUTION)\]\s*$/i.test(line.trim());

    if (!alertStart) {
      out.push(line);
      index += 1;
      continue;
    }

    const block: string[] = [line];
    let cursor = index + 1;
    while (cursor < lines.length && (lines[cursor] ?? '').trimStart().startsWith('>')) {
      block.push(lines[cursor] ?? '');
      cursor += 1;
    }

    const text = block.join(' ').toLowerCase();
    const isMeta =
      /seeded by the organiz/.test(text) ||
      /example issue/.test(text) ||
      /do not edit|don't edit/.test(text) ||
      /submit your own idea/.test(text);

    if (!isMeta) out.push(...block);
    index = cursor;
  }

  return out.join('\n');
}

/**
 * Replaces images with counted placeholders. The model cannot see them, but it
 * must know they exist — otherwise it fails Context on issues that attached a
 * perfectly good screenshot.
 */
function extractImages(input: string): { text: string; count: number } {
  let count = 0;

  const withMarkdown = input.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, alt: string) => {
    count += 1;
    const name = alt.trim() || 'attachment';
    return `[image: ${name}]`;
  });

  const withHtml = withMarkdown.replace(/<img\b[^>]*>/gi, (match) => {
    count += 1;
    const alt = /alt=["']([^"']*)["']/i.exec(match)?.[1];
    return `[image: ${alt?.trim() || 'attachment'}]`;
  });

  return { text: withHtml, count };
}

function extractLinks(input: string): string[] {
  const links = new Set<string>();

  for (const match of input.matchAll(/\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g)) {
    if (match[1]) links.add(match[1]);
  }
  for (const match of input.matchAll(/(?<![(\]])\bhttps?:\/\/[^\s<>()[\]]+/g)) {
    links.add(match[0].replace(/[.,;:]+$/, ''));
  }

  return [...links];
}

/**
 * Splits `### Heading` sections into named fields. Issue-form sections are
 * structure, not prose: "How will you know it's done?" is direct evidence for
 * the observable-outcome signal, and losing that boundary throws the signal away.
 */
function parseSections(input: string): {
  sections: Record<string, string>;
  emptySections: string[];
} {
  const sections: Record<string, string> = {};
  const emptySections: string[] = [];

  const headingPattern = /^#{2,4}\s+(.+?)\s*$/gm;
  const matches = [...input.matchAll(headingPattern)];

  for (let i = 0; i < matches.length; i += 1) {
    const match = matches[i];
    if (!match || match.index === undefined) continue;

    const heading = (match[1] ?? '').trim();
    const start = match.index + match[0].length;
    const nextMatch = matches[i + 1];
    const end = nextMatch?.index ?? input.length;
    const content = input.slice(start, end).trim();

    sections[heading] = content;
    if (!content || content === NO_RESPONSE) emptySections.push(heading);
  }

  return { sections, emptySections };
}

/** Truncates on a paragraph boundary so the model never sees a severed sentence. */
function truncateAtParagraph(input: string, limit: number): { text: string; truncated: boolean } {
  if (input.length <= limit) return { text: input, truncated: false };

  const window = input.slice(0, limit);
  const breakAt = window.lastIndexOf('\n\n');
  const cut = breakAt > limit * 0.5 ? breakAt : window.lastIndexOf('\n');
  const safe = cut > limit * 0.3 ? cut : limit;

  return { text: input.slice(0, safe).trimEnd(), truncated: true };
}

function collapseBlankLines(input: string): string {
  return input.replace(/\n{3,}/g, '\n\n').trim();
}

export function normalizeBody(raw: string | null | undefined): NormalizedBody {
  if (!raw || !raw.trim()) {
    return {
      body: '',
      sections: {},
      emptySections: [],
      images: 0,
      links: [],
      truncated: false,
    };
  }

  const withoutComments = stripHtmlComments(raw.replace(/\r\n/g, '\n'));
  const withoutMeta = stripMetaAlerts(withoutComments);
  const { text: withPlaceholders, count: images } = extractImages(withoutMeta);
  const links = extractLinks(withPlaceholders);
  const collapsed = collapseBlankLines(withPlaceholders);
  const { text, truncated } = truncateAtParagraph(collapsed, MAX_BODY_CHARS);
  const { sections, emptySections } = parseSections(text);

  return { body: text, sections, emptySections, images, links, truncated };
}
