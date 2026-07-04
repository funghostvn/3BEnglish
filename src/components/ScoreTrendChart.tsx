import React, { useId } from 'react';

export interface ScoreTrendPoint {
  label: string; // short x-axis label, e.g. a formatted date
  score: number; // 0-10
}

function scoreColor(score: number): string {
  if (score >= 8) return 'var(--score-great)'; // emerald
  if (score >= 5) return 'var(--score-ok)';    // amber
  return 'var(--score-poor)';                   // rose
}

// Build a smooth cubic bezier path through an array of (x,y) points.
// Uses Cardinal-spline-like control points for natural curvature.
function buildSmoothPath(pts: Array<[number, number]>): string {
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M ${pts[0][0]} ${pts[0][1]}`;

  const tension = 0.4; // 0 = straight lines, higher = more curve
  let d = `M ${pts[0][0]} ${pts[0][1]}`;

  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const [prevX, prevY] = i > 0 ? pts[i - 1] : pts[i];
    const [nextX, nextY] = i < pts.length - 2 ? pts[i + 2] : pts[i + 1];

    const cp1x = x0 + (x1 - prevX) * tension;
    const cp1y = y0 + (y1 - prevY) * tension;
    const cp2x = x1 - (nextX - x0) * tension;
    const cp2y = y1 - (nextY - y0) * tension;

    d += ` C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${x1} ${y1}`;
  }
  return d;
}

// Dependency-free inline SVG bezier area chart. Shows score (0-10) across the
// most recent attempts, oldest to newest left-to-right.
export default function ScoreTrendChart({ points }: { points: ScoreTrendPoint[] }) {
  const uid = useId().replace(/:/g, '');
  const gradientId  = `chart-gradient-${uid}`;
  const clipPathId  = `chart-clip-${uid}`;

  const width     = 600;
  const height    = 175;
  const padX      = 14;
  const padTop    = 18;
  const padBottom = 30;

  if (points.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-[175px] gap-2 select-none">
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none" className="opacity-25">
          <path d="M4 24 L10 16 L16 20 L22 10 L28 14" stroke="currentColor" strokeWidth="2.5"
            strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <span className="text-slate-400 dark:text-slate-600 text-xs font-semibold">
          Chưa đủ dữ liệu để vẽ biểu đồ xu hướng.
        </span>
      </div>
    );
  }

  const plotWidth  = width - padX * 2;
  const plotHeight = height - padTop - padBottom;
  const stepX      = points.length > 1 ? plotWidth / (points.length - 1) : 0;

  const yForScore  = (score: number) =>
    padTop + plotHeight * (1 - Math.min(10, Math.max(0, score)) / 10);
  const xForIndex  = (idx: number) => padX + stepX * idx;

  const coords: Array<[number, number]> = points.map((p, i) => [xForIndex(i), yForScore(p.score)]);
  const linePath = buildSmoothPath(coords);

  // Area path: line + descend to baseline on both ends
  const areaPath = [
    linePath,
    `L ${coords[coords.length - 1][0]} ${height - padBottom}`,
    `L ${coords[0][0]} ${height - padBottom}`,
    'Z',
  ].join(' ');

  const avg = points.reduce((sum, p) => sum + p.score, 0) / points.length;
  const avgY = yForScore(avg);

  // Show at most ~6 x-axis labels
  const labelEvery = Math.max(1, Math.ceil(points.length / 6));

  // Determine the last dot's color for the animated pulse
  const lastScore  = points[points.length - 1].score;
  const lastX      = coords[coords.length - 1][0];
  const lastY      = coords[coords.length - 1][1];
  const lastColor  = scoreColor(lastScore);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full h-auto overflow-visible"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Biểu đồ xu hướng điểm số"
    >
      <defs>
        {/* Gradient fill under the line */}
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="var(--chart-line)" stopOpacity="0.30" />
          <stop offset="100%" stopColor="var(--chart-line)" stopOpacity="0.00" />
        </linearGradient>

        {/* Clip so area doesn't overflow bottom */}
        <clipPath id={clipPathId}>
          <rect x={padX} y={padTop} width={plotWidth} height={plotHeight} />
        </clipPath>
      </defs>

      {/* Subtle horizontal grid lines at 0 / 5 / 10 */}
      {[0, 5, 10].map(gridScore => {
        const gy = yForScore(gridScore);
        return (
          <g key={gridScore}>
            <line
              x1={padX} x2={width - padX}
              y1={gy}   y2={gy}
              stroke="var(--chart-grid)"
              strokeWidth={1}
              strokeDasharray={gridScore === 0 ? undefined : '4 4'}
            />
            <text
              x={padX - 4}
              y={gy + 3.5}
              fontSize={8}
              fill="var(--text-muted)"
              textAnchor="end"
              fontFamily="inherit"
            >
              {gridScore}
            </text>
          </g>
        );
      })}

      {/* Average reference line */}
      <line
        x1={padX} x2={width - padX}
        y1={avgY} y2={avgY}
        stroke="var(--chart-avg)"
        strokeWidth={1.5}
        strokeDasharray="3 4"
      />
      <text
        x={width - padX + 2}
        y={avgY + 3.5}
        fontSize={8}
        fill="var(--chart-line)"
        fontFamily="inherit"
        opacity={0.75}
      >
        TB
      </text>

      {/* Gradient area fill */}
      <path
        d={areaPath}
        fill={`url(#${gradientId})`}
        clipPath={`url(#${clipPathId})`}
      />

      {/* Smooth bezier line */}
      <path
        d={linePath}
        fill="none"
        stroke="var(--chart-line)"
        strokeWidth={2.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {/* Score dots */}
      {coords.map(([cx, cy], idx) => {
        const isLast = idx === coords.length - 1;
        const dotColor = scoreColor(points[idx].score);
        return (
          <g key={idx}>
            {/* Outer ring — only on last point (live indicator) */}
            {isLast && (
              <circle
                cx={cx} cy={cy} r={9}
                fill={dotColor}
                opacity={0.18}
              >
                <animate
                  attributeName="r"
                  values="6;11;6"
                  dur="2.4s"
                  repeatCount="indefinite"
                />
                <animate
                  attributeName="opacity"
                  values="0.18;0.04;0.18"
                  dur="2.4s"
                  repeatCount="indefinite"
                />
              </circle>
            )}
            <circle
              cx={cx} cy={cy} r={isLast ? 5 : 4}
              fill={dotColor}
              stroke="var(--surface-card)"
              strokeWidth={2}
            />
          </g>
        );
      })}

      {/* X-axis labels */}
      {points.map((p, idx) => {
        if (idx % labelEvery !== 0 && idx !== points.length - 1) return null;
        const [lx] = coords[idx];
        return (
          <text
            key={idx}
            x={lx}
            y={height - 8}
            fontSize={9}
            fill="var(--text-muted)"
            textAnchor={
              idx === 0 ? 'start' :
              idx === points.length - 1 ? 'end' : 'middle'
            }
            fontFamily="inherit"
          >
            {p.label}
          </text>
        );
      })}

      {/* Score tooltip labels on each dot — appears on hover via CSS trick: 
          We show the value near each dot as a small label */}
      {coords.map(([cx, cy], idx) => {
        const score = points[idx].score;
        const isLast = idx === coords.length - 1;
        return (
          <g key={`lbl-${idx}`} style={{ pointerEvents: 'none' }}>
            <text
              x={cx}
              y={cy - 9}
              fontSize={isLast ? 10 : 8.5}
              fontWeight={isLast ? 700 : 500}
              fill={scoreColor(score)}
              textAnchor="middle"
              fontFamily="inherit"
              opacity={isLast ? 1 : 0.7}
            >
              {score.toFixed(1)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
