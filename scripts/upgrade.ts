import { ethers, upgrades } from "hardhat";

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

  const implementationAddress = await upgrades.erc1967.getImplementationAddress(proxyAddress);

  console.log("✅ Upgrade completed!");
  console.log(`   New implementation address: ${implementationAddress}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
