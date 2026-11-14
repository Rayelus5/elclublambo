# Filtro de palabras del chat

Petición del propietario del 14/11: «rellenar el filtro de palabras vacío con palabras malsonantes y ofensivas».

**`chat.json`:** lo que hay en PRE (leído el 14/11, versión 1), con la lista de palabras rellena. Nada más cambia: nivel 2 para escribir, 6 mensajes por minuto, 280 caracteres, 50 en el historial y 3 denuncias para ocultar.

**La lista:** 150 palabras, las mismas que `packages/shared/src/chat/words.ts`, que es el valor por defecto del código.
- **Español:** insultos (gilipollas, imbécil, subnormal, cabrón, capullo, hijoputa…) e insultos de odio por orientación, género u origen (maricón, bollera, travelo, sudaca, panchito, negrata…).
- **Inglés:** insultos (asshole, bitch, cunt, retard, whore…) e insultos de odio (faggot, nigger, kike, spic, chink, tranny…).
- **Las que desean la muerte:** mátate, suicídate, muérete y kys.
- **Cada forma es una entrada:** el filtro ignora mayúsculas y tildes, pero tapa palabras enteras, así que van el masculino, el femenino y los plurales.

**Lo que se deja fuera a propósito:** las exclamaciones suaves (joder, mierda, hostia, coño, fuck, shit). Es como habla mucha gente, y taparlas haría que las conversaciones normales parecieran censuradas. Se pueden añadir desde Admin › Configuración › chat.

**Efecto:**
- Cada palabra de la lista se tapa con asteriscos del mismo largo al enviar el mensaje.
- Los mensajes ya enviados no cambian.

**`antes/chat.json`:** lo que hay ahora, para volver atrás.

Se publica con la skill galaxy-publicar-config, solo con el OK del propietario.
