export type LogLevel = 'log' | 'info' | 'warn' | 'error';

export interface LogEntry {
  id: number;
  message: string;
  level: LogLevel;
  timestamp: number;
}

export class LogManager {
  private _logs: LogEntry[] = [];
  private _nextId = 0;
  private readonly listeners = new Set<() => void>();

  getSnapshot = () => this._logs;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  add(level: LogLevel, ...args: unknown[]) {
    const message = args
      .map((arg) => {
        if (arg instanceof Error) {
          const summary = Error.prototype.toString.call(arg);
          const stack = arg.stack;
          if (typeof stack !== 'string' || !stack) return summary;
          return stack.startsWith(summary) ? stack : `${summary}\n${stack}`;
        }
        if (typeof arg === 'object' && arg !== null) {
          try {
            return JSON.stringify(arg, null, 2);
          } catch {
            return String(arg);
          }
        }
        return String(arg);
      })
      .join(' ');

    const entry: LogEntry = {
      id: this._nextId++,
      message,
      level,
      timestamp: Date.now()
    };

    this._logs = [...this._logs.slice(-499), entry];
    this._notify();
  }

  clear() {
    this._logs = [];
    this._notify();
  }

  private _notify() {
    this.listeners.forEach(listener => listener());
  }
}

export const playgroundLogs = new LogManager();

export function captureConsole() {
  const levels: LogLevel[] = ['log', 'info', 'warn', 'error'];
  const originals = levels.map(level => window.console[level]);
  levels.forEach((level, index) => {
    window.console[level] = (...args: unknown[]) => {
      originals[index].apply(window.console, args);
      playgroundLogs.add(level, ...args);
    };
  });
  return () => levels.forEach((level, index) => { window.console[level] = originals[index]; });
}
