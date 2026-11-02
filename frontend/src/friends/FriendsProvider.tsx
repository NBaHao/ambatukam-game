import { useEffect, useState, type ReactNode } from "react";
import { useAccount } from "../account/context";
import { FriendsContext } from "./context";
import { FriendsHub } from "./FriendsHub";

/** One FriendsHub for the app: connected to the lobby while logged in */
export function FriendsProvider({ children }: { children: ReactNode }) {
  const { user } = useAccount();
  const [hub] = useState(() => new FriendsHub());
  const username = user?.username ?? null;
  useEffect(() => {
    if (!username) return;
    hub.start(username);
    return () => hub.stop();
  }, [hub, username]);
  return <FriendsContext value={hub}>{children}</FriendsContext>;
}
