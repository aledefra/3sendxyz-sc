import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";

enum Tier {
	Micro,
	Standard,
	Big,
	Archive,
}

const MICRO_PRICE = 100_000n; // $0.10 with 6 decimals
const STANDARD_PRICE = 250_000n; // $0.25
const BIG_PRICE = 750_000n; // $0.75
const ARCHIVE_PRICE = 2_000_000n; // $2.00

async function deployFixture() {
	const [owner, user, other] = await ethers.getSigners();

	const TokenFactory = await ethers.getContractFactory("R1TokenMock");
	const r1Token = await TokenFactory.deploy();
	const usdcToken = await TokenFactory.deploy();

	const r1TokenAddress = await r1Token.getAddress();
	const usdcTokenAddress = await usdcToken.getAddress();

	const PairFactory = await ethers.getContractFactory("UniswapMockPair");
	const pair = await PairFactory.deploy(usdcTokenAddress, r1TokenAddress);
	const pairAddress = await pair.getAddress();

	const ManagerFactory = await ethers.getContractFactory("Manager3send");
	const manager = await upgrades.deployProxy(
		ManagerFactory,
		[
			r1TokenAddress,
			usdcTokenAddress,
			pairAddress,
			MICRO_PRICE,
			STANDARD_PRICE,
			BIG_PRICE,
			ARCHIVE_PRICE,
		],
		{ initializer: "initialize", kind: "uups" }
	);

	await manager.waitForDeployment();

	const microRequired = await manager.getRequiredR1Amount(Tier.Micro);
	const standardRequired = await manager.getRequiredR1Amount(Tier.Standard);
	const bigRequired = await manager.getRequiredR1Amount(Tier.Big);
	const archiveRequired = await manager.getRequiredR1Amount(Tier.Archive);

	// Ensure the user has more than enough R1 tokens for every tier
	const maxRequired = archiveRequired;
	await r1Token.connect(owner).mint(user.address, maxRequired * 2n);

	return {
		manager,
		r1Token,
		usdcToken,
		pair,
		owner,
		user,
		other,
		required: {
			[Tier.Micro]: microRequired,
			[Tier.Standard]: standardRequired,
			[Tier.Big]: bigRequired,
			[Tier.Archive]: archiveRequired,
		},
	};
}

describe("Manager3send", function () {
	it("initializes correctly", async function () {
		const { manager, r1Token, usdcToken, pair, owner } = await loadFixture(
			deployFixture
		);

		expect(await manager.owner()).to.equal(owner.address);
		expect(await manager.r1Token()).to.equal(await r1Token.getAddress());
		expect(await manager.usdcToken()).to.equal(
			await usdcToken.getAddress()
		);
		expect(await manager.uniswapPair()).to.equal(await pair.getAddress());
		expect(await manager.tierPrices(Tier.Micro)).to.equal(MICRO_PRICE);
		expect(await manager.tierPrices(Tier.Standard)).to.equal(
			STANDARD_PRICE
		);
		expect(await manager.tierPrices(Tier.Big)).to.equal(BIG_PRICE);
		expect(await manager.tierPrices(Tier.Archive)).to.equal(ARCHIVE_PRICE);
	});

	const paymentCases = [
		{ label: "micro", tier: Tier.Micro, price: MICRO_PRICE },
		{ label: "standard", tier: Tier.Standard, price: STANDARD_PRICE },
		{ label: "big", tier: Tier.Big, price: BIG_PRICE },
		{ label: "archive", tier: Tier.Archive, price: ARCHIVE_PRICE },
	];

	for (const { label, tier, price } of paymentCases) {
		it(`processes ${label} tier payments and burns the correct R1 amount`, async function () {
			const { manager, r1Token, user, required } = await loadFixture(
				deployFixture
			);

			const requiredR1 = required[tier];
			await r1Token
				.connect(user)
				.approve(await manager.getAddress(), requiredR1);

			const supplyBefore = await r1Token.totalSupply();

			await expect(
				manager.connect(user).transferPayment(tier, requiredR1)
			)
				.to.emit(manager, "PaymentProcessed")
				.withArgs(user.address, tier, price, requiredR1);

			expect(await r1Token.balanceOf(user.address)).to.equal(
				supplyBefore - requiredR1
			);
			expect(await r1Token.totalSupply()).to.equal(
				supplyBefore - requiredR1
			);
			expect(
				await r1Token.balanceOf(await manager.getAddress())
			).to.equal(0n);
		});
	}

	it("reverts when allowance is insufficient", async function () {
		const { manager, r1Token, user } = await loadFixture(deployFixture);

		const requiredR1 = await manager.getRequiredR1Amount(Tier.Standard);

		await expect(
			manager.connect(user).transferPayment(Tier.Standard, requiredR1)
		).to.be.revertedWithCustomError(r1Token, "ERC20InsufficientAllowance");
	});

	it("allows the owner to update tier pricing", async function () {
		const { manager, owner } = await loadFixture(deployFixture);
		const newPrice = STANDARD_PRICE + 100_000n;

		await expect(
			manager.connect(owner).setTierPrice(Tier.Standard, newPrice)
		)
			.to.emit(manager, "TierPriceUpdated")
			.withArgs(Tier.Standard, STANDARD_PRICE, newPrice);

		expect(await manager.tierPrices(Tier.Standard)).to.equal(newPrice);
	});

	it("blocks non-owners from updating tier pricing", async function () {
		const { manager, user } = await loadFixture(deployFixture);

		await expect(
			manager
				.connect(user)
				.setTierPrice(Tier.Standard, STANDARD_PRICE + 1n)
		)
			.to.be.revertedWithCustomError(
				manager,
				"OwnableUnauthorizedAccount"
			)
			.withArgs(user.address);
	});

	it("rejects zero-value tier updates", async function () {
		const { manager, owner } = await loadFixture(deployFixture);

		await expect(
			manager.connect(owner).setTierPrice(Tier.Micro, 0n)
		).to.be.revertedWith("Manager3send: amount is zero");
	});

	it("quotes payment information for a given payload size", async function () {
		const { manager } = await loadFixture(deployFixture);
		const [quoteTier, quoteUsdc, quoteR1] = await manager.quotePayment(
			Tier.Big
		);

		expect(quoteTier).to.equal(Tier.Big);
		expect(quoteUsdc).to.equal(BIG_PRICE);
		expect(quoteR1).to.equal(await manager.getRequiredR1Amount(Tier.Big));
	});

	it("reverts when the required R1 exceeds the caller limit", async function () {
		const { manager, r1Token, user, required } = await loadFixture(
			deployFixture
		);

		const requiredR1 = required[Tier.Standard];
		await r1Token
			.connect(user)
			.approve(await manager.getAddress(), requiredR1);

		await expect(
			manager
				.connect(user)
				.transferPayment(Tier.Standard, requiredR1 - 1n)
		).to.be.revertedWith("Manager3send: slippage limit exceeded");
	});

	it("reverts when the slippage limit is zero", async function () {
		const { manager, r1Token, user, required } = await loadFixture(
			deployFixture
		);

		const requiredR1 = required[Tier.Micro];
		await r1Token
			.connect(user)
			.approve(await manager.getAddress(), requiredR1);

		await expect(
			manager.connect(user).transferPayment(Tier.Micro, 0n)
		).to.be.revertedWith("Manager3send: slippage limit exceeded");
	});

	it("validates constructor arguments", async function () {
		const TokenFactory = await ethers.getContractFactory("R1TokenMock");
		const token = await TokenFactory.deploy();
		const tokenAddress = await token.getAddress();

		const PairFactory = await ethers.getContractFactory("UniswapMockPair");
		const pair = await PairFactory.deploy(tokenAddress, tokenAddress);
		const pairAddress = await pair.getAddress();

		const ManagerFactory = await ethers.getContractFactory("Manager3send");

		await expect(
			upgrades.deployProxy(
				ManagerFactory,
				[
					ethers.ZeroAddress,
					tokenAddress,
					pairAddress,
					MICRO_PRICE,
					STANDARD_PRICE,
					BIG_PRICE,
					ARCHIVE_PRICE,
				],
				{ initializer: "initialize", kind: "uups" }
			)
		).to.be.revertedWith("Manager3send: R1 address is zero");

		await expect(
			upgrades.deployProxy(
				ManagerFactory,
				[
					tokenAddress,
					ethers.ZeroAddress,
					pairAddress,
					MICRO_PRICE,
					STANDARD_PRICE,
					BIG_PRICE,
					ARCHIVE_PRICE,
				],
				{ initializer: "initialize", kind: "uups" }
			)
		).to.be.revertedWith("Manager3send: USDC address is zero");

		await expect(
			upgrades.deployProxy(
				ManagerFactory,
				[
					tokenAddress,
					tokenAddress,
					ethers.ZeroAddress,
					MICRO_PRICE,
					STANDARD_PRICE,
					BIG_PRICE,
					ARCHIVE_PRICE,
				],
				{ initializer: "initialize", kind: "uups" }
			)
		).to.be.revertedWith("Manager3send: pair address is zero");

		await expect(
			upgrades.deployProxy(
				ManagerFactory,
				[
					tokenAddress,
					tokenAddress,
					pairAddress,
					0n,
					STANDARD_PRICE,
					BIG_PRICE,
					ARCHIVE_PRICE,
				],
				{ initializer: "initialize", kind: "uups" }
			)
		).to.be.revertedWith("Manager3send: micro price is zero");

		await expect(
			upgrades.deployProxy(
				ManagerFactory,
				[
					tokenAddress,
					tokenAddress,
					pairAddress,
					MICRO_PRICE,
					0n,
					BIG_PRICE,
					ARCHIVE_PRICE,
				],
				{ initializer: "initialize", kind: "uups" }
			)
		).to.be.revertedWith("Manager3send: standard price is zero");

		await expect(
			upgrades.deployProxy(
				ManagerFactory,
				[
					tokenAddress,
					tokenAddress,
					pairAddress,
					MICRO_PRICE,
					STANDARD_PRICE,
					0n,
					ARCHIVE_PRICE,
				],
				{ initializer: "initialize", kind: "uups" }
			)
		).to.be.revertedWith("Manager3send: big price is zero");

		await expect(
			upgrades.deployProxy(
				ManagerFactory,
				[
					tokenAddress,
					tokenAddress,
					pairAddress,
					MICRO_PRICE,
					STANDARD_PRICE,
					BIG_PRICE,
					0n,
				],
				{ initializer: "initialize", kind: "uups" }
			)
		).to.be.revertedWith("Manager3send: archive price is zero");
	});

	it("rejects mismatched pairs", async function () {
		const TokenFactory = await ethers.getContractFactory("R1TokenMock");
		const r1Token = await TokenFactory.deploy();
		const usdcToken = await TokenFactory.deploy();
		const unrelatedToken = await TokenFactory.deploy();

		const r1TokenAddress = await r1Token.getAddress();
		const usdcTokenAddress = await usdcToken.getAddress();
		const unrelatedAddress = await unrelatedToken.getAddress();

		const PairFactory = await ethers.getContractFactory("UniswapMockPair");
		const wrongPair = await PairFactory.deploy(
			unrelatedAddress,
			unrelatedAddress
		);

		const ManagerFactory = await ethers.getContractFactory("Manager3send");

		await expect(
			upgrades.deployProxy(
				ManagerFactory,
				[
					r1TokenAddress,
					usdcTokenAddress,
					await wrongPair.getAddress(),
					MICRO_PRICE,
					STANDARD_PRICE,
					BIG_PRICE,
					ARCHIVE_PRICE,
				],
				{ initializer: "initialize", kind: "uups" }
			)
		).to.be.revertedWith("Manager3send: pair tokens mismatch");
	});
});
