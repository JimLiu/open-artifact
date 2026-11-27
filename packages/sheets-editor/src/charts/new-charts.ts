import type { ChartEditOutcome } from '../state/controller.ts';
import { askAgentForChartCode, type ChartCodeAgent, type WhyNoChartCodeFromAgent } from './agent-edits.ts';
import { newChartRequest, readChartCodeAnswer, tableChartRequest, tableIdOfAnswer, type CellsForNewChart, type ChartCodeAsk, type TablesForNewChart } from './chart-code-ask.ts';
import { STOCK_CHART_PROGRAMS, type StockKind } from './stock-programs.ts';
import type { ChartWidgetNodes } from './widget-nodes.ts';
/** Asks the page to place a chart that shows this node. */
export type AddChartNode = (nodeId: string) => Promise<ChartEditOutcome>;
/** What came of adding a chart: the node it shows and the step that placed it, or why it was not placed. */
export type ChartAddedOutcome = ({ nodeId: string } & Extract<ChartEditOutcome, object>) | 'full' | 'notMade';
/** New charts whose code the agent writes. */
export interface ChartWriterByAgent {
  isToBeHad(): Promise<boolean>;
  write(inputs: CellsForNewChart, asked: string | null, mostUnits: number): Promise<WhyNoChartCodeFromAgent | { nodeId: string }>;
  writeOfTables(inputs: TablesForNewChart, asked: string, mostUnits: number): Promise<WhyNoChartCodeFromAgent | { nodeId: string; tableId: string }>;
  giveUp(): void;
  discard(nodeId: string): void;
}
/** New charts the page makes itself, from the stock programs. */
export interface StockChartMaker {
  readonly isToBeHad: boolean;
  make(kind: StockKind, add: AddChartNode): Promise<ChartAddedOutcome | 'codeRefused'>;
}
export async function addChartOfNode(nodeId: string, add: AddChartNode, discard: (nodeId: string) => void): Promise<ChartAddedOutcome> {
  const added = await add(nodeId);
  if (typeof added === 'object')
    return {
      nodeId,
      ...added,
    };
  if (added !== 'unsure') discard(nodeId);
  return added === 'full' ? 'full' : 'notMade';
}
export function createChartWriterByAgent(charts: ChartWidgetNodes, agent: ChartCodeAgent): ChartWriterByAgent {
  let writeNumber = 0;
  async function writeFor<More extends object>(
    request: ChartCodeAsk | null,
    moreOfAnswer: (answer: unknown) => More | null,
  ): Promise<WhyNoChartCodeFromAgent | ({ nodeId: string } & More)> {
    writeNumber += 1;
    let thisWrite = writeNumber;
    let reply = await askAgentForChartCode(agent, request);
    if (thisWrite !== writeNumber) return 'stopped';
    if ('whyNone' in reply) return reply.whyNone;
    let [code, more] = [readChartCodeAnswer(reply.answer), moreOfAnswer(reply.answer)];
    if (code === null || more === null) return 'notChanged';
    let preview = await charts.makePreview(code);
    if (thisWrite === writeNumber)
      return typeof preview === 'string'
        ? 'notChanged'
        : {
            ...preview,
            ...more,
          };
    if (typeof preview !== 'string') charts.discard(preview.nodeId);
    return 'stopped';
  }
  return {
    isToBeHad: async () => charts.isToBeHad && (await agent.isAvailable()),
    write: (inputs, asked, mostUnits) => writeFor(newChartRequest(inputs, asked, mostUnits), () => ({})),
    writeOfTables: (inputs, asked, mostUnits) =>
      writeFor(tableChartRequest(inputs, asked, mostUnits), (answer) => {
        let tableId = tableIdOfAnswer(answer, inputs.tables);
        return tableId === null
          ? null
          : {
              tableId,
            };
      }),
    giveUp() {
      writeNumber += 1;
      agent.stop();
    },
    discard: (nodeId) => charts.discard(nodeId),
  };
}
export async function insertChartWrittenByAgent(
  deps: { agent: Pick<ChartWriterByAgent, 'write' | 'discard'>; add: AddChartNode },
  inputs: CellsForNewChart,
  { asked, mostUnitsOfAsked }: { asked: string | null; mostUnitsOfAsked: number },
): Promise<WhyNoChartCodeFromAgent | ChartAddedOutcome> {
  const preview = await deps.agent.write(inputs, asked, mostUnitsOfAsked);
  if (typeof preview === 'string') return preview;
  return addChartOfNode(preview.nodeId, deps.add, (nodeId) => deps.agent.discard(nodeId));
}
export async function insertChartWrittenForTables(
  deps: { agent: Pick<ChartWriterByAgent, 'writeOfTables' | 'discard'>; add: (nodeId: string, tableId: string) => Promise<ChartEditOutcome> },
  inputs: TablesForNewChart,
  { asked, mostUnitsOfAsked }: { asked: string; mostUnitsOfAsked: number },
): Promise<WhyNoChartCodeFromAgent | ChartAddedOutcome> {
  const preview = await deps.agent.writeOfTables(inputs, asked, mostUnitsOfAsked);
  if (typeof preview === 'string') return preview;
  return addChartOfNode(
    preview.nodeId,
    (nodeId) => deps.add(nodeId, preview.tableId),
    (nodeId) => deps.agent.discard(nodeId),
  );
}
export const NO_CHART_MAKER: StockChartMaker = {
  isToBeHad: false,
  make: () => Promise.resolve('notMade'),
};
export const createStockChartMaker = (charts: ChartWidgetNodes): StockChartMaker => ({
  get isToBeHad() {
    return charts.isToBeHad;
  },
  async make(kind, add) {
    const preview = await charts.makePreview(STOCK_CHART_PROGRAMS[kind]);
    if (typeof preview === 'string') return preview === 'refused' ? 'codeRefused' : 'notMade';
    return addChartOfNode(preview.nodeId, add, (nodeId) => charts.discard(nodeId));
  },
});
