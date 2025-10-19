import { ethers, upgrades } from "hardhat";

function requireEnv(name: string): string {
	const value = process.env[name];
	if (!value || value.trim() === "") {
		throw new Error(`Missing required environment variable ${name}`);
	}
	return value.trim();
}

function parseUsdcPriceEnv(name: string): bigint {
	const raw = requireEnv(name);
	try {
		return ethers.parseUnits(raw, 6);
	} catch (error) {
		throw new Error(
			`Unable to parse ${name} value "${raw}" as 6-decimal USDC amount`
		);
	}
}

async function main() {
	const r1Address = requireEnv("R1_TOKEN_ADDRESS");
	const usdcAddress = requireEnv("USDC_TOKEN_ADDRESS");
	const pairAddress = requireEnv("R1_USDC_PAIR_ADDRESS");

	const microPrice = parseUsdcPriceEnv("TIER_PRICE_MICRO");
	const standardPrice = parseUsdcPriceEnv("TIER_PRICE_STANDARD");
	const bigPrice = parseUsdcPriceEnv("TIER_PRICE_BIG");
	const archivePrice = parseUsdcPriceEnv("TIER_PRICE_ARCHIVE");

	const [deployer] = await ethers.getSigners();
	const network = await ethers.provider.getNetwork();

	console.log(`\n🚀 Deploying Manager3send from ${deployer.address}`);
	console.log(`   Network: ${network.name} (${network.chainId})`);
	console.log(
		`   Deployer balance: ${ethers.formatEther(
			await ethers.provider.getBalance(deployer)
		)} ETH\n`
	);

	const Manager3send = await ethers.getContractFactory("Manager3send");

	const proxy = await upgrades.deployProxy(
		Manager3send,
		[
			r1Address,
			usdcAddress,
			pairAddress,
			microPrice,
			standardPrice,
			bigPrice,
			archivePrice,
		],
		{ initializer: "initialize", kind: "uups" }
	);
	const deployTx = proxy.deploymentTransaction();
	if (deployTx) {
		console.log(
			`   Waiting for deployment tx ${deployTx.hash} to be confirmed...`
		);
		await deployTx.wait(2);
	}
	await proxy.waitForDeployment();

	const proxyAddress = await proxy.getAddress();
	console.log(`\n✅ Manager3send proxy deployed at ${proxyAddress}`);

	let implementationAddress: string | undefined;

	try {
		implementationAddress = await upgrades.erc1967.getImplementationAddress(
			proxyAddress
		);
	} catch (error) {
		console.warn(
			"\n⚠️  Unable to read ERC1967 implementation/admin slots immediately after deployment.",
			"This can happen on some L2 RPCs; the deployment itself is still valid.",
			"\n   You can retry later with: npx hardhat console --network <network>",
			`and run: await upgrades.erc1967.getImplementationAddress("${proxyAddress}")\n`,
			error instanceof Error ? error.message : error
		);
	}

	if (implementationAddress) {
		console.log(`   Implementation address: ${implementationAddress}`);
	}
	console.log("");
	console.log("   Tier pricing (USDC, 6 decimals):");
	console.log(`     Micro:    ${microPrice.toString()}`);
	console.log(`     Standard: ${standardPrice.toString()}`);
	console.log(`     Big:      ${bigPrice.toString()}`);
	console.log(`     Archive:  ${archivePrice.toString()}\n`);
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
