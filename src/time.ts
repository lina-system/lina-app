import { W } from "./words";

const MIN = 60;
const HOUR = 3600;
const DAY = 86400;

export function duration(seconds: number): string {
  if (seconds < HOUR) return `${Math.max(1, Math.floor(seconds / MIN))}분째`;
  if (seconds < DAY) return `${Math.floor(seconds / HOUR)}시간째`;
  return `${Math.floor(seconds / DAY)}일째`;
}

/** How long ago: 방금 under a minute, then minutes, hours and days. */
export function ago(seconds: number): string {
  if (seconds < MIN) return W.justNow;
  if (seconds < HOUR) return `${Math.floor(seconds / MIN)}분 전`;
  if (seconds < DAY) return `${Math.floor(seconds / HOUR)}시간 전`;
  return `${Math.floor(seconds / DAY)}일 전`;
}

export function total(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / MIN));
  if (minutes < 60) return `${minutes}분`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}시간 ${rest}분` : `${hours}시간`;
}

/** A reset time: hours (rounded up) under a day, whole days at or over a day. */
export function until(seconds: number): string {
  if (seconds < DAY) return `${Math.max(1, Math.ceil(seconds / HOUR))}시간 후`;
  return `${Math.max(1, Math.round(seconds / DAY))}일 후`;
}

/** A time of day, 24-hour: 14:05. */
export function clock(epochSeconds: number): string {
  const date = new Date(epochSeconds * 1000);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** A time of day with its day when that is not `now`'s: 14:05 today, 어제 23:41, then 11월 2일 09:10. */
export function clockAt(epochSeconds: number, now: number): string {
  const key = (seconds: number) => new Date(seconds * 1000).toDateString();
  if (key(epochSeconds) === key(now)) return clock(epochSeconds);
  if (key(epochSeconds) === key(now - 86_400)) return `${W.yesterday} ${clock(epochSeconds)}`;
  const date = new Date(epochSeconds * 1000);
  return `${date.getMonth() + 1}월 ${date.getDate()}일 ${clock(epochSeconds)}`;
}

export function dayLabel(day: string): string {
  const [, month, date] = day.split("-").map(Number);
  return `${month}월 ${date}일`;
}
