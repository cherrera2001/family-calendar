/// <reference types="vite/client" />

interface WakeLockSentinel {
  readonly released: boolean;
  readonly type: string;
  release(): Promise<void>;
}

interface WakeLockNavigator extends Navigator {
  wakeLock?: {
    request(type: 'screen'): Promise<WakeLockSentinel>;
  };
}
