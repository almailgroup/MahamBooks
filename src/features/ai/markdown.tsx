import { Fragment, type ReactNode } from 'react';

/**
 * The assistant's answers in the Markdown it writes, as React elements: a
 * safe subset (paragraphs, headings, bold, italics, lists, quotes, simple
 * tables, inline code and code blocks). Never HTML: whatever the answer
 * holds is text, `<script>` included. Only https links are links, opening
 * in a new tab without telling the site where they came from; others show
 * as their text. Unfinished Markdown, while the answer is being written,
 * shows as it is.
 */

export type ListItem = { text: string; ordered: boolean; children: ListItem[] };

export type Block =
  | { kind: 'paragraph'; lines: string[] }
  | { kind: 'heading'; text: string }
  | { kind: 'list'; ordered: boolean; start: number; items: ListItem[] }
  | { kind: 'code'; text: string }
  | { kind: 'quote'; lines: string[] }
  | { kind: 'table'; head: string[]; rows: string[][] }
  | { kind: 'rule' };

const FENCE = /^\s{0,3}(```|~~~)/;
const HEADING = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/;
const RULE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const BULLET = /^(\s*)[-*+•]\s+(.*)$/;
const NUMBERED = /^(\s*)(\d{1,4})[.)]\s+(.*)$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function listItem(
  line: string,
): { indent: number; ordered: boolean; n: number; text: string } | null {
  const bullet = BULLET.exec(line);
  if (bullet && !RULE.test(line)) {
    return { indent: bullet[1].length, ordered: false, n: 1, text: bullet[2] };
  }
  const numbered = NUMBERED.exec(line);
  if (numbered) {
    return {
      indent: numbered[1].length,
      ordered: true,
      n: Number(numbered[2]),
      text: numbered[3],
    };
  }
  return null;
}

/** The blocks of an answer. */
export function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') {
      i += 1;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      const body: string[] = [];
      i += 1;
      // Unclosed (still being written): the rest is code.
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++]);
      i += 1;
      blocks.push({ kind: 'code', text: body.join('\n') });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ kind: 'heading', text: heading[1] });
      i += 1;
      continue;
    }
    if (RULE.test(line)) {
      blocks.push({ kind: 'rule' });
      i += 1;
      continue;
    }
    if (line.includes('|') && i + 1 < lines.length && TABLE_RULE.test(lines[i + 1])) {
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
        rows.push(cells(lines[i++]));
      }
      blocks.push({ kind: 'table', head, rows });
      continue;
    }
    const first = listItem(line);
    if (first) {
      const items: ListItem[] = [];
      const base = first.indent;
      while (i < lines.length) {
        const item = listItem(lines[i]);
        // At the list's own depth, the other kind of list starts a new list.
        if (item && (item.indent > base || item.ordered === first.ordered)) {
          const entry: ListItem = { text: item.text, ordered: item.ordered, children: [] };
          const parent = items.at(-1);
          if (item.indent > base && parent) parent.children.push(entry);
          else items.push(entry);
          i += 1;
          continue;
        }
        if (item) break;
        // A line that goes on with the item above it (indented, not blank).
        if (lines[i].trim() !== '' && /^\s+/.test(lines[i]) && items.length) {
          const last = items.at(-1)!;
          const target = last.children.at(-1) ?? last;
          target.text += `\n${lines[i].trim()}`;
          i += 1;
          continue;
        }
        // A blank line inside a list, when the list goes on after it.
        const next = lines[i].trim() === '' ? listItem(lines[i + 1] ?? '') : null;
        if (next && (next.indent > base || next.ordered === first.ordered)) {
          i += 1;
          continue;
        }
        break;
      }
      blocks.push({ kind: 'list', ordered: first.ordered, start: first.n, items });
      continue;
    }
    if (QUOTE.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i])) quoted.push(QUOTE.exec(lines[i++])![1]);
      blocks.push({ kind: 'quote', lines: quoted });
      continue;
    }
    const paragraph: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !FENCE.test(lines[i]) &&
      !HEADING.test(lines[i]) &&
      !listItem(lines[i]) &&
      !QUOTE.test(lines[i])
    ) {
      paragraph.push(lines[i++].trim());
    }
    if (paragraph.length === 0) paragraph.push(lines[i++].trim());
    blocks.push({ kind: 'paragraph', lines: paragraph });
  }
  return blocks;
}

/** A link's address when it may be a link: https only. */
export function safeHref(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' ? parsed.href : null;
  } catch {
    return null;
  }
}

const INLINE: { kind: 'code' | 'link' | 'strong' | 'em'; pattern: RegExp }[] = [
  { kind: 'code', pattern: /`([^`\n]+)`/ },
  { kind: 'link', pattern: /\[([^\]\n]+)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/ },
  { kind: 'strong', pattern: /\*\*(?=\S)([\s\S]*?\S)\*\*|__(?=\S)([\s\S]*?\S)__/ },
  {
    kind: 'em',
    pattern:
      /\*(?=[^\s*])([^*\n]*?[^\s*])\*|(?<![\p{L}\p{N}_])_(?=\S)([^_\n]*?\S)_(?![\p{L}\p{N}_])/u,
  },
];

/** Inline Markdown of a line, as elements. */
export function inline(text: string, key = 'i'): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = text;
  let n = 0;
  while (rest) {
    let best: { kind: (typeof INLINE)[number]['kind']; match: RegExpExecArray } | null = null;
    for (const { kind, pattern } of INLINE) {
      const match = pattern.exec(rest);
      if (match && (best === null || match.index < best.match.index)) best = { kind, match };
    }
    if (!best) {
      out.push(rest);
      break;
    }
    const { kind, match } = best;
    if (match.index > 0) out.push(rest.slice(0, match.index));
    const id = `${key}.${n++}`;
    const inner = match[1] ?? match[2] ?? '';
    if (kind === 'code') {
      out.push(
        <code key={id} className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[0.85em]">
          {inner}
        </code>,
      );
    } else if (kind === 'link') {
      const href = safeHref(match[2]);
      out.push(
        href ? (
          <a
            key={id}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary-700 font-medium underline underline-offset-2"
          >
            {inline(match[1], id)}
          </a>
        ) : (
          <Fragment key={id}>{inline(match[1], id)}</Fragment>
        ),
      );
    } else if (kind === 'strong') {
      out.push(
        <strong key={id} className="font-semibold">
          {inline(inner, id)}
        </strong>,
      );
    } else {
      out.push(<em key={id}>{inline(inner, id)}</em>);
    }
    rest = rest.slice(match.index + match[0].length);
  }
  return out;
}

/** Lines of a paragraph, kept apart as the answer wrote them. */
function withBreaks(lines: string[], key: string): ReactNode[] {
  return lines.flatMap((line, i) => [
    ...(i > 0 ? [<br key={`${key}.br${i}`} />] : []),
    <Fragment key={`${key}.l${i}`}>{inline(line, `${key}.l${i}`)}</Fragment>,
  ]);
}

function Items({
  items,
  ordered,
  start,
  id,
}: {
  items: ListItem[];
  ordered: boolean;
  start?: number;
  id: string;
}) {
  const children = items.map((item, i) => (
    <li key={i} dir="auto">
      {withBreaks(item.text.split('\n'), `${id}.${i}`)}
      {item.children.length ? (
        <Items items={item.children} ordered={item.children[0].ordered} id={`${id}.${i}`} />
      ) : null}
    </li>
  ));
  return ordered ? (
    // Its own direction too, so the numbers of an English list sit on its left in Arabic.
    <ol
      dir="auto"
      start={start && start !== 1 ? start : undefined}
      className="list-decimal space-y-1 ps-5"
    >
      {children}
    </ol>
  ) : (
    <ul dir="auto" className="list-disc space-y-1 ps-5">
      {children}
    </ul>
  );
}

export function Markdown({ text }: { text: string }) {
  return (
    <div className="space-y-2.5 text-sm leading-relaxed break-words">
      {parseBlocks(text).map((block, i) => {
        const id = `b${i}`;
        switch (block.kind) {
          case 'heading':
            return (
              <p key={id} dir="auto" className="font-semibold text-slate-900">
                {inline(block.text, id)}
              </p>
            );
          case 'list':
            return (
              <Items
                key={id}
                items={block.items}
                ordered={block.ordered}
                start={block.start}
                id={id}
              />
            );
          case 'code':
            return (
              <pre
                key={id}
                dir="ltr"
                className="scroll-thin overflow-x-auto rounded-lg bg-slate-100 p-3 font-mono text-xs leading-relaxed text-slate-800"
              >
                <code>{block.text}</code>
              </pre>
            );
          case 'quote':
            return (
              <blockquote
                key={id}
                dir="auto"
                className="border-s-2 border-slate-200 ps-3 text-slate-600"
              >
                {withBreaks(block.lines, id)}
              </blockquote>
            );
          case 'table':
            return (
              <div key={id} className="scroll-thin overflow-x-auto">
                <table dir="auto" className="w-full border-collapse text-start text-xs">
                  <thead>
                    <tr>
                      {block.head.map((cell, c) => (
                        <th
                          key={c}
                          dir="auto"
                          className="border-b border-slate-200 px-2 py-1.5 text-start font-semibold"
                        >
                          {inline(cell, `${id}.h${c}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, r) => (
                      <tr key={r}>
                        {row.map((cell, c) => (
                          <td
                            key={c}
                            dir="auto"
                            className="border-b border-slate-100 px-2 py-1.5 align-top"
                          >
                            {inline(cell, `${id}.${r}.${c}`)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case 'rule':
            return <hr key={id} className="border-slate-200" />;
          case 'paragraph':
          default:
            return (
              <p key={id} dir="auto">
                {withBreaks(block.lines, id)}
              </p>
            );
        }
      })}
    </div>
  );
}
