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
	const paymentToken = await TokenFactory.deploy();

	const r1TokenAddress = await r1Token.getAddress();
	const usdcTokenAddress = await usdcToken.getAddress();

	const PairFactory = await ethers.getContractFactory("UniswapMockPair");
	const pair = await PairFactory.deploy(usdcTokenAddress, r1TokenAddress);
	const pairAddress = await pair.getAddress();

	const WethFactory = await ethers.getContractFactory("WETHMock");
	const weth = await WethFactory.deploy();
	const wethAddress = await weth.getAddress();

	const RouterFactory = await ethers.getContractFactory("UniswapMockRouter");
	const router = await RouterFactory.deploy(
		pairAddress,
		wethAddress,
		usdcTokenAddress,
		r1TokenAddress
	);
	const routerAddress = await router.getAddress();

	const ManagerFactory = await ethers.getContractFactory("Manager3send");
	const manager = await upgrades.deployProxy(
		ManagerFactory,
		[
			r1TokenAddress,
			usdcTokenAddress,
			pairAddress,
			routerAddress,
			wethAddress,
			MICRO_PRICE,
			STANDARD_PRICE,
			BIG_PRICE,
			ARCHIVE_PRICE,
		],
		{ initializer: "initialize", kind: "uups" }
	);

	await manager.waitForDeployment();

	const routerLiquidityR1 = 1_000_000n * 10n ** 18n;
	const routerLiquidityUsdc = 1_000_000n * 10n ** 6n;
	await r1Token.connect(owner).mint(routerAddress, routerLiquidityR1);
	await usdcToken.connect(owner).mint(routerAddress, routerLiquidityUsdc);

	const microRequired = await manager.getRequiredR1Amount(Tier.Micro);
	const standardRequired = await manager.getRequiredR1Amount(Tier.Standard);
	const bigRequired = await manager.getRequiredR1Amount(Tier.Big);
	const archiveRequired = await manager.getRequiredR1Amount(Tier.Archive);

	const maxRequired = archiveRequired;
	await r1Token.connect(owner).mint(user.address, maxRequired * 2n);
	await usdcToken.connect(owner).mint(user.address, ARCHIVE_PRICE * 10n);
	await paymentToken.connect(owner).mint(user.address, 10n ** 24n);

	return {
		manager,
		r1Token,
		usdcToken,
		paymentToken,
		pair,
		router,
		weth,
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
		const { manager, r1Token, usdcToken, pair, router, weth, owner } =
			await loadFixture(deployFixture);

		expect(await manager.owner()).to.equal(owner.address);
		expect(await manager.r1Token()).to.equal(await r1Token.getAddress());
		expect(await manager.usdcToken()).to.equal(
			await usdcToken.getAddress()
		);
		expect(await manager.uniswapPair()).to.equal(await pair.getAddress());
		expect(await manager.uniswapRouter()).to.equal(
			await router.getAddress()
		);
		expect(await manager.weth()).to.equal(await weth.getAddress());
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
			const userBalanceBefore = await r1Token.balanceOf(user.address);

			await expect(
				manager.connect(user).transferPayment(tier, requiredR1)
			)
				.to.emit(manager, "PaymentProcessed")
				.withArgs(user.address, tier, price, requiredR1);

			expect(await r1Token.balanceOf(user.address)).to.equal(
				userBalanceBefore - requiredR1
			);
			expect(await r1Token.totalSupply()).to.equal(
				supplyBefore - requiredR1
			);
			expect(
				await r1Token.balanceOf(await manager.getAddress())
			).to.equal(0n);
		});
	}

	it("allows users to pay with USDC and burns the swapped R1", async function () {
		const { manager, usdcToken, r1Token, user, required } = await loadFixture(
			deployFixture
		);

		const tier = Tier.Standard;
		const usdcAmount = await manager.tierPrices(tier);
		const requiredR1 = required[tier];
		const userUsdcBefore = await usdcToken.balanceOf(user.address);

		await usdcToken
			.connect(user)
			.approve(await manager.getAddress(), usdcAmount);

		await expect(
			manager.connect(user).transferPaymentWithUSDC(tier, requiredR1)
		)
			.to.emit(manager, "PaymentProcessed")
			.withArgs(user.address, tier, usdcAmount, requiredR1);

		expect(await usdcToken.balanceOf(user.address)).to.equal(
			userUsdcBefore - usdcAmount
		);
		expect(
			await r1Token.balanceOf(await manager.getAddress())
		).to.equal(0n);
	});

	it("allows users to pay with arbitrary tokens swapped into USDC", async function () {
		const { manager, paymentToken, r1Token, user, required } =
			await loadFixture(deployFixture);

		const tier = Tier.Big;
		const usdcAmount = await manager.tierPrices(tier);
		const expectedR1 = required[tier];

		const maxPaymentAmount = usdcAmount * 10n ** 12n;
		const userTokenBefore = await paymentToken.balanceOf(user.address);

		await paymentToken
			.connect(user)
			.approve(await manager.getAddress(), maxPaymentAmount);

		const path = [await paymentToken.getAddress(), await manager.usdcToken()];

		await expect(
			manager
				.connect(user)
				.transferPaymentWithToken(
					tier,
					await paymentToken.getAddress(),
					maxPaymentAmount,
					expectedR1,
					path
				)
		)
			.to.emit(manager, "PaymentProcessed")
			.withArgs(user.address, tier, usdcAmount, expectedR1);

		const userTokenAfter = await paymentToken.balanceOf(user.address);
		expect(userTokenBefore - userTokenAfter).to.equal(maxPaymentAmount);
		expect(
			await r1Token.balanceOf(await manager.getAddress())
		).to.equal(0n);
	});

	it("refunds unused token input when swapping for USDC", async function () {
		const { manager, paymentToken, user, required } = await loadFixture(
			deployFixture
		);

		const tier = Tier.Standard;
		const usdcAmount = await manager.tierPrices(tier);
		const maxPaymentAmount = usdcAmount * 10n ** 12n + 10n ** 18n;
		const requiredToken = usdcAmount * 10n ** 12n;

		await paymentToken
			.connect(user)
			.approve(await manager.getAddress(), maxPaymentAmount);

		const tokenBalanceBefore = await paymentToken.balanceOf(user.address);

		await manager.connect(user).transferPaymentWithToken(
			tier,
			await paymentToken.getAddress(),
			maxPaymentAmount,
			required[tier],
			[await paymentToken.getAddress(), await manager.usdcToken()]
		);

		const tokenBalanceAfter = await paymentToken.balanceOf(user.address);
		expect(tokenBalanceBefore - tokenBalanceAfter).to.equal(requiredToken);
	});

	it("reverts when the minimum R1 output is set above the quote for USDC payments", async function () {
		const { manager, usdcToken, user, required } = await loadFixture(
			deployFixture
		);

		const tier = Tier.Big;
		const usdcAmount = await manager.tierPrices(tier);

		await usdcToken
			.connect(user)
			.approve(await manager.getAddress(), usdcAmount);

		await expect(
			manager
				.connect(user)
				.transferPaymentWithUSDC(tier, required[tier] + 1n)
		).to.be.revertedWith("Manager3send: min output too high");
	});

	it("reverts when the token payment path is invalid", async function () {
		const { manager, paymentToken, user, required } = await loadFixture(
			deployFixture
		);

		const tier = Tier.Micro;
		const maxPaymentAmount = (await manager.tierPrices(tier)) * 10n ** 12n;

		await paymentToken
			.connect(user)
			.approve(await manager.getAddress(), maxPaymentAmount);

		await expect(
			manager
				.connect(user)
				.transferPaymentWithToken(
					tier,
					await paymentToken.getAddress(),
					maxPaymentAmount,
					required[tier],
					[await paymentToken.getAddress(), await paymentToken.getAddress()]
				)
		).to.be.revertedWith("Manager3send: path must end in USDC");
	});

	it("allows users to pay with ETH, refunds excess, and burns R1", async function () {
		const { manager, router, r1Token, user, required } = await loadFixture(
			deployFixture
		);

		const tier = Tier.Micro;
		const usdcAmount = await manager.tierPrices(tier);
		const expectedR1 = required[tier];
		const ethPrice = ethers.toBigInt(await router.ETH_PRICE_USDC());
		const requiredEth =
			(ethers.toBigInt(usdcAmount) * 10n ** 18n + (ethPrice - 1n)) /
			ethPrice;
		const bufferEth = requiredEth + 10n ** 14n;

		const userBalanceBefore = await ethers.provider.getBalance(
			user.address
		);

		const tx = await manager
			.connect(user)
			.transferPaymentWithETH(tier, expectedR1, {
				value: bufferEth,
			});
		await tx.wait();

		const userBalanceAfter = await ethers.provider.getBalance(user.address);
		const spent = userBalanceBefore - userBalanceAfter;
		const overspent = spent - requiredEth;
		expect(spent >= requiredEth).to.be.true;
		expect(overspent >= 0n && overspent < 10n ** 14n).to.be.true;

		await expect(tx)
			.to.emit(manager, "PaymentProcessed")
			.withArgs(user.address, tier, usdcAmount, expectedR1);

		expect(
			await ethers.provider.getBalance(await manager.getAddress())
		).to.equal(0n);
		expect(
			await r1Token.balanceOf(await manager.getAddress())
		).to.equal(0n);
	});

	it("reverts when ETH provided is not enough to cover the USDC price", async function () {
		const { manager, router, user, required } = await loadFixture(
			deployFixture
		);

		const tier = Tier.Standard;
		const usdcAmount = await manager.tierPrices(tier);
		const expectedR1 = required[tier];
		const ethPrice = ethers.toBigInt(await router.ETH_PRICE_USDC());
		const requiredEth =
			(ethers.toBigInt(usdcAmount) * 10n ** 18n + (ethPrice - 1n)) /
			ethPrice;

		await expect(
			manager.connect(user).transferPaymentWithETH(tier, expectedR1, {
				value: requiredEth - 1n,
			})
		).to.be.revertedWith("RouterMock: insufficient ETH");
	});

	it("reverts when the minimum R1 output is set above the quote for ETH payments", async function () {
		const { manager, router, user, required } = await loadFixture(
			deployFixture
		);

		const tier = Tier.Standard;
		const usdcAmount = await manager.tierPrices(tier);
		const ethPrice = ethers.toBigInt(await router.ETH_PRICE_USDC());
		const requiredEth =
			(ethers.toBigInt(usdcAmount) * 10n ** 18n + (ethPrice - 1n)) /
			ethPrice;

		await expect(
			manager.connect(user).transferPaymentWithETH(tier, required[tier] + 1n, {
				value: requiredEth,
			})
		).to.be.revertedWith("Manager3send: min output too high");
	});

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

	it("quotes payment information when swapping from another token", async function () {
		const { manager, paymentToken, required } =
			await loadFixture(deployFixture);

		const tier = Tier.Standard;
		const usdcAmount = await manager.tierPrices(tier);
		const path = [
			await paymentToken.getAddress(),
			await manager.usdcToken(),
		];

		const [r1Amount, tokenAmount, usdcEquivalent] =
			await manager.quotePaymentWithToken(
				tier,
				await paymentToken.getAddress(),
				path
			);

		expect(usdcEquivalent).to.equal(usdcAmount);
		expect(r1Amount).to.equal(required[tier]);
		expect(tokenAmount).to.equal(usdcAmount * 10n ** 12n);
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

		const WethFactory = await ethers.getContractFactory("WETHMock");
		const weth = await WethFactory.deploy();
		const wethAddress = await weth.getAddress();

		const RouterFactory = await ethers.getContractFactory("UniswapMockRouter");
		const router = await RouterFactory.deploy(
			pairAddress,
			wethAddress,
			tokenAddress,
			tokenAddress
		);
		const routerAddress = await router.getAddress();

		const ManagerFactory = await ethers.getContractFactory("Manager3send");

		await expect(
			upgrades.deployProxy(
				ManagerFactory,
				[
					ethers.ZeroAddress,
					tokenAddress,
					pairAddress,
					routerAddress,
					wethAddress,
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
					routerAddress,
					wethAddress,
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
					routerAddress,
					wethAddress,
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
					ethers.ZeroAddress,
					wethAddress,
					MICRO_PRICE,
					STANDARD_PRICE,
					BIG_PRICE,
					ARCHIVE_PRICE,
				],
				{ initializer: "initialize", kind: "uups" }
			)
		).to.be.revertedWith("Manager3send: router address is zero");

		await expect(
			upgrades.deployProxy(
				ManagerFactory,
				[
					tokenAddress,
					tokenAddress,
					pairAddress,
					routerAddress,
					ethers.ZeroAddress,
					MICRO_PRICE,
					STANDARD_PRICE,
					BIG_PRICE,
					ARCHIVE_PRICE,
				],
				{ initializer: "initialize", kind: "uups" }
			)
		).to.be.revertedWith("Manager3send: WETH address is zero");

		await expect(
			upgrades.deployProxy(
				ManagerFactory,
				[
					tokenAddress,
					tokenAddress,
					pairAddress,
					routerAddress,
					wethAddress,
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
					routerAddress,
					wethAddress,
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
					routerAddress,
					wethAddress,
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
					routerAddress,
					wethAddress,
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

		const WethFactory = await ethers.getContractFactory("WETHMock");
		const weth = await WethFactory.deploy();
		const RouterFactory = await ethers.getContractFactory(
			"UniswapMockRouter"
		);
		const router = await RouterFactory.deploy(
			await wrongPair.getAddress(),
			await weth.getAddress(),
			usdcTokenAddress,
			r1TokenAddress
		);

		const ManagerFactory = await ethers.getContractFactory("Manager3send");

		await expect(
			upgrades.deployProxy(
				ManagerFactory,
				[
					r1TokenAddress,
					usdcTokenAddress,
					await wrongPair.getAddress(),
					await router.getAddress(),
					await weth.getAddress(),
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
