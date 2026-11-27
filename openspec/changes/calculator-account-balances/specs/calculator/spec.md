# Calculator

## Purpose

Calculate with manually entered numbers and original-commodity account balances from the local book.

## ADDED Requirements

### Requirement: Account Balance Operands

The calculator SHALL use the existing Cashier logo key as a labeled action to insert the signed account balance into any operand, or replace a selected operand. Without an account context it SHALL offer searchable account selection independently for each operand. With an account context it SHALL open that account directly. Balances SHALL be shown separately by original commodity, without automatic conversion.

#### Scenario: Select accounts for separate operands

- **GIVEN** the calculator is open without a selected account
- **WHEN** the user picks a balance, enters an operator, and picks a second balance from another account
- **THEN** each signed amount is inserted in its own operand and the expression can be calculated

#### Scenario: Replace an existing operand

- **WHEN** the user selects a number in the expression and picks a balance
- **THEN** only that operand is replaced and the surrounding expression is preserved

#### Scenario: Balance uses all book dates

- **GIVEN** the account has postings dated later than today
- **WHEN** the user looks up its balance
- **THEN** the balance includes those postings, as on the account screen

#### Scenario: A selected account has multiple commodities

- **GIVEN** the calculator was opened for an amount with an account already selected
- **WHEN** the user invokes the balance action
- **THEN** the account chooser is skipped and the balances of that account appear with their original commodities
- **AND** selecting one balance inserts its signed value and identifies its commodity in the expression without changing the context account or currency

### Requirement: Decimal Calculation and Amount Input

The calculator SHALL evaluate decimal addition, subtraction and multiplication without binary floating-point artifacts. An amount supplied by an editor SHALL be available as an initial operand, and the user SHALL be able to replace it with a multi-digit amount or continue from it with an operator.

#### Scenario: Subtract decimal amounts

- **WHEN** the user calculates `200 − 198.28`
- **THEN** the calculator displays `1.72`

#### Scenario: Negate a parenthesized expression

- **WHEN** the user calculates `−(2 + 3)` using the sign key and parentheses
- **THEN** the calculator displays `-5`

#### Scenario: Replace a prefilled amount

- **GIVEN** a posting amount is already populated
- **WHEN** the user opens the calculator and presses successive digit keys
- **THEN** all entered digits form one new number instead of replacing one another

### Requirement: Local and Read-Only Balance Selection

The calculator SHALL use the local analysis book for balance lookup without network access. An unavailable or unresolved balance SHALL NOT be inserted as zero. Dismissing the picker SHALL leave the expression unchanged. Selecting a balance SHALL NOT edit the book, the amount editor, or its selected account or currency.

#### Scenario: Local balance unavailable

- **WHEN** local analysis is unavailable, fails, or has no selectable balances for the account
- **THEN** the picker explains the state and manual calculation remains available

#### Scenario: Incomplete book in the account chooser

- **GIVEN** an included book file is missing
- **WHEN** the user opens the account chooser
- **THEN** the chooser shows the missing-source diagnostic rather than a successful empty account list

#### Scenario: Explicitly apply an amount

- **GIVEN** the calculator was opened from an amount editor
- **WHEN** the user confirms a valid calculation result with Apply amount
- **THEN** only the calculated amount is returned to the editor, without losing digits from the displayed result
- **AND** opening the calculator from a populated posting preserves the initial decimal amount

#### Scenario: Apply an unchanged posting amount

- **GIVEN** an existing posting contains `12.30 USD`
- **WHEN** the user opens the calculator, applies without editing, and saves the otherwise unchanged transaction
- **THEN** the editor retains `12.30` and the journal source remains unchanged

#### Scenario: Apply a precise balance adjustment

- **GIVEN** an account has a balance of `1 ETH`
- **WHEN** the user enters `1.000000000000000001 ETH` through the calculator and prepares the balance adjustment
- **THEN** the adjustment shows `0.000000000000000001 ETH` and prepares opposite postings of exactly that magnitude

#### Scenario: Calculate without an amount editor

- **WHEN** the user calculates from Home or a standalone calculator opened without an amount request
- **THEN** the picker and calculation do not change any active transaction selection or edit
