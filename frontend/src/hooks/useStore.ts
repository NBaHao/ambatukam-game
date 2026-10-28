import { useSyncExternalStore } from "react";
import type { Store } from "../game/Store";

/** Đọc một Store của engine; component render lại khi store đổi */
export function useStore<T extends object>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get);
}
