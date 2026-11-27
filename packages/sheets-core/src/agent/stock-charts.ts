type FirstStockKind = 'bar' | 'stackedBar' | 'line' | 'pie';

export type StockKind = FirstStockKind | 'horizontalBar' | 'stackedBar100' | 'area' | 'scatter';

/** Every stock kind, in the order Insert chart lists them. */
export const STOCK_KINDS: readonly StockKind[] = ['bar', 'horizontalBar', 'stackedBar', 'stackedBar100', 'line', 'area', 'scatter', 'pie'];

/** The name of the one input a stock chart reads. */
export const STOCK_INPUT = 'rows';

const FIRST_PROGRAMS: Readonly<Record<FirstStockKind, string>> = {
  bar: `export default () => <sheet.Visualize data-component='bars' sources={{rows: {kind: 'ref', ref: 'input/rows', adapter: {kind: 'cells'}}, chartSize: {kind: 'data', data: [{width: 480, height: 280}]}, chartWords: {kind: 'data', data: [{locale: 'en-US', one: '# value isn’t a number and isn’t shown', other: '# values aren’t numbers and aren’t shown'}]}}}>{({rows, chartSize, chartWords}) => {
  const wide = chartSize.at(0).width, high = chartSize.at(0).height;
  const isNumber = c => typeof c.value === 'number';
  const isFilled = r => r.some(c => c.text !== '');
  const fit = (t, room) => 7.5 * t.length > room ? t.slice(0, Math.max(1, Math.floor(room / 7.5) - 1)) + '…' : t;
  const seen = rows.slice(0, 100).filter(isFilled);
  const hasHead = seen.length > 1 && !seen.at(0).some(isNumber);
  const head = hasHead ? seen.at(0) : null, probe = hasHead ? seen.slice(1) : seen, below = rows.filter(isFilled).slice(hasHead ? 1 : 0);
  const width = probe.length ? probe.at(0).length : 0;
  const isYear = c => isNumber(c) && Number.isInteger(c.value) && c.value > 1800 && c.value < 2200;
  const hasLabels = width > 1 && (!probe.some(r => isNumber(r.at(0))) || probe.every(r => isYear(r.at(0))));
  const all = Array.from({length: width}, (_, i) => i).filter(i => i >= (hasLabels ? 1 : 0) && probe.some(r => isNumber(r.at(i)))).map((i, k) => ({i, name: head ? head.at(i).text : '', tag: head ? fit(head.at(i).text, 135) : '', hue: 'var(--chart-categorical-' + (k % 8 + 1) + ')'}));
  const body = below.filter(r => hasLabels ? r.at(0).text !== '' : all.some(s => isNumber(r.at(s.i))));
  const label = (r, j) => hasLabels ? r.at(0).text : String(j + 1);
  const over = head && hasLabels ? head.at(0).text : '';
  const out = below.filter(r => !hasLabels || r.at(0).text !== '').flatMap(r => all.map(s => r.at(s.i))).filter(c => !isNumber(c) && c.text !== '').length;
  const said = chartWords.at(0), form = Object.entries(said).find(e => e.at(0) === new Intl.PluralRules(said.locale).select(out));
  const note = out === 0 ? '' : (form ? form.at(1) : said.other).split('#').join(out.toLocaleString(said.locale));
  const gray = 'var(--text-secondary)';
  const ends = body.length ? label(body.at(0), 0) + ' – ' + label(body.at(-1), body.length - 1) : '';
  const named = all.filter(s => s.name !== '').map(s => s.name);
  const title = (named.length > 1 ? named.slice(0, -1).join(', ') + ' and ' + named.at(-1) : named.join('')) + (named.length && over !== '' ? ' by ' + over : '');
  const sample = body.flatMap(r => all.map(s => r.at(s.i))).find(isNumber);
  const isPercent = !!sample && sample.text.endsWith('%'), sign = sample && ['$', '€', '£', '¥'].find(m => sample.text.startsWith(m) || sample.text.startsWith('-' + m)) || '';
  const round = (v, s) => (Math.round(v * 10) / 10).toLocaleString('en-US') + s;
  const plain = (v, places) => { const a = Math.abs(v); return a >= 1e9 ? round(v / 1e9, 'B') : a >= 1e6 ? round(v / 1e6, 'M') : a >= 1e4 ? round(v / 1e3, 'K') : v.toLocaleString('en-US', {maximumFractionDigits: places}); };
  const short = (v, places) => isPercent ? plain(v * 100, Math.max(0, places - 2)) + '%' : (v < 0 ? '-' : '') + sign + plain(Math.abs(v), places);
  const [off, setOff] = useState([]);
  const hasLegend = all.length > 1 && named.length === all.length;
  const legendAt = k => all.slice(0, k).reduce((a, b) => a + 36 + 7 * b.tag.length, 16);
  const scale = Math.max(1, Math.max(320, hasLegend ? legendAt(all.length) : 0) / wide, 200 / high), W = wide * scale, H = high * scale;
  const series = all.filter(s => !off.includes(s.i));
  const num = (r, s) => isNumber(r.at(s.i)) ? r.at(s.i).value : 0;
  const least = Math.min(0, ...body.flatMap(r => series.map(s => num(r, s)))), most = Math.max(0, ...body.flatMap(r => series.map(s => num(r, s)))) || (least < 0 ? 0 : 1);
  const span = most - least, p = 10 ** Math.floor(Math.log10(span / 4)), step = p * [1, 2, 2.5, 5, 10].find(m => m * p * 4 >= span);
  const ticks = Array.from({length: Math.ceil(most / step) - Math.floor(least / step) + 1}, (_, n) => (Math.floor(least / step) + n) * step);
  const places = Math.min(8, Math.max(0, 1 - Math.floor(Math.log10(step))));
  const drop = note === '' ? 0 : title === '' ? 30 : 18, y0 = (title === '' ? 20 : 52) + drop, foot = hasLegend ? 64 : 34.5;
  const printed = (r, s) => r.at(s.i).text.length <= 7 ? r.at(s.i).text : short(num(r, s), places);
  const roomy = (W - 32) / Math.max(1, body.length);
  const prints = all.length === 1 && series.length === 1 && body.every(r => !isNumber(r.at(all.at(0).i)) || 7 * printed(r, all.at(0)).length + 4 <= roomy);
  const left = prints ? 16 : 24 + 7.5 * Math.max(...ticks.map(t => short(t, places).length)), w = W - 16 - left, h = H - y0 - foot - (prints && least < 0 ? 16 : 0) - (prints ? 12 : 0), lift = prints ? 12 : 0, y = v => y0 + lift + h - h * (v - ticks.at(0)) / (ticks.at(-1) - ticks.at(0));
  const band = w / Math.max(1, body.length);
  const longest = 7 * Math.max(0, ...body.map((r, j) => label(r, j).length)), every = Math.ceil((longest + 8) / band);
  const thick = Math.max(1, Math.min(20, (band * 0.75 + 2) / Math.max(1, series.length) - 2));
  const lies = all.length === 1 && series.length === 1 && least === 0 && every > 1 && body.length <= Math.floor((H - y0 + drop - 16) / 22);
  const bar = (x, v, thick) => { const t = Math.abs(y(0) - y(v)), q = Math.min(4, thick / 4, t), up = v < 0 ? 1 : -1; return 'M' + x + ' ' + y(0) + 'v' + up * (t - q) + 'a' + q + ' ' + q + ' 0 0 ' + (v < 0 ? 0 : 1) + ' ' + q + ' ' + up * q + 'h' + (thick - 2 * q) + 'a' + q + ' ' + q + ' 0 0 ' + (v < 0 ? 0 : 1) + ' ' + q + ' ' + -up * q + 'v' + -up * (t - q) + 'z'; };
  const tips = body.length * series.length <= 400;
  if (lies) { const s = all.at(0), cut = t => t.length > 24 ? t.slice(0, 23) + '…' : t, names = 7 * Math.max(...body.map((r, j) => cut(label(r, j)).length)) + 8, row = (H - y0 - 16) / body.length, tall = Math.min(20, row - 6), far = W - 32 - names - 7 * Math.max(...body.map(r => isNumber(r.at(s.i)) ? printed(r, s).length : 0)) - 6, x0 = 16 + names;
    return <svg width='480' height='280' viewBox={'0 0 ' + W + ' ' + H} role='img' aria-label={[title || ends, note].filter(t => t !== '').join('. ')} fontSize='12'>
      {title !== '' && <text x='16' y='27' fontSize='14' fontWeight='500' fill='var(--text-primary)'>{fit(title, W - 32)}</text>}
      {note !== '' && <text x='16' y={title === '' ? 27 : 46} fill={gray}>{fit(note, (W - 32) * 7.5 / 6.5)}</text>}
      <line x1={x0} x2={x0} y1={y0} y2={H - 16} stroke='var(--chart-axis)'/>
      {body.map((r, j) => { const v = num(r, s), long = far * v / (most || 1), q = Math.min(4, tall / 4, long), at = y0 + j * row + (row - tall) / 2; return <g key={j}><text x={x0 - 8} y={at + tall / 2 + 4} textAnchor='end' fill={gray}>{cut(label(r, j))}</text>{isNumber(r.at(s.i)) && <Tooltip content={label(r, j)} detail={r.at(s.i).text}><path d={'M' + x0 + ' ' + at + 'h' + (long - q) + 'a' + q + ' ' + q + ' 0 0 1 ' + q + ' ' + q + 'v' + (tall - 2 * q) + 'a' + q + ' ' + q + ' 0 0 1 ' + -q + ' ' + q + 'h' + -(long - q) + 'z'} fill={s.hue}/></Tooltip>}{isNumber(r.at(s.i)) && <text x={x0 + long + 6} y={at + tall / 2 + 4} fill='var(--text-primary)'>{printed(r, s)}</text>}</g>; })}
    </svg>; }
  return <svg width='480' height='280' viewBox={'0 0 ' + W + ' ' + H} role='img' aria-label={[title || ends, note].filter(t => t !== '').join('. ')} fontSize='12'>
    {title !== '' && <text x='16' y='27' fontSize='14' fontWeight='500' fill='var(--text-primary)'>{fit(title, W - 32)}</text>}
    {note !== '' && <text x='16' y={title === '' ? 27 : 46} fill={gray}>{fit(note, (W - 32) * 7.5 / 6.5)}</text>}
    {hasLegend && all.map((s, k) => <g key={s.i} opacity={off.includes(s.i) ? 0.4 : 1} onClick={() => setOff(o => o.includes(s.i) ? o.filter(n => n !== s.i) : [...o, s.i])}><rect x={legendAt(k) - 4} y={H - 35} width={28 + 7 * s.tag.length} height='24' fill='transparent'/><rect x={legendAt(k)} y={H - 27.5} width='10' height='10' rx='2' fill={s.hue}/><text x={legendAt(k) + 16} y={H - 18.5} fill={gray}>{s.tag}</text></g>)}
    {prints ? <line x1={left} x2={W - 16} y1={y(0)} y2={y(0)} stroke='var(--chart-axis)'/> : ticks.map(t => <g key={t}><line x1={left} x2={W - 16} y1={y(t)} y2={y(t)} stroke={t ? 'var(--chart-grid)' : 'var(--chart-axis)'}/><text x={left - 8} y={y(t) + 4} textAnchor='end' fill={gray}>{short(t, places)}</text></g>)}
    {body.map((r, j) => <g key={j}>{series.map((s, k) => { const x = left + j * band + (band + 2) / 2 + (k - series.length / 2) * (thick + 2), v = num(r, s); if (!isNumber(r.at(s.i))) return null; const value = prints && <text x={x + thick / 2} y={v < 0 ? y(v) + 14 : y(v) - 5} textAnchor='middle' fill='var(--text-primary)'>{printed(r, s)}</text>; return tips ? <g key={s.i}><Tooltip content={label(r, j) + (s.name === '' ? '' : ', ' + s.name)} detail={r.at(s.i).text}><path d={bar(x, v, thick)} fill={s.hue}/></Tooltip>{value}</g> : <g key={s.i}><path d={bar(x, v, thick)} fill={s.hue}/>{value}</g>; })}</g>)}
    {body.map((r, j) => j % every === 0 && j * band + (every > 1 ? longest : 0) <= w && <text key={j} x={left + j * band + (every > 1 ? 0 : band / 2)} y={H - foot + 16} textAnchor={every > 1 ? 'start' : 'middle'} fill={gray}>{label(r, j)}</text>)}
  </svg>;
}}</sheet.Visualize>;`,
  stackedBar: `export default () => <sheet.Visualize data-component='stacked-bars' sources={{rows: {kind: 'ref', ref: 'input/rows', adapter: {kind: 'cells'}}, chartSize: {kind: 'data', data: [{width: 480, height: 280}]}, chartWords: {kind: 'data', data: [{locale: 'en-US', one: '# value isn’t a number and isn’t shown', other: '# values aren’t numbers and aren’t shown'}]}}}>{({rows, chartSize, chartWords}) => {
  const wide = chartSize.at(0).width, high = chartSize.at(0).height;
  const isNumber = c => typeof c.value === 'number';
  const isFilled = r => r.some(c => c.text !== '');
  const fit = (t, room) => 7.5 * t.length > room ? t.slice(0, Math.max(1, Math.floor(room / 7.5) - 1)) + '…' : t;
  const seen = rows.slice(0, 100).filter(isFilled);
  const hasHead = seen.length > 1 && !seen.at(0).some(isNumber);
  const head = hasHead ? seen.at(0) : null, probe = hasHead ? seen.slice(1) : seen, below = rows.filter(isFilled).slice(hasHead ? 1 : 0);
  const width = probe.length ? probe.at(0).length : 0;
  const isYear = c => isNumber(c) && Number.isInteger(c.value) && c.value > 1800 && c.value < 2200;
  const hasLabels = width > 1 && (!probe.some(r => isNumber(r.at(0))) || probe.every(r => isYear(r.at(0))));
  const all = Array.from({length: width}, (_, i) => i).filter(i => i >= (hasLabels ? 1 : 0) && probe.some(r => isNumber(r.at(i)))).map((i, k) => ({i, name: head ? head.at(i).text : '', tag: head ? fit(head.at(i).text, 135) : '', hue: 'var(--chart-categorical-' + (k % 8 + 1) + ')'}));
  const body = below.filter(r => hasLabels ? r.at(0).text !== '' : all.some(s => isNumber(r.at(s.i))));
  const label = (r, j) => hasLabels ? r.at(0).text : String(j + 1);
  const over = head && hasLabels ? head.at(0).text : '';
  const out = below.filter(r => !hasLabels || r.at(0).text !== '').flatMap(r => all.map(s => r.at(s.i))).filter(c => !isNumber(c) && c.text !== '').length;
  const said = chartWords.at(0), form = Object.entries(said).find(e => e.at(0) === new Intl.PluralRules(said.locale).select(out));
  const note = out === 0 ? '' : (form ? form.at(1) : said.other).split('#').join(out.toLocaleString(said.locale));
  const gray = 'var(--text-secondary)';
  const ends = body.length ? label(body.at(0), 0) + ' – ' + label(body.at(-1), body.length - 1) : '';
  const named = all.filter(s => s.name !== '').map(s => s.name);
  const title = (named.length > 1 ? named.slice(0, -1).join(', ') + ' and ' + named.at(-1) : named.join('')) + (named.length && over !== '' ? ' by ' + over : '');
  const sample = body.flatMap(r => all.map(s => r.at(s.i))).find(isNumber);
  const isPercent = !!sample && sample.text.endsWith('%'), sign = sample && ['$', '€', '£', '¥'].find(m => sample.text.startsWith(m) || sample.text.startsWith('-' + m)) || '';
  const round = (v, s) => (Math.round(v * 10) / 10).toLocaleString('en-US') + s;
  const plain = (v, places) => { const a = Math.abs(v); return a >= 1e9 ? round(v / 1e9, 'B') : a >= 1e6 ? round(v / 1e6, 'M') : a >= 1e4 ? round(v / 1e3, 'K') : v.toLocaleString('en-US', {maximumFractionDigits: places}); };
  const short = (v, places) => isPercent ? plain(v * 100, Math.max(0, places - 2)) + '%' : (v < 0 ? '-' : '') + sign + plain(Math.abs(v), places);
  const [off, setOff] = useState([]);
  const hasLegend = all.length > 1 && named.length === all.length;
  const legendAt = k => all.slice(0, k).reduce((a, b) => a + 36 + 7 * b.tag.length, 16);
  const scale = Math.max(1, Math.max(320, hasLegend ? legendAt(all.length) : 0) / wide, 200 / high), W = wide * scale, H = high * scale;
  const series = all.filter(s => !off.includes(s.i));
  const num = (r, s) => isNumber(r.at(s.i)) ? Math.max(0, r.at(s.i).value) : 0;
  const least = Math.min(0, 0), most = Math.max(0, ...body.map(r => series.reduce((a, s) => a + num(r, s), 0))) || (least < 0 ? 0 : 1);
  const span = most - least, p = 10 ** Math.floor(Math.log10(span / 4)), step = p * [1, 2, 2.5, 5, 10].find(m => m * p * 4 >= span);
  const ticks = Array.from({length: Math.ceil(most / step) - Math.floor(least / step) + 1}, (_, n) => (Math.floor(least / step) + n) * step);
  const places = Math.min(8, Math.max(0, 1 - Math.floor(Math.log10(step))));
  const drop = note === '' ? 0 : title === '' ? 30 : 18, y0 = (title === '' ? 20 : 52) + drop, foot = hasLegend ? 64 : 34.5;
  const left = 24 + 7.5 * Math.max(...ticks.map(t => short(t, places).length)), w = W - 16 - left, h = H - y0 - foot, y = v => y0 + h - h * (v - ticks.at(0)) / (ticks.at(-1) - ticks.at(0));
  const band = w / Math.max(1, body.length);
  const longest = 7 * Math.max(0, ...body.map((r, j) => label(r, j).length)), every = Math.ceil((longest + 8) / band);
  const thick = Math.max(1, Math.min(20, band * 0.75));
  const tips = body.length * series.length <= 400;
  const part = (x, from, to, onAxis) => { const t = Math.max(0, y(from) - y(to) - (onAxis ? 0 : 1)), q = Math.min(4, thick / 4, t / 2), b = onAxis ? 0 : q, at = y(from) - (onAxis ? 0 : 1); return 'M' + (x + b) + ' ' + at + 'a' + b + ' ' + b + ' 0 0 1 ' + -b + ' ' + -b + 'v' + -(t - q - b) + 'a' + q + ' ' + q + ' 0 0 1 ' + q + ' ' + -q + 'h' + (thick - 2 * q) + 'a' + q + ' ' + q + ' 0 0 1 ' + q + ' ' + q + 'v' + (t - q - b) + 'a' + b + ' ' + b + ' 0 0 1 ' + -b + ' ' + b + 'z'; };
  return <svg width='480' height='280' viewBox={'0 0 ' + W + ' ' + H} role='img' aria-label={[title || ends, note].filter(t => t !== '').join('. ')} fontSize='12'>
    {title !== '' && <text x='16' y='27' fontSize='14' fontWeight='500' fill='var(--text-primary)'>{fit(title, W - 32)}</text>}
    {note !== '' && <text x='16' y={title === '' ? 27 : 46} fill={gray}>{fit(note, (W - 32) * 7.5 / 6.5)}</text>}
    {hasLegend && all.map((s, k) => <g key={s.i} opacity={off.includes(s.i) ? 0.4 : 1} onClick={() => setOff(o => o.includes(s.i) ? o.filter(n => n !== s.i) : [...o, s.i])}><rect x={legendAt(k) - 4} y={H - 35} width={28 + 7 * s.tag.length} height='24' fill='transparent'/><rect x={legendAt(k)} y={H - 27.5} width='10' height='10' rx='2' fill={s.hue}/><text x={legendAt(k) + 16} y={H - 18.5} fill={gray}>{s.tag}</text></g>)}
    {ticks.map(t => <g key={t}><line x1={left} x2={W - 16} y1={y(t)} y2={y(t)} stroke={t ? 'var(--chart-grid)' : 'var(--chart-axis)'}/><text x={left - 8} y={y(t) + 4} textAnchor='end' fill={gray}>{short(t, places)}</text></g>)}
    {body.map((r, j) => <g key={j}>{series.map((s, k) => { const under = series.slice(0, k).reduce((a, b) => a + num(r, b), 0); if (!(num(r, s) > 0)) return null; const d = part(left + j * band + (band - thick) / 2, under, under + num(r, s), under === 0); return tips ? <Tooltip key={s.i} content={label(r, j) + (s.name === '' ? '' : ', ' + s.name)} detail={r.at(s.i).text}><path d={d} fill={s.hue}/></Tooltip> : <path key={s.i} d={d} fill={s.hue}/>; })}</g>)}
    {body.map((r, j) => j % every === 0 && j * band + (every > 1 ? longest : 0) <= w && <text key={j} x={left + j * band + (every > 1 ? 0 : band / 2)} y={y0 + h + 16} textAnchor={every > 1 ? 'start' : 'middle'} fill={gray}>{label(r, j)}</text>)}
  </svg>;
}}</sheet.Visualize>;`,
  line: `export default () => <sheet.Visualize data-component='lines' sources={{rows: {kind: 'ref', ref: 'input/rows', adapter: {kind: 'cells'}}, chartSize: {kind: 'data', data: [{width: 480, height: 280}]}, chartWords: {kind: 'data', data: [{locale: 'en-US', one: '# value isn’t a number and isn’t shown', other: '# values aren’t numbers and aren’t shown'}]}}}>{({rows, chartSize, chartWords}) => {
  const wide = chartSize.at(0).width, high = chartSize.at(0).height;
  const isNumber = c => typeof c.value === 'number';
  const isFilled = r => r.some(c => c.text !== '');
  const fit = (t, room) => 7.5 * t.length > room ? t.slice(0, Math.max(1, Math.floor(room / 7.5) - 1)) + '…' : t;
  const seen = rows.slice(0, 100).filter(isFilled);
  const hasHead = seen.length > 1 && !seen.at(0).some(isNumber);
  const head = hasHead ? seen.at(0) : null, probe = hasHead ? seen.slice(1) : seen, below = rows.filter(isFilled).slice(hasHead ? 1 : 0);
  const width = probe.length ? probe.at(0).length : 0;
  const isYear = c => isNumber(c) && Number.isInteger(c.value) && c.value > 1800 && c.value < 2200;
  const hasLabels = width > 1 && (!probe.some(r => isNumber(r.at(0))) || probe.every(r => isYear(r.at(0))));
  const all = Array.from({length: width}, (_, i) => i).filter(i => i >= (hasLabels ? 1 : 0) && probe.some(r => isNumber(r.at(i)))).map((i, k) => ({i, name: head ? head.at(i).text : '', tag: head ? fit(head.at(i).text, 135) : '', hue: 'var(--chart-categorical-' + (k % 8 + 1) + ')'}));
  const body = below.filter(r => hasLabels ? r.at(0).text !== '' : all.some(s => isNumber(r.at(s.i))));
  const label = (r, j) => hasLabels ? r.at(0).text : String(j + 1);
  const over = head && hasLabels ? head.at(0).text : '';
  const out = below.filter(r => !hasLabels || r.at(0).text !== '').flatMap(r => all.map(s => r.at(s.i))).filter(c => !isNumber(c) && c.text !== '').length;
  const said = chartWords.at(0), form = Object.entries(said).find(e => e.at(0) === new Intl.PluralRules(said.locale).select(out));
  const note = out === 0 ? '' : (form ? form.at(1) : said.other).split('#').join(out.toLocaleString(said.locale));
  const gray = 'var(--text-secondary)';
  const ends = body.length ? label(body.at(0), 0) + ' – ' + label(body.at(-1), body.length - 1) : '';
  const named = all.filter(s => s.name !== '').map(s => s.name);
  const title = (named.length > 1 ? named.slice(0, -1).join(', ') + ' and ' + named.at(-1) : named.join('')) + (named.length && over !== '' ? ' by ' + over : '');
  const sample = body.flatMap(r => all.map(s => r.at(s.i))).find(isNumber);
  const isPercent = !!sample && sample.text.endsWith('%'), sign = sample && ['$', '€', '£', '¥'].find(m => sample.text.startsWith(m) || sample.text.startsWith('-' + m)) || '';
  const round = (v, s) => (Math.round(v * 10) / 10).toLocaleString('en-US') + s;
  const plain = (v, places) => { const a = Math.abs(v); return a >= 1e9 ? round(v / 1e9, 'B') : a >= 1e6 ? round(v / 1e6, 'M') : a >= 1e4 ? round(v / 1e3, 'K') : v.toLocaleString('en-US', {maximumFractionDigits: places}); };
  const short = (v, places) => isPercent ? plain(v * 100, Math.max(0, places - 2)) + '%' : (v < 0 ? '-' : '') + sign + plain(Math.abs(v), places);
  const [off, setOff] = useState([]);
  const hasLegend = all.length > 1 && named.length === all.length;
  const legendAt = k => all.slice(0, k).reduce((a, b) => a + 36 + 7 * b.tag.length, 16);
  const scale = Math.max(1, Math.max(320, hasLegend ? legendAt(all.length) : 0) / wide, 200 / high), W = wide * scale, H = high * scale;
  const series = all.filter(s => !off.includes(s.i));
  const num = (r, s) => isNumber(r.at(s.i)) ? r.at(s.i).value : 0;
  const least = Math.min(0, ...body.flatMap(r => series.map(s => num(r, s)))), most = Math.max(0, ...body.flatMap(r => series.map(s => num(r, s)))) || (least < 0 ? 0 : 1);
  const span = most - least, p = 10 ** Math.floor(Math.log10(span / 4)), step = p * [1, 2, 2.5, 5, 10].find(m => m * p * 4 >= span);
  const ticks = Array.from({length: Math.ceil(most / step) - Math.floor(least / step) + 1}, (_, n) => (Math.floor(least / step) + n) * step);
  const places = Math.min(8, Math.max(0, 1 - Math.floor(Math.log10(step))));
  const drop = note === '' ? 0 : title === '' ? 30 : 18, y0 = (title === '' ? 20 : 52) + drop, foot = hasLegend ? 64 : 34.5;
  const left = 24 + 7.5 * Math.max(...ticks.map(t => short(t, places).length)), w = W - 16 - left, h = H - y0 - foot, y = v => y0 + h - h * (v - ticks.at(0)) / (ticks.at(-1) - ticks.at(0));
  const band = w / Math.max(1, body.length);
  const longest = 7 * Math.max(0, ...body.map((r, j) => label(r, j).length)), every = Math.ceil((longest + 8) / band);
  const at = j => left + j * band + band / 2;
  return <svg width='480' height='280' viewBox={'0 0 ' + W + ' ' + H} role='img' aria-label={[title || ends, note].filter(t => t !== '').join('. ')} fontSize='12'>
    {title !== '' && <text x='16' y='27' fontSize='14' fontWeight='500' fill='var(--text-primary)'>{fit(title, W - 32)}</text>}
    {note !== '' && <text x='16' y={title === '' ? 27 : 46} fill={gray}>{fit(note, (W - 32) * 7.5 / 6.5)}</text>}
    {hasLegend && all.map((s, k) => <g key={s.i} opacity={off.includes(s.i) ? 0.4 : 1} onClick={() => setOff(o => o.includes(s.i) ? o.filter(n => n !== s.i) : [...o, s.i])}><rect x={legendAt(k) - 4} y={H - 35} width={28 + 7 * s.tag.length} height='24' fill='transparent'/><rect x={legendAt(k)} y={H - 27.5} width='10' height='10' rx='2' fill={s.hue}/><text x={legendAt(k) + 16} y={H - 18.5} fill={gray}>{s.tag}</text></g>)}
    {ticks.map(t => <g key={t}><line x1={left} x2={W - 16} y1={y(t)} y2={y(t)} stroke={t ? 'var(--chart-grid)' : 'var(--chart-axis)'}/><text x={left - 8} y={y(t) + 4} textAnchor='end' fill={gray}>{short(t, places)}</text></g>)}
    {series.map(s => { const points = body.map((r, j) => ({r, j})).filter(o => isNumber(o.r.at(s.i))), last = points.at(-1); return <g key={s.i}><path d={points.map((o, n) => (n ? 'L' : 'M') + at(o.j) + ' ' + y(num(o.r, s))).join('')} fill='none' stroke={s.hue} strokeWidth='2' strokeLinejoin='round' strokeLinecap='round'/>{last && <circle cx={at(last.j)} cy={y(num(last.r, s))} r='4' fill={s.hue}/>}</g>; })}
    {body.length <= 400 && body.map((r, j) => <Tooltip key={j} content={label(r, j)} detail={series.filter(s => isNumber(r.at(s.i))).map(s => (s.name === '' ? '' : s.name + ' ') + r.at(s.i).text).join(', ')}><rect x={left + j * band} y={y0} width={band} height={h} fill='transparent'/></Tooltip>)}
    {body.map((r, j) => j % every === 0 && j * band + (every > 1 ? longest : 0) <= w && <text key={j} x={left + j * band + (every > 1 ? 0 : band / 2)} y={y0 + h + 16} textAnchor={every > 1 ? 'start' : 'middle'} fill={gray}>{label(r, j)}</text>)}
  </svg>;
}}</sheet.Visualize>;`,
  pie: `export default () => <sheet.Visualize data-component='a-ring' sources={{rows: {kind: 'ref', ref: 'input/rows', adapter: {kind: 'cells'}}, chartSize: {kind: 'data', data: [{width: 480, height: 280}]}, chartWords: {kind: 'data', data: [{locale: 'en-US', one: '# value isn’t a number and isn’t shown', other: '# values aren’t numbers and aren’t shown'}]}}}>{({rows, chartSize, chartWords}) => {
  const wide = chartSize.at(0).width, high = chartSize.at(0).height;
  const isNumber = c => typeof c.value === 'number';
  const isFilled = r => r.some(c => c.text !== '');
  const seen = rows.slice(0, 100).filter(isFilled);
  const hasHead = seen.length > 1 && !seen.at(0).some(isNumber);
  const head = hasHead ? seen.at(0) : null, probe = hasHead ? seen.slice(1) : seen, below = rows.filter(isFilled).slice(hasHead ? 1 : 0);
  const width = probe.length ? probe.at(0).length : 0;
  const isYear = c => isNumber(c) && Number.isInteger(c.value) && c.value > 1800 && c.value < 2200;
  const hasLabels = width > 1 && (!probe.some(r => isNumber(r.at(0))) || probe.every(r => isYear(r.at(0))));
  const all = Array.from({length: width}, (_, i) => i).filter(i => i >= (hasLabels ? 1 : 0) && probe.some(r => isNumber(r.at(i)))).map((i, k) => ({i, name: head ? head.at(i).text : '', hue: 'var(--chart-categorical-' + (k % 8 + 1) + ')'}));
  const body = below.filter(r => hasLabels ? r.at(0).text !== '' : all.some(s => isNumber(r.at(s.i))));
  const label = (r, j) => hasLabels ? r.at(0).text : String(j + 1);
  const over = head && hasLabels ? head.at(0).text : '';
  const out = below.filter(r => !hasLabels || r.at(0).text !== '').flatMap(r => all.slice(0, 1).map(s => r.at(s.i))).filter(c => !isNumber(c) && c.text !== '').length;
  const said = chartWords.at(0), form = Object.entries(said).find(e => e.at(0) === new Intl.PluralRules(said.locale).select(out));
  const note = out === 0 ? '' : (form ? form.at(1) : said.other).split('#').join(out.toLocaleString(said.locale));
  const gray = 'var(--text-secondary)';
  const fit = (t, room) => 7.5 * t.length > room ? t.slice(0, Math.max(1, Math.floor(room / 7.5) - 1)) + '…' : t;
  const ends = body.length ? label(body.at(0), 0) + ' – ' + label(body.at(-1), body.length - 1) : '';
  const first = all.at(0), num = r => first && isNumber(r.at(first.i)) ? Math.max(0, r.at(first.i).value) : 0;
  const only = first ? first.name + (first.name !== '' && over !== '' ? ' by ' + over : '') : '';
  const cut = t => t.length > 16 ? t.slice(0, 15) + '…' : t;
  const parts = body.map((r, j) => ({name: cut(label(r, j)), whole: label(r, j), text: first ? r.at(first.i).text : '', v: num(r)})).filter(o => o.v > 0).map((o, k) => ({...o, hue: 'var(--chart-categorical-' + (k % 8 + 1) + ')'}));
  const total = parts.reduce((a, b) => a + b.v, 0) || 1;
  const words = 7 * Math.max(0, ...parts.map(o => o.name.length + o.text.length + 1));
  const scale = Math.max(1, Math.max(320, 2 * words + 152) / wide, 200 / high), W = wide * scale, H = high * scale;
  const y0 = (only === '' ? 16 : 44) + (note === '' ? 0 : only === '' ? 30 : 18), R = Math.max(30, Math.min((W - 32 - 2 * words - 24) / 2, (H - y0 - 16 - 28) / 2)), cx = W / 2, cy = y0 + 14 + (H - y0 - 16 - 28) / 2;
  const turn = k => parts.slice(0, k).reduce((a, b) => a + b.v, 0) / total * 2 * Math.PI - Math.PI / 2;
  const on = (a, r) => (cx + r * Math.cos(a)) + ' ' + (cy + r * Math.sin(a));
  return <svg width='480' height='280' viewBox={'0 0 ' + W + ' ' + H} role='img' aria-label={[only || ends, note].filter(t => t !== '').join('. ')} fontSize='12'>
    {only !== '' && <text x='16' y='27' fontSize='14' fontWeight='500' fill='var(--text-primary)'>{fit(only, W - 32)}</text>}
    {note !== '' && <text x='16' y={only === '' ? 27 : 46} fill={gray}>{fit(note, (W - 32) * 7.5 / 6.5)}</text>}
    {parts.map((o, k) => { const a = turn(k), z = turn(k + 1) - (parts.length === 1 ? 0.0001 : 0), big = z - a > Math.PI ? 1 : 0, mid = (a + z) / 2, right = Math.cos(mid) >= 0; return <g key={k}><Tooltip content={o.whole} detail={o.text}><path d={'M' + on(a, R) + 'A' + R + ' ' + R + ' 0 ' + big + ' 1 ' + on(z, R) + 'L' + on(z, R * 0.6) + 'A' + R * 0.6 + ' ' + R * 0.6 + ' 0 ' + big + ' 0 ' + on(a, R * 0.6) + 'z'} fill={o.hue} stroke='var(--bg-primary)' strokeWidth='1'/></Tooltip><text x={cx + (R + 10) * Math.cos(mid)} y={cy + (R + 10) * Math.sin(mid) + 4} textAnchor={right ? 'start' : 'end'} fill={gray}>{o.name + ' ' + o.text}</text></g>; })}
  </svg>;
}}</sheet.Visualize>;`,
};

/** The text of `program` from its start through the first line that begins with `marker`; throws when there is none. */
function upToLineOf(program: string, marker: string): string {
  const at = program.indexOf('\n' + marker);
  if (at < 0) throw new Error(`stock chart: no line begins with ${marker}`);
  const end = program.indexOf('\n', at + 1);
  return program.slice(0, end + 1);
}

/** `text` with `from` put in place of `to`, which must be found exactly once. */
function withOnce(text: string, from: string, to: string): string {
  const parts = text.split(from);
  if (parts.length !== 2) throw new Error(`stock chart: ${JSON.stringify(from.slice(0, 40))} is found ${parts.length - 1} times`);
  return parts.join(to);
}

// Earlier programs of three kinds, under the names they had. Charts made with them keep running them, so they are
// still known by their kind.

/** An earlier area chart: the line chart, with the ground under each line filled. */
const AREA_PROGRAM = withOnce(
  withOnce(FIRST_PROGRAMS.line, "data-component='lines'", "data-component='areas'"),
  "last = points.at(-1); return <g key={s.i}><path d=",
  "last = points.at(-1); return <g key={s.i}>{points.length > 1 && <path d={'M' + at(points.at(0).j) + ' ' + y(0) + points.map(o => 'L' + at(o.j) + ' ' + y(num(o.r, s))).join('') + 'L' + at(last.j) + ' ' + y(0) + 'Z'} fill={s.hue} fillOpacity='0.24'/>}<path d=",
);

/**
 * An earlier horizontal bar chart: the bar chart's reading of the rows (headings, labels, series, the note and the
 * title), then a bar for each series in each row, laid from a value axis along the foot, with the labels down the left.
 */
const HORIZONTAL_BAR_PROGRAM =
  withOnce(upToLineOf(FIRST_PROGRAMS.bar, '  const drop = '), "data-component='bars'", "data-component='horizontal-bars'") +
  `  const cut = t => t.length > 20 ? t.slice(0, 19) + '…' : t;
  const names = Math.min(W * 0.35, 7.5 * Math.max(0, ...body.map((r, j) => cut(label(r, j)).length)) + 16);
  const x0 = 16 + names, x1 = W - 16 - 3.75 * short(ticks.at(-1), places).length, h = H - y0 - foot, x = v => x0 + (x1 - x0) * (v - ticks.at(0)) / (ticks.at(-1) - ticks.at(0));
  const band = h / Math.max(1, body.length), every = Math.ceil(16 / band);
  const thick = Math.max(1, Math.min(20, (band * 0.75 + 2) / Math.max(1, series.length) - 2));
  const tips = body.length * series.length <= 400;
  const bar = (v, upper) => { const a = x(0), long = Math.abs(x(v) - a), q = Math.min(4, thick / 4, long), d = v < 0 ? -1 : 1, f = v < 0 ? 0 : 1; return 'M' + a + ' ' + upper + 'h' + d * (long - q) + 'a' + q + ' ' + q + ' 0 0 ' + f + ' ' + d * q + ' ' + q + 'v' + (thick - 2 * q) + 'a' + q + ' ' + q + ' 0 0 ' + f + ' ' + -d * q + ' ' + q + 'h' + -d * (long - q) + 'z'; };
  return <svg width='480' height='280' viewBox={'0 0 ' + W + ' ' + H} role='img' aria-label={[title || ends, note].filter(t => t !== '').join('. ')} fontSize='12'>
    {title !== '' && <text x='16' y='27' fontSize='14' fontWeight='500' fill='var(--text-primary)'>{fit(title, W - 32)}</text>}
    {note !== '' && <text x='16' y={title === '' ? 27 : 46} fill={gray}>{fit(note, (W - 32) * 7.5 / 6.5)}</text>}
    {hasLegend && all.map((s, k) => <g key={s.i} opacity={off.includes(s.i) ? 0.4 : 1} onClick={() => setOff(o => o.includes(s.i) ? o.filter(n => n !== s.i) : [...o, s.i])}><rect x={legendAt(k) - 4} y={H - 35} width={28 + 7 * s.tag.length} height='24' fill='transparent'/><rect x={legendAt(k)} y={H - 27.5} width='10' height='10' rx='2' fill={s.hue}/><text x={legendAt(k) + 16} y={H - 18.5} fill={gray}>{s.tag}</text></g>)}
    {ticks.map(t => <g key={t}><line x1={x(t)} x2={x(t)} y1={y0} y2={y0 + h} stroke={t ? 'var(--chart-grid)' : 'var(--chart-axis)'}/><text x={x(t)} y={y0 + h + 16} textAnchor='middle' fill={gray}>{short(t, places)}</text></g>)}
    {body.map((r, j) => <g key={j}>{series.map((s, k) => { const upper = y0 + j * band + (band - series.length * (thick + 2) + 2) / 2 + k * (thick + 2); if (!isNumber(r.at(s.i))) return null; const d = bar(num(r, s), upper); return tips ? <Tooltip key={s.i} content={label(r, j) + (s.name === '' ? '' : ', ' + s.name)} detail={r.at(s.i).text}><path d={d} fill={s.hue}/></Tooltip> : <path key={s.i} d={d} fill={s.hue}/>; })}</g>)}
    {body.map((r, j) => j % every === 0 && <text key={j} x={x0 - 8} y={y0 + j * band + band / 2 + 4} textAnchor='end' fill={gray}>{fit(cut(label(r, j)), names - 8)}</text>)}
  </svg>;
}}</sheet.Visualize>;`;

/**
 * An earlier scatter chart: the first column holds the numbers each point lies along, and each other column with a
 * number in it is a series. Rows without a number in the first column are left out.
 */
const SCATTER_PROGRAM = `export default () => <sheet.Visualize data-component='scatter' sources={{rows: {kind: 'ref', ref: 'input/rows', adapter: {kind: 'cells'}}, chartSize: {kind: 'data', data: [{width: 480, height: 280}]}, chartWords: {kind: 'data', data: [{locale: 'en-US', one: '# value isn’t a number and isn’t shown', other: '# values aren’t numbers and aren’t shown'}]}}}>{({rows, chartSize, chartWords}) => {
  const wide = chartSize.at(0).width, high = chartSize.at(0).height;
  const isNumber = c => typeof c.value === 'number';
  const isFilled = r => r.some(c => c.text !== '');
  const fit = (t, room) => 7.5 * t.length > room ? t.slice(0, Math.max(1, Math.floor(room / 7.5) - 1)) + '…' : t;
  const seen = rows.slice(0, 100).filter(isFilled);
  const hasHead = seen.length > 1 && !seen.at(0).some(isNumber);
  const head = hasHead ? seen.at(0) : null, probe = hasHead ? seen.slice(1) : seen, below = rows.filter(isFilled).slice(hasHead ? 1 : 0);
  const width = probe.length ? probe.at(0).length : 0;
  const all = Array.from({length: width}, (_, i) => i).filter(i => i >= 1 && probe.some(r => isNumber(r.at(i)))).map((i, k) => ({i, name: head ? head.at(i).text : '', tag: head ? fit(head.at(i).text, 135) : '', hue: 'var(--chart-categorical-' + (k % 8 + 1) + ')'}));
  const body = below.filter(r => r.length > 0 && isNumber(r.at(0)));
  const across = head && width > 0 ? head.at(0).text : '';
  const out = below.flatMap(r => r.length > 0 ? [r.at(0), ...all.map(s => r.at(s.i))] : []).filter(c => !isNumber(c) && c.text !== '').length;
  const said = chartWords.at(0), form = Object.entries(said).find(e => e.at(0) === new Intl.PluralRules(said.locale).select(out));
  const note = out === 0 ? '' : (form ? form.at(1) : said.other).split('#').join(out.toLocaleString(said.locale));
  const gray = 'var(--text-secondary)';
  const ends = body.length ? body.length.toLocaleString('en-US') + (body.length === 1 ? ' point' : ' points') : '';
  const named = all.filter(s => s.name !== '').map(s => s.name);
  const title = (named.length > 1 ? named.slice(0, -1).join(', ') + ' and ' + named.at(-1) : named.join('')) + (named.length && across !== '' ? ' by ' + across : '');
  const round = (v, s) => (Math.round(v * 10) / 10).toLocaleString('en-US') + s;
  const plain = (v, places) => { const a = Math.abs(v); return a >= 1e9 ? round(v / 1e9, 'B') : a >= 1e6 ? round(v / 1e6, 'M') : a >= 1e4 ? round(v / 1e3, 'K') : v.toLocaleString('en-US', {maximumFractionDigits: places}); };
  const shortOf = sample => { const isPercent = !!sample && sample.text.endsWith('%'), sign = sample && ['$', '€', '£', '¥'].find(m => sample.text.startsWith(m) || sample.text.startsWith('-' + m)) || ''; return (v, places) => isPercent ? plain(v * 100, Math.max(0, places - 2)) + '%' : (v < 0 ? '-' : '') + sign + plain(Math.abs(v), places); };
  const [off, setOff] = useState([]);
  const hasLegend = all.length > 1 && named.length === all.length;
  const legendAt = k => all.slice(0, k).reduce((a, b) => a + 36 + 7 * b.tag.length, 16);
  const scale = Math.max(1, Math.max(320, hasLegend ? legendAt(all.length) : 0) / wide, 200 / high), W = wide * scale, H = high * scale;
  const series = all.filter(s => !off.includes(s.i));
  const axisOf = values => { const least = values.length ? Math.min(...values) : 0, most = values.length ? Math.max(...values) : 1, pad = least === most ? (Math.abs(most) || 1) / 2 : 0, lo = least - pad, hi = most + pad, span = hi - lo, p = 10 ** Math.floor(Math.log10(span / 4)), step = p * [1, 2, 2.5, 5, 10].find(m => m * p * 4 >= span); return {ticks: Array.from({length: Math.ceil(hi / step) - Math.floor(lo / step) + 1}, (_, n) => (Math.floor(lo / step) + n) * step), places: Math.min(8, Math.max(0, 1 - Math.floor(Math.log10(step))))}; };
  const ax = axisOf(body.map(r => r.at(0).value)), ay = axisOf(body.flatMap(r => series.filter(s => isNumber(r.at(s.i))).map(s => r.at(s.i).value)));
  const shortX = shortOf(body.map(r => r.at(0)).find(isNumber)), shortY = shortOf(body.flatMap(r => all.map(s => r.at(s.i))).find(isNumber));
  const drop = note === '' ? 0 : title === '' ? 30 : 18, y0 = (title === '' ? 20 : 52) + drop, foot = hasLegend ? 64 : 34.5;
  const left = 24 + 7.5 * Math.max(...ay.ticks.map(t => shortY(t, ay.places).length)), w = W - 16 - left - 3.75 * shortX(ax.ticks.at(-1), ax.places).length, h = H - y0 - foot;
  const x = v => left + w * (v - ax.ticks.at(0)) / (ax.ticks.at(-1) - ax.ticks.at(0)), y = v => y0 + h - h * (v - ay.ticks.at(0)) / (ay.ticks.at(-1) - ay.ticks.at(0));
  const tips = body.length * series.length <= 400;
  return <svg width='480' height='280' viewBox={'0 0 ' + W + ' ' + H} role='img' aria-label={[title || ends, note].filter(t => t !== '').join('. ')} fontSize='12'>
    {title !== '' && <text x='16' y='27' fontSize='14' fontWeight='500' fill='var(--text-primary)'>{fit(title, W - 32)}</text>}
    {note !== '' && <text x='16' y={title === '' ? 27 : 46} fill={gray}>{fit(note, (W - 32) * 7.5 / 6.5)}</text>}
    {hasLegend && all.map((s, k) => <g key={s.i} opacity={off.includes(s.i) ? 0.4 : 1} onClick={() => setOff(o => o.includes(s.i) ? o.filter(n => n !== s.i) : [...o, s.i])}><rect x={legendAt(k) - 4} y={H - 35} width={28 + 7 * s.tag.length} height='24' fill='transparent'/><rect x={legendAt(k)} y={H - 27.5} width='10' height='10' rx='2' fill={s.hue}/><text x={legendAt(k) + 16} y={H - 18.5} fill={gray}>{s.tag}</text></g>)}
    {ay.ticks.map(t => <g key={t}><line x1={left} x2={left + w} y1={y(t)} y2={y(t)} stroke={t ? 'var(--chart-grid)' : 'var(--chart-axis)'}/><text x={left - 8} y={y(t) + 4} textAnchor='end' fill={gray}>{shortY(t, ay.places)}</text></g>)}
    {ax.ticks.map(t => <g key={t}><line x1={x(t)} x2={x(t)} y1={y0} y2={y0 + h} stroke={t ? 'var(--chart-grid)' : 'var(--chart-axis)'}/><text x={x(t)} y={y0 + h + 16} textAnchor='middle' fill={gray}>{shortX(t, ax.places)}</text></g>)}
    <line x1={left} x2={left + w} y1={y0 + h} y2={y0 + h} stroke='var(--chart-axis)'/>
    {series.map(s => <g key={s.i}>{body.map((r, j) => { if (!isNumber(r.at(s.i))) return null; const dot = <circle cx={x(r.at(0).value)} cy={y(r.at(s.i).value)} r='4' fill={s.hue} fillOpacity='0.85'/>; return tips ? <Tooltip key={j} content={(across === '' ? '' : across + ' ') + r.at(0).text} detail={(s.name === '' ? '' : s.name + ' ') + r.at(s.i).text}>{dot}</Tooltip> : <g key={j}>{dot}</g>; })}</g>)}
  </svg>;
}}</sheet.Visualize>;`;

// Today's programs of the four kinds added to the first ones. Each is made from the first program it is drawn like: its
// reading of the rows, its title, note and legend are that program's own lines, and only what this kind draws its own
// way is written here.

/** `program` with the one line that begins with `marker` put in place of `lines` ('' takes the line away). */
function withLineAs(program: string, marker: string, lines: string): string {
  const found = program.split('\n' + marker).length - 1;
  const at = program.indexOf('\n' + marker), end = program.indexOf('\n', at + 1);
  if (found !== 1 || end < 0) throw new Error(`stock chart: ${found} lines begin with ${marker}`);
  return program.slice(0, at + 1) + lines + program.slice(end + 1);
}

/** `program` without the lines that begin with each of `markers`. */
function withoutLines(program: string, markers: readonly string[]): string {
  return markers.reduce((text, marker) => withLineAs(text, marker, ''), program);
}

/** The lines of `program` from the one that begins with `first` up to, not with, the next that begins with `end`. */
function linesBetween(program: string, first: string, end: string): string {
  const from = program.indexOf('\n' + first);
  const to = from < 0 ? -1 : program.indexOf('\n' + end, from + 1);
  if (to < 0) throw new Error(`stock chart: no lines from ${first} to ${end}`);
  return program.slice(from + 1, to + 1);
}

/** `program` after each of `steps` in turn. */
function edited(program: string, ...steps: readonly ((text: string) => string)[]): string {
  return steps.reduce((text, step) => step(text), program);
}

/** `text` with every `from` made `to`; there must be one at least. */
function withEvery(text: string, from: string, to: string): string {
  if (!text.includes(from)) throw new Error(`stock chart: ${JSON.stringify(from)} is not found`);
  return text.split(from).join(to);
}

const PROGRAM_END = '  </svg>;\n}}</sheet.Visualize>;';

/**
 * The horizontal bar chart: the rows read as the bar chart reads them, each row's bars lying from the labels down the
 * left, the value axis along the foot. One series with no negative value is drawn with its values written at the ends
 * of the bars instead of an axis.
 */
const LYING_BARS_PROGRAM =
  withOnce(upToLineOf(FIRST_PROGRAMS.bar, '  const places = '), "data-component='bars'", "data-component='lying-bars'") +
  linesBetween(FIRST_PROGRAMS.bar, '  const printed = ', '  const roomy = ') +
  `  const direct = least === 0 && [all, series].every(list => list.length === 1);
  const titled = title !== '', y0 = (titled ? 52 : 20) + (note === '' ? 0 : titled ? 18 : 30), foot = hasLegend ? 64 : direct ? 16 : 34.5;
  const band = (H - foot - y0) / Math.max(1, body.length), every = Math.ceil(12 / band);
  const shortened = t => fit(t, 0.35 * W), widest = f => Math.max(0, ...body.map(f));
  const left = 24 + 7.5 * widest((r, j) => shortened(label(r, j)).length);
  const right = direct ? 22 + 7 * widest(r => isNumber(r.at(all.at(0).i)) ? printed(r, all.at(0)).length : 0) : 16 + 3.75 * short(ticks.at(-1), places).length;
  const share = v => direct ? v / most : (v - ticks.at(0)) / (ticks.at(-1) - ticks.at(0)), x = v => left + share(v) * (W - left - right);
  const each = Math.max(1, series.length), gap = band / each < 8 ? 1 : 2, thick = Math.max(1, Math.min(20, (0.75 * band + gap) / each - gap));
  const lying = (atY, v) => { const from = x(0), long = Math.abs(x(v) - from), q = Math.min(4, thick / 4, long), s = v < 0 ? -1 : 1, arc = dx => 'a' + q + ' ' + q + ' 0 0 ' + (v < 0 ? 0 : 1) + ' ' + dx + ' ' + q; return 'M' + from + ' ' + atY + 'h' + s * (long - q) + arc(s * q) + 'v' + (thick - 2 * q) + arc(-s * q) + 'h' + -s * (long - q) + 'z'; };
  const tips = body.length * series.length <= 400;
  const yOf = (j, k) => y0 + j * band + (band + gap) / 2 + (k - series.length / 2) * (thick + gap);
  const drawn = (r, j, s, k) => { const atY = yOf(j, k), v = num(r, s), shape = <path d={lying(atY, v)} fill={s.hue}/>; const written = direct && j % every === 0 && <text fill='var(--text-primary)' x={x(v) + 6} y={atY + thick / 2 + 4}>{printed(r, s)}</text>; return <g key={s.i}>{tips ? <Tooltip content={[label(r, j), s.name].filter(t => t !== '').join(', ')} detail={r.at(s.i).text}>{shape}</Tooltip> : shape}{written}</g>; };
` +
  linesBetween(FIRST_PROGRAMS.bar, '  return <svg', '    {prints ? ') +
  `    {direct && <line stroke='var(--chart-axis)' x1={left} y1={y0} x2={left} y2={H - foot}/>}
    {!direct && ticks.map(t => <g key={t}><line stroke={t === 0 ? 'var(--chart-axis)' : 'var(--chart-grid)'} x1={x(t)} y1={y0} x2={x(t)} y2={H - foot}/><text fill={gray} textAnchor='middle' x={x(t)} y={H - foot + 16}>{short(t, places)}</text></g>)}
    {body.map((r, j) => <g key={j}>{series.map((s, k) => isNumber(r.at(s.i)) ? drawn(r, j, s, k) : null)}</g>)}
    {body.map((r, j) => j % every === 0 && <text key={j} fill={gray} textAnchor='end' x={left - 8} y={y0 + j * band + band / 2 + 4}>{shortened(label(r, j))}</text>)}
` +
  PROGRAM_END;

/**
 * The 100% stacked bar chart: the stacked bar chart with each row's values as shares of its total, so that every bar
 * stands to the full height. A negative value is left out, and a second note says how many were.
 */
const STACKED_BAR_100_PROGRAM = edited(
  FIRST_PROGRAMS.stackedBar,
  (p) => withOnce(p, "data-component='stacked-bars'", "data-component='shares-of-a-whole'"),
  (p) => withOnce(p, "aren’t shown'}]}}}", "aren’t shown'}, {locale: 'en-US', one: '# negative value isn’t shown', other: '# negative values aren’t shown'}]}}}"),
  (p) => withoutLines(p, ['  const note = ', '  const sample = ', '  const isPercent = ', '  const round = ', '  const plain = ', '  const short = ', '  const least = ', '  const span = ', '  const ticks = ', '  const places = ', '  const drop = ']),
  (p) =>
    withLineAs(
      p,
      '  const said = ',
      `  const worded = (words, count) => { const kind = new Intl.PluralRules(words.locale).select(count), phrase = Object.entries(words).find(([key]) => key === kind); return (phrase === undefined ? words.other : phrase.at(1)).split('#').join(count.toLocaleString(words.locale)); };
  const negatives = body.flatMap(r => all.map(s => r.at(s.i))).filter(c => isNumber(c) && c.value < 0).length;
  const notes = [out, negatives].flatMap((count, k) => count > 0 ? [worded(chartWords.at(k), count)] : []);
`,
    ),
  (p) =>
    withLineAs(
      p,
      '  const num = ',
      `  const positive = (r, s) => isNumber(r.at(s.i)) ? Math.max(0, r.at(s.i).value) : 0;
  const num = (r, s) => positive(r, s) / (series.reduce((sum, t) => sum + positive(r, t), 0) || 1);
  const ticks = [0, 0.25, 0.5, 0.75, 1], short = v => Math.round(100 * v) + '%';
  const drop = notes.length === 0 ? 0 : 18 * notes.length + (title === '' ? 12 : 0), y0 = drop + (title === '' ? 20 : 52), foot = hasLegend ? 64 : 34.5;
`,
    ),
  (p) =>
    withLineAs(
      p,
      '    {note !== ',
      `    {notes.map((said, k) => <text key={k} fill={gray} x='16' y={18 * k + (title === '' ? 27 : 46)}>{fit(said, 7.5 * (W - 32) / 6.5)}</text>)}
`,
    ),
  (p) => withOnce(p, ' note].filter(', ' ...notes].filter('),
  (p) => withOnce(p, 'detail={r.at(s.i).text}>', "detail={r.at(s.i).text + ' (' + short(num(r, s)) + ')'}>"),
  (p) => withEvery(p, 'short(t, places)', 'short(t)'),
);

/** The area chart: the line chart with the ground under each line filled down to zero, one over another, not stacked. */
const AREAS_PROGRAM = withLineAs(
  withOnce(FIRST_PROGRAMS.line, "data-component='lines'", "data-component='areas'"),
  '    {series.map(',
  `    {series.map(s => { const spots = body.flatMap((r, j) => isNumber(r.at(s.i)) ? [[at(j), y(num(r, s))]] : []); if (spots.length === 0) return false; const edge = spots.map(([px, py], n) => (n === 0 ? 'M' : 'L') + px + ' ' + py).join(''); return <g key={s.i}><path fill={s.hue} opacity='0.1' d={edge + 'V' + y(0) + 'H' + spots.at(0).at(0) + 'z'}/><path stroke={s.hue} fill='none' strokeLinecap='round' strokeLinejoin='round' strokeWidth='2' d={edge}/>{spots.length === 1 && <circle fill={s.hue} r='4' cx={spots.at(0).at(0)} cy={spots.at(0).at(1)}/>}</g>; })}
`,
);

/**
 * The scatter chart: with two or more columns of numbers, each point lies along the first of them and each other one is
 * a series; with one, the rows are numbered along. A column of labels names the points.
 */
const POINTS_PROGRAM =
  edited(
    upToLineOf(FIRST_PROGRAMS.line, '  const series = '),
    (p) => withOnce(p, "data-component='lines'", "data-component='points'"),
    (p) => withoutLines(p, ['  const sample = ', '  const isPercent = ', '  const short = ']),
    (p) =>
      withLineAs(
        p,
        '  const all = ',
        `  const numbered = []; for (let i = hasLabels ? 1 : 0; i < width; i++) if (probe.some(r => isNumber(r.at(i)))) numbered.push(i);
  const shift = numbered.length > 1 ? 7 : 0, columns = numbered.map((i, k) => { const heading = head ? head.at(i).text : ''; return {i, name: heading, tag: head ? fit(heading, 135) : '', hue: 'var(--chart-categorical-' + ((k + shift) % 8 + 1) + ')'}; });
  const along = columns.length > 1 ? columns.at(0) : null, all = along === null ? columns : columns.slice(1);
`,
      ),
    (p) => withLineAs(p, '  const named = ', "  const named = all.map(s => s.name).filter(n => n !== ''), by = along === null ? over : along.name;\n"),
    (p) =>
      withLineAs(
        p,
        '  const title = ',
        "  const listed = named.length < 2 ? named.join('') : named.slice(0, -1).join(', ') + ' and ' + named.at(-1), title = named.length > 0 && by !== '' ? listed + ' by ' + by : listed;\n",
      ),
    (p) => withOnce(p, 'all.some(', 'columns.some('),
    (p) => withOnce(p, 'all.map(s => r.at(s.i))).filter(c => !', 'columns.map(s => r.at(s.i))).filter(c => !'),
  ) +
  `  const roundStep = span => { const unit = 10 ** Math.floor(Math.log10(span / 4)); for (const m of [1, 2, 2.5, 5, 10]) if (m * unit * 4 >= span) return m * unit; };
  const scaleOf = cells => {
    const values = cells.map(c => c.value), first = cells.length ? cells.at(0).text : '';
    const low = Math.min(...values, Infinity), high = Math.max(...values, -Infinity), isRange = low < high;
    const least = isRange && low > high / 2 ? low : Math.min(0, low);
    let most = Math.max(isRange && high < low / 2 ? high : Math.max(0, high), least);
    if (most === 0 && least >= 0) most = 1;
    const step = roundStep(most - least);
    const from = Math.floor(least / step), count = Math.ceil(most / step) - from + 1;
    return {
      ticks: Array.from({length: count}, (_, n) => (from + n) * step),
      places: Math.min(8, Math.max(0, 1 - Math.floor(Math.log10(step)))),
      sign: ['$', '€', '£', '¥'].find(m => first.startsWith(m) || first.startsWith('-' + m)) || '',
      isPercent: first.endsWith('%'),
      isFine: step * 100 < Math.max(most, -least),
    };
  };
  const tickText = (scale, v) => { const written = (n, places) => scale.isFine ? n.toLocaleString('en-US', {maximumFractionDigits: places}) : plain(n, places); return scale.isPercent ? written(100 * v, Math.max(0, scale.places - 2)) + '%' : (v < 0 ? '-' : '') + scale.sign + written(Math.abs(v), scale.places); };
  const placed = body.flatMap((r, j) => { const far = along === null ? {value: j + 1, text: ''} : r.at(along.i); return isNumber(far) ? [{r, j, far}] : []; });
  const across = scaleOf(placed.map(o => o.far)), up = scaleOf(placed.flatMap(o => series.map(s => o.r.at(s.i))).filter(isNumber));
  const titled = title !== '', y0 = (titled ? 52 : 20) + (note === '' ? 0 : titled ? 18 : 30), foot = hasLegend ? 64 : by !== '' ? 54 : 34.5;
  const widestTick = scale => Math.max(...scale.ticks.map(t => tickText(scale, t).length));
  const left = 24 + 7.5 * widestTick(up), h = H - y0 - foot;
  const w = W - 16 - 3.75 * tickText(across, across.ticks.at(-1)).length - left;
  const [x0, x1] = [across.ticks.at(0), across.ticks.at(-1)], [y1, y2] = [up.ticks.at(0), up.ticks.at(-1)];
  const x = v => left + w * (v - x0) / (x1 - x0), y = v => y0 + h - h * (v - y1) / (y2 - y1);
  const points = series.flatMap(s => placed.flatMap(o => { const cell = o.r.at(s.i), name = label(o.r, o.j); return isNumber(cell) ? [{s, tip: all.length > 1 && s.name !== '' ? name + ', ' + s.name : name, name, said: (along === null ? '' : o.far.text + ', ') + cell.text, x: x(o.far.value), y: y(cell.value)}] : []; }));
  const collides = (box, from, to, at) => Math.abs(box.y - at) < 12 && box.to > from - 4 && box.from < to + 4;
  const tags = [];
  if (hasLabels && all.length === 1 && points.length <= 12) for (const o of points) {
    const words = fit(o.name, 120), long = 7 * words.length;
    const spot = (from, at, anchor, x) => ({from, at, anchor, x}), tries = [spot(o.x + 9, o.y, 'start', o.x + 9), spot(o.x - 9 - long, o.y, 'end', o.x - 9), spot(o.x - long / 2, o.y - 14, 'middle', o.x), spot(o.x - long / 2, o.y + 14, 'middle', o.x)];
    const fits = ({from, at}) => from >= left && from + long <= W - 8 && at >= y0 - 8 && at <= y0 + h - 4 && !tags.some(t => collides(t, from, from + long, at)) && !points.some(p => p !== o && collides({y: p.y, from: p.x - 4, to: p.x + 4}, from, from + long, at));
    const found = tries.find(fits);
    if (found) tags.push({from: found.from, to: found.from + long, y: found.at, anchor: found.anchor, x: found.x, words});
  }
` +
  linesBetween(FIRST_PROGRAMS.line, '  return <svg', '    {ticks.map(') +
  `    {up.ticks.map((t, n) => <g key={t}><line stroke={t === 0 || n === 0 ? 'var(--chart-axis)' : 'var(--chart-grid)'} x1={left} y1={y(t)} x2={W - 16} y2={y(t)}/><text fill={gray} textAnchor='end' x={left - 8} y={y(t) + 4}>{tickText(up, t)}</text></g>)}
    {across.ticks.map(t => <text key={t} fill={gray} textAnchor='middle' x={x(t)} y={y0 + h + 16}>{tickText(across, t)}</text>)}
    {by !== '' && !hasLegend && <text fill={gray} textAnchor='middle' x={left + w / 2} y={H - 18.5}>{fit(by, w)}</text>}
    {points.map((o, n) => { const dot = <circle key={n} fill={o.s.hue} r={points.length > 400 ? '3' : '4'} cx={o.x} cy={o.y}/>; return points.length > 400 ? dot : <Tooltip key={n} content={o.tip} detail={o.said}>{dot}</Tooltip>; })}
    {tags.map((t, n) => <text key={n} fill={gray} textAnchor={t.anchor} x={t.x} y={t.y + 4}>{t.words}</text>)}
` +
  PROGRAM_END;

export const STOCK_CHART_PROGRAMS: Readonly<Record<StockKind, string>> = {
  ...FIRST_PROGRAMS,
  horizontalBar: LYING_BARS_PROGRAM,
  stackedBar100: STACKED_BAR_100_PROGRAM,
  area: AREAS_PROGRAM,
  scatter: POINTS_PROGRAM,
};

/** Earlier programs of a kind, which charts made with them still run: their code is that kind's too. */
export const EARLIER_STOCK_CHART_PROGRAMS: Readonly<Partial<Record<StockKind, readonly string[]>>> = {
  area: [AREA_PROGRAM],
  horizontalBar: [HORIZONTAL_BAR_PROGRAM],
  scatter: [SCATTER_PROGRAM],
};

/** A stock program found by its text: its kind, and whether it is one of that kind's earlier programs. */
export interface StockProgram {
  kind: StockKind;
  isEarlier: boolean;
}

/** The stock program this code is, by its text (spaces at its ends aside), today's or an earlier one; null for any other. */
export function stockProgramOf(code: string): StockProgram | null {
  const trimmed = code.trim();
  const today = STOCK_KINDS.find((kind) => STOCK_CHART_PROGRAMS[kind].trim() === trimmed);
  if (today !== undefined) return { kind: today, isEarlier: false };
  const earlier = STOCK_KINDS.find((kind) => (EARLIER_STOCK_CHART_PROGRAMS[kind] ?? []).some((program) => program.trim() === trimmed));
  return earlier === undefined ? null : { kind: earlier, isEarlier: true };
}

/** The kind of stock chart this code draws, today's program or an earlier one, or null: how a page tells a stock chart. */
export function stockKindOfAnyProgram(code: string): StockKind | null {
  return stockProgramOf(code)?.kind ?? null;
}
