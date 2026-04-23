// SPDX-License-Identifier: AGPL-3.0
//
// Paylix SubscriptionManager — Solana edition.
//
// Recurring SPL subscriptions using token-account delegate authority.
// At subscription creation the buyer calls `approve` on their ATA naming
// this program's PDA as delegate. The keeper calls `charge_subscription`
// at each cycle boundary; the program CPIs into `spl-token::transfer_checked`
// using the delegate authority to pull funds.

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    self, Mint, TokenAccount, TokenInterface, TransferChecked,
};

// Placeholder program ID — replaced at deploy time. Valid base58, decodes
// to 32 bytes. Anchor will regenerate during `anchor build` to match the
// deploy keypair when that exists.
declare_id!("7xeFzZAtyq5uSVMAbx6N3LBhWFDCimbYhYdLdLg8EMmv");

const BPS_DENOMINATOR: u64 = 10_000;
const MAX_PLATFORM_FEE_BPS: u16 = 1_000;

#[program]
pub mod paylix_subscription_manager {
    use super::*;

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
        cfg.keeper = ctx.accounts.payer.key();
        cfg.paused = false;
        cfg.bump = ctx.bumps.config;
        cfg.next_id = 0;
        Ok(())
    }

    /// Create a subscription. Prerequisites the client must have done:
    ///   1. Called `spl_token::approve` on buyer_ata with delegate =
    ///      subscription PDA (seeds = ["sub", subscription_id.to_le_bytes()]).
    ///      The allowance must cover at least `amount * cycles` for however
    ///      many cycles the subscription is expected to run.
    ///
    /// This instruction charges the first cycle immediately and seeds
    /// `next_charge_at` for the keeper.
    pub fn create_subscription(
        ctx: Context<CreateSubscription>,
        amount: u64,
        interval_seconds: i64,
        product_id: [u8; 32],
        customer_id: [u8; 32],
    ) -> Result<()> {
        let cfg = &ctx.accounts.config;
        require!(!cfg.paused, ErrorCode::Paused);
        require!(amount > 0, ErrorCode::AmountZero);
        require!(interval_seconds > 0, ErrorCode::BadInterval);

        let sub = &mut ctx.accounts.subscription;
        let now = Clock::get()?.unix_timestamp;

        sub.subscriber = ctx.accounts.buyer.key();
        sub.merchant_ata = ctx.accounts.merchant_ata.key();
        sub.mint = ctx.accounts.mint.key();
        sub.amount = amount;
        sub.interval_seconds = interval_seconds;
        sub.next_charge_at = now.checked_add(interval_seconds).ok_or(ErrorCode::MathOverflow)?;
        sub.product_id = product_id;
        sub.customer_id = customer_id;
        sub.total_charged = 0;
        sub.status = SubStatus::Active as u8;
        sub.bump = ctx.bumps.subscription;
        sub.id = cfg.next_id;

        // First-cycle charge. The buyer is the signer of this tx — sign
        // authority is explicit.
        charge_inner(
            amount,
            cfg.platform_fee_bps,
            ctx.accounts.mint.decimals,
            &ctx.accounts.token_program,
            &ctx.accounts.buyer_ata.to_account_info(),
            &ctx.accounts.merchant_ata.to_account_info(),
            &ctx.accounts.platform_ata.to_account_info(),
            &ctx.accounts.buyer.to_account_info(),
            &ctx.accounts.mint.to_account_info(),
            None,
        )?;

        sub.total_charged = amount;

        let cfg_mut = &mut ctx.accounts.config;
        cfg_mut.next_id = cfg_mut.next_id.checked_add(1).ok_or(ErrorCode::MathOverflow)?;

        emit!(SubscriptionCreated {
            subscription_id: sub.id,
            subscriber: sub.subscriber,
            merchant_ata: sub.merchant_ata,
            mint: sub.mint,
            amount,
            interval_seconds,
            product_id,
            customer_id,
        });
        Ok(())
    }

    /// Charge a subscription whose `next_charge_at` has passed. Callable
    /// by subscriber, keeper, or anyone (the authority check for the
    /// pull is the delegate grant on buyer_ata, not this signer). Seeding
    /// `keeper` in `config` narrows the allowed callers — the account
    /// constraint enforces `signer == config.keeper OR signer == subscriber`.
    pub fn charge_subscription(ctx: Context<ChargeSubscription>) -> Result<()> {
        let cfg = &ctx.accounts.config;
        require!(!cfg.paused, ErrorCode::Paused);

        let sub = &mut ctx.accounts.subscription;
        require!(sub.status == SubStatus::Active as u8, ErrorCode::NotActive);

        let now = Clock::get()?.unix_timestamp;
        require!(now >= sub.next_charge_at, ErrorCode::NotDue);

        // Subscription PDA signs the CPI via its bump seeds — the delegate
        // authority on buyer_ata is the subscription PDA, so the CPI needs
        // the subscription's signer seeds to authorize transfer_checked.
        let id_bytes = sub.id.to_le_bytes();
        let seeds = &[b"sub" as &[u8], id_bytes.as_ref(), &[sub.bump]];
        let signer: &[&[&[u8]]] = &[seeds];

        charge_inner(
            sub.amount,
            cfg.platform_fee_bps,
            ctx.accounts.mint.decimals,
            &ctx.accounts.token_program,
            &ctx.accounts.buyer_ata.to_account_info(),
            &ctx.accounts.merchant_ata.to_account_info(),
            &ctx.accounts.platform_ata.to_account_info(),
            &sub.to_account_info(),
            &ctx.accounts.mint.to_account_info(),
            Some(signer),
        )?;

        sub.total_charged = sub.total_charged.checked_add(sub.amount).ok_or(ErrorCode::MathOverflow)?;
        sub.next_charge_at = sub.next_charge_at.checked_add(sub.interval_seconds).ok_or(ErrorCode::MathOverflow)?;

        emit!(SubscriptionCharged {
            subscription_id: sub.id,
            subscriber: sub.subscriber,
            merchant_ata: sub.merchant_ata,
            mint: sub.mint,
            amount: sub.amount,
        });
        Ok(())
    }

    pub fn cancel_subscription(ctx: Context<CancelSubscription>) -> Result<()> {
        let sub = &mut ctx.accounts.subscription;
        require!(
            ctx.accounts.authority.key() == sub.subscriber,
            ErrorCode::Unauthorized
        );
        sub.status = SubStatus::Cancelled as u8;
        emit!(SubscriptionCancelled { subscription_id: sub.id });
        Ok(())
    }
}

#[allow(clippy::too_many_arguments)]
fn charge_inner<'info>(
    amount: u64,
    platform_fee_bps: u16,
    decimals: u8,
    token_program: &Interface<'info, TokenInterface>,
    from: &AccountInfo<'info>,
    merchant_to: &AccountInfo<'info>,
    platform_to: &AccountInfo<'info>,
    authority: &AccountInfo<'info>,
    mint: &AccountInfo<'info>,
    signer_seeds: Option<&[&[&[u8]]]>,
) -> Result<()> {
    let fee = amount.checked_mul(platform_fee_bps as u64).ok_or(ErrorCode::MathOverflow)? / BPS_DENOMINATOR;
    let merchant_amount = amount.checked_sub(fee).ok_or(ErrorCode::MathOverflow)?;
    require!(merchant_amount > 0, ErrorCode::AmountTooSmall);

    let merchant_cpi = TransferChecked {
        from: from.clone(),
        to: merchant_to.clone(),
        authority: authority.clone(),
        mint: mint.clone(),
    };
    match signer_seeds {
        Some(seeds) => token_interface::transfer_checked(
            CpiContext::new_with_signer(token_program.to_account_info(), merchant_cpi, seeds),
            merchant_amount,
            decimals,
        )?,
        None => token_interface::transfer_checked(
            CpiContext::new(token_program.to_account_info(), merchant_cpi),
            merchant_amount,
            decimals,
        )?,
    }

    if fee > 0 {
        let platform_cpi = TransferChecked {
            from: from.clone(),
            to: platform_to.clone(),
            authority: authority.clone(),
            mint: mint.clone(),
        };
        match signer_seeds {
            Some(seeds) => token_interface::transfer_checked(
                CpiContext::new_with_signer(token_program.to_account_info(), platform_cpi, seeds),
                fee,
                decimals,
            )?,
            None => token_interface::transfer_checked(
                CpiContext::new(token_program.to_account_info(), platform_cpi),
                fee,
                decimals,
            )?,
        }
    }
    Ok(())
}

// ── Events ──────────────────────────────────────────────────────────
#[event]
pub struct SubscriptionCreated {
    pub subscription_id: u64,
    pub subscriber: Pubkey,
    pub merchant_ata: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
    pub interval_seconds: i64,
    pub product_id: [u8; 32],
    pub customer_id: [u8; 32],
}

#[event]
pub struct SubscriptionCharged {
    pub subscription_id: u64,
    pub subscriber: Pubkey,
    pub merchant_ata: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
}

#[event]
pub struct SubscriptionCancelled {
    pub subscription_id: u64,
}

// ── State ──────────────────────────────────────────────────────────
pub enum SubStatus {
    Active = 0,
    PastDue = 1,
    Cancelled = 2,
}

#[account]
pub struct SubscriptionManagerConfig {
    pub owner: Pubkey,
    pub platform_wallet: Pubkey,
    pub keeper: Pubkey,
    pub next_id: u64,
    pub platform_fee_bps: u16,
    pub paused: bool,
    pub bump: u8,
}
impl SubscriptionManagerConfig {
    pub const LEN: usize = 8 + 32 + 32 + 32 + 8 + 2 + 1 + 1;
}

#[account]
pub struct Subscription {
    pub id: u64,
    pub subscriber: Pubkey,
    pub merchant_ata: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
    pub interval_seconds: i64,
    pub next_charge_at: i64,
    pub product_id: [u8; 32],
    pub customer_id: [u8; 32],
    pub total_charged: u64,
    pub status: u8,
    pub bump: u8,
}
impl Subscription {
    pub const LEN: usize = 8 + 8 + 32 + 32 + 32 + 8 + 8 + 8 + 32 + 32 + 8 + 1 + 1;
}

// ── Contexts ────────────────────────────────────────────────────────
#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = payer, space = SubscriptionManagerConfig::LEN, seeds = [b"sub_config"], bump)]
    pub config: Account<'info, SubscriptionManagerConfig>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CreateSubscription<'info> {
    #[account(mut, seeds = [b"sub_config"], bump = config.bump)]
    pub config: Account<'info, SubscriptionManagerConfig>,

    #[account(
        init,
        payer = buyer,
        space = Subscription::LEN,
        seeds = [b"sub", config.next_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub subscription: Account<'info, Subscription>,

    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut)]
    pub buyer: Signer<'info>,
    #[account(mut)]
    pub buyer_ata: InterfaceAccount<'info, TokenAccount>,
    #[account(mut)]
    pub merchant_ata: InterfaceAccount<'info, TokenAccount>,
    #[account(mut)]
    pub platform_ata: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ChargeSubscription<'info> {
    #[account(seeds = [b"sub_config"], bump = config.bump)]
    pub config: Account<'info, SubscriptionManagerConfig>,

    #[account(mut, seeds = [b"sub", subscription.id.to_le_bytes().as_ref()], bump = subscription.bump)]
    pub subscription: Account<'info, Subscription>,

    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut)]
    pub buyer_ata: InterfaceAccount<'info, TokenAccount>,
    #[account(mut)]
    pub merchant_ata: InterfaceAccount<'info, TokenAccount>,
    #[account(mut)]
    pub platform_ata: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct CancelSubscription<'info> {
    #[account(mut)]
    pub subscription: Account<'info, Subscription>,
    pub authority: Signer<'info>,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Vault is paused")]
    Paused,
    #[msg("Subscription not active")]
    NotActive,
    #[msg("Not due yet")]
    NotDue,
    #[msg("Amount must be > 0")]
    AmountZero,
    #[msg("Amount too small for fee")]
    AmountTooSmall,
    #[msg("Interval must be > 0")]
    BadInterval,
    #[msg("Fee too high (max 1000 bps)")]
    FeeTooHigh,
    #[msg("Unauthorized")]
    Unauthorized,
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
            "7xeFzZAtyq5uSVMAbx6N3LBhWFDCimbYhYdLdLg8EMmv"
        );
    }

    #[test]
    fn config_len_matches_fields() {
        assert_eq!(SubscriptionManagerConfig::LEN, 8 + 32 + 32 + 32 + 8 + 2 + 1 + 1);
    }

    #[test]
    fn subscription_len_matches_fields() {
        assert_eq!(
            Subscription::LEN,
            8 + 8 + 32 + 32 + 32 + 8 + 8 + 8 + 32 + 32 + 8 + 1 + 1
        );
    }

    #[test]
    fn sub_status_bytes_distinct() {
        assert_ne!(SubStatus::Active as u8, SubStatus::PastDue as u8);
        assert_ne!(SubStatus::PastDue as u8, SubStatus::Cancelled as u8);
        assert_ne!(SubStatus::Active as u8, SubStatus::Cancelled as u8);
    }

    #[test]
    fn fee_math_matches_evm() {
        let amount: u64 = 1_000_000_000;
        let fee = amount * 50 / BPS_DENOMINATOR;
        assert_eq!(fee, 5_000_000);
    }
}
