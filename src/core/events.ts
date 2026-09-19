/**
 * AI PROJECT OS - Core Event Bus
 */

export type EventHandler<T = unknown> = (payload: T) => void | Promise<void>;

export class EventBus {
  private handlers = new Map<string, EventHandler[]>();

  public subscribe<T>(eventName: string, handler: EventHandler<T>): () => void {
    const existing = this.handlers.get(eventName) ?? [];
    existing.push(handler as EventHandler);
    this.handlers.set(eventName, existing);

    return () => {
      const current = this.handlers.get(eventName);
      if (current) {
        this.handlers.set(
          eventName,
          current.filter((h) => h !== handler)
        );
      }
    };
  }

  public async publish<T>(eventName: string, payload: T): Promise<void> {
    const registered = this.handlers.get(eventName);
    if (!registered || registered.length === 0) return;

    for (const handler of registered) {
      await handler(payload);
    }
  }

  public clear(): void {
    this.handlers.clear();
  }
}

export const globalEventBus = new EventBus();
