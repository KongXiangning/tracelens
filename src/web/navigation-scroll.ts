export function navigationScrollContainer(): Element | null {
  const content = document.querySelector(".page-content");
  if (
    content &&
    ["auto", "scroll"].includes(getComputedStyle(content).overflowY)
  )
    return content;
  return document.scrollingElement;
}
