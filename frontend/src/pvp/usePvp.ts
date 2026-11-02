import { useCallback, useEffect, useState } from "react";
import type { GameEngine } from "../game/GameEngine";
import { PvpSession } from "./PvpSession";
import { RoomClient } from "./RoomClient";

/**
 * The PvP room the player is in, if any. The socket lives in an effect keyed on the session,
 * so leaving (or StrictMode's dev re-run) always closes it and returns the engine home.
 */
export function usePvp(engine: GameEngine) {
  const [session, setSession] = useState<PvpSession | null>(null);

  useEffect(() => {
    if (!session) return;
    session.start();
    return () => {
      session.dispose();
      engine.goIdle();
    };
  }, [engine, session]);

  const open = useCallback(
    (code: string, ticket: string) => setSession(new PvpSession(engine, new RoomClient(code, ticket))),
    [engine],
  );
  const leave = useCallback(() => setSession(null), []);
  return { session, entered: session !== null, open, leave };
}
