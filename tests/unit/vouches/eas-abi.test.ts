import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { easAbi, schemaRegistryAbi } from "@/lib/vouches/eas-abi";

type Param = { name?: string; type: string; indexed?: boolean; components?: readonly Param[] };
type Fragment = { type: string; name?: string; stateMutability?: string; anonymous?: boolean; inputs?: readonly Param[]; outputs?: readonly Param[] };

const req = createRequire(import.meta.url);
const root = "@ethereum-attestation-service/eas-contracts/artifacts/contracts";

const param = (p: Param): Param => ({
  name: p.name ?? "",
  type: p.type,
  ...(p.indexed !== undefined ? { indexed: p.indexed } : {}),
  ...(p.components ? { components: p.components.map(param) } : {}),
});
const norm = (f: Fragment) => ({
  type: f.type,
  name: f.name,
  stateMutability: f.stateMutability,
  anonymous: f.anonymous,
  inputs: (f.inputs ?? []).map(param),
  outputs: (f.outputs ?? []).map(param),
});

function check(ours: readonly Fragment[], artifact: Fragment[], names: string[]) {
  expect(ours.map((f) => f.name).sort()).toEqual([...names].sort());
  for (const f of ours) {
    const theirs = artifact.find((a) => a.type === f.type && a.name === f.name);
    expect(theirs, `${f.type} ${f.name} exists in the package`).toBeDefined();
    expect(norm(f)).toEqual(norm(theirs!));
  }
}

describe("hand-written ABIs match the package artifacts", () => {
  it("EAS", () => {
    check(easAbi as readonly Fragment[], req(`${root}/EAS.sol/EAS.json`).abi, ["attest", "revoke", "getAttestation", "getSchemaRegistry", "Attested", "Revoked"]);
  });
  it("SchemaRegistry", () => {
    check(schemaRegistryAbi as readonly Fragment[], req(`${root}/SchemaRegistry.sol/SchemaRegistry.json`).abi, ["getSchema", "register"]);
  });
});
