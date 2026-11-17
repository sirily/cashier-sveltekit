# Spec Delta

## ADDED Requirements

### Requirement: Two-Posting Cross-Currency Entry

For two unpriced postings with explicit accounts, finite nonzero opposite-sign amounts and distinct currencies, the ordinary Journal form SHALL automatically put `@@` on the negative posting using the positive amount and currency, regardless of account categories, without a mode or confirmation. It SHALL show a directional rate and use signed total-price weights for balance indication and Validate. Rate rounding SHALL NOT change either amount or total price.

#### Scenario: Cross-currency transfer

- **WHEN** the owner enters a negative posting of 10 GBP and a positive posting of 12.30 USD in the ordinary form and saves
- **THEN** the operation contains `-10 GBP @@ 12.30 USD` and `12.30 USD`, not a unit price `@`
- **AND** no technical balancing account or Beancount syntax in Currency is required

#### Scenario: Purchase uses the same mechanism

- **WHEN** one qualifying posting uses an asset account and the other an expense account
- **THEN** the same automatic total-price behavior applies without selecting a transfer type

#### Scenario: Posting order does not define direction

- **WHEN** the positive posting precedes the negative posting
- **THEN** the total price still belongs to the negative posting and uses the positive amount and currency

#### Scenario: Ordinary and unsupported shapes are not automatically priced

- **WHEN** amounts use the same currency, are zero, missing, nonfinite, or have the same sign, or the operation has other than two postings
- **THEN** the form does not manufacture an automatic total-price annotation
- **AND** existing explicit price or cost annotations are not silently replaced by this inference
- **AND** ordinary same-currency operations continue to save without `@@`

#### Scenario: Directional rate updates

- **WHEN** the owner enters -10 GBP and 12.30 USD
- **THEN** the form shows a rate with explicit direction, such as `1 GBP = 1.23 USD`
- **AND** changing either amount updates the rate without changing the other amount

#### Scenario: Rounded rate does not change exact received amount

- **WHEN** the owner enters -3 GBP and 10 USD, producing a repeating exchange rate
- **THEN** saving uses `@@ 10 USD` and a positive posting of 10 USD
- **AND** it does not multiply a rounded displayed rate to reconstruct that amount

#### Scenario: Consistent validation

- **WHEN** a supported operation contains `-10 GBP @@ 12.30 USD` and `12.30 USD`
- **THEN** the balance indicator and Validate agree that its weighted postings balance
- **AND** neither reports a separate GBP or USD imbalance caused by ignoring `@@`

### Requirement: Reopen and Correct Total-Price Operations

The editor SHALL restore supported two-posting `@@` operations with their accounts, amounts, currencies, and flag. Supported corrections SHALL update the same verified source directive while preserving `cashier_id`, unedited metadata, comments, and neighbors. Missing, ambiguous, stale, or unsupported source mappings SHALL reject changes without writing or appending a replacement operation.

#### Scenario: Offline save and reopen

- **WHEN** a supported operation is saved offline, the app reloads, and the owner opens it again
- **THEN** both accounts, original amounts and currencies, completion flag, total-price meaning, and exchange direction are restored
- **AND** `@@` is not reinterpreted as `@`

#### Scenario: Correct either amount

- **GIVEN** a saved operation contains `-10 GBP @@ 12.30 USD` and `12.30 USD`
- **WHEN** the owner changes the negative amount to -11 GBP
- **THEN** the same operation contains `-11 GBP @@ 12.30 USD` and `12.30 USD`
- **WHEN** the owner then changes the received amount to 13.20 USD and saves again
- **THEN** that operation contains `-11 GBP @@ 13.20 USD` and `13.20 USD`
- **AND** its identity and unedited source constructs remain intact without an additional transaction

#### Scenario: No-op and narration-only edits

- **WHEN** the owner saves a supported total-price operation unchanged or edits only its narration
- **THEN** the annotation and unedited source are preserved, including decimal values, metadata, and posting comments

#### Scenario: Source safety remains enforced

- **WHEN** the source mapping is stale or an annotated structure cannot be corrected safely
- **THEN** saving reports an actionable error, keeps the entered form, and leaves the journal unchanged
- **AND** unsupported investment or multi-posting syntax is not normalized into a simple exchange
