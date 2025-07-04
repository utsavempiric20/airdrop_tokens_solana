import { PublicKey } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import idl from "../idl/airdropper_solana.json";

export interface DistributorAccount {
  merkleRoot: number[];
  vault: PublicKey;
  bump: number;
  tokenMint: PublicKey;
  totalSupply: anchor.BN;
  claimedBitmap: number[];
  authority: PublicKey;
}

export async function getDistributorAccount(
  connection: anchor.web3.Connection,
  distributorAddress: PublicKey
): Promise<DistributorAccount | null> {
  try {
    const provider = new anchor.AnchorProvider(connection, {} as any, {});
    const program = new Program(idl as any, provider);

    const account = await (program.account as any).distributor.fetch(
      distributorAddress
    );
    return account as DistributorAccount;
  } catch (error) {
    console.error("Error fetching distributor account:", error);
    return null;
  }
}

export async function getAllDistributors(
  connection: anchor.web3.Connection
): Promise<{ address: PublicKey; data: DistributorAccount }[]> {
  try {
    const provider = new anchor.AnchorProvider(connection, {} as any, {});
    const program = new Program(idl as any, provider);

    const accounts = await (program.account as any).distributor.all();
    return accounts.map((account: any) => ({
      address: account.publicKey,
      data: account.account as DistributorAccount,
    }));
  } catch (error) {
    console.error("Error fetching all distributors:", error);
    return [];
  }
}

export function isClaimed(claimedBitmap: number[], index: number): boolean {
  const byteIndex = Math.floor(index / 8);
  const bitmask = 1 << index % 8;
  return (claimedBitmap[byteIndex] & bitmask) !== 0;
}

export function formatAmount(amount: anchor.BN, decimals: number = 9): string {
  return (amount.toNumber() / Math.pow(10, decimals)).toFixed(2);
}
