export function navigationScrollContainer(): Element | null {
  const taskDetail = document.querySelector(".tasks-page .browser-detail");
  if (
    taskDetail &&
    ["auto", "scroll"].includes(getComputedStyle(taskDetail).overflowY)
  )
    return taskDetail;
  const content = document.querySelector(".page-content");
  if (
    content &&
    ["auto", "scroll"].includes(getComputedStyle(content).overflowY)
  )
    return content;
  return document.scrollingElement;
}
