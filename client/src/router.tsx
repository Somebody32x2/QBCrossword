import { useEffect, useState, type AnchorHTMLAttributes, type MouseEvent } from "react";
import { BASE } from "./api";

/** Path relative to the mount point, always starting with "/". */
function currentPath(): string {
  const p = window.location.pathname;
  const rel = p.startsWith(BASE) ? p.slice(BASE.length) : p;
  return rel.startsWith("/") ? rel : `/${rel}`;
}

export function navigate(to: string, replace = false): void {
  const url = `${BASE}${to}`;
  if (replace) history.replaceState(null, "", url);
  else history.pushState(null, "", url);
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo(0, 0);
}

export function usePath(): string {
  const [path, setPath] = useState(currentPath);
  useEffect(() => {
    const onPop = () => setPath(currentPath());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  return path;
}

export function Link({ to, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) {
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(to);
  };
  return <a href={`${BASE}${to}`} onClick={handle} {...rest} />;
}
