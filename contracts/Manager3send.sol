// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IR1Token is IERC20 {
    function burn(address from, uint256 amount) external;
}

interface IUniswapV2Pair {
    function getReserves()
        external
        view
        returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);
    function token0() external view returns (address);
    function token1() external view returns (address);
}

contract Manager3send is
    Initializable,
    OwnableUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable
{
    enum Tier {
        Micro,
        Standard,
        Big,
        Archive
    }

    IR1Token public r1Token;
    IERC20 public usdcToken;
    IUniswapV2Pair public uniswapPair;
    mapping(Tier => uint256) public tierPrices;

    event PaymentProcessed(
        address indexed sender,
        Tier tier,
        uint256 usdcAmount,
        uint256 r1Amount
    );
    event TierPriceUpdated(
        Tier tier,
        uint256 previousAmount,
        uint256 newAmount
    );

    function initialize(
        address r1Address,
        address usdcAddress,
        address uniswapPairAddress,
        uint256 microPrice_,
        uint256 standardPrice_,
        uint256 bigPrice_,
        uint256 archivePrice_
    ) external initializer {
        require(r1Address != address(0), "Manager3send: R1 address is zero");
        require(
            usdcAddress != address(0),
            "Manager3send: USDC address is zero"
        );
        require(
            uniswapPairAddress != address(0),
            "Manager3send: pair address is zero"
        );
        require(microPrice_ > 0, "Manager3send: micro price is zero");
        require(standardPrice_ > 0, "Manager3send: standard price is zero");
        require(bigPrice_ > 0, "Manager3send: big price is zero");
        require(archivePrice_ > 0, "Manager3send: archive price is zero");

        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();

        r1Token = IR1Token(r1Address);
        usdcToken = IERC20(usdcAddress);
        uniswapPair = IUniswapV2Pair(uniswapPairAddress);
        _validatePairTokens(uniswapPairAddress, r1Address, usdcAddress);
        _setTierPrice(Tier.Micro, microPrice_);
        _setTierPrice(Tier.Standard, standardPrice_);
        _setTierPrice(Tier.Big, bigPrice_);
        _setTierPrice(Tier.Archive, archivePrice_);
    }

    /**
     * @notice Burns the R1 amount associated with the selected pricing tier.
     * @param tier Pricing option to charge.
     * @param maxR1Amount Maximum R1 amount the caller is willing to spend.
     */
    function transferPayment(
        Tier tier,
        uint256 maxR1Amount
    ) external nonReentrant {
        uint256 usdcAmount = tierPrices[tier];
        require(usdcAmount > 0, "Manager3send: tier price is zero");

        uint256 requiredR1 = _calculateR1Amount(usdcAmount);
        require(requiredR1 > 0, "Manager3send: computed amount is zero");
        require(
            requiredR1 <= maxR1Amount,
            "Manager3send: slippage limit exceeded"
        );

        r1Token.transferFrom(_msgSender(), address(this), requiredR1);
        r1Token.burn(address(this), requiredR1);

        emit PaymentProcessed(_msgSender(), tier, usdcAmount, requiredR1);
    }

    function setTierPrice(Tier tier, uint256 newAmount) external onlyOwner {
        require(newAmount > 0, "Manager3send: amount is zero");
        uint256 previousAmount = tierPrices[tier];
        _setTierPrice(tier, newAmount);
        emit TierPriceUpdated(tier, previousAmount, newAmount);
    }

    function getRequiredR1Amount(Tier tier) external view returns (uint256) {
        uint256 usdcAmount = tierPrices[tier];
        require(usdcAmount > 0, "Manager3send: tier price is zero");
        return _calculateR1Amount(usdcAmount);
    }

    function quotePayment(
        Tier tier
    ) external view returns (Tier, uint256 usdcAmount, uint256 r1Amount) {
        usdcAmount = tierPrices[tier];
        require(usdcAmount > 0, "Manager3send: tier price is zero");
        r1Amount = _calculateR1Amount(usdcAmount);
        return (tier, usdcAmount, r1Amount);
    }

    function getReserves()
        external
        view
        returns (uint256 reserveUsdc, uint256 reserveR1)
    {
        return _getOrderedReserves();
    }

    /**
     * @dev Authorizes upgrades, restricted to the owner.
     */
    function _authorizeUpgrade(
        address newImplementation
    ) internal override onlyOwner {}

    function _calculateR1Amount(
        uint256 usdcAmount
    ) internal view returns (uint256) {
        (uint256 reserveUsdc, uint256 reserveR1) = _getOrderedReserves();
        require(reserveUsdc > 0 && reserveR1 > 0, "Manager3send: empty pool");
        return (usdcAmount * reserveR1) / reserveUsdc;
    }

    function _setTierPrice(Tier tier, uint256 newAmount) internal {
        tierPrices[tier] = newAmount;
    }

    function _getOrderedReserves()
        internal
        view
        returns (uint256 reserveUsdc, uint256 reserveR1)
    {
        IUniswapV2Pair pair = uniswapPair;
        require(
            address(pair) != address(0),
            "Manager3send: pair address is zero"
        );

        (uint112 reserve0, uint112 reserve1, ) = pair.getReserves();
        address token0 = pair.token0();
        address token1 = pair.token1();

        if (token0 == address(usdcToken) && token1 == address(r1Token)) {
            reserveUsdc = uint256(reserve0);
            reserveR1 = uint256(reserve1);
        } else if (token0 == address(r1Token) && token1 == address(usdcToken)) {
            reserveUsdc = uint256(reserve1);
            reserveR1 = uint256(reserve0);
        } else {
            revert("Manager3send: pair tokens mismatch");
        }
    }

    function _validatePairTokens(
        address pairAddress,
        address r1Address,
        address usdcAddress
    ) internal view {
        IUniswapV2Pair pair = IUniswapV2Pair(pairAddress);
        address token0 = pair.token0();
        address token1 = pair.token1();
        require(
            (token0 == r1Address && token1 == usdcAddress) ||
                (token0 == usdcAddress && token1 == r1Address),
            "Manager3send: pair tokens mismatch"
        );
    }
}
