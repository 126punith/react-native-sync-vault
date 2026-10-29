export type Double = number;
export type Int32 = number;
export type EventEmitter<T> = (handler: (arg: T) => void | Promise<void>) => { remove: () => void };
