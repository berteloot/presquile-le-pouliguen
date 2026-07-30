import type { MoonInfo } from "../lib/tides";

interface Props {
  moon: MoonInfo;
  formatDateTime: Intl.DateTimeFormat;
}

function moonLitPath(radius: number, fraction: number) {
  const waxing = fraction < 0.5;
  const folded = waxing ? fraction : 1 - fraction;
  const rx = Math.abs(radius * Math.cos(2 * Math.PI * folded));
  const gibbous = folded > 0.25;
  const sweep = gibbous ? 1 : 0;
  return {
    d: [
      `M 0 ${-radius}`,
      `A ${radius} ${radius} 0 0 1 0 ${radius}`,
      `A ${rx.toFixed(3)} ${radius} 0 0 ${sweep} 0 ${-radius}`,
      "Z",
    ].join(" "),
    mirror: !waxing,
  };
}

function formatPercent(value: number): string {
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1).replace(".", ",");
}

export default function MoonPhase({ moon, formatDateTime }: Props) {
  const lit = moonLitPath(42, moon.phaseFraction);
  const glowOpacity = 0.16 + 0.42 * (moon.illumination / 100);

  return (
    <div className="moon-panel">
      <svg
        className="moon-visual"
        viewBox="-54 -54 108 108"
        role="img"
        aria-label={`${moon.phaseName}, lune éclairée à ${formatPercent(moon.illumination)} %`}
      >
        <defs>
          <radialGradient id="moon-lit-gradient" cx="38%" cy="34%" r="78%">
            <stop offset="0%" stopColor="#fff7e8" />
            <stop offset="70%" stopColor="#f4e4c8" />
            <stop offset="100%" stopColor="#d8c49f" />
          </radialGradient>
          <clipPath id="moon-disc-clip">
            <circle cx="0" cy="0" r="42" />
          </clipPath>
        </defs>
        <circle cx="0" cy="0" r="52" fill="#d6ecfa" opacity={glowOpacity} />
        <circle cx="0" cy="0" r="42" fill="#13324d" />
        <circle cx="0" cy="0" r="42" fill="none" stroke="#51738b" strokeWidth="1" />
        <g transform={lit.mirror ? "scale(-1,1)" : undefined}>
          <path d={lit.d} fill="url(#moon-lit-gradient)" />
        </g>
        <g clipPath="url(#moon-disc-clip)" fill="#8c795e" opacity="0.14" pointerEvents="none">
          <ellipse cx="-14" cy="-17" rx="10" ry="8" />
          <ellipse cx="8" cy="-22" rx="7" ry="6" />
          <ellipse cx="-21" cy="7" rx="8" ry="11" />
          <ellipse cx="7" cy="5" rx="13" ry="10" />
          <ellipse cx="20" cy="-5" rx="6" ry="8" />
          <ellipse cx="-5" cy="23" rx="7" ry="5" />
        </g>
      </svg>

      <div className="moon-copy">
        <div className="moon-title-row">
          <strong>{moon.phaseName}</strong>
          <span>{formatPercent(moon.illumination)} % éclairée</span>
        </div>
        <p>
          Âge {moon.ageDays} j sur une lunaison de {moon.lunationLengthDays} j.
        </p>
        <dl className="moon-events">
          <div>
            <dt>Nouvelle lune</dt>
            <dd>{formatDateTime.format(moon.nextNewMoon)}</dd>
          </div>
          <div>
            <dt>Pleine lune</dt>
            <dd>{formatDateTime.format(moon.nextFullMoon)}</dd>
          </div>
        </dl>
        <p className="moon-tide-note">
          Vives-eaux attendues autour du {formatDateTime.format(moon.nextStrongTideWindow)},
          environ 36 h après la {moon.strongTideBasis}.
        </p>
      </div>
    </div>
  );
}
