import React, { useState } from 'react';
import { Check, Copy } from 'lucide-react';

const CodeBlock: React.FC<{ code: string }> = React.memo(({ code }) => {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    void navigator.clipboard?.writeText(code).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    });
  };
  return (
    <div className="my-2.5 overflow-hidden rounded-xl bg-[#070b14]/90 border border-white/[0.1]">
      <div className="flex items-center justify-end px-3 py-1.5 border-b border-white/[0.06] bg-white/[0.02]">
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1 text-[11px] font-medium text-[#8b9ab0] hover:text-[#8df0c0] transition"
        >
          {copied ? <Check className="w-3 h-3 text-[#47dca0]" /> : <Copy className="w-3 h-3" />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-xs text-[#d6e2f5]">
        <code>{code}</code>
      </pre>
    </div>
  );
});
CodeBlock.displayName = 'CodeBlock';

function renderInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  // Match **bold**, `code`, or *italic*
  const regex = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let keyIdx = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith('**') && token.endsWith('**')) {
      parts.push(
        <strong key={keyIdx++} className="font-semibold text-[#eef3fb]">
          {token.slice(2, -2)}
        </strong>
      );
    } else if (token.startsWith('`') && token.endsWith('`')) {
      parts.push(
        <code
          key={keyIdx++}
          className="rounded-md bg-white/[0.08] border border-white/[0.1] px-1.5 py-0.5 font-mono text-[12px] text-[#8df0c0]"
        >
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith('*') && token.endsWith('*')) {
      parts.push(
        <em key={keyIdx++} className="italic text-[#dce5f5]">
          {token.slice(1, -1)}
        </em>
      );
    }
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}

function parseBlockNodes(blockText: string): React.ReactNode[] {
  const lines = blockText.split('\n');
  const out: React.ReactNode[] = [];
  let i = 0;
  let blockKey = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Code block
    if (line.trim().startsWith('```')) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      out.push(<CodeBlock key={blockKey++} code={codeLines.join('\n')} />);
      continue;
    }

    // Markdown Table
    if (
      line.includes('|') &&
      i + 1 < lines.length &&
      /^\s*\|?[\s:-]+\|[\s|:-]*$/.test(lines[i + 1])
    ) {
      const parseRow = (r: string) =>
        r
          .trim()
          .replace(/^\|/, '')
          .replace(/\|$/, '')
          .split('|')
          .map((c) => c.trim());

      const headers = parseRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
        rows.push(parseRow(lines[i]));
        i++;
      }

      out.push(
        <div
          key={blockKey++}
          className="my-3 overflow-x-auto rounded-xl border border-white/[0.1] bg-[#070b14]/60"
        >
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-white/[0.1] text-[#8df0c0]">
                {headers.map((h, idx) => (
                  <th key={idx} className="px-3 py-2 font-semibold whitespace-nowrap">
                    {renderInline(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {rows.map((row, rIdx) => (
                <tr key={rIdx}>
                  {row.map((cell, cIdx) => (
                    <td key={cIdx} className="px-3 py-2 text-[#d0dced] tabular-nums">
                      {renderInline(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // Headings
    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2];
      const cls =
        level === 1
          ? 'mt-3 mb-1.5 font-display text-base font-extrabold text-[#eef3fb]'
          : level === 2
          ? 'mt-3 mb-1 font-display text-sm font-bold text-[#8df0c0]'
          : 'mt-2.5 mb-1 font-display text-sm font-semibold text-[#eef3fb]';
      out.push(
        <h4 key={blockKey++} className={cls}>
          {renderInline(text)}
        </h4>
      );
      i++;
      continue;
    }

    // Bullet list
    if (/^\s*[-*•]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*•]\s+/, ''));
        i++;
      }
      out.push(
        <ul key={blockKey++} className="my-2 space-y-1.5 pl-4 list-disc marker:text-[#47dca0]">
          {items.map((item, idx) => (
            <li key={idx} className="text-sm leading-relaxed text-[#d7e1f0]">
              {renderInline(item)}
            </li>
          ))}
        </ul>
      );
      continue;
    }

    // Numbered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ''));
        i++;
      }
      out.push(
        <ol
          key={blockKey++}
          className="my-2 space-y-1.5 pl-5 list-decimal marker:text-[#8df0c0] marker:font-mono"
        >
          {items.map((item, idx) => (
            <li key={idx} className="text-sm leading-relaxed text-[#d7e1f0]">
              {renderInline(item)}
            </li>
          ))}
        </ol>
      );
      continue;
    }

    // Blockquote
    if (line.trim().startsWith('>')) {
      const quoteText = line.trim().replace(/^>\s?/, '');
      out.push(
        <blockquote
          key={blockKey++}
          className="my-2 rounded-xl bg-white/[0.04] border border-white/[0.08] px-3.5 py-2 text-sm italic text-[#c4d1e6]"
        >
          {renderInline(quoteText)}
        </blockquote>
      );
      i++;
      continue;
    }

    // Blank line
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Regular paragraph
    out.push(
      <p key={blockKey++} className="my-1.5 text-sm leading-relaxed text-[#d7e1f0]">
        {renderInline(line)}
      </p>
    );
    i++;
  }

  return out;
}

/**
 * Splits streamed markdown into top-level blocks outside fenced code blocks
 * so finished blocks remain memoized while only the trailing block re-parses.
 */
function splitMarkdownBlocks(content: string): string[] {
  const lines = content.split('\n');
  const blocks: string[] = [];
  let current: string[] = [];
  let inFence = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith('```')) {
      inFence = !inFence;
      current.push(line);
      continue;
    }
    if (!inFence && line.trim() === '' && current.length > 0) {
      blocks.push(current.join('\n'));
      current = [];
      continue;
    }
    current.push(line);
  }

  if (current.length > 0) {
    blocks.push(current.join('\n'));
  }

  return blocks;
}

const MemoMarkdownBlock = React.memo<{ text: string }>(({ text }) => {
  const nodes = React.useMemo(() => parseBlockNodes(text), [text]);
  return <>{nodes}</>;
});
MemoMarkdownBlock.displayName = 'MemoMarkdownBlock';

export const MarkdownRenderer: React.FC<{ content: string }> = React.memo(({ content }) => {
  const isPlainSingleLine =
    !content.includes('\n') &&
    !content.includes('*') &&
    !content.includes('`') &&
    !content.includes('#') &&
    !content.includes('|') &&
    !content.startsWith('>');

  const blockTexts = React.useMemo(
    () => (isPlainSingleLine ? [] : splitMarkdownBlocks(content)),
    [content, isPlainSingleLine]
  );

  if (isPlainSingleLine) {
    return (
      <div className="space-y-0.5">
        <p className="my-1.5 text-sm leading-relaxed text-[#d7e1f0]">{content}</p>
      </div>
    );
  }

  return (
    <div className="space-y-0.5">
      {blockTexts.map((blockText, idx) => (
        <MemoMarkdownBlock key={idx} text={blockText} />
      ))}
    </div>
  );
});

MarkdownRenderer.displayName = 'MarkdownRenderer';
