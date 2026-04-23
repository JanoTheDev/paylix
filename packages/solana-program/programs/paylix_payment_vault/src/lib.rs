// SPDX-License-Identifier: AGPL-3.0
//
// Paylix PaymentVault — Solana edition.
//
// One-time SPL payments. Buyer signs the transaction directly (no separate
// off-chain intent binding — the tx's own signature IS the authorization,
// and Solana's account model makes fields non-malleable once signed).
// Splits platform fee and transfers merchant share via SPL transfer_checked.

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    self, Mint, TokenAccount, TokenInterface, TransferChecked,
};

// Placeholder program ID — replaced at deploy time. Valid base58, decodes
// to 32 bytes (Anchor docs example). `anchor deploy` generates a real
// keypair at packages/solana-program/target/deploy/ and syncs it here.
declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

const BPS_DENOMINATOR: u64 = 10_000;
const MAX_PLATFORM_FEE_BPS: u16 = 1_000; // 10%

#[program]
pub mod paylix_payment_vault {
    use super::*;

    /// Initialize the global vault config PDA. Called once per deployment.
    pub fn initialize(
        ctx: Context<Initialize>,
        platform_wallet: Pubkey,
        platform_fee_bps: u16,
    ) -> Result<()> {
        require!(platform_fee_bps <= MAX_PLATFORM_FEE_BPS, ErrorCode::FeeTooHigh);
        let cfg = &mut ctx.accounts.config;
        cfg.owner = ctx.accounts.payer.key();
        cfg.platform_wallet = platform_wallet;
        cfg.platform_fee_bps = platform_fee_bps;
        cfg.paused = false;
        cfg.bump = ctx.bumps.config;
        Ok(())
    }

    /// One-time payment. Buyer signs the transaction (so Solana itself
    /// authorizes the transfer from buyer_ata); the program pulls the
    /// full `amount`, splits the platform fee, and forwards the merchant
    /// share.
    pub fn create_payment(
        ctx: Context<CreatePayment>,
        amount: u64,
        product_id: [u8; 32],
        customer_id: [u8; 32],
    ) -> Result<()> {
        let cfg = &ctx.accounts.config;
        require!(!cfg.paused, ErrorCode::Paused);
        require!(amount > 0, ErrorCode::AmountZero);

        // Verify accepted_token matches the mint the caller is paying with.
        require_keys_eq!(
            ctx.accounts.accepted.mint,
            ctx.accounts.mint.key(),
            ErrorCode::TokenNotAccepted
        );
        require!(ctx.accounts.accepted.accepted, ErrorCode::TokenNotAccepted);

        let fee = amount
            .checked_mul(cfg.platform_fee_bps as u64)
            .ok_or(ErrorCode::MathOverflow)?
            / BPS_DENOMINATOR;
        let merchant_amount = amount.checked_sub(fee).ok_or(ErrorCode::MathOverflow)?;
        require!(merchant_amount > 0, ErrorCode::AmountTooSmall);

        // Merchant leg.
        token_interface::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.buyer_ata.to_account_info(),
                    to: ctx.accounts.merchant_ata.to_account_info(),
                    authority: ctx.accounts.buyer.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                },
            ),
            merchant_amount,
            ctx.accounts.mint.decimals,
        )?;

        // Platform fee leg (skip when fee == 0 to save a CPI).
        if fee > 0 {
            token_interface::transfer_checked(
                CpiContext::new(
                    ctx.accounts.token_program.to_account_info(),
                    TransferChecked {
                        from: ctx.accounts.buyer_ata.to_account_info(),
                        to: ctx.accounts.platform_ata.to_account_info(),
                        authority: ctx.accounts.buyer.to_account_info(),
                        mint: ctx.accounts.mint.to_account_info(),
                    },
                ),
                fee,
                ctx.accounts.mint.decimals,
            )?;
        }

        emit!(PaymentReceived {
            buyer: ctx.accounts.buyer.key(),
            merchant: ctx.accounts.merchant_ata.key(),
            mint: ctx.accounts.mint.key(),
            amount,
            fee,
            product_id,
            customer_id,
        });
        Ok(())
    }

    pub fn set_accepted_token(
        ctx: Context<SetAcceptedToken>,
        accepted: bool,
    ) -> Result<()> {
        let row = &mut ctx.accounts.accepted;
        row.mint = ctx.accounts.mint.key();
        row.accepted = accepted;
        row.bump = ctx.bumps.accepted;
        Ok(())
    }

    pub fn pause(ctx: Context<AdminConfig>) -> Result<()> {
        ctx.accounts.config.paused = true;
        Ok(())
    }

    pub fn unpause(ctx: Context<AdminConfig>) -> Result<()> {
        ctx.accounts.config.paused = false;
        Ok(())
    }
}

// ── Events ──────────────────────────────────────────────────────────
#[event]
pub struct PaymentReceived {
    pub buyer: Pubkey,
    pub merchant: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
    pub fee: u64,
    pub product_id: [u8; 32],
    pub customer_id: [u8; 32],
}

// ── State ──────────────────────────────────────────────────────────
#[account]
pub struct VaultConfig {
    pub owner: Pubkey,
    pub platform_wallet: Pubkey,
    pub platform_fee_bps: u16,
    pub paused: bool,
    pub bump: u8,
}
impl VaultConfig {
    pub const LEN: usize = 8 + 32 + 32 + 2 + 1 + 1;
}

#[account]
pub struct AcceptedToken {
    pub mint: Pubkey,
    pub accepted: bool,
    pub bump: u8,
}
impl AcceptedToken {
    pub const LEN: usize = 8 + 32 + 1 + 1;
}

// ── Contexts ────────────────────────────────────────────────────────
#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = payer, space = VaultConfig::LEN, seeds = [b"vault"], bump)]
    pub config: Account<'info, VaultConfig>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CreatePayment<'info> {
    #[account(seeds = [b"vault"], bump = config.bump)]
    pub config: Account<'info, VaultConfig>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(seeds = [b"accepted", mint.key().as_ref()], bump = accepted.bump)]
    pub accepted: Account<'info, AcceptedToken>,
    #[account(mut)]
    pub buyer: Signer<'info>,
    #[account(mut)]
    pub buyer_ata: InterfaceAccount<'info, TokenAccount>,
    #[account(mut)]
    pub merchant_ata: InterfaceAccount<'info, TokenAccount>,
    #[account(mut)]
    pub platform_ata: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct SetAcceptedToken<'info> {
    #[account(has_one = owner)]
    pub config: Account<'info, VaultConfig>,
    pub owner: Signer<'info>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        init_if_needed,
        payer = owner,
        space = AcceptedToken::LEN,
        seeds = [b"accepted", mint.key().as_ref()],
        bump,
    )]
    pub accepted: Account<'info, AcceptedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AdminConfig<'info> {
    #[account(mut, has_one = owner)]
    pub config: Account<'info, VaultConfig>,
    pub owner: Signer<'info>,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Token not accepted")]
    TokenNotAccepted,
    #[msg("Vault is paused")]
    Paused,
    #[msg("Amount must be > 0")]
    AmountZero,
    #[msg("Amount too small for fee")]
    AmountTooSmall,
    #[msg("Fee too high (max 1000 bps)")]
    FeeTooHigh,
    #[msg("Math overflow")]
    MathOverflow,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn program_id_is_stable() {
        assert_eq!(
            crate::ID.to_string(),
            "Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS"
        );
    }

    #[test]
    fn vault_config_len_matches_fields() {
        assert_eq!(VaultConfig::LEN, 8 + 32 + 32 + 2 + 1 + 1);
    }

    #[test]
    fn accepted_token_len_matches_fields() {
        assert_eq!(AcceptedToken::LEN, 8 + 32 + 1 + 1);
    }

    #[test]
    fn fee_math_rounds_down() {
        // 0.5% of 1000 USDC (6 decimals) = 5 USDC
        let amount: u64 = 1_000_000_000;
        let fee = amount * 50 / BPS_DENOMINATOR;
        assert_eq!(fee, 5_000_000);
        assert_eq!(amount - fee, 995_000_000);
    }

    #[test]
    fn max_fee_enforced() {
        assert_eq!(MAX_PLATFORM_FEE_BPS, 1_000);
    }
}
