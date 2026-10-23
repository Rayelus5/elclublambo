# Legal constraints (Spain/EU, as of 24 Oct 2026) for ElClub.'s public web3 tools on Base, launched by an individual developer resident in Spain

These are research notes, not legal advice. Research date: 2026-10-24. Many points rest on secondary sources (law-firm and commentary blogs) because the EUR-Lex HTML for MiCA could not be retrieved by the fetch tool. Every point marked "verify" or "lawyer" should be checked with a Spanish fintech/crypto lawyer before launch.

## 1. MiCA (Reg. 2023/1114): is a non-custodial interface or escrow a CASP service? What about a platform fee? Has Spain's transitional period ended?

### Takeaway
The Spanish MiCA transitional (grandfathering) period ended on 30 June 2026. Since 1 July 2026 only MiCA-authorised entities may provide crypto-asset services in Spain. MiCA turns on control. Custody means safekeeping, or controlling, crypto-assets or their access means on behalf of clients. Transfer services means transferring crypto-assets "on behalf of" a person. Software whose keys and funds stay with the user, and an immutable escrow contract with no admin key, look outside both definitions. The ESMA/EBA position is that a party which keeps control or influence over the software, front-end, admin keys or fees can be treated as a CASP. Recital 22's "fully decentralised" carve-out is read very narrowly. A platform fee taken by an identifiable developer weakens any decentralisation argument, but on its own it does not make a non-custodial tool a custody or transfer service.

### Cited Findings
- **Spanish transition, dated 23 Jul 2026.** The MiCAR grandfathering period expired on 30 June 2026. "From 1 July, only MiCAR-authorised entities can provide crypto-asset services in Spain." Unauthorised providers may not serve Spanish clients or take on new ones while their application is pending. The CNMV required migration plans for clients. — [Osborne Clarke, 23 Jul 2026](https://www.osborneclarke.com/insights/spain-closes-micar-transitional-period-crypto-asset-service-providers)
- **Earlier deadlines.** Spain had first announced 31 Dec 2025 as the end of the transition, then took the maximum window, to 1 July 2026. Grandfathering covered firms registered with the Banco de España before 30 Dec 2024. — [Cryptonomist, 17 Dec 2025](https://en.cryptonomist.ch/2025/12/17/mica-regulation-spain-transition/); [DiarioBitcoin](https://www.diariobitcoin.com/criptomonedas/espana-publica-criterios-para-la-transicion-de-exchanges-cripto-a-mica-antes-de-julio-2026/)
- **EMT payment services.** In March 2026 the Banco de España reiterated that payment services using e-money tokens (EMTs) need PSD2 authorisation as well as MiCA authorisation. USDC is an EMT. The first Spanish CASP announced a Banco de España authorisation for EMT payment services on 29 June 2026. — [Osborne Clarke, 23 Jul 2026](https://www.osborneclarke.com/insights/spain-closes-micar-transitional-period-crypto-asset-service-providers)
- **EBA No Action Letter.** The June 2025 letter asked national authorities to require PSD2 authorisation from CASPs that carry out EMT transactions after a transition ending 2 March 2026. The EBA Opinion of 12 Feb 2026 sets out how authorities should proceed after that date. — [EBA press release](https://www.eba.europa.eu/publications-and-media/press-releases/eba-publishes-no-action-letter-interplay-between-payment-services-directive-psd23-and-markets-crypto); [Bird & Bird 2026](https://cm.twobirds.com/en/insights/2026/eba-clarifies-supervisory-expectations-as-no-action-letter-transition-period-ends); [EBA Opinion EBA/OP/2026/01 (PDF copy)](https://www.dirittobancario.it/wp-content/uploads/2026/02/Parere-EBA-12-febbraio-2026-EBA_OP_2026_01.pdf)
- **Custody definition, Art. 3(1)(17), secondary source.** Custody means "the safekeeping of crypto-assets or the means of access thereto, where applicable in the form of private cryptographic keys, or the exercise of control over such crypto-assets on behalf of clients." — [CMS Spain](https://cms.law/en/esp/legal-updates/safeguarding-the-digital-vault-custody-and-administration-of-crypto-assets-under-the-new-mica-regulation); [Dudkowiak](https://www.dudkowiak.com/fintech-in-poland/crypto-services-under-mica/)
- **Custody is about control, not only key possession.** — [Ganado, "Custody under MiCA: who's really in control?"](https://ganado.com/custody-under-mica-whos-really-in-control/)
- **Transfer services, Art. 3(1)(26).** Transfer services means transferring crypto-assets from one DLT address or account to another "on behalf of a natural or legal person". ESMA Q&A 2071: transfer is a self-standing service (Art. 3(1)(16)(j)), subject to Art. 59 authorisation and Art. 82 even when it forms part of another service. ESMA's Art. 82 guidelines apply to CASPs acting on behalf of clients. — [ESMA Q&A 2417 / transfer Q&A](https://www.esma.europa.eu/publications-data/questions-answers/2417); [ESMA Guidelines on transfer services, ESMA35-1872330276-2032](https://www.esma.europa.eu/sites/default/files/2025-02/ESMA35-1872330276-2032_Guidelines_on_transfer_services_for_crypto-assets_under_MiCA.pdf)
- **Issuers are not transfer or custody providers.** ESMA Q&A 2417, answer dated around 18 Jun 2026: an issuer that sends newly issued tokens to buyers' wallets is not providing transfer or custody services on behalf of others. This shows ESMA reads "on behalf of clients" literally. — [ESMA Q&A 2417 PDF](https://www.dirittobancario.it/wp-content/uploads/2026/07/ESMAQA2417.pdf)
- **Recital 22.** Crypto-asset services "provided in a fully decentralised manner without any intermediary" should not fall within MiCA's scope. — [AMF France MiCA explainer](https://www.amf-france.org/en/news-publications/depth/mica)
- **ESMA/EBA Joint Report, 13 Jan 2025 (Art. 142; ESMA75-453128700-1391 / EBA/Rep/2025/01), as summarised.**
  - Very few DeFi systems reach full decentralisation.
  - Decentralisation is assessed case by case, on a spectrum.
  - Even protocols that look decentralised usually have identifiable entities controlling governance, upgrades, deployment and fee structures.
  - Creating or selling software is not automatically CASP activity. Entities that keep "control or sufficient influence" over the software, platform or user relationships may be treated as CASPs.
  - Source: [LegalBison, 10 Jul 2026](https://legalbison.com/blog/study-we-are-defi-so-mica-does-not-apply-to-us-eba-and-esma-disagree/)
- **Commentary, not regulator text.** Admin keys, pause/upgrade powers and front-end control are cited as bringing an operator into scope. An identifiable intermediary extracting fees "probably needs a CASP license". The Commission's custody Q&A reportedly draws the line at key control. — [LegalBison](https://legalbison.com/blog/study-we-are-defi-so-mica-does-not-apply-to-us-eba-and-esma-disagree/); [Ryder blog](https://ryder.id/blogs/post/mica-crypto-regulation-what-europes-rules-mean-for-self-custody)
- **Reverse solicitation is read restrictively.** It does not cover promoting services to EU customers. — [Osborne Clarke](https://www.osborneclarke.com/insights/spain-closes-micar-transitional-period-crypto-asset-service-providers)

### Inferences
These are my analysis, to be confirmed with a lawyer.
- **Tool 1 (giveaways)** and **Tool 2 (bounty escrow):**
  - Low-risk design: the organizer or poster deposits USDC into an immutable contract with no owner, admin, pause or upgrade key. Release is determined only by contract logic, using drand plus commit-reveal or the poster's own signature. The developer never signs payouts.
  - On that design the developer arguably neither safeguards nor controls assets "on behalf of clients" and does not transfer "on behalf of" anyone.
  - Higher-risk design: the developer, or a backend hot key, triggers the payout, can cancel or refund, or arbitrates disputes on a bounty. That looks like control, so custody or transfer service. It would need CASP authorisation, plus PSD2 for EMT payment services per the Banco de España.
  - The bounty board is the riskier of the two because it is likely to need dispute resolution. Any developer-run arbitration with power over funds breaks the non-custodial argument.
- **Tool 3 (payment/tip links):**
  - Direct wallet-to-wallet links or Base Pay links where the payer signs a transfer straight to the payee are interface software, not transfers "on behalf of" clients.
  - A "small platform fee" collected by routing funds through a developer-controlled address or contract that then forwards them looks like a transfer service and possibly an EMT payment service (PSD2). Avoid it.
  - If a fee is wanted, a safer pattern is a separate, user-signed fee transfer, or an atomic split in an immutable contract. Even then the identifiable fee-taker undermines the Recital 22 argument, so ask a lawyer.
- **Tool 4 (x402 API) and EAS:** Selling the developer's own API or data for USDC through x402 is the developer acting as a merchant accepting crypto as payment, not a crypto-asset service for clients. Low MiCA risk.
- **Art. 59 (my recollection of the text, not fetched; verify):** It limits CASP authorisation to legal persons or other undertakings. An individual could therefore not even apply. Any tool that turns out to be a CASP service is out of reach for a sole trader.

### Gaps
- I could not retrieve the official EUR-Lex text of Recitals 22 and 83 or Arts 3(1)(16), (17), (26), 59 and 66. Recital 83 is believed to exclude hardware and software providers of non-custodial wallets, but this is unverified. Verify on EUR-Lex.
- I found no specific ESMA Q&A on smart-contract escrow front-ends, and no CNMV statement on non-custodial interfaces or developer fees.
- I found no CNMV list of authorised CASPs as of Oct 2026.

## 2. Spanish gambling law (Ley 13/2011): free promotional draws, platform as "organizer", crypto prizes, follow/retweet entry

### Takeaway
"Combinaciones aleatorias con fines publicitarios o promocionales" are excluded from Ley 13/2011's licensing regime by art. 2.2.c. They remain subject to the Impuesto sobre Actividades de Juego (art. 48): 10% of the market value of the prizes, for draws of state-wide scope. Regional rules can add filings. The exclusion requires a purely advertising or promotional purpose and free participation. A free giveaway with a USDC prize seems feasible for the organizer. Open questions:
- whether a tool that hosts third-party giveaways counts as the "organizer";
- how "promotional purpose" applies to community giveaways with no product being promoted;
- how a crypto prize is valued and how withholding on it works.

### Cited Findings
- **Art. 2.2.c** excludes from the Law "Las combinaciones aleatorias con fines publicitarios o promocionales", without prejudice to Title VII (tax). — [Ley 13/2011, consolidated text (Hacienda)](https://www.hacienda.gob.es/DocLeyes/onlinelt/27070.htm)
- **Art. 3 definition.** Draws "que, con finalidad exclusivamente publicitaria o de promoción de un producto o servicio" offer prizes, where the only consideration is consuming the product, with no surcharge or extra charge. — [Ley 13/2011 (Hacienda)](https://www.hacienda.gob.es/DocLeyes/onlinelt/27070.htm); [DPEJ RAE](https://dpej.rae.es/lema/combinaciones-aleatorias-con-fines-publicitarios)
- **Art. 48.** Promotional combinations of state-wide scope are a taxable event.
  - Base: "el importe total del valor de mercado de los premios ofrecidos".
  - Rate (art. 48.7): "Combinaciones aleatorias con fines publicitarios o promocionales: 10 por ciento".
  - Taxpayers are the natural or legal persons who carry out the activity. Those offering to Spanish residents are jointly liable (art. 48.5).
  - Source: [Ley 13/2011 (Hacienda)](https://www.hacienda.gob.es/DocLeyes/onlinelt/27070.htm)
- **DGT V1472-24 (June 2024).** A retailer's free promotional draw (€100 vouchers) is a taxable event under art. 48 as a promotional random combination. The tax applies if the draw is authorised, held or organised in Spain. — summary via [primeralecturaediciones](https://primeralecturaediciones.com/?p=20242017) (secondary)
- **No licence or prior communication at state level** for state-wide promotional draws; they are only subject to the gaming tax. Some autonomous communities regulate separately: Castilla-La Mancha requires a prior declaración responsable, and Castilla y León has a 2025 draft decree on rifas, tómbolas and combinaciones aleatorias. — [example bases (neobookings PDF)](https://images.neobookings.com/cms/migjornibiza.com/section/consulte-las-bases-del-sorteo/docs/consulte-las-bases-del-sorteo-9gwmy5kw6p.pdf); [JCyL draft PRE-16-2025](https://transparencia.jcyl.es/huellanormativa/PRE/Decreto%20Rifas%20y%20T%C3%B3mbolas/PRE-16-2025.pdf); [INAP on sanctions regime](https://laadministracionaldia.inap.es/noticia.asp?id=1119730)

### Inferences
- **Free entry is essential.** A paid entry ticket in USDC, or any entry fee, would turn the draw into gambling requiring a DGOJ licence. That is impossible for an individual.
- **"Promotional purpose".** A community giveaway (an X account promoting itself, a project promoting its token or Discord) most plausibly fits "promotion of a product or service" when it is run by a brand or project. A purely private gift draw among friends is arguably outside both the Law and the tax. This is unclear; ask a lawyer.
- **Follows, retweets and joins.** Requiring these is generally treated as non-monetary participation (no "sobreprecio"). I found no DGOJ text specifically on it (see Gaps).
- **Who is the organizer.** When third parties run giveaways on ElClub.'s tool, they decide the prize and promote themselves, so they are most plausibly the organizer and taxpayer, not the software provider.
  - Risk factors: ElClub. contributing prizes, branding the draws as its own, or monetising the draws.
  - ElClub.'s own promotional giveaways (prize funded by ElClub.) would make the developer the organizer. If of state-wide scope, file Modelo 685 and pay 10% of the prize's market value. Model number is from my knowledge; verify.
  - Terms of use should state that organizers are responsible for their own legal and tax compliance in their jurisdiction.
- **Crypto as prize.** Valuation would most plausibly be the market value of the USDC in EUR at the time it is offered. The winner's IRPF treatment (ganancia patrimonial, and any withholding obligation for prizes over a threshold) is unverified; see Gaps.

### Gaps
- I found no DGOJ guidance on crypto prizes, on platforms hosting third-party giveaways, or on social-media follow/RT entry requirements. The ordenacionjuego.es site was not reached.
- I found no DGT ruling on crypto as a prize.
- The IRPF withholding obligation on promotional prizes (and its threshold) was not verified.
- Whether Modelo 685 is still the form, and how the "ámbito estatal vs autonómico" test applies to a global online draw, are unverified. Lawyer or gestor needed.

## 3. Advertising: CNMV Circular 1/2022 and MiCA marketing rules

### Takeaway
CNMV Circular 1/2022 on crypto-asset advertising was repealed by CNMV Circular 1/2024 of 17 Dec 2024 (BOE 27 Dec 2024), because MiCA is directly applicable. The prior notification of mass campaigns has gone. MiCA's marketing rules (fair, clear, not misleading, identifiable as marketing) attach mainly to offerors, issuers and CASPs. A landing page for non-custodial tools that does not promote buying or investing in a crypto-asset is low-risk, but should avoid investment claims.

### Cited Findings
- **Repeal.** Circular 1/2022 was repealed by Circular 1/2024 of 17 Dec 2024, published in the BOE on 27 Dec 2024, because MiCA is directly applicable. The prior notification for mass campaigns has disappeared. MiCA requires advertising to be fair, clear and not misleading, and the CNMV can demand changes. — [finReg360](https://finreg360.com/alerta/la-cnmv-deroga-la-circular-sobre-publicidad-sobre-criptoactivos-ante-la-proxima-fecha-de-aplicacion-de-mica); [Hacienda normativa repository](https://www.hacienda.gob.es/DocLeyes/REPOSITORIO%20NORMATIVA/75489.htm)
- **Reverse solicitation.** The exemption does not cover soliciting or promoting services to EU customers, so marketing a third-country crypto service to Spaniards is risky. — [Osborne Clarke 2026](https://www.osborneclarke.com/insights/spain-closes-micar-transitional-period-crypto-asset-service-providers)

### Inferences
- The safety checker (tool 4) shows token data and risk flags. It is informational and not a marketing communication for a crypto-asset, provided it does not promote tokens. Disclaim "not investment advice".
- Avoid affiliate links to exchanges that are not MiCA-authorised. This links to the reverse-solicitation point and to possible "facilitation" issues.
- General Spanish consumer and advertising law (Ley General de Publicidad, LSSI-CE information duties: identity, NIF, contact on the website) still applies to any public site run as an economic activity. This is general knowledge, not sourced here.

### Gaps
- I did not retrieve the MiCA Art. 66, 53 and 29 text on marketing communications.
- I found no 2025–2026 CNMV statement on finfluencers or crypto ads after the Circular was repealed.

## 4. GDPR and immutable on-chain data: EAS attestations linking wallets and handles

### Takeaway
The EDPB adopted the final Guidelines 02/2025 on blockchain (v2.0) on 7 July 2026; version 1.1 had been adopted on 8 Apr 2025. They say:
- avoid storing personal data on-chain;
- use off-chain storage with hashes or references only, keeping in mind that salted hashes and commitments are still personal data if linkable;
- apply data protection by design;
- run a DPIA before deploying.

Public EAS attestations that link wallet addresses to X, Telegram or Discord handles are exactly the high-risk pattern. Erasure and rectification cannot be honoured on an immutable chain.

### Cited Findings
- **Adoption dates.** Version 2.0 was adopted on 7 July 2026, after a consultation on v1.1 (8 Apr 2025) that closed on 9 June 2025. — [Digital Policy Alert](https://digitalpolicyalert.org/change/14145); [Dudkowiak (final guidelines)](https://www.dudkowiak.com/blog/blockchain-and-the-gdpr-the-edpbs-final-guidelines-for-the-fintech-and-crypto-sectors/)
- **Core message unchanged in the final text:** avoid on-chain personal data, apply data protection by design, run a DPIA before deployment. — [Dudkowiak](https://www.dudkowiak.com/blog/blockchain-and-the-gdpr-the-edpbs-final-guidelines-for-the-fintech-and-crypto-sectors/); [PPC Land](https://ppc.land/edpb-forces-blockchain-firms-to-avoid-storing-personal-data-on-chain/)
- **2025 draft.** It discouraged putting personal data directly on-chain and suggested hashes or references instead. — [Mondaq](https://www.mondaq.com/fin-tech/1617044/blockchain-and-gdpr-edpb-guidelines-022025-adopted); [McCann FitzGerald](https://www.mccannfitzgerald.com/knowledge/data-privacy-and-cyber-risk/considering-using-blockchain-with-personal-data-the-edpb-has-provided-guidance-open-for-public-consultation-until-9-june-2025)

### Inferences
- **Tool 5 (vouches).** Wallet addresses linked to a handle are personal data. Recommended design:
  - keep handle-to-wallet links off-chain (in the ElClub DB, deletable);
  - put on-chain only wallet-to-wallet attestations with no free text, or use EAS off-chain attestations;
  - do a DPIA;
  - explain in the privacy policy that on-chain data cannot be erased;
  - get explicit user action, with the user signing the attestation themselves so that the user is the one publishing.
- Whoever operates the dapp and decides the schema is likely a controller.
- **Giveaway tool.** Storing entrants' social handles and wallets is ordinary personal-data processing. It needs a legal basis, a retention limit and a privacy notice. Do not write entrant handles on-chain; commit to a Merkle root of salted entries.
- The AEPD is the Spanish authority. I did not find any specific AEPD blockchain guidance in 2025–2026.

### Gaps
- The full text of the final v2.0 was not read directly. Check edpb.europa.eu.
- I found no AEPD blockchain guidance after 2025.

## 5. AML: Ley 10/2010, EU AMLR, Transfer of Funds Regulation (travel rule)

### Takeaway
AML and travel-rule obligations attach to obliged entities, which for crypto means CASPs. The Transfer of Funds Regulation (EU) 2023/1113 has applied since 30 Dec 2024 to CASPs. The AMLR (EU) 2024/1624 applies from 10 July 2027 and treats CASPs as obliged financial institutions. A non-custodial tool that is not a CASP is not itself an obliged entity. If any tool is deemed custody or transfer, full KYC, the travel rule and self-hosted-wallet checks follow.

### Cited Findings
- **AMLR timing.** The AMLR applies from 10 July 2027 (art. 90); national laws implementing the directives govern until then. CASPs must perform customer due diligence even on occasional transactions under €1,000 and may not keep anonymous accounts. — [Cryptoslate law profile](https://cryptoslate.com/crypto-laws/eu-aml-package-regulation-2024-1624-directive-2024-1640/); [Didit](https://didit.me/blog/amlr-crypto-casp-requirements/) (commentary)
- **TFR.** Regulation 2023/1113 has applied from 30 Dec 2024. Self-hosted wallets are not banned, but CASPs must apply risk assessment and mitigating measures to self-hosted transfers. — [Cryptoslate](https://cryptoslate.com/crypto-laws/eu-aml-package-regulation-2024-1624-directive-2024-1640/); [Blockspot](https://blockspot.io/what-is-amlr/) (commentary; sources differ on details)

### Inferences
- **Ley 10/2010.** As amended in 2021, its obliged entities included exchange and custodial-wallet providers registered with the Banco de España. This is my knowledge, not fetched here. Non-custodial software was not covered.
- An individual running non-custodial tools has no AML programme obligation, but should:
  - avoid being a funds conduit;
  - screen for sanctions risk (OFAC/EU lists), for example by blocking sanctioned addresses in the UI;
  - not facilitate obvious laundering, where general criminal law still applies.
- If a platform fee flows through a developer-controlled address, the developer's own exchange of that crypto to EUR will be KYC'd at the off-ramp CASP. That is normal.

### Gaps
- I did not verify the Ley 10/2010 art. 2 list text, or any 2025–2026 Spanish AML law transposing AMLD6.
- I did not verify whether the EU sanctions regime imposes obligations on non-custodial front-end operators.

## 6. Spanish tax for platform fees earned in crypto (autónomo, IVA)

### Takeaway
Regularly earning fees or API revenue is an economic activity. In practice that means registering as autónomo with Hacienda (censal Modelo 036/037) and the Seguridad Social (RETA), and paying IRPF on the EUR value of income received in USDC. VAT: fees for automated online services are most plausibly "electronically supplied services". They are taxable at 21% in Spain for Spanish B2C customers. For EU B2C customers in other member states, destination VAT applies, through OSS above the €10,000 EU threshold. B2B is reverse charge. Receiving payment in crypto does not change the VAT treatment of the service. Disposals of virtual currency are VAT-exempt for the payer.

### Cited Findings
- **DGT VAT doctrine on crypto.** Transmissions of virtual currency are subject to but exempt from VAT (art. 20.Uno.18º LIVA; DGT V2228/2013, V1028/2015). Exchange is exempt (V2679-21). Non-exempt crypto-related services (for example custody) are taxable. — [Cuatrecasas on DGT DeFi](https://www.cuatrecasas.com/es/latam/fiscalidad/art/defi-dgt-analiza-diversas-cuestiones); [CMS 2018 PDF](https://cms.law/es/content/download/346898/8991994/version/1/file/20180528%20CMS%20Consideraciones%20tributarias%20generales%20sobre%20el%20bitcoin.pdf); [finReg360 on staking VAT](https://finreg360.com/alerta/la-direccion-general-de-tributos-se-pronuncia-por-primera-vez-sobre-el-iva-de-la-actividad-de-staking-con-criptomonedas/)
- **DGT V2428-25 (11 Dec 2025).** Commissions from digital platforms received by a content creator are treated as advertising services, with VAT depending on where the recipient is located. — via search summary of [Cuatrecasas influencer PDF](https://www.cuatrecasas.com/resources/influencer-text-668d1a66b5d0e660123769.pdf) (indirect; verify)

### Inferences
These come from general Spanish and EU VAT knowledge; verify with a gestor.
- Fees paid by anonymous wallets make it hard to determine the customer's location and status. The VAT place-of-supply evidence rules (IP address, billing data) are a practical problem for on-chain micro-fees. This is an argument for **not charging fees until a company or gestor is set up**.
- **Each USDC receipt** is income valued in EUR at receipt.
- **Converting USDC to EUR** is a separate disposal, whose gain or loss in IRPF is usually tiny for a stablecoin.
- **Modelo 721** (crypto held abroad over €50,000) is unlikely to apply to self-custody in Spain, given the DGT position that only crypto held by third-party custodians counts. Verify.
- **DAC8.** From 2026, CASPs report users' transactions to the tax authorities, so off-ramp flows will be visible.

### Gaps
- I found no DGT ruling on the VAT treatment of a non-custodial dapp fee paid in crypto.
- The DAC8 and Modelo 721 points are not sourced here.

## 7. Practical recommendations per tool (individual, Spain, Oct 2026)

### Takeaway
Ranked by legal risk for an individual without a company:
- **Lowest risk:** (4) safety checker with x402 API; (5) EAS vouches, if designed privacy-first; (3) payment/tip links that are pure wallet-to-wallet with no fee.
- **Medium risk:** (1) giveaways, if free entry, with an immutable escrow or a direct send by the organizer, and with the organizer responsible for compliance and the 10% gaming tax.
- **Highest risk:** (2) bounty escrow, because of dispute and arbitration control. Also any variant where the developer holds or routes funds or skims a fee in the flow, which risks being a CASP plus PSD2/EMT payment service. Neither licence is available to an individual. Lawyer needed before launch.

### Cited Findings
- Only MiCA-authorised entities may provide crypto-asset services in Spain from 1 July 2026. — [Osborne Clarke](https://www.osborneclarke.com/insights/spain-closes-micar-transitional-period-crypto-asset-service-providers)
- EMT (USDC) payment services need PSD2 authorisation as well. — [Osborne Clarke](https://www.osborneclarke.com/insights/spain-closes-micar-transitional-period-crypto-asset-service-providers); [EBA](https://www.eba.europa.eu/publications-and-media/press-releases/eba-publishes-no-action-letter-interplay-between-payment-services-directive-psd23-and-markets-crypto)
- Control or sufficient influence over the software, platform or user relationships can make a developer a CASP. — [LegalBison on ESMA/EBA Joint Report](https://legalbison.com/blog/study-we-are-defi-so-mica-does-not-apply-to-us-eba-and-esma-disagree/)
- Promotional draws pay a 10% tax on the prize's market value. — [Ley 13/2011](https://www.hacienda.gob.es/DocLeyes/onlinelt/27070.htm)
- Avoid personal data on-chain. — [Dudkowiak on EDPB 02/2025 final](https://www.dudkowiak.com/blog/blockchain-and-the-gdpr-the-edpbs-final-guidelines-for-the-fintech-and-crypto-sectors/)

### Inferences
Design rules that keep tools on the "software, not service" side:
- Contracts are immutable, with no owner, pause, upgrade or admin functions.
- The developer never holds keys that can move user funds, and no backend signer triggers payouts.
- Commit-reveal plus drand makes the outcome deterministic and verifiable, so the developer cannot pick a winner. This also helps the gaming analysis.
- No developer-run dispute resolution over escrowed funds. For bounties, release is by the poster only, with a timeout refund to the poster. That makes it a self-escrow, not arbitration.
- No fee taken from the user's funds flow at launch. Monetise through the paid x402 API (the developer's own service) or sponsorships instead.
- Publish terms of use with an organizer-responsibility clause, a privacy policy and a DPIA. Include the LSSI-CE legal notice with the operator's identity.
- Block sanctioned addresses in the UI.
- Geo-scope consideration: the "Spain-resident developer" link means Spanish law applies regardless of where users are.

When to set up an SL and get a lawyer:
- before any fee-in-flow model;
- before the bounty board launches with arbitration;
- if giveaway volume or prize sizes grow (tax filings);
- if there is any plan to hold user funds.

A brief opinion from a Spanish crypto/fintech firm (for example Cuatrecasas, Garrigues, Pérez-Llorca, finReg360 or Finnovating-network firms) is advisable for tools 1–3 specifically.

### Gaps
- No primary regulator text confirms that an immutable escrow without admin keys is outside MiCA. It rests on the definitions plus ESMA/EBA's control test (secondary).
- No DGOJ guidance specific to platforms or crypto prizes was found.
