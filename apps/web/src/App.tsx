import { Link, NavLink, Outlet } from "react-router";

export function App() {
  return (
    <div className="wrap">
      <header className="app-header">
        <div className="app-brand">
          <Link className="wordmark" to="/">
            Wist
          </Link>
          <nav className="app-nav mono" aria-label="Dashboard">
            <NavLink to="/" end>
              Passport
            </NavLink>
            <NavLink to="/share">Share</NavLink>
          </nav>
        </div>
        <span className="where mono">
          <span className="label">Local</span>
          <span>{window.location.host}</span>
        </span>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}

export function NotFound() {
  return (
    <div className="slot">
      <span className="label">No such page</span>
      <p>
        <Link to="/">Back to the passport</Link>
      </p>
    </div>
  );
}
