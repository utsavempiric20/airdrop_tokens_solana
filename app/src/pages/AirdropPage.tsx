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
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddress,
  createInitializeMintInstruction,
  MintLayout,
  createMintToInstruction,
  getAccount,
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

type TabType =
  | "create"
  | "claim"
  | "distributors"
  | "recipients"
  | "bulk"
  | "claimed"
  | "stored";

interface Recipient {
  address: string;
  amount: number;
  index: number;
}

interface ClaimedRecipient {
  address: string;
  amount: number;
  index: number;
  distributor: string;
  tokenMint: string;
  claimedAt: Date;
}

interface StoredAirdropData {
  distributorAddress: string;
  tokenMint: string;
  recipients: Recipient[];
  vaultTokenAccount?: string;
  merkleRoot?: string;
  createdAt: string;
  recipientTokenAccounts: { address: string; tokenAccount: string }[];
}

const keccak256 = (data: Buffer): Buffer => Buffer.from(keccak_256(data));

async function accountExists(
  conn: anchor.web3.Connection,
  address: PublicKey
): Promise<boolean> {
  return (await conn.getAccountInfo(address)) !== null;
}

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
  const [claimedRecipients, setClaimedRecipients] = useState<
    ClaimedRecipient[]
  >([]);
  const [_csvFile, setCsvFile] = useState<File | null>(null);
  const [bulkForm, setBulkForm] = useState({
    tokenName: "",
    tokenSymbol: "",
    totalSupply: "",
  });

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

  useEffect(() => {
    const savedAirdropList = localStorage.getItem("airdropList");
    if (savedAirdropList) {
      try {
        setAirdropList(JSON.parse(savedAirdropList));
      } catch (error) {
        console.error("Error loading airdrop list from localStorage:", error);
      }
    }
  }, []);

  useEffect(() => {
    if (airdropList.length > 0) {
      localStorage.setItem("airdropList", JSON.stringify(airdropList));
    }
  }, [airdropList]);

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

  const handleCsvUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setCsvFile(file);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const lines = text.split("\n").filter((line) => line.trim());
      const recipients: Recipient[] = [];

      lines.forEach((line, index) => {
        if (index === 0) return;
        const [address, amount] = line.split(",").map((s) => s.trim());
        const amountInLamports = parseFloat(amount) * 1e9;
        if (address && amount) {
          recipients.push({
            address,
            amount: amountInLamports,
            index: recipients.length,
          });
        }
      });

      setAirdropList(recipients);
      setStatus(`✅ Loaded ${recipients.length} recipients from CSV`);
    };
    reader.readAsText(file);
  };

  const handleTextUpload = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = event.target.value;
    const lines = text.split("\n").filter((line) => line.trim());
    const recipients: Recipient[] = [];

    lines.forEach((line) => {
      const [address, amount] = line.split(",").map((s) => s.trim());
      if (address && amount) {
        const amountInLamports = parseFloat(amount) * 1e9;
        recipients.push({
          address,
          amount: amountInLamports,
          index: recipients.length,
        });
      }
    });

    setAirdropList(recipients);
    setStatus(`✅ Loaded ${recipients.length} recipients from text`);
  };

  const saveAirdropData = (
    distributorAddress: string,
    tokenMint: string,
    recipients: Recipient[],
    vaultTokenAccount?: string,
    merkleRoot?: string
  ) => {
    const airdropData = {
      distributorAddress,
      tokenMint,
      recipients,
      vaultTokenAccount,
      merkleRoot,
      createdAt: new Date().toISOString(),
    };

    const existingData = localStorage.getItem("airdropData");
    const airdropDataList = existingData ? JSON.parse(existingData) : [];
    airdropDataList.push(airdropData);
    localStorage.setItem("airdropData", JSON.stringify(airdropDataList));

    setAirdropList(recipients);
  };

  const createBulkAirdrop = async () => {
    if (!publicKey) {
      setStatus("❌ Please connect your wallet");
      return;
    }

    if (!signTransaction) {
      setStatus("❌ Wallet not properly connected");
      return;
    }

    if (airdropList.length === 0) {
      setStatus("❌ Please add recipients first");
      return;
    }

    if (!bulkForm.tokenName || !bulkForm.tokenSymbol || !bulkForm.totalSupply) {
      setStatus("❌ Please fill in all token details");
      return;
    }

    setLoading(true);
    setStatus("🔄 Creating bulk airdrop...");

    try {
      const provider = getProvider();
      const program = getProgram(provider);

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

      console.log("airdropList : ", airdropList);
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

      const userAta = await getAssociatedTokenAddress(
        mintKeypair.publicKey,
        publicKey
      );

      const totalSupply =
        parseFloat(bulkForm.totalSupply) * 1e9 || 1000000000000;

      const combinedTx = new Transaction().add(
        // Create user ATA
        createAssociatedTokenAccountInstruction(
          publicKey,
          userAta,
          publicKey,
          mintKeypair.publicKey
        ),
        // Create vault ATA
        createAssociatedTokenAccountInstruction(
          publicKey,
          vaultTokenAccount,
          vaultAuthority,
          mintKeypair.publicKey,
          TOKEN_PROGRAM_ID,
          anchor.utils.token.ASSOCIATED_PROGRAM_ID
        ),
        // Mint to user ATA
        createMintToInstruction(
          mintKeypair.publicKey,
          userAta,
          publicKey,
          BigInt(totalSupply)
        ),
        // Mint to vault ATA
        createMintToInstruction(
          mintKeypair.publicKey,
          vaultTokenAccount,
          publicKey,
          BigInt(totalSupply)
        )
      );
      combinedTx.feePayer = publicKey;
      const recentBlockhashCombined = await connection.getLatestBlockhash();
      combinedTx.recentBlockhash = recentBlockhashCombined.blockhash;
      combinedTx.lastValidBlockHeight =
        recentBlockhashCombined.lastValidBlockHeight;

      signed = await signTransaction(combinedTx);
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

      setStatus("✅ Bulk airdrop created successfully!");
      setClaimForm({
        ...claimForm,
        distributorAddress: distributor.publicKey.toString(),
        tokenMint: mintKeypair.publicKey.toString(),
      });

      saveAirdropData(
        distributor.publicKey.toString(),
        mintKeypair.publicKey.toString(),
        airdropList,
        vaultTokenAccount.toString(),
        root
      );

      await loadDistributors();
      setActiveTab("distributors");
    } catch (error) {
      console.error("Error creating bulk airdrop:", error);
      setStatus(
        `❌ Error: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      setLoading(false);
    }
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

      console.log("airdropList : ", airdropList);
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

      const userAta = await getAssociatedTokenAddress(
        mintKeypair.publicKey,
        publicKey
      );

      const totalSupply =
        parseFloat(createForm.totalSupply) * 1e9 || 1000000000000;

      const combinedTx = new Transaction().add(
        // Create user ATA
        createAssociatedTokenAccountInstruction(
          publicKey,
          userAta,
          publicKey,
          mintKeypair.publicKey
        ),
        // Create vault ATA
        createAssociatedTokenAccountInstruction(
          publicKey,
          vaultTokenAccount,
          vaultAuthority,
          mintKeypair.publicKey,
          TOKEN_PROGRAM_ID,
          anchor.utils.token.ASSOCIATED_PROGRAM_ID
        ),
        // Mint to user ATA
        createMintToInstruction(
          mintKeypair.publicKey,
          userAta,
          publicKey,
          BigInt(totalSupply)
        ),
        // Mint to vault ATA
        createMintToInstruction(
          mintKeypair.publicKey,
          vaultTokenAccount,
          publicKey,
          BigInt(totalSupply)
        )
      );
      combinedTx.feePayer = publicKey;
      const recentBlockhashCombined = await connection.getLatestBlockhash();
      combinedTx.recentBlockhash = recentBlockhashCombined.blockhash;
      combinedTx.lastValidBlockHeight =
        recentBlockhashCombined.lastValidBlockHeight;

      signed = await signTransaction(combinedTx);
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

      saveAirdropData(
        distributor.publicKey.toString(),
        mintKeypair.publicKey.toString(),
        airdropList,
        vaultTokenAccount.toString(),
        root
      );

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
    let vaultTokenAccount: any;

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

      try {
        const distributorAccount = await getDistributorAccount(
          connection,
          new PublicKey(claimForm.distributorAddress)
        );

        if (!distributorAccount) {
          setStatus("❌ Distributor account not found or not initialized");
          return;
        }

        try {
          const distributorTokenAccountInfo = await getAccount(
            connection,
            distributorAccount.vault,
            "confirmed"
          );
          vaultTokenAccount = distributorTokenAccountInfo.address.toString();
          console.log(
            "distributorTokenAccountInfo : ",
            distributorTokenAccountInfo.address.toString()
          );
        } catch (error) {
          console.log("Distributor vault account not found:", error);
          setStatus(
            "❌ Distributor vault account not found. Please create a new airdrop first."
          );
          return;
        }
      } catch (error) {
        setStatus("❌ Distributor account not found or not initialized");
        return;
      }

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

      const recipientAta = await anchor.utils.token.associatedAddress({
        mint: new PublicKey(claimForm.tokenMint),
        owner: publicKey,
      });

      try {
        const recipientAtaExists = await accountExists(
          connection,
          recipientAta
        );
        if (!recipientAtaExists) {
          const createAtaTxVault = new Transaction().add(
            createAssociatedTokenAccountInstruction(
              publicKey,
              recipientAta,
              publicKey,
              new PublicKey(claimForm.tokenMint),
              TOKEN_PROGRAM_ID,
              anchor.utils.token.ASSOCIATED_PROGRAM_ID
            )
          );
          createAtaTxVault.feePayer = publicKey;
          const recentBlockhashATAV = await connection.getLatestBlockhash();
          createAtaTxVault.recentBlockhash = recentBlockhashATAV.blockhash;
          createAtaTxVault.lastValidBlockHeight =
            recentBlockhashATAV.lastValidBlockHeight;

          let signed = await signTransaction(createAtaTxVault);
          let txid = await connection.sendRawTransaction(signed.serialize());
          await connection.confirmTransaction(txid, "confirmed");
          console.log("ATA created successfully");
        } else {
          console.log("ATA already exists");
        }
      } catch (error) {
        console.log("ATA already exists or creation failed:", error);
      }

      const leaf = leaves[claimForm.claimIndex];
      console.log("recipientAta : ", recipientAta.toString());

      const proof = tree.getProof(leaf).map((x) => Array.from(x.data));
      const totalAmt = parseFloat(claimForm.claimAmount) * 1e9;

      const claimAmountBN = new anchor.BN(totalAmt);

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

      const recipientAccount = {
        address: publicKey.toString(),
        tokenAccount: recipientAta.toString(),
      };

      const existingRecipientAccounts = localStorage.getItem(
        "recipientTokenAccounts"
      );
      const recipientAccountsList = existingRecipientAccounts
        ? JSON.parse(existingRecipientAccounts)
        : [];

      const existingIndex = recipientAccountsList.findIndex(
        (item: any) => item.distributorAddress === claimForm.distributorAddress
      );

      if (existingIndex >= 0) {
        const existingAccounts =
          recipientAccountsList[existingIndex].recipientAccounts;
        const accountExists = existingAccounts.some(
          (acc: any) => acc.address === recipientAccount.address
        );
        if (!accountExists) {
          existingAccounts.push(recipientAccount);
        }
      } else {
        recipientAccountsList.push({
          distributorAddress: claimForm.distributorAddress,
          recipientAccounts: [recipientAccount],
          updatedAt: new Date().toISOString(),
        });
      }

      localStorage.setItem(
        "recipientTokenAccounts",
        JSON.stringify(recipientAccountsList)
      );

      const claimedRecipient = airdropList[claimForm.claimIndex];
      if (claimedRecipient) {
        trackClaimedRecipient(
          claimedRecipient.address,
          claimedRecipient.amount,
          claimForm.claimIndex,
          claimForm.distributorAddress,
          claimForm.tokenMint
        );
      }

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

  const trackClaimedRecipient = (
    address: string,
    amount: number,
    index: number,
    distributor: string,
    tokenMint: string
  ) => {
    const claimedRecipient: ClaimedRecipient = {
      address,
      amount,
      index,
      distributor,
      tokenMint,
      claimedAt: new Date(),
    };
    setClaimedRecipients((prev) => [...prev, claimedRecipient]);
  };

  const loadAirdropDataForDistributor = (distributorAddress: string) => {
    const airdropData = localStorage.getItem("airdropData");
    if (airdropData) {
      try {
        const airdropDataList = JSON.parse(airdropData);
        const matchingAirdrop = airdropDataList.find(
          (airdrop: any) => airdrop.distributorAddress === distributorAddress
        );

        if (matchingAirdrop) {
          setAirdropList(matchingAirdrop.recipients);
          console.log(
            "Loaded recipients for distributor:",
            matchingAirdrop.recipients.length
          );
          console.log(
            "Vault token account:",
            matchingAirdrop.vaultTokenAccount
          );
          console.log("Merkle root:", matchingAirdrop.merkleRoot);

          const recipientAccountsData = localStorage.getItem(
            "recipientTokenAccounts"
          );
          if (recipientAccountsData) {
            const recipientAccountsList = JSON.parse(recipientAccountsData);
            const matchingRecipientAccounts = recipientAccountsList.find(
              (item: any) => item.distributorAddress === distributorAddress
            );
            if (matchingRecipientAccounts) {
              console.log(
                "Recipient token accounts:",
                matchingRecipientAccounts.recipientAccounts
              );
            }
          }
        }
      } catch (error) {
        console.error("Error loading airdrop data:", error);
      }
    }
  };

  const getAllStoredAirdropData = (): StoredAirdropData[] => {
    const airdropData = localStorage.getItem("airdropData");
    const recipientAccountsData = localStorage.getItem(
      "recipientTokenAccounts"
    );

    const airdropDataList = airdropData ? JSON.parse(airdropData) : [];
    const recipientAccountsList = recipientAccountsData
      ? JSON.parse(recipientAccountsData)
      : [];

    return airdropDataList.map((airdrop: any) => {
      const matchingRecipientAccounts = recipientAccountsList.find(
        (item: any) => item.distributorAddress === airdrop.distributorAddress
      );

      return {
        ...airdrop,
        recipientTokenAccounts:
          matchingRecipientAccounts?.recipientAccounts || [],
      };
    });
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
      loadAirdropDataForDistributor(claimForm.distributorAddress);
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
    { id: "bulk", label: "Bulk Upload", icon: "📁" },
    { id: "claimed", label: "Claimed", icon: "✅" },
    { id: "stored", label: "Stored Data", icon: "💾" },
  ];

  return (
    <div className="space-y-4 sm:space-y-6 px-4 sm:px-6 lg:px-8">
      {status && (
        <div
          className={`p-3 sm:p-4 rounded-lg border text-sm sm:text-base ${
            status.includes("✅")
              ? "bg-green-50 border-green-200 text-green-800"
              : status.includes("❌")
              ? "bg-red-50 border-red-200 text-red-800"
              : "bg-blue-50 border-blue-200 text-blue-800"
          }`}
        >
          <p className="font-medium break-words">{status}</p>
        </div>
      )}

      {!isWalletConnected && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 sm:p-4">
          <div className="flex items-start sm:items-center">
            <div className="flex-shrink-0 mt-0.5 sm:mt-0">
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

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="border-b border-gray-200 overflow-x-auto">
          <nav
            className="flex space-x-2 sm:space-x-4 lg:space-x-8 px-3 sm:px-6"
            aria-label="Tabs"
          >
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as TabType)}
                className={`py-3 sm:py-4 px-1 border-b-2 font-medium text-xs sm:text-sm flex items-center space-x-1 sm:space-x-2 transition-colors whitespace-nowrap ${
                  activeTab === tab.id
                    ? "border-blue-500 text-blue-600"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                }`}
              >
                <span className="text-sm sm:text-base">{tab.icon}</span>
                <span className="hidden sm:inline">{tab.label}</span>
                <span className="sm:hidden">{tab.label.split(" ")[0]}</span>
              </button>
            ))}
          </nav>
        </div>

        <div className="p-4 sm:p-6 lg:p-8">
          {activeTab === "create" && (
            <div className="space-y-4 sm:space-y-6">
              <div>
                <h3 className="text-lg sm:text-xl font-semibold text-gray-900 mb-2">
                  Create New Airdrop
                </h3>
                <p className="text-sm sm:text-base text-gray-600">
                  Create a new token airdrop with Merkle tree verification
                </p>
              </div>

              <div className="bg-gray-50 rounded-lg p-4 sm:p-6">
                <h4 className="font-medium text-gray-900 mb-4">
                  Token Details
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
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
                      className="w-full p-2 sm:p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm sm:text-base"
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
                      className="w-full p-2 sm:p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm sm:text-base"
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
                      className="w-full p-2 sm:p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm sm:text-base"
                      placeholder="1000000"
                    />
                  </div>
                </div>
              </div>

              <div className="bg-gray-50 rounded-lg p-4 sm:p-6">
                <h4 className="font-medium text-gray-900 mb-4">
                  Add Recipients
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 mb-4">
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
                      className="w-full p-2 sm:p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm sm:text-base"
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
                      className="w-full p-2 sm:p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm sm:text-base"
                      placeholder="100"
                    />
                  </div>
                </div>
                <button
                  onClick={addRecipient}
                  className="bg-blue-600 text-white px-3 sm:px-4 py-2 sm:py-3 rounded-lg hover:bg-blue-700 transition-colors text-sm sm:text-base"
                >
                  ➕ Add Recipient
                </button>
              </div>

              {airdropList.length > 0 && (
                <div className="bg-white border border-gray-200 rounded-lg p-4 sm:p-6">
                  <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center mb-4 space-y-2 sm:space-y-0">
                    <h4 className="font-medium text-gray-900">
                      Recipients ({airdropList.length})
                    </h4>
                    <button
                      onClick={clearRecipients}
                      className="text-red-600 hover:text-red-700 text-sm font-medium self-start sm:self-auto"
                    >
                      🗑️ Clear All
                    </button>
                  </div>
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {airdropList.map((recipient, index) => (
                      <div
                        key={index}
                        className="flex flex-col sm:flex-row sm:justify-between sm:items-center p-3 bg-gray-50 rounded-lg space-y-2 sm:space-y-0"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-gray-900 font-mono text-xs sm:text-sm break-all">
                            {recipient.address}
                          </p>
                          <p className="text-xs sm:text-sm text-gray-500">
                            Index: {recipient.index}
                          </p>
                        </div>
                        <div className="flex items-center space-x-3">
                          <span className="font-medium text-gray-900 text-sm sm:text-base">
                            {(recipient.amount / 1e9).toFixed(2)} tokens
                          </span>
                          <button
                            onClick={() => removeRecipient(index)}
                            className="text-red-600 hover:text-red-700 text-sm sm:text-base"
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
                className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-4 sm:px-6 py-3 sm:py-4 rounded-lg font-medium hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 flex items-center justify-center space-x-2 text-sm sm:text-base"
              >
                {loading ? (
                  <>
                    <div className="w-4 h-4 sm:w-5 sm:h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
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
                      const distributorAddress = distributor.address.toString();
                      setClaimForm({
                        ...claimForm,
                        distributorAddress,
                        tokenMint: distributor.data.tokenMint.toString(),
                        claimIndex: 0,
                      });
                      loadAirdropDataForDistributor(distributorAddress);
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

          {activeTab === "bulk" && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  Bulk Airdrop Upload
                </h3>
                <p className="text-gray-600">
                  Upload CSV file or paste text to create bulk airdrops
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
                      value={bulkForm.tokenName}
                      onChange={(e) =>
                        setBulkForm({
                          ...bulkForm,
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
                      value={bulkForm.tokenSymbol}
                      onChange={(e) =>
                        setBulkForm({
                          ...bulkForm,
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
                      value={bulkForm.totalSupply}
                      onChange={(e) =>
                        setBulkForm({
                          ...bulkForm,
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
                  Upload CSV File
                </h4>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      CSV File (address,amount format)
                    </label>
                    <input
                      type="file"
                      accept=".csv"
                      onChange={handleCsvUpload}
                      className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                  <div className="text-sm text-gray-600">
                    <p>CSV format: address,amount (one per line)</p>
                    <p>Example:</p>
                    <pre className="bg-gray-100 p-2 rounded text-xs">
                      address,amount{"\n"}
                      HQmsmTXzUymb5o383iTNccakfF4f2AzwUy4uzBuUfCbG,100{"\n"}
                      7j5N9EEPWE9J2EZh9TeVCpoprbQRYr98kTsBpzpR7hwf,250
                    </pre>
                  </div>
                </div>
              </div>

              <div className="bg-gray-50 rounded-lg p-6">
                <h4 className="font-medium text-gray-900 mb-4">
                  Or Paste Text
                </h4>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Address,Amount (one per line)
                  </label>
                  <textarea
                    onChange={handleTextUpload}
                    className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent h-32"
                    placeholder="HQmsmTXzUymb5o383iTNccakfF4f2AzwUy4uzBuUfCbG,100&#10;7j5N9EEPWE9J2EZh9TeVCpoprbQRYr98kTsBpzpR7hwf,250"
                  />
                </div>
              </div>

              {airdropList.length > 0 && (
                <div className="bg-white border border-gray-200 rounded-lg p-6">
                  <div className="flex justify-between items-center mb-4">
                    <h4 className="font-medium text-gray-900">
                      Bulk Recipients ({airdropList.length})
                    </h4>
                    <button
                      onClick={() => setAirdropList([])}
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
                            Index: {index}
                          </p>
                        </div>
                        <div className="text-right">
                          <span className="font-medium text-gray-900">
                            {(recipient.amount / 1e9).toFixed(2)} tokens
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 p-3 bg-blue-50 rounded-lg">
                    <p className="text-sm text-blue-800">
                      <strong>Total Bulk Amount:</strong>{" "}
                      {(
                        airdropList.reduce(
                          (sum, item) => sum + item.amount,
                          0
                        ) / 1e9
                      ).toFixed(2)}{" "}
                      tokens
                    </p>
                  </div>
                </div>
              )}

              <button
                onClick={createBulkAirdrop}
                disabled={loading || airdropList.length === 0}
                className="w-full bg-gradient-to-r from-purple-600 to-pink-600 text-white px-6 py-3 rounded-lg font-medium hover:from-purple-700 hover:to-pink-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 flex items-center justify-center space-x-2"
              >
                {loading ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    <span>Creating Bulk Airdrop...</span>
                  </>
                ) : (
                  <>
                    <span>📁</span>
                    <span>Create Bulk Airdrop</span>
                  </>
                )}
              </button>
            </div>
          )}

          {activeTab === "claimed" && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  Claimed Recipients
                </h3>
                <p className="text-gray-600">
                  View all recipients who have claimed their tokens
                </p>
              </div>

              <div className="space-y-3">
                {claimedRecipients.map((recipient, index) => (
                  <div
                    key={index}
                    className="bg-white border border-gray-200 rounded-lg p-4 hover:shadow-sm transition-shadow"
                  >
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <div className="flex items-center space-x-3">
                          <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center">
                            <span className="text-green-600 font-medium text-sm">
                              ✅
                            </span>
                          </div>
                          <div>
                            <p className="font-medium text-gray-900 font-mono">
                              {recipient.address}
                            </p>
                            <p className="text-sm text-gray-500">
                              Index: {recipient.index}
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="text-right">
                        <p className="font-semibold text-gray-900">
                          {(recipient.amount / 1e9).toFixed(2)} tokens
                        </p>
                        <p className="text-sm text-gray-500">
                          {recipient.claimedAt.toLocaleString()}
                        </p>
                        <div className="mt-2 space-y-1">
                          <p className="text-xs text-gray-500">
                            Distributor: {recipient.distributor}
                          </p>
                          <p className="text-xs text-gray-500">
                            Token: {recipient.tokenMint}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}

                {claimedRecipients.length === 0 && (
                  <div className="text-center py-12">
                    <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                      <span className="text-2xl">✅</span>
                    </div>
                    <h4 className="text-lg font-medium text-gray-900 mb-2">
                      No Claims Yet
                    </h4>
                    <p className="text-gray-600">
                      Claims will appear here once recipients claim their tokens
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === "stored" && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  Stored Airdrop Data
                </h3>
                <p className="text-gray-600">
                  View all airdrop data that has been saved to localStorage
                </p>
              </div>

              <div className="space-y-3">
                {getAllStoredAirdropData().map(
                  (airdrop: StoredAirdropData, index: number) => (
                    <div
                      key={index}
                      className="bg-white border border-gray-200 rounded-lg p-4 hover:shadow-sm transition-shadow cursor-pointer"
                      onClick={() => {
                        setAirdropList(airdrop.recipients);
                        setClaimForm({
                          ...claimForm,
                          distributorAddress: airdrop.distributorAddress,
                          tokenMint: airdrop.tokenMint,
                          claimIndex: 0,
                        });
                        setActiveTab("recipients");
                        setStatus(
                          `✅ Loaded ${
                            airdrop.recipients.length
                          } recipients for distributor ${airdrop.distributorAddress.slice(
                            0,
                            8
                          )}...`
                        );
                      }}
                    >
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <div className="flex items-center space-x-3">
                            <div className="w-8 h-8 bg-purple-100 rounded-full flex items-center justify-center">
                              <span className="text-purple-600 font-medium text-sm">
                                💾
                              </span>
                            </div>
                            <div>
                              <p className="font-medium text-gray-900 font-mono">
                                Distributor: {airdrop.distributorAddress}
                              </p>
                              <p className="text-sm text-gray-500">
                                Token Mint: {airdrop.tokenMint}
                              </p>
                              <p className="text-sm text-gray-500">
                                Created At:{" "}
                                {new Date(
                                  airdrop.createdAt
                                ).toLocaleDateString()}
                              </p>
                            </div>
                          </div>
                        </div>

                        <div className="text-right">
                          <p className="font-semibold text-gray-900">
                            Recipients: {airdrop.recipients.length}
                          </p>
                          <p className="text-sm text-gray-500">
                            Total Amount:{" "}
                            {(
                              airdrop.recipients.reduce(
                                (sum: number, r: Recipient) => sum + r.amount,
                                0
                              ) / 1e9
                            ).toFixed(2)}{" "}
                            tokens
                          </p>
                          <p className="text-sm text-gray-500">
                            Vault Token Account:{" "}
                            {airdrop.vaultTokenAccount || "N/A"}
                          </p>
                          <p className="text-sm text-gray-500">
                            Merkle Root:{" "}
                            {airdrop.merkleRoot
                              ? Buffer.from(airdrop.merkleRoot, "hex").toString(
                                  "hex"
                                )
                              : "N/A"}
                          </p>
                        </div>
                      </div>
                      <div className="mt-2 text-sm text-blue-600">
                        Click to load recipients for this airdrop
                      </div>

                      {airdrop.merkleRoot && (
                        <div className="mt-3 p-3 bg-blue-50 rounded-lg">
                          <h5 className="font-medium text-blue-900 mb-2">
                            Merkle Root Details
                          </h5>
                          <div className="text-xs bg-white p-2 rounded border font-mono text-gray-700">
                            <div className="break-all">
                              {airdrop.merkleRoot}
                            </div>
                          </div>
                        </div>
                      )}

                      {airdrop.recipientTokenAccounts.length > 0 && (
                        <div className="mt-3 p-3 bg-gray-50 rounded-lg">
                          <h5 className="font-medium text-gray-900 mb-2">
                            Recipient Token Accounts (
                            {airdrop.recipientTokenAccounts.length})
                          </h5>
                          <div className="space-y-2 max-h-32 overflow-y-auto">
                            {airdrop.recipientTokenAccounts.map(
                              (account, accIndex) => (
                                <div
                                  key={accIndex}
                                  className="text-xs bg-white p-2 rounded border"
                                >
                                  <div className="font-mono text-gray-700">
                                    <div>Address: {account.address}</div>
                                    <div>
                                      Token Account: {account.tokenAccount}
                                    </div>
                                  </div>
                                </div>
                              )
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                )}

                {getAllStoredAirdropData().length === 0 && (
                  <div className="text-center py-12">
                    <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                      <span className="text-2xl">💾</span>
                    </div>
                    <h4 className="text-lg font-medium text-gray-900 mb-2">
                      No Stored Airdrop Data Found
                    </h4>
                    <p className="text-gray-600">
                      Create and claim airdrops to see them here
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AirdropPage;
