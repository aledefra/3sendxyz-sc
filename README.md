# 3sendxyz Smart Contracts

Upgrade-ready Solidity project for 3sendxyz. It currently ships two upgradeable payment/burn managers plus supporting mocks and tests.

## Packages & Tooling

-   [Hardhat](https://hardhat.org) with TypeScript tooling
-   [OpenZeppelin Contracts](https://docs.openzeppelin.com/contracts) (core + upgradeable variants)
-   Hardhat Upgrades plugin for deploying and upgrading UUPS proxies

## Contracts

-   `Manager3send`: multi-tier UUPS upgradeable contract that prices uploads off a Uniswap V2 R1/USDC pool and burns the required R1 amount via `transferPayment`. Four pricing tiers (Micro, Standard, Big, Archive) are stored on-chain and can be updated by the owner.
-   `R1TokenMock`, `UniswapMockPair`, `UniswapMockRouter`: lightweight mocks used inside the test suite to emulate tokens and Uniswap V2 behaviour.

## Getting Started

```bash
npm install
```

### Compile

```bash
npx hardhat compile
```

### Test

```bash
npx hardhat test
```

### Deploy

1. Fill `.env` with the token addresses, pair address, and tier prices (values are interpreted as USDC amounts with 6 decimals, e.g. `0.10` for $0.10). Set `VERIFY_ON_DEPLOY=true` (plus `ETHERSCAN_API_KEY`) if you want automatic Basescan verification.
2. Run the deployment script:

```bash
npx hardhat run --network <network> scripts/deploy.ts
```

### Upgrade

1. Set `MANAGER_PROXY_ADDRESS` in `.env` (and `VERIFY_ON_UPGRADE=true` if you want to auto-verify the new implementation).
2. Deploy the new implementation with:

```bash
npx hardhat run --network <network> scripts/upgrade.ts
```

## Configuration

Copy `.env.example` to `.env` and fill network credentials when you are ready to run deployments against testnets or mainnet.
