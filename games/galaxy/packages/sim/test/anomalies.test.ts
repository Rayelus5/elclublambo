import { expect, test } from 'vitest';
import { contentSchema, createSim, dealDamage, DEFAULT_CONTENT, scaleAt, spawnEnemy } from '../src/index';
import { options, quietSim, tinyContent } from './fixtures';

// Season anomalies (GDD §13.1; M7d-3): a rule that changes every run of the season, snapshotted at the start. Without
// one nothing changes (the golden runs and the calibration keep their numbers).

const src = { probe: 0, weapon: null, relic: null, element: null } as const;

test('el contenido trae las cuatro anomalías y un id desconocido no arranca', () => {
  expect(contentSchema.parse({}).anomalies.map((a) => a.id)).toEqual(['contagion', 'swarm', 'iron-static', 'rush']);
  expect(() => createSim(options(tinyContent(), { anomaly: 'no-existe' }))).toThrow('unknown_anomaly:no-existe');
});

test('sin anomalía la escala es la de siempre; con Estática férrea los enemigos aguantan un 25 % más', () => {
  const plain = quietSim();
  const iron = quietSim(undefined, { anomaly: 'iron-static' });
  expect(plain.anomaly).toBeNull();
  expect(scaleAt(iron).hp).toBeCloseTo(scaleAt(plain).hp * 1.25, 10);
  expect(scaleAt(iron).damage).toBe(scaleAt(plain).damage);
  const rush = quietSim(undefined, { anomaly: 'rush' });
  expect(scaleAt(rush).speed).toBeCloseTo(scaleAt(plain).speed * 1.2, 10);
});

test('con Corrosión contagiosa, un enemigo corroído que cae corroe a los que tiene cerca, y uno sano no contagia', () => {
  const sim = quietSim(undefined, { anomaly: 'contagion' });
  const dummy = sim.content.enemies.find((e) => e.id === 'dummy')!;
  const sick = spawnEnemy(sim, dummy, 200, 0);
  const near = spawnEnemy(sim, dummy, 240, 0);
  const far = spawnEnemy(sim, dummy, 400, 0);
  sim.grid.clear();
  // Rebuild the grid the way a tick does before the hit.
  for (let e = 0; e < sim.enemies.top; e++) if (sim.enemies.alive[e]) sim.grid.insert(e, sim.enemies.x[e]!, sim.enemies.y[e]!);
  sim.enemies.corrT[sick] = 60;
  dealDamage(sim, sick, 1e6, src);
  expect(sim.enemies.alive[sick]).toBe(0);
  expect(sim.enemies.corrT[near]).toBe(180);
  expect(sim.enemies.corrT[far]).toBe(0);
  // A healthy one passes nothing on.
  const healthy = spawnEnemy(sim, dummy, 240, 10);
  sim.enemies.corrT[near] = 0;
  dealDamage(sim, healthy, 1e6, src);
  expect(sim.enemies.corrT[near]).toBe(0);
});

test('las anomalías por defecto no tocan DEFAULT_CONTENT fuera de su lista', () => {
  expect(DEFAULT_CONTENT.anomalies.find((a) => a.id === 'contagion')!.contagion).toEqual({ radius: 70, seconds: 3 });
});
