import { useEffect, useState } from "react";
import { Link } from "../router";
import { Dropdown } from "./Dropdown";

type Theme = "light" | "night" | "auto";

function applyTheme(theme: Theme) {
  const dark = theme === "night" || (theme === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.setAttribute("data-bs-theme", dark ? "dark" : "light");
}

const THEMES: Array<{ value: Theme; label: string; icon: string }> = [
  { value: "light", label: "Light", icon: "bi-sun-fill" },
  { value: "night", label: "Night", icon: "bi-moon-stars-fill" },
  { value: "auto", label: "Auto", icon: "bi-circle-half" },
];

const NAV: Array<{ to: string; label: string; match: (p: string) => boolean }> = [
  { to: "/daily", label: "Daily", match: (p) => p.startsWith("/daily") },
  { to: "/", label: "New Puzzle", match: (p) => p === "/" || p.startsWith("/p/") },
  { to: "/leaderboard", label: "Leaderboard", match: (p) => p.startsWith("/leaderboard") },
  { to: "/about", label: "About", match: (p) => p.startsWith("/about") },
];

export function Navbar({ path }: { path: string }) {
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem("qbx:theme") as Theme | null) ?? "auto");
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    localStorage.setItem("qbx:theme", theme);
    applyTheme(theme);
    if (theme !== "auto") return;
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("auto");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  const current = THEMES.find((t) => t.value === theme)!;
  return (
    <nav className="navbar navbar-expand-lg qbx-navbar">
      <div className="container-fluid">
        <Link className="navbar-brand ms-1 py-0" id="logo" to="/">
          <span className="logo-prefix">QB</span>
          <span className="logo-suffix">Crossword</span>
        </Link>
        <button
          className="navbar-toggler"
          type="button"
          aria-controls="qbx-nav"
          aria-expanded={expanded}
          aria-label="Toggle navigation"
          onClick={() => setExpanded((e) => !e)}
        >
          <span className="navbar-toggler-icon" />
        </button>
        <div className={`collapse navbar-collapse${expanded ? " show" : ""}`} id="qbx-nav">
          <div className="navbar-nav me-auto mb-2 mb-lg-0">
            {NAV.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                className={`nav-link${n.match(path) ? " active" : ""}`}
                aria-current={n.match(path) ? "page" : undefined}
                onClick={() => setExpanded(false)}
              >
                {n.label}
              </Link>
            ))}
          </div>
          <Dropdown
            align="end"
            className="btn btn-link nav-link px-2"
            title="Theme"
            label={<i className={`bi ${current.icon}`} aria-label={`Theme: ${current.label}`} />}
          >
            {THEMES.map((t) => (
              <button
                key={t.value}
                type="button"
                className={`dropdown-item d-flex align-items-center gap-2${t.value === theme ? " active" : ""}`}
                onClick={() => setTheme(t.value)}
              >
                <i className={`bi ${t.icon}`} /> {t.label}
              </button>
            ))}
          </Dropdown>
        </div>
      </div>
    </nav>
  );
}
