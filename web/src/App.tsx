import { Link, NavLink, Route, Routes } from "react-router-dom";
import TargetDetail from "./pages/TargetDetail";
import TargetList from "./pages/TargetList";

export default function App() {
  return (
    <div className="min-h-screen">
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
  );
}
