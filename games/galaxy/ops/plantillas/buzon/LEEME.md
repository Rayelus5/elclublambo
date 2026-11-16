# Biblioteca del buzón de ejemplo

`mail.json` trae tres packs y dos plantillas para empezar la biblioteca (buzón v2; reglas en `docs/CONTENIDO.md` B10):

| Pack | Dibujo | Qué da |
|---|---|---|
| Bienvenida | Paquete | 1.000 monedas, 200 de polvo y 2 señales |
| Compensación por caída | Caja de suministros | 1.500 monedas, 3 señales y 40 componentes |
| Podio del torneo | Estrella | Una galaxia épica holo, 800 de polvo y el marco Oro |

Las plantillas, «Caída del servidor» (Compensación) y «Ganadores de un torneo» (Recompensa), usan esos packs.

**Lo más cómodo es crearlos en el panel:** Configuración → Buzón → Biblioteca del buzón, y las plantillas con «Guardar como plantilla» en Comunicación. Para publicarlo con la CLI, la skill `galaxy-publicar-config`, partiendo de lo vivo: la clave `mail` va entera, así que se juntan los packs y las plantillas que ya haya.

Ninguno de estos regalos es grande con los límites por defecto (`mailLimits`), así que cualquier admin puede enviarlos.
