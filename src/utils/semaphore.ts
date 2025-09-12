export class Semaphore {
  private permits: number = 0;
  private waitingQueue: (() => void)[] = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if(this.permits > 0) {
      this.permits--;
      return;
    }

    return new Promise((resolve) => {
      this.waitingQueue.push(resolve);
    })
  }

  async release() {
    this.permits++;
    const next = this.waitingQueue.shift();
    if(next) {
      this.permits++;
      next();
    }
  }
}
