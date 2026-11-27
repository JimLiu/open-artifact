import * as React from 'react';
import { Button } from '../kit/button.tsx';
import { PANE_GUTTER_CLASSES, PaneSection, SidePane, focusPaneStart, useSidePaneCaret } from '../ui/side-pane/side-pane.tsx';
import type { StyleWithVariables } from '../grid/cell-drawing.tsx';
import type { CaretTarget } from './own-filter-bar-view.tsx';
import { connectedTableMessages } from './connected-table-messages.ts';
import { CallField, WrittenCode } from './connected-table-call.tsx';
import type { CallShown, CodeShown } from './connected-table-view.ts';

/** What the code parts are made with, so another page can make them with its own React and button. */
export interface MakingOfCodeParts {
  createElement: typeof React.createElement;
  useEffect: typeof React.useEffect;
  useId: typeof React.useId;
  useLayoutEffect: typeof React.useLayoutEffect;
  useRef: typeof React.useRef;
  useState: typeof React.useState;
  Button: typeof Button;
}
export interface CodeFrameProps {
  className: string;
  invalid?: boolean;
  children?: React.ReactNode;
}
export interface CodeBoxProps {
  label: string;
  code: string;
  children?: React.ReactNode;
  corner?: React.ReactNode;
  unwrapped?: boolean;
  words: { showMore: string; showLess: string };
}
export interface CodeFieldProps {
  label: React.ReactNode;
  htmlFor?: string;
  end?: React.ReactNode;
  note?: React.ReactNode;
  children?: React.ReactNode;
}
export interface CopyMarkProps {
  label: string;
  copiedWords: string;
  /** Copies; resolves to whether it did. */
  copy: () => Promise<boolean>;
}
/** Copies a code of the call; `name` says what it is. */
export type CopyCodeOfCall = (text: string, name: string) => boolean | Promise<boolean>;
export interface SourceOfTablePaneProps {
  call: CallShown | null;
  timesAsked: number;
  paneRef: React.RefObject<HTMLElement | null>;
  takesNoTyping: boolean;
  paneWidth: number;
  onPaneWidthChange: (width: number) => void;
  onKeyDownInPane: (event: React.KeyboardEvent) => void;
  onPressed?: () => void;
  whatHasCaretAfter: () => CaretTarget;
  wasPointerPressedLast: () => boolean;
  copy: CopyCodeOfCall;
  onShut: () => void;
}

export function createCodeParts(parts: MakingOfCodeParts) {
  let { useEffect, useId, useLayoutEffect, useRef, useState, Button } = parts;
  function CodeFrame({ className, invalid = false, children }: CodeFrameProps) {
    return parts.createElement(
      'div',
      {
        className: 'dash-code-frame relative flex min-w-0 flex-col ' + className,
        'data-invalid': invalid ? '' : void 0,
      },
      children,
    );
  }
  function CodeBox({ label, code, children, corner, unwrapped = false, words }: CodeBoxProps) {
    let readRef = useRef<HTMLDivElement>(null),
      readId = useId(),
      [isShownWhole, setIsShownWhole] = useState(false),
      [isTall, setIsTall] = useState(false),
      [isWide, setIsWide] = useState(false);
    useLayoutEffect(() => {
      let read = readRef.current;
      if (read === null) return;
      let measure = () => {
        if (!isShownWhole) setIsTall(read.scrollHeight > 8 * Number.parseFloat(getComputedStyle(read).lineHeight) + 1);
        setIsWide(read.scrollWidth > read.clientWidth + 1);
      };
      measure();
      let observer = new ResizeObserver(measure);
      return (observer.observe(read), () => observer.disconnect());
    }, [isShownWhole, code]);
    let isCut = isTall && !isShownWhole;
    return (
      useLayoutEffect(() => {
        if (isCut) readRef.current?.scrollTo(0, 0);
      }, [isCut]),
      parts.createElement(
        CodeFrame,
        { className: 'rounded bg-neutral px-md py-sm shadow-field-ring' },
        parts.createElement(
          'div',
          {
            ref: readRef,
            id: readId,
            className: 'dash-code-read kit-scrollbar',
            style: CODE_LINES_STYLE,
            'data-short': isShownWhole ? void 0 : '',
            'data-cut': isCut ? '' : void 0,
            tabIndex: isWide ? (isCut ? -1 : 0) : void 0,
            role: 'region',
            'aria-label': label,
          },
          parts.createElement(
            'pre',
            {
              className: 'dash-code-text',
              'data-unwrapped': unwrapped ? '' : void 0,
            },
            children ?? code,
          ),
        ),
        corner !== void 0 && parts.createElement('span', { className: 'dash-code-corner' }, corner),
        (isTall || isShownWhole) &&
          parts.createElement(
            Button,
            {
              className: 'self-start',
              flush: true,
              size: 'xs',
              variant: 'ghost',
              'aria-expanded': isShownWhole,
              'aria-controls': readId,
              onClick: () => setIsShownWhole(!isShownWhole),
            },
            isShownWhole ? words.showLess : words.showMore,
          ),
      )
    );
  }
  function Field({ label, htmlFor, end, note, children }: CodeFieldProps) {
    return parts.createElement(
      'div',
      { className: 'flex min-w-0 flex-col gap-sm' },
      parts.createElement(
        'div',
        {
          className: 'dash-field-head flex items-start justify-between gap-lg',
        },
        parts.createElement(
          'div',
          { className: 'flex min-w-0 flex-1 flex-col gap-1 wrap-anywhere' },
          htmlFor === void 0
            ? parts.createElement('span', { className: 'dash-field-label text-body text-primary' }, label)
            : parts.createElement(
                'label',
                {
                  id: labelIdOf(htmlFor),
                  htmlFor,
                  className: 'dash-field-label text-body text-primary',
                },
                label,
              ),
          note !== void 0 && note !== '' && parts.createElement('p', { className: 'dash-field-note text-body text-secondary' }, note),
        ),
        end !== void 0 && parts.createElement('span', { className: 'flex h-[1lh] flex-none items-center text-body' }, end),
      ),
      children,
    );
  }
  function CopyMark({ label, copiedWords, copy }: CopyMarkProps) {
    let [isCopied, setIsCopied] = useState(false);
    return (
      useEffect(() => {
        if (!isCopied) return;
        let timer = setTimeout(() => setIsCopied(false), 1600);
        return () => clearTimeout(timer);
      }, [isCopied]),
      parts.createElement(Button, {
        iconOnly: true,
        size: 'sm',
        variant: 'ghost',
        icon: isCopied ? 'Check' : 'Copy',
        'aria-label': label,
        tooltip: isCopied ? copiedWords : label,
        onClick: () => void copy().then(setIsCopied),
      })
    );
  }
  return {
    CodeFrame,
    CodeBox,
    Field,
    CopyMark,
  };
}
export function CodeOfCallField({ label, name, code, copy }: { label: React.ReactNode; name: string; code: CodeShown; copy: CopyCodeOfCall }) {
  return (
    <CodeField
      label={label}
      end={<CopyMark label={connectedTableMessages.copyCode(name)} copiedWords={connectedTableMessages.copied()} copy={() => Promise.resolve(copy(code.toCopy, name))} />}
    >
      <CodeBox
        key={code.toCopy}
        label={name}
        code={code.toCopy}
        words={{
          showMore: connectedTableMessages.showMore(),
          showLess: connectedTableMessages.showLess(),
        }}
      >
        <span dir="ltr" className="block">
          <WrittenCode written={code.written} />
        </span>
      </CodeBox>
    </CodeField>
  );
}
export function CallCodes({ call, copy }: { call: CallShown; copy: CopyCodeOfCall }) {
  return (
    <div className="dash-code-wraps flex flex-col gap-md">
      {call.requests.map(({ tool, argumentsOfTool }, index) => {
        let toolLabel = index === 0 ? connectedTableMessages.tool() : connectedTableMessages.toolThatFollowsUp();
        return (
          <React.Fragment key={toolLabel}>
            <dl className="grid grid-cols-[80px_minmax(0,1fr)] gap-sm text-footnote text-secondary">
              {index === 0 && <CallField label={connectedTableMessages.connector()} written={call.connector} />}
              <CallField label={toolLabel} written={tool} isCode />
            </dl>
            {argumentsOfTool.map(({ name, value }, argumentIndex) => (
              <CodeOfCallField
                key={argumentIndex}
                label={
                  name !== null && (
                    <bdi className="font-mono text-footnote text-secondary">
                      <WrittenCode written={name.written} />
                    </bdi>
                  )
                }
                name={name?.said ?? toolLabel}
                code={value}
                copy={copy}
              />
            ))}
          </React.Fragment>
        );
      })}
      <CodeOfCallField label={connectedTableMessages.transform()} name={connectedTableMessages.transform()} code={call.transform} copy={copy} />
    </div>
  );
}
export const CODE_LINES_STYLE: StyleWithVariables = { '--dash-code-lines': 8 };
export const labelIdOf = (id: string): string => id + '-label';
type CodeParts = ReturnType<typeof createCodeParts>;
export let CodeBox: CodeParts['CodeBox'], CopyMark: CodeParts['CopyMark'], CodeField: CodeParts['Field'];
({
  CodeBox,
  CopyMark,
  Field: CodeField,
} = createCodeParts({
  createElement: React.createElement,
  useEffect: React.useEffect,
  useId: React.useId,
  useLayoutEffect: React.useLayoutEffect,
  useRef: React.useRef,
  useState: React.useState,
  Button,
}));
export const SourceOfTablePane = React.memo(function (props: SourceOfTablePaneProps) {
  let { call, paneRef, wasPointerPressedLast } = props;
  if (
    (useSidePaneCaret({
      isOpen: call !== null,
      timesAsked: props.timesAsked,
      paneRef,
      putCaretWhereToStart: () =>
        void focusPaneStart(paneRef.current, 'start', {
          isByPointer: wasPointerPressedLast(),
        }),
      whatHasCaretAfter: props.whatHasCaretAfter,
    }),
    call === null)
  )
    return null;
  return (
    <SidePane
      ref={paneRef}
      title={connectedTableMessages.source()}
      takesNoTyping={props.takesNoTyping}
      width={props.paneWidth}
      onWidthChange={props.onPaneWidthChange}
      onClose={props.onShut}
      onKeyDown={props.onKeyDownInPane}
      onPressed={props.onPressed}
      wasPointerPressedLast={wasPointerPressedLast}
    >
      <PaneSection title={<WrittenCode written={call.title} />}>
        <div className={`pb-md ${PANE_GUTTER_CLASSES}`}>
          <CallCodes call={call} copy={props.copy} />
        </div>
      </PaneSection>
    </SidePane>
  );
});
