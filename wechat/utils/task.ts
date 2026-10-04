export class Cancelled extends Error {
  constructor() {
    super("操作已取消");
    this.name = "Cancelled";
  }
}
export class TaskScope {
  cancelled = false;
  private callbacks = new Set<() => void>();
  check() {
    if (this.cancelled) throw new Cancelled();
  }
  onCancel(callback: () => void) {
    if (this.cancelled) callback();
    else this.callbacks.add(callback);
    return () => {
      this.callbacks.delete(callback);
    };
  }
  cancel() {
    if (this.cancelled) return;
    this.cancelled = true;
    for (const callback of this.callbacks) callback();
    this.callbacks.clear();
  }
  wait(milliseconds: number): Promise<void> {
    this.check();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        remove();
        resolve();
      }, milliseconds);
      const remove = this.onCancel(() => {
        clearTimeout(timer);
        reject(new Cancelled());
      });
    });
  }
}
