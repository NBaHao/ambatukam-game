// Tiny path router: the Worker serves index.html for unknown paths (single-page-application),
// so links like /c/<code> load the app and React picks the screen from the path.
import { useSyncExternalStore } from "react";

export type Route =
  | { name: "home" }
  | { name: "room"; code: string }
  | { name: "profile"; username: string }
  | { name: "reset"; token: string };

const ROOM = /^\/c\/([a-z0-9]{6})\/?$/;
const PROFILE = /^\/u\/([A-Za-z0-9_-]{3,16})\/?$/;
// Password reset links from the email (backend/src/app/services/resets.py)
const RESET = /^\/reset\/([A-Za-z0-9_-]{16,128})\/?$/;

export function parseRoute(path: string): Route {
  const room = ROOM.exec(path);
  if (room) return { name: "room", code: room[1] };
  const profile = PROFILE.exec(path);
  if (profile) return { name: "profile", username: profile[1].toLowerCase() };
  const reset = RESET.exec(path);
  if (reset) return { name: "reset", token: reset[1] };
  return { name: "home" };
}

export const roomPath = (code: string) => `/c/${code}`;
/** The link a host sends. `?lang=vi` makes the Worker write the link preview in Vietnamese
 *  (backend/src/app/services/invite_preview.py); the app itself ignores it */
export const inviteUrl = (code: string, lang: string, origin = location.origin) =>
  new URL(roomPath(code) + (lang === "vi" ? "?lang=vi" : ""), origin).toString();
export const profilePath = (username: string) => `/u/${username}`;

const subscribe = (cb: () => void) => {
  addEventListener("popstate", cb);
  return () => removeEventListener("popstate", cb);
};
const getPath = () => location.pathname;

export function navigate(path: string, { replace = false } = {}): void {
  if (path === location.pathname) return;
  if (replace) history.replaceState(null, "", path);
  else history.pushState(null, "", path);
  dispatchEvent(new PopStateEvent("popstate"));
}

export function useRoute(): Route {
  const path = useSyncExternalStore(subscribe, getPath);
  return parseRoute(path);
}
