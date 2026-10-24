// Fuente de verdad de los textos públicos. `en.ts` debe tener las mismas claves.
// Cada tarea de UI añade su sección (landing, tools, giveaways, start, connect).
export const es = {
  common: {
    nav: {
      tools: "Herramientas",
      giveaways: "Sorteos",
      club: "El club",
    },
    connect: "Conectar wallet",
    disconnect: "Desconectar",
    noCustody: "ElClub. no custodia fondos.",
  },
  connect: {
    signIn: "Firmar y entrar",
    signing: "Firmando…",
    switchTo: "Cambiar a",
    switching: "Cambiando…",
    hint: "Usa tu wallet en Base o Arbitrum.",
    errVerify: "No se pudo verificar la firma. Inténtalo de nuevo.",
    errCancelled: "Firma cancelada.",
    errSwitch: "No se pudo cambiar de red.",
    goClub: "Ir al club",
    account: "Tu cuenta",
    language: "Idioma",
    mainNav: "Navegación principal",
    home: "ElClub., inicio",
    notAdvice: "No es asesoramiento financiero.",
    whatIs: "Qué es ElClub.",
    builtOn: "Construido en Base · también en Arbitrum",
  },
} as const;
