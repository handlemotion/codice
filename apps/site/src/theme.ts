// The visitor's theme: the system's until they press T, then theirs, remembered on this device.
// `data-theme` on <html> overrides `prefers-color-scheme` in styles.css.

export type Theme = "light" | "dark";

const KEY = "codice-theme";

// Runs in <head> before the first paint, so a remembered theme never flashes the other one.
export const THEME_SCRIPT = `try{var t=localStorage.getItem("${KEY}");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export function currentTheme(): Theme {
  const chosen = document.documentElement.dataset.theme;
  if (chosen === "light" || chosen === "dark") return chosen;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function toggleTheme(): Theme {
  const next: Theme = currentTheme() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // Private windows may refuse storage; the theme still applies to this visit.
  }
  return next;
}
