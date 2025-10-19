import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@openzeppelin/hardhat-upgrades";
import * as dotenv from "dotenv";

dotenv.config();

const deployerPrivateKey = process.env.DEPLOYER_PRIVATE_KEY;
const sharedAccounts = deployerPrivateKey ? [deployerPrivateKey] : [];

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    hardhat: {},
    ...(process.env.BASE_RPC_URL
      ? {
          base: {
            url: process.env.BASE_RPC_URL,
            chainId: 8453,
            accounts: sharedAccounts,
          },
        }
      : {}),
    ...(process.env.BASE_SEPOLIA_RPC_URL
      ? {
          baseSepolia: {
            url: process.env.BASE_SEPOLIA_RPC_URL,
            chainId: 84532,
            accounts: sharedAccounts,
          },
        }
      : {}),
  },
  mocha: {
    timeout: 60000,
  },
};

export default config;
