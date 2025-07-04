/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/airdropper_solana.json`.
 */
export type AirdropperSolana = {
  "address": "5zp47zmoPwVa55PXtP5kr7URsNRMUqnhiPLLnyo5M9AQ",
  "metadata": {
    "name": "airdropperSolana",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Created with Anchor"
  },
  "instructions": [
    {
      "name": "claim",
      "discriminator": [
        62,
        198,
        214,
        193,
        213,
        159,
        108,
        210
      ],
      "accounts": [
        {
          "name": "distributor",
          "writable": true
        },
        {
          "name": "distributorAuthority",
          "docs": [
            "CHECK"
          ],
          "writable": true
        },
        {
          "name": "distributorTokenAccount",
          "writable": true
        },
        {
          "name": "userTokenAccount",
          "writable": true
        },
        {
          "name": "tokenMint",
          "relations": [
            "distributor"
          ]
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "rent",
          "address": "SysvarRent111111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "index",
          "type": "u32"
        },
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "proof",
          "type": {
            "vec": {
              "array": [
                "u8",
                32
              ]
            }
          }
        }
      ]
    },
    {
      "name": "claimUserAirdrop",
      "discriminator": [
        227,
        231,
        105,
        96,
        126,
        54,
        249,
        186
      ],
      "accounts": [
        {
          "name": "distributor",
          "writable": true
        },
        {
          "name": "distributorAuthority",
          "docs": [
            "CHECK"
          ],
          "writable": true
        },
        {
          "name": "distributorTokenAccount",
          "writable": true
        },
        {
          "name": "userTokenAccount",
          "writable": true
        },
        {
          "name": "claimer",
          "writable": true,
          "signer": true
        },
        {
          "name": "tokenMint",
          "relations": [
            "distributor"
          ]
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "rent",
          "address": "SysvarRent111111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "index",
          "type": "u32"
        },
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "proof",
          "type": {
            "vec": {
              "array": [
                "u8",
                32
              ]
            }
          }
        }
      ]
    },
    {
      "name": "initialize",
      "discriminator": [
        175,
        175,
        109,
        31,
        13,
        152,
        155,
        237
      ],
      "accounts": [
        {
          "name": "distributor",
          "writable": true,
          "signer": true
        },
        {
          "name": "distributorAuthority",
          "docs": [
            "CHECK"
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  105,
                  115,
                  116,
                  114,
                  105,
                  98,
                  117,
                  116,
                  111,
                  114
                ]
              },
              {
                "kind": "arg",
                "path": "merkleRoot"
              }
            ]
          }
        },
        {
          "name": "distributorTokenAccount",
          "writable": true
        },
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "tokenMint"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "rent",
          "address": "SysvarRent111111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "merkleRoot",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "totalSupply",
          "type": "u128"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "distributor",
      "discriminator": [
        90,
        90,
        217,
        147,
        6,
        32,
        135,
        4
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "invalidMerkleRoot",
      "msg": "Invalid Merkle Root"
    },
    {
      "code": 6001,
      "name": "alreadyClaimed",
      "msg": "Already Claimed"
    }
  ],
  "types": [
    {
      "name": "distributor",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "merkleRoot",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "tokenMint",
            "type": "pubkey"
          },
          {
            "name": "totalSupply",
            "type": "u128"
          },
          {
            "name": "claimedBitmap",
            "type": {
              "array": [
                "u8",
                2
              ]
            }
          },
          {
            "name": "authority",
            "type": "pubkey"
          }
        ]
      }
    }
  ]
};
