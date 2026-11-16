export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function pick<T>(items: T[]): T | undefined {
  return items[Math.floor(Math.random() * items.length)];
}
