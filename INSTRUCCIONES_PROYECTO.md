# Instrucciones del Proyecto — elclublambo

## Regla estricta

**En este proyecto se utiliza TDD estricto gestionado por la skill Superpowers, y todo el diseño visual, espaciado, animaciones GSAP y paletas de colores DEBE ser consultado previamente usando la skill ui-ux-pro-max antes de escribir código frontend. Prohibido usar estilos genéricos de IA.**

## Flujo obligatorio

1. **Brainstorming** (`brainstorming`): antes de cualquier funcionalidad nueva, refinar la idea y acordar un diseño.
2. **Plan** (`writing-plans`): dividir el trabajo en tareas pequeñas con archivos, tests y verificación concretos.
3. **TDD** (`test-driven-development`): RED → GREEN → REFACTOR. No se escribe código de producción sin un test que falle primero.
4. **Ejecución** (`subagent-driven-development` o `executing-plans`): ir tarea por tarea con revisión.
5. **Depuración** (`systematic-debugging`): encontrar la causa raíz antes de proponer cualquier fix.
6. **Verificación** (`verification-before-completion`): ejecutar los tests y mostrar la salida antes de dar algo por terminado.
7. **Revisión** (`requesting-code-review`) y cierre (`finishing-a-development-branch`).

## Frontend: consultar ui-ux-pro-max primero

Antes de escribir CSS, componentes o animaciones:

- Página o proyecto nuevo → `search.py "<producto> <industria> <keywords>" --design-system`
- Decisión concreta → `--domain` (`style`, `color`, `typography`, `ux`, `gsap`, `icons`, `chart`, `product`)
- Detalles de implementación → `--stack <stack>`

Script: `.claude/skills/ui-ux-pro-max/.claude/skills/ui-ux-pro-max/scripts/search.py` (Python 3, sin dependencias externas).

Usar siempre tokens semánticos (sin hex sueltos en componentes), iconos SVG (nunca emojis), contraste ≥ 4.5:1, áreas táctiles ≥ 44px, `prefers-reduced-motion` respetado en GSAP, y mobile-first sin scroll horizontal.

## Prohibido

- Estilos genéricos de IA: degradados morados por defecto, glassmorphism sin motivo, tarjetas con sombras idénticas, Inter + azul como único recurso.
- Escribir código frontend sin una consulta previa a ui-ux-pro-max.
- Escribir código de producción sin un test que falle antes.
- Afirmar que algo está terminado sin pruebas de que funciona.
