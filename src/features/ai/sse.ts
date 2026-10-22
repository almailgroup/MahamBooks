/**
 * Server-Sent Events, as the AI service sends them (text/event-stream): the
 * text of each answer arrives in pieces, split anywhere, even inside a line
 * or a letter. Lines end with CRLF, LF or CR; an event is its field lines up
 * to a blank line; several data lines make one data value, joined with "\n";
 * lines starting with ":" are comments.
 * https://html.spec.whatwg.org/multipage/server-sent-events.html
 */

export interface SseEvent {
  /** The event's name: "message" unless an `event:` line names it ("error"). */
  event: string;
  data: string;
}

export class SseParser {
  private buffer = '';
  private event = '';
  private data: string[] = [];
  private decoder = new TextDecoder();

  /** Reads a piece of the stream; returns the events it completed. */
  push(chunk: Uint8Array | string): SseEvent[] {
    this.buffer += typeof chunk === 'string' ? chunk : this.decoder.decode(chunk, { stream: true });
    return this.lines(false);
  }

  /**
   * The end of the stream. An event the server didn't end with a blank line
   * is still read (the spec drops it; a proxy cutting the last blank line
   * shouldn't lose the end of an answer).
   */
  end(): SseEvent[] {
    this.buffer += this.decoder.decode();
    const events = this.lines(true);
    const last = this.dispatch();
    return last ? [...events, last] : events;
  }

  private lines(final: boolean): SseEvent[] {
    const events: SseEvent[] = [];
    for (;;) {
      const at = this.buffer.search(/[\r\n]/);
      if (at === -1) {
        if (final && this.buffer) {
          this.field(this.buffer);
          this.buffer = '';
        }
        return events;
      }
      // A CR at the very end may be the first half of a CRLF still on its way.
      if (this.buffer[at] === '\r' && at === this.buffer.length - 1 && !final) return events;
      const line = this.buffer.slice(0, at);
      const crlf = this.buffer[at] === '\r' && this.buffer[at + 1] === '\n';
      this.buffer = this.buffer.slice(at + (crlf ? 2 : 1));
      if (line === '') {
        const event = this.dispatch();
        if (event) events.push(event);
      } else {
        this.field(line);
      }
    }
  }

  private field(line: string) {
    if (line.startsWith(':')) return;
    const colon = line.indexOf(':');
    const name = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (name === 'data') this.data.push(value);
    else if (name === 'event') this.event = value;
    // id and retry don't matter here: the app never reconnects to an answer.
  }

  private dispatch(): SseEvent | null {
    const event: SseEvent | null = this.data.length
      ? { event: this.event || 'message', data: this.data.join('\n') }
      : null;
    this.event = '';
    this.data = [];
    return event;
  }
}
