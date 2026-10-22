// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { SseParser, type SseEvent } from './sse';

/** Every event of a stream sent in the given pieces. */
function parse(pieces: (string | Uint8Array)[]): SseEvent[] {
  const parser = new SseParser();
  return [...pieces.flatMap((piece) => parser.push(piece)), ...parser.end()];
}

/** The stream split into pieces of `size` bytes, so letters and line ends break apart. */
function bytes(text: string, size: number): Uint8Array[] {
  const all = new TextEncoder().encode(text);
  const pieces: Uint8Array[] = [];
  for (let at = 0; at < all.length; at += size) pieces.push(all.slice(at, at + size));
  return pieces;
}

const STREAM =
  'data: {"candidates":[{"content":{"parts":[{"text":"مرحبا"}]}}]}\r\n\r\n' +
  'data: {"candidates":[{"content":{"parts":[{"text":" world"}]}}]}\r\n\r\n' +
  ': a comment\r\n' +
  'event: error\r\ndata: {"error":{"code":"upstream_error"}}\r\n\r\n';

describe('reading Server-Sent Events', () => {
  it('reads events whatever the line ends', () => {
    const lf = parse(['data: one\n\ndata: two\n\n']);
    const crlf = parse(['data: one\r\n\r\ndata: two\r\n\r\n']);
    const cr = parse(['data: one\r\rdata: two\r\r']);
    for (const events of [lf, crlf, cr]) {
      expect(events).toEqual([
        { event: 'message', data: 'one' },
        { event: 'message', data: 'two' },
      ]);
    }
  });

  it('reads the same events however the stream is split, even inside a letter or a CRLF', () => {
    const whole = parse([STREAM]);
    expect(whole).toHaveLength(3);
    expect(whole[2]).toEqual({ event: 'error', data: '{"error":{"code":"upstream_error"}}' });
    for (const size of [1, 2, 3, 5, 7, 64]) {
      expect(parse(bytes(STREAM, size))).toEqual(whole);
    }
    // A CR at the end of one piece and its LF at the start of the next is one line end.
    expect(parse(['data: a\r', '\n\r', '\ndata: b\r\n\r\n'])).toEqual([
      { event: 'message', data: 'a' },
      { event: 'message', data: 'b' },
    ]);
  });

  it('joins several data lines with a new line, and ignores comments and other fields', () => {
    expect(parse([': keep-alive\nid: 7\nretry: 100\ndata: first\ndata:second\ndata\n\n'])).toEqual([
      { event: 'message', data: 'first\nsecond\n' },
    ]);
  });

  it('gives a named event its name, then forgets it', () => {
    expect(parse(['event: error\ndata: {}\n\ndata: next\n\n'])).toEqual([
      { event: 'error', data: '{}' },
      { event: 'message', data: 'next' },
    ]);
  });

  it('keeps an event the server ended without a blank line', () => {
    expect(parse(['data: one\n\ndata: last'])).toEqual([
      { event: 'message', data: 'one' },
      { event: 'message', data: 'last' },
    ]);
    expect(parse(['data: last\r'])).toEqual([{ event: 'message', data: 'last' }]);
  });

  it('dispatches nothing for blank lines or a name without data', () => {
    expect(parse(['\n\n\r\n', 'event: ping\n\n'])).toEqual([]);
  });
});
