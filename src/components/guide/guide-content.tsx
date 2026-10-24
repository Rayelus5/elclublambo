import type { GuideSlug } from "@/lib/guide/sections";

function Sub({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-h2">{title}</h2>
      {children}
    </section>
  );
}

function Steps({ children }: { children: React.ReactNode }) {
  return <ol className="flex list-decimal flex-col gap-2 pl-6 marker:font-mono marker:text-fg-muted">{children}</ol>;
}

function Bullets({ children }: { children: React.ReactNode }) {
  return <ul className="flex list-disc flex-col gap-2 pl-6 marker:text-fg-muted">{children}</ul>;
}

function Propinas() {
  return (
    <>
      <Sub title="Qué es">
        <p>
          Una propina es un envío de ETH o USDC de un miembro a otro, para premiar un mensaje o un perfil. El dinero va
          directo de tu wallet a la del destinatario. El club no lo guarda en ningún momento: no hay saldo, ni cuenta, ni
          retiros.
        </p>
      </Sub>
      <Sub title="Cómo se hace">
        <Steps>
          <li>Pulsa el botón de propina en un mensaje, en una publicación Alpha o en un perfil.</li>
          <li>
            Elige con qué pagar: USDC o ETH, en Base o en Arbitrum. Solo aparecen las redes en las que esa persona acepta
            pagos. Si ves MODO PRUEBA, el dinero no es real.
          </li>
          <li>Escribe el importe. Si tu wallet está en otra red, el foro te pide cambiarla.</li>
          <li>Revisa a quién y cuánto envías, y firma en tu wallet.</li>
          <li>Espera a que el foro verifique la transacción. Mientras tanto verás «Verificando…».</li>
        </Steps>
      </Sub>
      <Sub title="Qué cuesta">
        <p>
          El destinatario recibe íntegro el importe. El club no cobra nada: firmas una sola transferencia normal, directa a
          su wallet. Tu wallet cobra el gas de la red, como en cualquier transferencia.
        </p>
      </Sub>
      <Sub title="Propina anónima">
        <p>
          Puedes marcar la propina como anónima. En el foro saldrá como «Anónimo»: en la lista del mensaje y en el aviso del
          hilo. El anonimato es solo dentro del foro. La blockchain es pública y cualquiera puede ver desde qué wallet salió
          el envío.
        </p>
      </Sub>
      <Sub title="Riesgos y límites">
        <Bullets>
          <li>Una transacción confirmada no se puede deshacer. Comprueba destinatario e importe antes de firmar.</li>
          <li>No puedes darte propinas a ti mismo, y la transacción debe salir de la wallet con la que has entrado.</li>
          <li>
            Las propinas en ETH deben enviarse desde una wallet normal (EOA); las smart wallets (Safe, cuentas ERC-4337) no
            se pueden verificar todavía.
          </li>
          <li>
            Solo cuenta lo que haces desde el diálogo del foro. Una transferencia hecha por tu cuenta, fuera del diálogo, no
            se registra.
          </li>
        </Bullets>
      </Sub>
    </>
  );
}

function Bounties() {
  return (
    <>
      <Sub title="Qué es">
        <p>
          Un bounty es un mensaje que pide ayuda y ofrece una recompensa en ETH o USDC. Quien lo publica fija el importe, el
          token y la descripción. Las soluciones se responden en el hilo del bounty.
        </p>
      </Sub>
      <Sub title="Cómo se hace">
        <Steps>
          <li>
            Para publicar uno necesitas el permiso «Crear bounties» (los miembros verificados lo tienen por defecto). Escribe{" "}
            <code className="font-mono text-fg">/bounty</code> en el chat y rellena importe, token y descripción.
          </li>
          <li>Los demás responden en el hilo.</li>
          <li>Cuando una respuesta te sirve, la marcas como solución.</li>
          <li>Pagas esa respuesta con el mismo flujo de una propina: importe y una sola firma.</li>
        </Steps>
        <p>
          Un bounty se paga una sola vez, a una sola respuesta, con el mismo token y al menos el importe anunciado. Mientras
          no haya una solución marcada, puedes cancelarlo; queda visible como cancelado.
        </p>
      </Sub>
      <Sub title="Qué cuesta">
        <p>
          Quien resuelve recibe íntegro el importe anunciado. El club no cobra nada: es una sola transferencia, más el gas
          de la red.
        </p>
      </Sub>
      <Sub title="Plazos">
        <Bullets>
          <li>
            Desde que marcas una solución tienes 7 días para pagarla. Si pasan sin pago, el bounty lleva la marca pública
            «impagado», visible también en tu perfil.
          </li>
          <li>Si pagas después, la marca «impagado» se sustituye por «pagado tarde».</li>
          <li>
            Si no puedes pagar porque moderación retiró el bounty, quien lo resolvió ya no está en el club o el bounty es de
            otra red, no hay marca de impagado mientras dure.
          </li>
          <li>Un bounty sin solución marcada pasa a «expirado» a los 30 días. Sigue visible, pero sin marca de impagado.</li>
        </Bullets>
      </Sub>
      <Sub title="Riesgos">
        <Bullets>
          <li>Marcar una solución es un compromiso de pago. No lo marques si no vas a pagar.</li>
          <li>El pago es una transferencia normal y no se puede deshacer. Revisa quién es el destinatario antes de firmar.</li>
        </Bullets>
      </Sub>
    </>
  );
}

function Dao() {
  return (
    <>
      <Sub title="Qué es">
        <p>
          La DAO es una tesorería común del club, guardada en una Safe, una cuenta multifirma en la que ningún miembro
          mueve fondos por su cuenta. Cada red tiene su propia Safe y su propio registro. Al aportar, recibes shares: una
          participación en la tesorería.
        </p>
      </Sub>
      <Sub title="Cómo se hace">
        <Steps>
          <li>Abre el diálogo de donación y mira la etiqueta de la red activa.</li>
          <li>Elige el importe en USDC. La donación mínima es de 1 USDC. Solo se aporta USDC.</li>
          <li>Firma las transferencias en tu wallet.</li>
          <li>
            Espera a la finalización. Hasta entonces tu aportación aparece como «pendiente de finalización» y todavía no
            tienes shares.
          </li>
        </Steps>
      </Sub>
      <Sub title="Shares y porcentaje">
        <p>
          Tus shares dependen de cuánto aportas respecto al valor que el registro de la DAO ya tenía. Tu porcentaje es tus
          shares entre el total de shares. Las shares se calculan sobre lo que llega a la Safe, sin contar la comisión. En
          el ranking público puedes elegir salir con tu nombre o como «Anónimo»; tu porcentaje cuenta igualmente para abrir
          canales con candado.
        </p>
      </Sub>
      <Sub title="Qué cuesta">
        <p>
          La comisión de la plataforma se suma encima del importe: tú pagas importe más comisión, y a la Safe llega el
          importe completo. Si hay comisión, firmas dos transferencias.
        </p>
      </Sub>
      <Sub title="Riesgos y límites">
        <Bullets>
          <li>
            La finalización en Linea puede tardar horas. Es normal. Así una reorganización de la red nunca crea shares que
            no existen.
          </li>
          <li>
            Una transferencia directa a la Safe, hecha fuera del diálogo, no cuenta nunca: no da shares.
            Dona siempre desde el diálogo.
          </li>
          <li>Las aportaciones se pueden retirar solo donde SuperAdmin haya activado las retiradas, y siempre con la decisión del tesorero. Cómo se pide, en la sección «El fondo común».</li>
        </Bullets>
      </Sub>
    </>
  );
}

function Fondo() {
  return (
    <>
      <Sub title="Cómo se valora el fondo">
        <p>
          El fondo se valora a precio de mercado, en USD: el USDC, el ETH y el WETH que hay en la Safe, al precio del ETH en
          ese momento, menos lo que el registro ya sabe que debe (por ejemplo, donaciones aún pendientes de finalización).
          Ese total es el NAV (el valor neto del fondo). Se actualiza cada hora y lo ves en la página de la DAO.
        </p>
        <p>
          El valor de una participación es el NAV entre el total de participaciones. Cuando donas, recibes participaciones al
          valor del momento en que se acredita tu donación, no del momento en que firmas: por eso la estimación del diálogo
          es orientativa y el número exacto se fija al acreditar.
        </p>
      </Sub>
      <Sub title="Fondo del club">
        <p>
          Si la Safe ya tenía dinero antes de que nadie tuviera participaciones, ese dinero pertenece a una posición aparte
          llamada «Fondo del club». Lo mismo ocurre con cualquier valor que la Safe ya tuviera en la primera valoración y que
          el registro no atribuía a nadie. Cuenta en el total de participaciones, pero no se puede retirar, no vota, no
          entra en sorteos y no abre canales con candado.
        </p>
      </Sub>
      <Sub title="Riesgo">
        <p>Antes de donar tienes que aceptar esto:</p>
        <blockquote className="border-l-2 border-border-strong pl-4 text-fg">
          Entiendo que es una donación sin esperar nada a cambio, que el fondo se invierte con riesgo y que las retiradas
          dependen de la disponibilidad y de la decisión del tesorero.
        </blockquote>
        <p>
          El valor de tu parte sube y baja con el mercado y puede ser menor que lo que aportaste. Las participaciones son un
          registro interno de la comunidad, no un producto financiero.
        </p>
      </Sub>
      <Sub title="Cómo pedir una retirada">
        <p>
          Las retiradas empiezan desactivadas y SuperAdmin las activa por red. Mientras estén desactivadas en tu red, no verás
          el botón «Retirar» en la página de la DAO.
        </p>
        <Steps>
          <li>Pulsa «Retirar», elige un porcentaje de tus participaciones y confirma. Solo puedes tener una solicitud en curso.</li>
          <li>
            Tus participaciones quedan bloqueadas desde que pides: dejan de contar para los canales con candado hasta que se
            resuelva. Puedes cancelar la solicitud mientras esté pendiente.
          </li>
          <li>
            El tesorero la aprueba o la rechaza. Al aprobar se fija el importe al valor de mercado de ese momento: se paga en
            USDC desde la Safe a la wallet con la que entras al club. Mínimo 1 USDC, salvo que retires todo. El pago es una
            sola transferencia de al menos el importe fijado: un pago repartido en varias transferencias no cuenta.
          </li>
          <li>
            Si no llega el pago en 14 días, la aprobación caduca: la solicitud vuelve a pendiente, con las participaciones
            aún bloqueadas, y el tesorero tiene que aprobarla de nuevo a precio actual.
          </li>
          <li>
            Cuando el pago se confirma en la red y Linea lo finaliza, las participaciones se queman y el importe pagado se resta
            de tu aportación neta.
          </li>
        </Steps>
        <p>
          Si sale USDC de la Safe hacia la wallet de una retirada aprobada (o del ganador de un premio sin pagar) y el foro no puede
          reconocerlo como el pago, las donaciones, las aprobaciones y la valoración del fondo se ponen en pausa: ese dinero ya
          no está en la Safe y el fondo se valoraría por debajo de lo que vale. Si fue un pago parcial o repartido, el tesorero
          pide al miembro que lo devuelva, o completa el pago con una sola transferencia de al menos el importe fijado y añade una
          nota a las salidas parciales. Si la salida no tiene nada que ver, basta con añadirle una nota. Si una sola transferencia
          pagó a la vez la retirada y el premio de un mismo miembro, el tesorero usa «Marcar como pagado» en el premio con el
          mismo hash: vale si llegó a su wallet en USDC por al menos la suma de los dos importes. Todo vuelve a la normalidad en
          cuanto la salida queda explicada o registrada.
        </p>
        <p>
          El importe que ves al pedir es solo una estimación en USDC. Las retiradas dependen de la disponibilidad de la Safe y de
          la decisión del tesorero.
        </p>
      </Sub>
      <Sub title="Cómo funcionan los sorteos">
        <p>
          Un tesorero crea un sorteo con un premio en USDC o en WETH, una fecha de cierre y un modo. El premio sale del fondo y baja su valor sin cambiar el
          porcentaje de nadie. Se paga en WETH en lugar de ETH porque un envío de ETH nativo desde la Safe no deja un registro que el foro pueda comprobar.
        </p>
        <p>
          Un premio en WETH se valora al crear el sorteo, cuando puede valer como mucho el 50 % del fondo. Si el ETH sube mucho antes del pago, el
          premio pesa más de lo previsto y las donaciones pueden esperar a la siguiente valoración; el tesorero puede cancelarlo antes del sorteo.
        </p>
        <Bullets>
          <li>En el modo igualitario todos los miembros activos que se apuntan pesan lo mismo.</li>
          <li>
            En el modo ponderado pesan tus participaciones sin bloquear. SuperAdmin lo activa por red; mientras no lo active, solo se crean sorteos
            igualitarios.
          </li>
          <li>Puedes apuntarte y salir hasta la hora de cierre. Un miembro sin participaciones puede apuntarse a uno ponderado, pero pesaría 0 y no podría ganar.</li>
        </Bullets>
        <p>
          Al crear el sorteo se publica un compromiso: el hash de una semilla secreta que guarda la base de datos. Ni los miembros ni los tesoreros
          pueden verla antes del sorteo (técnicamente, solo quien opera la base de datos podría leerla; la comprobación detecta un sorteo hecho con otra
          semilla o con otro bloque). Los pesos se toman
          en la primera ejecución del proceso automático tras la hora de cierre, no a la hora exacta. El ganador sale de la semilla y del hash del primer bloque
          de Linea posterior al cierre, cuando ese bloque está finalizado (puede tardar unas horas). Entonces se revela la semilla y cualquiera puede comprobar
          el resultado en su navegador desde la página del sorteo.
        </p>
        <p>
          En la lista de participantes, quien no sale en el ranking aparece como «Anónimo #» seguido de un número. En un sorteo ponderado la lista muestra
          participaciones desbloqueadas: en un club pequeño puede deducirse quién es un miembro oculto. Además, el premio sale de la Safe, que es
          pública: aunque en el foro el ganador aparezca como «Anónimo», la wallet que recibe el premio se ve en la red, en las transferencias de la Safe.
        </p>
        <p>
          El premio se paga desde la Safe a la wallet con la que entras al club y el foro lo comprueba en la red. Si no se paga, el sorteo se marca como
          impagado a los 14 días; el premio sigue siendo del ganador. Si nadie con peso se apunta, no hay ganador y el premio vuelve al fondo. Un tesorero puede
          cancelar un sorteo antes de que se resuelva, con un motivo público.
        </p>
      </Sub>
    </>
  );
}

function Candados() {
  return (
    <>
      <Sub title="Qué es">
        <p>
          Algunos canales piden una aportación a la DAO para entrar. Los ves en la barra lateral con un candado. El contenido
          y los mensajes no se ven hasta que cumples el requisito.
        </p>
      </Sub>
      <Sub title="Las reglas">
        <p>Un canal puede pedir una de estas reglas, o las dos unidas con «o»:</p>
        <Bullets>
          <li>Un porcentaje mínimo de la DAO.</li>
          <li>Una aportación neta mínima en USDC.</li>
        </Bullets>
        <p>
          Con las dos, basta con cumplir una. Por ejemplo: «1 % de la DAO o 100 USDC aportados». Si el canal cuelga de un
          foro o una categoría con requisitos, también tienes que cumplir los de arriba.
        </p>
      </Sub>
      <Sub title="Dónde ves tu situación">
        <p>
          Al abrir un canal con candado verás el requisito, tu situación actual y un botón para donar. El cálculo usa la
          red activa. Mientras la red activa sea de prueba, el ledger de prueba abre estos canales, así que puedes
          probarlo todo con USDC de faucet.
        </p>
      </Sub>
      <Sub title="Riesgos">
        <Bullets>
          <li>Tu porcentaje baja si entran nuevas aportaciones. Un canal puede cerrarse para ti sin que hayas retirado nada.</li>
          <li>Las aportaciones aún en «pendiente de finalización» no cuentan hasta que se finalizan.</li>
        </Bullets>
      </Sub>
    </>
  );
}

function Redes() {
  return (
    <>
      <Sub title="MODO PRUEBA y dinero real">
        <p>
          El club funciona en dos redes: Linea (dinero real) y Linea Sepolia (de prueba). Cuando la red activa es la de
          prueba, todos ven la etiqueta «MODO PRUEBA · Linea Sepolia» arriba. Con ella puedes probar todo con fondos de
          faucet, que no valen nada. Cada red tiene su propia tesorería, shares y ranking: lo que pasa en prueba no cuenta
          en Linea.
        </p>
      </Sub>
      <Sub title="Comprueba siempre la red">
        <Bullets>
          <li>Antes de enviar dinero, lee la etiqueta de la red en el diálogo.</li>
          <li>Si tu wallet está en otra red, el foro te pedirá cambiarla antes de firmar.</li>
          <li>Si la etiqueta no es la que esperas, cancela.</li>
        </Bullets>
      </Sub>
      <Sub title="Lo que el foro nunca te pedirá">
        <Bullets>
          <li>Tu frase semilla o tu clave privada. Nunca, bajo ningún pretexto.</li>
          <li>
            Firmar nada que no sea una transferencia normal a una dirección que el propio foro te muestra, con el importe a la
            vista.
          </li>
          <li>Aprobaciones de gasto, firmas de mensajes que no entiendas ni transacciones con datos opacos.</li>
        </Bullets>
        <p>
          El club no custodia fondos. Si alguien, en un mensaje, un ticket o un mensaje privado, te pide algo distinto de
          esto, es una estafa. Repórtalo.
        </p>
      </Sub>
      <Sub title="Cómo reconocer el phishing">
        <Bullets>
          <li>
            Los enlaces de dominios que el club no conoce pasan por una página de aviso (<code className="font-mono text-fg">/out</code>)
            antes de abrirse. Léela. Si el dominio no es el que esperas, no continúes.
          </li>
          <li>Desconfía de la prisa, de los premios que no esperabas y de quien dice ser staff y te pide fondos.</li>
          <li>Comprueba el dominio carácter a carácter: algunas estafas usan letras parecidas.</li>
          <li>Entra siempre al foro escribiendo la dirección tú mismo o desde un marcador tuyo.</li>
        </Bullets>
      </Sub>
    </>
  );
}

function Encuestas() {
  return (
    <>
      <Sub title="Qué es">
        <p>
          Una encuesta es un mensaje del chat con una pregunta, de 2 a 10 opciones y una hora de cierre. Para crearla
          necesitas el permiso «Crear encuestas» en el canal, que tienen por defecto los miembros verificados y los
          moderadores. Escribe /encuesta en el cuadro de mensaje y rellena el diálogo.
        </p>
        <p>
          Es una votación consultiva: sirve para conocer la opinión del club y no mueve dinero ni ejecuta nada por sí sola.
          Una encuesta no se puede editar una vez publicada, porque cambiaría lo que otros ya han votado.
        </p>
      </Sub>
      <Sub title="Cómo se vota">
        <Steps>
          <li>Quien puede ver el canal puede votar: no hace falta ningún permiso extra.</li>
          <li>Elige una opción en la tarjeta de la encuesta.</li>
          <li>
            Puedes cambiar tu voto hasta el cierre, pero no retirarlo. Mientras esté abierta solo ves tu propio voto y el
            número total de votantes.
          </li>
        </Steps>
        <p>
          El cierre va de 1 hora a 30 días desde que se crea. A partir de la hora de cierre ya no se aceptan votos.
        </p>
      </Sub>
      <Sub title="Cuánto pesa tu voto">
        <p>Quien crea la encuesta elige entre tres modos:</p>
        <Bullets>
          <li>1 persona, 1 voto: todos los votos pesan lo mismo.</li>
          <li>Lineal según participación: tu voto pesa lo que sumaban tus participaciones sin bloquear al crear la encuesta.</li>
          <li>
            Cuadrática según participación: tu voto pesa la raíz cuadrada de esas participaciones, así que quien más aportó
            pesa más, pero menos que en el modo lineal.
          </li>
        </Bullets>
        <p>
          Los pesos se fijan cuando se crea la encuesta, con las participaciones sin bloquear de ese momento: si después
          donas o pides una retirada, no cambian. Quien no tenía participaciones en ese momento pesa 0 en los modos
          ponderados. El Fondo del club no es un miembro y nunca vota.
        </p>
      </Sub>
      <Sub title="Voto secreto">
        <p>
          Los votos son secretos: nadie, ni miembros, ni moderadores ni tesoreros, puede ver desde el foro qué votó cada
          persona. Hasta el cierre solo tú ves tu voto, y en el cierre las papeletas se sellan a nivel de la aplicación: se
          borra el vínculo entre quien votó y lo que votó, y la aplicación no conserva ningún registro de quién votó qué.
        </p>
        <p>
          Hay un límite que ninguna encuesta puede evitar: si todos menos uno de los votantes comparten entre ellos lo que
          votaron, pueden deducir el voto del que falta. Y en los modos ponderados, con pocos votantes un voto puede dar una
          pista sobre la participación de alguien; por eso piden más votantes para publicar resultados.
        </p>
      </Sub>
      <Sub title="Resultados">
        <p>
          Los resultados no se ven hasta el cierre. Entonces la tarjeta muestra, para cada opción, el % del peso que ha
          recibido, y cuántas personas han votado. En el modo 1 persona, 1 voto el porcentaje lleva un decimal; en los
          ponderados se redondea al entero. Los porcentajes redondeados pueden no sumar exactamente 100 %.
        </p>
        <p>
          Para publicar resultados hacen falta al menos 3 votantes en el modo 1 persona, 1 voto, y al menos 5 votantes con
          participaciones en los modos ponderados. Si no se llega, la encuesta se cierra sin resultados y no se publica ningún
          porcentaje. Quienes votaron reciben un aviso cuando la encuesta se cierra.
        </p>
      </Sub>
    </>
  );
}

const CONTENT: Record<GuideSlug, () => React.ReactNode> = {
  propinas: Propinas,
  bounties: Bounties,
  dao: Dao,
  fondo: Fondo,
  encuestas: Encuestas,
  candados: Candados,
  redes: Redes,
};

/** Sections whose feature is not shipped yet: the guide says what will exist. Empty since F3d shipped the DAO. */
const COMING_SOON: ReadonlySet<GuideSlug> = new Set<GuideSlug>();

export function isComingSoon(slug: GuideSlug): boolean {
  return COMING_SOON.has(slug);
}

export function GuideContent({ slug }: { slug: GuideSlug }) {
  const Body = CONTENT[slug];
  return <Body />;
}
