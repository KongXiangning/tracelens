// Hide complete frontmatter in reading/heading ASTs while retaining absolute positions.
export function maskFrontmatter(raw: string): string {
  const front =
    /^(?:\uFEFF)?---[ \t]*(?:\r\n|\n|\r)[\s\S]*?^---[ \t]*(?:\r\n|\n|\r|$)/m.exec(
      raw,
    );
  if (!front || front.index !== 0) return raw;
  return front[0].replace(/[^\r\n]/g, " ") + raw.slice(front[0].length);
}
