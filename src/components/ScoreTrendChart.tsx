import React from 'react';

export interface ScoreTrendPoint {
  label: string; // short x-axis label, e.g. a formatted date
  score: number; // 0-10
}

function scoreColor(score: number) {
  if (score >= 8) return '#10b981'; // emerald-500
  if (score >= 5) return '#f59e0b'; // amber-500
  return '#f43f5e'; // rose-500
}

// Dependency-free inline SVG line chart (no charting library) showing score
// (0-10) across the most recent attempts, oldest to newest left-to-right.
export default function ScoreTrendChart({ points }: { points: ScoreTrendPoint[] }) {
  const width = 600;
  const height = 160;
  const padX = 12;
  const padTop = 12;
  const padBottom = 28;

  if (points.length === 0) {
    return (
      <div className="flex items-center justify-center h-[160px] text-slate-400 text-xs font-semibold">
        Chưa đủ dữ liệu để vẽ biểu đồ xu hướng.
      </div>
    );
  }

  const plotWidth = width - padX * 2;
  const plotHeight = height - padTop - padBottom;
  const stepX = points.length > 1 ? plotWidth / (points.length - 1) : 0;
  const yForScore = (score: number) => padTop + plotHeight * (1 - Math.min(10, Math.max(0, score)) / 10);
  const xForIndex = (idx: number) => padX + stepX * idx;

  const linePoints = points.map((p, idx) => `${xForIndex(idx)},${yForScore(p.score)}`).join(' ');
  const avg = points.reduce((sum, p) => sum + p.score, 0) / points.length;

  // Show at most ~6 x-axis labels to avoid crowding on many points.
  const labelEvery = Math.max(1, Math.ceil(points.length / 6));

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
      {/* Gridlines at 0 / 5 / 10 */}
      {[0, 5, 10].map(gridScore => (
        <line
          key={gridScore}
          x1={padX}
          x2={width - padX}
          y1={yForScore(gridScore)}
          y2={yForScore(gridScore)}
          stroke="#e2e8f0"
          strokeWidth={1}
          strokeDasharray={gridScore === 0 ? undefined : '4 4'}
        />
      ))}

      {/* Average reference line */}
      <line
        x1={padX}
        x2={width - padX}
        y1={yForScore(avg)}
        y2={yForScore(avg)}
        stroke="#6366f1"
        strokeWidth={1}
        strokeDasharray="2 3"
        opacity={0.6}
      />

      <polyline points={linePoints} fill="none" stroke="#6366f1" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

      {points.map((p, idx) => (
        <circle key={idx} cx={xForIndex(idx)} cy={yForScore(p.score)} r={4} fill={scoreColor(p.score)} stroke="white" strokeWidth={1.5} />
      ))}

      {points.map((p, idx) => (
        idx % labelEvery === 0 || idx === points.length - 1 ? (
          <text
            key={idx}
            x={xForIndex(idx)}
            y={height - 8}
            fontSize={9}
            fill="#94a3b8"
            textAnchor={idx === 0 ? 'start' : idx === points.length - 1 ? 'end' : 'middle'}
          >
            {p.label}
          </text>
        ) : null
      ))}
    </svg>
  );
}
