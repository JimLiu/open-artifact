import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseTemplate } from '@open-artifact/dc';
import { componentName, instanceWordsMessage, instanceWordsSource } from '../src/lib/text-edit.ts';

const instance = (html: string) => parseTemplate(html).elements.find((element) => element.tag === 'x-import')!;

describe('words of a component instance', () => {
  it('finds the prop written on the instance', () => {
    const element = instance('<x-import component-from-global-scope="Acme.Badge" label="Hello there" style="color: red"></x-import>');
    assert.deepEqual(instanceWordsSource(element, 'Hello there'), { kind: 'prop', component: 'Badge', prop: 'label' });
    assert.deepEqual(instanceWordsSource(instance('<x-import component-from-global-scope="Acme.Button">Save it</x-import>'), 'Save it'), { kind: 'prop', component: 'Button', prop: 'children' });
    assert.deepEqual(instanceWordsSource(instance('<x-import component-from-global-scope="Acme.Count" n="{{ 3 }}"></x-import>'), '3'), { kind: 'prop', component: 'Count', prop: 'n' });
  });

  it('else the component itself, unless code passes the words', () => {
    const element = instance('<x-import component-from-global-scope="Acme.Badge" label="Hello"></x-import>');
    assert.deepEqual(instanceWordsSource(element, 'Built in'), { kind: 'template', component: 'Badge' });
    assert.equal(instanceWordsSource(instance('<x-import component-from-global-scope="Acme.Badge" label="{{ title }}"></x-import>'), 'Built in'), null);
    assert.equal(instanceWordsSource(element, null), null);
    // A short prop is not taken for the words it happens to be in.
    assert.deepEqual(instanceWordsSource(instance('<x-import component-from-global-scope="Acme.Card" size="s" variant="primary"></x-import>'), 'Details'), { kind: 'template', component: 'Card' });
    assert.deepEqual(instanceWordsSource(instance('<x-import component-from-global-scope="Acme.Card" variant="primary"></x-import>'), 'Primary action'), { kind: 'template', component: 'Card' });
    assert.deepEqual(instanceWordsSource(instance('<x-import component-from-global-scope="Acme.Note">Read <b>this</b> now</x-import>'), 'Read'), { kind: 'prop', component: 'Note', prop: 'children' });
  });

  it('names the component and says where to change the words', () => {
    assert.equal(componentName('Acme.Dialog.Root'), 'Dialog.Root');
    assert.equal(componentName('Badge'), 'Badge');
    assert.equal(instanceWordsMessage({ kind: 'prop', component: 'Badge', prop: 'label' }), 'This text is set per instance — edit it under Badge props.');
    assert.match(instanceWordsMessage({ kind: 'template', component: 'Badge' }), /^This text sits directly in the Badge component and can’t be edited on the canvas/);
  });
});
