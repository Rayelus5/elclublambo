import { expect, test } from 'vitest';
import { fillLegal, fillMoved, missingLegal } from '../../src/landing';

// The holder's legal name, NIF and address (plan «galaxysurvivor.es», PR 4): never in the public repository; the server
// fills each line of the legal pages from galaxy.env, escaped, and drops the line of a datum it does not have.

const PAGE =
  '<ul class="identity"><li>Nombre comercial: GALAXY SURVIVOR</li><li data-legal-line="holder">Titular: <!--legal:holder--></li><li data-legal-line="nif">NIF: <!--legal:nif--></li><li data-legal-line="address">Domicilio: <!--legal:address--></li><li>Correo de contacto: contacto@rayelus.com</li></ul>';

test('rellena cada línea con su dato', () => {
  const html = fillLegal(PAGE, { holder: 'Ana Pérez', nif: '12345678Z', address: 'Calle Mayor 1, Madrid' });
  expect(html).toContain('<li data-legal-line="holder">Titular: Ana Pérez</li>');
  expect(html).toContain('<li data-legal-line="nif">NIF: 12345678Z</li>');
  expect(html).toContain('<li data-legal-line="address">Domicilio: Calle Mayor 1, Madrid</li>');
  expect(html).not.toContain('<!--legal:');
});

test('escapa el dato: nada de lo que venga de la configuración se convierte en HTML', () => {
  const html = fillLegal(PAGE, { holder: 'A&B <script>alert(1)</script> "x" \'y\'' });
  expect(html).toContain('Titular: A&amp;B &lt;script&gt;alert(1)&lt;/script&gt; &quot;x&quot; &#39;y&#39;</li>');
  expect(html).not.toContain('<script>');
});

test('sin un dato, su línea no sale; las demás siguen', () => {
  const html = fillLegal(PAGE, { nif: '12345678Z' });
  expect(html).not.toContain('Titular:');
  expect(html).not.toContain('Domicilio:');
  expect(html).toContain('NIF: 12345678Z');
  expect(html).toContain('Nombre comercial: GALAXY SURVIVOR');
  expect(html).not.toContain('<!--legal:');
});

test('rellena todas las apariciones (el aviso legal, la privacidad y las compras repiten el bloque)', () => {
  const html = fillLegal(PAGE + PAGE, { holder: 'Ana', nif: 'X', address: 'Y' });
  expect(html.match(/Titular: Ana/g)).toHaveLength(2);
});

test('dice qué datos faltan, para avisar al arrancar', () => {
  expect(missingLegal({})).toEqual(['holder', 'nif', 'address']);
  expect(missingLegal({ holder: 'Ana', nif: 'X', address: 'Y' })).toEqual([]);
  expect(missingLegal({ nif: 'X' })).toEqual(['holder', 'address']);
});

// The notice on the old address (the move, 2026-11-17): its button and canonical carry the new address, escaped.
test('el aviso de la mudanza lleva la dirección nueva escapada en cada {{href}}', () => {
  const html = fillMoved('<link rel="canonical" href="{{href}}"><a href="{{href}}">Ir</a>', 'https://galaxysurvivor.es/galaxy/entrar?a=1&b="2"');
  expect(html).toBe('<link rel="canonical" href="https://galaxysurvivor.es/galaxy/entrar?a=1&amp;b=&quot;2&quot;"><a href="https://galaxysurvivor.es/galaxy/entrar?a=1&amp;b=&quot;2&quot;">Ir</a>');
  // A $ in the address is text, not a replacement pattern.
  expect(fillMoved('{{href}}', 'https://galaxysurvivor.es/galaxy/?x=$&')).toBe('https://galaxysurvivor.es/galaxy/?x=$&amp;');
});
