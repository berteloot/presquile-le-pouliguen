import type { MarineSeries, TideExtreme } from "../lib/types";

interface Props {
  marine: MarineSeries;
  extrema: TideExtreme[];
  now: Date;
}

const W = 600;
const H = 150;
const PAD_X = 8;
const PAD_TOP = 26;
const PAD_BOTTOM = 18;

const fmtTime = new Intl.DateTimeFormat("fr-FR", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Paris",
});

export default function TideChart({ marine, extrema, now }: Props) {
  const windowStart = now.getTime() - 6 * 3600_000;
  const windowEnd = now.getTime() + 18 * 3600_000;

  const points: { t: number; v: number }[] = [];
  for (let i = 0; i < marine.times.length; i++) {
    const t = marine.times[i].getTime();
    const v = marine.seaLevel[i];
    if (v == null || t < windowStart || t > windowEnd) continue;
    points.push({ t, v });
  }
  if (points.length < 2) return null;

  const vMin = Math.min(...points.map((p) => p.v));
  const vMax = Math.max(...points.map((p) => p.v));
  const x = (t: number) =>
    PAD_X + ((t - windowStart) / (windowEnd - windowStart)) * (W - 2 * PAD_X);
  const y = (v: number) =>
    PAD_TOP + (1 - (v - vMin) / (vMax - vMin || 1)) * (H - PAD_TOP - PAD_BOTTOM);

  const line = points.map((p) => `${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const area = `${x(points[0].t).toFixed(1)},${H - PAD_BOTTOM} ${line} ${x(
    points[points.length - 1].t,
  ).toFixed(1)},${H - PAD_BOTTOM}`;

  const visibleExtrema = extrema.filter(
    (e) => e.time.getTime() >= windowStart && e.time.getTime() <= windowEnd,
  );

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="tide-chart"
      role="img"
      aria-label="Courbe de maree sur 24 heures"
    >
      <polygon points={area} className="tide-area" />
      <polyline points={line} className="tide-line" fill="none" />
      {visibleExtrema.map((e, i) => (
        <g key={i}>
          <circle cx={x(e.time.getTime())} cy={y(e.level)} r="3.5" className="tide-dot" />
          <text
            x={x(e.time.getTime())}
            y={e.type === "high" ? y(e.level) - 10 : y(e.level) + 18}
            textAnchor="middle"
            className="tide-label"
          >
            {e.type === "high" ? "haute" : "basse"} {fmtTime.format(e.time)}
          </text>
        </g>
      ))}
      <line
        x1={x(now.getTime())}
        y1={PAD_TOP - 8}
        x2={x(now.getTime())}
        y2={H - PAD_BOTTOM}
        className="tide-now"
      />
      <text x={x(now.getTime())} y={PAD_TOP - 12} textAnchor="middle" className="tide-now-label">
        maintenant
      </text>
    </svg>
  );
}
