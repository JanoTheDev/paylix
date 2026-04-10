# Design System for Paylix

## 1. Visual Theme & Atmosphere

Paylix's interface is built on controlled darkness — a near-black canvas (`#07070a`) that sits between pure void and warm charcoal, creating a stage where financial data and payment states command attention without strain. This is the darkness of a well-designed trading terminal or a Stripe dashboard in dark mode: purposeful, engineered, and easy on the eyes during long sessions. Every pixel serves the mission of making money movement feel safe, clear, and inevitable.

The color story is anchored by a single, electric teal accent (`#06d6a0`) — a color that sits at the intersection of "financial confidence" and "technical precision." Unlike the blues that dominate fintech (Stripe, PayPal, Coinbase), teal carves out a distinct identity while still reading as trustworthy. It glows against the dark canvas with the calm authority of a status LED on high-end hardware — present, reassuring, never shouting. This accent is used surgically: interactive elements, primary CTAs, and active states only. Everything else lives in the neutral gray spectrum.

Typography runs on two tracks: Geist Sans for all human-readable interface text — clean, geometric, engineered by Vercel for screen rendering at small sizes — and Geist Mono for the financial data layer. Wallet addresses, transaction hashes, USDC amounts, and API keys all render in monospace, creating an instant visual separation between "what the interface says" and "what the blockchain says." Tabular numbers (`tnum`) are enabled globally so columns of financial data align with pixel precision.

The border system uses a cool-tinted gray (`rgba(148, 163, 184, 0.12)`) — not warm, not neutral, slightly blue-shifted — that gives every card and divider a subtle crystalline quality against the dark canvas. Combined with minimal shadow usage (borders do the heavy lifting in dark mode), the result is a layered-glass aesthetic where UI surfaces feel like translucent panels floating at measured depths.

**Key Characteristics:**
- Near-black canvas (`#07070a`) with layered surfaces ascending through subtle lightness shifts
- Electric teal accent (`#06d6a0`) — one color, used only for interactive and active states
- Two-font system: Geist Sans (interface) and Geist Mono (financial data) — no third font
- Cool-tinted borders (`rgba(148, 163, 184, 0.12)`) that shimmer faintly against the dark canvas
- Monospace typography for all blockchain data: amounts, hashes, addresses, keys
- Tabular numbers (`font-variant-numeric: tabular-nums`) on every numeric display
- Status colors derived from payment semantics: green=confirmed, amber=past_due, red=failed, blue=pending
- No gradients, no glows, no crypto-aesthetic ornamentation — this is fintech, not DeFi
- Dark mode as the primary and default experience
- Micro-animations only on meaningful state transitions (payment confirmation, status changes)
- Generous whitespace that communicates premium quality and financial seriousness
- Checkout page designed as a focused, trust-building single card — no distractions

## 2. Color Palette & Roles

### Brand

- **Teal Primary** (`#06d6a0`): The accent. Interactive elements, primary buttons, active nav states, focus rings, links. A calm, electric green-teal that reads as both technical and trustworthy.
- **Teal Hover** (`#05bf8e`): Hover and pressed state for teal interactive elements.
- **Teal Deep** (`#04a87b`): Active/pressed state for buttons under click.
- **Teal Muted** (`#06d6a010`): 6% opacity teal for subtle backgrounds — active nav items, selected table rows.
- **Teal Glow** (`#06d6a020`): 12% opacity teal for badge backgrounds and soft emphasis areas.
- **Teal Border** (`#06d6a033`): 20% opacity teal for badge borders and active-state outlines.

### Semantic — Payment States

- **Confirmed Green** (`#22c55e`): Payment confirmed, subscription active, webhook delivered. The money landed.
- **Confirmed Green Muted** (`#22c55e12`): Badge background for confirmed/active states.
- **Confirmed Green Border** (`#22c55e30`): Badge border for confirmed/active states.
- **Pending Blue** (`#60a5fa`): Payment pending, processing, waiting for confirmation. Patience.
- **Pending Blue Muted** (`#60a5fa12`): Badge background for pending states.
- **Pending Blue Border** (`#60a5fa30`): Badge border for pending states.
- **Past Due Amber** (`#fbbf24`): Subscription past due, charge failed but recoverable. Attention needed.
- **Past Due Amber Muted** (`#fbbf2412`): Badge background for warning states.
- **Past Due Amber Border** (`#fbbf2430`): Badge border for warning states.
- **Failed Red** (`#f87171`): Payment failed, subscription cancelled, webhook delivery failed. Something broke.
- **Failed Red Muted** (`#f8717112`): Badge background for error/failed states.
- **Failed Red Border** (`#f8717130`): Badge border for error/failed states.

### Currency

- **USDC Blue** (`#2775ca`): The official USDC brand color. Used exclusively for token indicators, currency badges, and amount displays where token identity needs emphasis.
- **USDC Blue Muted** (`#2775ca14`): Token badge background.
- **USDC Blue Border** (`#2775ca33`): Token badge border.

### Neutral Scale — Dark Mode (Primary)

- **Canvas** (`#07070a`): The deepest layer. Page background. Near-black with a cold undertone.
- **Surface 0** (`#0c0c10`): Sidebar, navigation chrome. One step above canvas.
- **Surface 1** (`#111116`): Cards, containers, primary content areas. The workhorse surface.
- **Surface 2** (`#18181e`): Elevated elements — dropdowns, modals, popovers, the checkout card.
- **Surface 3** (`#1f1f26`): Hover state for surface elements. Interactive feedback.
- **Border Subtle** (`rgba(148, 163, 184, 0.08)`): Faintest dividers — table row separators, section breaks.
- **Border Default** (`rgba(148, 163, 184, 0.12)`): The signature cool-tinted border. Cards, inputs, containers.
- **Border Strong** (`rgba(148, 163, 184, 0.20)`): Emphasized borders — input focus (before brand ring), important dividers.
- **Text Primary** (`#f0f0f3`): Headings, amounts, primary content. Near-white with a cool shift.
- **Text Secondary** (`#94a3b8`): Descriptions, labels, secondary information. Slate-tinted gray.
- **Text Tertiary** (`#64748b`): Placeholders, disabled text, timestamps. Recedes into the canvas.
- **Text Inverted** (`#07070a`): Text on teal buttons. Dark on bright.

### Neutral Scale — Light Mode (Secondary)

- **Canvas** (`#ffffff`): Page background.
- **Surface 0** (`#f8fafc`): Sidebar, navigation. Slate-tinted off-white.
- **Surface 1** (`#f1f5f9`): Cards, containers.
- **Surface 2** (`#e2e8f0`): Elevated elements.
- **Surface 3** (`#cbd5e1`): Hover states.
- **Border Subtle** (`#f1f5f9`): Faint dividers.
- **Border Default** (`#e2e8f0`): Standard borders.
- **Border Strong** (`#94a3b8`): Emphasized borders.
- **Text Primary** (`#0f172a`): Dark slate for headings. Deep, not pure black.
- **Text Secondary** (`#475569`): Descriptions, labels.
- **Text Tertiary** (`#94a3b8`): Placeholders, disabled.
- **Text Inverted** (`#ffffff`): Text on teal buttons in light mode.

### Shadow Colors

- **Shadow SM** (`rgba(0, 0, 0, 0.20)`): Dropdowns, tooltips.
- **Shadow MD** (`rgba(0, 0, 0, 0.30)`): Modals, dialogs.
- **Shadow LG** (`rgba(0, 0, 0, 0.40)`): Command palette, critical overlays.
- **Ring Shadow** (`rgba(148, 163, 184, 0.10) 0px 0px 0px 1px`): Cool-tinted shadow-as-border for cards.

## 3. Typography Rules

### Font Family

- **Primary**: `"Geist Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` — Vercel's geometric sans-serif. Optimized for screen rendering, particularly at 12-16px sizes where most UI text lives.
- **Monospace**: `"Geist Mono", "JetBrains Mono", "Fira Code", ui-monospace, monospace` — For all financial data, blockchain identifiers, and code.
- **OpenType features**: `"tnum"` tabular numbers enabled globally. `"ss01"` stylistic set for alternate glyph forms in Geist.

### Hierarchy

| Role | Font | Size | Weight | Line Height | Letter Spacing | Notes |
|------|------|------|--------|-------------|----------------|-------|
| Page Title | Primary | 30px (1.875rem) | 600 | 1.15 (tight) | -0.6px | Dashboard page headings. One per page. |
| Section Title | Primary | 20px (1.25rem) | 600 | 1.25 (tight) | -0.4px | Card headers, major section labels. |
| Card Title | Primary | 16px (1.00rem) | 500 | 1.40 | -0.1px | Widget titles, subsection labels. |
| Body | Primary | 14px (0.875rem) | 400 | 1.55 | normal | Default text. Descriptions, paragraphs. |
| Body Small | Primary | 13px (0.8125rem) | 400 | 1.50 | normal | Table cells, compact UI text. |
| Caption | Primary | 12px (0.75rem) | 400 | 1.40 | 0.2px | Timestamps, helper text, footnotes. |
| Label | Primary | 13px (0.8125rem) | 500 | 1.00 | 0.1px | Form labels, table column headers. |
| Label Uppercase | Primary | 11px (0.6875rem) | 600 | 1.00 | 0.8px | `text-transform: uppercase`. Sidebar section labels, overline text. |
| Amount Hero | Mono | 32px (2.00rem) | 600 | 1.15 | -0.5px | Revenue totals on overview page. The big number. |
| Amount Large | Mono | 24px (1.50rem) | 600 | 1.20 | -0.3px | Stat card numbers, checkout price. |
| Amount | Mono | 14px (0.875rem) | 500 | 1.50 | normal | Payment amounts in tables, inline values. |
| Hash / Address | Mono | 13px (0.8125rem) | 400 | 1.50 | normal | Tx hashes, wallet addresses. Always truncated. |
| Code Block | Mono | 13px (0.8125rem) | 400 | 1.65 (relaxed) | normal | Code snippets, API key displays. |
| Button | Primary | 14px (0.875rem) | 500 | 1.00 | normal | Button labels. |
| Badge | Primary | 11px (0.6875rem) | 600 | 1.00 | 0.3px | Status badges, token indicators. |

### Principles

- **Financial data is always monospace.** Every number that represents money, every blockchain hash, every wallet address, every API key renders in Geist Mono. This creates an instant cognitive split: sans-serif = interface, monospace = data. Users learn this in seconds.
- **Tabular numbers are non-negotiable.** `font-variant-numeric: tabular-nums` on every numeric display. Columns of payment amounts, subscriber counts, and revenue figures must align to the pixel. Proportional numbers in financial tables is a cardinal sin.
- **Negative tracking on headings, neutral everywhere else.** Page titles use -0.6px, section titles -0.4px. Body text and below use `normal`. This creates a "tightened headline, open body" rhythm that mirrors print editorial design.
- **Truncate blockchain data, never wrap.** Wallet addresses: `0x1a2b...3c4d` (first 6 + last 4). Tx hashes: `0x8f3e...a1b2` (first 6 + last 4). API keys: `sk_live_...a1b2` (prefix + last 4). Copy button adjacent. Never multi-line.
- **Weight range is 400-600.** 400 for body, 500 for labels and buttons, 600 for titles and emphasis. Nothing heavier. 700+ feels aggressive in a financial context — we want confidence, not force.

## 4. Component Stylings

### Buttons

**Primary**
- Background: `#06d6a0`
- Text: `#07070a`
- Padding: 10px 18px
- Radius: 8px
- Font: 14px / weight 500
- Hover: `#05bf8e` background
- Active: `#04a87b` background
- Focus: 2px ring `#06d6a060` with 2px offset
- Disabled: 40% opacity, cursor not-allowed
- Transition: background 150ms ease, box-shadow 150ms ease
- Use: Primary actions ("Create Product", "Generate Key", "Connect Wallet & Pay")

**Secondary**
- Background: `transparent`
- Border: 1px solid `rgba(148, 163, 184, 0.12)`
- Text: `#f0f0f3`
- Padding: 10px 18px
- Radius: 8px
- Hover: background `#111116`, border `rgba(148, 163, 184, 0.20)`
- Use: Secondary actions ("Cancel", "Back", "Export CSV", "View Details")

**Ghost**
- Background: `transparent`
- Border: none
- Text: `#94a3b8`
- Padding: 10px 18px
- Radius: 8px
- Hover: background `#111116`, text `#f0f0f3`
- Use: Tertiary actions, navigation links, toolbar items, "Add Field" in metadata editor

**Destructive**
- Background: `transparent`
- Border: 1px solid `#f8717130`
- Text: `#f87171`
- Padding: 10px 18px
- Radius: 8px
- Hover: background `#f8717112`, border `#f8717150`
- Use: Irreversible actions ("Revoke Key", "Cancel Subscription", "Delete Webhook")

**Icon Button**
- Size: 36px x 36px
- Padding: 0 (centered icon)
- Radius: 8px
- Icon: 16px, color `#94a3b8`
- Hover: background `#111116`, icon `#f0f0f3`
- Use: Copy buttons, table row actions, close buttons

### Cards & Containers

**Default Card**
- Background: `#111116`
- Border: 1px solid `rgba(148, 163, 184, 0.12)`
- Radius: 12px
- Padding: 24px
- Shadow: none
- Use: Dashboard content containers, form sections, settings panels

**Elevated Card**
- Background: `#18181e`
- Border: 1px solid `rgba(148, 163, 184, 0.12)`
- Radius: 12px
- Padding: 24px
- Shadow: `0 4px 16px rgba(0, 0, 0, 0.30)`
- Use: Modals, dropdowns, popovers, command palette

**Checkout Card**
- Background: `#18181e`
- Border: 1px solid `rgba(148, 163, 184, 0.16)`
- Radius: 16px
- Padding: 32px
- Shadow: `0 8px 32px rgba(0, 0, 0, 0.40)`
- Max-width: 480px, centered
- Use: The checkout payment form — the most important card in the system

**Stat Card**
- Background: `#111116`
- Border: 1px solid `rgba(148, 163, 184, 0.12)`
- Radius: 12px
- Padding: 20px 24px
- Layout: Label (uppercase caption, `#64748b`) top → Large mono number (`#f0f0f3`) bottom → Optional trend badge right-aligned
- Use: Overview page metrics (revenue, payment count, active subscribers)

### Badges / Tags / Pills

**Status Confirmed / Active**
- Background: `#22c55e12`
- Text: `#22c55e`
- Border: 1px solid `#22c55e30`
- Padding: 3px 10px
- Radius: 9999px (full pill)
- Font: 11px / weight 600 / tracking 0.3px
- Use: Active subscriptions, confirmed payments, delivered webhooks

**Status Pending**
- Background: `#60a5fa12`
- Text: `#60a5fa`
- Border: 1px solid `#60a5fa30`
- Same dimensions as above
- Use: Pending payments, processing states

**Status Past Due / Warning**
- Background: `#fbbf2412`
- Text: `#fbbf24`
- Border: 1px solid `#fbbf2430`
- Use: Past due subscriptions, expiring items, attention needed

**Status Failed / Cancelled**
- Background: `#f8717112`
- Text: `#f87171`
- Border: 1px solid `#f8717130`
- Use: Failed payments, cancelled subscriptions, revoked keys, failed webhook deliveries

**Token Badge (USDC)**
- Background: `#2775ca14`
- Text: `#2775ca`
- Border: 1px solid `#2775ca33`
- Padding: 3px 10px
- Radius: 6px
- Font: Mono 11px / weight 600
- Use: USDC indicator alongside amounts. Always shown in payment tables.

### Inputs & Forms

**Text Input**
- Background: `#07070a`
- Border: 1px solid `rgba(148, 163, 184, 0.12)`
- Text: `#f0f0f3`
- Placeholder: `#64748b`
- Padding: 10px 14px
- Radius: 8px
- Height: 40px
- Focus: border `#06d6a0`, ring `0 0 0 3px #06d6a020`
- Error: border `#f87171`, ring `0 0 0 3px #f8717115`
- Transition: border 150ms ease, box-shadow 150ms ease
- Use: All text inputs, email fields, URL fields

**Select / Dropdown**
- Same base styling as text input
- Chevron: `#64748b`, 16px, right-aligned
- Dropdown panel: Elevated Card styling, max-height 240px with scroll
- Option hover: background `#1f1f26`
- Selected option: text `#06d6a0`

**Toggle Switch**
- Track inactive: `rgba(148, 163, 184, 0.15)`
- Track active: `#06d6a0`
- Thumb: `#f0f0f3`
- Width: 44px, Height: 24px
- Thumb size: 18px
- Transition: 200ms cubic-bezier(0.4, 0, 0.2, 1)
- Use: Checkout field toggles (enable/disable name, email, phone), webhook active state, product active state

**Metadata Key-Value Editor**
- Row layout: key input (40%) + value input (55%) + delete icon button (5%) — horizontal
- Key input placeholder: "key"
- Value input placeholder: "value"
- "Add field" ghost button below, with `+` icon
- Separator: 8px gap between rows
- Use: Product metadata editor, customer metadata

### Navigation

**Sidebar**
- Background: `#0c0c10`
- Width: 240px, fixed position
- Border right: 1px solid `rgba(148, 163, 184, 0.08)`
- Logo area: 56px height, 20px horizontal padding. Logo + "Paylix" wordmark in 16px weight 600
- Section labels: Label Uppercase style (`#64748b`, 11px, weight 600, 0.8px tracking, uppercase), 20px horizontal padding, 28px top margin
- Nav items: height 36px, padding 8px 12px, margin 2px 8px, radius 8px
- Nav item icon: 18px, `#64748b`
- Nav item text: 14px weight 400, `#94a3b8`
- Nav item hover: background `#111116`, text `#f0f0f3`, icon `#f0f0f3`
- Nav item active: background `#06d6a010`, text `#06d6a0`, icon `#06d6a0`
- Bottom section: settings + user avatar, border top `rgba(148, 163, 184, 0.08)`

**Top Bar (checkout page / mobile)**
- Height: 56px
- Background: `#07070a`
- Border bottom: 1px solid `rgba(148, 163, 184, 0.08)`
- Content: centered Paylix logo or merchant name
- Use: Checkout page header, mobile dashboard nav

### Tables

**Data Table**
- Container: Default Card (no extra wrapper needed)
- Header row: height 40px, Label style text (`#64748b`, 13px, weight 500), border-bottom `rgba(148, 163, 184, 0.08)`, no background
- Data row: height 52px, Body Small text (`#f0f0f3`, 13px), border-bottom `rgba(148, 163, 184, 0.06)`
- Row hover: background `#0c0c10`
- Cell padding: 0 16px
- Monospace cells: amounts (right-aligned), tx hashes (truncated + copy button), wallet addresses (truncated + copy button)
- Status column: status badge (pill)
- Actions column: icon buttons, right-aligned
- Empty state: centered text `#64748b` + ghost button CTA
- Use: Payments table, subscribers table, customers table, webhook delivery log, API keys list

### Checkout Page Layout

**Container**
- Full viewport, centered vertically and horizontally
- Background: `#07070a` (canvas)
- Content: Checkout Card (max-width 480px)

**Checkout Card Internal Layout**
- Top: Merchant/product info section — product name (Section Title), description (Body, `#94a3b8`), price (Amount Large, mono, `#f0f0f3` + USDC token badge)
- Divider: 1px solid `rgba(148, 163, 184, 0.08)`, 24px vertical margin
- Middle: Customer info fields (if enabled) — stacked inputs with 12px gap
- Divider: same as above
- Bottom: Payment section — "Connect Wallet & Pay" primary button (full-width) → OR divider → QR code block (centered, 200x200px, white QR on dark)
- Footer: "Powered by Paylix" caption text, centered, `#64748b`

**Payment State Transitions**
- Waiting: pulsing teal dot + "Waiting for payment..." in Body style, `#94a3b8`
- Confirming: spinning teal loader + "Confirming on Base..." 
- Confirmed: teal checkmark + "Payment confirmed!" — redirect after 2 seconds
- Failed: red X + "Payment failed" + retry button

## 5. Layout Principles

### Spacing System

Base unit: `4px`. Every spacing value is a multiple of 4.

- `2px` — Micro: icon-to-badge gap, internal badge padding
- `4px` — Tight: between icon and label in a button, badge internal
- `8px` — Compact: between related items, nav item vertical gap, table cell gap
- `12px` — Default: input padding, button side padding, form field gap
- `16px` — Comfortable: between form fields, between list items, card internal sections
- `20px` — Spacious: stat card padding, section gaps within a card
- `24px` — Card padding (standard), horizontal page padding on desktop
- `32px` — Between cards on the same page, major card internal divisions
- `48px` — Between dashboard page sections
- `64px` — Top/bottom page padding, hero spacing on checkout

### Grid & Container

- Dashboard max content width: `1200px`, centered with `auto` horizontal margins
- Sidebar: fixed `240px` on desktop, collapses on tablet/mobile
- Main content area: `calc(100% - 240px)`, fluid, `24px` horizontal padding
- Stat cards: `3-column` CSS grid, `16px` gap, equal width
- Forms: single column, `max-width: 560px`
- Tables: 100% of content area width, horizontal scroll on overflow
- Checkout page: centered `max-width: 480px`, `64px` top padding
- Docs site: `240px` left TOC sidebar + fluid content (max `720px`) + `200px` right headings nav

### Whitespace Philosophy

- **Generous spacing equals trust.** A payment platform with cramped margins feels amateur and unsafe. Every card, every section, every form has room to breathe. Users subconsciously associate whitespace with confidence and control.
- **Data tables are the exception.** Tables use compact 52px rows and 16px cell padding because users scan them — density helps here. But tables are always surrounded by generous card padding, so the density is contained.
- **Rhythm over precision.** Follow the 4px grid absolutely. A 24px margin that "should" be 22px is better at 24px because maintaining the grid rhythm creates visual coherence that outweighs any single measurement being "optimal."

### Border Radius Scale

| Name | Value | Use |
|------|-------|-----|
| None | 0px | Table cells, raw dividers |
| Subtle | 4px | Inline code spans, small tags |
| Default | 8px | Buttons, inputs, dropdowns, nav items |
| Medium | 12px | Cards, containers, modals, settings panels |
| Large | 16px | Checkout card, hero elements |
| Full | 9999px | Status badges, token pills, avatars |

## 6. Depth & Elevation

| Level | Treatment | Use |
|-------|-----------|-----|
| Recessed (L0) | No border, canvas background | Page background, empty areas |
| Flat (L1) | 1px solid `rgba(148, 163, 184, 0.12)` | Cards, containers, inputs, table wrappers |
| Raised (L2) | 1px solid `rgba(148, 163, 184, 0.12)` + `0 2px 8px rgba(0, 0, 0, 0.20)` | Dropdowns, select menus, tooltips, popovers |
| Elevated (L3) | 1px solid `rgba(148, 163, 184, 0.12)` + `0 4px 16px rgba(0, 0, 0, 0.30)` | Modals, dialogs, confirmation popups |
| Floating (L4) | 1px solid `rgba(148, 163, 184, 0.16)` + `0 8px 32px rgba(0, 0, 0, 0.40)` | Checkout card, command palette, critical overlays |

**Shadow Philosophy:** On a near-black canvas, shadows are barely perceptible — you cannot meaningfully darken `#07070a`. The cool-tinted border (`rgba(148, 163, 184, 0.12)`) does 80% of the depth work in dark mode. Shadows serve only to separate truly floating elements (modals, dropdowns, the checkout card) from the layers beneath them. In light mode, shadows carry more visual weight and borders soften proportionally.

### Backdrop

- Modal/dialog/drawer backdrop: `rgba(0, 0, 0, 0.65)` with `backdrop-filter: blur(8px)`
- Transition: opacity 200ms ease
- Use: All full-screen overlays — modals, drawers, command palette

## 7. Do's and Don'ts

### Do

- Use `#06d6a0` (teal) exclusively for interactive elements — buttons, links, focus rings, active nav items, toggle tracks. It is the brand. Protect it.
- Apply Geist Mono to every piece of financial data: amounts (`$10.00`), hashes (`0x1a2b...`), addresses, API keys (`sk_live_...`), subscription IDs. No exceptions.
- Enable `font-variant-numeric: tabular-nums` on every numeric display — amounts, counts, percentages, table columns.
- Truncate wallet addresses to first 6 + `...` + last 4 characters (`0x1a2b...3c4d`). Add a copy-to-clipboard icon button adjacent.
- Use status colors consistently and exclusively: green (`#22c55e`) = confirmed/active, amber (`#fbbf24`) = warning/past_due, red (`#f87171`) = failed/cancelled, blue (`#60a5fa`) = pending.
- Keep the checkout card centered at `max-width: 480px` — the payment moment must feel focused, contained, and safe.
- Apply `border-radius: 8px` to all interactive elements (buttons, inputs, nav items) and `12px` to containers (cards, modals). Never mix radius values on the same visual layer.
- Use cool-tinted borders (`rgba(148, 163, 184, 0.12)`) as the primary depth mechanism. They are the structural skeleton of the dark UI.
- Maintain the 4px spacing grid — every margin, padding, and gap must be a multiple of 4.
- Show USDC amounts with exactly 2 decimal places (`$10.00`, not `$10`) and the USDC token badge alongside.

### Don't

- Don't use gradients, glows, neon effects, or animated backgrounds. These are crypto-aesthetic tropes that destroy professional credibility. Paylix is a payment tool, not a DeFi dashboard.
- Don't use font weight above 600. The maximum is 600 for page titles and badge text. Weight 700+ feels aggressive and cheap in a financial UI.
- Don't apply teal (`#06d6a0`) to large background areas, body text, or decorative elements. It is for small interactive targets only — buttons, links, focus rings, active indicators.
- Don't use pure black (`#000000`) as the canvas. Use `#07070a` which has enough cold warmth to avoid the "floating in absolute void" effect.
- Don't use warm-tinted grays for borders. All borders use the cool-shifted `rgba(148, 163, 184, ...)` scale. Warm borders conflict with the teal accent.
- Don't wrap wallet addresses or transaction hashes to multiple lines. Always truncate with ellipsis and provide a copy button.
- Don't use emoji or decorative icons in the dashboard. Use Lucide icons at 16-18px, stroke width 1.5px, in `#64748b` (inactive) or `#f0f0f3` (active/hover).
- Don't add box-shadows to flat cards in dark mode. Borders provide the structure. Shadows are reserved for truly floating elements (L2+).
- Don't introduce a third font family. Geist Sans + Geist Mono. That's it. Adding a display serif, a rounded sans, or any other font breaks the system.
- Don't use color alone to communicate status. Always pair status colors with text labels ("Active", "Failed") or icons for accessibility.

## 8. Responsive Behavior

### Breakpoints

| Name | Width | Key Changes |
|------|-------|-------------|
| Mobile | < 640px | Sidebar collapses to bottom tab bar (5 icons). Stat cards stack to 1-column. Tables scroll horizontally with sticky first column. Checkout is full-width with 16px padding. Page title stacks above action buttons. |
| Tablet | 640px – 1024px | Sidebar collapses to icon-only rail (56px). Stat cards in 2-column grid. Content padding reduces to 16px. Forms remain max-width 560px. |
| Desktop | > 1024px | Full sidebar (240px). Stat cards 3-column. All features visible. Content padding 24px. Tables comfortably fit without scroll. |

### Touch Targets

- Minimum touch target: 44px x 44px on mobile (WCAG 2.5.5)
- Table rows: 52px height (tappable on mobile, scannable on desktop)
- Buttons: height 40px desktop, 44px mobile
- Nav items: 44px height mobile, 36px desktop
- Icon buttons: 44px x 44px mobile, 36px x 36px desktop
- Toggle switches: 44px x 24px (full track is the target)

### Collapsing Strategy

- Sidebar: `240px` full → `56px` icon rail → hidden (bottom tab bar on mobile)
- Stat cards: 3-column → 2-column → 1-column stack
- Data tables: fixed layout → horizontal scroll, sticky first column + actions column
- Forms: `max-width: 560px` at all sizes, horizontal padding adjusts (24px → 16px)
- Checkout card: `max-width: 480px` centered → full-width with 16px horizontal padding
- Page header (title + actions): side-by-side → stacked (title top, actions below)
- Metadata editor: horizontal key-value → stacked (key above value) on mobile

### Image Behavior

- Paylix logo: SVG, renders at 24px height in sidebar, 20px in mobile nav, 28px on checkout page
- Token icons (USDC): 16px in tables, 20px in checkout, loaded from CDN with text fallback ("USDC")
- QR codes: 200px on desktop, 160px on mobile, always centered, white code on dark background
- No decorative illustrations — the UI is data-driven

## 9. Agent Prompt Guide

### Quick Color Reference

- Brand accent / interactive: Teal (`#06d6a0`)
- Brand hover: `#05bf8e`
- Page background: Canvas (`#07070a`)
- Card surface: Surface 1 (`#111116`)
- Elevated surface: Surface 2 (`#18181e`)
- Sidebar: Surface 0 (`#0c0c10`)
- Primary text: `#f0f0f3`
- Secondary text: `#94a3b8`
- Tertiary text: `#64748b`
- Border: `rgba(148, 163, 184, 0.12)`
- Success: `#22c55e`
- Warning: `#fbbf24`
- Error: `#f87171`
- Pending: `#60a5fa`
- USDC: `#2775ca`
- Financial amounts: Geist Mono, weight 500, tabular-nums

### Example Component Prompts

- "Build a payment status badge. Pill shape (`border-radius: 9999px`), 11px Geist Sans weight 600, letter-spacing 0.3px, padding 3px 10px. Confirmed: `#22c55e` text, `#22c55e12` background, `#22c55e30` border. Pending: `#60a5fa` text, `#60a5fa12` bg, `#60a5fa30` border. Past due: `#fbbf24`. Failed: `#f87171`. All with 1px solid border."

- "Build a stat card for the dashboard. Background `#111116`, border 1px `rgba(148, 163, 184, 0.12)`, radius 12px, padding 20px 24px. Top: uppercase label in 11px weight 600, `#64748b`, tracking 0.8px. Bottom: large amount in Geist Mono 24px weight 600, `#f0f0f3`, tabular-nums. Optional: small trend badge (green pill for positive, red for negative) right-aligned."

- "Build the sidebar nav. Width 240px, background `#0c0c10`, right border `rgba(148, 163, 184, 0.08)`. Logo area 56px tall. Section labels: 11px uppercase weight 600, `#64748b`, 0.8px tracking. Nav items: 36px tall, 8px 12px padding, 8px radius, Lucide icons 18px. Inactive: `#94a3b8` text, `#64748b` icon. Hover: `#111116` bg, `#f0f0f3` text+icon. Active: `#06d6a010` bg, `#06d6a0` text+icon."

- "Build the checkout page. Full viewport `#07070a` background. Centered card: max-width 480px, `#18181e` background, border `rgba(148, 163, 184, 0.16)`, radius 16px, padding 32px, shadow `0 8px 32px rgba(0,0,0,0.40)`. Product name 20px weight 600. Price in Geist Mono 24px weight 600 + USDC badge. Customer fields stacked with 12px gap. Full-width teal primary button. QR code section below divider, centered 200x200."

- "Build a data table for payments. No outer border — lives inside a card. Header: 40px height, 13px weight 500 `#64748b` text, bottom border `rgba(148, 163, 184, 0.08)`. Rows: 52px height, 13px `#f0f0f3` text, bottom border `rgba(148, 163, 184, 0.06)`, hover `#0c0c10`. Amount column: Geist Mono right-aligned + USDC badge. Status column: pill badges. Tx hash: Geist Mono truncated (6+4) + 16px copy icon button."

### Iteration Guide

1. Start with `#07070a` canvas, `#111116` cards, `#f0f0f3` text — this is the foundation of every screen.
2. Teal (`#06d6a0`) is ONLY for things the user clicks, focuses, or that indicate "active." If it's not interactive, it's not teal.
3. All financial data (amounts, hashes, addresses, keys) renders in Geist Mono with `tabular-nums`. Every time. No exceptions.
4. Borders (`rgba(148, 163, 184, 0.12)`) are the primary depth mechanism. Shadows appear only on floating elements (L2+).
5. The 4px grid is law. If a spacing value isn't divisible by 4, round to the nearest multiple.
6. Status colors are immutable: green=confirmed/active, amber=past_due, red=failed/cancelled, blue=pending.
7. The checkout page is a single centered card (480px max). No sidebar, no nav, no footer — just the payment flow and "Powered by Paylix."
8. More whitespace is almost always the right call. A payment platform should feel spacious, controlled, and calm — never cramped.
