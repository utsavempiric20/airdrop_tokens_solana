#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;
use anchor_spl::{ associated_token::AssociatedToken, token::{ Mint, Token, TokenAccount } };
use std::mem::size_of;

declare_id!("5zp47zmoPwVa55PXtP5kr7URsNRMUqnhiPLLnyo5M9AQ");
pub const MAX_LEAVES: usize = 10;
pub const BITMAP_BYTES: usize = (MAX_LEAVES + 7) / 8;

#[program]
pub mod airdropper_solana {
    use anchor_lang::solana_program::keccak::hashv;
    use anchor_spl::token::{ transfer, Transfer };

    use super::*;

    pub fn initialize(
        ctx: Context<InitializeDistributor>,
        merkle_root: [u8; 32],
        total_supply: u128
    ) -> Result<()> {
        let distributor = &mut ctx.accounts.distributor;
        let (_key, bump) = Pubkey::find_program_address(
            &[b"distributor", merkle_root.as_ref()],
            ctx.program_id
        );
        distributor.merkle_root = merkle_root;
        distributor.vault = ctx.accounts.distributor_token_account.key();
        distributor.token_mint = ctx.accounts.token_mint.key();
        distributor.total_supply = total_supply;
        distributor.claimed_bitmap = [0u8; BITMAP_BYTES];
        distributor.bump = bump;
        distributor.authority = ctx.accounts.distributor_authority.key();
        Ok(())
    }

    pub fn claim(ctx: Context<Claim>, index: u32, amount: u64, proof: Vec<[u8; 32]>) -> Result<()> {
        let distributor = &mut ctx.accounts.distributor;

        let leaf = hashv(
            &[
                &index.to_le_bytes(),
                ctx.accounts.user_token_account.owner.as_ref(),
                &amount.to_le_bytes(),
            ]
        ).0;

        let mut computed = leaf;
        for sibling in proof.iter() {
            let (l, r) = if computed <= *sibling {
                (computed, *sibling)
            } else {
                (*sibling, computed)
            };
            computed = hashv(&[&l, &r]).0;
        }
        require!(computed == distributor.merkle_root, AirdropError::InvalidMerkleRoot);

        let byte_index = (index / 8) as usize;
        let bitmask = 1 << index % 8;

        let claimed = (distributor.claimed_bitmap[byte_index] & bitmask) != 0;
        require!(!claimed, AirdropError::AlreadyClaimed);
        distributor.claimed_bitmap[byte_index] |= bitmask;

        let binding = distributor.merkle_root;
        let vault_seeds = &[b"distributor", binding.as_ref(), &[distributor.bump]];
        let seeds = &[&vault_seeds[..]];
        let cpi_accounts = Transfer {
            from: ctx.accounts.distributor_token_account.to_account_info(),
            to: ctx.accounts.user_token_account.to_account_info(),
            authority: ctx.accounts.distributor_authority.to_account_info(),
        };

        transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                cpi_accounts,
                seeds
            ),
            amount
        )?;

        Ok(())
    }
}

#[account]
pub struct Distributor {
    pub merkle_root: [u8; 32],
    pub vault: Pubkey,
    pub bump: u8,
    pub token_mint: Pubkey,
    pub total_supply: u128,
    pub claimed_bitmap: [u8; BITMAP_BYTES],
    pub authority: Pubkey,
}

#[derive(Accounts)]
#[instruction(merkle_root:[u8;32])]
pub struct InitializeDistributor<'info> {
    #[account(init, space = 8 + size_of::<Distributor>() + BITMAP_BYTES, payer = payer)]
    pub distributor: Account<'info, Distributor>,

    /// CHECK
    #[account(seeds = [b"distributor", merkle_root.as_ref()], bump)]
    pub distributor_authority: UncheckedAccount<'info>,

    #[account(mut, constraint = distributor_token_account.owner == distributor_authority.key())]
    pub distributor_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub token_mint: Account<'info, Mint>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut, has_one = token_mint)]
    pub distributor: Account<'info, Distributor>,

    /// CHECK
    #[account(mut)]
    pub distributor_authority: UncheckedAccount<'info>,

    #[account(mut)]
    pub distributor_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,

    pub token_mint: Account<'info, Mint>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[error_code]
pub enum AirdropError {
    #[msg("Invalid Merkle Root")]
    InvalidMerkleRoot,
    #[msg("Already Claimed")]
    AlreadyClaimed,
}
