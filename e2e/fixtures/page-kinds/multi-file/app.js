// A module beside the page that imports another one, and reads a JSON file served beside it.
import { kmToMiles, format } from './lib/units.js';

const km = document.getElementById('km');
const show = () => { document.getElementById('miles').textContent = format(kmToMiles(Number(km.value))); };
km.addEventListener('input', show);
show();

try {
  const presets = await (await fetch('data/presets.json')).json();
  document.getElementById('presets').innerHTML = presets.map(p => `<li data-km="${p.km}">${p.name}: ${format(kmToMiles(p.km))} mi</li>`).join('');
  document.getElementById('status').textContent = 'ready';
} catch (error) {
  document.getElementById('status').textContent = `failed: ${error.message}`;
}
