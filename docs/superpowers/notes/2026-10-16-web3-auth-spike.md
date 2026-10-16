# Spike: Supabase native Web3 Auth (2026-10-16)

Test: `tests/integration/web3-auth.test.ts` against local Supabase (`auth.web3.ethereum.enabled = true`).
Flow: viem `privateKeyToAccount(generatePrivateKey())` signs `buildLoginMessage(...)` (domain `localhost:3000`, uri `http://localhost:3000/login`), then `supabase.auth.signInWithWeb3({ chain: 'ethereum', message, signature })`.

## Result: PASS, native sign-in works

- Session returned; repeating the login with the same account returns the same `user.id`.
- `app_metadata`: `{"provider":"web3","providers":["web3"]}`
- `identities[0].provider` = `web3`.
- `identities[0].id` / `auth.identities.provider_id` = `web3:ethereum:<address>`.

## Observed identity (exact, throwaway key)

```json
{
  "identity_id": "ba275c85-56f1-4118-9c10-6f2110647d69",
  "id": "web3:ethereum:0xe434C2a26DB927cf07dC03bfd59FBf57ff62D233",
  "user_id": "1bd9cb39-7fef-4048-8470-b0a48275e199",
  "identity_data": {
    "custom_claims": {
      "address": "0xe434C2a26DB927cf07dC03bfd59FBf57ff62D233",
      "chain": "ethereum",
      "domain": "localhost:3000",
      "network": "59141",
      "statement": "Entra en El Club Lambo. Esta firma no cuesta gas ni mueve fondos."
    },
    "email_verified": false,
    "phone_verified": false,
    "sub": "web3:ethereum:0xe434C2a26DB927cf07dC03bfd59FBf57ff62D233"
  },
  "provider": "web3"
}
```

The same shape was confirmed straight from `auth.identities` in Postgres (`identity_data` jsonb and `provider_id`).

## IMPORTANT deviation from the plan

The SIWE fields (`address`, `chain`, `network`, `domain`, `statement`) are NOT top-level in
`identity_data`; they are nested under `identity_data.custom_claims`. So
`identity_data->>'address'` is NULL. SQL must read one of:

- `identity_data->'custom_claims'->>'address'`, or
- `split_part(provider_id, ':', 3)` (also `identity_data->>'sub'`).

Tasks that use `identity_data->>'address'` (SQL helpers, `wallet_mismatch`, bootstrap) must be adapted.
Using `provider_id` / `sub` is probably the most stable accessor; verify it in the SQL tests.

## Casing

Address casing is EIP-55 checksum in both `identity_data.custom_claims.address` and `provider_id`/`sub`
(exactly as written in the signed message; viem's `createSiweMessage` checksums). Not lowercased by
Supabase, so SQL must `lower()` before comparing/storing.

## Chain IDs

- chainId 59141 (Linea Sepolia): accepted, `network: "59141"`.
- chainId 59144 (Linea): accepted, `network: "59144"`.
- chainId 1 (foreign), message built bypassing our builder: ALSO accepted by Supabase
  (`network: "1"`). Supabase does not restrict chains; `buildLoginMessage` (client-side, throws
  `invalid_input`) is the only guard. Do not rely on `network` for authorization.

## Decision

Use native Supabase Web3 Auth (no plan B). Only follow-up: adapt the address accessor in SQL (above).
