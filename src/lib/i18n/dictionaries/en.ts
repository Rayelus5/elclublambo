import type { Dictionary } from "../index";

export const en = {
  common: {
    nav: {
      tools: "Tools",
      giveaways: "Giveaways",
      club: "The club",
    },
    connect: "Connect wallet",
    disconnect: "Disconnect",
    noCustody: "ElClub. never holds your funds.",
  },
  connect: {
    signIn: "Sign in",
    signing: "Signing…",
    switchTo: "Switch to",
    switching: "Switching…",
    hint: "Use your wallet on Base or Arbitrum.",
    errVerify: "We could not verify the signature. Try again.",
    errCancelled: "Signature cancelled.",
    errSwitch: "Could not switch network.",
    goClub: "Go to the club",
    account: "Your account",
    language: "Language",
    mainNav: "Main navigation",
    home: "ElClub., home",
    notAdvice: "This is not financial advice.",
    whatIs: "What is ElClub.",
    builtOn: "Built on Base · also on Arbitrum",
  },
} satisfies Dictionary;
