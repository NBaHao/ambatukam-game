/**
 * Kho trạng thái nhỏ cho useSyncExternalStore: engine ghi, React đọc.
 * Chỉ báo cho React khi có field (cấp 1) thật sự đổi, nên engine cập nhật mỗi khung cũng không sao.
 */
export class Store<T extends object> {
  private value: T;
  private readonly listeners = new Set<() => void>();

  constructor(initial: T) {
    this.value = initial;
  }

  get = (): T => this.value;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  update(patch: Partial<T>): void {
    const keys = Object.keys(patch) as (keyof T)[];
    if (keys.every((k) => Object.is(this.value[k], patch[k]))) return;
    this.value = { ...this.value, ...patch };
    for (const l of this.listeners) l();
  }
}
