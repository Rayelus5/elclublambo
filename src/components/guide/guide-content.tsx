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
          <li>Escribe el importe y pulsa Continuar. Si tu wallet está en otra red, el foro le pide cambiarla y sigue solo.</li>
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
          Un bounty es un mensaje que pide ayuda y ofrece una recompensa en ETH o USDC, en Base o en Arbitrum. Quien lo
          publica fija el importe, el token, la red y la descripción. Las soluciones se responden en el hilo del bounty.
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
          <li>
            Pagas esa respuesta con el mismo flujo de una propina: importe y una sola firma. Se propone la red del bounty,
            pero puedes pagar con el mismo token en otra red que acepte quien lo resolvió.
          </li>
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

function Donaciones() {
  return (
    <>
      <Sub title="Qué es">
        <p>
          Puedes donar al club en USDC o ETH, en Base o en Arbitrum. El dinero va directo a la Safe del club, una cuenta
          multifirma que gestionan los tesoreros. ElClub. no custodia fondos: la Safe es del club y cada movimiento se puede
          ver en la blockchain.
        </p>
        <p>
          Donar no da derechos económicos: no es una inversión, no hay porcentaje, retorno ni promesa de rentabilidad, y una
          donación no se devuelve.
        </p>
      </Sub>
      <Sub title="Cómo donar">
        <Steps>
          <li>Abre Donar en el menú y elige la red y la moneda. Si ves MODO PRUEBA, el dinero no es real.</li>
          <li>Escribe el importe y pulsa Continuar. Si tu wallet está en otra red, el foro le pide cambiarla.</li>
          <li>Revisa la dirección de la Safe y firma una transferencia normal en tu wallet.</li>
          <li>
            Espera a que el foro verifique la transacción. Las donaciones en ETH se cuentan en USD con el precio de ese
            momento; si el precio no está disponible, la donación queda «Esperando precio» y se acredita más tarde.
          </li>
        </Steps>
        <p>En una red donde la Safe aún no está desplegada no se puede donar, y el foro no ofrece esa red.</p>
      </Sub>
      <Sub title="Qué recibes">
        <Bullets>
          <li>El rol Mecenas, desde 1 USD donado en total. Se suman todas tus donaciones verificadas.</li>
          <li>
            Tu nombre en la lista de donantes, que solo ven los miembros. Puedes ocultarte desde tu perfil cuando quieras.
          </li>
          <li>Acceso a los canales que el rol Mecenas permite y a los que piden haber donado cierta cantidad.</li>
        </Bullets>
      </Sub>
      <Sub title="Transparencia">
        <p>
          En la página Donar ves los saldos de la Safe por red, las donaciones recientes y los gastos. Cada gasto lo anota un
          tesorero con su transacción y una nota que explica para qué fue, y puedes abrirlo en el explorador de bloques para
          comprobarlo.
        </p>
      </Sub>
    </>
  );
}

function Sorteos() {
  return (
    <>
      <Sub title="Qué es">
        <p>
          Un sorteo es gratis: apuntarse no cuesta nada ni exige donar. Todos los apuntados tienen la misma probabilidad,
          sin boletos ni pesos. Cada miembro puede apuntarse una vez hasta la hora de cierre.
        </p>
      </Sub>
      <Sub title="Premios">
        <p>Un sorteo puede tener hasta 10 premios, de tres tipos:</p>
        <Bullets>
          <li>USDC, que paga un tesorero desde la Safe del club y se puede comprobar en la blockchain.</li>
          <li>Un rol del foro, que se asigna al ganador.</li>
          <li>Otra cosa, descrita en texto.</li>
        </Bullets>
        <p>
          Cada persona gana como mucho un premio. Si hay menos apuntados que premios, los que sobran quedan sin adjudicar.
          ElClub. no custodia fondos: los premios en USDC los envía el tesorero, no el foro.
        </p>
      </Sub>
      <Sub title="Cómo se elige al ganador">
        <Steps>
          <li>
            Al crear el sorteo se publica un compromiso: la huella de una semilla secreta que solo conoce el servidor. Así no
            se puede cambiar después.
          </li>
          <li>
            Se fija una ronda de drand posterior al cierre. drand es una red pública que emite un número aleatorio cada 3
            segundos, que nadie conoce de antemano.
          </li>
          <li>
            Cuando esa ronda existe, se revela la semilla y se combina con el número de drand. Ese resultado, con el orden de
            los apuntados, decide quién gana cada premio.
          </li>
        </Steps>
        <p>Si drand no responde, el sorteo espera y se reintenta. No se elige nada sin esa ronda.</p>
      </Sub>
      <Sub title="Cómo comprobarlo">
        <p>
          En la página de cada sorteo terminado, el verificador repite el cálculo en tu navegador: descarga la ronda de drand,
          comprueba su firma, comprueba que la semilla coincide con el compromiso y calcula los ganadores. Si no se puede
          descargar la ronda, te lo dice, pero eso no quiere decir que el sorteo sea inválido.
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
          Algunos canales piden haber donado al club para entrar. Los ves en la barra lateral con un candado. El contenido y
          los mensajes no se ven hasta que cumples el requisito.
        </p>
      </Sub>
      <Sub title="La regla">
        <p>
          Un canal pide un total donado mínimo, en USD. Cuenta la suma de todas tus donaciones verificadas, en cualquier red y
          moneda. Por ejemplo: «10 USD donados». Si el canal cuelga de un foro o una categoría con requisitos, también tienes
          que cumplir los de arriba.
        </p>
        <p>
          Otros canales son solo para el rol Mecenas, que se gana donando 1 USD o más. Ese permiso lo decide el canal, no un
          candado de cantidad.
        </p>
      </Sub>
      <Sub title="Dónde ves tu situación">
        <p>
          Al abrir un canal con candado verás el requisito y lo que llevas donado. Desde ahí puedes ir a Donar para cumplirlo.
        </p>
      </Sub>
      <Sub title="Riesgos">
        <Bullets>
          <li>Las donaciones aún en «Verificando» o «Esperando precio» no cuentan hasta que se acreditan.</li>
          <li>Donar no da derechos económicos: es un regalo al club, no una compra.</li>
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
          El club funciona en Base y en Arbitrum. En el modo de prueba usa Base Sepolia y Arbitrum Sepolia, y todos ven la
          etiqueta «MODO PRUEBA» arriba. Con ella puedes probarlo todo con fondos de faucet, que no valen nada. Lo que pasa
          en prueba no cuenta con dinero real.
        </p>
      </Sub>
      <Sub title="Comprueba siempre la red">
        <Bullets>
          <li>Antes de enviar dinero, mira en el diálogo la red de la moneda que eliges: Base o Arbitrum.</li>
          <li>Si tu wallet está en otra red, el foro le pide cambiarla antes de firmar.</li>
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
          ElClub. no custodia fondos. Si alguien, en un mensaje, un ticket o un mensaje privado, te pide algo distinto de
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
          1 miembro = 1 voto: todos los votos pesan lo mismo, se haya donado o no. El cierre va de 1 hora a 30 días desde que
          se crea. A partir de la hora de cierre ya no se aceptan votos.
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
          votaron, pueden deducir el voto del que falta.
        </p>
      </Sub>
      <Sub title="Resultados">
        <p>
          Los resultados no se ven hasta el cierre. Entonces la tarjeta muestra, para cada opción, el porcentaje de votos que
          ha recibido, con un decimal, y cuántas personas han votado. Los porcentajes redondeados pueden no sumar exactamente
          100 %.
        </p>
        <p>
          Para publicar resultados hacen falta al menos 3 votantes. Si no se llega, la encuesta se cierra sin resultados y no
          se publica ningún porcentaje. Quienes votaron reciben un aviso cuando la encuesta se cierra.
        </p>
      </Sub>
    </>
  );
}

const CONTENT: Record<GuideSlug, () => React.ReactNode> = {
  propinas: Propinas,
  bounties: Bounties,
  donaciones: Donaciones,
  sorteos: Sorteos,
  encuestas: Encuestas,
  candados: Candados,
  redes: Redes,
};

/** Sections whose feature is not shipped yet: the guide says what will exist. Empty: every section describes what is live. */
const COMING_SOON: ReadonlySet<GuideSlug> = new Set<GuideSlug>();

export function isComingSoon(slug: GuideSlug): boolean {
  return COMING_SOON.has(slug);
}

export function GuideContent({ slug }: { slug: GuideSlug }) {
  const Body = CONTENT[slug];
  return <Body />;
}
