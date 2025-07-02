use anchor_lang::prelude::*;

declare_id!("3skgrkCMK7ntA99KBJGaTB5DWHpyrT3QgzCkVyGcHGtb");

#[program]
pub mod airdropper_solana {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
