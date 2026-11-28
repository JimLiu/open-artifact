import type { ArgumentRule, FilledArguments, QueryConnector, RuleProblem, SqlToolSpec } from './connector-types.ts';
import type {
  DashboardContent,
  Dataset,
  ParameterValue,
  Parameters,
  QuerySource,
  SqlQuoteMode,
  UnfilledCode,
  UnknownRecord,
} from './types.ts';
import { isPlainObject } from './text.ts';
import { checkRulePattern } from './rule-pattern.ts';
import { EMPTY_PARAMS, markParsedContent, parseDashboardContent } from './model.ts';
import { getSourceConnectorSpec, getSqlToolSpec } from './connectors.ts';
import {
  EXACT_PARAMETER_PLACEHOLDER_PATTERN,
  PARAMETER_PLACEHOLDER_PATTERN,
  STICKY_PARAMETER_PLACEHOLDER_PATTERN,
  fillSqlParameters,
  getParameterValue,
  parameterToText,
  portableSqlParameterLiteral,
  tokenizeSqlWithPlaceholders,
} from './sql.ts';
import {
  HIDDEN_CHAR_MARK,
  findUnplainCharIn,
  getTextRuleVerdict,
  isRulePinned,
  isRuleReadable,
  makeUnfilledProblem,
  ruleAllows,
} from './rules.ts';

const placeholders = (): RegExp => new RegExp(PARAMETER_PLACEHOLDER_PATTERN.source, 'g');

/** Every string inside a JSON value, depth first. */
export function collectNestedStrings(value: unknown, into: string[] = []): string[] {
  if (typeof value === 'string') into.push(value);
  else if (Array.isArray(value)) for (const item of value) collectNestedStrings(item, into);
  else if (isPlainObject(value)) for (const item of Object.values(value)) collectNestedStrings(item, into);
  return into;
}

/** A query's argument template (JSON text) as an object; empty when it isn't one. */
export function parseTemplateArguments(template: string): UnknownRecord {
  try {
    const value: unknown = JSON.parse(template);
    return isPlainObject(value) ? value : {};
  } catch {
    return {};
  }
}

/** The `{{filter}}` names written anywhere in a value's strings (repeats kept). */
export function collectArgumentParameterNames(value: unknown): string[] {
  return collectNestedStrings(value).flatMap((text) => [...text.matchAll(placeholders())].map((match) => match[1] as string));
}

/** The filter a whole argument is, `{{name}}` alone (a `call` source allows only spaces and tabs around it). */
export function getExactParameterPlaceholder(text: string, source: { call?: true } = {}): string | null {
  return (source.call ? STICKY_PARAMETER_PLACEHOLDER_PATTERN : EXACT_PARAMETER_PLACEHOLDER_PATTERN).exec(text)?.[1] ?? null;
}

/** The filters a query writes outside quotes (in its SQL argument) or anywhere in its other arguments. */
export function getUnquotedQueryParameters(source: QuerySource): string[] {
  const spec = getSqlToolSpec(source);
  const fromSql = (sql: string, quotes?: SqlQuoteMode): string[] =>
    tokenizeSqlWithPlaceholders(sql, quotes).flatMap((token) =>
      token.kind === 'placeholder' ? collectArgumentParameterNames(token.text) : [],
    );
  return [
    ...new Set(
      Object.entries(parseTemplateArguments(source.template ?? source.args)).flatMap(([name, value]) =>
        name === spec?.sqlArg && typeof value === 'string' ? fromSql(value, spec.quotes) : collectArgumentParameterNames(value),
      ),
    ),
  ];
}

/** A known-connector query with a `{{filter}}` mixed into an argument other than its SQL. */
export function hasPartialArgumentPlaceholders(source: QuerySource): boolean {
  if (getSourceConnectorSpec(source) === null) return false;
  const sqlArg = getSqlToolSpec(source)?.sqlArg;
  return Object.entries(parseTemplateArguments(source.template ?? source.args)).some(
    ([name, value]) =>
      name !== sqlArg &&
      collectNestedStrings(value).some(
        (text) => !EXACT_PARAMETER_PLACEHOLDER_PATTERN.test(text) && PARAMETER_PLACEHOLDER_PATTERN.test(text),
      ),
  );
}

/** The first whole-argument filter no rule pins, or `null`. */
export function findUnpinnedExactPlaceholder(source: QuerySource): string | null {
  const rules = source.rules ?? {};
  for (const text of collectNestedStrings(parseTemplateArguments(source.template ?? source.args))) {
    const name = getExactParameterPlaceholder(text, source);
    if (name !== null && !isRulePinned(rules[name])) return name;
  }
  return null;
}

export function getUnpinnedUnquotedParameters(source: QuerySource): string[] {
  const rules = source.rules ?? {};
  return getUnquotedQueryParameters(source).filter((name) => !isRulePinned(rules[name]));
}

/** The `{{filter}}`s a `kind: "call"` source writes into text (not as a whole argument). */
export function getCallTextFilters(source: QuerySource): Set<string> {
  return new Set(
    collectNestedStrings(parseTemplateArguments(source.template ?? source.args)).flatMap((text) =>
      STICKY_PARAMETER_PLACEHOLDER_PATTERN.test(text) ? [] : collectArgumentParameterNames(text),
    ),
  );
}

/** The text filters of a `call` source that no rule pins (`check` names them). */
export function getUnpinnedTextFilters(source: QuerySource): string[] {
  return source.call ? [...getCallTextFilters(source)].filter((name) => !isRulePinned(source.rules?.[name])) : [];
}

/** What is wrong with a `call` source's filters: a text filter with no pinning rule, or a rule that can't be used. */
export function getSourceRuleProblems(source: QuerySource): RuleProblem[] {
  if (!source.call) return [];
  const problems: RuleProblem[] = getUnpinnedTextFilters(source).map((filter) => ({ filter, what: 'filter_without_rule' }));
  for (const [filter, rule] of Object.entries(source.rules ?? {})) {
    const pattern = (rule.items ?? rule).pattern;
    const problem = pattern === undefined ? null : checkRulePattern(pattern);
    if (problem !== null) problems.push({ filter, what: 'rule_unreadable', problem });
  }
  if (source.rulesRefused) problems.push({ filter: '*', what: 'rule_unreadable' });
  return problems;
}

const datasetParameterNames = new WeakMap<Dataset, string[]>();

/** The filters a dataset's query uses, once each. */
export function getDatasetParameterNames(dataset: Dataset): string[] {
  const source = dataset.source;
  const template = source.kind === 'query' ? (source.template ?? source.args) : '';
  if (!template.includes('{{')) return [];
  let names = datasetParameterNames.get(dataset);
  if (names === undefined) {
    names = [...new Set(collectArgumentParameterNames(parseTemplateArguments(template)))];
    datasetParameterNames.set(dataset, names);
  }
  return names;
}

/** Walks a template's argument strings: a whole-`{{name}}` string goes to `whole`, any other string to `text`. */
export function mapTemplateStrings(
  template: string,
  wholePattern: RegExp,
  whole: (name: string, original: string) => unknown,
  text: (input: string) => unknown,
): UnknownRecord {
  const walk = (value: unknown): unknown => {
    if (typeof value === 'string') {
      const name = wholePattern.exec(value)?.[1];
      return name === undefined ? text(value) : whole(name, value);
    }
    if (Array.isArray(value)) return value.map(walk);
    return isPlainObject(value) ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, walk(item)])) : value;
  };
  return Object.fromEntries(Object.entries(parseTemplateArguments(template)).map(([key, value]) => [key, walk(value)]));
}

type UnfilledProblem = Required<Pick<FilledArguments, 'unfilled' | 'unfilledAs'>>;

/** Fills a `kind: "call"` source's template: each filter is checked against its rule first; no rule, no text value. */
export function fillCallArguments(
  template: string,
  params: Parameters,
  rules: Record<string, ArgumentRule> | undefined,
  rulesRefused: boolean,
): FilledArguments {
  const textFilters = new Set<string>();
  const wholeFilters = new Set<string>();
  mapTemplateStrings(
    template,
    STICKY_PARAMETER_PLACEHOLDER_PATTERN,
    (name) => wholeFilters.add(name),
    (input) => {
      for (const name of collectArgumentParameterNames(input)) textFilters.add(name);
      return input;
    },
  );
  const ruleOf = (name: string): ArgumentRule | undefined =>
    rules !== undefined && Object.hasOwn(rules, name) ? rules[name] : undefined;
  let problem: UnfilledProblem | null = null;
  for (const name of [...textFilters, ...wholeFilters]) {
    const rule = ruleOf(name);
    if ((textFilters.has(name) && rulesRefused) || (rule !== undefined && !isRuleReadable(rule)))
      problem ??= makeUnfilledProblem('unreadableRules', name);
  }
  const args = JSON.stringify(
    mapTemplateStrings(
      template,
      STICKY_PARAMETER_PLACEHOLDER_PATTERN,
      (name, original) => {
        const value = getParameterValue(params, name);
        const rule = ruleOf(name);
        if (rule === undefined) return value;
        const unset: UnfilledCode | null =
          value === null ? 'ruledOutUnset' : typeof value === 'object' && value.length === 0 ? 'noneChosen' : null;
        if (
          isRuleReadable(rule) &&
          (unset === null || (unset === 'noneChosen' && rule.items !== undefined)) &&
          ruleAllows(rule, value)
        )
          return value;
        problem ??= !isRuleReadable(rule)
          ? makeUnfilledProblem('unreadableRules', name)
          : makeUnfilledProblem(unset ?? 'ruledOut', name);
        return original;
      },
      (input) =>
        input.replace(placeholders(), (whole: string, name: string) => {
          const rule = ruleOf(name);
          if (rulesRefused || (rule !== undefined && !isRuleReadable(rule))) return whole;
          const value = getParameterValue(params, name);
          const empty = value === null || (typeof value === 'object' && value.length === 0);
          const used: ParameterValue = empty ? '' : value;
          const verdict = rule === undefined ? null : getTextRuleVerdict(rule, rule.items === undefined ? used : value);
          if (verdict !== null) {
            problem ??= makeUnfilledProblem(value === null ? 'ruledOutUnset' : empty ? 'noneChosen' : verdict, name);
            return whole;
          }
          const bad = isRulePinned(rule) ? null : findUnplainCharIn(used);
          if (bad === null) return parameterToText(value);
          problem ??=
            bad === HIDDEN_CHAR_MARK ? makeUnfilledProblem('hiddenChar', name) : makeUnfilledProblem('notPlain', name, bad);
          return whole;
        }),
    ),
  );
  return problem === null ? { args } : { args, ...(problem as UnfilledProblem) };
}

/** Fills a known connector's (`kind: "query"`) template: a `{{filter}}` in its SQL becomes a SQL literal. */
export function fillKnownConnectorArguments(
  template: string,
  spec: QueryConnector | null,
  tool: string,
  params: Parameters,
): FilledArguments {
  const sqlSpec =
    spec !== null && Object.hasOwn(spec.query, tool) && spec.query[tool]?.sqlArg !== undefined
      ? (spec.query[tool] as SqlToolSpec)
      : undefined;
  const formatInline = spec === null ? portableSqlParameterLiteral : parameterToText;
  const filled = mapTemplateStrings(
    template,
    EXACT_PARAMETER_PLACEHOLDER_PATTERN,
    (name) => getParameterValue(params, name),
    (input) => input.replace(placeholders(), (_whole: string, name: string) => formatInline(getParameterValue(params, name))),
  );
  let quoted: string | null = null;
  for (const [key, value] of Object.entries(parseTemplateArguments(template))) {
    if (key !== sqlSpec?.sqlArg || typeof value !== 'string') continue;
    const result = fillSqlParameters(value, params, sqlSpec.quotes);
    filled[key] = result.text;
    quoted = result.quoted;
  }
  const args = JSON.stringify(filled);
  return quoted === null ? { args } : { args, ...makeUnfilledProblem('quotedFilter', quoted) };
}

const filledDatasets = new WeakMap<Dataset, { key: string; out: Dataset }>();

/**
 * The dataset with its query's filters filled in from `params` (`template` keeps the written arguments,
 * `values` the filter values used, `unfilled`/`unfilledAs` why a filter couldn't be filled). Cached per values.
 */
export function fillDatasetParameters(dataset: Dataset, params: Parameters): Dataset {
  const source = dataset.source;
  const names = getDatasetParameterNames(dataset);
  if (source.kind !== 'query' || names.length === 0) return dataset;
  const key = JSON.stringify(names.map((name) => getParameterValue(params, name)));
  const cached = filledDatasets.get(dataset);
  if (cached !== undefined && cached.key === key) return cached.out;
  const firstFill = source.template === undefined;
  const template = source.template ?? source.args;
  const { args, ...extra } = source.call
    ? fillCallArguments(template, params, source.rules, source.rulesRefused === true)
    : fillKnownConnectorArguments(template, getSourceConnectorSpec(source), source.tool, params);
  const values = Object.freeze(Object.fromEntries(names.map((name) => [name, getParameterValue(params, name)])));
  const filledSource: QuerySource = {
    kind: source.kind,
    ...(source.call ? { call: true as const } : {}),
    connector: source.connector,
    tool: source.tool,
    args,
    ...(source.rules === undefined ? {} : { rules: source.rules }),
    ...(source.rulesRefused ? { rulesRefused: true as const, refusedRules: source.refusedRules } : {}),
    template,
    values,
    ...extra,
  };
  const unchanged =
    args === source.args &&
    extra.unfilled === source.unfilled &&
    (!source.call || (source.values !== undefined && parameterRecordsEqual(values, source.values as Parameters)));
  const out = firstFill || !unchanged ? { ...dataset, source: filledSource } : dataset;
  filledDatasets.set(dataset, { key, out });
  return out;
}

const preparedContents = new WeakSet<object>();

/** Parsed dashboard content with every dataset's filters filled in from the stored `dash/params`. */
export function prepareDashboardContent(raw: unknown): DashboardContent {
  if (typeof raw === 'object' && raw !== null && preparedContents.has(raw)) return raw as DashboardContent;
  const content = parseDashboardContent(raw);
  const datasets = content.datasets.map((dataset) => fillDatasetParameters(dataset, content.params));
  const prepared = datasets.every((dataset, index) => dataset === content.datasets[index]) ? content : { ...content, datasets };
  preparedContents.add(markParsedContent(prepared));
  return prepared;
}

/** `overrides` laid over `base`, as a new null-prototype record. */
export function mergeParameterRecords(base: Parameters, overrides: Parameters = EMPTY_PARAMS): Parameters {
  return Object.assign(Object.create(null) as Parameters, base, overrides);
}

/** The datasets filled in with a viewer's filter choices laid over the stored ones. */
export function getFilteredDatasets(content: DashboardContent, overrides: Parameters): Dataset[] {
  if (Object.keys(overrides).length === 0) return content.datasets;
  const params = mergeParameterRecords(content.params, overrides);
  const datasets = content.datasets.map((dataset) => fillDatasetParameters(dataset, params));
  return datasets.every((dataset, index) => dataset === content.datasets[index]) ? content.datasets : datasets;
}

/** Every filter a query uses (unset as `null`), with the stored values and then the viewer's laid over them. */
export function getEffectiveParameters(content: DashboardContent, overrides: Parameters): Parameters {
  const used = mergeParameterRecords(EMPTY_PARAMS);
  for (const dataset of content.datasets) for (const name of getDatasetParameterNames(dataset)) used[name] = null;
  return mergeParameterRecords(mergeParameterRecords(used, content.params), overrides);
}

export function parameterValuesEqual(a: ParameterValue, b: ParameterValue): boolean {
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return a === b;
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

export function parameterRecordsEqual(a: Parameters, b: Parameters): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => Object.hasOwn(b, key) && parameterValuesEqual(a[key] ?? null, b[key] ?? null));
}

/** A viewer's filter choices laid over theirs so far (`null` clears them); the same record when nothing changed. */
export function applyParameterOverrides(current: Parameters, overrides: Parameters | null): Parameters {
  if (overrides === null) return Object.keys(current).length === 0 ? current : EMPTY_PARAMS;
  const merged = mergeParameterRecords(current, overrides);
  return parameterRecordsEqual(merged, current) ? current : merged;
}
