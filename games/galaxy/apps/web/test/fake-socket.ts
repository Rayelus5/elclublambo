import type { LiveEvent } from '@galaxy/shared';

/** A WebSocket stand-in for the live socket's tests: `open()` it, then `push()` what the server would send. */
export class FakeSocket {
  static last: FakeSocket | null = null;
  static OPEN = 1;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.last = this;
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  push(event: LiveEvent) {
    this.onmessage?.({ data: JSON.stringify(event) });
  }
}
