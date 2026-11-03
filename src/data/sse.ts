/** One server-sent event: its `event:` name ("message" when it has none) and its `data:` lines joined by "\n". */
export interface SseFrame {
  readonly event: string;
  readonly data: string;
}

/**
 * Reads `text/event-stream` text in whatever pieces it arrives (the HTML standard's event stream format): lines end
 * in CRLF, LF or CR, a line starting with ":" is a comment (keepalive), `data:` lines add up until a blank line ends
 * the frame. A frame with no data is dropped, as the standard says.
 */
export class SseParser {
  private buffer = "";
  /** The last chunk ended in CR: an LF at the start of the next one belongs to that line end. */
  private afterCr = false;
  private event = "";
  private data: string[] = [];
  private started = false;

  push(chunk: string): SseFrame[] {
    let text = chunk;
    if (this.afterCr && text.startsWith("\n")) text = text.slice(1);
    this.afterCr = false;
    if (!this.started && text) {
      this.started = true;
      if (text.startsWith("\uFEFF")) text = text.slice(1);
    }
    this.buffer += text;
    const frames: SseFrame[] = [];
    for (;;) {
      const end = this.buffer.search(/\r\n|\r|\n/);
      if (end < 0) break;
      const line = this.buffer.slice(0, end);
      if (this.buffer[end] === "\r" && end + 1 === this.buffer.length) {
        this.afterCr = true;
        this.buffer = "";
      } else {
        this.buffer = this.buffer.slice(end + (this.buffer.startsWith("\r\n", end) ? 2 : 1));
      }
      const frame = this.line(line);
      if (frame) frames.push(frame);
    }
    return frames;
  }

  /** The stream closed: a frame without its closing blank line is not dispatched. */
  end(): SseFrame[] {
    this.buffer = "";
    this.event = "";
    this.data = [];
    return [];
  }

  private line(line: string): SseFrame | null {
    if (line === "") {
      const frame = this.data.length ? { event: this.event || "message", data: this.data.join("\n") } : null;
      this.event = "";
      this.data = [];
      return frame;
    }
    if (line.startsWith(":")) return null;
    const colon = line.indexOf(":");
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") this.event = value;
    else if (field === "data") this.data.push(value);
    return null;
  }
}

/** Every frame of a fetch response body, bytes decoded as UTF-8 across chunk boundaries. */
export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseFrame> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parser = new SseParser();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      yield* parser.push(decoder.decode(value, { stream: true }));
    }
    yield* parser.push(decoder.decode());
    yield* parser.end();
  } finally {
    reader.releaseLock();
  }
}
