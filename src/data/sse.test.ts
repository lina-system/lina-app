import { describe, expect, test } from "vitest";
import { readSse, SseParser, type SseFrame } from "./sse";

const STREAM = 'event: talk.started\ndata: {"agent":"a"}\n\nevent: assistant.delta\ndata: {"delta":"안녕"}\n\nevent: done\ndata: {}\n\n';
const FRAMES: SseFrame[] = [
  { event: "talk.started", data: '{"agent":"a"}' },
  { event: "assistant.delta", data: '{"delta":"안녕"}' },
  { event: "done", data: "{}" },
];

function parseChunks(chunks: readonly string[]): SseFrame[] {
  const parser = new SseParser();
  return [...chunks.flatMap((chunk) => parser.push(chunk)), ...parser.end()];
}

function bodyOf(chunks: readonly Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

async function collect(body: ReadableStream<Uint8Array>): Promise<SseFrame[]> {
  const frames: SseFrame[] = [];
  for await (const frame of readSse(body)) frames.push(frame);
  return frames;
}

describe("SseParser", () => {
  test("reads whole frames", () => {
    expect(parseChunks([STREAM])).toEqual(FRAMES);
  });

  test("keeps every frame when chunks split lines, fields and the blank line anywhere", () => {
    for (let size = 1; size <= STREAM.length; size += 1) {
      const chunks: string[] = [];
      for (let at = 0; at < STREAM.length; at += size) chunks.push(STREAM.slice(at, at + size));
      expect(parseChunks(chunks), `chunks of ${size}`).toEqual(FRAMES);
    }
  });

  test("reads CRLF and CR line ends, also when CR and LF land in different chunks", () => {
    const crlf = STREAM.replaceAll("\n", "\r\n");
    expect(parseChunks([crlf])).toEqual(FRAMES);
    expect(parseChunks(crlf.split(/(?<=\r)/))).toEqual(FRAMES);
    expect(parseChunks([STREAM.replaceAll("\n", "\r")])).toEqual(FRAMES);
  });

  test("skips keepalive comments between and inside frames", () => {
    const text = ": keepalive\n\nevent: done\n: still here\ndata: {}\n\n:\n\n";
    expect(parseChunks([text])).toEqual([{ event: "done", data: "{}" }]);
  });

  test("joins multi-line data with newlines and drops one leading space only", () => {
    const text = "event: assistant.completed\ndata: 첫 줄\ndata:  둘째 줄\ndata\ndata:셋째\n\n";
    expect(parseChunks([text])).toEqual([{ event: "assistant.completed", data: "첫 줄\n 둘째 줄\n\n셋째" }]);
  });

  test("names a frame without event: as message and drops a frame left open when the stream ends", () => {
    expect(parseChunks(["data: 1\n\ndata: 2\n"])).toEqual([{ event: "message", data: "1" }]);
  });
});

describe("readSse", () => {
  test("decodes Korean split inside a character's bytes", async () => {
    const bytes = new TextEncoder().encode(STREAM);
    const chunks = [...bytes].map((byte) => Uint8Array.of(byte));
    expect(await collect(bodyOf(chunks))).toEqual(FRAMES);
  });
});
