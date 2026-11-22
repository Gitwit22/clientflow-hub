import { Fragment, type ReactNode } from "react";
import { parseAgreementText, type AgreementBlock, type AgreementRun } from "@/lib/agreement-format";
import { cn } from "@/lib/utils";

function Run({ run }: { run: AgreementRun }) {
  let node: ReactNode = run.text;
  if (run.underline) node = <u className="underline-offset-2">{node}</u>;
  if (run.italic) node = <em>{node}</em>;
  if (run.bold) node = <strong className="font-semibold">{node}</strong>;
  return <>{node}</>;
}

function Runs({ runs }: { runs: AgreementRun[] }) {
  return (
    <>
      {runs.map((run, index) => (
        <Run key={index} run={run} />
      ))}
    </>
  );
}

const BLOCK_CLASS: Record<
  Exclude<AgreementBlock["kind"], "blank" | "bullet" | "numbered">,
  string
> = {
  heading: "mt-6 text-[1.4em] font-semibold leading-snug first:mt-0",
  subheading: "mt-5 text-[1.15em] font-semibold leading-snug first:mt-0",
  small: "text-[0.85em] text-muted-foreground",
  paragraph: "whitespace-pre-wrap",
};

/**
 * Agreement text with its formatting (agreement-format.ts): the same reading the signed PDF uses,
 * so staff previews and the client's signing page show what will be signed. Text is rendered as
 * React text, never as HTML.
 */
export function AgreementText({ text, className }: { text: string; className?: string }) {
  const blocks = parseAgreementText(text);
  const items: ReactNode[] = [];
  let index = 0;
  while (index < blocks.length) {
    const block = blocks[index];
    if (block.kind === "bullet" || block.kind === "numbered") {
      // Consecutive list items of one kind form one list.
      const kind = block.kind;
      const group: AgreementBlock[] = [];
      while (index < blocks.length && blocks[index].kind === kind) group.push(blocks[index++]);
      items.push(
        <ul
          key={`list-${index}`}
          className={cn("space-y-1 pl-6", kind === "bullet" ? "list-disc" : "list-none")}
        >
          {group.map((item, itemIndex) => (
            <li key={itemIndex} className={cn(item.center && "text-center")}>
              {kind === "numbered" && <span className="-ml-6 inline-block w-6">{item.marker}</span>}
              <Runs runs={item.runs} />
            </li>
          ))}
        </ul>,
      );
      continue;
    }
    if (block.kind === "blank") {
      items.push(<div key={index} aria-hidden className="h-[0.6em]" />);
    } else {
      const Tag = block.kind === "heading" ? "h2" : block.kind === "subheading" ? "h3" : "p";
      items.push(
        <Tag key={index} className={cn(BLOCK_CLASS[block.kind], block.center && "text-center")}>
          <Runs runs={block.runs} />
        </Tag>,
      );
    }
    index += 1;
  }
  return (
    <div className={cn("space-y-2 break-words", className)}>
      {items.map((item, i) => (
        <Fragment key={i}>{item}</Fragment>
      ))}
    </div>
  );
}
