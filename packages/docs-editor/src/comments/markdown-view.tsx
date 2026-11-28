/** Draws a comment's Markdown ({@link parseCommentMarkdown}) as React elements: no HTML is ever set from the text. */
import type { ReactNode } from 'react';
import type { MdBlock, MdInline } from './markdown.ts';

const CODE = 'rounded bg-chrome-hover px-1 py-px font-mono text-[12px] [overflow-wrap:anywhere]';

/** An @mention, as the card marks it. */
export function MentionChip({ text }: { text: string }): ReactNode {
  return (
    <span className="font-medium text-chrome-accent" data-mention="">
      {text}
    </span>
  );
}

export function MarkdownInline({ nodes }: { nodes: readonly MdInline[] }): ReactNode {
  return nodes.map((node, index) => {
    switch (node.t) {
      case 'text':
        return node.text;
      case 'mention':
        return <MentionChip key={index} text={node.text} />;
      case 'code':
        return (
          <code key={index} dir="ltr" className={CODE}>
            {node.text}
          </code>
        );
      case 'em':
        return (
          <em key={index}>
            <MarkdownInline nodes={node.c} />
          </em>
        );
      case 'strong':
        return (
          <strong key={index} className="font-semibold">
            <MarkdownInline nodes={node.c} />
          </strong>
        );
      case 'del':
        return (
          <del key={index}>
            <MarkdownInline nodes={node.c} />
          </del>
        );
      case 'link':
        return (
          <a
            key={index}
            href={node.href}
            title={node.href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="text-chrome-accent underline underline-offset-2 [overflow-wrap:anywhere] hover:opacity-80"
            onClick={event => event.stopPropagation()}
          >
            <MarkdownInline nodes={node.c} />
          </a>
        );
    }
  });
}

export function MarkdownBlocks({ blocks }: { blocks: readonly MdBlock[] }): ReactNode {
  return blocks.map((block, index) => {
    const gap = index > 0 ? 'mt-1.5' : '';
    switch (block.t) {
      case 'p':
        return (
          <p key={index} className={`m-0 ${gap}`}>
            <MarkdownInline nodes={block.c} />
          </p>
        );
      case 'h':
        return (
          <p key={index} role="heading" aria-level={block.level} className={`m-0 font-semibold ${block.level <= 2 ? 'text-[14px]' : ''} ${gap}`}>
            <MarkdownInline nodes={block.c} />
          </p>
        );
      case 'code':
        return (
          <pre key={index} dir="ltr" className={`m-0 rounded bg-chrome-hover px-2 py-1 font-mono text-[12px] leading-[18px] whitespace-pre-wrap [overflow-wrap:anywhere] ${gap}`}>
            <code>{block.text}</code>
          </pre>
        );
      case 'quote':
        return (
          <blockquote key={index} className={`m-0 border-l-2 border-chrome-line pl-2 text-chrome-muted ${gap}`}>
            <MarkdownBlocks blocks={block.c} />
          </blockquote>
        );
      case 'list': {
        const items = block.items.map((item, at) => (
          <li key={at} className="pl-0.5">
            <MarkdownBlocks blocks={item} />
          </li>
        ));
        return block.ordered ? (
          <ol key={index} start={block.start === 1 ? undefined : block.start} className={`m-0 list-decimal pl-5 ${gap}`}>
            {items}
          </ol>
        ) : (
          <ul key={index} className={`m-0 list-disc pl-5 ${gap}`}>
            {items}
          </ul>
        );
      }
      case 'hr':
        return <hr key={index} className={`my-1.5 border-0 border-t border-chrome-line`} />;
    }
  });
}
