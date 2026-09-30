import { Navbar } from "./components/Navbar";
import { About } from "./pages/About";
import { Home } from "./pages/Home";
import { LeaderboardPage } from "./pages/LeaderboardPage";
import { CustomPuzzlePage, DailyPage } from "./pages/PuzzlePages";
import { Link, usePath } from "./router";

function Page({ path }: { path: string }) {
  if (path === "/" || path === "") return <Home />;
  if (path.startsWith("/daily")) return <DailyPage />;
  if (path.startsWith("/leaderboard")) return <LeaderboardPage />;
  if (path.startsWith("/about")) return <About />;
  const m = /^\/p\/([A-Za-z0-9_-]+)\/?$/.exec(path);
  if (m) return <CustomPuzzlePage id={m[1]!} />;
  return (
    <div>
      <h1 className="h4">Page not found</h1>
      <Link to="/">Back to the start</Link>
    </div>
  );
}

export function App() {
  const path = usePath();
  return (
    <>
      <Navbar path={path} />
      <main className="container-fluid mt-3 mb-5 px-xxl-5">
        <Page path={path} />
      </main>
      <footer className="container-fluid px-xxl-5 pb-4 small text-body-secondary">
        Questions from{" "}
        <a href="https://www.qbreader.org" target="_blank" rel="noreferrer">
          QB Reader
        </a>{" "}
        database backups.
      </footer>
    </>
  );
}
