import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, render } from '@testing-library/react';
import { routeTitle } from '@galaxy/shared';
import { MemoryRouter, useNavigate } from 'react-router';
import ts from 'typescript';
import { expect, test } from 'vitest';
import { DocumentTitle } from '../src/shell/DocumentTitle';

// The title of each screen (galaxysurvivor.es plan, PR 2): the tab and the installed app's window say where you are.
// Every route of App.tsx needs its own entry in @galaxy/shared's SCREEN_TITLES, which the server shares.

/** Every <Route path> of App.tsx as a full path (nested ones joined to their parents), read with the TS parser. */
function appRoutes(): string[] {
  // Vitest runs from games/galaxy (as the other web tests that read sources).
  const file = join(process.cwd(), 'apps/web/src/App.tsx');
  const source = ts.createSourceFile('App.tsx', readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const paths: string[] = [];
  const pathOf = (attrs: ts.JsxAttributes): string | null => {
    for (const a of attrs.properties) {
      if (ts.isJsxAttribute(a) && a.name.getText(source) === 'path' && a.initializer && ts.isStringLiteral(a.initializer)) return a.initializer.text;
    }
    return null;
  };
  const under = (parent: string, path: string) => (path.startsWith('/') ? path : `${parent.replace(/\/$/, '')}/${path}`);
  const visit = (node: ts.Node, parent: string) => {
    let base = parent;
    const tag = ts.isJsxElement(node) ? node.openingElement : ts.isJsxSelfClosingElement(node) ? node : null;
    if (tag && tag.tagName.getText(source) === 'Route') {
      const path = pathOf(tag.attributes);
      if (path !== null) {
        base = under(parent, path);
        paths.push(base);
      }
    }
    ts.forEachChild(node, (child) => visit(child, base));
  };
  visit(source, '');
  return paths;
}

test('toda ruta de App.tsx tiene su título', () => {
  const routes = appRoutes();
  // A sanity check on the parser: top-level, nested admin and parameter routes are all found.
  expect(routes).toEqual(expect.arrayContaining(['/', '/escaner', '/admin', '/admin/jugadores/:username', '/admin/moderacion/directo/solo/:runId', '/perfil/:username/coleccion']));
  for (const route of routes) {
    // The catch-all only sends unknown addresses home.
    if (route.endsWith('*')) continue;
    expect(routeTitle(route.replace(/:[^/]+/g, 'x')), route).not.toBeNull();
  }
});

function GoTo({ to }: { to: string }) {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate(to)}>
      ir
    </button>
  );
}

test('el título de la pestaña cambia con la pantalla', async () => {
  const { getByRole } = render(
    <MemoryRouter initialEntries={['/escaner']}>
      <DocumentTitle />
      <GoTo to="/perfil/vega" />
    </MemoryRouter>,
  );
  expect(document.title).toBe('Escáner profundo | Galaxy Survivor');
  await act(async () => getByRole('button').click());
  expect(document.title).toBe('Perfil | Galaxy Survivor');
});
