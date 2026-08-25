export type ParsedArgs = {
  flags: Record<string, string | boolean>;
  positional: string[];
};

export function parseArgs(argv: string[]): ParsedArgs {
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg) continue;

    if (arg.startsWith('--')) {
      const [key, inline] = arg.slice(2).split('=');
      if (!key) continue;
      if (inline !== undefined) {
        flags[key] = inline;
      } else {
        const next = argv[i + 1];
        if (next && !next.startsWith('--')) {
          flags[key] = next;
          i += 1;
        } else {
          flags[key] = true;
        }
      }
    } else {
      positional.push(arg);
    }
  }

  return { flags, positional };
}

export function requireString(args: ParsedArgs, name: string): string {
  const value = args.flags[name];
  if (typeof value !== 'string' || !value) {
    throw new Error(`--${name} is required`);
  }
  return value;
}

export function optionalNumber(args: ParsedArgs, name: string): number | undefined {
  const value = args.flags[name];
  if (value === undefined || typeof value === 'boolean') return undefined;
  const parsed = Number(value);
  if (Number.isNaN(parsed)) throw new Error(`--${name} must be a number`);
  return parsed;
}

export function boolFlag(args: ParsedArgs, name: string): boolean {
  return args.flags[name] === true || args.flags[name] === 'true';
}
