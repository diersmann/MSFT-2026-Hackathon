export function Logo({ className = 'h-6 w-6' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      role="img"
      aria-label="GitSolutions"
    >
      <defs>
        <linearGradient id="gs-logo-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#2f81f7" />
          <stop offset="100%" stopColor="#d29922" />
        </linearGradient>
      </defs>
      <rect width="24" height="24" rx="6" fill="url(#gs-logo-bg)" />
      <g
        stroke="#f0f6fc"
        strokeWidth="1.4"
        strokeLinecap="round"
        fill="none"
      >
        <path d="M12 17.3 L12 12.5" />
        <path d="M12 12.5 L7.4 7.3" />
        <path d="M12 12.5 L16.6 7.3" />
      </g>
      <circle cx="12" cy="19" r="1.9" fill="#f0f6fc" />
      <circle cx="7" cy="6.3" r="1.9" fill="#f0f6fc" />
      <circle cx="17" cy="6.3" r="1.9" fill="#f0f6fc" />
    </svg>
  );
}
