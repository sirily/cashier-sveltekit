# Tasks

## 1. Local balance data

- [x] 1.1 Read original-commodity balances for one account using local analysis; verify signed totals, separate currencies, and unavailable or unresolved data with RustLedger WASM tests.

## 2. Calculator interaction

- [x] 2.1 Replace the logo key with an in-place picker, support inserting and replacing operands, and verify cancellation, arithmetic, independent account choices and Home isolation with calculator tests.
- [x] 2.2 Pass the selected account from the amount editor to the standalone calculator; verify scoped selection and that only explicit Apply returns a valid result.

## 3. Integration checks

- [x] 3.1 Validate the change, run static checks and the unit suite, and exercise the picker against the local book in a browser.
