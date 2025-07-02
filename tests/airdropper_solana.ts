import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AirdropperSolana } from "../target/types/airdropper_solana";
import { MerkleTree } from "merkletreejs";
import keccak256 from "keccak256";
import fs from "fs";
import { Keypair, PublicKey, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import {
  createAccount,
  createAssociatedTokenAccount,
  createMint,
  mintTo,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import NodeWallet from "@coral-xyz/anchor/dist/cjs/nodewallet";
import { SYSTEM_PROGRAM_ID } from "@coral-xyz/anchor/dist/cjs/native/system";
import { ASSOCIATED_PROGRAM_ID } from "@coral-xyz/anchor/dist/cjs/utils/token";

describe("airdropper_solana", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace
    .AirdropperSolana as Program<AirdropperSolana>;
  const payer = (provider.wallet as NodeWallet).payer;

  const airdropList: Array<{ address: string; amount: number }> = [
    { address: "5Gz…abc", amount: 100 },
    { address: "F7x…xyz", amount: 250 },
  ];

  const leaves = airdropList.map(({ address, amount }, i) =>
    keccak256(
      Buffer.concat([
        Buffer.from(i.toString(16).padStart(8, "0"), "hex"),
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
  const merkleRoot = Buffer.from(root, "hex");

  fs.writeFileSync("./merkle-root.txt", root, "utf8");

  for (let i = 0; i < leaves.length; i++) {
    const proof = tree.getProof(leaves[i]).map((x) => x.data.toString("hex"));
    console.log("proof1 : ", proof);

    fs.writeFileSync(`./proof-${i}.json`, JSON.stringify(proof));
  }

  let distributor = Keypair.generate();
  let distributor_pubkey = distributor.publicKey;
  let tokenMint: PublicKey;
  let vault_authority: PublicKey;
  let vaultBump: any;
  let vaultTokenAccount: PublicKey;
  let userAta: PublicKey;

  before("Derive PDA and Mint", async () => {
    tokenMint = await createMint(
      provider.connection,
      payer,
      payer.publicKey,
      null,
      9
    );
    console.log("tokenMint : ", tokenMint.toBase58());

    userAta = await createAccount(
      provider.connection,
      payer,
      tokenMint,
      provider.publicKey
    );
    console.log("userAta : ", userAta.toBase58());

    [vault_authority, vaultBump] = await PublicKey.findProgramAddressSync(
      [Buffer.from("distributor"), distributor_pubkey.toBuffer()],
      program.programId
    );
    console.log("vault_authority : ", vault_authority.toBase58());

    vaultTokenAccount = await anchor.utils.token.associatedAddress({
      mint: tokenMint,
      owner: vault_authority,
    });
    console.log("vaultTokenAccount : ", vaultTokenAccount.toBase58());

    await createAssociatedTokenAccount(
      provider.connection,
      payer,
      tokenMint,
      vault_authority,
      null,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_PROGRAM_ID,
      true
    );
    console.log("created");
    await mintTo(
      provider.connection,
      payer,
      tokenMint,
      vaultTokenAccount,
      payer.publicKey,
      1000000000000
    );
    console.log("minted");
  });

  it("Initialize the airdrop!", async () => {
    const amount = new anchor.BN(1000000000000);
    await program.methods
      .initialize(Array.from(merkleRoot), amount)
      .accountsStrict({
        payer: payer.publicKey,
        distributor: distributor.publicKey,
        distributorAuthority: vault_authority,
        distributorTokenAccount: vaultTokenAccount,
        tokenMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SYSTEM_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_PROGRAM_ID,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([distributor])
      .rpc();
  });

  it("Transfer AirdropTokens", async () => {
    for (let i = 0; i < airdropList.length; i++) {
      const { address, amount } = airdropList[i];

      const leaf = leaves[i];
      console.log("tree.getProof(leaf) : ", tree.getProof(leaf));

      const proof = tree.getProof(leaf).map((x) => Array.from(x.data));

      console.log(`⏳ Airdropping to #${i} → ${address} (${amount})`);
      console.log("proof :", proof);

      await program.methods
        .claim(i, new anchor.BN(amount), proof)
        .accountsStrict({
          distributor: distributor.publicKey,
          distributorTokenAccount: vaultTokenAccount,
          userTokenAccount: userAta,
          associatedTokenProgram: ASSOCIATED_PROGRAM_ID,
          distributorAuthority: vault_authority,
          rent: SYSVAR_RENT_PUBKEY,
          systemProgram: SYSTEM_PROGRAM_ID,
          tokenMint,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      console.log(`✅ Done #${i}`);
    }
  });
});
