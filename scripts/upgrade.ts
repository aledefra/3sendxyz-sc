import { ethers, run, upgrades } from "hardhat";

function requireEnv(name: string): string {
	const value = process.env[name];
	if (!value || value.trim() === "") {
		throw new Error(`Missing required environment variable ${name}`);
	}
	return value.trim();
}

async function main() {
	const proxyAddress = requireEnv("MANAGER_PROXY_ADDRESS");

	const [deployer] = await ethers.getSigners();
	const network = await ethers.provider.getNetwork();

	console.log(`\n♻️  Upgrading Manager3send at ${proxyAddress}`);
	console.log(`   Network: ${network.name} (${network.chainId})`);
	console.log(`   Upgrader: ${deployer.address}\n`);

	const Manager3send = await ethers.getContractFactory("Manager3send");

	console.log("   Validating upgrade...");
	await upgrades.validateUpgrade(proxyAddress, Manager3send);

	console.log("   Performing upgrade transaction...");
	const upgraded = await upgrades.upgradeProxy(proxyAddress, Manager3send);
	await upgraded.waitForDeployment();

	const implementationAddress =
		await upgrades.erc1967.getImplementationAddress(proxyAddress);

	console.log("✅ Upgrade completed!");
	console.log(`   New implementation address: ${implementationAddress}\n`);

	const shouldVerify =
		(process.env.VERIFY_ON_UPGRADE || "").toLowerCase() === "true";
	if (shouldVerify) {
		if (!process.env.ETHERSCAN_API_KEY) {
			console.warn(
				"⚠️  VERIFY_ON_UPGRADE is true but ETHERSCAN_API_KEY is not set. Skipping verification."
			);
		} else {
			try {
				console.log("   Verifying new implementation on Etherscan...");
				await run("verify:verify", { address: implementationAddress });
				console.log("   Etherscan verification complete.\n");
			} catch (error) {
				console.warn(
					"⚠️  Verification failed. You can retry manually with:\n",
					`    npx hardhat verify --network ${network.name} ${implementationAddress}`,
					"\nError:",
					error instanceof Error ? error.message : error
				);
			}
		}
	}
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
