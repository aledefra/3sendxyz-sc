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
	etherscan: {
		apiKey: process.env.ETHERSCAN_API_KEY,
		customChains: [
			{
				network: "base",
				chainId: 8453,
				urls: {
					apiURL: "https://api.basescan.org/api",
					browserURL: "https://basescan.org",
				},
			},
			{
				network: "baseSepolia",
				chainId: 84532,
				urls: {
					apiURL: "https://api-sepolia.basescan.org/api",
					browserURL: "https://sepolia.basescan.org",
				},
			},
		],
	},
	mocha: {
		timeout: 60000,
	},
};

export default config;
