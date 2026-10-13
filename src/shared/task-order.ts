import type { Task } from "./types.js";

// Runtime summaries do not expose task timestamps. Use display numbers only;
// opaque task IDs and snapshot/file read times are not chronological evidence.
export function tasksByDescendingNumber(tasks: Task[]): Task[] {
  const numbered = tasks.map((task, index) => ({
    task,
    index,
    number: task.number?.match(/^(?:TASK[-_ ]?)?(\d+)$/i)?.[1],
  }));
  return numbered
    .sort((a, b) => {
      if (a.number === undefined)
        return b.number === undefined ? a.index - b.index : 1;
      if (b.number === undefined) return -1;
      return (
        b.number.localeCompare(a.number, "en", { numeric: true }) ||
        a.index - b.index
      );
    })
    .map(({ task }) => task);
}
