# Objetos en el suelo que caducan

Petición del propietario del 22/11: subir el límite de objetos sueltos en el mapa durante una incursión y que los que llevan mucho tiempo sin recogerse desaparezcan, para que casi nunca se llene.

**Necesita el código de #273 desplegado (SIM 1.21.0).** El campo `pickups` no existe en el esquema anterior. #273 está desplegado en PRE desde el 22/11.

**`content.json`:** lo que hay en PRE (leído el 22/11, versión 14), con dos cambios:
- `limits.pickups`: de 1500 a **3000** (4500 en grupo, con su ×1,5).
- `pickups`: **`{ lifeSeconds: 90, fadeSeconds: 5 }`**. Los fragmentos de datos (XP) y los kits de reparación que lleven 90 s sin recogerse desaparecen, con un parpadeo suave sus últimos 5 s. Monedas, polvo, componentes, señales e imanes nunca desaparecen. Ya valen 90 y 5 por defecto con el código nuevo; publicarlo deja los números a la vista y ajustables desde Admin › Contenido › Reglas.

Nada más cambia. La calibración está en `docs/DEPLOY_PRE.md`, en «Objetos en el suelo que caducan (SIM 1.21.0)»: el tiempo con el mapa lleno baja del 9–20 % al 0,2–3 % de media según el perfil.

**`antes/content.json`:** lo que hay ahora (v14), para volver atrás. Lee `pickups` con sus valores por defecto, porque el esquema nuevo los rellena al leer.

Se publica con la skill galaxy-publicar-config, solo con el OK del propietario. Afecta a las partidas que empiecen después; las que están en marcha siguen con su versión del contenido.
