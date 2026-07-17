/**
 * The signature element: jade match score ring. Conic jade fill over
 * the track, surface inner disc, mono score. 80 and above renders the
 * number in jade.
 */
export function ScoreRing({ score, size = 36 }: { score: number; size?: number }) {
  const clamped = Math.max(0, Math.min(100, score));
  return (
    <span
      aria-label={`Match score ${clamped}`}
      className="flex shrink-0 items-center justify-center rounded-pill"
      style={{
        width: size,
        height: size,
        background: `conic-gradient(var(--jade) ${clamped}%, var(--track) 0)`,
      }}
    >
      <span
        className="flex items-center justify-center rounded-pill bg-surface font-mono font-medium"
        style={{
          width: size - 8,
          height: size - 8,
          fontSize: size >= 48 ? 13 : 10,
          color: clamped >= 80 ? "var(--jade)" : "var(--text)",
        }}
      >
        {clamped}
      </span>
    </span>
  );
}
