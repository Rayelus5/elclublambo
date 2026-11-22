import type { DescriptorPart } from './types';

// Descriptors of the run content (the content editor, 2026-11-16, P4). See types.ts for the rules of the texts.
// This part: the view the spawns are placed around and the engine's limits (sim content/types.ts, systems/enemies.ts,
// director.ts, world/pools.ts). Everything here is behind «Más ajustes»: a wrong value slows the game or breaks it.

const VIEW = 'Vista';
const LIMITS = 'Límites';

export const part: DescriptorPart = {
  fields: {
    arena: {
      label: 'Vista y aparición de enemigos',
      hint: 'El tamaño de la vista más grande que puede tener un jugador, que decide dónde aparecen los enemigos para que nunca surjan en pantalla',
      section: VIEW,
      advanced: true,
    },
    'arena.viewW': {
      label: 'Ancho de la vista',
      hint: 'Ancho de la vista más grande posible; los enemigos aparecen justo fuera de ella y los objetos rompibles se cargan a su alrededor',
      section: VIEW,
      advanced: true,
    },
    'arena.viewH': {
      label: 'Alto de la vista',
      hint: 'Alto de la vista más grande posible; los enemigos aparecen justo fuera de ella y algunas reliquias buscan objetivos dentro',
      section: VIEW,
      advanced: true,
    },
    'arena.margin': {
      label: 'Margen de aparición',
      hint: 'Lo lejos del borde de la vista que aparecen los enemigos y las oleadas; más margen tarda más en llegar a la sonda',
      section: VIEW,
      advanced: true,
    },
    'arena.despawn': {
      label: 'Distancia para recolocar enemigos',
      hint: 'Un enemigo que se aleja más que esto de las sondas vuelve al borde de la vista, para que no se quede atrás',
      section: VIEW,
      advanced: true,
    },
    limits: {
      label: 'Límites del motor',
      hint: 'Cuántas cosas puede haber a la vez en una incursión; subirlos puede hacer que el juego vaya lento en equipos modestos',
      section: LIMITS,
      advanced: true,
    },
    'limits.weapons': {
      label: 'Armas por sonda',
      hint: 'Cuántas armas puede llevar una sonda a la vez; al llegar al máximo ya no se le ofrecen armas nuevas',
      section: LIMITS,
      advanced: true,
    },
    'limits.passives': {
      label: 'Mejoras pasivas por sonda',
      hint: 'Cuántas mejoras pasivas puede llevar una sonda a la vez; al llegar al máximo ya no se le ofrecen pasivas nuevas',
      section: LIMITS,
      advanced: true,
    },
    'limits.enemies': {
      label: 'Enemigos a la vez',
      hint: 'Máximo de enemigos vivos a la vez; ningún sector ni oleada pasa de este tope, y los que no caben no aparecen',
      section: LIMITS,
      advanced: true,
    },
    'limits.shots': {
      label: 'Disparos de las sondas a la vez',
      hint: 'Máximo de proyectiles de las sondas en el mapa; si se llena, los nuevos no salen hasta que haya sitio, y en grupo el tope es mayor',
      section: LIMITS,
      advanced: true,
    },
    'limits.foeShots': {
      label: 'Disparos enemigos a la vez',
      hint: 'Máximo de balas enemigas en el mapa; si se llena, las nuevas no salen hasta que haya sitio',
      section: LIMITS,
      advanced: true,
    },
    'limits.pickups': {
      label: 'Objetos en el suelo a la vez',
      hint: 'Máximo de experiencia, monedas, polvo y demás tirados en el suelo; si se llena, lo valioso aparta el fragmento de datos más antiguo y la experiencia se suma a uno igual, y en grupo el tope es mayor',
      section: LIMITS,
      advanced: true,
    },
    'limits.areas': {
      label: 'Zonas de daño a la vez',
      hint: 'Máximo de zonas de daño de las armas en el suelo; si se llena, las nuevas no salen hasta que haya sitio, y en grupo el tope es mayor',
      section: LIMITS,
      advanced: true,
    },
    'limits.props': {
      label: 'Objetos rompibles cargados',
      hint: 'Máximo de objetos rompibles alrededor de las sondas a la vez; si se llena, algunos no aparecen',
      section: LIMITS,
      advanced: true,
    },
  },
};
