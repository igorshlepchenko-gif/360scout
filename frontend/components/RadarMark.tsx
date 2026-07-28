export default function RadarMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" style={{ flexShrink: 0, overflow: "visible" }}>
      <defs>
        <linearGradient id="radarSweepGradient" x1="32" y1="32" x2="32" y2="2" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#22D3EE" stopOpacity="0" />
          <stop offset="1" stopColor="#22D3EE" stopOpacity="0.85" />
        </linearGradient>
      </defs>

      <circle cx="32" cy="32" r="30" fill="none" stroke="#0E6E82" strokeWidth="1.5" opacity="0.55" />
      <circle cx="32" cy="32" r="19" fill="none" stroke="#0E6E82" strokeWidth="1.5" opacity="0.55" />
      <circle cx="32" cy="32" r="8"  fill="none" stroke="#0E6E82" strokeWidth="1.5" opacity="0.55" />

      <g className="radar-sweep">
        <path d="M32 32 L32 2 A30 30 0 0 1 51.3 9 Z" fill="url(#radarSweepGradient)" />
      </g>

      <circle cx="46" cy="21" r="2.2" fill="#22D3EE" style={{ animation: "pulse 2.2s ease-in-out infinite", animationDelay: "0s" }} />
      <circle cx="17" cy="41" r="2.2" fill="#22D3EE" style={{ animation: "pulse 2.2s ease-in-out infinite", animationDelay: "0.7s" }} />
      <circle cx="40" cy="47" r="2.2" fill="#22D3EE" style={{ animation: "pulse 2.2s ease-in-out infinite", animationDelay: "1.4s" }} />

      <circle cx="32" cy="32" r="2.6" fill="#22D3EE" />
    </svg>
  );
}
