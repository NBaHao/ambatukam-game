import { createContext, use } from "react";
import { useStore } from "../hooks/useStore";
import type { FriendsHub, FriendsView } from "./FriendsHub";

export const FriendsContext = createContext<FriendsHub | null>(null);

export function useFriendsHub(): FriendsHub {
  const hub = use(FriendsContext);
  if (!hub) throw new Error("useFriendsHub must be used inside <FriendsProvider>");
  return hub;
}

/** The hub and its state (list, who's online, invites) */
export function useFriends(): [FriendsHub, FriendsView] {
  const hub = useFriendsHub();
  return [hub, useStore(hub.store)];
}
