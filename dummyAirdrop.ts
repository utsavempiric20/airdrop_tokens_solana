import fs from "fs";
import { MerkleTree } from "merkletreejs";
import keccak256 from "keccak256";

const airdropList: Array<{ address: string; amount: number }> = [
  { address: "5Gz…abc", amount: 100 },
  { address: "F7x…xyz", amount: 250 },
];

const leaves = airdropList.map(({ address, amount }) =>
  keccak256(
    Buffer.concat([
      Buffer.from(address, "hex"),
      Buffer.from(amount.toString(16).padStart(16, "0"), "hex"),
    ])
  )
);
console.log("leaves : ", leaves);

const tree = new MerkleTree(leaves, keccak256, { sortPairs: true });
console.log("tree : ", tree);

const root = tree.getRoot().toString("hex");
console.log("root : ", root);

fs.writeFileSync("./merkle-root.txt", root, "utf8");

for (let i = 0; i < leaves.length; i++) {
  const proof = tree.getProof(leaves[i]).map((x) => x.data.toString("hex"));
  fs.writeFileSync(`./proof-${i}.json`, JSON.stringify(proof));
}

const testIndex = 0;
const { address, amount } = airdropList[testIndex];

const leaf = keccak256(
  Buffer.concat([
    Buffer.from(address, "hex"),
    Buffer.from(amount.toString(16).padStart(16, "0"), "hex"),
  ])
);

const proof: string[] = JSON.parse(
  fs.readFileSync(`./proof-${testIndex}.json`, "utf8")
);

const proofBuffers = proof.map((p) => Buffer.from(p, "hex"));
console.log("proofBuffers : ", proofBuffers.concat);

const isValid = tree.verify(proofBuffers, leaf, Buffer.from(root, "hex"));

console.log(`Entry #${testIndex} valid?`, isValid);
