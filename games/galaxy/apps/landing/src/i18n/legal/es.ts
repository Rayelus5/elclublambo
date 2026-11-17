import type { LegalKey, LegalPage } from '../types';

// The legal pages of galaxysurvivor.es (plan «galaxysurvivor.es», PR 4), in Spanish. They are templates written against
// what the game really processes (accounts without e-mail, game data, chat, reports, the IPs of each account for the
// market's fraud alerts, purchases through Stripe; retention in apps/server/src/retention.ts) and should be reviewed by
// a lawyer. The holder's legal name, NIF and address are never in this public repository: the server fills them from
// galaxy.env (GALAXY_LEGAL_*), and a line whose datum is missing is not shown.
// The purchase terms mirror the shop's «Condiciones de compra» (apps/web/src/copy/es.ts, shop.legal): change both.

const UPDATED = '2026-11-17';
const CONTACT = 'contacto@rayelus.com';
const TRADE = 'GALAXY SURVIVOR';

const identity = {
  identity: { tradeName: `Nombre comercial: ${TRADE}`, holder: 'Titular: ', nif: 'NIF: ', address: 'Domicilio: ', contact: `Correo de contacto: ${CONTACT}` },
} as const;

export const LEGAL_ES: Record<LegalKey, LegalPage> = {
  avisoLegal: {
    title: 'Aviso legal | Galaxy Survivor',
    description: 'Titular, condiciones de uso del sitio, propiedad intelectual y responsabilidad de galaxysurvivor.es, la web del juego Galaxy Survivor',
    h1: 'Aviso legal',
    updated: UPDATED,
    intro: `Este aviso legal regula el uso del sitio galaxysurvivor.es y del juego Galaxy Survivor que se publica en él. Cumple con el artículo 10 de la Ley 34/2002, de servicios de la sociedad de la información y de comercio electrónico (LSSI-CE).`,
    sections: [
      { title: 'Quién está detrás', blocks: [identity, { p: `Para cualquier consulta sobre el sitio o el juego puedes escribir a ${CONTACT}. También puedes usar el buzón del propio juego.` }] },
      {
        title: 'Objeto',
        blocks: [
          { p: 'galaxysurvivor.es presenta y da acceso a Galaxy Survivor, un juego gratuito para el navegador del ordenador, con una tienda de extras opcionales. El acceso a la portada y a estas páginas es libre; para jugar hace falta crear una cuenta.' },
        ],
      },
      {
        title: 'Condiciones de uso del sitio',
        blocks: [
          { p: 'Al navegar por el sitio aceptas usarlo de forma lícita y de buena fe. No está permitido:' },
          { ul: ['Intentar acceder a zonas, cuentas o datos que no son tuyos', 'Alterar, sobrecargar o interrumpir el servicio, ni usar programas automáticos que lo hagan', 'Usar el sitio para difundir contenidos ilícitos, ofensivos o que vulneren derechos de terceros'] },
          { p: 'El uso del juego se rige además por las [Condiciones de uso y de compra](/condiciones).' },
        ],
      },
      {
        title: 'Propiedad intelectual e industrial',
        blocks: [
          { p: `El juego, su código, sus textos, su arte, sus sonidos, su marca y el diseño de este sitio pertenecen a ${TRADE} o a sus licenciantes. No se pueden copiar, distribuir ni transformar sin permiso, salvo para un uso personal y privado o para hablar del juego con capturas y vídeos propios, citando su nombre.` },
          { p: 'Las fuentes Bungee y Fredoka se usan con la licencia SIL Open Font License 1.1.' },
        ],
      },
      {
        title: 'Responsabilidad',
        blocks: [
          { p: 'Trabajamos para que el sitio y el juego funcionen sin interrupciones ni errores, pero no podemos garantizarlo. No respondemos de los daños causados por un uso indebido, por fallos de redes o de terceros, ni por causas de fuerza mayor.' },
          { p: 'Los enlaces a sitios de terceros, como Discord o Stripe, se ofrecen como ayuda. No controlamos su contenido y no somos responsables de él.' },
        ],
      },
      {
        title: 'Ley aplicable y jurisdicción',
        blocks: [
          { p: 'Este aviso se rige por la ley española. Si eres consumidor, cualquier conflicto se resolverá en los juzgados de tu domicilio, como prevé la normativa de consumo. Antes de llegar a eso, escríbenos: casi todo se arregla hablando.' },
        ],
      },
    ],
  },

  privacidad: {
    title: 'Política de privacidad | Galaxy Survivor',
    description: 'Qué datos trata Galaxy Survivor, para qué, durante cuánto tiempo, con quién se comparten y cómo ejercer tus derechos de protección de datos',
    h1: 'Política de privacidad',
    updated: UPDATED,
    intro: 'Esta política explica qué datos personales tratamos cuando usas galaxysurvivor.es y juegas a Galaxy Survivor, y qué derechos tienes. Cumple con el Reglamento General de Protección de Datos (RGPD) y con la Ley Orgánica 3/2018 (LOPDGDD). Tratamos los mínimos datos posibles: tu cuenta no tiene correo electrónico.',
    sections: [
      { title: 'Responsable del tratamiento', blocks: [identity] },
      {
        title: 'Qué datos tratamos',
        blocks: [
          {
            ul: [
              'Datos de la cuenta: tu nombre de usuario y tu contraseña, que guardamos cifrada con un algoritmo de un solo sentido (argon2). Nunca la vemos',
              'Datos de juego: tus partidas, tu progreso, tus galaxias, tus ajustes, tus amigos, tu clan y tus operaciones en el mercado',
              'Comunicaciones: los mensajes que escribes en los chats y los reportes que envías o que recibes',
              'Datos técnicos: las direcciones IP desde las que entras y el navegador que usas, que guardamos para proteger el servicio (límites de peticiones y sesiones) y para detectar fraudes en el mercado y en las invitaciones entre cuentas, y la cookie de sesión',
              'Compras: qué compras, cuándo y su estado. El pago lo procesa Stripe: tus datos de tarjeta solo los recibe Stripe, y el correo que Stripe te pide para el recibo lo ve nuestro servidor de paso al confirmarse el pago, pero no lo guardamos',
              'Si nos escribes al correo de contacto: tu dirección y lo que nos cuentes',
            ],
          },
        ],
      },
      {
        title: 'Para qué y con qué base legal',
        blocks: [
          {
            ul: [
              'Darte el juego y tu cuenta, y gestionar tus compras: la ejecución del contrato que aceptas al registrarte (artículo 6.1.b del RGPD)',
              'Mantener el juego seguro y justo, moderar el chat, evitar trampas y fraudes y proteger el servicio: nuestro interés legítimo y el de los demás jugadores (artículo 6.1.f)',
              'Conservar los datos de las compras durante los plazos que exige la ley: el cumplimiento de obligaciones legales (artículo 6.1.c)',
              'Contestarte cuando nos escribes: tu consentimiento al escribirnos y nuestro interés legítimo en atenderte',
            ],
          },
          { p: 'No usamos tus datos para publicidad, no los vendemos y no tomamos decisiones automatizadas que te afecten jurídicamente.' },
        ],
      },
      {
        title: 'Cuánto tiempo los guardamos',
        blocks: [
          {
            ul: [
              'La cuenta y los datos de juego: mientras tengas la cuenta. Si pides borrarla, se anonimiza, y tu nombre de usuario queda reservado para que nadie se haga pasar por ti',
              'Las direcciones IP y el navegador de cada cuenta: mientras tengas la cuenta',
              'Los mensajes del chat sin reportar: 90 días. Los mensajes reportados se conservan como prueba de la moderación',
              'Las grabaciones de las partidas normales, que sirven para comprobar las puntuaciones: 30 días. Las de partidas destacadas (con un Núcleo derrotado, que llegan lejos o que se revisan por posibles trampas) se conservan para poder comprobar los récords',
              'Los datos de las compras: los plazos que fijan las normas fiscales y mercantiles (en general, hasta 6 años)',
            ],
          },
        ],
      },
      {
        title: 'Con quién los compartimos',
        blocks: [
          { p: 'El juego funciona en servidores propios situados en España. Solo compartimos datos con estos proveedores, que los tratan por encargo nuestro:' },
          {
            ul: [
              'Stripe, para procesar los pagos ([política de privacidad de Stripe](https://stripe.com/es/privacy))',
              'Cloudflare, que conecta el sitio con internet y lo protege de ataques. Por eso ve las peticiones y las direcciones IP ([política de privacidad de Cloudflare](https://www.cloudflare.com/es-es/privacypolicy/))',
            ],
          },
          { p: 'Algunos de ellos pueden tratar datos fuera del Espacio Económico Europeo. Lo hacen con las garantías del RGPD: el Marco de Privacidad de Datos UE-EE. UU. o las cláusulas contractuales tipo de la Comisión Europea. Fuera de estos casos, solo daríamos datos a una autoridad que los pidiera según la ley.' },
        ],
      },
      {
        title: 'Lo que ven otros jugadores',
        blocks: [{ p: 'Tu nombre de usuario, tu perfil, tus galaxias públicas, tus puntuaciones en las clasificaciones y lo que escribes en los chats son visibles para otros jugadores dentro del juego.' }],
      },
      {
        title: 'Edad mínima',
        blocks: [{ p: 'Para crear una cuenta tienes que tener al menos 14 años, la edad a la que la ley española permite consentir el tratamiento de tus datos. Para comprar en la tienda, si eres menor de edad, necesitas el permiso de tu madre, padre o tutor.' }],
      },
      {
        title: 'Tus derechos',
        blocks: [
          { p: `Puedes pedirnos acceder a tus datos, corregirlos, borrarlos, limitar su uso, oponerte a él o recibirlos en un formato portable. Escríbenos a ${CONTACT} desde el correo que quieras, indicando tu nombre de usuario; te podemos pedir que lo confirmes desde el buzón del juego para saber que la cuenta es tuya.` },
          { p: 'Si crees que no hemos respetado tus derechos, puedes reclamar ante la Agencia Española de Protección de Datos ([www.aepd.es](https://www.aepd.es)).' },
        ],
      },
      { title: 'Cambios', blocks: [{ p: 'Si cambiamos esta política de forma importante, te lo diremos dentro del juego. La fecha de arriba indica la última versión.' }] },
    ],
  },

  cookies: {
    title: 'Política de cookies | Galaxy Survivor',
    description: 'Galaxy Survivor solo usa cookies y almacenamiento técnicos, necesarios para entrar y jugar. Sin publicidad ni analítica de terceros',
    h1: 'Política de cookies',
    updated: UPDATED,
    intro: 'Una cookie es un pequeño archivo que un sitio guarda en tu navegador. Galaxy Survivor solo usa cookies y almacenamiento técnicos, imprescindibles para que puedas entrar y jugar. No usamos cookies de publicidad ni de analítica, así que no necesitamos pedirte permiso para ellas (artículo 22.2 de la LSSI-CE).',
    sections: [
      {
        title: 'Qué guardamos en tu navegador',
        blocks: [
          {
            ul: [
              'gs_sid: la cookie de tu sesión. Sabe que has entrado y solo la lee nuestro servidor. Dura hasta que cierras la sesión o caduca',
              'Almacenamiento local del navegador: tus preferencias del juego (sonido, teclas, cursor y pantalla), lo que ya has visto (novedades y avisos) y una partida terminada que aún no se ha enviado. No sale de tu equipo salvo para guardar tus ajustes en tu cuenta',
              'Caché de galaxias: copias de las imágenes de tus galaxias para que carguen más rápido',
            ],
          },
        ],
      },
      {
        title: 'Cookies de terceros',
        blocks: [
          {
            ul: [
              'Stripe, solo en la ventana de pago de la tienda, para prevenir el fraude en los pagos',
              'Cloudflare puede guardar una cookie técnica (como __cf_bm) para distinguir personas de programas automáticos y proteger el sitio',
            ],
          },
        ],
      },
      {
        title: 'Cómo borrarlas',
        blocks: [{ p: 'Puedes borrar las cookies y el almacenamiento de galaxysurvivor.es desde los ajustes de tu navegador. Si lo haces, tendrás que volver a entrar y tus preferencias locales volverán a las de serie.' }],
      },
    ],
  },

  condiciones: {
    title: 'Condiciones de uso y de compra | Galaxy Survivor',
    description: 'Las reglas de Galaxy Survivor: tu cuenta, la convivencia en el juego, los objetos virtuales, la moderación y las condiciones de la tienda',
    h1: 'Condiciones de uso y de compra',
    updated: UPDATED,
    intro: `Estas condiciones son el acuerdo entre tú y ${TRADE} cuando juegas a Galaxy Survivor y cuando compras en su tienda. Al crear tu cuenta las aceptas.`,
    sections: [
      {
        id: 'uso',
        title: 'Condiciones de uso',
        blocks: [
          { p: 'Tu cuenta: tienes que tener al menos 14 años. La cuenta es personal: no la compartas ni la vendas, y guarda bien tu contraseña, porque la cuenta no tiene correo para recuperarla.' },
          { p: 'Convivencia: el juego es de todos. No está permitido:' },
          {
            ul: [
              'Insultar, acosar, amenazar o discriminar a otros jugadores, ni publicar contenido ilícito, sexual o violento',
              'Hacer trampas: programas, modificaciones del cliente, errores aprovechados a propósito o varias cuentas para sacar ventaja',
              'Vender o comprar cuentas, galaxias u objetos del juego a cambio de dinero real fuera de la tienda oficial',
              'Suplantar al equipo del juego o a otros jugadores',
            ],
          },
          { p: 'Objetos virtuales: las galaxias, las monedas, las señales, las skins y el resto de objetos del juego son una licencia de uso dentro del juego. No son dinero, no tienen valor fuera del juego y no se pueden canjear por dinero.' },
          { p: 'Moderación: puedes reportar a otros jugadores y sus mensajes desde el juego. El equipo revisa los reportes y puede ocultar mensajes, silenciar el chat o suspender cuentas que incumplan estas normas, de forma proporcionada. Si no estás de acuerdo con una decisión, escríbenos y la revisaremos. Puedes avisarnos de cualquier contenido ilícito en el juego o en el correo de contacto, que es nuestro punto de contacto según el Reglamento de Servicios Digitales.' },
          { p: 'El juego evoluciona: añadimos, equilibramos y cambiamos contenido con frecuencia. Haremos lo posible por avisar de los cambios importantes. Podemos cerrar el juego en el futuro; si pasa, lo anunciaremos con antelación.' },
        ],
      },
      {
        id: 'compras',
        title: 'Condiciones de compra',
        blocks: [
          { identity: { tradeName: `Vendedor: ${TRADE}`, holder: 'Titular: ', nif: 'NIF: ', address: 'Domicilio: ', contact: `Correo de contacto: ${CONTACT}` } },
          {
            ul: [
              'Los precios se muestran en euros e incluyen el IVA. El pago lo procesa Stripe con tarjeta, Apple Pay o Google Pay',
              'Lo que compras llega a tu cuenta en cuanto se confirma el pago',
              'Derecho de desistimiento: al tratarse de contenido digital que recibes al momento, al confirmar la compra das tu consentimiento expreso para que se entregue enseguida y aceptas que pierdes el derecho de desistimiento de 14 días (artículo 103.m del texto refundido de la Ley General para la Defensa de los Consumidores y Usuarios)',
              'Garantía: si lo que compras no llega o no funciona como se describe, escríbenos desde el buzón del juego o al correo de contacto con la fecha de la compra y lo arreglaremos o te devolveremos el importe',
              'Si eres menor de edad, necesitas el permiso de tu madre, padre o tutor para comprar',
              'Si se devuelve un pago o se reclama al banco, retiramos lo que quede de lo comprado y la tienda de tu cuenta queda bloqueada hasta revisarlo',
              'Cada cuenta tiene un límite de gasto diario, para protegerte',
              'Las condiciones de compra tienen una versión. Si cambian, el juego te pedirá que aceptes la nueva antes de tu siguiente compra',
            ],
          },
        ],
      },
      { title: 'Ley aplicable', blocks: [{ p: 'Estas condiciones se rigen por la ley española. Si eres consumidor, conservas los derechos que te da la ley de tu país de residencia y puedes acudir a los juzgados de tu domicilio.' }] },
    ],
  },
};
