import React, { useState, useEffect } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useConnection } from "@solana/wallet-adapter-react";
import {
  PublicKey,
  Keypair,
  Transaction,
  SystemProgram,
} from "@solana/web3.js";
import { MerkleTree } from "merkletreejs";
import { keccak_256 } from "@noble/hashes/sha3";
import {
  createAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddress,
  createInitializeMintInstruction,
  MintLayout,
  createMintToInstruction,
} from "@solana/spl-token";
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import idl from "../idl/airdropper_solana.json";
import {
  getDistributorAccount,
  getAllDistributors,
  isClaimed,
  formatAmount,
  type DistributorAccount,
} from "../utils/onchain";

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

type TabType = "create" | "claim" | "distributors" | "recipients";

interface Recipient {
  address: string;
  amount: number;
  index: number;
}

const keccak256 = (data: Buffer): Buffer => Buffer.from(keccak_256(data));

const AirdropPage: React.FC = () => {
  const { publicKey, signTransaction } = useWallet();
  const { connection } = useConnection();
  const [activeTab, setActiveTab] = useState<TabType>("create");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [distributors, setDistributors] = useState<
    { address: PublicKey; data: DistributorAccount }[]
  >([]);
  const [selectedDistributor, setSelectedDistributor] =
    useState<DistributorAccount | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshInterval, setRefreshInterval] = useState<NodeJS.Timeout | null>(
    null
  );

  const [createForm, setCreateForm] = useState({
    tokenName: "",
    tokenSymbol: "",
    totalSupply: "",
    recipientAddress: "",
    recipientAmount: "",
  });

  const [claimForm, setClaimForm] = useState({
    distributorAddress: "",
    tokenMint: "",
    claimIndex: 0,
    claimAmount: "",
  });

  const [airdropList, setAirdropList] = useState<Recipient[]>([]);

  const addRecipient = () => {
    if (!createForm.recipientAddress || !createForm.recipientAmount) {
      setStatus("❌ Please fill in both address and amount");
      return;
    }

    try {
      new PublicKey(createForm.recipientAddress);
    } catch (error) {
      setStatus("❌ Invalid Solana address format");
      return;
    }

    const amount = parseFloat(createForm.recipientAmount);
    if (isNaN(amount) || amount <= 0) {
      setStatus("❌ Please enter a valid positive amount");
      return;
    }

    const amountInLamports = amount * 1e9;
    const newRecipient: Recipient = {
      address: createForm.recipientAddress,
      amount: amountInLamports,
      index: airdropList.length,
    };

    const isDuplicate = airdropList.some(
      (recipient) => recipient.address === createForm.recipientAddress
    );

    if (isDuplicate) {
      setStatus("❌ This address is already in the list");
      return;
    }

    setAirdropList([...airdropList, newRecipient]);
    setCreateForm({
      ...createForm,
      recipientAddress: "",
      recipientAmount: "",
    });
    setStatus("✅ Recipient added successfully!");
  };

  const removeRecipient = (index: number) => {
    const newList = airdropList.filter((_, i) => i !== index);
    const updatedList = newList.map((recipient, i) => ({
      ...recipient,
      index: i,
    }));
    setAirdropList(updatedList);
    setStatus("✅ Recipient removed successfully!");
  };

  const clearRecipients = () => {
    setAirdropList([]);
    setStatus("✅ All recipients cleared!");
  };

  const getProvider = () => {
    if (!publicKey) {
      throw new Error("Wallet not connected - no public key");
    }
    if (!signTransaction) {
      throw new Error(
        "Wallet not properly connected - no sign transaction function"
      );
    }

    const wallet = {
      publicKey,
      signTransaction,
      signAllTransactions: async (txs: any[]) => {
        return await Promise.all(txs.map((tx) => signTransaction(tx)));
      },
    };
    return new anchor.AnchorProvider(connection, wallet as any, {});
  };

  const getProgram = (provider: anchor.AnchorProvider) => {
    return new Program(idl as any, provider);
  };

  const createAirdrop = async () => {
    if (!publicKey) {
      setStatus("❌ Please connect your wallet");
      return;
    }

    if (!signTransaction) {
      setStatus("❌ Wallet not properly connected");
      return;
    }

    if (airdropList.length === 0) {
      setStatus("❌ Please add at least one recipient");
      return;
    }

    if (
      !createForm.tokenName ||
      !createForm.tokenSymbol ||
      !createForm.totalSupply
    ) {
      setStatus("❌ Please fill in all token details");
      return;
    }

    setLoading(true);
    setStatus("🔄 Creating airdrop...");

    try {
      console.log("Creating airdrop...");
      const provider = getProvider();
      const program = getProgram(provider);
      console.log(program);

      const mintKeypair = Keypair.generate();
      const rentForMint = await connection.getMinimumBalanceForRentExemption(
        MintLayout.span
      );

      const initMintTx = new Transaction().add(
        SystemProgram.createAccount({
          fromPubkey: publicKey,
          newAccountPubkey: mintKeypair.publicKey,
          space: MintLayout.span,
          lamports: rentForMint,
          programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeMintInstruction(
          mintKeypair.publicKey,
          9,
          publicKey,
          null,
          TOKEN_PROGRAM_ID
        )
      );
      initMintTx.feePayer = publicKey;
      const recentBlockhash = await connection.getLatestBlockhash();
      initMintTx.recentBlockhash = recentBlockhash.blockhash;
      initMintTx.lastValidBlockHeight = recentBlockhash.lastValidBlockHeight;

      let signed = await signTransaction(initMintTx);
      signed.partialSign(mintKeypair);

      let txid = await connection.sendRawTransaction(signed.serialize());
      await connection.confirmTransaction(txid, "confirmed");

      const userAta = await getAssociatedTokenAddress(
        mintKeypair.publicKey,
        publicKey
      );

      const createAtaTx = new Transaction().add(
        createAssociatedTokenAccountInstruction(
          publicKey,
          userAta,
          publicKey,
          mintKeypair.publicKey
        )
      );
      createAtaTx.feePayer = publicKey;
      const recentBlockhashATA = await connection.getLatestBlockhash();
      createAtaTx.recentBlockhash = recentBlockhashATA.blockhash;
      createAtaTx.lastValidBlockHeight =
        recentBlockhashATA.lastValidBlockHeight;

      signed = await signTransaction(createAtaTx);
      txid = await connection.sendRawTransaction(signed.serialize());
      await connection.confirmTransaction(txid, "confirmed");

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

      const [vaultAuthority] = PublicKey.findProgramAddressSync(
        [Buffer.from("distributor"), merkleRoot],
        program.programId
      );

      const vaultTokenAccount = await anchor.utils.token.associatedAddress({
        mint: mintKeypair.publicKey,
        owner: vaultAuthority,
      });

      const createAtaTxVault = new Transaction().add(
        createAssociatedTokenAccountInstruction(
          publicKey,
          vaultTokenAccount,
          vaultAuthority,
          mintKeypair.publicKey,
          TOKEN_PROGRAM_ID,
          anchor.utils.token.ASSOCIATED_PROGRAM_ID
        )
      );
      createAtaTxVault.feePayer = publicKey;
      const recentBlockhashATAV = await connection.getLatestBlockhash();
      createAtaTxVault.recentBlockhash = recentBlockhashATAV.blockhash;
      createAtaTxVault.lastValidBlockHeight =
        recentBlockhashATAV.lastValidBlockHeight;

      signed = await signTransaction(createAtaTxVault);
      txid = await connection.sendRawTransaction(signed.serialize());
      await connection.confirmTransaction(txid, "confirmed");

      const totalSupply =
        parseFloat(createForm.totalSupply) * 1e9 || 1000000000000;

      const mintToTx = new Transaction().add(
        createMintToInstruction(
          mintKeypair.publicKey,
          vaultTokenAccount,
          publicKey,
          totalSupply
        )
      );
      mintToTx.feePayer = publicKey;
      const recentBlockhashMintTo = await connection.getLatestBlockhash();
      mintToTx.recentBlockhash = recentBlockhashMintTo.blockhash;
      mintToTx.lastValidBlockHeight =
        recentBlockhashMintTo.lastValidBlockHeight;

      signed = await signTransaction(mintToTx);
      txid = await connection.sendRawTransaction(signed.serialize());
      await connection.confirmTransaction(txid, "confirmed");

      const distributor = Keypair.generate();

      const amount = new anchor.BN(totalSupply);
      await program.methods
        .initialize(Array.from(merkleRoot), amount)
        .accountsStrict({
          payer: publicKey,
          distributor: distributor.publicKey,
          distributorAuthority: vaultAuthority,
          distributorTokenAccount: vaultTokenAccount,
          tokenMint: mintKeypair.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
          associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([distributor])
        .rpc();

      setStatus("✅ Airdrop created successfully!");
      setClaimForm({
        ...claimForm,
        distributorAddress: distributor.publicKey.toString(),
        tokenMint: mintKeypair.publicKey.toString(),
      });
      await loadDistributors();
      setActiveTab("distributors");
    } catch (error) {
      console.error("Error creating airdrop:", error);
      setStatus(
        `❌ Error: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      setLoading(false);
    }
  };

  const claimTokens = async () => {
    if (!publicKey) {
      setStatus("❌ Please connect your wallet");
      return;
    }

    if (!signTransaction) {
      setStatus("❌ Wallet not properly connected");
      return;
    }

    if (!claimForm.distributorAddress || !claimForm.tokenMint) {
      setStatus("❌ Please provide distributor address and token mint");
      return;
    }

    if (!claimForm.claimAmount) {
      setStatus("❌ Please provide claim amount");
      return;
    }

    try {
      new PublicKey(claimForm.distributorAddress);
      new PublicKey(claimForm.tokenMint);
    } catch (error) {
      setStatus("❌ Invalid address format");
      return;
    }

    if (
      claimForm.claimIndex < 0 ||
      claimForm.claimIndex >= airdropList.length
    ) {
      setStatus("❌ Invalid claim index");
      return;
    }

    setLoading(true);
    setStatus("🔄 Claiming tokens...");

    try {
      const provider = getProvider();
      const program = getProgram(provider);

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
      const merkleRoot = Buffer.from(root, "hex");

      const [vaultAuthority] = PublicKey.findProgramAddressSync(
        [Buffer.from("distributor"), merkleRoot],
        program.programId
      );

      const vaultTokenAccount = await anchor.utils.token.associatedAddress({
        mint: new PublicKey(claimForm.tokenMint),
        owner: vaultAuthority,
      });

      const recipientAta = await anchor.utils.token.associatedAddress({
        mint: new PublicKey(claimForm.tokenMint),
        owner: publicKey,
      });

      try {
        await createAssociatedTokenAccount(
          connection,
          { publicKey, signTransaction } as any,
          new PublicKey(claimForm.tokenMint),
          publicKey,
          undefined,
          TOKEN_PROGRAM_ID,
          anchor.utils.token.ASSOCIATED_PROGRAM_ID,
          true
        );
      } catch (_) {}
      const leaf = leaves[claimForm.claimIndex];
      const proof = tree.getProof(leaf).map((x) => Buffer.from(x.data));

      const claimAmountBN = new anchor.BN(claimForm.claimAmount || "0");

      await program.methods
        .claimUserAirdrop(claimForm.claimIndex, claimAmountBN, proof)
        .accountsStrict({
          distributor: new PublicKey(claimForm.distributorAddress),
          distributorTokenAccount: vaultTokenAccount,
          userTokenAccount: recipientAta,
          associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
          distributorAuthority: vaultAuthority,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
          systemProgram: anchor.web3.SystemProgram.programId,
          tokenMint: new PublicKey(claimForm.tokenMint),
          tokenProgram: TOKEN_PROGRAM_ID,
          claimer: publicKey,
        })
        .rpc();

      setStatus("✅ Tokens claimed successfully!");
      await loadDistributors();
    } catch (error) {
      console.error("Error claiming tokens:", error);
      setStatus(
        `❌ Error: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      setLoading(false);
    }
  };

  const loadDistributors = async () => {
    if (!publicKey) return;

    try {
      const allDistributors = await getAllDistributors(connection);
      setDistributors(allDistributors);
    } catch (error) {
      console.error("Error loading distributors:", error);
    }
  };

  const loadSelectedDistributor = async () => {
    if (!claimForm.distributorAddress) return;

    try {
      const distributor = await getDistributorAccount(
        connection,
        new PublicKey(claimForm.distributorAddress)
      );
      setSelectedDistributor(distributor);
    } catch (error) {
      console.error("Error loading selected distributor:", error);
    }
  };

  useEffect(() => {
    if (autoRefresh && publicKey) {
      const interval = setInterval(() => {
        loadDistributors();
      }, 10000);
      setRefreshInterval(interval);
      return () => clearInterval(interval);
    } else if (refreshInterval) {
      clearInterval(refreshInterval);
      setRefreshInterval(null);
    }
  }, [autoRefresh, publicKey]);

  useEffect(() => {
    if (publicKey) {
      loadDistributors();
    }
  }, [publicKey]);

  useEffect(() => {
    if (claimForm.distributorAddress) {
      loadSelectedDistributor();
    }
  }, [claimForm.distributorAddress]);

  const totalAirdropAmount = airdropList.reduce(
    (sum, item) => sum + item.amount,
    0
  );

  const isWalletConnected = publicKey && signTransaction;

  const tabs = [
    { id: "create", label: "Create Airdrop", icon: "🎁" },
    { id: "claim", label: "Claim Tokens", icon: "💰" },
    { id: "distributors", label: "Distributors", icon: "📊" },
    { id: "recipients", label: "Recipients", icon: "👥" },
  ];

  return (
    <div className="space-y-6">
      {status && (
        <div
          className={`p-4 rounded-lg border ${
            status.includes("✅")
              ? "bg-green-50 border-green-200 text-green-800"
              : status.includes("❌")
              ? "bg-red-50 border-red-200 text-red-800"
              : "bg-blue-50 border-blue-200 text-blue-800"
          }`}
        >
          <p className="font-medium">{status}</p>
        </div>
      )}

      {!isWalletConnected && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <svg
                className="h-5 w-5 text-yellow-400"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <div className="ml-3">
              <p className="text-sm text-yellow-800">
                <strong>Wallet Connection Required:</strong> Please ensure your
                wallet is properly connected to use this application.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-200">
        <div className="border-b border-gray-200">
          <nav className="flex space-x-8 px-6" aria-label="Tabs">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as TabType)}
                className={`py-4 px-1 border-b-2 font-medium text-sm flex items-center space-x-2 transition-colors ${
                  activeTab === tab.id
                    ? "border-blue-500 text-blue-600"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                }`}
              >
                <span>{tab.icon}</span>
                <span>{tab.label}</span>
              </button>
            ))}
          </nav>
        </div>

        <div className="p-6">
          {activeTab === "create" && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  Create New Airdrop
                </h3>
                <p className="text-gray-600">
                  Create a new token airdrop with Merkle tree verification
                </p>
              </div>

              <div className="bg-gray-50 rounded-lg p-6">
                <h4 className="font-medium text-gray-900 mb-4">
                  Token Details
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Token Name
                    </label>
                    <input
                      type="text"
                      value={createForm.tokenName}
                      onChange={(e) =>
                        setCreateForm({
                          ...createForm,
                          tokenName: e.target.value,
                        })
                      }
                      className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="My Token"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Token Symbol
                    </label>
                    <input
                      type="text"
                      value={createForm.tokenSymbol}
                      onChange={(e) =>
                        setCreateForm({
                          ...createForm,
                          tokenSymbol: e.target.value,
                        })
                      }
                      className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="MTK"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Total Supply
                    </label>
                    <input
                      type="number"
                      value={createForm.totalSupply}
                      onChange={(e) =>
                        setCreateForm({
                          ...createForm,
                          totalSupply: e.target.value,
                        })
                      }
                      className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="1000000"
                    />
                  </div>
                </div>
              </div>

              <div className="bg-gray-50 rounded-lg p-6">
                <h4 className="font-medium text-gray-900 mb-4">
                  Add Recipients
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Recipient Address
                    </label>
                    <input
                      type="text"
                      value={createForm.recipientAddress}
                      onChange={(e) =>
                        setCreateForm({
                          ...createForm,
                          recipientAddress: e.target.value,
                        })
                      }
                      className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="Enter Solana address"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Amount (tokens)
                    </label>
                    <input
                      type="number"
                      value={createForm.recipientAmount}
                      onChange={(e) =>
                        setCreateForm({
                          ...createForm,
                          recipientAmount: e.target.value,
                        })
                      }
                      className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="100"
                    />
                  </div>
                </div>
                <button
                  onClick={addRecipient}
                  className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
                >
                  ➕ Add Recipient
                </button>
              </div>

              {airdropList.length > 0 && (
                <div className="bg-white border border-gray-200 rounded-lg p-6">
                  <div className="flex justify-between items-center mb-4">
                    <h4 className="font-medium text-gray-900">
                      Recipients ({airdropList.length})
                    </h4>
                    <button
                      onClick={clearRecipients}
                      className="text-red-600 hover:text-red-700 text-sm font-medium"
                    >
                      🗑️ Clear All
                    </button>
                  </div>
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {airdropList.map((recipient, index) => (
                      <div
                        key={index}
                        className="flex justify-between items-center p-3 bg-gray-50 rounded-lg"
                      >
                        <div>
                          <p className="font-medium text-gray-900 font-mono text-sm">
                            {recipient.address}
                          </p>
                          <p className="text-sm text-gray-500">
                            Index: {recipient.index}
                          </p>
                        </div>
                        <div className="flex items-center space-x-3">
                          <span className="font-medium text-gray-900">
                            {(recipient.amount / 1e9).toFixed(2)} tokens
                          </span>
                          <button
                            onClick={() => removeRecipient(index)}
                            className="text-red-600 hover:text-red-700"
                          >
                            ❌
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 p-3 bg-blue-50 rounded-lg">
                    <p className="text-sm text-blue-800">
                      <strong>Total Airdrop Amount:</strong>{" "}
                      {(totalAirdropAmount / 1e9).toFixed(2)} tokens
                    </p>
                  </div>
                </div>
              )}

              <button
                onClick={createAirdrop}
                disabled={loading || airdropList.length === 0}
                className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-6 py-3 rounded-lg font-medium hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 flex items-center justify-center space-x-2"
              >
                {loading ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    <span>Creating Airdrop...</span>
                  </>
                ) : (
                  <>
                    <span>🎁</span>
                    <span>Create Airdrop</span>
                  </>
                )}
              </button>

              {claimForm.distributorAddress && (
                <div className="bg-blue-50 rounded-lg p-4 space-y-2">
                  <h4 className="font-medium text-blue-900">
                    Created Resources
                  </h4>
                  {claimForm.distributorAddress && (
                    <div className="text-sm">
                      <span className="text-blue-700 font-medium">
                        Distributor:
                      </span>
                      <span className="ml-2 text-blue-600 font-mono">
                        {claimForm.distributorAddress}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {activeTab === "claim" && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  Claim Your Tokens
                </h3>
                <p className="text-gray-600">
                  Claim tokens from an existing airdrop using your Merkle proof
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Distributor Address
                    </label>
                    <input
                      type="text"
                      value={claimForm.distributorAddress}
                      onChange={(e) =>
                        setClaimForm({
                          ...claimForm,
                          distributorAddress: e.target.value,
                        })
                      }
                      className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="Enter distributor address"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Token Mint
                    </label>
                    <input
                      type="text"
                      value={claimForm.tokenMint}
                      onChange={(e) =>
                        setClaimForm({
                          ...claimForm,
                          tokenMint: e.target.value,
                        })
                      }
                      className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="Enter token mint"
                    />
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Claim Index
                    </label>
                    <input
                      type="number"
                      value={claimForm.claimIndex}
                      onChange={(e) =>
                        setClaimForm({
                          ...claimForm,
                          claimIndex: parseInt(e.target.value),
                        })
                      }
                      className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="0"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Amount
                    </label>
                    <input
                      type="text"
                      value={claimForm.claimAmount}
                      onChange={(e) =>
                        setClaimForm({
                          ...claimForm,
                          claimAmount: e.target.value,
                        })
                      }
                      className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="Enter amount"
                    />
                  </div>
                </div>
              </div>

              <button
                onClick={claimTokens}
                disabled={loading}
                className="w-full bg-gradient-to-r from-green-600 to-emerald-600 text-white px-6 py-3 rounded-lg font-medium hover:from-green-700 hover:to-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 flex items-center justify-center space-x-2"
              >
                {loading ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    <span>Claiming Tokens...</span>
                  </>
                ) : (
                  <>
                    <span>💰</span>
                    <span>Claim Tokens</span>
                  </>
                )}
              </button>
            </div>
          )}

          {activeTab === "distributors" && (
            <div className="space-y-6">
              <div className="flex justify-between items-center">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">
                    On-Chain Distributors
                  </h3>
                  <p className="text-gray-600">
                    View all distributor accounts on the blockchain
                  </p>
                </div>
                <div className="flex items-center space-x-4">
                  <label className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      checked={autoRefresh}
                      onChange={(e) => setAutoRefresh(e.target.checked)}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-600">Auto-refresh</span>
                  </label>
                  <button
                    onClick={loadDistributors}
                    className="px-4 py-2 text-sm font-medium text-blue-600 hover:text-blue-700"
                  >
                    🔄 Refresh
                  </button>
                </div>
              </div>

              <div className="space-y-4">
                {distributors.map((distributor, index) => (
                  <div
                    key={index}
                    className="bg-gray-50 rounded-lg p-6 border border-gray-200 hover:shadow-md transition-shadow cursor-pointer"
                    onClick={() => {
                      setClaimForm({
                        ...claimForm,
                        distributorAddress: distributor.address.toString(),
                        tokenMint: distributor.data.tokenMint.toString(),
                      });
                      setActiveTab("claim");
                    }}
                  >
                    <div className="flex justify-between items-start mb-4">
                      <h4 className="font-semibold text-gray-900">
                        Distributor #{index + 1}
                      </h4>
                      <span className="px-2 py-1 bg-green-100 text-green-800 text-xs font-medium rounded-full">
                        Active
                      </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                      <div>
                        <span className="text-gray-500">Address:</span>
                        <p className="text-gray-900 font-mono break-all mt-1">
                          {distributor.address.toString()}
                        </p>
                      </div>
                      <div>
                        <span className="text-gray-500">Token Mint:</span>
                        <p className="text-gray-900 font-mono break-all mt-1">
                          {distributor.data.tokenMint.toString()}
                        </p>
                      </div>
                      <div>
                        <span className="text-gray-500">Total Supply:</span>
                        <p className="text-gray-900 font-medium mt-1">
                          {formatAmount(distributor.data.totalSupply)} tokens
                        </p>
                      </div>
                      <div>
                        <span className="text-gray-500">Authority:</span>
                        <p className="text-gray-900 font-mono break-all mt-1">
                          {distributor.data.authority.toString()}
                        </p>
                      </div>
                      <div>
                        <span className="text-gray-500">Merkle Root:</span>
                        <p className="text-gray-900 font-mono break-all mt-1">
                          {Buffer.from(distributor.data.merkleRoot).toString(
                            "hex"
                          )}
                        </p>
                      </div>
                      <div>
                        <span className="text-gray-500">Bump:</span>
                        <p className="text-gray-900 font-medium mt-1">
                          {distributor.data.bump}
                        </p>
                      </div>
                    </div>
                    <div className="mt-4 text-sm text-blue-600">
                      Click to use this distributor for claiming →
                    </div>
                  </div>
                ))}

                {distributors.length === 0 && (
                  <div className="text-center py-12">
                    <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                      <span className="text-2xl">📊</span>
                    </div>
                    <h4 className="text-lg font-medium text-gray-900 mb-2">
                      No Distributors Found
                    </h4>
                    <p className="text-gray-600">
                      Create your first airdrop to see distributors here
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === "recipients" && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  Airdrop Recipients
                </h3>
                <p className="text-gray-600">
                  View the list of recipients and their claim status
                </p>
              </div>

              <div className="space-y-3">
                {airdropList.map((item, index) => (
                  <div
                    key={index}
                    className="bg-white border border-gray-200 rounded-lg p-4 hover:shadow-sm transition-shadow"
                  >
                    <div className="flex justify-between items-center">
                      <div className="flex-1">
                        <div className="flex items-center space-x-3">
                          <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                            <span className="text-blue-600 font-medium text-sm">
                              {index + 1}
                            </span>
                          </div>
                          <div>
                            <p className="font-medium text-gray-900 font-mono">
                              {item.address}
                            </p>
                            <p className="text-sm text-gray-500">
                              Index: {item.index}
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="text-right">
                        <p className="font-semibold text-gray-900">
                          {(item.amount / 1e9).toFixed(2)} tokens
                        </p>
                        <p className="text-sm text-gray-500">
                          {item.amount.toLocaleString()}
                        </p>
                        {selectedDistributor && (
                          <span
                            className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium mt-1 ${
                              isClaimed(
                                selectedDistributor.claimedBitmap,
                                index
                              )
                                ? "bg-green-100 text-green-800"
                                : "bg-yellow-100 text-yellow-800"
                            }`}
                          >
                            {isClaimed(selectedDistributor.claimedBitmap, index)
                              ? "✅ Claimed"
                              : "⏳ Available"}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}

                {airdropList.length === 0 && (
                  <div className="text-center py-12">
                    <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                      <span className="text-2xl">👥</span>
                    </div>
                    <h4 className="text-lg font-medium text-gray-900 mb-2">
                      No Recipients Added
                    </h4>
                    <p className="text-gray-600">
                      Add recipients in the Create Airdrop tab to see them here
                    </p>
                  </div>
                )}
              </div>

              {selectedDistributor && (
                <div className="bg-blue-50 rounded-lg p-4">
                  <h4 className="font-medium text-blue-900 mb-2">
                    Selected Distributor Details
                  </h4>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-blue-700">Token Mint:</span>
                      <p className="text-blue-600 font-mono break-all">
                        {selectedDistributor.tokenMint.toString()}
                      </p>
                    </div>
                    <div>
                      <span className="text-blue-700">Total Supply:</span>
                      <p className="text-blue-600 font-medium">
                        {formatAmount(selectedDistributor.totalSupply)} tokens
                      </p>
                    </div>
                    <div className="col-span-2">
                      <span className="text-blue-700">Claimed Bitmap:</span>
                      <p className="text-blue-600 font-mono">
                        [{selectedDistributor.claimedBitmap.join(", ")}]
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AirdropPage;
