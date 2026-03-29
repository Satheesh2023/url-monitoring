import { useMemo } from "react";
import { Link, NavLink, Route, Routes } from "react-router-dom";
import TargetDetail from "./pages/TargetDetail";
import TargetList from "./pages/TargetList";

/** Brand red from Tricog artwork */
const TRICOG_RED = "#D64545";

function TricogHeartMark() {
  return (
    <div className="flex items-center gap-2 whitespace-nowrap">
      <span
        className="relative text-[1.6rem] font-bold leading-none tracking-tight text-white lowercase sm:text-[1.85rem]"
        style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif" }}
      >
        tr
        <span className="relative inline-block px-[0.03em]">
          <span
            className="absolute -top-1 left-1/2 size-2 -translate-x-1/2 rounded-full sm:size-2.5"
            style={{ backgroundColor: TRICOG_RED }}
            aria-hidden
          />
          i
        </span>
        cog
      </span>
      <svg
        className="h-9 w-9 shrink-0 sm:h-10 sm:w-10"
        viewBox="0 0 24 24"
        fill={TRICOG_RED}
        aria-hidden
      >
        <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
      </svg>
    </div>
  );
}

type MarkPlace = {
  left: number;
  top: number;
  scale: number;
  rotate: number;
  opacity: number;
};

function dist(a: { left: number; top: number }, b: { left: number; top: number }) {
  return Math.hypot(a.left - b.left, a.top - b.top);
}

function randomBackdropMarks(count: number): MarkPlace[] {
  const marks: MarkPlace[] = [];
  const minSep = 22;
  for (let i = 0; i < count; i++) {
    let left = 50;
    let top = 50;
    for (let attempt = 0; attempt < 50; attempt++) {
      left = 12 + Math.random() * 76;
      top = 10 + Math.random() * 78;
      const ok = marks.every((m) => dist(m, { left, top }) >= minSep);
      if (ok) break;
    }
    marks.push({
      left,
      top,
      scale: 0.72 + Math.random() * 0.48,
      rotate: -14 + Math.random() * 28,
      opacity: 0.2 + Math.random() * 0.16,
    });
  }
  return marks;
}

function BrandBackdrop() {
  const marks = useMemo(() => randomBackdropMarks(6), []);

  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden>
      {marks.map((m, i) => (
        <div
          key={i}
          className="absolute select-none"
          style={{
            left: `${m.left}%`,
            top: `${m.top}%`,
            transform: `translate(-50%, -50%) scale(${m.scale}) rotate(${m.rotate}deg)`,
            opacity: m.opacity,
          }}
        >
          <TricogHeartMark />
        </div>
      ))}
    </div>
  );
}

export default function App() {
  return (
    <div className="relative min-h-screen">
      <BrandBackdrop />
      <div className="relative z-10 min-h-screen">
        <header className="border-b border-zinc-800 bg-zinc-900/80 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
            <Link to="/" className="text-lg font-semibold tracking-tight text-white">
              Health Monitor
            </Link>
            <nav className="flex gap-4 text-sm text-zinc-400">
              <NavLink
                to="/"
                className={({ isActive }) => (isActive ? "text-emerald-400" : "hover:text-zinc-200")}
                end
              >
                Targets
              </NavLink>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-8">
          <Routes>
            <Route path="/" element={<TargetList />} />
            <Route path="/targets/:id" element={<TargetDetail />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
