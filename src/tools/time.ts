export function formatBeijingTimestamp(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: string): string => {
    const found = parts.find((part) => part.type === type)?.value;
    if (!found) throw new Error(`failed to format Beijing timestamp: missing ${type}`);
    return found;
  };
  const millisecond = String(date.getMilliseconds()).padStart(3, "0");
  return `${value("year")}-${value("month")}-${value("day")}T${value("hour")}:${value("minute")}:${value("second")}.${millisecond}+08:00`;
}

export function formatBeijingDate(date = new Date()): string {
  return formatBeijingTimestamp(date).slice(0, 10);
}

export function compactBeijingTimestamp(date = new Date()): string {
  return formatBeijingTimestamp(date)
    .replace(/[-:]/g, "")
    .replace("+0800", "+0800");
}
