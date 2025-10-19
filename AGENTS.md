# Repository Guidelines

## Project Structure & Module Organization

-   `contracts/` hosts the upgradeable Solidity sources (e.g., `Manager3send.sol` plus mocks) that underpin payments and Uniswap quoting. Keep new contracts upgrade-safe and colocate related interfaces.
-   `scripts/` provides operational TypeScript entrypoints like `deploy.ts` and `upgrade.ts`; follow the existing pattern of validating environment variables before side effects.
-   `test/` contains Hardhat + Mocha specs in TypeScript (see `Manager3send.ts`); mirror contract names for new spec files and share fixtures through helpers.
-   Generated outputs (`artifacts/`, `cache/`, `typechain-types/`) should stay untracked and never be edited by hand. Hardhat/TSC configuration lives in `hardhat.config.ts` and `tsconfig.json`.

## Build, Test, and Development Commands

-   `npm install` resolves Hardhat, TypeChain, and OpenZeppelin toolchains; re-run after dependency updates.
-   `npm run build` (alias for `npx hardhat compile`) compiles Solidity, refreshes TypeChain bindings, and updates `artifacts/`.
-   `npm run test` executes the Hardhat test suite with Mocha/Chai. Use `npx hardhat test --grep "<pattern>"` to focus on a scenario.
-   `npx hardhat run --network <network> scripts/deploy.ts` deploys the proxy using the UUPS upgrades plugin; replace the script path when running custom flows.

## Coding Style & Naming Conventions

-   TypeScript files use ES module syntax, 2-space indentation, and camelCase helpers; prefer `PascalCase` for classes/contracts and `SCREAMING_CASE` for compile-time constants.
-   Solidity follows 4-space indentation, SPDX headers, and explicit visibilities. Emit events for observable state changes and keep revert strings aligned with the existing `"Contract: message"` pattern.
-   Run a formatter (e.g., Prettier/solfmt) before committing; match spacing/quote choices already present if no config is available.

## Testing Guidelines

-   Write specs in TypeScript with Mocha’s `describe/it` blocks and Chai expectations. Load deployments through `loadFixture` to keep tests isolated and fast.
-   Co-locate reusable fixtures or helpers under `test/fixtures` if they grow. Assert emitted events and state diffs to document expected behaviours.
-   Aim for meaningful coverage across tier pricing, upgrade authorization, and failure paths; replicate the naming convention `ContractName.suffix.ts` for clarity.

## Commit & Pull Request Guidelines

-   Use conventional Commit-style messages (`feat:`, `fix:`, `chore:`) and keep them under ~72 characters.
-   Each PR should include: purpose summary, key validation steps (`npm run test` output), and links to any tickets. Attach console logs or deployment hashes when changes touch scripts or on-chain flows.
-   Rebase before merging to avoid redundant artifacts, and call out any required `.env` additions in the description.

## Environment & Security Notes

-   Duplicate `.env.example` to `.env` and provide the required token, pair, and tier price variables before running scripts.
-   Never commit secrets or RPC URLs; prefer test-specific keys while collaborating and document expected network IDs in PRs that introduce new deployments.
