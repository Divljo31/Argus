export function SauronEye({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      stroke="#e8e6e1"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M 8 50 Q 50 8 92 50 Q 50 92 8 50 Z" />
      <ellipse cx="50" cy="50" rx="30" ry="20" />
      <ellipse cx="50" cy="50" rx="18" ry="14" />
      <path d="M 50 36 L 50 64" strokeWidth="3" />
      <path d="M 4 50 Q 1 48 -2 50" opacity="0.7" />
      <path d="M 96 50 Q 99 48 102 50" opacity="0.7" />
      <path d="M 20 28 Q 18 24 19 20" opacity="0.5" />
      <path d="M 80 28 Q 82 24 81 20" opacity="0.5" />
      <path d="M 20 72 Q 18 76 19 80" opacity="0.5" />
      <path d="M 80 72 Q 82 76 81 80" opacity="0.5" />
    </svg>
  );
}
