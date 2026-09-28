import type { ReactNode } from 'react';

/** **bold**, *italic* / _italic_ and `code` inside one line. */
function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g;
  let last = 0;
  let i = 0;
  for (const match of text.matchAll(pattern)) {
    const at = match.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const token = match[0];
    const key = `${keyBase}:${i++}`;
    if (token.startsWith('**')) out.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    else if (token.startsWith('`')) {
      out.push(
        <code key={key} className="bg-bg-dark px-2">
          {token.slice(1, -1)}
        </code>,
      );
    } else out.push(<em key={key}>{token.slice(1, -1)}</em>);
    last = at + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/**
 * The little markdown meeting notes use — headings, bullet and numbered lists,
 * task items, paragraphs, bold/italic/code — rendered as React elements. No
 * HTML is ever interpreted: the text comes from another person's office.
 */
export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: ReactNode[] } | null = null;
  const flush = () => {
    if (!list) return;
    const key = `l${blocks.length}`;
    blocks.push(
      list.ordered ? (
        <ol key={key} className="m-0 pl-18 flex flex-col gap-2">
          {list.items}
        </ol>
      ) : (
        <ul key={key} className="m-0 pl-18 list-disc flex flex-col gap-2">
          {list.items}
        </ul>
      ),
    );
    list = null;
  };
  text.split('\n').forEach((raw, n) => {
    const line = raw.trimEnd();
    const key = `b${n}`;
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    const task = /^\s*[-*]\s+\[( |x|X)\]\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      const size = heading[1].length <= 2 ? 'text-base' : 'text-sm';
      blocks.push(
        <div key={key} className={`${size} text-accent-bright mt-4`}>
          {inline(heading[2], key)}
        </div>,
      );
    } else if (task || bullet || numbered) {
      const ordered = !!numbered && !task && !bullet;
      if (list && list.ordered !== ordered) flush();
      list ??= { ordered, items: [] };
      list.items.push(
        <li key={key} className={task ? 'list-none -ml-14' : ''}>
          {task ? (task[1] === ' ' ? '☐ ' : '☑ ') : ''}
          {inline((task?.[2] ?? bullet?.[1] ?? numbered?.[1]) || '', key)}
        </li>,
      );
    } else if (line.trim() === '' || /^-{3,}$/.test(line.trim())) {
      flush();
    } else {
      flush();
      blocks.push(
        <p key={key} className="m-0">
          {inline(line, key)}
        </p>,
      );
    }
  });
  flush();
  return (
    <div
      className="flex flex-col gap-4 text-sm leading-[1.35]"
      style={{ overflowWrap: 'anywhere' }}
    >
      {blocks}
    </div>
  );
}
