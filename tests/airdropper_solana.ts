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

function u32LE(n: number) {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(n, 0);
  return buf;
}

function u64LE(n: bigint | number) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(n), 0);
  return buf;
}

describe("airdropper_solana", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace
    .AirdropperSolana as Program<AirdropperSolana>;
  const payer = (provider.wallet as NodeWallet).payer;

  const airdropList: Array<{ address: string; amount: number }> = [
    {
      address: "HQmsmTXzUymb5o383iTNccakfF4f2AzwUy4uzBuUfCbG",
      amount: 100_000_000_000,
    },
    {
      address: "7j5N9EEPWE9J2EZh9TeVCpoprbQRYr98kTsBpzpR7hwf",
      amount: 250_000_000_000,
    },
    {
      address: "6pFmLeY3cHeQiaErwa9BcC8HPdudrYmHLYDqdx6nXYTc",
      amount: 650_000_000_000,
    },
  ];

  const leaves = airdropList.map(({ address, amount }, i) =>
    keccak256(
      Buffer.concat([
        u32LE(i),
        new PublicKey(address).toBuffer(),
        u64LE(amount),
      ])
    )
  );

  const tree = new MerkleTree(leaves, keccak256, { sortPairs: true });

  const root = tree.getRoot().toString("hex");
  console.log("root : ", root);
  const merkleRoot = Buffer.from(root, "hex");

  fs.writeFileSync("./merkle-root.txt", root, "utf8");

  for (let i = 0; i < leaves.length; i++) {
    const proof = tree.getProof(leaves[i]).map((x) => x.data.toString("hex"));
    console.log("proof : ", proof);

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
      [Buffer.from("distributor"), merkleRoot],
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

  it("Transfer AirdropTokens from admin", async () => {
    for (let i = 1; i < airdropList.length; i++) {
      const { address, amount } = airdropList[i];
      const recipient = new PublicKey(address);

      const recipientAta = await anchor.utils.token.associatedAddress({
        mint: tokenMint,
        owner: recipient,
      });
      try {
        await createAssociatedTokenAccount(
          provider.connection,
          payer,
          tokenMint,
          recipient,
          null,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_PROGRAM_ID,
          true
        );
      } catch (_) {}

      const leaf = leaves[i];

      const proof = tree.getProof(leaf).map((x) => Array.from(x.data));

      console.log(`Airdropping to #${i} → ${address} (${amount})`);

      await program.methods
        .claim(i, new anchor.BN(amount), proof)
        .accountsStrict({
          distributor: distributor.publicKey,
          distributorTokenAccount: vaultTokenAccount,
          userTokenAccount: recipientAta,
          associatedTokenProgram: ASSOCIATED_PROGRAM_ID,
          distributorAuthority: vault_authority,
          rent: SYSVAR_RENT_PUBKEY,
          systemProgram: SYSTEM_PROGRAM_ID,
          tokenMint,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      console.log(`Done #${i}`);
    }
  });

  it("Claim AirdropTokens By User", async () => {
    const { address, amount } = airdropList[0];
    const recipient = new PublicKey(address);

    const recipientAta = await anchor.utils.token.associatedAddress({
      mint: tokenMint,
      owner: recipient,
    });
    try {
      await createAssociatedTokenAccount(
        provider.connection,
        payer,
        tokenMint,
        recipient,
        null,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_PROGRAM_ID,
        true
      );
    } catch (_) {}

    const leaf = leaves[0];

    const proof = tree.getProof(leaf).map((x) => Array.from(x.data));

    console.log(`Airdropping to #${0} → ${address} (${amount})`);

    await program.methods
      .claimUserAirdrop(0, new anchor.BN(amount), proof)
      .accountsStrict({
        distributor: distributor.publicKey,
        distributorTokenAccount: vaultTokenAccount,
        userTokenAccount: recipientAta,
        associatedTokenProgram: ASSOCIATED_PROGRAM_ID,
        distributorAuthority: vault_authority,
        rent: SYSVAR_RENT_PUBKEY,
        systemProgram: SYSTEM_PROGRAM_ID,
        tokenMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        claimer: payer.publicKey,
      })
      .rpc();

    console.log(`Done #${0}`);
  });
});
